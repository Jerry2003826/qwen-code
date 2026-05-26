/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFile } from 'node:fs/promises';
import type {
  Content,
  GenerateContentConfig,
  GenerateContentResponseUsageMetadata,
  Part,
} from '@google/genai';
import type { Config } from '../config/config.js';
import { DEFAULT_QWEN_MODEL } from '../config/models.js';
import { SchemaValidator } from './schemaValidator.js';

export interface SideQueryJsonOptions<TResponse> {
  contents: Content[];
  schema: Record<string, unknown>;
  abortSignal: AbortSignal;
  /**
   * Override the model used for this query. Defaults to
   * `config.getFastModel?.() ?? config.getModel() ?? DEFAULT_QWEN_MODEL`
   * — side queries run on the fast model when one is configured, including
   * fast models registered under a different authType than the main session.
   * Pass an explicit value to pin to the main model (e.g. long-form
   * summarization in web-fetch).
   */
  model?: string;
  systemInstruction?: string | Part | Part[] | Content;
  promptId?: string;
  purpose?: string;
  /**
   * Append the user's configured `output-language.md` rule to this side
   * query's system instruction. Use only for side queries that produce
   * user-visible text.
   */
  respectOutputLanguagePreference?: boolean;
  /**
   * Caller-supplied generation config. `thinkingConfig.includeThoughts`
   * defaults to `false` for all side queries; pass
   * `thinkingConfig: { includeThoughts: true }` here if reasoning output is
   * required.
   */
  config?: Omit<
    GenerateContentConfig,
    | 'systemInstruction'
    | 'responseJsonSchema'
    | 'responseMimeType'
    | 'tools'
    | 'abortSignal'
  >;
  /**
   * Cap the retry loop. Best-effort cosmetic queries (e.g. session title)
   * pass `1` to avoid burning attempts on failures the user will never see.
   */
  maxAttempts?: number;
  validate?: (response: TResponse) => string | null;
}

export interface SideQueryTextOptions {
  contents: Content[];
  /**
   * Marker that disambiguates this overload from the JSON-mode options.
   * Callers never set this — the type forces TS to pick the JSON overload
   * when an actual schema is present.
   */
  schema?: never;
  abortSignal: AbortSignal;
  /**
   * Override the model used for this query. Defaults to
   * `config.getFastModel?.() ?? config.getModel() ?? DEFAULT_QWEN_MODEL`
   * — side queries run on the fast model when one is configured, including
   * fast models registered under a different authType than the main session.
   * Pass an explicit value to pin to the main model (e.g. long-form
   * summarization in web-fetch).
   */
  model?: string;
  systemInstruction?: string | Part | Part[] | Content;
  promptId?: string;
  purpose?: string;
  /**
   * Append the user's configured `output-language.md` rule to this side
   * query's system instruction. Use only for side queries that produce
   * user-visible text.
   */
  respectOutputLanguagePreference?: boolean;
  /**
   * Caller-supplied generation config. `thinkingConfig.includeThoughts`
   * defaults to `false` for all side queries; pass
   * `thinkingConfig: { includeThoughts: true }` here if reasoning output is
   * required.
   */
  config?: Omit<
    GenerateContentConfig,
    'systemInstruction' | 'tools' | 'abortSignal'
  >;
  /**
   * Cap the retry loop. Best-effort cosmetic queries pass `1` to avoid
   * burning attempts on failures the user will never see.
   */
  maxAttempts?: number;
  validate?: (text: string) => string | null;
}

export interface SideQueryTextResult {
  text: string;
  usage: GenerateContentResponseUsageMetadata | undefined;
}

export type SideQueryOptions<TResponse> = SideQueryJsonOptions<TResponse>;

function buildDefaultPromptId(purpose?: string): string {
  return purpose ? `side-query:${purpose}` : 'side-query';
}

function resolveDefaultModel(config: Config, override?: string): string {
  return (
    override ??
    config.getFastModel?.() ??
    config.getModel() ??
    DEFAULT_QWEN_MODEL
  );
}

function applyThinkingDefault(
  callerConfig: GenerateContentConfig | undefined,
): GenerateContentConfig {
  const thinkingOverride = callerConfig?.thinkingConfig;
  return {
    ...(callerConfig ?? {}),
    thinkingConfig: thinkingOverride
      ? { includeThoughts: false, ...thinkingOverride }
      : { includeThoughts: false },
  };
}

