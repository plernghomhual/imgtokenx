/**
 * Regression guard: the proxy PASSES THROUGH upstream 5xx status codes
 * unchanged (does not synthesize its own 2xx or rewrite the status). A
 * broken upstream (502/500) must surface to the client verbatim, including
 * the upstream's error body — not be silently "transformed" or swallowed.
 *
 * (Distinct from the proxy's OWN synthesized 502 on transform_error /
 * upstream_unreachable — those are client-side failures, tested separately.)
 */

import { afterEach, describe, expect, it } from 'vitest';
import { createProxy } from '../src/core/proxy.js';

function mockUpstream(handler: (req: Request) => Response) {
  const real = globalThis.fetch;
  globalThis.fetch = ((req: Request | string | URL, init?: RequestInit) => {
    const r = req instanceof Request ? req : new Request(String(req), init);
    return Promise.resolve(handler(r));
  }) as typeof fetch;
  return () => {
    globalThis.fetch = real;
  };
}

describe('upstream 5xx passthrough (e2e)', () => {
  it('forwards an upstream 502 with its body, status untouched', async () => {
    const restore = mockUpstream((req) => {
      if (req.url.endsWith('/count_tokens')) {
        return new Response(JSON.stringify({ input_tokens: 1 }), {
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ error: 'upstream bad gateway' }), {
        status: 502,
        headers: { 'content-type': 'application/json' },
      });
    });

    const proxy = createProxy({ transform: {}, onRequest: () => {} });
    const res = await proxy(
      new Request('http://localhost/anthropic/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'claude-fable-5', messages: [{ role: 'user', content: 'hi' }] }),
      }),
    );

    expect(res.status).toBe(502);
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(await res.json()).toEqual({ error: 'upstream bad gateway' });
    restore();
  });

  it('forwards an upstream 500 identically', async () => {
    const restore = mockUpstream((req) => {
      if (req.url.endsWith('/count_tokens')) {
        return new Response(JSON.stringify({ input_tokens: 1 }), {
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('internal error', { status: 500 });
    });

    const proxy = createProxy({ transform: {}, onRequest: () => {} });
    const res = await proxy(
      new Request('http://localhost/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-5.6', messages: [{ role: 'user', content: 'hi' }] }),
      }),
    );

    expect(res.status).toBe(500);
    expect(await res.text()).toBe('internal error');
    restore();
  });

  it('does not re-label a 5xx as the proxy internal 502 (transform_error)', async () => {
    // If the proxy mistook an upstream 5xx for a transform failure, the body
    // would be `{ error: 'imgtokenx transform failed' }` at status 502.
    const restore = mockUpstream((req) => {
      if (req.url.endsWith('/count_tokens')) {
        return new Response(JSON.stringify({ input_tokens: 1 }), {
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('gateway timeout', { status: 504 });
    });

    const proxy = createProxy({ transform: {}, onRequest: () => {} });
    const res = await proxy(
      new Request('http://localhost/anthropic/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'claude-fable-5', messages: [{ role: 'user', content: 'hi' }] }),
      }),
    );

    expect(res.status).toBe(504);
    expect(await res.text()).toBe('gateway timeout');
    restore();
  });
});
