import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { recoverById } from '../src/node.js';
import { callRecoverTool } from '../src/mcp.js';

describe('recoverById', () => {
  it('returns the newest recovery source for a rec_* id', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pxpipe-recoverbyid-'));
    try {
      fs.writeFileSync(
        path.join(dir, '2026-07-08T00-00-00_req001_model_rec_deadbeef_tool_result.txt'),
        'older exact source',
      );
      fs.writeFileSync(
        path.join(dir, '2026-07-08T00-00-01_req002_model_rec_deadbeef_tool_result.txt'),
        'newer exact source',
      );

      expect(recoverById(dir, 'rec_deadbeef')).toBe('newer exact source');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('errors clearly on a missing id', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pxpipe-recoverbyid-'));
    try {
      expect(() => recoverById(dir, 'rec_00000000')).toThrow(/no recovery source found/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('errors clearly on a malformed id', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pxpipe-recoverbyid-'));
    try {
      expect(() => recoverById(dir, 'not-a-rec-id')).toThrow(/expected a recovery id/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('pxpipe_recover MCP tool (callRecoverTool)', () => {
  const origEnv = process.env.PXPIPE_RECOVERABLE_DIR;
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pxpipe-mcp-recover-'));
    process.env.PXPIPE_RECOVERABLE_DIR = dir;
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    if (origEnv === undefined) delete process.env.PXPIPE_RECOVERABLE_DIR;
    else process.env.PXPIPE_RECOVERABLE_DIR = origEnv;
  });

  it('recovers the exact source text for a valid rec_id argument', () => {
    fs.writeFileSync(
      path.join(dir, '2026-07-08T00-00-00_req001_model_rec_f00dcafe_static_slab.txt'),
      'the exact static slab source',
    );

    expect(callRecoverTool('rec_f00dcafe')).toBe('the exact static slab source');
  });

  it('throws a clear error when rec_id is missing or not a string', () => {
    expect(() => callRecoverTool(undefined)).toThrow(/rec_id must be a non-empty string/);
    expect(() => callRecoverTool(42)).toThrow(/rec_id must be a non-empty string/);
  });

  it('throws a clear error when recovery is disabled', () => {
    process.env.PXPIPE_RECOVERABLE_DIR = 'off';
    expect(() => callRecoverTool('rec_f00dcafe')).toThrow(/recovery is disabled/);
  });
});
