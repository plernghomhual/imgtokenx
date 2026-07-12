import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProxy } from '../src/core/proxy.js';
import type { ProxyEvent } from '../src/core/proxy.js';

afterEach(() => vi.unstubAllGlobals());

describe('virtual context through the proxy', () => {
  it('virtualizes an unsupported Zen model as text without attempting image compression', async () => {
    const output = 'large exact tool output\n'.repeat(500);
    let forwarded: Record<string, unknown> | undefined;
    let forwardedAuth: string | null = null;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const raw = init?.body;
      const text = typeof raw === 'string'
        ? raw
        : raw instanceof Uint8Array
          ? new TextDecoder().decode(raw)
          : input instanceof Request ? await input.clone().text() : '';
      forwarded = JSON.parse(text) as Record<string, unknown>;
      forwardedAuth = new Headers(init?.headers).get('authorization');
      return new Response(JSON.stringify({
        choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 20, completion_tokens: 2 },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }));
    let event: ProxyEvent | undefined;
    const proxy = createProxy({
      openCodeUpstream: 'https://zen.example.test',
      transform: { compress: true, virtualContext: 'lazy' },
      virtualArtifactStore: {
        async put(text) {
          expect(text).toBe(output);
          return { id: 'sha256_' + 'a'.repeat(64) };
        },
        async has(id) {
          return id === 'sha256_' + 'a'.repeat(64);
        },
      },
      onRequest(value) { event = value; },
    });
    const response = await proxy(new Request('http://localhost/opencode/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer zen-placeholder',
      },
      body: JSON.stringify({
        model: 'text-only-uncalibrated',
        messages: [{ role: 'tool', tool_call_id: 'call_1', content: output }],
      }),
    }));
    await response.text();
    await vi.waitFor(() => expect(event).toBeDefined());

    const messages = forwarded?.messages as Array<{ content: string }>;
    expect(messages[0]!.content).toContain('sha256_' + 'a'.repeat(64));
    expect(messages[0]!.content.length).toBeLessThan(output.length);
    expect(forwardedAuth).toBe('Bearer zen-placeholder');
    expect(event?.info?.compressed).toBe(true);
    expect(event?.info?.imageCount).toBe(0);
    expect(event?.info?.virtualContextMode).toBe('lazy');
    expect(event?.info?.virtualizedCharsRemoved).toBeGreaterThan(0);
  });

  it('keeps artifact handles and surrounding history native on an image-capable model', async () => {
    const previousModels = process.env.IMGTOKENX_MODELS;
    process.env.IMGTOKENX_MODELS = 'gpt-5.6';
    const output = 'large exact tool output\n'.repeat(500);
    let forwarded: Record<string, unknown> | undefined;
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      forwarded = JSON.parse(new TextDecoder().decode(init?.body as Uint8Array)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 20, completion_tokens: 2 },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }));
    try {
      const proxy = createProxy({
        transform: {
          compress: true,
          virtualContext: 'lazy',
          gptHistory: {
            keepTail: 1,
            minCollapsePrefix: 1,
            minCollapseTokens: 1,
            collapseChunk: 0,
            freezeChunk: 0,
            sectionTokens: 1,
          },
        },
        virtualArtifactStore: {
          async put() { return { id: 'sha256_' + 'a'.repeat(64) }; },
          async has() { return true; },
        },
      });
      const oldHistory = Array.from({ length: 12 }, (_, index) => [
        { role: 'user', content: `OLD-${index}-` + 'x'.repeat(1_000) },
        { role: 'assistant', content: `answer-${index}-` + 'y'.repeat(1_000) },
      ]).flat();
      const response = await proxy(new Request('http://localhost/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer test' },
        body: JSON.stringify({
          model: 'gpt-5.6',
          messages: [
            ...oldHistory,
            { role: 'assistant', tool_calls: [{ id: 'call_1', type: 'function' }] },
            { role: 'tool', tool_call_id: 'call_1', content: output },
            { role: 'user', content: 'live tail' },
          ],
        }),
      }));
      await response.text();

      const serialized = JSON.stringify(forwarded);
      expect(serialized).toContain('OLD-0-');
      expect(serialized).toContain('sha256_' + 'a'.repeat(64));
      expect(serialized).not.toContain('image_url');
    } finally {
      if (previousModels === undefined) delete process.env.IMGTOKENX_MODELS;
      else process.env.IMGTOKENX_MODELS = previousModels;
    }
  });

  it('keeps a checkpoint and all post-checkpoint history native', async () => {
    const previousModels = process.env.IMGTOKENX_MODELS;
    process.env.IMGTOKENX_MODELS = 'gpt-5.6';
    const checkpointHandle = 'sha256_' + 'c'.repeat(64);
    const checkpoint = JSON.stringify({ version: 1, goal: 'Preserve verified state.' });
    let forwarded: Record<string, unknown> | undefined;
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      forwarded = JSON.parse(new TextDecoder().decode(init?.body as Uint8Array)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 20, completion_tokens: 2 },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }));
    let event: ProxyEvent | undefined;
    try {
      const proxy = createProxy({
        transform: {
          compress: true,
          virtualContext: 'state',
          gptHistory: {
            keepTail: 1,
            minCollapsePrefix: 1,
            minCollapseTokens: 1,
            collapseChunk: 0,
            freezeChunk: 0,
            sectionTokens: 1,
          },
        },
        virtualArtifactStore: {
          async put() { return { id: 'sha256_' + 'a'.repeat(64) }; },
          async has(id) { return id === checkpointHandle; },
          async readCheckpoint(id) { return id === checkpointHandle ? checkpoint : undefined; },
        },
        onRequest(value) { event = value; },
      });
      const postCheckpoint = Array.from({ length: 12 }, (_, index) => [
        { role: 'user', content: `POST-${index}-` + 'x'.repeat(1_000) },
        { role: 'assistant', content: `post-answer-${index}-` + 'y'.repeat(1_000) },
      ]).flat();
      const response = await proxy(new Request('http://localhost/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer test' },
        body: JSON.stringify({
          model: 'gpt-5.6',
          messages: [
            { role: 'system', content: 'Keep authority.' },
            { role: 'user', content: 'OLD-PREFIX'.repeat(2_000) },
            { role: 'assistant', content: 'old answer' },
            {
              role: 'assistant',
              tool_calls: [{
                id: 'checkpoint_call',
                function: {
                  name: 'imgtokenx_context',
                  arguments: JSON.stringify({ action: 'checkpoint_store', text: checkpoint }),
                },
              }],
            },
            {
              role: 'tool',
              tool_call_id: 'checkpoint_call',
              content: `imgtokenx_checkpoint:${checkpointHandle}`,
            },
            ...postCheckpoint,
            { role: 'user', content: 'live tail' },
          ],
        }),
      }));
      await response.text();
      await vi.waitFor(() => expect(event).toBeDefined());

      const serialized = JSON.stringify(forwarded);
      expect(serialized).not.toContain('OLD-PREFIX');
      expect(serialized).toContain('POST-0-');
      expect(serialized).toContain(checkpointHandle);
      expect(serialized).not.toContain('image_url');
      expect(event?.info?.checkpointApplied).toBe(true);
      expect(event?.info?.stateCharsRemoved).toBeGreaterThan(0);
      expect(event?.info?.compressed).toBe(true);
    } finally {
      if (previousModels === undefined) delete process.env.IMGTOKENX_MODELS;
      else process.env.IMGTOKENX_MODELS = previousModels;
    }
  });
});
