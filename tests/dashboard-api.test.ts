/**
 * Tests for the new /api/* dashboard endpoints. We instantiate a
 * DashboardState directly against a tmpdir SessionsPaths and call its
 * serve* methods, then assert on the JSON body. No real HTTP server — the
 * route dispatch lives in node.ts and would just be a thin re-export of the
 * same calls.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { DashboardState, dashboardMutationAllowed, dashboardPath } from '../src/dashboard.js';
import { getAllowedModelBases, setAllowedModelBases } from '../src/core/applicability.js';
import type { SessionsPaths } from '../src/sessions.js';
import type { TrackEvent } from '../src/core/tracker.js';
import type { StatsPayload, RecentPayload } from '../src/dashboard/types.js';

interface SessionsJson {
  count: number;
  sessions: Array<{ id: string; claudeCode: unknown }>;
}

interface ApiStatsJson {
  parsed: number;
  summary: {
    total: number;
    ok2xx: number;
    err4xx: number;
    compressed: number;
    passthrough: number;
    origCharsTotal: number;
    imageBytesTotal: number;
  };
}

function makeTmp(): SessionsPaths {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imgtokenx-dashapi-'));
  return {
    eventsFile: path.join(dir, 'events.jsonl'),
    sidecarDir: path.join(dir, '4xx-bodies'),
  };
}

function ev(p: Partial<TrackEvent>): TrackEvent {
  return {
    ts: '2026-05-19T00:00:00Z',
    method: 'POST',
    path: '/v1/messages',
    status: 200,
    duration_ms: 100,
    ...p,
  };
}

function writeEvents(paths: SessionsPaths, events: TrackEvent[]): void {
  fs.mkdirSync(path.dirname(paths.eventsFile), { recursive: true });
  fs.writeFileSync(
    paths.eventsFile,
    events.map((e) => JSON.stringify(e)).join('\n') + '\n',
  );
}

let tmp: SessionsPaths;
let dash: DashboardState;
beforeEach(() => {
  tmp = makeTmp();
  // Inject an empty Claude Code map so tests don't scan the developer's real
  // ~/.claude/projects/ directory (slow + flaky depending on which machine
  // the suite runs on). Tests that need a populated map can re-construct.
  dash = new DashboardState(tmp, async () => new Map());
});
afterEach(() => {
  try {
    fs.rmSync(path.dirname(tmp.eventsFile), { recursive: true, force: true });
  } catch {
    /* leak the tmpdir; OS will reap */
  }
});

// ---- dashboardPath route table -------------------------------------------

describe('dashboardPath()', () => {
  it('matches the main HTML routes', () => {
    expect(dashboardPath('/')?.kind).toBe('html');
    expect(dashboardPath('/dashboard')?.kind).toBe('html');
  });

  it('handles browser icon probes locally', () => {
    expect(dashboardPath('/favicon.ico')?.kind).toBe('icon');
    expect(dashboardPath('/apple-touch-icon.png')?.kind).toBe('icon');
    expect(dashboardPath('/apple-touch-icon-precomposed.png')?.kind).toBe('icon');
  });

  it('matches the legacy live-poll routes', () => {
    expect(dashboardPath('/proxy-stats')?.kind).toBe('stats');
    expect(dashboardPath('/proxy-recent')?.kind).toBe('recent');
    expect(dashboardPath('/proxy-latest-png')?.kind).toBe('png');
  });

  it('matches the new /api/* routes', () => {
    expect(dashboardPath('/api/sessions.json')?.kind).toBe('api-sessions');
    expect(dashboardPath('/api/stats.json')?.kind).toBe('api-stats');
  });

  it('returns null for unknown paths', () => {
    expect(dashboardPath('/v1/messages')).toBeNull();
    expect(dashboardPath('/api/whatever.json')).toBeNull();
    // The per-session detail routes were cut — these no longer match.
    expect(dashboardPath('/api/sessions/abc12345.json')).toBeNull();
    expect(dashboardPath('/sessions/abc12345')).toBeNull();
  });
});

