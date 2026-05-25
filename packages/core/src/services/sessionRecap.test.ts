/**
 * @license
 * Copyright 2025 Qwen Code
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Content } from '@google/genai';
import { describe, expect, it, vi } from 'vitest';
import type { Config } from '../config/config.js';
import { generateSessionRecap } from './sessionRecap.js';

function writeOutputLanguageFile(content: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qwen-session-recap-'));
  const file = path.join(dir, 'output-language.md');
  fs.writeFileSync(file, content, 'utf8');
  return file;
}

describe('generateSessionRecap', () => {
  it('includes the configured output language preference in the recap prompt', async () => {
    const history: Content[] = [
      { role: 'user', parts: [{ text: 'fix the failing auth test' }] },
      { role: 'model', parts: [{ text: 'I found the mocked token issue.' }] },
    ];
    const generateText = vi.fn().mockResolvedValue({
      text: '<recap>Auth test fix is in progress.</recap>',
      usage: undefined,
    });
    const config = {
      getGeminiClient: vi.fn(() => ({
        getChat: () => ({ getHistory: () => history }),
      })),
      getBaseLlmClient: vi.fn(() => ({ generateText })),
      getFastModel: vi.fn(() => 'fast-model'),
      getModel: vi.fn(() => 'main-model'),
      getOutputLanguageFilePath: vi.fn(() =>
        writeOutputLanguageFile('You MUST always respond in Chinese.'),
      ),
    } as unknown as Config;

    const result = await generateSessionRecap(
      config,
      new AbortController().signal,
    );

    expect(result).toBe('Auth test fix is in progress.');
    const callArg = generateText.mock.calls[0][0];
    expect(callArg.systemInstruction).toContain('You generate session recaps');
    expect(callArg.systemInstruction).toContain(
      'You MUST always respond in Chinese.',
    );
  });
});