function isJsonOptions<TResponse>(
  options: SideQueryTextOptions | SideQueryJsonOptions<TResponse>,
): options is SideQueryJsonOptions<TResponse> {
  return (
    (options as SideQueryJsonOptions<TResponse>).schema !== undefined &&
    (options as SideQueryJsonOptions<TResponse>).schema !== null
  );
}

const OUTPUT_LANGUAGE_PREFERENCE_HEADER =
  'User output language preference from output-language.md:';
const OUTPUT_LANGUAGE_PREFERENCE_OVERRIDE =
  'This preference overrides any earlier language-selection rule in this system instruction.';
const outputLanguagePreferenceCache = new Map<
  string,
  Promise<string | undefined>
>();

async function readOutputLanguagePreference(
  config: Config,
): Promise<string | undefined> {
  const filePath = config.getOutputLanguageFilePath?.();
  if (!filePath) return undefined;

  let cached = outputLanguagePreferenceCache.get(filePath);
  if (!cached) {
    cached = readFile(filePath, 'utf8')
      .then((content) => content.trim() || undefined)
      .catch(() => undefined);
    outputLanguagePreferenceCache.set(filePath, cached);
  }
  return cached;
}

function appendSystemInstructionText(
  systemInstruction: string | Part | Part[] | Content | undefined,
  text: string,
): string | Part | Part[] | Content {
  if (!systemInstruction) {
    return text;
  }

  if (typeof systemInstruction === 'string') {
    return `${systemInstruction}\n\n${text}`;
  }

  const textPart: Part = { text };
  if (Array.isArray(systemInstruction)) {
    return [...systemInstruction, textPart];
  }

  if (
    typeof systemInstruction === 'object' &&
    'parts' in systemInstruction &&
    Array.isArray(systemInstruction.parts)
  ) {
    return {
      ...systemInstruction,
      parts: [...systemInstruction.parts, textPart],
    };
  }

  return [systemInstruction as Part, textPart];
}

async function applyOutputLanguagePreference(
  config: Config,
  systemInstruction: string | Part | Part[] | Content | undefined,
  respectOutputLanguagePreference: boolean | undefined,
): Promise<string | Part | Part[] | Content | undefined> {
  if (!respectOutputLanguagePreference) {
    return systemInstruction;
  }

  const preference = await readOutputLanguagePreference(config);
  if (!preference) {
    return systemInstruction;
  }

  return appendSystemInstructionText(
    systemInstruction,
    `${OUTPUT_LANGUAGE_PREFERENCE_HEADER}\n${preference}\n${OUTPUT_LANGUAGE_PREFERENCE_OVERRIDE}`,
  );
}

export async function runSideQuery(
  config: Config,
  options: SideQueryTextOptions,
): Promise<SideQueryTextResult>;
export async function runSideQuery<TResponse>(
  config: Config,
  options: SideQueryJsonOptions<TResponse>,
): Promise<TResponse>;
export async function runSideQuery<TResponse>(
  config: Config,
  options: SideQueryTextOptions | SideQueryJsonOptions<TResponse>,
): Promise<SideQueryTextResult | TResponse> {
  const model = resolveDefaultModel(config, options.model);
  const promptId = options.promptId ?? buildDefaultPromptId(options.purpose);
  const requestConfig = applyThinkingDefault(options.config);
  const systemInstruction = await applyOutputLanguagePreference(
    config,
    options.systemInstruction,
    options.respectOutputLanguagePreference,
  );

  if (isJsonOptions(options)) {
    const response = (await config.getBaseLlmClient().generateJson({
      contents: options.contents,
      schema: options.schema,
      abortSignal: options.abortSignal,
      model,
      systemInstruction,
      promptId,
      config: requestConfig,
      ...(options.maxAttempts !== undefined && {
        maxAttempts: options.maxAttempts,
      }),
    })) as TResponse;

    const schemaError = SchemaValidator.validate(options.schema, response);
    if (schemaError) {
      throw new Error(`Invalid side query response: ${schemaError}`);
    }

    const customError = options.validate?.(response);
    if (customError) {
      throw new Error(customError);
    }

    return response;
  }

  const result = await config.getBaseLlmClient().generateText({
    contents: options.contents,
    model,
    systemInstruction,
    abortSignal: options.abortSignal,
    promptId,
    config: requestConfig,
    ...(options.maxAttempts !== undefined && {
      maxAttempts: options.maxAttempts,
    }),
  });

  const customError = options.validate?.(result.text);
  if (customError) {
    throw new Error(customError);
  }

  return result;
}
