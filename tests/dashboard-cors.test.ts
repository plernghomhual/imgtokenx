/**
 * Regression guard: the dashboard origin/fetch-site guard must apply to GET
 * routes too, not just POST. /api/image-source returns verbatim user prompt
 * text; leaving GET unguarded let a cross-site page exfiltrate it. See audit
 * finding E-MEDIUM (unauthenticated dashboard GET exposure).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { dispatchDashboard } from '../src/node.js';
import { DashboardState, dashboardPath } from '../src/dashboard.js';
import type { SessionsPaths } from '../src/sessions.js';

function makeTmp(): SessionsPaths {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imgtokenx-dashcors-'));
  return { eventsFile: path.join(dir, 'events.jsonl'), sidecarDir: path.join(dir, '4xx-bodies') };
}

let tmp: SessionsPaths;
let dash: DashboardState;
beforeEach(() => {
  tmp = makeTmp();
  dash = new DashboardState(tmp, async () => new Map());
});
afterEach(() => {
  try {
    fs.rmSync(path.dirname(tmp.eventsFile), { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

function fakeReq(method: string, headers: Record<string, string>): unknown {
  return { method, headers } as unknown;
}

const ORIGIN = 'http://127.0.0.1:47821';

describe('dashboard GET origin guard', () => {
  it('blocks cross-site GET to /api/image-source', async () => {
    const res = await dispatchDashboard(
      dash,
      dashboardPath('/api/image-source')!,
      fakeReq('GET', { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }) as never,
      new URL(`${ORIGIN}/api/image-source`),
      47821,
    );
    expect(res?.status).toBe(403);
  });

  it('allows same-origin GET to /api/image-source', async () => {
    const res = await dispatchDashboard(
      dash,
      dashboardPath('/api/image-source')!,
      fakeReq('GET', { origin: ORIGIN, 'sec-fetch-site': 'same-origin' }) as never,
      new URL(`${ORIGIN}/api/image-source`),
      47821,
    );
    expect(res?.status).not.toBe(403);
  });

  it('allows non-browser (no Origin) local GET', async () => {
    const res = await dispatchDashboard(
      dash,
      dashboardPath('/api/image-source')!,
      fakeReq('GET', {}) as never,
      new URL(`${ORIGIN}/api/image-source`),
      47821,
    );
    expect(res?.status).not.toBe(403);
  });

  it('still blocks cross-site POST mutations', async () => {
    const res = await dispatchDashboard(
      dash,
      dashboardPath('/fragments/toggle')!,
      fakeReq('POST', { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }) as never,
      new URL(`${ORIGIN}/fragments/toggle`),
      47821,
    );
    expect(res?.status).toBe(403);
  });

  it('D18 returns 405 + Allow for wrong-method dashboard route (not proxy passthrough)', async () => {
    // POST to a GET-only route must NOT fall through to the proxy; it must
    // answer 405 with an Allow header.
    const res = await dispatchDashboard(
      dash,
      dashboardPath('/proxy-stats')!,
      fakeReq('POST', {}) as never,
      new URL(`${ORIGIN}/proxy-stats`),
      47821,
    );
    expect(res?.status).toBe(405);
    expect(res?.headers.get('allow')).toBe('GET');
  });

  it('D18 allows POST with correct method to /api/compression', async () => {
    const res = await dispatchDashboard(
      dash,
      dashboardPath('/api/compression')!,
      fakeReq('GET', {}) as never,
      new URL(`${ORIGIN}/api/compression`),
      47821,
    );
    expect(res?.status).toBe(405);
    expect(res?.headers.get('allow')).toBe('POST');
  });

  it('E5 sets no-store on served dashboard responses', async () => {
    const res = await dispatchDashboard(
      dash,
      dashboardPath('/proxy-stats')!,
      fakeReq('GET', {}) as never,
      new URL(`${ORIGIN}/proxy-stats`),
      47821,
    );
    expect(res).toBeDefined();
    expect(res?.headers.get('cache-control')).toBe('no-store');
  });
});
