import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('pxpipe recover CLI', () => {
  it('prints the newest local recoverable source for a rec_* id', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pxpipe-recover-cli-'));
    try {
      fs.writeFileSync(
        path.join(dir, '2026-07-08T00-00-00_req001_model_rec_deadbeef_tool_result.txt'),
        'older exact source',
      );
      fs.writeFileSync(
        path.join(dir, '2026-07-08T00-00-01_req002_model_rec_deadbeef_tool_result.txt'),
        'newer exact source',
      );

      const run = spawnSync(
        process.execPath,
        ['--import', 'tsx', 'src/node.ts', 'recover', 'rec_deadbeef'],
        {
          cwd: repoRoot,
          encoding: 'utf8',
          env: { ...process.env, PXPIPE_RECOVERABLE_DIR: dir },
          timeout: 30_000,
        },
      );

      expect(run.status, `stderr:\n${run.stderr}`).toBe(0);
      expect(run.stdout).toBe('newer exact source');
      expect(run.stderr).toBe('');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('defaults to ~/.pxpipe/recovery when PXPIPE_RECOVERABLE_DIR is unset', () => {
    // Recovery is default-on: with no env var set, the CLI must resolve the
    // same ~/.pxpipe/recovery default the live proxy writes sidecars to
    // (see resolveRecoverableDir() / defaultRecoverableDir() in src/node.ts).
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pxpipe-recover-home-'));
    try {
      const dir = path.join(home, '.pxpipe', 'recovery');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, '2026-07-08T00-00-00_req001_model_rec_cafebabe_tool_result.txt'),
        'default dir exact source',
      );
      const env = { ...process.env, HOME: home };
      delete env.PXPIPE_RECOVERABLE_DIR;
      const run = spawnSync(
        process.execPath,
        ['--import', 'tsx', 'src/node.ts', 'recover', 'rec_cafebabe'],
        { cwd: repoRoot, encoding: 'utf8', env, timeout: 30_000 },
      );

      expect(run.status, `stderr:\n${run.stderr}`).toBe(0);
      expect(run.stdout).toBe('default dir exact source');
      expect(run.stderr).toBe('');
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('fails closed when PXPIPE_RECOVERABLE_DIR is explicitly disabled', () => {
    const env = { ...process.env, PXPIPE_RECOVERABLE_DIR: 'off' };
    const run = spawnSync(
      process.execPath,
      ['--import', 'tsx', 'src/node.ts', 'recover', 'rec_deadbeef'],
      { cwd: repoRoot, encoding: 'utf8', env, timeout: 30_000 },
    );

    expect(run.status).toBe(2);
    expect(run.stderr).toContain('PXPIPE_RECOVERABLE_DIR is disabled');
    expect(run.stdout).toBe('');
  });
});
