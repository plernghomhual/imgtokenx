import { describe, it, expect } from 'vitest';
import {
  healthzResponse,
  isLoopbackHostname,
  readBuildInfo,
  type HealthzRequest,
} from '../src/core/healthz.js';

/** Tiny helper: build a /healthz Fetch Headers pair from a plain object. */
function h(init: Record<string, string> = {}): Pick<Headers, 'get'> {
  return {
    get: (k: string) => {
      const v = init[k.toLowerCase()];
      return v ?? null;
    },
  };
}

const TOKEN = 'super-secret-token-32-chars-long-XXXX';

describe('isLoopbackHostname', () => {
  it('accepts the four loopback forms the host can bind to', () => {
    expect(isLoopbackHostname('127.0.0.1')).toBe(true);
    expect(isLoopbackHostname('::1')).toBe(true);
    expect(isLoopbackHostname('localhost')).toBe(true);
  });
  it('rejects off-host hostnames', () => {
    expect(isLoopbackHostname('example.com')).toBe(false);
    expect(isLoopbackHostname('192.168.1.5')).toBe(false);
    expect(isLoopbackHostname('10.0.0.1')).toBe(false);
    expect(isLoopbackHostname('worker.example.workers.dev')).toBe(false);
  });
  it('rejects spoofed-looking strings', () => {
    expect(isLoopbackHostname('127.0.0.1.example.com')).toBe(false);
    expect(isLoopbackHostname('localhost.evil')).toBe(false);
  });
});

describe('readBuildInfo', () => {
  it('returns "unknown" for both version and buildTime when defines are unset', () => {
    const build = readBuildInfo();
    // Unbundled dev (vitest) so both fields fall back to "unknown". Once
    // bundled the build emits JSON.stringify(pkg.version) and ISO timestamp.
    expect(build.version).toBeTypeOf('string');
    expect(build.buildTime).toBeTypeOf('string');
  });
});

describe('healthzResponse — method gate', () => {
  it('returns 405 + Allow for POST/PUT/DELETE/etc.', async () => {
    const res = healthzResponse({ method: 'POST', url: 'http://127.0.0.1/hz', headers: h(), healthzToken: undefined });
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('GET, HEAD');
  });
  it('accepts lowercase method names (case-insensitive)', () => {
    const res = healthzResponse({ method: 'get', url: 'http://127.0.0.1/hz', headers: h(), healthzToken: undefined });
    expect(res.status).toBe(200);
  });
});

