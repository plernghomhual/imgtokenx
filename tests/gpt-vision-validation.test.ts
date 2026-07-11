/**
 * Regression guard for audit finding D15: GPT vision-cost overrides must reject
 * negative values. `isValidVision` used to accept any finite number, so a
 * `-10` base produced negative image-token math. Now non-negative values are
 * required; a bad override falls back to the built-in profile.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveGptProfile } from '../src/core/gpt-model-profiles.js';

const KEY = 'IMGTOKENX_GPT_PROFILES';
let saved: string | undefined;

beforeEach(() => {
  saved = process.env[KEY];
});
afterEach(() => {
  if (saved === undefined) delete process.env[KEY];
  else process.env[KEY] = saved;
});

describe('GPT vision-cost validation (D15)', () => {
  it('rejects a negative tile base and falls back to built-in', () => {
    process.env[KEY] = JSON.stringify({
      'gpt-negtest': { vision: { regime: 'tile', base: -10, perTile: 5 } },
    });
    const p = resolveGptProfile('gpt-negtest');
    expect(p.vision.regime).toBe('tile');
    expect((p.vision as { base: number }).base).toBeGreaterThanOrEqual(0);
    expect((p.vision as { base: number }).base).not.toBe(-10);
  });

  it('rejects a negative patch multiplier', () => {
    process.env[KEY] = JSON.stringify({
      'gpt-negtest': { vision: { regime: 'patch', multiplier: -3, patchCap: 100 } },
    });
    const p = resolveGptProfile('gpt-negtest');
    expect((p.vision as { multiplier?: number }).multiplier ?? 1).toBeGreaterThanOrEqual(0);
  });

  it('accepts a valid non-negative override', () => {
    process.env[KEY] = JSON.stringify({
      'gpt-negtest': { vision: { regime: 'tile', base: 12, perTile: 24 } },
    });
    const p = resolveGptProfile('gpt-negtest');
    expect((p.vision as { base: number }).base).toBe(12);
    expect((p.vision as { perTile: number }).perTile).toBe(24);
  });
});
