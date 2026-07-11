import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  pruneRecoverableDir,
  readRecoveryCaps,
  DEFAULT_RECOVERY_MAX_AGE_DAYS,
  DEFAULT_RECOVERY_MAX_BYTES,
  MAX_RECOVERABLE_FILES,
  MS_PER_DAY,
} from '../src/recovery-retention.js';

/** Drop a deterministic file into `dir` with the given mtime + size. */
function touch(dir: string, name: string, mtimeMs: number, size: number): void {
  const p = path.join(dir, name);
  fs.writeFileSync(p, 'x'.repeat(size));
  fs.utimesSync(p, new Date(mtimeMs), new Date(mtimeMs));
}

describe('recovery retention caps', () => {
  let dir: string;
  let savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imgtokenx-recov-'));
    savedEnv = {
      IMGTOKENX_RECOVERY_MAX_AGE_DAYS: process.env.IMGTOKENX_RECOVERY_MAX_AGE_DAYS,
      IMGTOKENX_RECOVERY_MAX_BYTES: process.env.IMGTOKENX_RECOVERY_MAX_BYTES,
    };
  });
  afterEach(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* */ }
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });

  it('exposes documented defaults', () => {
    expect(DEFAULT_RECOVERY_MAX_AGE_DAYS).toBe(7);
    expect(DEFAULT_RECOVERY_MAX_BYTES).toBe(256 * 1024 * 1024);
    expect(MAX_RECOVERABLE_FILES).toBeGreaterThan(0);
    expect(MAX_RECOVERABLE_FILES).toBeLessThan(10_000);
    expect(MS_PER_DAY).toBe(86_400_000);
  });

  it('age cap (default 7 days) deletes everything older, keeps recent', () => {
    delete process.env.IMGTOKENX_RECOVERY_MAX_AGE_DAYS;
    delete process.env.IMGTOKENX_RECOVERY_MAX_BYTES;
    const now = Date.now();
    const day = MS_PER_DAY;
    touch(dir, 'old.txt', now - 8 * day, 1024);
    touch(dir, 'fresh.txt', now - 1 * day, 1024);
    pruneRecoverableDir(dir);
    expect(fs.existsSync(path.join(dir, 'old.txt'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'fresh.txt'))).toBe(true);
  });

  it('explicit age=0 DISABLES the age cap (env-vs-default per spec)', () => {
    process.env.IMGTOKENX_RECOVERY_MAX_AGE_DAYS = '0';
    delete process.env.IMGTOKENX_RECOVERY_MAX_BYTES;
    const now = Date.now();
    const day = MS_PER_DAY;
    touch(dir, 'old.txt', now - 30 * day, 1024);
    pruneRecoverableDir(dir);
    expect(fs.existsSync(path.join(dir, 'old.txt'))).toBe(true);
  });

  it('byte cap drops oldest until total size fits', () => {
    delete process.env.IMGTOKENX_RECOVERY_MAX_AGE_DAYS;
    process.env.IMGTOKENX_RECOVERY_MAX_BYTES = '3000'; // ~3 KB
    const now = Date.now();
    touch(dir, 'a.txt', now - 4000, 1000);
    touch(dir, 'b.txt', now - 3000, 1000);
    touch(dir, 'c.txt', now - 2000, 1000);
    touch(dir, 'd.txt', now - 1000, 1000);
    pruneRecoverableDir(dir);
    expect(fs.existsSync(path.join(dir, 'a.txt'))).toBe(false);
    for (const n of ['b.txt', 'c.txt', 'd.txt']) {
      expect(fs.existsSync(path.join(dir, n))).toBe(true);
    }
  });

  it('explicit byte=0 DISABLES the byte cap', () => {
    delete process.env.IMGTOKENX_RECOVERY_MAX_AGE_DAYS;
    process.env.IMGTOKENX_RECOVERY_MAX_BYTES = '0';
    const now = Date.now();
    for (let i = 0; i < 6; i++) {
      touch(dir, `f${i}.txt`, now - (6 - i) * 100, 1024 * 1024); // 1 MiB each
    }
    // Without byte cap, only the count cap (4096) constrains. All 6 survive.
    pruneRecoverableDir(dir);
    expect(fs.readdirSync(dir).length).toBe(6);
  });

  it('readRecoveryCaps honors explicit env values verbatim', () => {
    process.env.IMGTOKENX_RECOVERY_MAX_AGE_DAYS = '30';
    process.env.IMGTOKENX_RECOVERY_MAX_BYTES = '1024';
    const caps = readRecoveryCaps();
    expect(caps.maxAgeMs).toBe(30 * MS_PER_DAY);
    expect(caps.maxBytes).toBe(1024);
    expect(caps.maxFiles).toBe(MAX_RECOVERABLE_FILES);
  });

  it('readRecoveryCaps falls back to defaults on bogus env', () => {
    process.env.IMGTOKENX_RECOVERY_MAX_AGE_DAYS = 'banana';
    process.env.IMGTOKENX_RECOVERY_MAX_BYTES = '-1';
    const caps = readRecoveryCaps();
    expect(caps.maxAgeMs).toBe(DEFAULT_RECOVERY_MAX_AGE_DAYS * MS_PER_DAY);
    expect(caps.maxBytes).toBe(DEFAULT_RECOVERY_MAX_BYTES);
    expect(caps.maxFiles).toBe(MAX_RECOVERABLE_FILES);
  });

  it('older files unlinked by age pass do not double-count in the byte pass', () => {
    delete process.env.IMGTOKENX_RECOVERY_MAX_AGE_DAYS;
    process.env.IMGTOKENX_RECOVERY_MAX_BYTES = '1500'; // 1.5 KB
    const now = Date.now();
    const day = MS_PER_DAY;
    // 8-day-old 1 KB files age out for free; recent 1 KB files compete.
    touch(dir, 'oldA.txt', now - 8 * day, 1024);
    touch(dir, 'oldB.txt', now - 8 * day, 1024);
    touch(dir, 'freshA.txt', now - 1 * day, 1024);
    touch(dir, 'freshB.txt', now - 2 * day, 1024);
    pruneRecoverableDir(dir);
    expect(fs.existsSync(path.join(dir, 'oldA.txt'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'oldB.txt'))).toBe(false);
    // After pruning, only freshA and freshB remain (2 KB total) — over 1.5.
    // Byte cap drops oldest of those two.
    expect(fs.existsSync(path.join(dir, 'freshB.txt'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'freshA.txt'))).toBe(true);
  });
});
