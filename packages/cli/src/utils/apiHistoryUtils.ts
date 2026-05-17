/**
 * @license
 * Copyright 2025 Qwen Code
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Content } from '@google/genai';
import {
  COMPRESSION_CONTINUATION_BRIDGE,
  COMPRESSION_SUMMARY_MODEL_ACK,
  STARTUP_CONTEXT_MODEL_ACK,
} from '@qwen-code/qwen-code-core';

export function hasTextPart(
  content: Content | undefined,
  text: string,
): boolean {
  return (
    content?.parts?.some((part) => 'text' in part && part.text === text) ??
    false
  );
}

export function hasModelTextPart(
  content: Content | undefined,
  text: string,
): boolean {
  return content?.role === 'model' && hasTextPart(content, text);
}

/**
 * Checks if a Content entry is a user-initiated text prompt
 * as opposed to a tool result (functionResponse).
 */
export function isApiUserTextContent(content: Content): boolean {
  if (content.role !== 'user') return false;
  if (!content.parts || content.parts.length === 0) return false;

  const hasFunctionResponse = content.parts.some(
    (part) => 'functionResponse' in part,
  );
  if (hasFunctionResponse) return false;

  return content.parts.some((part) => 'text' in part && part.text);
}

export function hasCompressionSummaryPair(
  apiHistory: Content[],
  startIndex: number,
): boolean {
  const summary = apiHistory[startIndex];
  return (
    !!summary &&
    isApiUserTextContent(summary) &&
    hasModelTextPart(apiHistory[startIndex + 1], COMPRESSION_SUMMARY_MODEL_ACK)
  );
}

export function getApiUserTextIndices(
  apiHistory: Content[],
  startIndex: number,
  skipContinuationBridge: boolean,
): number[] {
  const indices: number[] = [];

  for (let i = startIndex; i < apiHistory.length; i++) {
    const content = apiHistory[i]!;
    if (!isApiUserTextContent(content)) continue;
    if (
      skipContinuationBridge &&
      hasTextPart(content, COMPRESSION_CONTINUATION_BRIDGE)
    ) {
      continue;
    }
    indices.push(i);
  }

  return indices;
}

/**
 * Detects whether the API history starts with the startup context pair
 * (user env context + model acknowledgment).
 */
export function hasStartupContext(apiHistory: Content[]): boolean {
  if (apiHistory.length < 2) return false;
  const first = apiHistory[0];
  const second = apiHistory[1];
  if (first?.role !== 'user' || second?.role !== 'model') return false;
  return hasTextPart(second, STARTUP_CONTEXT_MODEL_ACK);
}
