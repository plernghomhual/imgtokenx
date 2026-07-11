/**
 * Regression guard for the export walk symlink guard (audit finding E-LOW).
 *
 * `collectFilesFromTargets` → `walkDir` must NOT follow symbolic links, so a
 * bulk `imgtokenx export <dir>` can't escape the tree (symlink loop or a link
 * pointing at /etc). See src/node.ts `walkDir` `isSymbolicLink()` skip.
 */

import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { collectFilesFromTargets } from '../src/node.js';

let root: string;

afterEach(() => {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* reaped */ }
});

describe('export walk symlink guard', () => {
  it('does not descend into a symlinked directory (no tree escape)', () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'imgtokenx-symdir-'));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'imgtokenx-outside-'));
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'should-not-be-collected');
    // Inside the tree, symlink a subdir to the outside dir.
    const link = path.join(root, 'escape');
    fs.symlinkSync(outside, link, 'dir');

    const files = collectFilesFromTargets([root], ['**/*.txt'], []);
    expect(files.map((f) => f.relPath)).not.toContain('escape/secret.txt');
    expect(files).toHaveLength(0);
  });

  it('does not read a symlinked file (even if it matches include)', () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'imgtokenx-symfile-'));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'imgtokenx-outside-'));
    const secret = path.join(outside, 'secret.txt');
    fs.writeFileSync(secret, 'leaked-via-symlink');
    fs.symlinkSync(secret, path.join(root, 'link.txt'), 'file');
    // A real in-tree file that SHOULD be collected.
    fs.writeFileSync(path.join(root, 'ok.txt'), 'keep-me');

    const files = collectFilesFromTargets([root], ['**/*.txt'], []);
    const rels = files.map((f) => f.relPath);
    expect(rels).toContain('ok.txt');
    expect(rels).not.toContain('link.txt');
    expect(files.find((f) => f.relPath === 'ok.txt')?.content).toBe('keep-me');
  });

  it('still collects real in-tree files normally', () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'imgtokenx-real-'));
    fs.writeFileSync(path.join(root, 'a.txt'), 'one');
    fs.mkdirSync(path.join(root, 'sub'));
    fs.writeFileSync(path.join(root, 'sub', 'b.txt'), 'two');

    const files = collectFilesFromTargets([root], ['**/*.txt'], []);
    expect(files).toHaveLength(2);
  });
});
