/**
 * Per-model reader-capacity profiles: how densely a given model can be trusted to
 * READ imaged content, decoupled from applicability.ts's "should imgtokenx touch this
 * request at all" gate (see that file's updated comment for the split). Mirrors
 * gpt-model-profiles.ts's structure (prefix-matched BUILTIN_RULES table, first match
 * wins, env override for retuning without a code change).
 *
 * `safeToImage: false` means the transform path must not render anything for this model —
 * full text passthrough (reason `reader_profile_unsafe`) — because we have no
 * evidence the model reads imaged content reliably at any profitable density.
 * `safeToImage: true` means it's safe to image at the given cell-size bonus (added
 * to render.ts's ATLAS_CELL_W/H); the existing profitability gate still decides
 * whether imaging at that (possibly larger, less compressive) density is worth it.
 * To add a model safely, run the repeatable sweep in eval/reader-capacity/.
 *
 * Retune without a code change via IMGTOKENX_READER_PROFILES (JSON map of model-id
 * PREFIX -> partial profile; longest matching prefix wins, checked BEFORE the
 * built-in table). Partial fields fall back to the built-in match:
 *
 *   IMGTOKENX_READER_PROFILES='{"claude-opus-4-":{"cellWBonus":20,"cellHBonus":30}}'
 *   IMGTOKENX_READER_PROFILES='{"claude-mythos-5":{"safeToImage":true}}'
 */

export interface ReaderProfile {
  /** False = transform.ts must not render images for this model; full text passthrough. */
  safeToImage: boolean;
  /** Added to render.ts's ATLAS_CELL_W (5px) for this model's render cell. */
  cellWBonus: number;
  /** Added to render.ts's ATLAS_CELL_H (8px) for this model's render cell. */
  cellHBonus: number;
}

/** Conservative fallback for unrecognized/uncalibrated models: never image. We have
 *  no read-accuracy measurement for them, and guessing a density risks silent
 *  confabulation (the exact failure mode this whole plan exists to structurally
 *  prevent) — see /Users/plernghomhual/.claude/plans/jaunty-whistling-shannon.md,
 *  "Phase 2 — Per-model reader profiles". Text passthrough is always correct, just
 *  not compressed. */
export const DEFAULT_READER_PROFILE: ReaderProfile = {
  safeToImage: false,
  cellWBonus: 0,
  cellHBonus: 0,
};

interface ProfileRule {
  test: (m: string) => boolean;
  profile: ReaderProfile;
}

/** Exact-base-or-suffix-alias match (same shape as applicability.ts's isAllowed):
 *  `m === base` or `m` starts with `base + '-'` (e.g. `claude-fable-5-high`). Avoids
 *  a bare prefix match wrongly catching an unrelated model like `claude-fable-50`. */
function isBaseOrAlias(m: string, base: string): boolean {
  return m === base || m.startsWith(`${base}-`);
}

/**
 * Built-in profiles, evaluated in order (first match wins).
 *
 * - claude-fable-5 / generic gpt-5.6: calibrated pipeline models. Proven safe at
 *   the bare 5×8 production cell (no bonus) — see docs/RENDER_SIZING.md /
 *   FINDINGS.md's Fable 5 measurements.
 * - claude-opus-4- (any Opus 4.x): FINDINGS.md 2026-06-16 sweep originally set 20×32
 *   (5+15 × 8+24). Recalibrated 2026-07-13 (keyless sweep, same method/fixture as
 *   sonnet-5 below): 12×20 (cellWBonus:7, cellHBonus:12) PASSED 4/4 clean runs, 6/6
 *   each, zero confabulation — supersedes the 2026-06-16 finding at this density.
 *   11×18 (cellWBonus:6, cellHBonus:10) was tried in the same sweep and FAILED for
 *   Opus specifically — 3 clean runs then a 4th confabulated an extra hex digit
 *   (`a3f9c1e0eb7d2` vs the true `a3f9c1e0b7d2`) — so Opus stays at 12×20 even
 *   though Sonnet cleared 11×18 (see below).
 * - claude-haiku-4-5: 2026-07-10 keyless calibration (the eval/reader-capacity fixture
 *   rendered to PNGs by the production renderer, read by subscription-side subagents on
 *   each model; one agent per density so answers can't leak across variants). Scored
 *   6/6 exact+guard ONLY at 20×32; every smaller density (5×8, 7×10, 9×12) produced at
 *   least one CONFABULATED exact value (invented port, invented field name, wrong hex
 *   digit) — the failure mode this table exists to block. Caveat: agents consumed the
 *   PNGs via the harness Read tool, which may resample; pages were kept ≤1568×728 to
 *   stay under the API resample ceiling, matching what the proxy emits.
 * - claude-sonnet-5: 2026-07-13 keyless recalibration, same method, intermediate
 *   densities. 10×16 (cellWBonus:5, cellHBonus:8) FAILED — 1 of 2 runs confabulated
 *   the hex digit. 12×20 (cellWBonus:7, cellHBonus:12) PASSED 3/3 clean runs, 6/6 each.
 *   11×18 (cellWBonus:6, cellHBonus:10) retried after 12×20 shipped and PASSED 3/3
 *   clean runs, 6/6 each, zero confabulation — supersedes 12×20 for Sonnet only.
 *   9×12 (cellWBonus:4, cellHBonus:4) FAILED for both Sonnet and Opus — both models
 *   misread the port as `7821` instead of `47821` (dropped leading digit), so it was
 *   never adopted for either.
 * - gpt-5.6-sol: text-only until its raw-image profile clears the exact-recall bar.
 * - everything else: DEFAULT_READER_PROFILE (never imaged; no measurement exists).
 */
