import { afterEach, describe, expect, it } from 'vitest';
import { createProxy, type ProxyConfig } from '../src/core/proxy.js';

const realFetch = globalThis.fetch;
const dec = new TextDecoder();
const BIG_CONTEXT = 'System instruction with lots of operational context. '.repeat(900);
const FORCE_TRANSFORM = { charsPerToken: 1, minCompressChars: 1 };

interface FetchCapture {
  calls: string[];
  bodies: string[];
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

function bodyText(init?: RequestInit): string {
  const body = init?.body;
  if (typeof body === 'string') return body;
  if (body instanceof Uint8Array) return dec.decode(body);
  return '';
}

function stubFetch(capture: FetchCapture) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    capture.calls.push(url);
    if (url.endsWith('/count_tokens')) {
      return new Response(JSON.stringify({ input_tokens: 1 }), {
        headers: { 'content-type': 'application/json' },
      });
    }
    capture.bodies.push(bodyText(init));
    if (url.includes('/responses')) {
      return new Response(
        JSON.stringify({
          id: 'resp_1',
          object: 'response',
          output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'ok' }] }],
          usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
        }),
        { headers: { 'content-type': 'application/json' } },
      );
    }
    if (url.includes('/chat/completions')) {
      return new Response(
        JSON.stringify({
          id: 'chatcmpl_1',
          object: 'chat.completion',
          choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        { headers: { 'content-type': 'application/json' } },
      );
    }
    return new Response(
      JSON.stringify({ id: 'ok', type: 'message', content: [], usage: { input_tokens: 1, output_tokens: 1 } }),
      { headers: { 'content-type': 'application/json' } },
    );
  }) as typeof fetch;
}

function sentJson(capture: FetchCapture): Record<string, unknown> {
  expect(capture.bodies).toHaveLength(1);
  return JSON.parse(capture.bodies[0]!) as Record<string, unknown>;
}

function hasImagePart(json: Record<string, unknown>, kind: 'anthropic' | 'openai-chat' | 'openai-responses'): boolean {
  const s = JSON.stringify(json);
  if (kind === 'anthropic') return s.includes('"type":"image"');
  if (kind === 'openai-chat') return s.includes('"type":"image_url"');
  return s.includes('"type":"input_image"');
}

