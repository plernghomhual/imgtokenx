import { afterEach, describe, expect, it } from 'vitest';
import { createProxy, type ProxyConfig } from '../src/core/proxy.js';

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubFetch(calls: string[]) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith('/count_tokens')) {
      return new Response(JSON.stringify({ input_tokens: 1 }), {
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(
      JSON.stringify({ id: 'ok', type: 'message', content: [], usage: { input_tokens: 1, output_tokens: 1 } }),
      { headers: { 'content-type': 'application/json' } },
    );
  }) as typeof fetch;
}

describe('client compatibility smoke matrix', () => {
  it('serves /healthz locally without touching an upstream', async () => {
    const calls: string[] = [];
    stubFetch(calls);

    const res = await createProxy({ upstream: 'http://anthropic.test' })(
      new Request('http://localhost/healthz'),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(calls).toEqual([]);
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
    const calls: string[] = [];
    stubFetch(calls);

    const res = await createProxy(config)(
      new Request(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      }),
    );
    await res.text();

    expect(calls).toContain(upstream);
  });
});
