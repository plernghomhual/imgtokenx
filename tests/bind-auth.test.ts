import { describe, it, expect } from 'vitest';
import {
  bindAuthResponse,
  defaultAllowedHosts,
  hostMatches,
  isLoopbackRequest,
  parseHostList,
  type BindAuthRequest,
} from '../src/core/bind-auth.js';

function h(init: Record<string, string> = {}): Pick<Headers, 'get'> {
  return {
    get: (k: string) => {
      const v = init[k.toLowerCase()];
      return v ?? null;
    },
  };
}

const TOKEN = 'production-secret-token-32-chars-long-XXXX';

const loopbackReq = (url: string, localAddr?: string): BindAuthRequest => ({
  method: 'GET',
  url,
  headers: h({ host: new URL(url).host }),
  localAddress: localAddr,
});

const offHostReq = (url: string, host: string, localAddr: string): BindAuthRequest => ({
  method: 'GET',
  url,
  headers: h({ host }),
  localAddress: localAddr,
});

describe('parseHostList', () => {
  it('returns empty for unset', () => {
    expect(parseHostList(undefined)).toEqual([]);
    expect(parseHostList('')).toEqual([]);
  });
  it('parses comma-separated values', () => {
    expect(parseHostList(' foo.example.com , bar.example.com '))
      .toEqual(['foo.example.com', 'bar.example.com']);
  });
  it('drops empty fields', () => {
    expect(parseHostList('foo,,bar,'))
      .toEqual(['foo', 'bar']);
  });
  it('treats whitespace-only fields as empty', () => {
    expect(parseHostList('foo,   ,bar'))
      .toEqual(['foo', 'bar']);
  });
});

describe('defaultAllowedHosts', () => {
  it('returns the loopback variants for the given port', () => {
    const got = defaultAllowedHosts(47821);
    expect(got).toContain('127.0.0.1:47821');
    expect(got).toContain('[::1]:47821');
    expect(got).toContain('localhost:47821');
    // also accepts bare hosts (no port) for browser clients
    expect(got).toContain('127.0.0.1');
    expect(got).toContain('[::1]');
    expect(got).toContain('localhost');
  });
});

describe('hostMatches', () => {
  it('matches a verbatim entry', () => {
    expect(hostMatches('foo.example.com', ['foo.example.com'])).toBe(true);
  });
  it('matches case-insensitively at the hostname part', () => {
    expect(hostMatches('Foo.Example.Com', ['foo.example.com'])).toBe(true);
  });
  it('strips a trailing FQDN dot before comparing', () => {
    expect(hostMatches('foo.example.com.', ['foo.example.com'])).toBe(true);
    expect(hostMatches('foo.example.com', ['foo.example.com.'])).toBe(true);
  });
  it('does NOT match subdomains or path-prefixed forms', () => {
    expect(hostMatches('evil.example.com', ['foo.example.com'])).toBe(false);
    expect(hostMatches('foo.example.com.evil', ['foo.example.com'])).toBe(false);
    expect(hostMatches('foo.example.com:80', ['foo.example.com'])).toBe(false);
  });
  it('matches a different port (different entries = different strings)', () => {
    expect(hostMatches('foo.example.com:47821', ['foo.example.com:47821'])).toBe(true);
    expect(hostMatches('foo.example.com:47821', ['foo.example.com:80'])).toBe(false);
    expect(hostMatches('foo.example.com', ['foo.example.com:47821'])).toBe(false);
  });
  it('returns false against an empty allowlist', () => {
    expect(hostMatches('foo.example.com', [])).toBe(false);
  });
});

describe('isLoopbackRequest', () => {
  it('returns true for loopback URLs with no localAddress (Worker)', () => {
    expect(isLoopbackRequest(loopbackReq('http://127.0.0.1:47821/x'))).toBe(true);
    expect(isLoopbackRequest(loopbackReq('http://[::1]:47821/x'))).toBe(true);
    expect(isLoopbackRequest(loopbackReq('http://localhost:47821/x'))).toBe(true);
  });
  it('returns true when URL is loopback AND localAddress is loopback (real local bind)', () => {
    expect(isLoopbackRequest(loopbackReq('http://127.0.0.1:47821/x', '127.0.0.1'))).toBe(true);
  });
  it('returns false when URL is loopback but localAddress is non-loopback (off-host spoof)', () => {
    expect(isLoopbackRequest(loopbackReq('http://127.0.0.1:47821/x', '203.0.113.42')))
      .toBe(false);
  });
  it('returns false for off-host URLs', () => {
    expect(isLoopbackRequest(loopbackReq('http://example.com:47821/x', '203.0.113.42')))
      .toBe(false);
  });
  it('returns false on malformed URL', () => {
    expect(isLoopbackRequest({
      method: 'GET',
      url: 'not-a-real-url',
      headers: h(),
    })).toBe(false);
  });
});

