import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProxy, transformFailureTelemetry } from '../src/core/index.js';
import type { ProxyConfig } from '../src/core/index.js';

// Audit D1: optional request transforms must FAIL OPEN. When the underlying
// transformer throws (e.g. a latent bug in a future code path), the proxy must
// forward the ORIGINAL body untouched — never a 502 — and record bounded,
// redacted telemetry (error class only, never the message).

const enc = new TextEncoder();

// In-process mock upstream that echoes the request body back as JSON 200, so we
// can assert exactly what the proxy forwarded.
function mockUpstream() {
  const real = globalThis.fetch;
  globalThis.fetch = ((req: Request | string | URL, init?: RequestInit) => {
    const r = req instanceof Request ? req : new Request(String(req), init);
    return Promise.resolve(
      r.arrayBuffer().then(
        (buf) =>
          new Response(new Uint8Array(buf), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    );
  }) as typeof fetch;
  return () => {
    globalThis.fetch = real;
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('D1 fail-open on transform error', () => {
  it('forwards the original body (200) when transformRequest throws, and redacts telemetry', async () => {
    const spy = vi.spyOn(await import('../src/core/transform.js'), 'transformRequest');
    spy.mockImplementation(async () => {
      throw new Error('boom: secret request text'); // message must NOT be surfaced
    });

    const config: ProxyConfig = { upstream: 'https://api.anthropic.com', apiKey: 'k' };
    const proxy = createProxy(config, () => {});
    const restore = mockUpstream();

    const body = {
      model: 'claude-fable-5',
      system: 'x'.repeat(2000),
      messages: [{ role: 'user', content: 'hi' }],
    };
    const res = await proxy(
      new Request('https://p/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: enc.encode(JSON.stringify(body)),
      }),
    );
    restore();

    expect(res.status).toBe(200);
    const sent = (await res.json()) as typeof body;
    // Original body forwarded verbatim — compression never happened.
    expect(sent.system).toBe('x'.repeat(2000));
    expect(sent.model).toBe('claude-fable-5');

    // Telemetry is bounded + redacted: only the error class is recorded.
    expect(transformFailureTelemetry.count).toBeGreaterThan(0);
    expect(transformFailureTelemetry.lastErrorClass).toBe('Error');
    expect(transformFailureTelemetry.lastErrorClass).not.toContain('boom');
  });
});
