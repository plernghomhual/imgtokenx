import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  contextMetricDelta,
  readContextMetricTotals,
  recordContextMetric,
} from '../src/context-metrics.js';

describe('context MCP metrics', () => {
  it('records only bounded counters in a private file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imgtokenx-context-metrics-'));
    try {
      recordContextMetric(dir, 'context', true, 123);
      recordContextMetric(dir, 'context', false, 999);
      recordContextMetric(dir, 'inspect', true, 456);
      const totals = readContextMetricTotals(dir);

      expect(totals).toEqual({
        contextToolCalls: 2,
        contextToolSuccesses: 1,
        contextResultChars: 123,
        workspaceInspectCalls: 1,
      });
      expect(contextMetricDelta(totals, {
        contextToolCalls: 1,
        contextToolSuccesses: 0,
        contextResultChars: 20,
        workspaceInspectCalls: 0,
      })).toEqual({
        contextToolCalls: 1,
        contextToolSuccesses: 1,
        contextResultChars: 103,
        workspaceInspectCalls: 1,
      });
      const file = path.join(dir, '.context-metrics.jsonl');
      expect(fs.statSync(file).mode & 0o777).toBe(0o600);
      expect(fs.readFileSync(file, 'utf8')).not.toContain('query');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
