import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProxy, resolveUpstreams } from '../src/core/proxy.js';

const realFetch = globalThis.fetch;
const BIG_CONTEXT = 'Stable coding context that is safe to image. '.repeat(1200);
let priorModels: string | undefined;
let priorReaderProfiles: string | undefined;

interface CapturedRequest {
  url: string;
  headers: Headers;
  body: string;
}

afterEach(() => {
  globalThis.fetch = realFetch;
  if (priorModels === undefined) delete process.env.IMGTOKENX_MODELS;
  else process.env.IMGTOKENX_MODELS = priorModels;
  if (priorReaderProfiles === undefined) delete process.env.IMGTOKENX_READER_PROFILES;
  else process.env.IMGTOKENX_READER_PROFILES = priorReaderProfiles;
});

beforeEach(() => {
  priorModels = process.env.IMGTOKENX_MODELS;
  priorReaderProfiles = process.env.IMGTOKENX_READER_PROFILES;
  process.env.IMGTOKENX_MODELS = 'claude-fable-5,gpt-5.6-terra';
  process.env.IMGTOKENX_READER_PROFILES = '{"gpt-5.6-terra":{"safeToImage":true}}';
});

function stubZen(calls: CapturedRequest[]): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const raw = init?.body;
    const body = typeof raw === 'string'
      ? raw
      : raw instanceof Uint8Array
        ? new TextDecoder().decode(raw)
        : '';
    const url = String(input);
    calls.push({ url, headers, body });
    if (url.includes('/responses')) {
      return new Response(JSON.stringify({
        id: 'resp_zen',
        object: 'response',
        output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'ok' }] }],
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      }), { headers: { 'content-type': 'application/json' } });
    }
    if (url.includes('/chat/completions')) {
      return new Response(JSON.stringify({
        id: 'chat_zen',
        object: 'chat.completion',
        choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }), { headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({
      id: 'msg_zen',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 1, output_tokens: 1 },
    }), { headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

describe('OpenCode Zen upstream', () => {
  it('resolves the official default and a configured override', () => {
    expect(resolveUpstreams({}).opencode).toBe('https://opencode.ai/zen');
    expect(resolveUpstreams({ openCodeUpstream: 'https://zen.example.test/root/' }).opencode)
      .toBe('https://zen.example.test/root');
  });

  it.each([
    ['/opencode/chat/completions', '/v1/chat/completions'],
    ['/opencode/v1/responses', '/v1/responses'],
    ['/opencode/v1/chat/completions', '/v1/chat/completions'],
    ['/opencode/v1/messages', '/v1/messages'],
  ])('strips %s and forwards it only to Zen', async (localPath, upstreamPath) => {
    const calls: CapturedRequest[] = [];
    stubZen(calls);
    const raw = JSON.stringify({ model: 'unprofiled-zen-model', input: 'hi', messages: [] });
    const response = await createProxy({ openCodeUpstream: 'https://zen.example.test/root' })(
      new Request(`http://localhost${localPath}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer zen-user-token' },
        body: raw,
      }),
    );
    await response.text();

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`https://zen.example.test/root${upstreamPath}`);
    expect(calls[0]!.headers.get('authorization')).toBe('Bearer zen-user-token');
  });

  it('keeps unsupported Zen requests byte-identical and never leaks other-provider auth', async () => {
    const calls: CapturedRequest[] = [];
    stubZen(calls);
    const raw = '{\n  "model": "deepseek-v4-flash-free",\n  "messages": [{"role":"user","content":"hi"}]\n}\n';
    const response = await createProxy({
      provider: 'cloudflare-ai-gateway',
      gatewayBaseUrl: 'https://gateway.example.test/v1/acct/gw',
      gatewayHeaders: { 'cf-aig-authorization': 'Bearer gateway-secret' },
      upstream: 'https://anthropic.example.test',
      apiKey: 'anthropic-secret',
      openAIUpstream: 'https://openai.example.test',
      openAIApiKey: 'openai-secret',
    })(new Request('http://localhost/opencode/v1/messages?trace=1', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer zen-user-token',
        'x-api-key': 'zen-user-x-key',
      },
      body: raw,
    }));
    await response.text();

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://opencode.ai/zen/v1/messages?trace=1');
    expect(calls[0]!.body).toBe(raw);
    expect(calls[0]!.headers.get('authorization')).toBe('Bearer zen-user-token');
    expect(calls[0]!.headers.get('x-api-key')).toBe('zen-user-x-key');
    expect(calls[0]!.headers.has('cf-aig-authorization')).toBe(false);
  });

  it.each([
    {
      path: '/opencode/v1/responses',
      body: { model: 'gpt-5.6-terra', instructions: BIG_CONTEXT, input: [{ role: 'user', content: 'hi' }] },
      imageType: 'input_image',
    },
    {
      path: '/opencode/v1/chat/completions',
      body: { model: 'gpt-5.6-terra', messages: [{ role: 'system', content: BIG_CONTEXT }, { role: 'user', content: 'hi' }] },
      imageType: 'image_url',
    },
    {
      path: '/opencode/v1/messages',
      body: { model: 'claude-fable-5', max_tokens: 1, system: BIG_CONTEXT, messages: [{ role: 'user', content: 'hi' }] },
      imageType: 'image',
    },
  ])('uses the existing safe transformer for $path', async ({ path, body, imageType }) => {
    const calls: CapturedRequest[] = [];
    stubZen(calls);
    const response = await createProxy({
      transform: { charsPerToken: 1, minCompressChars: 1 },
    })(new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer zen-user-token' },
      body: JSON.stringify(body),
    }));
    await response.text();

    expect(calls).toHaveLength(1);
    expect(JSON.stringify(JSON.parse(calls[0]!.body))).toContain(`\"type\":\"${imageType}\"`);
  });
});
