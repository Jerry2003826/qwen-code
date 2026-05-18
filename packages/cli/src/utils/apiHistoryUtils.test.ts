/**
 * @license
 * Copyright 2025 Qwen Code
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import type { Content, Part } from '@google/genai';
import {
  COMPRESSION_CONTINUATION_BRIDGE,
  COMPRESSION_CONTINUATION_BRIDGE_MARKER,
  COMPRESSION_SUMMARY_MODEL_ACK,
  STARTUP_CONTEXT_MODEL_ACK,
} from '@qwen-code/qwen-code-core';
import {
  hasTextPart,
  hasModelTextPart,
  isApiUserTextContent,
  hasCompressionSummaryPair,
  getApiUserTextIndices,
  hasStartupContext,
  isCompressionContinuationBridge,
} from './apiHistoryUtils.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function userTextContent(text: string): Content {
  return { role: 'user', parts: [{ text } as Part] };
}

function modelTextContent(text: string): Content {
  return { role: 'model', parts: [{ text } as Part] };
}

function functionResponseContent(): Content {
  return {
    role: 'user',
    parts: [
      {
        functionResponse: { name: 'tool', response: { result: 'ok' } },
      } as unknown as Part,
    ],
  };
}

function functionCallContent(): Content {
  return {
    role: 'model',
    parts: [{ functionCall: { name: 'tool', args: {} } } as unknown as Part],
  };
}

// ---------------------------------------------------------------------------
// hasTextPart
// ---------------------------------------------------------------------------

describe('hasTextPart', () => {
  it('returns true when content has a text part matching exactly', () => {
    expect(hasTextPart(userTextContent('hello'), 'hello')).toBe(true);
  });

  it('returns false when text does not match', () => {
    expect(hasTextPart(userTextContent('hello'), 'world')).toBe(false);
  });

  it('returns false for undefined content', () => {
    expect(hasTextPart(undefined, 'hello')).toBe(false);
  });

  it('returns false when parts is undefined', () => {
    expect(hasTextPart({ role: 'user' }, 'hello')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// hasModelTextPart
// ---------------------------------------------------------------------------

describe('hasModelTextPart', () => {
  it('returns true when model content has matching text', () => {
    expect(hasModelTextPart(modelTextContent('ack'), 'ack')).toBe(true);
  });

  it('returns false when role is not model', () => {
    expect(hasModelTextPart(userTextContent('ack'), 'ack')).toBe(false);
  });

  it('returns false when text does not match', () => {
    expect(hasModelTextPart(modelTextContent('ack'), 'other')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isApiUserTextContent
// ---------------------------------------------------------------------------

describe('isApiUserTextContent', () => {
  it('returns true for user text content', () => {
    expect(isApiUserTextContent(userTextContent('hello'))).toBe(true);
  });

  it('returns false for model content', () => {
    expect(isApiUserTextContent(modelTextContent('hello'))).toBe(false);
  });

  it('returns false for functionResponse content', () => {
    expect(isApiUserTextContent(functionResponseContent())).toBe(false);
  });

  it('returns false for empty parts', () => {
    expect(isApiUserTextContent({ role: 'user', parts: [] })).toBe(false);
  });

  it('returns false for undefined parts', () => {
    expect(isApiUserTextContent({ role: 'user' })).toBe(false);
  });

  it('returns false for functionCall content (model role)', () => {
    expect(isApiUserTextContent(functionCallContent())).toBe(false);
  });

  it('rejects user content with no text (only functionResponse)', () => {
    const content: Content = {
      role: 'user',
      parts: [
        { functionResponse: { name: 't', response: {} } } as unknown as Part,
        { text: 'some text' } as Part,
      ],
    };
    expect(isApiUserTextContent(content)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// hasCompressionSummaryPair
// ---------------------------------------------------------------------------

describe('hasCompressionSummaryPair', () => {
  it('detects a compression summary pair', () => {
    const history: Content[] = [
      userTextContent('summary text'),
      modelTextContent(COMPRESSION_SUMMARY_MODEL_ACK),
    ];
    expect(hasCompressionSummaryPair(history, 0)).toBe(true);
  });

  it('returns false when the ack text does not match', () => {
    const history: Content[] = [
      userTextContent('summary text'),
      modelTextContent('different ack'),
    ];
    expect(hasCompressionSummaryPair(history, 0)).toBe(false);
  });

  it('returns false when startIndex is out of bounds', () => {
    const history: Content[] = [userTextContent('only one')];
    expect(hasCompressionSummaryPair(history, 1)).toBe(false);
  });

  it('respects startIndex offset', () => {
    const history: Content[] = [
      userTextContent('env context'),
      modelTextContent(STARTUP_CONTEXT_MODEL_ACK),
      userTextContent('summary'),
      modelTextContent(COMPRESSION_SUMMARY_MODEL_ACK),
    ];
    expect(hasCompressionSummaryPair(history, 0)).toBe(false);
    expect(hasCompressionSummaryPair(history, 2)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getApiUserTextIndices
// ---------------------------------------------------------------------------

describe('getApiUserTextIndices', () => {
  it('returns indices of all user text entries from startIndex', () => {
    const history: Content[] = [
      userTextContent('first'),
      modelTextContent('ack'),
      userTextContent('second'),
      modelTextContent('resp'),
      userTextContent('third'),
    ];
    expect(getApiUserTextIndices(history, 0, false)).toEqual([0, 2, 4]);
  });

  it('respects startIndex', () => {
    const history: Content[] = [
      userTextContent('first'),
      modelTextContent('ack'),
      userTextContent('second'),
      modelTextContent('resp'),
    ];
    expect(getApiUserTextIndices(history, 2, false)).toEqual([2]);
  });

  it('skips functionResponse entries', () => {
    const history: Content[] = [
      userTextContent('first'),
      modelTextContent('resp'),
      functionResponseContent(),
      modelTextContent('resp2'),
      userTextContent('second'),
    ];
    expect(getApiUserTextIndices(history, 0, false)).toEqual([0, 4]);
  });

  describe('skipContinuationBridge', () => {
    it('skips the compression continuation bridge', () => {
      const history: Content[] = [
        userTextContent('summary'),
        modelTextContent(COMPRESSION_SUMMARY_MODEL_ACK),
        userTextContent(COMPRESSION_CONTINUATION_BRIDGE),
        modelTextContent('continued'),
        userTextContent('tail turn'),
      ];
      const indices = getApiUserTextIndices(history, 0, true);
      expect(indices).toEqual([0, 4]);
    });

    it('includes the bridge when skipContinuationBridge is false', () => {
      const history: Content[] = [
        userTextContent('summary'),
        modelTextContent(COMPRESSION_SUMMARY_MODEL_ACK),
        userTextContent(COMPRESSION_CONTINUATION_BRIDGE),
        modelTextContent('continued'),
        userTextContent('tail turn'),
      ];
      const indices = getApiUserTextIndices(history, 0, false);
      expect(indices).toEqual([0, 2, 4]);
    });

    it('does not skip user prompts with same visible text but no sentinel', () => {
      const visibleText =
        'Continue with the prior task using the context above.';
      const history: Content[] = [
        userTextContent('summary'),
        modelTextContent(COMPRESSION_SUMMARY_MODEL_ACK),
        userTextContent(visibleText), // no invisible prefix
        userTextContent('tail turn'),
      ];
      const indices = getApiUserTextIndices(history, 0, true);
      // The visible text without sentinel is treated as a real user turn
      expect(indices).toEqual([0, 2, 3]);
    });
  });
});

// ---------------------------------------------------------------------------
// hasStartupContext
// ---------------------------------------------------------------------------

describe('hasStartupContext', () => {
  it('detects the startup context pair', () => {
    const history: Content[] = [
      userTextContent('Environment context...'),
      modelTextContent(STARTUP_CONTEXT_MODEL_ACK),
    ];
    expect(hasStartupContext(history)).toBe(true);
  });

  it('returns false for too-short history', () => {
    expect(hasStartupContext([userTextContent('only one')])).toBe(false);
    expect(hasStartupContext([])).toBe(false);
  });

  it('returns false when roles are wrong', () => {
    const history: Content[] = [
      modelTextContent('not user'),
      modelTextContent(STARTUP_CONTEXT_MODEL_ACK),
    ];
    expect(hasStartupContext(history)).toBe(false);
  });

  it('returns false when ack text does not match', () => {
    const history: Content[] = [
      userTextContent('Environment context...'),
      modelTextContent('different ack'),
    ];
    expect(hasStartupContext(history)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isCompressionContinuationBridge
// ---------------------------------------------------------------------------

describe('isCompressionContinuationBridge', () => {
  it('detects the synthetic bridge by sentinel marker prefix', () => {
    const bridge: Content = {
      role: 'user',
      parts: [{ text: COMPRESSION_CONTINUATION_BRIDGE } as Part],
    };
    expect(isCompressionContinuationBridge(bridge)).toBe(true);
  });

  it('returns false for a real user prompt with identical visible text', () => {
    const visibleText = 'Continue with the prior task using the context above.';
    const userPrompt: Content = {
      role: 'user',
      parts: [{ text: visibleText } as Part],
    };
    expect(isCompressionContinuationBridge(userPrompt)).toBe(false);
  });

  it('returns false for model role content', () => {
    const modelContent: Content = {
      role: 'model',
      parts: [{ text: COMPRESSION_CONTINUATION_BRIDGE } as Part],
    };
    expect(isCompressionContinuationBridge(modelContent)).toBe(false);
  });

  it('returns false for undefined content', () => {
    expect(isCompressionContinuationBridge(undefined)).toBe(false);
  });

  it('returns false when parts do not start with the sentinel', () => {
    const content: Content = {
      role: 'user',
      parts: [{ text: 'some other text' } as Part],
    };
    expect(isCompressionContinuationBridge(content)).toBe(false);
  });

  it('detects bridge even with additional content after the marker', () => {
    const bridgeWithExtra = `${COMPRESSION_CONTINUATION_BRIDGE_MARKER}Continue with the prior task using the context above.`;
    const content: Content = {
      role: 'user',
      parts: [{ text: bridgeWithExtra } as Part],
    };
    expect(isCompressionContinuationBridge(content)).toBe(true);
  });
});