describe('client compatibility smoke matrix', () => {
  it('serves /healthz locally without touching an upstream', async () => {
    const capture: FetchCapture = { calls: [], bodies: [] };
    stubFetch(capture);

    const res = await createProxy({ upstream: 'http://anthropic.test' })(
      new Request('http://localhost/healthz'),
    );

    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; version?: string; build_time?: string; auth?: string };
    // Backward-compat: the legacy `{ok:true}` minimal contract is still
    // present; D21 adds version / build_time / auth as additive fields so
    // operator scripts that only inspect `body.ok === true` keep working.
    expect(body.ok).toBe(true);
    expect(capture.calls).toEqual([]);
  });

  it.each([
    {
      name: 'Claude Code Anthropic',
      config: { upstream: 'http://anthropic.test' },
      url: 'http://localhost/v1/messages',
      headers: { 'content-type': 'application/json', 'x-api-key': 'fake-anthropic-key' },
      body: { model: 'claude-sonnet-4-6', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] },
      upstream: 'http://anthropic.test/v1/messages',
    },
    {
      name: 'OpenCode Anthropic provider prefix',
      config: { upstream: 'http://ocproxy.test' },
      url: 'http://localhost/anthropic/messages',
      headers: { 'content-type': 'application/json', 'x-api-key': 'fake-anthropic-key' },
      body: { model: 'claude-sonnet-4-6', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] },
      upstream: 'http://ocproxy.test/anthropic/messages',
    },
    {
      name: 'Codex OpenAI-compatible Responses',
      config: { openAIUpstream: 'http://openai.test', openAIApiKey: 'fake-openai-key' },
      url: 'http://localhost/responses',
      headers: { 'content-type': 'application/json' },
      body: { model: 'gpt-4o', input: 'hi' },
      upstream: 'http://openai.test/v1/responses',
    },
    {
      name: 'OpenCode OpenAI provider prefix',
      config: { upstream: 'http://ocproxy.test', openAIUpstream: 'http://openai.test' },
      url: 'http://localhost/openai/chat/completions',
      headers: { 'content-type': 'application/json', authorization: 'Bearer fake-local-token' },
      body: { model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] },
      upstream: 'http://ocproxy.test/openai/chat/completions',
    },
    {
      name: 'Cloudflare AI Gateway OpenAI root alias',
      config: {
        provider: 'cloudflare-ai-gateway',
        gatewayBaseUrl: 'https://gateway.example.test/v1/acct/gw',
      },
      url: 'http://localhost/chat/completions',
      headers: { 'content-type': 'application/json', authorization: 'Bearer fake-openai-key' },
      body: { model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] },
      upstream: 'https://gateway.example.test/v1/acct/gw/openai/chat/completions',
    },
  ] satisfies Array<{
    name: string;
    config: ProxyConfig;
    url: string;
    headers: Record<string, string>;
    body: Record<string, unknown>;
    upstream: string;
  }>)('$name routes to the expected upstream', async ({ config, url, headers, body, upstream }) => {
    const capture: FetchCapture = { calls: [], bodies: [] };
    stubFetch(capture);

    const res = await createProxy(config)(
      new Request(url, {
        method: 'POST',
        headers: Object.fromEntries(Object.entries(headers).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        )),
        body: JSON.stringify(body),
      }),
    );
    await res.text();

    expect(capture.calls).toContain(upstream);
  });

  it.each([
    {
      name: 'Claude root strong model',
      config: { upstream: 'http://anthropic.test', transform: FORCE_TRANSFORM },
      url: 'http://localhost/v1/messages',
      headers: { 'content-type': 'application/json', 'x-api-key': 'fake-anthropic-key' },
      body: { model: 'claude-fable-5', max_tokens: 1, system: BIG_CONTEXT, messages: [{ role: 'user', content: 'hi' }] },
      upstream: 'http://anthropic.test/v1/messages',
      kind: 'anthropic' as const,
      expectImage: true,
    },
    {
      name: 'OpenCode Anthropic unknown model',
      config: { upstream: 'http://ocproxy.test', transform: FORCE_TRANSFORM },
      url: 'http://localhost/anthropic/messages',
      headers: { 'content-type': 'application/json', 'x-api-key': 'fake-anthropic-key' },
      body: { model: 'claude-sonnet-4-7', max_tokens: 1, system: BIG_CONTEXT, messages: [{ role: 'user', content: 'hi' }] },
      upstream: 'http://ocproxy.test/anthropic/messages',
      kind: 'anthropic' as const,
      expectImage: false,
    },
    {
      name: 'Codex OpenAI Responses strong GPT',
      config: { openAIUpstream: 'http://openai.test', openAIApiKey: 'fake-openai-key', transform: FORCE_TRANSFORM },
      url: 'http://localhost/v1/responses',
      headers: { 'content-type': 'application/json' },
      body: { model: 'gpt-5.6', instructions: BIG_CONTEXT, input: [{ role: 'user', content: 'hi' }] },
      upstream: 'http://openai.test/v1/responses',
      kind: 'openai-responses' as const,
      expectImage: true,
    },
    {
      name: 'Codex OpenAI Responses unvalidated Sol profile',
      config: { openAIUpstream: 'http://openai.test', openAIApiKey: 'fake-openai-key', transform: FORCE_TRANSFORM },
      url: 'http://localhost/v1/responses',
      headers: { 'content-type': 'application/json' },
      body: { model: 'gpt-5.6-sol', instructions: BIG_CONTEXT, input: [{ role: 'user', content: 'hi' }] },
      upstream: 'http://openai.test/v1/responses',
      kind: 'openai-responses' as const,
      expectImage: false,
    },
    {
      name: 'OpenCode OpenAI weak GPT',
      config: { upstream: 'http://ocproxy.test', openAIUpstream: 'http://openai.test', transform: FORCE_TRANSFORM },
      url: 'http://localhost/openai/chat/completions',
      headers: { 'content-type': 'application/json', authorization: 'Bearer fake-local-token' },
      body: { model: 'gpt-5.5', messages: [{ role: 'system', content: BIG_CONTEXT }, { role: 'user', content: 'hi' }] },
      upstream: 'http://ocproxy.test/openai/chat/completions',
      kind: 'openai-chat' as const,
      expectImage: false,
    },
    {
      name: 'Cloudflare gateway OpenAI strong GPT',
      config: {
        provider: 'cloudflare-ai-gateway',
        gatewayBaseUrl: 'https://gateway.example.test/v1/acct/gw',
        transform: FORCE_TRANSFORM,
      },
      url: 'http://localhost/chat/completions',
      headers: { 'content-type': 'application/json', authorization: 'Bearer fake-openai-key' },
      body: { model: 'gpt-5.6', messages: [{ role: 'system', content: BIG_CONTEXT }, { role: 'user', content: 'hi' }] },
      upstream: 'https://gateway.example.test/v1/acct/gw/openai/chat/completions',
      kind: 'openai-chat' as const,
      expectImage: true,
    },
  ] satisfies Array<{
    name: string;
    config: ProxyConfig;
    url: string;
    headers: Record<string, string>;
    body: Record<string, unknown>;
    upstream: string;
    kind: 'anthropic' | 'openai-chat' | 'openai-responses';
    expectImage: boolean;
  }>)('$name routes with the expected image/pass-through decision', async ({ config, url, headers, body, upstream, kind, expectImage }) => {
    const prevModels = process.env.IMGTOKENX_MODELS;
    process.env.IMGTOKENX_MODELS = String(body.model);
    const capture: FetchCapture = { calls: [], bodies: [] };
    stubFetch(capture);
    try {
      const res = await createProxy(config)(
        new Request(url, {
          method: 'POST',
          headers: Object.fromEntries(Object.entries(headers).filter(
            (entry): entry is [string, string] => typeof entry[1] === 'string',
          )),
          body: JSON.stringify(body),
        }),
      );
      await res.text();

      const sent = sentJson(capture);
      expect(capture.calls).toContain(upstream);
      expect(hasImagePart(sent, kind)).toBe(expectImage);
      expect(JSON.stringify(sent).includes(BIG_CONTEXT.slice(0, 80))).toBe(!expectImage);
    } finally {
      if (prevModels === undefined) delete process.env.IMGTOKENX_MODELS;
      else process.env.IMGTOKENX_MODELS = prevModels;
    }
  });
});