const BUILTIN_RULES: ProfileRule[] = [
  {
    test: (m) => isBaseOrAlias(m, 'claude-fable-5'),
    profile: { safeToImage: true, cellWBonus: 0, cellHBonus: 0 },
  },
  {
    test: (m) => isBaseOrAlias(m, 'gpt-5.6-sol'),
    profile: DEFAULT_READER_PROFILE,
  },
  {
    test: (m) => isBaseOrAlias(m, 'gpt-5.6'),
    profile: { safeToImage: true, cellWBonus: 0, cellHBonus: 0 },
  },
  // Prefix already dash-terminated, so `claude-opus-40` etc. cannot false-match.
  {
    test: (m) => m.startsWith('claude-opus-4-'),
    profile: { safeToImage: true, cellWBonus: 7, cellHBonus: 12 },
  },
  {
    test: (m) => isBaseOrAlias(m, 'claude-sonnet-5'),
    profile: { safeToImage: true, cellWBonus: 6, cellHBonus: 10 },
  },
  {
    test: (m) => isBaseOrAlias(m, 'claude-haiku-4-5'),
    profile: { safeToImage: true, cellWBonus: 15, cellHBonus: 24 },
  },
];

/** Bracketed variant tags (e.g. `[1m]`) stripped before matching, same as
 *  applicability.ts's baseModelId — a tag can sit directly after an exact base
 *  (`claude-fable-5[1m]`) with no separating `-`, which would otherwise miss
 *  isBaseOrAlias's dash-suffix check. */
const VARIANT_TAG = /\[[^\]]*\]/g;

function resolveBuiltin(m: string): ReaderProfile {
  const stripped = m.replace(VARIANT_TAG, '');
  for (const rule of BUILTIN_RULES) if (rule.test(stripped)) return rule.profile;
  return DEFAULT_READER_PROFILE;
}

// --- env override (IMGTOKENX_READER_PROFILES) --------------------------------
// Parsed lazily and memoized on the raw env string so tests can mutate
// process.env and have it re-read, without re-parsing on every hot-path call.

let envRaw: string | null = null;
let envMap: Map<string, ReaderProfile> = new Map();

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function nonNegInt(v: unknown, fallback: number): number {
  return Number.isFinite(v) && (v as number) >= 0 ? Math.floor(v as number) : fallback;
}

function parseEnvProfiles(raw: string): Map<string, ReaderProfile> {
  const out = new Map<string, ReaderProfile>();
  if (!raw) return out;
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return out; // malformed env never throws — fall back to built-ins
  }
  if (!obj || typeof obj !== 'object') return out;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (!v || typeof v !== 'object') continue;
    const key = k.toLowerCase();
    const base = resolveBuiltin(key); // partial fields fall back to the built-in match
    const p = v as Partial<ReaderProfile>;
    out.set(key, {
      safeToImage: bool(p.safeToImage, base.safeToImage),
      cellWBonus: nonNegInt(p.cellWBonus, base.cellWBonus),
      cellHBonus: nonNegInt(p.cellHBonus, base.cellHBonus),
    });
  }
  return out;
}

function envProfiles(): Map<string, ReaderProfile> {
  const raw = (typeof process !== 'undefined' && process.env && process.env.IMGTOKENX_READER_PROFILES) || '';
  if (raw !== envRaw) {
    envRaw = raw;
    envMap = parseEnvProfiles(raw);
  }
  return envMap;
}

/**
 * Resolve the reader-capacity profile for a model id. Env overrides (longest
 * matching prefix) win over the built-in table; unknown/uncalibrated models get
 * the conservative `DEFAULT_READER_PROFILE` (never imaged).
 */
export function resolveReaderProfile(model: string | null | undefined): ReaderProfile {
  const m = (model ?? '').toLowerCase();
  const env = envProfiles();
  if (env.size > 0) {
    let best: ReaderProfile | undefined;
    let bestLen = -1;
    for (const [k, p] of env) {
      if (m.startsWith(k) && k.length > bestLen) {
        best = p;
        bestLen = k.length;
      }
    }
    if (best) return best;
  }
  return resolveBuiltin(m);
}
