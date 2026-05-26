/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { WebFetchTool } from './web-fetch.js';
import type { Config } from '../config/config.js';
import { ApprovalMode } from '../config/config.js';
import { ToolConfirmationOutcome } from './tools.js';
import { ToolErrorType } from './tool-error.js';
import * as fetchUtils from '../utils/fetch.js';

// Mocks the underlying call BaseLlmClient.generateText makes; web-fetch's
// `runSideQuery` text-mode path lands on this mock.
const mockGenerateContent = vi.fn();
const mockGetBaseLlmClient = vi.fn(() => ({
  generateText: mockGenerateContent,
}));

vi.mock('../utils/fetch.js', async (importOriginal) => {
  const actual = await importOriginal<typeof fetchUtils>();
  return {
    ...actual,
    fetchWithTimeout: vi.fn(),
    isPrivateIp: vi.fn(),
  };
});

describe('WebFetchTool', () => {
  let mockConfig: Config;

  beforeEach(() => {
    vi.resetAllMocks();
    mockConfig = {
      getApprovalMode: vi.fn(),
      setApprovalMode: vi.fn(),
      getProxy: vi.fn(),
      getBaseLlmClient: mockGetBaseLlmClient,
      getFastModel: vi.fn(() => undefined),
      getSessionId: vi.fn(() => 'test-session-id'),
      getModel: vi.fn(() => 'qwen-coder'),
      getOutputLanguageFilePath: vi.fn(() => undefined),
    } as unknown as Config;
  });

  describe('execute', () => {
    it('should throw validation error when url parameter is missing', async () => {
      const tool = new WebFetchTool(mockConfig);
      const params = { prompt: 'no url here' };
      /* @ts-expect-error - we are testing validation */
      expect(() => tool.build(params)).toThrow(
        "params must have required property 'url'",
      );
    });

    it('should return WEB_FETCH_FALLBACK_FAILED on fetch failure', async () => {
      vi.spyOn(fetchUtils, 'isPrivateIp').mockReturnValue(true);
      vi.spyOn(fetchUtils, 'fetchWithTimeout').mockRejectedValue(
        new Error('fetch failed'),
      );
      const tool = new WebFetchTool(mockConfig);
      const params = { url: 'https://private.ip', prompt: 'summarize this' };
      const invocation = tool.build(params);
      const result = await invocation.execute(new AbortController().signal);
      expect(result.error?.type).toBe(ToolErrorType.WEB_FETCH_FALLBACK_FAILED);
    });

    it('should return WEB_FETCH_FALLBACK_FAILED on API processing failure', async () => {
      vi.spyOn(fetchUtils, 'isPrivateIp').mockReturnValue(false);
      vi.spyOn(fetchUtils, 'fetchWithTimeout').mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'text/html' }),
        text: () => Promise.resolve('<html><body>Test content</body></html>'),
      } as Response);
      mockGenerateContent.mockRejectedValue(new Error('API error'));
      const tool = new WebFetchTool(mockConfig);
      const params = { url: 'https://public.ip', prompt: 'summarize this' };
      const invocation = tool.build(params);
      const result = await invocation.execute(new AbortController().signal);
      expect(result.error?.type).toBe(ToolErrorType.WEB_FETCH_FALLBACK_FAILED);
    });
  });

  describe('format parameter', () => {
    it('should default to auto format when not specified', async () => {
      const fetchSpy = vi
        .spyOn(fetchUtils, 'fetchWithTimeout')
        .mockResolvedValue({
          ok: true,
          headers: new Headers({ 'content-type': 'text/html' }),
          text: () => Promise.resolve('<html><body>Test content</body></html>'),
        } as Response);

      mockGenerateContent.mockResolvedValue({
        response: { text: () => 'Summary' },
      });

      const tool = new WebFetchTool(mockConfig);
      const params = { url: 'https://example.com', prompt: 'summarize' };
      const invocation = tool.build(params);
      await invocation.execute(new AbortController().signal);

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://example.com',
        expect.any(Number),
        { Accept: 'text/markdown, text/html, text/plain' },
      );
    });

    it('should request only markdown when format is markdown', async () => {
      const fetchSpy = vi
        .spyOn(fetchUtils, 'fetchWithTimeout')
        .mockResolvedValue({
          ok: true,
          headers: new Headers({ 'content-type': 'text/markdown' }),
          text: () => Promise.resolve('# Test Content'),
        } as Response);

      mockGenerateContent.mockResolvedValue({
        response: { text: () => 'Summary' },
      });

      const tool = new WebFetchTool(mockConfig);
      const params = {
        url: 'https://example.com',
        prompt: 'summarize',
        format: 'markdown' as const,
      };
      const invocation = tool.build(params);
      await invocation.execute(new AbortController().signal);

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://example.com',
        expect.any(Number),
        { Accept: 'text/markdown' },
      );
    });

    it('should request only HTML when format is html', async () => {
      const fetchSpy = vi
        .spyOn(fetchUtils, 'fetchWithTimeout')
        .mockResolvedValue({
          ok: true,
          headers: new Headers({ 'content-type': 'text/html' }),
          text: () => Promise.resolve('<html><body>Test content</body></html>'),
        } as Response);

      mockGenerateContent.mockResolvedValue({
        response: { text: () => 'Summary' },
      });

      const tool = new WebFetchTool(mockConfig);
      const params = {
        url: 'https://example.com',
        prompt: 'summarize',
        format: 'html' as const,
      };
      const invocation = tool.build(params);
      await invocation.execute(new AbortController().signal);

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://example.com',
        expect.any(Number),
        { Accept: 'text/html' },
      );
    });

    it('should request plain text when format is text', async () => {
      const fetchSpy = vi
        .spyOn(fetchUtils, 'fetchWithTimeout')
        .mockResolvedValue({
          ok: true,
          headers: new Headers({ 'content-type': 'text/plain' }),
          text: () => Promise.resolve('Plain text content'),
        } as Response);

      mockGenerateContent.mockResolvedValue({
        response: { text: () => 'Summary' },
      });

      const tool = new WebFetchTool(mockConfig);
      const params = {
        url: 'https://example.com',
        prompt: 'summarize',
        format: 'text' as const,
      };
      const invocation = tool.build(params);
      await invocation.execute(new AbortController().signal);

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://example.com',
        expect.any(Number),
        { Accept: 'text/plain' },
      );
    });

    it('should include markdown content in prompt when server returns markdown', async () => {
      let receivedContent = '';
      vi.spyOn(fetchUtils, 'fetchWithTimeout').mockResolvedValue({
        ok: true,
        headers: new Headers({
          'content-type': 'text/markdown; charset=utf-8',
        }),
        text: () =>
          Promise.resolve('# Hello World\n\nThis is markdown content.'),
      } as Response);

      mockGenerateContent.mockImplementation((options) => {
        receivedContent = options.contents[0].parts[0].text;
        return Promise.resolve({ text: 'Processed', usage: undefined });
      });

      const tool = new WebFetchTool(mockConfig);
      const params = { url: 'https://example.com', prompt: 'summarize' };
      const invocation = tool.build(params);
      await invocation.execute(new AbortController().signal);

      expect(receivedContent).toContain('# Hello World');
    });

    it('should include plain text content in prompt when server returns plain text', async () => {
      let receivedContent = '';
      vi.spyOn(fetchUtils, 'fetchWithTimeout').mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'text/plain' }),
        text: () => Promise.resolve('Plain text content here'),
      } as Response);

      mockGenerateContent.mockImplementation((options) => {
        receivedContent = options.contents[0].parts[0].text;
        return Promise.resolve({ text: 'Processed', usage: undefined });
      });

      const tool = new WebFetchTool(mockConfig);
      const params = {
        url: 'https://example.com',
        prompt: 'summarize',
        format: 'text' as const,
      };
      const invocation = tool.build(params);
      await invocation.execute(new AbortController().signal);

      expect(receivedContent).toContain('Plain text content here');
    });

    it('should include configured output language preference when processing web content', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qwen-web-fetch-'));
      const outputLanguageFile = path.join(dir, 'output-language.md');
      fs.writeFileSync(
        outputLanguageFile,
        'You MUST always respond in Chinese.',
        'utf8',
      );
      vi.mocked(mockConfig.getOutputLanguageFilePath).mockReturnValue(
        outputLanguageFile,
      );
      vi.spyOn(fetchUtils, 'fetchWithTimeout').mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'text/plain' }),
        text: () => Promise.resolve('Plain text content here'),
      } as Response);
      mockGenerateContent.mockResolvedValue({
        text: 'Processed',
        usage: undefined,
      });

      const tool = new WebFetchTool(mockConfig);
      const params = {
        url: 'https://example.com',
        prompt: 'summarize',
        format: 'text' as const,
      };
      const invocation = tool.build(params);
      await invocation.execute(new AbortController().signal);

      const callArg = mockGenerateContent.mock.calls[0]?.[0];
      expect(callArg.systemInstruction).toContain(
        'Extract and summarize the requested information',
      );
      expect(callArg.systemInstruction).toContain(
        'You MUST always respond in Chinese.',
      );
    });
  });

  describe('getConfirmationDetails', () => {
    it('should return confirmation details with the correct prompt and urls', async () => {
      const tool = new WebFetchTool(mockConfig);
      const params = {
        url: 'https://example.com',
        prompt: 'summarize this page',
      };
      const invocation = tool.build(params);
      expect(await invocation.getDefaultPermission()).toBe('ask');

      const confirmationDetails = await invocation.getConfirmationDetails(
        new AbortController().signal,
      );

      expect(confirmationDetails).toEqual({
        type: 'info',
        title: 'Confirm Web Fetch',
        prompt:
          'Fetch content from https://example.com and process with: summarize this page',
        urls: ['https://example.com'],
        permissionRules: ['WebFetch(example.com)'],
        onConfirm: expect.any(Function),
      });
    });

    it('should return github urls as-is in confirmation details', async () => {
      const tool = new WebFetchTool(mockConfig);
      const params = {
        url: 'https://github.com/google/gemini-react/blob/main/README.md',
        prompt: 'summarize the README',
      };
      const invocation = tool.build(params);
      expect(await invocation.getDefaultPermission()).toBe('ask');

      const confirmationDetails = await invocation.getConfirmationDetails(
        new AbortController().signal,
      );

      expect(confirmationDetails).toEqual({
        type: 'info',
        title: 'Confirm Web Fetch',
        prompt:
          'Fetch content from https://github.com/google/gemini-react/blob/main/README.md and process with: summarize the README',
        urls: ['https://github.com/google/gemini-react/blob/main/README.md'],
        permissionRules: ['WebFetch(github.com)'],
        onConfirm: expect.any(Function),
      });
    });

    it('should return ask even if approval mode is AUTO_EDIT (approval mode handled by scheduler)', async () => {
      const tool = new WebFetchTool({
        ...mockConfig,
        getApprovalMode: () => ApprovalMode.AUTO_EDIT,
      } as unknown as Config);
      const params = {
        url: 'https://example.com',
        prompt: 'summarize this page',
      };
      const invocation = tool.build(params);
      expect(await invocation.getDefaultPermission()).toBe('ask');

      const confirmationDetails = await invocation.getConfirmationDetails(
        new AbortController().signal,
      );

      expect(confirmationDetails).toEqual({
        type: 'info',
        title: 'Confirm Web Fetch',
        prompt:
          'Fetch content from https://example.com and process with: summarize this page',
        urls: ['https://example.com'],
        permissionRules: ['WebFetch(example.com)'],
        onConfirm: expect.any(Function),
      });
    });

    it('should have onConfirm as a no-op (approval mode handled by scheduler)', async () => {
      const setApprovalMode = vi.fn();
      const testConfig = {
        ...mockConfig,
        setApprovalMode,
      } as unknown as Config;
      const tool = new WebFetchTool(testConfig);
      const params = {
        url: 'https://example.com',
        prompt: 'summarize this page',
      };
      const invocation = tool.build(params);
      const confirmationDetails = await invocation.getConfirmationDetails(
        new AbortController().signal,
      );

      if (
        confirmationDetails &&
        typeof confirmationDetails === 'object' &&
        'onConfirm' in confirmationDetails
      ) {
        await confirmationDetails.onConfirm(
          ToolConfirmationOutcome.ProceedAlways,
        );
      }

      // setApprovalMode should NOT be called — onConfirm is a no-op
      expect(setApprovalMode).not.toHaveBeenCalled();
    });
  });
});