describe('bindAuthResponse — loopback bypass', () => {
  it('loopback callers bypass auth and host checks (no secret required)', () => {
    const res = bindAuthResponse(
      loopbackReq('http://127.0.0.1:47821/v1/messages'),
      { allowedHosts: [], secret: undefined }, // even with no enforcement config
    );
    expect(res).toBeNull();
  });
  it('loopback callers bypass even with secret set', () => {
    const res = bindAuthResponse(
      loopbackReq('http://localhost:47821/v1/messages'),
      { allowedHosts: ['foo.example.com'], secret: TOKEN }, // irrelevant for loopback
    );
    expect(res).toBeNull();
  });
});

describe('bindAuthResponse — host whitelist (off-host)', () => {
  it('403s when Host is not in the allowlist', async () => {
    const res = bindAuthResponse(
      offHostReq('http://example.com:47821/x', 'example.com:47821', '203.0.113.42'),
      { allowedHosts: ['foo.example.com:47821'], secret: TOKEN },
    );
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
    const body = await res!.json() as { error: string };
    expect(body.error).toMatch(/IMGTOKENX_ALLOWED_HOSTS/);
  });
  it('permits when Host is in the allowlist (and secret present + valid)', () => {
    const req: BindAuthRequest = {
      method: 'GET',
      url: 'http://foo.example.com:47821/x',
      headers: h({ host: 'foo.example.com:47821', authorization: `Bearer ${TOKEN}` }),
      localAddress: '203.0.113.42',
    };
    const res = bindAuthResponse(req, {
      allowedHosts: ['foo.example.com:47821'],
      secret: TOKEN,
    });
    expect(res).toBeNull();
  });
});

describe('bindAuthResponse — secret gate (off-host + allowlisted)', () => {
  const reqInAllowlist: BindAuthRequest = {
    method: 'GET',
    url: 'http://foo.example.com:47821/x',
    headers: h({ host: 'foo.example.com:47821' }),
    localAddress: '203.0.113.42',
  };
  it('403s with hint when secret is unset off-host', async () => {
    const res = bindAuthResponse(
      { ...reqInAllowlist, headers: h({ host: 'foo.example.com:47821', authorization: 'Bearer something' }) },
      { allowedHosts: ['foo.example.com:47821'], secret: undefined },
    );
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
    const body = await res!.json() as { error: string };
    expect(body.error).toMatch(/IMGTOKENX_PROXY_TOKEN/);
  });
  it('401s when secret is set but presented missing/wrong', async () => {
    for (const presented of [undefined, '', 'Bearer wrong', `Bearer ${TOKEN}xx`]) {
      const headers = presented === undefined
        ? h({ host: 'foo.example.com:47821' })
        : h({ host: 'foo.example.com:47821', authorization: presented });
      const res = bindAuthResponse(
        { ...reqInAllowlist, headers },
        { allowedHosts: ['foo.example.com:47821'], secret: TOKEN },
      );
      expect(res).not.toBeNull();
      expect(res!.status).toBe(401);
      expect(res!.headers.get('www-authenticate')).toMatch(/Bearer/);
    }
  });
  it('returns null when secret matches', () => {
    const res = bindAuthResponse(
      {
        ...reqInAllowlist,
        headers: h({ host: 'foo.example.com:47821', authorization: `Bearer ${TOKEN}` }),
      },
      { allowedHosts: ['foo.example.com:47821'], secret: TOKEN },
    );
    expect(res).toBeNull();
  });
});

describe('bindAuthResponse — DNS rebinding defense', () => {
  it('rejects off-host caller with loopback-bypassing Host (Browser rebinding case)', async () => {
    // Attacker-controlled DNS resolves foo.example.com to 127.0.0.1; browser
    // sends Host: foo.example.com. localAddress is still the off-host IP we
    // resolved, but URL hostname parses as 127.0.0.1 (rebinding TTL).
    // bindAuth must NOT treat this as loopback because localAddress is the
    // authoritative source.
    const res = bindAuthResponse(
      {
        method: 'GET',
        url: 'http://foo.example.com:47821/x',
        headers: h({ host: 'foo.example.com:47821' }),
        localAddress: '127.0.0.1', // browser side
      },
      { allowedHosts: [], secret: undefined },
    );
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
  });
  it('rejects missing Host header wholesale', async () => {
    const res = bindAuthResponse(
      {
        method: 'GET',
        url: 'http://foo.example.com:47821/x',
        headers: h(),
        localAddress: '203.0.113.42',
      },
      { allowedHosts: ['foo.example.com'], secret: TOKEN },
    );
    expect(res).not.toBeNull();
    expect(res!.status).toBe(400);
  });
});

describe('bindAuthResponse — method-agnostic (POST/DELETE included)', () => {
  it('applies on POST even though the gate is route-agnostic', async () => {
    const res = bindAuthResponse(
      {
        method: 'POST',
        url: 'http://evil.example.com:47821/x',
        headers: h({ host: 'evil.example.com:47821' }),
        localAddress: '203.0.113.42',
      },
      { allowedHosts: ['foo.example.com'], secret: TOKEN },
    );
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
  });
});
