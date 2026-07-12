/** Regression tests for scripts/release-check.mjs (audit #36 + audit #34).
 *
 *  Each test runs the script as a child process inside a temp directory
 *  populated with a synthetic package.json + pnpm-lock.yaml + .npmrc.
 *  We can't `vi.mock('node:fs')` cleanly here because the script reads
 *  cwd-relative paths, so we go via `spawnSync` and assert against the
 *  process exit status + stderr/stdout. This is the same pattern
 *  tests/install-rollback.test.ts uses for runInstall/runUninstall.
 *
 *  Coverage matrix:
 *    1. green path (all checks pass)   → exit 0 + OK line
 *    1b. dist/ artifacts missing       → exit 1 + dist error
 *    2. version field missing         → exit 1 + version error
 *    3. version non-SemVer ("v1")     → exit 1 + version error
 *    4. pnpm-lock.yaml missing        → exit 1 + lockfile error
 *    5. test:restart script missing   → exit 1 + test:restart error (audit #34)
 *    6. pnpm-only key leaked back     → exit 1 + pnpm key error (audit #36)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

// ESM-portable directory-of-this-file lookup. Avoids `__dirname`, which is
// undefined under bare ESM (`"type":"module"` in package.json) — vitest's
// runtime happens to polyfill it, but `node --test` and other runners
// don't. The current `path.dirname(fileURLToPath(import.meta.url))` idiom
// works under every ESM-aware runner since Node 14.
const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(THIS_DIR, '..', 'scripts', 'release-check.mjs');

interface SpawnOut {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** Build a sandboxed cwd with the listed files, run the script inside,
 *  return the captured stdout/stderr + exit code, and clean up. */
function runInSandbox(files: Record<string, string>): SpawnOut {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'imgtokenx-rcheck-'));
  try {
    for (const [rel, content] of Object.entries(files)) {
      const target = path.join(cwd, rel);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
    }
    const r = spawnSync('node', [SCRIPT], { cwd, encoding: 'utf8' });
    return {
      status: r.status,
      stdout: r.stdout ?? '',
      stderr: r.stderr ?? '',
    };
  } finally {
    try {
      fs.rmSync(cwd, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  }
}

describe('release:check (audit #36 + audit #34)', () => {
  const EXPORTS = {
    '.': { types: './dist/core/index.d.ts', import: './dist/core/index.js' },
    './node': { types: './dist/node.d.ts', import: './dist/node.js' },
  };

  it('exits 0 with the OK line when all checks pass', () => {
    const r = runInSandbox({
      'package.json': JSON.stringify({
        name: 'imgtokenx',
        version: '0.8.0',
        exports: EXPORTS,
        scripts: { 'test:restart': 'bash tests/restart.test.sh' },
      }),
      'pnpm-lock.yaml': 'lockfileVersion: 9.0\n',
      '.npmrc': '# npm-compatible only\n',
      'dist/core/index.js': 'export {};\n',
      'dist/core/index.d.ts': 'export {};\n',
      'dist/node.js': '#!/usr/bin/env node\n',
      'dist/node.d.ts': 'export {};\n',
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('release:check OK: ready to release v0.8.0');
  });

  it('exits 1 when dist/ artifacts are missing (unbuilt tree must not bless a release)', () => {
    const r = runInSandbox({
      'package.json': JSON.stringify({
        name: 'imgtokenx',
        version: '0.8.0',
        exports: EXPORTS,
        scripts: { 'test:restart': 'bash tests/restart.test.sh' },
      }),
      'pnpm-lock.yaml': 'lockfileVersion: 9.0\n',
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/\.\/dist\/core\/index\.js missing/);
    expect(r.stderr).toMatch(/\.\/dist\/node\.js missing/);
    expect(r.stderr).toMatch(/\.\/dist\/core\/index\.d\.ts missing/);
  });

  it('exits 1 when the exports map is absent (nothing to verify must not pass)', () => {
    const r = runInSandbox({
      'package.json': JSON.stringify({
        name: 'imgtokenx',
        version: '0.8.0',
        scripts: { 'test:restart': 'bash tests/restart.test.sh' },
      }),
      'pnpm-lock.yaml': 'lockfileVersion: 9.0\n',
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/"exports" map missing/);
  });

  it('exits 1 with a clear error when package.json has no version field', () => {
    const r = runInSandbox({
      'package.json': JSON.stringify({
        name: 'imgtokenx',
        scripts: { 'test:restart': 'bash tests/restart.test.sh' },
      }),
      'pnpm-lock.yaml': 'x\n',
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/missing or non-SemVer "version"/);
  });

  it('exits 1 when the version field is non-SemVer (e.g. "v1")', () => {
    // The regex is `^\d+\.\d+\.\d+`, anchored on raw digits + dots. "v1"
    // and "1.2" both fail — pin "v1" because it's the human-typo we'd see
    // most often if someone copy-pasted a git tag name.
    const r = runInSandbox({
      'package.json': JSON.stringify({
        version: 'v1',
        scripts: { 'test:restart': 'bash tests/restart.test.sh' },
      }),
      'pnpm-lock.yaml': 'x\n',
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/missing or non-SemVer "version"/);
  });

  it('exits 1 when pnpm-lock.yaml is absent', () => {
    const r = runInSandbox({
      'package.json': JSON.stringify({
        version: '0.8.0',
        scripts: { 'test:restart': 'bash tests/restart.test.sh' },
      }),
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/pnpm-lock\.yaml missing/);
  });

  it('exits 1 when test:restart script is absent (audit #34: restarted smoke missing from CI)', () => {
    const r = runInSandbox({
      'package.json': JSON.stringify({
        version: '0.8.0',
        scripts: { test: 'vitest' },
      }),
      'pnpm-lock.yaml': 'x\n',
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/test:restart script missing/);
  });

  it('exits 1 when a pnpm-only key leaked back into .npmrc (audit #36 regression)', () => {
    // Synthesis: package.json + lockfile + test:restart are all green, but
    // someone copy-pasted the old minimum-release-age=4320 setting back into
    // .npmrc. The detector must catch it so npm install in a downstream
    // project doesn't fail with "Unknown config".
    const r = runInSandbox({
      'package.json': JSON.stringify({
        version: '0.8.0',
        scripts: { 'test:restart': 'bash tests/restart.test.sh' },
      }),
      'pnpm-lock.yaml': 'x\n',
      '.npmrc': 'minimum-release-age=4320\n',
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/pnpm-only "minimum-release-age"/);
  });

  it('reports ALL failures, not just the first one', () => {
    // Multiple problems at once must surface together — easier for the
    // operator to fix everything in one pass instead of running the
    // script N times to see N independent errors.
    const r = runInSandbox({
      'package.json': JSON.stringify({ name: 'imgtokenx' }), // no version, no test:restart
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/missing or non-SemVer "version"/);
    expect(r.stderr).toMatch(/pnpm-lock\.yaml missing/);
    expect(r.stderr).toMatch(/test:restart script missing/);
  });
});
