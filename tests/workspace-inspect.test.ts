import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { inspectWorkspace } from '../src/workspace-inspect.js';
import { callInspectTool } from '../src/mcp.js';

describe('bounded read-only workspace inspection', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns relative evidence snippets and skips ignored, binary, and symlinked content', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'imgtokenx-inspect-'));
    dirs.push(root);
    fs.mkdirSync(path.join(root, 'src'));
    fs.mkdirSync(path.join(root, 'node_modules'));
    fs.writeFileSync(path.join(root, 'src', 'a.ts'), 'before\nTARGET invariant\nafter\n');
    fs.writeFileSync(path.join(root, 'src', 'binary.bin'), Buffer.from([0, 1, 2, 3]));
    fs.writeFileSync(path.join(root, '.env'), 'TARGET=credential');
    fs.writeFileSync(path.join(root, 'node_modules', 'hidden.js'), 'TARGET hidden');
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'imgtokenx-inspect-outside-'));
    dirs.push(outside);
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'TARGET outside');
    fs.symlinkSync(outside, path.join(root, 'linked'));

    const result = inspectWorkspace(root, 'TARGET', { maxFiles: 5, contextLines: 1 });

    expect(result.matches).toEqual([{
      path: 'src/a.ts',
      line: 2,
      excerpt: '1: before\n2: TARGET invariant\n3: after',
    }]);
    expect(result.scannedFiles).toBe(2);
    expect(result.scannedBytes).toBeGreaterThan(0);
    expect(result.truncated).toBe(false);

    const previous = process.env.IMGTOKENX_WORKSPACE_ROOT;
    process.env.IMGTOKENX_WORKSPACE_ROOT = root;
    try {
      expect(JSON.parse(callInspectTool({ query: 'TARGET', max_files: 5, context_lines: 1 })))
        .toMatchObject({ matches: [{ path: 'src/a.ts', line: 2 }] });
      expect(() => callInspectTool({ query: 'TARGET', command: 'rm -rf /' }))
        .toThrow('unsupported inspect argument');
    } finally {
      if (previous === undefined) delete process.env.IMGTOKENX_WORKSPACE_ROOT;
      else process.env.IMGTOKENX_WORKSPACE_ROOT = previous;
    }
    delete process.env.IMGTOKENX_WORKSPACE_ROOT;
    expect(() => callInspectTool({ query: 'TARGET' })).toThrow('workspace inspection unavailable');
    if (previous !== undefined) process.env.IMGTOKENX_WORKSPACE_ROOT = previous;
  });

  it('bounds excerpts around the literal and refuses overly broad roots', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'imgtokenx-inspect-long-'));
    dirs.push(root);
    fs.writeFileSync(path.join(root, 'long.txt'), `${'x'.repeat(20_000)}TARGET${'y'.repeat(20_000)}`);

    const result = inspectWorkspace(root, 'TARGET', { contextLines: 0 });
    expect(result.matches[0]!.excerpt).toContain('TARGET');
    expect(Buffer.byteLength(result.matches[0]!.excerpt)).toBeLessThanOrEqual(8_200);
    expect(() => inspectWorkspace(os.homedir(), 'TARGET')).toThrow('workspace root is too broad');
  });
});