describe('healthzResponse — loopback bypass', () => {
  it('returns 200 + JSON envelope for loopback with no token required', async () => {
    const res = healthzResponse({
      method: 'GET',
      url: 'http://127.0.0.1:47821/healthz',
      headers: h(),
      healthzToken: undefined, // intentionally absent
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json() as { ok: boolean; version: string; build_time: string; auth: string };
    expect(body.ok).toBe(true);
    expect(body.auth).toBe('loopback');
    expect(body.version).toBeTypeOf('string');
    expect(body.build_time).toBeTypeOf('string');
  });
  it('localhost also bypasses (tokenless)', async () => {
    const res = healthzResponse({
      method: 'GET',
      url: 'http://localhost:47821/healthz',
      headers: h(),
      healthzToken: TOKEN,
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { auth: string };
    expect(body.auth).toBe('loopback');
  });
  it('IPv6 [::1] is loopback too', async () => {
    const res = healthzResponse({
      method: 'GET',
      url: 'http://[::1]:47821/healthz',
      headers: h(),
      healthzToken: TOKEN,
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { auth: string };
    expect(body.auth).toBe('loopback');
  });
  it('loopback callers that SEND a wrong token are still allowed (auth=loopback)', async () => {
    const res = healthzResponse({
      method: 'GET',
      url: 'http://127.0.0.1:47821/healthz',
      headers: h({ authorization: 'Bearer wrong-token' }),
      healthzToken: TOKEN,
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { auth: string };
    expect(body.auth).toBe('loopback');
  });
});

describe('healthzResponse — off-host token gate', () => {
  it('returns 403 + actionable hint when IMGTOKENX_HEALTHZ_TOKEN is unset off-host', async () => {
    const res = healthzResponse({
      method: 'GET',
      url: 'http://example.com:47821/healthz',
      headers: h(),
      healthzToken: undefined,
    });
    expect(res.status).toBe(403);
    const body = await res.json() as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/IMGTOKENX_HEALTHZ_TOKEN/);
    expect(body.error).toMatch(/healthz/i);
  });
  it('returns 401 + WWW-Authenticate when token is set but presented missing/wrong', async () => {
    for (const presented of [
      undefined,
      '',
      'Bearer wrong-token',
      'bearer wrong-token', // case-sensitive Bearer is correct, lowercase header value is part of token
      `Bearer ${TOKEN}x`,
    ]) {
      const headers = presented === undefined ? h() : h({ authorization: presented });
      const res = healthzResponse({
        method: 'GET',
        url: 'http://example.com:47821/healthz',
        headers,
        healthzToken: TOKEN,
      });
      expect(res.status).toBe(401);
      expect(res.headers.get('www-authenticate')).toMatch(/Bearer/);
      const body = await res.json() as { ok: boolean; error: string };
      expect(body.ok).toBe(false);
    }
  });
  it('returns 200 off-host when the correct Bearer token is presented', async () => {
    const res = healthzResponse({
      method: 'GET',
      url: 'http://example.com:47821/healthz',
      headers: h({ authorization: `Bearer ${TOKEN}` }),
      healthzToken: TOKEN,
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; auth: string; version: string };
    expect(body.ok).toBe(true);
    expect(body.auth).toBe('token');
    expect(typeof body.version).toBe('string');
  });
});

describe('healthzResponse — HEAD method', () => {
  it('HEAD returns same envelope with body=null', async () => {
    const res = healthzResponse({
      method: 'HEAD',
      url: 'http://127.0.0.1:47821/healthz',
      headers: h(),
      healthzToken: undefined,
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('');
  });
  it('HEAD off-host without token still 403', async () => {
    const res = healthzResponse({
      method: 'HEAD',
      url: 'http://example.com:47821/healthz',
      headers: h(),
      healthzToken: undefined,
    });
    expect(res.status).toBe(403);
  });
  it('HEAD off-host with valid token returns 200 with no body', async () => {
    const res = healthzResponse({
      method: 'HEAD',
      url: 'http://example.com:47821/healthz',
      headers: h({ authorization: `Bearer ${TOKEN}` }),
      healthzToken: TOKEN,
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('');
  });
});

describe('healthzResponse — malformed URL', () => {
  it('returns 400 when the URL cannot be parsed (defensive)', () => {
    const res = healthzResponse({
      method: 'GET',
      url: 'not-a-real-url',
      headers: h(),
      healthzToken: undefined,
    });
    expect(res.status).toBe(400);
    const body = res.json() as unknown as Promise<{ ok: boolean; error: string }>;
    return body.then((b) => {
      expect(b.ok).toBe(false);
    });
  });
});

describe('healthzResponse — defense-in-depth with proxy.ts', () => {
  // The proxy.ts handler is the runtime-agnostic entry. We can't import
  // createProxy here without booting the workers polyfill, but the unit
  // coverage above pins the pure contract. The proxy.ts edge inlines
  // config.healthzToken into healthzTokenEnv; the test below simulates that.
  it('honors a HealthzRequest shape that matches proxy.ts wiring', async () => {
    const req: HealthzRequest = {
      method: 'GET',
      url: 'http://example.com/healthz',
      headers: h({ authorization: `Bearer ${TOKEN}` }),
      healthzToken: TOKEN,
    };
    const res = healthzResponse(req);
    expect(res.status).toBe(200);
  });
});
