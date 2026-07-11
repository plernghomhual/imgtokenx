/**
 * Audit E3 regression: caller-supplied AbortSignal propagates to BOTH the
 * /v1/messages/count_tokens probe AND the main upstream fetch. The probe
 * additionally has a default deadline so a slow upstream can't queue
 * unpaid probes against disconnected clients. Both paths should cancel
 * cleanly (return null for probe, throw for main → 502 with an explicit
 * "request aborted" body) rather than running to completion.
 *
 * Assertion strategy: the probe path wraps the caller's signal in
 * AbortSignal.any([caller, timer]), so ref-equality on the captured signal
 * would be wrong (the captured signal is a NEW composite). We test
 * propagation by BEHAVIOR — fire the caller's controller and assert the
 * captured probe signal also aborts. The main fetch passes the caller's
 * signal verbatim, so ref-equality holds there.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProxy } from '../src/core/proxy.js';

const enc = new TextEncoder();

/** Install a fetch mock that captures the EXACT `init.signal` option the
 *  proxy passed. Don't conflate with `req.signal` — every Request has its
 *  own signal independent of the proxy's choice. */
function instrumentFetch(opts: {
  probe?: (signal: AbortSignal) => Promise<Response | null>;
  forward?: (signal: AbortSignal) => Promise<Response>;
}): { restore: () => void; probeSignals: (AbortSignal | undefined)[]; forwardSignals: (AbortSignal | undefined)[] } {
  const real = globalThis.fetch;
  const probeSignals: (AbortSignal | undefined)[] = [];
  const forwardSignals: (AbortSignal | undefined)[] = [];
  globalThis.fetch = (async (req: Request | string | URL, init?: RequestInit) => {
    const r = req instanceof Request ? req : new Request(String(req), init);
    const initSignal = init?.signal;
    if (r.url.includes('/count_tokens')) {
      probeSignals.push(initSignal);
      if (opts.probe) return await opts.probe(initSignal as AbortSignal);
      // Default probe: a quick 200 so the proxy records a baseline.
      return new Response(JSON.stringify({ input_tokens: 1234 }), {
        headers: { 'content-type': 'application/json' },
      });
    }
    forwardSignals.push(initSignal);
    if (opts.forward) return await opts.forward(initSignal as AbortSignal);
    // Default forward: echo the body (mirrors upstream-5xx tests).
    return r.arrayBuffer().then(
      (buf) => new Response(new Uint8Array(buf), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }) as typeof fetch;
  return {
    restore: () => { globalThis.fetch = real; },
    probeSignals,
    forwardSignals,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

function buildMessagesRequest(): Request {
  return new Request('http://localhost/anthropic/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
    },
    body: enc.encode(JSON.stringify({
      model: 'claude-fable-5',
      system: 'x'.repeat(2500),
      messages: [{ role: 'user', content: 'hello' }],
    })),
  });
}

describe('E3 abort/timeout propagation (proxy)', () => {
  it('passes the caller signal verbatim to the main upstream fetch', async () => {
    // Main fetch threads callerSignal directly (no AbortSignal.any wrapping).
    // Ref-equality is valid here.
    const { restore, forwardSignals } = instrumentFetch({});
    const proxy = createProxy({ transform: {}, onRequest: () => {} });
    const ctrl = new AbortController();
    const res = await proxy(buildMessagesRequest(), { signal: ctrl.signal });
    expect(res.status).toBe(200);
    expect(forwardSignals.length).toBe(1);
    expect(forwardSignals[0]).toBe(ctrl.signal);
    restore();
  });

  it('propagates caller abort into the probe (caller signal AbortSignal.any)', async () => {
    // Probe composes callerSignal with a deadline via AbortSignal.any. The
    // composite is NOT the same reference — but when the caller aborts,
    // the composite aborts too (per spec). Check by behavior, not ref.
    const { restore, probeSignals } = instrumentFetch({});
    const proxy = createProxy({ transform: {}, onRequest: () => {} });
    const ctrl = new AbortController();
    const res = await proxy(buildMessagesRequest(), { signal: ctrl.signal });
    expect(res.status).toBe(200);
    expect(probeSignals.length).toBe(1);
    const probeSig = probeSignals[0]!;
    expect(probeSig).toBeDefined();
    // Before caller aborts — probe signal is fresh. After caller aborts,
    // probe signal (the AbortSignal.any composite) must reflect that.
    expect(probeSig.aborted).toBe(false);
    ctrl.abort();
    expect(probeSig.aborted).toBe(true);
    restore();
  });

  it(
    'returns 502 with imgtokenx request aborted body when caller aborts mid-fetch',
    { timeout: 12_000 }, // Vitest 4 form: options second, fn third
    async () => {
      // The handler runs sequentially: readBodyWithLimit → transformRequest
      // (compress path may render PNGs, several seconds) → main fetch.
      // ctrl.abort() fires BEFORE transformRequest returns, so by the time
      // `fetch(upstreamUrl, { signal: ctrl.signal })` is invoked, the
      // signal is ALREADY aborted. The mock MUST mirror real `globalThis.fetch`
      // — which throws DOMException(\"AbortError\") synchronously when the
      // signal is already aborted. Without the eager `signal.aborted` check
      // the abort listener is attached AFTER the abort event has been
      // dispatched, so it never fires (per WHATWG, addEventListener does
      // not replay past events) and the mock promise hangs forever.
      const { restore } = instrumentFetch({
        forward: (signal) => {
          if (signal.aborted) {
            // Mirror real fetch: throw DOMException(\"AbortError\") even when
            // the abort happened before the listener was attached.
            return Promise.reject(new DOMException('aborted', 'AbortError'));
          }
          return new Promise<Response>((_resolve, reject) => {
            signal.addEventListener('abort', () => {
              reject(new DOMException('aborted', 'AbortError'));
            });
          });
        },
      });
      const proxy = createProxy({ transform: {}, onRequest: () => {} });
      const ctrl = new AbortController();
      const pending = proxy(buildMessagesRequest(), { signal: ctrl.signal });
      ctrl.abort();
      const res = await pending;
      // Audit E3: aborted request returns 502 with body that names the abort
      // cause — distinct from a real upstream-unreachable 502.
      expect(res.status).toBe(502);
      const body = (await res.json()) as { error?: string };
      expect(body.error).toBe('imgtokenx request aborted');
      restore();
    },
  );

  it('returns 502 with imgtokenx upstream unreachable body when fetch fails non-abort', async () => {
    // Sanity: distinguishes the two error shapes. A real upstream TypeError
    // / ECONNREFUSED must NOT be labeled as "request aborted" by mistake.
    const { restore } = instrumentFetch({
      forward: () => Promise.reject(new TypeError('fetch failed')),
    });
    const proxy = createProxy({ transform: {}, onRequest: () => {} });
    const res = await proxy(buildMessagesRequest());
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe('imgtokenx upstream unreachable');
    restore();
  });

  it(
    'caps the probe at the default 5 s deadline even without a caller signal',
    { timeout: 12_000 }, // Vitest 4 form: options second, fn third
    async () => {
      // Probe never resolves. Forward echoes. The proxy-default probeTimeout
      // must fire BEFORE the test runner's per-test timeout — 5 s vs
      // vitest's default. 12 s test timeout (5 s default deadline + 7 s
      // waitUntil poll + slow-CI slack) catches a regression that drops
      // the cap back to "no cap" (probe keeps accumulating) or bumps it
      // to 30 s+ defaults.
      const probeStartedAt = Date.now();
      let capturedProbeSignal: AbortSignal | undefined;
      const { restore } = instrumentFetch({
        probe: (signal) => {
          capturedProbeSignal = signal;
          return new Promise<Response | null>(() => { /* never resolves */ });
        },
      });
      const proxy = createProxy({ transform: {}, onRequest: () => {} });
      const res = await proxy(buildMessagesRequest());
      // Forward returned → 200; probe timed out internally — the response
      // shape is NOT blocked on probe completion.
      expect(res.status).toBe(200);
      expect(capturedProbeSignal).toBeDefined();
      // `await proxy()` does NOT block on the probe closing. Poll the
      // signal's aborted state up to 7 s — the proxy's default 5_000 ms
      // deadline must abort within the vitest runner's per-test window.
      await vi.waitUntil(
        () => capturedProbeSignal?.aborted === true,
        { timeout: 7_000, interval: 50 },
      );
      // Default cap is 5_000 ms; allow slack (>= 4_500, <= 7_500).
      const elapsed = Date.now() - probeStartedAt;
      expect(elapsed).toBeGreaterThanOrEqual(4_500);
      expect(elapsed).toBeLessThanOrEqual(7_500);
      restore();
    },
  );

  it(
    'honors probeTimeoutMs override',
    { timeout: 4_000 }, // Vitest 4 form
    async () => {
      let capturedProbeSignal: AbortSignal | undefined;
      const probeStartedAt = Date.now();
      const { restore } = instrumentFetch({
        probe: (signal) => {
          capturedProbeSignal = signal;
          return new Promise<Response | null>(() => { /* never resolves */ });
        },
      });
      const proxy = createProxy({ probeTimeoutMs: 250, transform: {}, onRequest: () => {} });
      const res = await proxy(buildMessagesRequest());
      expect(res.status).toBe(200);
      expect(capturedProbeSignal).toBeDefined();
      // 4 s test timeout (0.25 s override + 1.5 s poll + slack).
      await vi.waitUntil(
        () => capturedProbeSignal?.aborted === true,
        { timeout: 1_500, interval: 20 },
      );
      const elapsed = Date.now() - probeStartedAt;
      expect(elapsed).toBeLessThan(1_500);
      restore();
    },
  );

  it('omitting options is backward-compatible (signal absent in fetch init)', async () => {
    // Pre-batch call shape `await proxy(req)` — fetch must be called
    // without an explicit signal option. (The inner request still has its
    // own .signal, but the proxy passes none — that's the audit contract.)
    const { restore, forwardSignals, probeSignals } = instrumentFetch({});
    const proxy = createProxy({ transform: {}, onRequest: () => {} });
    const res = await proxy(buildMessagesRequest());
    expect(res.status).toBe(200);
    expect(forwardSignals.length).toBe(1);
    expect(forwardSignals[0]).toBeUndefined();
    // Probe gets the deadline timer even when no caller signal is supplied.
    expect(probeSignals[0]).toBeDefined();
    restore();
  });
});