describe('dashboardMutationAllowed()', () => {
  it('blocks cross-site dashboard mutations', () => {
    expect(dashboardMutationAllowed('http://127.0.0.1:47821', 'http://127.0.0.1:47821', 'same-origin')).toBe(true);
    expect(dashboardMutationAllowed('https://example.com', 'http://127.0.0.1:47821', 'cross-site')).toBe(false);
    expect(dashboardMutationAllowed(undefined, 'http://127.0.0.1:47821', 'cross-site')).toBe(false);
    expect(dashboardMutationAllowed('not a url', 'http://127.0.0.1:47821', undefined)).toBe(false);
  });

  it('CONTRACT: allows requests with no Origin and no Sec-Fetch-Site header', () => {
    // Deliberate: curl/CLI tools send neither header, and the loopback-only
    // default bind means such callers are local. Browsers always attach
    // Origin (or Sec-Fetch-Site) to cross-origin POSTs, so CSRF is still
    // covered by the two checks above. If this behavior ever tightens
    // (breaking `curl -X POST /api/compression`), this test must change
    // WITH the README/ops docs — that's why it's pinned.
    expect(dashboardMutationAllowed(undefined, 'http://127.0.0.1:47821', undefined)).toBe(true);
    // no Origin but an explicit same-origin fetch-site is also fine
    expect(dashboardMutationAllowed(undefined, 'http://127.0.0.1:47821', 'none')).toBe(true);
  });
});

// ---- /api/sessions.json --------------------------------------------------

describe('serveSessionsJson', () => {
  it('returns a list of grouped sessions with claudeCode null when no ~/.claude/projects/ match', async () => {
    writeEvents(tmp, [
      ev({ first_user_sha8: 'aaaaaaaa', cwd: '/x', ts: '2026-05-19T00:00:00Z' }),
      ev({ first_user_sha8: 'aaaaaaaa', cwd: '/x', ts: '2026-05-19T00:01:00Z' }),
      ev({ first_user_sha8: 'bbbbbbbb', cwd: '/y', ts: '2026-05-19T00:02:00Z' }),
    ]);
    const res = await dash.serveSessionsJson();
    expect(res.status).toBe(200);
    const body = await res.json() as SessionsJson;
    expect(body.count).toBe(2);
    expect(body.sessions).toHaveLength(2);
    // Most-recent-first
    expect(body.sessions[0]!.id).toBe('bbbbbbbb');
    expect(body.sessions[1]!.id).toBe('aaaaaaaa');
    expect(body.sessions[0]!.claudeCode).toBeNull();
  });

  it('respects ?project filtering', async () => {
    writeEvents(tmp, [
      ev({ first_user_sha8: 'aaaaaaaa', cwd: '/Users/me/code/imgtokenx' }),
      ev({ first_user_sha8: 'bbbbbbbb', cwd: '/Users/me/code/other' }),
    ]);
    const res = await dash.serveSessionsJson({ project: 'imgtokenx' });
    const body = await res.json() as SessionsJson;
    expect(body.count).toBe(1);
    expect(body.sessions[0]!.id).toBe('aaaaaaaa');
  });

  it('returns 503 when DashboardState was built without paths', async () => {
    const bare = new DashboardState();
    const res = await bare.serveSessionsJson();
    expect(res.status).toBe(503);
  });
});

// ---- /api/stats.json ------------------------------------

describe('serveApiStats', () => {
  it('aggregates the events file into a Summary-shaped JSON', async () => {
    writeEvents(tmp, [
      ev({ status: 200, compressed: true, orig_chars: 1000, image_bytes: 200 }),
      ev({ status: 200, compressed: true, orig_chars: 2000, image_bytes: 300 }),
      ev({ status: 400, compressed: false }),
    ]);
    const res = await dash.serveApiStats();
    expect(res.status).toBe(200);
    const body = await res.json() as ApiStatsJson;
    expect(body.parsed).toBe(3);
    expect(body.summary.total).toBe(3);
    expect(body.summary.ok2xx).toBe(2);
    expect(body.summary.err4xx).toBe(1);
    expect(body.summary.compressed).toBe(2);
    expect(body.summary.passthrough).toBe(1);
    expect(body.summary.origCharsTotal).toBe(3000);
    expect(body.summary.imageBytesTotal).toBe(500);
  });

  it('404s when no events file exists', async () => {
    const res = await dash.serveApiStats();
    expect(res.status).toBe(404);
  });
});

