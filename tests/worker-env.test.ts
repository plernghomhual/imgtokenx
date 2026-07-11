/**
 * Worker env parsing: garbage numeric env vars must fall back to documented
 * defaults, never inject NaN into TransformOptions. Previously
 * `Number("abc")` flowed straight into minCompressChars (NaN disables
 * compression via failed comparisons) and `Number("abc")|0` silently
 * collapsed MULTI_COL to 1 instead of the documented default 2.
 */

import { describe, it, expect } from 'vitest';
import { workerTransformOptions, type Env } from '../src/worker.js';

const GARBAGE = ['abc', 'NaN', 'Infinity', '-Infinity', '1e999', ''];

describe('workerTransformOptions env fuzz', () => {
  it('defaults with an empty env', () => {
    const o = workerTransformOptions({});
    expect(o.minCompressChars).toBe(2000);
    expect(o.minReminderChars).toBe(0);
    expect(o.minToolResultChars).toBe(0);
    expect(o.multiCol).toBe(2);
    expect('cols' in o).toBe(false);
  });

  it('parses valid numeric values', () => {
    const o = workerTransformOptions({
      MIN_COMPRESS_CHARS: '500',
      MIN_REMINDER_CHARS: '100',
      MIN_TOOL_RESULT_CHARS: '200',
      COLS: '120',
      MULTI_COL: '3',
    });
    expect(o.minCompressChars).toBe(500);
    expect(o.minReminderChars).toBe(100);
    expect(o.minToolResultChars).toBe(200);
    expect(o.cols).toBe(120);
    expect(o.multiCol).toBe(3);
  });

  it('MULTI_COL=1 still disables multi-column', () => {
    expect(workerTransformOptions({ MULTI_COL: '1' }).multiCol).toBe(1);
  });

  for (const bad of GARBAGE) {
    it(`falls back to defaults for ${JSON.stringify(bad)}`, () => {
      const env: Env = {
        MIN_COMPRESS_CHARS: bad,
        MIN_REMINDER_CHARS: bad,
        MIN_TOOL_RESULT_CHARS: bad,
        COLS: bad,
        MULTI_COL: bad,
      };
      const o = workerTransformOptions(env);
      expect(o.minCompressChars).toBe(2000);
      expect(o.minReminderChars).toBe(0);
      expect(o.minToolResultChars).toBe(0);
      expect(o.multiCol).toBe(2);
      expect('cols' in o).toBe(false);
      for (const v of [o.minCompressChars, o.minReminderChars, o.minToolResultChars, o.multiCol]) {
        expect(Number.isFinite(v)).toBe(true);
      }
    });
  }
});
