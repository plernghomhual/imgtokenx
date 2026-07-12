import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProxy, transformFailureTelemetry } from '../src/core/index.js';
import type { ProxyConfig } from '../src/core/index.js';

/** Poll until the fire-and-forget proxy work lands instead of sleeping a
 *  fixed tick (flaked on slow CI). Times out loudly, never passes vacuously. */
async function settle(done: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!done()) {
    if (Date.now() - start > timeoutMs) throw new Error('proxy event did not settle in time');
    await new Promise((r) => setTimeout(r, 5));
  }
}

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
    const proxy = createProxy(config);
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

  it('contains and redacts rejected onRequest hooks', async () => {
    const logged: unknown[][] = [];
    const error = console.error;
    console.error = (...args: unknown[]) => { logged.push(args); };
    let background: Promise<unknown> | undefined;
    const restore = mockUpstream();
    const proxy = createProxy({
      onRequest: () => { throw new TypeError('secret provider payload'); },
      waitUntil: (p) => { background = p; },
    });
    const res = await proxy(new Request('https://p/v1/messages', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'unsupported', messages: [] }),
    }));
    await res.text();
    await settle(() => logged.length >= 1);
    await background;
    restore();
    console.error = error;
    expect(String(logged[0]?.[0])).toContain('TypeError');
    expect(JSON.stringify(logged)).not.toContain('secret provider payload');
  });
});

describe('model gating reads top-level model only (full JSON parse)', () => {
  it('a decoy "model":"..." inside message content does not enable compression', async () => {
    const proxy = createProxy({ upstream: 'https://api.anthropic.com', apiKey: 'k' });
    const restore = mockUpstream();

    // No top-level model → fail-closed passthrough. The old 8KB regex scan
    // would have matched the decoy below and treated the request as supported.
    const body = {
      system: 'x'.repeat(2000),
      messages: [{ role: 'user', content: 'example request: {"model":"claude-fable-5","max_tokens":1}' }],
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
    expect(sent.system).toBe('x'.repeat(2000));
    expect(sent.messages[0]!.content).toContain('"model":"claude-fable-5"');
  });
});

describe('upstream fetch failure telemetry is redacted', () => {
  it('ProxyEvent.error passes through redactErrorBody like errorBody does', async () => {
    const fakeKey = `sk-ant-api03-${'A'.repeat(85)}`;
    const real = globalThis.fetch;
    globalThis.fetch = (() =>
      Promise.reject(new Error(`connect failed with auth ${fakeKey}`))) as typeof fetch;

    const events: { error?: string }[] = [];
    const proxy = createProxy({
      upstream: 'https://api.anthropic.com',
      apiKey: 'k',
      onRequest: (e) => { events.push(e as { error?: string }); },
    });
    const res = await proxy(
      new Request('https://p/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: enc.encode(JSON.stringify({ model: 'claude-fable-5', messages: [] })),
      }),
    );
    globalThis.fetch = real;

    expect(res.status).toBe(502);
    await settle(() => events.length >= 1);
    const err = events[0]!.error ?? '';
    expect(err).toContain('upstream_error:');
    expect(err).toContain('[REDACTED:anthropic_key]');
    expect(err).not.toContain(fakeKey);
  });
});
