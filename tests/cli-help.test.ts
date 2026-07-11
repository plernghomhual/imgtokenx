/**
 * Regression guards for audit finding D24 ("docs reconcile and dead-constant
 * removal"):
 *   - `IMGTOKENX_RECOVERABLE_DIR` help text must say default-on, NOT
 *     "off unless set".
 *   - The Worker `MULTI_COL` JSDoc must describe default 2 (matching the code
 *     default at src/worker.ts, not the previous stale "default 1 (off)" copy).
 *   - The dead `INPUT_USD_PER_MTOK = 10.0` constant + `void` suppressor in
 *     src/dashboard/fragments.ts must be gone (it duplicated
 *     `ASSUMED_INPUT_USD_PER_MTOK` in src/dashboard.ts and was suppressed via
 *     `void` to silence TS).
 *
 * Each test reads a tracked file as text and asserts inline invariants. Pure
 * file-content checks — no process spawn, no runtime mocks, no
 * `import.meta.dirname` (which is unavailable on Node 18 under bare `node`).
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

function readRoot(rel: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8');
}

describe('D24 docs/help reconcile', () => {
  describe('IMGTOKENX_RECOVERABLE_DIR help text', () => {
    const src = readRoot('src/node.ts');

    it('describes the env var as default-on (not "off unless set")', () => {
      // The literal `IMGTOKENX_RECOVERABLE_DIR` appears in MULTIPLE contexts in
      // src/node.ts (the `Usage:` redirect line, the env-var help block, and
      // at end-of-line in the LOSSLESS_EXACT description). matchAll then pick
      // the only candidate whose body actually describes the env-var default.
      const candidates = [
        ...src.matchAll(/IMGTOKENX_RECOVERABLE_DIR[^\n]*(?:\n[ \t]+[^\n]+)*/g),
      ];
      const helpBlock = candidates.find((m) => /default[- ]on/i.test(m[0]));
      expect(
        helpBlock,
        'IMGTOKENX_RECOVERABLE_DIR help block should exist and say "default-on"',
      ).toBeTruthy();
      const text = helpBlock![0];
      // Implementation has been default-on since the lossless-by-default pass
      // (commit 65a85a1); the help must not regress to the prior "off unless set".
      expect(text).not.toMatch(/off unless set/i);
      // Mention the actual default location so users find the sidecar dir.
      expect(text).toContain('~/.imgtokenx/recovery');
    });
  });

  describe('Worker MULTI_COL doc comment', () => {
    const src = readRoot('src/worker.ts');

    it('JSDoc describes default 2 (matches the code default at line ~118)', () => {
      // The JSDoc terminator `*/` is unique enough that a non-greedy
      // `[\s\S]*?` between `/**` and `*/` won't cross into the next doc block.
      const jsdoc = src.match(/\/\*\*\s*([\s\S]*?)\*\/\s*MULTI_COL\??\s*:/);
      expect(jsdoc, 'MULTI_COL JSDoc block should exist').toBeTruthy();
      const text = jsdoc![0]!;
      // The code at src/worker.ts computes `env.MULTI_COL ? ... : 2`, so the
      // documented default must be 2 (not the stale "default 1 (off)").
      expect(text).toMatch(/default\s*2/i);
      expect(text).not.toMatch(/default\s*1/i);
    });
  });

  describe('Dead INPUT_USD_PER_MTOK constant in fragments.ts', () => {
    const fragments = readRoot('src/dashboard/fragments.ts');

    it('does not redeclare the duplicated INPUT_USD_PER_MTOK constant', () => {
      // The lockstep-of-ASSUMED_INPUT_USD_PER_MTOK copy here was a footgun:
      // it duplicated the canonical constant in src/dashboard.ts and was
      // suppressed via `void INPUT_USD_PER_MTOK` to silence TS. Removed.
      expect(fragments).not.toMatch(/const\s+INPUT_USD_PER_MTOK\s*=/);
      expect(fragments).not.toMatch(/void\s+INPUT_USD_PER_MTOK\b/);
    });

    it('the canonical ASSUMED_INPUT_USD_PER_MTOK still lives in src/dashboard.ts', () => {
      const dash = readRoot('src/dashboard.ts');
      // The remaining live symbol; load-bearing constant.
      expect(dash).toMatch(/export\s+const\s+ASSUMED_INPUT_USD_PER_MTOK\s*=\s*10\.0\b/);
    });
  });
});