// ---- /fragments/* (htmx server-rendered HTML) ------------------------

describe('serveFragment', () => {
  const url = new URL('http://localhost/fragments/x');

  it('routes /fragments/<name> via dashboardPath', () => {
    expect(dashboardPath('/fragments/header')).toEqual({ kind: 'fragment', name: 'header' });
    expect(dashboardPath('/fragments/latest')).toEqual({ kind: 'fragment', name: 'latest' });
  });

  it('renders the toggle fragment reflecting compression state', async () => {
    const on = await dash.serveFragment('toggle', url, 1234);
    expect(on.headers.get('content-type')).toContain('text/html');
    expect(await on.text()).toContain('Turn imgtokenx off');
    dash.handleCompressionToggle({ enabled: false });
    const off = await dash.serveFragment('toggle', url, 1234);
    const offHtml = await off.text();
    expect(offHtml).toContain('IMGTOKENX OFF');
    expect(offHtml).toContain('Turn imgtokenx on');
    expect(offHtml).toContain('. ~/.imgtokenx/env.sh');
    expect(offHtml).toContain('saved history, not live traffic');
    dash.handleCompressionToggle({ enabled: true });
  });

  it('mutating buttons JSON-encode via the json-vals htmx extension (endpoints are strict-JSON)', async () => {
    // Regression: audit D19 made /fragments/models and /fragments/toggle
    // reject non-JSON bodies, but htmx posts urlencoded by default — every
    // dashboard chip/toggle click 400ed until the buttons opted into the
    // inline json-vals extension.
    const toggle = await (await dash.serveFragment('toggle', url, 1234)).text();
    expect(toggle).toContain('hx-ext="json-vals"');
    const models = await (await dash.serveFragment('models', url, 1234)).text();
    expect(models).toContain('hx-ext="json-vals"');
    const { renderPage } = await import('../src/dashboard/fragments.js');
    expect(renderPage(1234)).toContain("htmx.defineExtension('json-vals'");
  });

  it('sends every toggle to the durable global-state writer', async () => {
    const persisted: boolean[] = [];
    const persistentDash = new DashboardState(
      tmp,
      async () => new Map(),
      undefined,
      (enabled) => { persisted.push(enabled); },
    );

    persistentDash.handleCompressionToggle({ enabled: false });
    persistentDash.handleCompressionToggle({ enabled: true });

    expect(persisted).toEqual([false, true]);
  });

  it('keeps the dashboard off when a process-level override refuses enablement', async () => {
    const forcedOff = new DashboardState(tmp, async () => new Map(), undefined, () => false);
    const body = await forcedOff.handleCompressionToggle({ enabled: true }).json() as {
      compression_enabled: boolean;
    };

    expect(body.compression_enabled).toBe(false);
    expect(forcedOff.getCompressionEnabled()).toBe(false);
  });

  it('renders reader-safe model policy and mutates the single model scope', async () => {
    const prev = process.env.IMGTOKENX_MODELS;
    const prevProfiles = process.env.IMGTOKENX_READER_PROFILES;
    try {
      delete process.env.IMGTOKENX_MODELS;
      delete process.env.IMGTOKENX_READER_PROFILES;
      setAllowedModelBases(null); // reset to built-in Fable-only scope
      const on = await (await dash.serveFragment('models', url, 1234)).text();
      expect(on).toContain('Reader policy');
      expect(on).toContain('Every model stays usable');
      expect(on).toContain('Uncalibrated models · text only');
      expect(on).toContain('Claude Code');
      expect(on).toContain('Codex API mode');
      expect(on).toContain('OpenCode');
      expect(on).toContain('Codex App with ChatGPT login runs direct');
      expect(on).not.toContain('Cloudflare gateway');
      expect(on).toContain('OpenAI scope');
      expect(on).not.toContain('style="display:none"');
      // GPT profiles are visible, but no GPT model is silently enabled.
      expect(on).toContain('GPT 5.6</span><span class="chip-mode">image 5×8');
      expect(on).toContain('GPT 5.6 Sol</span><span class="chip-mode">text only');
      expect(on).toContain('GPT 5.5</span><span class="chip-mode">text only');
      expect(on).toContain('Opus 4.8');
      expect(on).toContain('image 20×32');
      // Calibrated 2026-07-10 (keyless sweep): Haiku 4.5 images at 20×32.
      // Recalibrated 2026-07-13 (keyless sweep): Sonnet 5 images at 12×20.
      expect(on).toContain('Sonnet 5</span><span class="chip-mode">image 12×20');
      expect(on).toContain('Haiku 4.5</span><span class="chip-mode">image 20×32');
      // Sonnet 4.6 stays uncalibrated.
      expect(on).toContain('Sonnet 4.6</span><span class="chip-mode">text only');
      // Generic GPT 5.6, its Sol profile, then GPT 5.5.
      expect(on.indexOf('GPT 5.6')).toBeLessThan(on.indexOf('GPT 5.6 Sol'));
      expect(on.indexOf('GPT 5.6 Sol')).toBeLessThan(on.indexOf('GPT 5.5'));
      expect(getAllowedModelBases()).not.toContain('gpt-5.6');
      expect(getAllowedModelBases()).not.toContain('gpt-5.5');

      dash.handleModelsToggle('gpt-5.6-sol', true);
      dash.handleModelsToggle('gpt-5.5', true);
      const onBoth = await (await dash.serveFragment('models', url, 1234)).text();
      expect(onBoth).toContain('GPT 5.5 ✓</span><span class="chip-mode">text only');
      expect(onBoth).toContain('GPT 5.6 Sol ✓</span><span class="chip-mode">text only');
      expect(getAllowedModelBases()).toContain('gpt-5.5');
      expect(getAllowedModelBases()).toContain('gpt-5.6-sol');

      dash.handleModelsToggle('custom-"model', true);
      const custom = await (await dash.serveFragment('models', url, 1234)).text();
      expect(custom).toContain('Custom scope');
      const claudeScope = custom.slice(custom.indexOf('Claude scope'), custom.indexOf('OpenAI scope'));
      const customScope = custom.slice(custom.indexOf('Custom scope'));
      expect(claudeScope).not.toContain('custom-&quot;model');
      expect(customScope).toContain('custom-&quot;model');
      expect(custom).toContain('text only');
    } finally {
      setAllowedModelBases(null);
      if (prev === undefined) delete process.env.IMGTOKENX_MODELS;
      else process.env.IMGTOKENX_MODELS = prev;
      if (prevProfiles === undefined) delete process.env.IMGTOKENX_READER_PROFILES;
      else process.env.IMGTOKENX_READER_PROFILES = prevProfiles;
    }
  });

  it('persists model choices before changing runtime state', () => {
    const saved: string[][] = [];
    const persistentDash = new DashboardState(
      undefined,
      undefined,
      (models) => saved.push([...models]),
    );
    setAllowedModelBases(['gpt-5.6']);
    try {
      persistentDash.handleModelsToggle('gpt-5.5', true);
      expect(saved).toEqual([['gpt-5.6', 'gpt-5.5']]);
      expect(getAllowedModelBases()).toEqual(['gpt-5.6', 'gpt-5.5']);

      const failingDash = new DashboardState(undefined, undefined, () => {
        throw new Error('disk full');
      });
      expect(() => failingDash.handleModelsToggle('claude-fable-5', true)).toThrow('disk full');
      expect(getAllowedModelBases()).toEqual(['gpt-5.6', 'gpt-5.5']);
    } finally {
      setAllowedModelBases(null);
    }
  });

  it('renders header + recent + stats fragments from the same payloads as JSON', async () => {
    writeEvents(tmp, [
      ev({ status: 200, model: 'gpt-5.5', compressed: true, orig_chars: 1000, image_bytes: 200 }),
    ]);
    const header = await (await dash.serveFragment('header', url, 4711)).text();
    expect(header).toContain('4711');
    await dash.replay(tmp.eventsFile);
    const recent = await (await dash.serveFragment('recent', url, 4711)).text();
    expect(recent).toContain('<table');
    expect(recent).toContain('gpt-5.5');
    const stats = await (await dash.serveFragment('stats', url, 4711)).text();
    expect(stats).toContain('requests');
  });

  it('escapes HTML in latest source text', async () => {
    dash.captureImage({
      imagePngs: [new Uint8Array([137, 80, 78, 71])],
      imageDims: [{ width: 100, height: 80 }],
      imageSourceText: '<script>alert(1)</script>',
    } as never);
    const srcUrl = new URL('http://localhost/fragments/latest?source=1');
    const html = await (await dash.serveFragment('latest', srcUrl, 1)).text();
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('404s unknown fragments', async () => {
    const res = await dash.serveFragment('nope', url, 1);
    expect(res.status).toBe(404);
  });
});

// ---- GPT (OpenAI) savings split ------------------------------------------
// The dashboard math was built entirely around the Anthropic cache-aware
// baseline, so GPT rows used to surface all-zero columns. These lock the
// GPT branch in update()/replay(): vision-token actual vs o200k text-token
// baseline, 0.1× automatic prefix cache, no count_tokens probe.
describe('GPT savings split', () => {
  // Imaged 50k o200k text tokens down to 8k vision tokens, with a 2k cached
  // prefix served at 0.1×:
  //   actual   = (10000 - 2000) + 2000×0.1               = 8200
  //   baseline = actual + (50000 - 8000)×0.1             = 12400
  //   saved    = baseline - actual                       = 4200
  const gptUpdate = {
    method: 'POST',
    path: '/openai/responses',
    model: 'gpt-5.5',
    status: 200,
    durationMs: 100,
    usage: { input_tokens: 10000, output_tokens: 200, cached_tokens: 2000 },
    info: {
      compressed: true,
      imageTokens: 8000,
      baselineImagedTokens: 50000,
      imageCount: 1,
      firstUserSha8: 'gptsess1',
    },
  };

  it('credits GPT savings on a compressed Responses request (live update + stats)', async () => {
    dash.update(structuredClone(gptUpdate) as never);
    const stats = (await dash.serveStats().json()) as StatsPayload;
    expect(stats.requests).toBe(1);
    expect(stats.actual_input_weighted).toBe(8200);
    expect(stats.baseline_input_weighted).toBe(12400);
    expect(stats.saved_input_tokens).toBe(4200);
    expect(stats.saved_pct_input_only).toBeGreaterThan(0);
  });

  it('populates As-text / Sent / Cache-hits / Saved recent columns for GPT', async () => {
    dash.update(structuredClone(gptUpdate) as never);
    const recent = (await dash.serveRecent().json()) as RecentPayload;
    const row = recent.recent.at(-1)!;
    expect(row.path).toContain('responses');
    expect(row.cc_added).toBe(1); // "Sent as" → imaged
    expect(row.cache_read).toBe(2000); // cached_tokens, NOT Anthropic cache_read
    expect(row.baseline_input).toBe(12400); // "As text"
    expect(row.actual_input).toBe(8200); // "Sent"
    expect(row.session_saved_so_far_delta).toBe(4200); // "Saved"
  });

  it('prices a GPT cold turn (cached_tokens=0) at the FULL text delta, not the 0.1× warm rate', async () => {
    // Parity with the Anthropic cold-miss test: when OpenAI reports no cached
    // tokens, the text counterfactual was cold too, so the whole text↔image
    // delta is credited at 1.0× (not 0.1×). Under-pricing it here would HIDE a
    // real win; over-pricing it on a warm turn would FABRICATE one — both wrong.
    //   actual   = 10000 (no cache discount)
    //   baseline = 10000 + (50000 - 8000)×1.0 = 52000
    //   saved    = 42000
    dash.update({
      ...structuredClone(gptUpdate),
      usage: { input_tokens: 10000, output_tokens: 200, cached_tokens: 0 },
      info: { ...structuredClone(gptUpdate.info), firstUserSha8: 'gptcold' },
    } as never);
    const stats = (await dash.serveStats().json()) as StatsPayload;
    expect(stats.actual_input_weighted).toBe(10000);
    expect(stats.baseline_input_weighted).toBe(52000);
    expect(stats.saved_input_tokens).toBe(42000);
    const recent = (await dash.serveRecent().json()) as RecentPayload;
    const row = recent.recent.at(-1)!;
    expect(row.cache_read).toBe(0);
    expect(row.baseline_input).toBe(52000);
    expect(row.actual_input).toBe(10000);
  });

  it('does not credit savings on an uncompressed GPT passthrough row', async () => {
    dash.update({
      ...structuredClone(gptUpdate),
      info: {
        compressed: false,
        imageTokens: 0,
        baselineImagedTokens: 0,
        firstUserSha8: 'gptsess2',
      },
    } as never);
    const stats = (await dash.serveStats().json()) as StatsPayload;
    expect(stats.saved_input_tokens).toBe(0);
    const recent = (await dash.serveRecent().json()) as RecentPayload;
    expect(recent.recent.at(-1)!.session_saved_so_far_delta ?? 0).toBe(0);
  });

  it('replay() reconstructs GPT recent rows byte-identically to the live path', async () => {
    writeEvents(tmp, [
      ev({
        path: '/openai/responses',
        model: 'gpt-5.5',
        compressed: true,
        input_tokens: 10000,
        output_tokens: 200,
        cached_tokens: 2000,
        image_tokens: 8000,
        baseline_imaged_tokens: 50000,
        image_count: 1,
        first_user_sha8: 'gptsess1',
      }),
    ]);
    await dash.replay(tmp.eventsFile);
    const recent = (await dash.serveRecent().json()) as RecentPayload;
    const row = recent.recent.at(-1)!;
    expect(row.cache_read).toBe(2000);
    expect(row.baseline_input).toBe(12400);
    expect(row.actual_input).toBe(8200);
    expect(row.session_saved_so_far_delta).toBe(4200);
  });
});

describe('server-observed warmth: text follows actual cache_read', () => {
  // The text counterfactual is hypothetical, so its cache state follows the only
  // server-observed signal we have: cr>0 means warm for both paths, cr===0 means
  // cold for both paths. A prior row only refines reused/grown split after cr>0.
  function antEvt(
    usage: {
      input_tokens: number;
      output_tokens: number;
      cache_creation_input_tokens: number;
      cache_read_input_tokens: number;
    },
    cacheable: number,
    sid = 'warmsess',
    systemSha8 = 'stable-system',
  ): unknown {
    return {
      ts: '2026-05-19T00:00:00Z',
      method: 'POST',
      path: '/v1/messages',
      model: 'claude-opus-4',
      status: 200,
      duration_ms: 100,
      usage,
      info: {
        compressed: true,
        firstUserSha8: sid,
        systemSha8,
        baselineProbeStatus: 'ok',
        baselineTokens: 30000, // text counterfactual: full prefix + tail
        baselineCacheableTokens: cacheable, // prefix up to the cache_control marker
      },
    };
  }

  it('prices text cold when the actual image request has cache_read=0', async () => {
    // Turn 1 records a prior prefix size, but it must not make a later cr=0 row
    // warm by wall-clock inference alone.
    dash.update(
      antEvt(
        {
          input_tokens: 100,
          output_tokens: 50,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 20000, // warm read
        },
        20000,
      ) as never,
    );

    // Turn 2: actual request has cache_read === 0 and pays a full re-create.
    // The imagined text path gets the same cold cache state.
    dash.update(
      antEvt(
        {
          input_tokens: 100,
          output_tokens: 50,
          cache_creation_input_tokens: 20000, // re-created the whole prefix
          cache_read_input_tokens: 0, // ← the image-cache miss
        },
        20000,
      ) as never,
    );

    const recent = (await dash.serveRecent().json()) as RecentPayload;
    const miss = recent.recent.at(-1)!;

    // imgtokenx's image really did miss — it paid the cold create this turn.
    expect(miss.cache_read).toBe(0);

    // actual = 100 + 20000×1.25 = 25100 (what imgtokenx actually paid this turn).
    expect(miss.actual_input).toBe(25100);

    // Cold text baseline: 20000×1.25 + 10000 tail = 35000.
    expect(miss.baseline_input).toBe(35000);
    expect(miss.session_saved_so_far_delta).toBe(9900);
  });

  it('does not let an overlapping request warm the text counterfactual before it completed', async () => {
    writeEvents(tmp, [
      ev({
        ts: '2026-05-19T00:00:20.000Z',
        duration_ms: 20_000,
        compressed: true,
        first_user_sha8: 'overlap',
        system_sha8: 'stable-system',
        baseline_probe_status: 'ok',
        baseline_tokens: 30_000,
        baseline_cacheable_tokens: 20_000,
        input_tokens: 100,
        output_tokens: 50,
        cache_create_tokens: 20_000,
        cache_read_tokens: 0,
      }),
      ev({
        // Starts at 00:00:15, five seconds BEFORE the prior request completed.
        // cr>0 proves warmth, but that prior could not refine the text baseline's
        // reused/grown split for this in-flight request.
        ts: '2026-05-19T00:00:25.000Z',
        duration_ms: 10_000,
        compressed: true,
        first_user_sha8: 'overlap',
        system_sha8: 'stable-system',
        baseline_probe_status: 'ok',
        baseline_tokens: 32_000,
        baseline_cacheable_tokens: 22_000,
        input_tokens: 100,
        output_tokens: 50,
        cache_create_tokens: 2_000,
        cache_read_tokens: 20_000,
      }),
    ]);
    await dash.replay(tmp.eventsFile);

    const recent = (await dash.serveRecent().json()) as RecentPayload;
    const overlap = recent.recent.at(-1)!;
    expect(overlap.cache_read).toBe(20000);
    expect(overlap.actual_input).toBe(4600);
    // Warm via cr>0, but no completed prior was available at send time, so the
    // text baseline assumes full reuse instead of using the overlapping prior:
    // 22000×0.1 + 10000 tail = 12200.
    expect(overlap.baseline_input).toBe(12200);
    expect(overlap.session_saved_so_far_delta).toBe(7600);
  });

  it('prices text cold when cache_read=0 even if the static prefix hash changed inside the old TTL window', async () => {
    dash.update(
      antEvt(
        {
          input_tokens: 100,
          output_tokens: 50,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 20000,
        },
        20000,
        'hashsess',
        'old-system',
      ) as never,
    );

    dash.update(
      antEvt(
        {
          input_tokens: 100,
          output_tokens: 50,
          cache_creation_input_tokens: 20000,
          cache_read_input_tokens: 0,
        },
        20000,
        'hashsess',
        'new-system',
      ) as never,
    );

    const recent = (await dash.serveRecent().json()) as RecentPayload;
    const changed = recent.recent.at(-1)!;
    // cache_read=0, so the text path is cold too:
    // baseline = 20000*1.25 + 10000 tail = 35000, not warm 12000.
    expect(changed.baseline_input).toBe(35000);
    expect(changed.session_saved_so_far_delta).toBe(9900);
  });

  it('still prices a genuine warm turn warm (cr>0 reads the prefix cheaply)', async () => {
    // Prime, then a real warm turn: cache_read > 0, small growth.
    dash.update(
      antEvt(
        {
          input_tokens: 100,
          output_tokens: 50,
          cache_creation_input_tokens: 20000,
          cache_read_input_tokens: 0,
        },
        20000,
      ) as never,
    );
    dash.update(
      antEvt(
        {
          input_tokens: 100,
          output_tokens: 50,
          cache_creation_input_tokens: 2000, // grew the prefix by 2000
          cache_read_input_tokens: 20000, // warm read of the rest
        },
        22000,
      ) as never,
    );

    const recent = (await dash.serveRecent().json()) as RecentPayload;
    const warm = recent.recent.at(-1)!;
    expect(warm.cache_read).toBe(20000);
    // actual = 100 + 2000×1.25 + 20000×0.1 = 4600.
    expect(warm.actual_input).toBe(4600);
    // warm baseline: 20000×0.1 (reused) + 2000×1.25 (grown) + 8000 tail = 12500.
    expect(warm.baseline_input).toBe(12500);
    expect(warm.session_saved_so_far_delta).toBe(7900);
  });

  it('prices a warm read warm even with NO prior warmth state (post-restart)', async () => {
    // The cache is already warm on Anthropic's side (cr>0), but this process has
    // never seen the session — exactly the first turn after an imgtokenx restart or a
    // SESSION_CAP eviction. The OLD code required
    // an in-memory warmthPrev entry, so it fell through to the COLD branch and
    // billed the known-cached prefix the 1.25× CREATE rate — fabricating the
    // inflated "99% saved" row the operator reported. cr>0 is direct proof the
    // prefix was cached, so it must be priced as a warm READ.
    dash.update(
      antEvt(
        {
          input_tokens: 100,
          output_tokens: 50,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 20000, // warm read on the FIRST turn we see
        },
        20000,
        'restartsess', // never primed in this process
      ) as never,
    );

    const recent = (await dash.serveRecent().json()) as RecentPayload;
    const row = recent.recent.at(-1)!;
    expect(row.cache_read).toBe(20000);

    // actual = 100 + 20000×0.1 = 2100 (we paid the warm read rate).
    expect(row.actual_input).toBe(2100);

    // Warm baseline with full prefix reuse (no prior ⇒ prevCacheable = cacheable):
    // 20000×0.1 (reused) + 0 (grown) + 10000 tail = 12000. NOT the cold
    // 20000×1.25 + 10000 = 35000 the old code produced (which would have shown a
    // 32900-token / ~94% "saved" against a 2100-token actual — the inflated row).
    expect(row.baseline_input).toBe(12000);
    expect(row.baseline_input).not.toBe(35000); // the inflated cold-priced bug value
    expect(row.session_saved_so_far_delta).toBe(9900);
  });
});

describe('security headers', () => {
  it('serveHtml carries CSP + nosniff + frame denial', () => {
    const res = dash.serveHtml(1234);
    const csp = res.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("img-src 'self' data:");
    // htmx needs inline + eval; everything else stays same-origin.
    expect(csp).toContain("script-src 'self' 'unsafe-inline' 'unsafe-eval'");
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
  });

  it('JSON and PNG endpoints carry nosniff', async () => {
    const stats = dash.serveStats();
    expect(stats.headers.get('x-content-type-options')).toBe('nosniff');
    // servePng with no image is a 404 text response; seed one via recordImage
    // if available, otherwise assert the JSON error path on image-source.
    const src = dash.serveImageSource();
    expect(src.status).toBe(404);
    expect(src.headers.get('x-content-type-options')).toBe('nosniff');
  });
});

describe('virtual-context telemetry', () => {
  it('reports aggregate artifact and character counters without source content', async () => {
    dash.update({
      method: 'POST',
      path: '/v1/responses',
      status: 200,
      durationMs: 10,
      info: {
        compressed: true,
        origChars: 20_000,
        compressedChars: 0,
        imageCount: 0,
        imageBytes: 0,
        staticChars: 0,
        dynamicChars: 0,
        dynamicBlockCount: 0,
        virtualContextMode: 'lazy',
        artifactCandidates: 3,
        artifactWrites: 2,
        sourceCharsVirtualized: 18_000,
        virtualizedCharsRemoved: 14_000,
        duplicateCharsRemoved: 9_000,
        previewCharsSent: 4_000,
        deltaArtifacts: 2,
        deltaCharsSent: 700,
        deltaCharsRemoved: 8_000,
        checkpointApplied: true,
        stateCharsRemoved: 5_000,
        contextToolCalls: 4,
        contextToolSuccesses: 3,
        contextResultChars: 2_500,
        workspaceInspectCalls: 2,
      },
    });
    const stats = await dash.serveStats().json() as StatsPayload;
    expect(stats.artifact_candidates).toBe(3);
    expect(stats.artifact_writes).toBe(2);
    expect(stats.source_chars_virtualized).toBe(18_000);
    expect(stats.virtualized_chars_removed).toBe(14_000);
    expect(stats.duplicate_chars_removed).toBe(9_000);
    expect(stats.preview_chars_sent).toBe(4_000);
    expect(stats.delta_artifacts).toBe(2);
    expect(stats.delta_chars_sent).toBe(700);
    expect(stats.delta_chars_removed).toBe(8_000);
    expect(stats.checkpoints_applied).toBe(1);
    expect(stats.state_chars_removed).toBe(5_000);
    expect(stats.context_tool_calls).toBe(4);
    expect(stats.context_tool_successes).toBe(3);
    expect(stats.context_result_chars).toBe(2_500);
    expect(stats.workspace_inspect_calls).toBe(2);
  });
});
