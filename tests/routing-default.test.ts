/**
 * Regression guard: against the DEFAULT Anthropic/OpenAI upstreams, provider
 * routing prefixes (OpenCode's ANTHROPIC_BASE_URL=…/anthropic) must be stripped
 * so the path resolves on the real API, not 404. A custom (ocproxy-style)
 * upstream keeps the prefix verbatim — that path is covered by gateway.test.ts /
 * proxy-usage.test.ts. See audit finding D-MEDIUM (OpenCode /anthropic prefix).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createProxy, type ProxyEvent } from '../src/core/proxy.js';

/** Poll until the fire-and-forget proxy work lands instead of sleeping a
 *  fixed tick (flaked on slow CI). Times out loudly, never passes vacuously. */
async function settle(done: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!done()) {
    if (Date.now() - start > timeoutMs) throw new Error('proxy event did not settle in time');
    await new Promise((r) => setTimeout(r, 5));
  }
}

let ambient: string | undefined;
beforeAll(() => {
  ambient = process.env.IMGTOKENX_MODELS;
  process.env.IMGTOKENX_MODELS = 'claude-fable-5';
});
afterAll(() => {
  if (ambient === undefined) delete process.env.IMGTOKENX_MODELS;
  else process.env.IMGTOKENX_MODELS = ambient;
});

function mockUpstream() {
  const seen: string[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = ((req: Request | string | URL) => {
    const r = req instanceof Request ? req : new Request(String(req));
    seen.push(r.url);
    return Promise.resolve(
      new Response(
        JSON.stringify({
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'ok' }],
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
  }) as typeof fetch;
  return { seen, restore: () => { globalThis.fetch = real; } };
}

const BODY = JSON.stringify({
  model: 'claude-fable-5',
  messages: [{ role: 'user', content: 'hi' }],
  system: 'short',
});

describe('default-upstream provider-prefix strip', () => {
  it('strips /anthropic prefix → canonical Anthropic /v1/messages', async () => {
    const { seen, restore } = mockUpstream();
    let captured: ProxyEvent | undefined;
    const proxy = createProxy({ transform: {}, onRequest: (e) => { captured = e; } });
    const res = await proxy(
      new Request('http://localhost/anthropic/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: BODY,
      }),
    );
    await res.text();
    // main lands before res resolves; the count_tokens probe is fire-and-forget.
    await settle(() => captured !== undefined && seen.length >= 2);
    restore();
    const main = seen.find((u) => !u.includes('/count_tokens'));
    expect(main).toBe('https://api.anthropic.com/v1/messages');
    expect(captured).toBeDefined();
  });

  it('keeps /anthropic prefix verbatim against a custom (ocproxy) upstream', async () => {
    const { seen, restore } = mockUpstream();
    const proxy = createProxy({
      upstream: 'http://ocproxy.test',
      transform: {},
      onRequest: () => {},
    });
    const res = await proxy(
      new Request('http://localhost/anthropic/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: BODY,
      }),
    );
    await res.text();
    await settle(() => seen.length >= 2);
    restore();
    const main = seen.find((u) => !u.includes('/count_tokens'));
    expect(main).toBe('http://ocproxy.test/anthropic/v1/messages');
  });

  // /openai/-prefixed models paths carry an explicit provider hint and must hit
  // the OpenAI upstream regardless of auth headers — previously they fell
  // through isCanonicalOpenAIPath (which only knew bare /v1/models) and
  // misrouted to api.anthropic.com where they 404.
  it('routes /openai/v1/models → canonical OpenAI /v1/models', async () => {
    const { seen, restore } = mockUpstream();
    const proxy = createProxy({ transform: {}, onRequest: () => {} });
    const res = await proxy(new Request('http://localhost/openai/v1/models'));
    await res.text();
    restore();
    expect(seen[0]).toBe('https://api.openai.com/v1/models');
  });

  it('routes /openai/models (root alias) → canonical OpenAI /v1/models', async () => {
    const { seen, restore } = mockUpstream();
    const proxy = createProxy({ transform: {}, onRequest: () => {} });
    const res = await proxy(new Request('http://localhost/openai/models'));
    await res.text();
    restore();
    expect(seen[0]).toBe('https://api.openai.com/v1/models');
  });

  it('keeps /openai/v1/models verbatim against a custom (ocproxy) upstream', async () => {
    const { seen, restore } = mockUpstream();
    const proxy = createProxy({
      upstream: 'http://ocproxy.test',
      transform: {},
      onRequest: () => {},
    });
    const res = await proxy(new Request('http://localhost/openai/v1/models'));
    await res.text();
    restore();
    expect(seen[0]).toBe('http://ocproxy.test/openai/v1/models');
  });
});
