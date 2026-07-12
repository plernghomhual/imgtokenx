import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  CONTEXT_PREVIEW_THRESHOLD_BYTES,
  diffContextArtifacts,
  fetchContextArtifact,
  hasContextArtifact,
  previewContextText,
  readContextCheckpoint,
  readContextCheckpointText,
  searchContextArtifact,
  storeContextArtifact,
  storeContextCheckpoint,
} from '../src/context-artifacts.js';
import { callContextTool } from '../src/mcp.js';

describe('content-addressed context artifacts', () => {
  const originalDir = process.env.IMGTOKENX_RECOVERABLE_DIR;
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imgtokenx-context-'));
    process.env.IMGTOKENX_RECOVERABLE_DIR = dir;
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    if (originalDir === undefined) delete process.env.IMGTOKENX_RECOVERABLE_DIR;
    else process.env.IMGTOKENX_RECOVERABLE_DIR = originalDir;
  });

  it('stores exact bytes once under their full SHA-256 with private modes', () => {
    const text = 'exact 🙂 bytes\n';
    const expected = createHash('sha256').update(Buffer.from(text)).digest('hex');
    const first = storeContextArtifact(dir, text);
    const second = storeContextArtifact(dir, text);

    expect(first).toEqual({
      handle: `sha256_${expected}`,
      byteLength: Buffer.byteLength(text),
      created: true,
    });
    expect(second).toMatchObject({ handle: first.handle, created: false });
    expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
    const files = fs.readdirSync(dir);
    expect(files).toEqual([`artifact_${expected}.txt`]);
    expect(fs.statSync(path.join(dir, files[0]!)).mode & 0o777).toBe(0o600);
    expect(fs.readFileSync(path.join(dir, files[0]!))).toEqual(Buffer.from(text));
    expect(hasContextArtifact(dir, first.handle)).toBe(true);
    expect(hasContextArtifact(dir, 'sha256_' + '0'.repeat(64))).toBe(false);
    fs.writeFileSync(path.join(dir, files[0]!), 'tampered');
    expect(hasContextArtifact(dir, first.handle)).toBe(false);
  });

  it('returns deterministic head/error/tail previews above 8 KiB', () => {
    const text = `HEAD\n${'x'.repeat(CONTEXT_PREVIEW_THRESHOLD_BYTES)}\nFATAL exploded\nTAIL`;
    const first = previewContextText(text);
    const second = previewContextText(text);

    expect(first).toEqual(second);
    expect(first.truncated).toBe(true);
    expect(first.head).toContain('HEAD');
    expect(first.errors).toEqual([expect.stringContaining('FATAL exploded')]);
    expect(first.tail).toContain('TAIL');
    expect(Buffer.byteLength(first.head ?? '')
      + (first.errors ?? []).reduce((sum, value) => sum + Buffer.byteLength(value), 0)
      + Buffer.byteLength(first.tail ?? '')).toBeLessThanOrEqual(CONTEXT_PREVIEW_THRESHOLD_BYTES);
    expect(previewContextText('small')).toEqual({ totalBytes: 5, truncated: false, text: 'small' });
  });

  it('fetches exact byte ranges without splitting UTF-8 sequences', () => {
    const stored = storeContextArtifact(dir, 'A🙂B');
    expect(fetchContextArtifact(dir, stored.handle, 1, 4)).toMatchObject({
      startByte: 1,
      endByte: 5,
      totalBytes: 6,
      text: '🙂',
    });
    expect(() => fetchContextArtifact(dir, stored.handle, 2, 3))
      .toThrow(/UTF-8 boundaries/);
  });

  it('searches literals only and bounds match count', () => {
    const stored = storeContextArtifact(dir, 'a.b regex-like\naXb not-literal\na.b again\na.b last\n');
    const result = searchContextArtifact(dir, stored.handle, 'a.b', 2);

    expect(result.matches).toHaveLength(2);
    expect(result.matches.map((match) => match.line)).toEqual([1, 3]);
    expect(result.matches.every((match) => match.snippet.includes('a.b'))).toBe(true);
    expect(result.truncated).toBe(true);
  });

  it('returns a bounded changed-region diff', () => {
    const before = storeContextArtifact(dir, `same\nold\n${'a'.repeat(12_000)}\ntail`);
    const after = storeContextArtifact(dir, `same\nnew\n${'b'.repeat(12_000)}\ntail`);
    const diff = diffContextArtifacts(dir, before.handle, after.handle);

    expect(diff).toMatchObject({
      identical: false,
      commonPrefixLines: 1,
      commonSuffixLines: 1,
      removedLines: 2,
      addedLines: 2,
    });
    expect(diff.text).toContain('old');
    expect(diff.text).toContain('new');
    expect(Buffer.byteLength(diff.text)).toBeLessThanOrEqual(CONTEXT_PREVIEW_THRESHOLD_BYTES);
  });

  it('stores and reads checkpoints through the same artifact store', () => {
    const checkpoint = storeContextCheckpoint(dir, 'decision: keep native tools');
    expect(checkpoint.marker).toBe(`imgtokenx_checkpoint:${checkpoint.handle}`);
    expect(readContextCheckpointText(dir, checkpoint.handle)).toBe('decision: keep native tools');
    expect(readContextCheckpoint(dir, checkpoint.handle)).toEqual({
      totalBytes: 27,
      truncated: false,
      text: 'decision: keep native tools',
    });
    expect(JSON.parse(callContextTool({ action: 'checkpoint_read', handle: checkpoint.handle })))
      .toMatchObject({ handle: checkpoint.handle, text: 'decision: keep native tools' });
  });

  it('exposes bounded MCP operations without accepting paths or regex options', () => {
    const stored = JSON.parse(callContextTool({ action: 'checkpoint_store', text: 'one\ntwo\n' })) as {
      handle: string;
    };
    expect(JSON.parse(callContextTool({
      action: 'search',
      handle: stored.handle,
      query: 'two',
      limit: 5,
    }))).toMatchObject({ matches: [{ line: 2, snippet: 'two' }] });
    expect(JSON.parse(callContextTool({
      action: 'fetch',
      handle: stored.handle,
      start_byte: 4,
      length_bytes: 3,
    }))).toMatchObject({ text: 'two' });
    expect(() => callContextTool({
      action: 'search',
      handle: stored.handle,
      query: 'two',
      path: '/tmp/secret',
    })).toThrow('unsupported context argument');
    expect(() => callContextTool({
      action: 'search',
      handle: '../../secret',
      query: 'x',
    })).toThrow('invalid artifact handle');
    expect(() => callContextTool({
      action: 'search',
      handle: stored.handle,
      query: 'x',
      limit: 21,
    })).toThrow('invalid literal search');
    expect(() => callContextTool({
      action: 'fetch',
      handle: stored.handle,
      start_byte: 0,
      length_bytes: 32_769,
    })).toThrow('invalid fetch range');
  });

  it('does not expose filesystem paths in tool errors', () => {
    const missing = 'sha256_' + '0'.repeat(64);
    try {
      callContextTool({ action: 'checkpoint_read', handle: missing });
      throw new Error('expected failure');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toBe('artifact unavailable');
      expect(message).not.toContain(dir);
    }
  });
});
