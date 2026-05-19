/**
 * Regression tests for DashboardState.fitCosts() — the empirical
 * α (chars/token) + β (pixels/token) regression that powers honest
 * `saved_pct` in the live dashboard.
 *
 * Specifically locks in: warm-cache-hit requests MUST seed the fit ring.
 * Anthropic's tokenizer is deterministic on input bytes; cache state
 * changes billing, not token count. An earlier version of the gate
 * required `cache_read === 0` ("true cold miss") which locked the fit
 * out of all normal traffic — these tests prevent that regression.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { DashboardState } from '../src/dashboard.js';
import type { SessionsPaths } from '../src/sessions.js';
import type { ProxyEvent } from '../src/core/proxy.js';

function makeTmp(): SessionsPaths {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pixelpipe-fit-'));
  return {
    eventsFile: path.join(dir, 'events.jsonl'),
    sidecarDir: path.join(dir, '4xx-bodies'),
  };
}

/** Build a synthetic ProxyEvent at the level fitCosts cares about. The
 *  numbers are toy — what matters for the gate is shape (compressed, full
 *  usage triple, both new measurements present, totalTokens > 1000). */
function ev(args: {
  textChars: number;
  pixels: number;
  input: number;
  cacheCreate: number;
  cacheRead: number;
  output?: number;
  compressedChars?: number;
  imageCount?: number;
}): ProxyEvent {
  const compressedChars = args.compressedChars ?? 50_000;
  const imageCount = args.imageCount ?? 5;
  return {
    method: 'POST',
    path: '/v1/messages',
    status: 200,
    durationMs: 100,
    info: {
      compressed: true,
      origChars: args.textChars + compressedChars,
      compressedChars,
      imageCount,
      imageBytes: 200_000,
      imagePixels: args.pixels,
      outgoingTextChars: args.textChars,
      staticChars: 30_000,
      dynamicChars: 200,
      dynamicBlockCount: 1,
    },
    usage: {
      input_tokens: args.input,
      output_tokens: args.output ?? 50,
      cache_creation_input_tokens: args.cacheCreate,
      cache_read_input_tokens: args.cacheRead,
    },
  };
}

let dash: DashboardState;
beforeEach(() => {
  // Tmp paths so the fit-ring isn't seeded from any real history.
  const tmp = makeTmp();
  dash = new DashboardState(tmp, async () => new Map());
});

describe('DashboardState.fitCosts() — empirical α/β regression', () => {
  it('returns null with fewer than 3 samples', () => {
    dash.update(ev({ textChars: 130_000, pixels: 21_000_000, input: 10, cacheCreate: 5_000, cacheRead: 0 }));
    dash.update(ev({ textChars: 132_000, pixels: 23_000_000, input: 10, cacheCreate: 0, cacheRead: 130_000 }));
    expect(dash.fitCosts()).toBeNull();
  });

  it('falls back to constrained (β pinned) when pixels column is constant', () => {
    // Single-session-style traffic: cached image is identical across warm
    // hits → `pixels` is collinear. Joint OLS can't split α and β so we
    // fall back to β = 1/750 (Anthropic's published rate) and solve α only
    // from the text-vs-(tokens - β·pixels) residuals. The headline number
    // still has a measured α; only β leans on docs.
    // Text varies enough (CV > 5%) to pass the α-identification gate, but
    // pixels are pinned to the same cached-image area so β can't be measured.
    dash.update(ev({ textChars:  80_000, pixels: 21_000_000, input: 5, cacheCreate: 500, cacheRead:  50_000 }));
    dash.update(ev({ textChars: 130_000, pixels: 21_000_000, input: 5, cacheCreate: 300, cacheRead:  80_000 }));
    dash.update(ev({ textChars: 180_000, pixels: 21_000_000, input: 5, cacheCreate: 200, cacheRead: 110_000 }));
    const fit = dash.fitCosts();
    expect(fit).not.toBeNull();
    expect(fit!.mode).toBe('constrained');
    // β is pinned to Anthropic's 1/750 ≈ 0.001333 (rounded to 3 sig figs).
    expect(fit!.beta).toBeCloseTo(0.001, 3);
    expect(fit!.pixels_per_token).toBe(750);
    // α is measured — should be positive and recover a sensible chars/token.
    expect(fit!.alpha).toBeGreaterThan(0);
    expect(fit!.chars_per_token).toBeGreaterThan(0);
    expect(fit!.n).toBe(3);
  });

  it('returns null when text_chars column is constant', () => {
    // Mirror case — same body shape across samples, only cache state varies.
    // Without text variance, α is unidentifiable in EITHER joint or
    // constrained mode (constrained still needs text to vary).
    dash.update(ev({ textChars: 130_000, pixels: 21_000_000, input: 5, cacheCreate: 500, cacheRead: 141_680 }));
    dash.update(ev({ textChars: 130_000, pixels: 23_000_000, input: 5, cacheCreate: 300, cacheRead: 142_447 }));
    dash.update(ev({ textChars: 130_000, pixels: 25_000_000, input: 5, cacheCreate: 200, cacheRead: 143_119 }));
    expect(dash.fitCosts()).toBeNull();
  });

  it('constrained-mode CV threshold (2%) accommodates real single-session text variance', () => {
    // Live single-session-warm-cache traffic from 2026-05-19: three turns
    // hit the proxy with text chars 117,927 / 127,512 / 128,588 and the
    // SAME cached image (pixels constant at 22,792,816). Text CV = 3.84%.
    // Under the original joint-mode-only 5% gate this returned null and the
    // dashboard fell back to wandering stale constants. The split-threshold
    // version activates constrained mode here (β pinned, α measured) so
    // the operator gets a measured-α answer instead of stale constants.
    dash.update(ev({ textChars: 117_927, pixels: 22_792_816, input: 6, cacheCreate: 1116, cacheRead: 124_236 }));
    dash.update(ev({ textChars: 127_512, pixels: 22_792_816, input: 476, cacheCreate: 6103, cacheRead: 125_352 }));
    dash.update(ev({ textChars: 128_588, pixels: 22_792_816, input: 1, cacheCreate: 2432, cacheRead: 131_455 }));
    const fit = dash.fitCosts();
    expect(fit).not.toBeNull();
    expect(fit!.mode).toBe('constrained');
    expect(fit!.alpha).toBeGreaterThan(0);
  });

  it('activates constrained mode at real steady-state 1-2% text CV', () => {
    // Live-traffic-shape: 6 samples with 1.33% text CV and pixels exactly
    // constant. Pre-fix (2% gate) this returned null and the dashboard
    // stuck on stale constants — the regression we're guarding against.
    // Post-fix the constrained formula α=Σ(r·x)/Σ(x²) runs (numerically
    // fine at any non-zero text variance) and surfaces text_cv so the
    // operator sees confidence directly.
    dash.update(ev({ textChars: 132_738, pixels: 22_792_816, input: 6, cacheCreate: 710,  cacheRead: 142_547 }));
    dash.update(ev({ textChars: 133_021, pixels: 22_792_816, input: 1, cacheCreate: 316,  cacheRead: 143_257 }));
    dash.update(ev({ textChars: 133_610, pixels: 22_792_816, input: 1, cacheCreate: 1000, cacheRead: 143_573 }));
    dash.update(ev({ textChars: 134_105, pixels: 22_792_816, input: 1, cacheCreate: 1170, cacheRead: 144_068 }));
    dash.update(ev({ textChars: 134_718, pixels: 22_792_816, input: 1, cacheCreate: 1380, cacheRead: 145_330 }));
    dash.update(ev({ textChars: 138_097, pixels: 22_792_816, input: 1, cacheCreate: 2200, cacheRead: 146_148 }));
    const fit = dash.fitCosts();
    expect(fit).not.toBeNull();
    expect(fit!.mode).toBe('constrained');
    expect(fit!.text_cv).toBeGreaterThan(0.005); // ~1.3% in this fixture
    expect(fit!.text_cv).toBeLessThan(0.05);
    expect(fit!.pixels_cv).toBe(0);
    expect(fit!.alpha).toBeGreaterThan(0);
  });

  it('still rejects literally-byte-identical text (degenerate floor)', () => {
    // Pathological case: all samples have IDENTICAL text. cvX = 0. We
    // require at least 0.1% variance to fit — below that we'd be dividing
    // mean residual by mean text with no information about slope.
    dash.update(ev({ textChars: 130_000, pixels: 22_792_816, input: 6, cacheCreate: 1116, cacheRead: 124_236 }));
    dash.update(ev({ textChars: 130_000, pixels: 22_792_816, input: 6, cacheCreate: 1116, cacheRead: 124_236 }));
    dash.update(ev({ textChars: 130_000, pixels: 22_792_816, input: 6, cacheCreate: 1116, cacheRead: 124_236 }));
    expect(dash.fitCosts()).toBeNull();
  });

  it('returns mode="joint" when both columns vary (full empirical fit)', () => {
    // Both columns vary > 5% — joint OLS is identifiable. mode tags the
    // headline number as fully empirical so the operator can distinguish
    // this from a constrained-β regime in the dashboard label.
    dash.update(ev({ textChars: 100_000, pixels: 10_000_000, input: 5, cacheCreate: 500, cacheRead:  43_095 }));
    dash.update(ev({ textChars: 130_000, pixels: 18_000_000, input: 5, cacheCreate: 300, cacheRead:  63_875 }));
    dash.update(ev({ textChars: 160_000, pixels: 24_000_000, input: 5, cacheCreate: 200, cacheRead:  81_555 }));
    const fit = dash.fitCosts();
    expect(fit).not.toBeNull();
    expect(fit!.mode).toBe('joint');
  });

  it('activates the fit when BOTH columns vary > 5% (cross-session-style samples)', () => {
    // Synthetic data with α ≈ 0.286 (3.5 chars/tok), β ≈ 1.5e-3 (650 px/tok).
    // Both columns vary > 5% — coefficient of variation guard passes.
    //   sample 1: 100k text, 10M px → 0.286*100k + 1.5e-3*10M = 43,600
    //   sample 2: 130k text, 18M px → 0.286*130k + 1.5e-3*18M = 64,180
    //   sample 3: 160k text, 24M px → 0.286*160k + 1.5e-3*24M = 81,760
    dash.update(ev({ textChars: 100_000, pixels: 10_000_000, input: 5, cacheCreate: 500, cacheRead:  43_095 }));
    dash.update(ev({ textChars: 130_000, pixels: 18_000_000, input: 5, cacheCreate: 300, cacheRead:  63_875 }));
    dash.update(ev({ textChars: 160_000, pixels: 24_000_000, input: 5, cacheCreate: 200, cacheRead:  81_555 }));

    const fit = dash.fitCosts();
    expect(fit).not.toBeNull();
    expect(fit!.n).toBe(3);
    // With well-conditioned data, α and β recover to within ~10% of construction.
    expect(fit!.chars_per_token).toBeGreaterThan(3);
    expect(fit!.chars_per_token).toBeLessThan(4);
    expect(fit!.beta).toBeGreaterThan(0.001);
    expect(fit!.beta).toBeLessThan(0.002);
  });

  it('uses input + cache_create + cache_read as the LHS (full body tokenization)', () => {
    // Two requests with IDENTICAL body shape but different cache splits:
    // one fully cold, one fully warm. The fit's LHS must treat them as the
    // same token cost. Sneak in a third sample with varying text + pixels
    // to make the design matrix well-conditioned (pass the CV guard).
    dash.update(ev({ textChars: 130_000, pixels: 18_000_000, input: 0,  cacheCreate: 63_875, cacheRead: 0 }));
    dash.update(ev({ textChars: 130_000, pixels: 18_000_000, input: 0,  cacheCreate: 0,      cacheRead: 63_875 }));
    dash.update(ev({ textChars: 160_000, pixels: 24_000_000, input: 0,  cacheCreate: 0,      cacheRead: 81_555 }));

    const fit = dash.fitCosts();
    expect(fit).not.toBeNull();
    expect(fit!.chars_per_token).toBeGreaterThan(2);
    expect(fit!.chars_per_token).toBeLessThan(6);
  });

  it('skips requests below the 1000-token floor (filters trivial no-system traffic)', () => {
    // total_tokens = input + cc + cr = 200 + 50 + 100 = 350 < 1000 → not sampled.
    dash.update(ev({ textChars: 500, pixels: 200_000, input: 200, cacheCreate: 50,  cacheRead: 100 }));
    dash.update(ev({ textChars: 600, pixels: 200_000, input: 200, cacheCreate: 50,  cacheRead: 100 }));
    dash.update(ev({ textChars: 700, pixels: 200_000, input: 200, cacheCreate: 50,  cacheRead: 100 }));
    expect(dash.fitCosts()).toBeNull();
  });

  it('skips passthrough (compressed=false) requests', () => {
    const passthroughEvent = (textChars: number): ProxyEvent => ({
      method: 'POST',
      path: '/v1/messages',
      status: 200,
      durationMs: 50,
      info: {
        compressed: false,
        origChars: textChars,
        compressedChars: 0,
        imageCount: 0,
        imageBytes: 0,
        imagePixels: 0,
        outgoingTextChars: textChars,
        staticChars: 0,
        dynamicChars: 0,
        dynamicBlockCount: 0,
        reason: 'below_threshold',
      },
      usage: {
        input_tokens: 0,
        output_tokens: 10,
        cache_creation_input_tokens: 50_000,
        cache_read_input_tokens: 100_000,
      },
    });
    dash.update(passthroughEvent(130_000));
    dash.update(passthroughEvent(132_000));
    dash.update(passthroughEvent(134_000));
    expect(dash.fitCosts()).toBeNull();
  });

  describe('honest uncertainty band (alpha_low / alpha_high)', () => {
    // These tests pin the per-sample p10/p90 α distribution so the
    // dashboard headline can show "30–60% saved" when the regression's
    // confidence is thin, instead of a fake-precise single number.

    it('emits alpha_low ≤ alpha ≤ alpha_high (band straddles the point)', () => {
      // Mix of densities → real per-sample spread.
      dash.update(ev({ textChars: 100_000, pixels: 800_000, input: 30_000, cacheCreate: 10_000, cacheRead: 0 }));
      dash.update(ev({ textChars: 120_000, pixels: 800_000, input: 40_000, cacheCreate: 12_000, cacheRead: 0 }));
      dash.update(ev({ textChars: 80_000, pixels: 800_000, input: 25_000, cacheCreate: 8_000, cacheRead: 0 }));
      const fit = dash.fitCosts();
      expect(fit).not.toBeNull();
      expect(fit!.alpha_low).toBeGreaterThan(0);
      expect(fit!.alpha_low).toBeLessThanOrEqual(fit!.alpha);
      expect(fit!.alpha).toBeLessThanOrEqual(fit!.alpha_high);
    });

    it('chars_per_token bounds are the inverse-ordered alpha bounds', () => {
      // chars/tok is monotonically DECREASING in α. So
      // chars_per_token_low corresponds to alpha_HIGH, and vice versa.
      dash.update(ev({ textChars: 100_000, pixels: 800_000, input: 30_000, cacheCreate: 10_000, cacheRead: 0 }));
      dash.update(ev({ textChars: 120_000, pixels: 800_000, input: 50_000, cacheCreate: 12_000, cacheRead: 0 }));
      dash.update(ev({ textChars: 80_000, pixels: 800_000, input: 20_000, cacheCreate: 8_000, cacheRead: 0 }));
      const fit = dash.fitCosts();
      expect(fit).not.toBeNull();
      expect(fit!.chars_per_token_low).toBeLessThanOrEqual(fit!.chars_per_token);
      expect(fit!.chars_per_token).toBeLessThanOrEqual(fit!.chars_per_token_high);
    });

    it('serveStats exposes saved_pct_low ≤ saved_pct ≤ saved_pct_high', async () => {
      dash.update(ev({ textChars: 100_000, pixels: 800_000, input: 30_000, cacheCreate: 10_000, cacheRead: 0 }));
      dash.update(ev({ textChars: 120_000, pixels: 800_000, input: 50_000, cacheCreate: 12_000, cacheRead: 0 }));
      dash.update(ev({ textChars: 80_000, pixels: 800_000, input: 20_000, cacheCreate: 8_000, cacheRead: 0 }));
      const stats = await dash.serveStats().json();
      expect(typeof stats.saved_pct).toBe('number');
      expect(typeof stats.saved_pct_low).toBe('number');
      expect(typeof stats.saved_pct_high).toBe('number');
      expect(stats.saved_pct_low).toBeLessThanOrEqual(stats.saved_pct + 0.1);
      expect(stats.saved_pct).toBeLessThanOrEqual(stats.saved_pct_high + 0.1);
      // Bounds must be non-negative — pessimistic α below actual cost
      // gets clamped to 0 rather than surfaced as a negative percentage.
      expect(stats.saved_pct_low).toBeGreaterThanOrEqual(0);
      expect(stats.saved_pct_high).toBeGreaterThanOrEqual(0);
    });

    it('honest range even when fit is null (n<3) — uses FALLBACK_ALPHA brackets', async () => {
      // No events at all → cost_fit is null but we still need a defensible
      // range on the headline. The fallback brackets (α_low=0.15,
      // α_high=0.50) cover the plausible content-density universe; the
      // headline collapses to a tautological 0% saved (no events) but the
      // saved_pct_{low,high} keys MUST exist so the HTML never NaN's.
      const stats = await dash.serveStats().json();
      expect(stats.cost_fit).toBeNull();
      expect(typeof stats.saved_pct_low).toBe('number');
      expect(typeof stats.saved_pct_high).toBe('number');
      expect(stats.saved_pct_low).toBe(0);
      expect(stats.saved_pct_high).toBe(0);
    });

    it('output tokens enter the denominator at ×5 (full-bill saved_pct framing)', async () => {
      // Two runs with IDENTICAL input/cache shape but very different output
      // counts. saved_pct should DROP when output grows because output is
      // in the full-bill denominator but doesn't contribute to savings
      // (the model produces the same response either way).
      //
      // Fixture sized so the fallback-α baseline yields POSITIVE savings:
      // compressedChars=200k × α=0.25 = 50k txtReplaced; imageCount=5 ×
      // 2500 = 12.5k imgTokens; extraText = 37.5k > 0.
      const fxArgs = {
        textChars: 100_000,
        pixels: 800_000,
        input: 30_000,
        cacheCreate: 10_000,
        cacheRead: 0,
        compressedChars: 200_000,
        imageCount: 5,
      } as const;

      // Run A — small output (50 tokens per turn).
      const tmpA = makeTmp();
      const dashA = new DashboardState(tmpA, async () => new Map());
      for (let i = 0; i < 3; i++) dashA.update(ev({ ...fxArgs, output: 50 }));
      const statsA = await dashA.serveStats().json();

      // Run B — same input, 100× the output (5000 tokens per turn).
      const tmpB = makeTmp();
      const dashB = new DashboardState(tmpB, async () => new Map());
      for (let i = 0; i < 3; i++) dashB.update(ev({ ...fxArgs, output: 5_000 }));
      const statsB = await dashB.serveStats().json();

      // Absolute savings (in effective tokens) is INVARIANT under output
      // change — savings come from compressed input chars, not output.
      expect(statsA.saved_effective_tokens).toBeGreaterThan(0);
      expect(statsA.saved_effective_tokens).toBeCloseTo(statsB.saved_effective_tokens, 0);

      // Denominator grew (output added at ×5), so saved_pct must DROP
      // when output is bigger. This is the full-bill framing the rename
      // was meant to deliver.
      expect(statsB.effective_cost_baseline).toBeGreaterThan(statsA.effective_cost_baseline);
      expect(statsB.saved_pct).toBeLessThan(statsA.saved_pct);

      // Pinned arithmetic check: extra output of (5000-50) × 3 events × 5.0
      // effective tokens added to BOTH actual and baseline in the B totals.
      expect(statsB.effective_cost_actual - statsA.effective_cost_actual).toBeCloseTo(
        (5000 - 50) * 3 * 5.0,
        0,
      );
    });

    it('fallback brackets fire during the n<3 warmup, then tighten as samples accumulate', async () => {
      // n=0 events → fit=null → fallback brackets → low/high baselines
      // are accumulated using α_low=0.15 and α_high=0.50 on EACH event.
      // After 2 events we still have fit=null, so the cumulative low and
      // high baselines should reflect the fallback rates, not collapse
      // to the point estimate.
      dash.update(ev({ textChars: 100_000, pixels: 800_000, input: 30_000, cacheCreate: 10_000, cacheRead: 0 }));
      dash.update(ev({ textChars: 100_000, pixels: 800_000, input: 30_000, cacheCreate: 10_000, cacheRead: 0 }));
      const statsWarmup = await dash.serveStats().json();
      // Fit not yet active.
      expect(statsWarmup.cost_fit).toBeNull();
      // But the HIGH-α baseline is materially bigger than the point
      // baseline (α=0.50 vs fallback 0.25 = 2× the text-replaced tokens).
      expect(statsWarmup.effective_cost_baseline_high).toBeGreaterThan(
        statsWarmup.effective_cost_baseline,
      );
      expect(statsWarmup.effective_cost_baseline_low).toBeLessThan(
        statsWarmup.effective_cost_baseline,
      );
    });

    it('ground-truth measurement path: count_tokens deltas drive saved_pct_measured exactly', async () => {
      // Synthetic event with both baseline and actual token counts present
      // (as if the proxy had called /v1/messages/count_tokens on both bodies).
      // The dashboard should compute saved_pct_measured = (baseline - actual) /
      // baseline exactly, with NO α/β estimation involved.
      const measuredEv = (baseline: number, actual: number, cc: number): ProxyEvent => ({
        method: 'POST',
        path: '/v1/messages',
        status: 200,
        durationMs: 100,
        info: {
          compressed: true,
          origChars: 100_000,
          compressedChars: 50_000,
          imageCount: 3,
          imageBytes: 100_000,
          imagePixels: 800_000,
          outgoingTextChars: 50_000,
          staticChars: 30_000,
          dynamicChars: 200,
          dynamicBlockCount: 1,
          baselineTokensMeasured: baseline,
          actualTokensMeasured: actual,
        },
        usage: {
          input_tokens: 0,
          output_tokens: 50,
          cache_creation_input_tokens: cc,
          cache_read_input_tokens: 0,
        },
      });

      // Three events with exact 50% savings on tokens (baseline 80k → actual 40k).
      // Each paid cc=40k tokens at 1.25× = 50k eff + output 50×5=250 ≈ 50_250 eff.
      // Delta is 40k tokens × 1.25 (same cache mix) = 50k effective extra.
      // baseline_measured per event ≈ 50_250 + 50_000 = 100_250.
      // saved_pct_measured ≈ (100_250 - 50_250) / 100_250 ≈ 49.9%.
      dash.update(measuredEv(80_000, 40_000, 40_000));
      dash.update(measuredEv(80_000, 40_000, 40_000));
      dash.update(measuredEv(80_000, 40_000, 40_000));

      const stats = await dash.serveStats().json();
      expect(stats.measured_events).toBe(3);
      expect(stats.saved_pct_measured).toBeGreaterThan(45);
      expect(stats.saved_pct_measured).toBeLessThan(55);
      // Measured fields must be numbers, not null, when measurements exist.
      expect(typeof stats.effective_cost_actual_measured).toBe('number');
      expect(typeof stats.effective_cost_baseline_measured).toBe('number');
      expect(typeof stats.saved_effective_tokens_measured).toBe('number');
      // Identity check: saved = baseline - actual.
      expect(stats.saved_effective_tokens_measured).toBeCloseTo(
        stats.effective_cost_baseline_measured - stats.effective_cost_actual_measured,
        0,
      );
    });

    it('measured fields are null when no event carried count_tokens measurement', async () => {
      // Use the regular ev() helper which never sets baselineTokensMeasured.
      dash.update(ev({ textChars: 100_000, pixels: 800_000, input: 30_000, cacheCreate: 10_000, cacheRead: 0 }));
      const stats = await dash.serveStats().json();
      expect(stats.measured_events).toBe(0);
      expect(stats.saved_pct_measured).toBeNull();
      expect(stats.effective_cost_actual_measured).toBeNull();
      expect(stats.effective_cost_baseline_measured).toBeNull();
      expect(stats.saved_effective_tokens_measured).toBeNull();
    });

    it('pricing_assumptions surfaces the rate used to compute saved_usd_estimated', async () => {
      // Sourced from docs.anthropic.com/en/docs/about-claude/pricing,
      // verified 2026-05-19. Locks in: input rate, output multiplier,
      // both cache write multipliers, and cache read multiplier.
      const stats = await dash.serveStats().json();
      expect(stats.pricing_assumptions).toBeDefined();
      expect(stats.pricing_assumptions.input_per_mtok).toBe(5.0);
      expect(stats.pricing_assumptions.output_multiplier).toBe(5.0);
      expect(stats.pricing_assumptions.cache_write_5m_multiplier).toBe(1.25);
      expect(stats.pricing_assumptions.cache_write_1h_multiplier).toBe(2.0);
      expect(stats.pricing_assumptions.cache_read_multiplier).toBe(0.1);
      expect(typeof stats.pricing_assumptions.source).toBe('string');
      // saved_usd_estimated must be saved_effective_tokens × input_per_mtok / 1e6.
      const expectedUsd = (stats.saved_effective_tokens * 5.0) / 1e6;
      expect(stats.saved_usd_estimated).toBeCloseTo(expectedUsd, 4);
    });
  });
});
