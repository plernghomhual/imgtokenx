import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface ContextMetricTotals {
  contextToolCalls: number;
  contextToolSuccesses: number;
  contextResultChars: number;
  workspaceInspectCalls: number;
}

const EMPTY: ContextMetricTotals = {
  contextToolCalls: 0,
  contextToolSuccesses: 0,
  contextResultChars: 0,
  workspaceInspectCalls: 0,
};
const MAX_METRICS_BYTES = 1024 * 1024;
const METRICS_FILE = '.context-metrics.jsonl';

export function emptyContextMetricTotals(): ContextMetricTotals {
  return { ...EMPTY };
}

function metricsPath(dir: string): string {
  return path.join(dir, METRICS_FILE);
}

function safeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function add(target: ContextMetricTotals, value: Partial<ContextMetricTotals>): void {
  target.contextToolCalls += safeNumber(value.contextToolCalls);
  target.contextToolSuccesses += safeNumber(value.contextToolSuccesses);
  target.contextResultChars += safeNumber(value.contextResultChars);
  target.workspaceInspectCalls += safeNumber(value.workspaceInspectCalls);
}

export function readContextMetricTotals(dir: string): ContextMetricTotals {
  const totals = emptyContextMetricTotals();
  try {
    const file = metricsPath(dir);
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size > MAX_METRICS_BYTES * 2) return totals;
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line) continue;
      try {
        const record = JSON.parse(line) as Partial<ContextMetricTotals>;
        add(totals, record);
      } catch {
        // Metrics are advisory; ignore a torn/corrupt line.
      }
    }
  } catch {
    // Missing/unavailable metrics are equivalent to zero.
  }
  return totals;
}

/** Append privacy-safe MCP counters. No query, handle, path, or content is logged. */
export function recordContextMetric(
  dir: string,
  kind: 'context' | 'inspect',
  success: boolean,
  resultChars = 0,
): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const dirStat = fs.lstatSync(dir);
  if (dirStat.isSymbolicLink() || !dirStat.isDirectory()) return;
  fs.chmodSync(dir, 0o700);
  const file = metricsPath(dir);
  const event: ContextMetricTotals = {
    contextToolCalls: kind === 'context' ? 1 : 0,
    contextToolSuccesses: kind === 'context' && success ? 1 : 0,
    contextResultChars: kind === 'context' && success
      ? Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(resultChars)))
      : 0,
    workspaceInspectCalls: kind === 'inspect' ? 1 : 0,
  };

  try {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isFile()) return;
    if (stat.size >= MAX_METRICS_BYTES) {
      const totals = readContextMetricTotals(dir);
      add(totals, event);
      const temp = path.join(dir, `.context-metrics-${randomBytes(8).toString('hex')}.tmp`);
      fs.writeFileSync(temp, `${JSON.stringify(totals)}\n`, { mode: 0o600, flag: 'wx' });
      fs.renameSync(temp, file);
      fs.chmodSync(file, 0o600);
      return;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return;
  }
  fs.appendFileSync(file, `${JSON.stringify(event)}\n`, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

export function contextMetricDelta(
  current: ContextMetricTotals,
  previous: ContextMetricTotals,
): ContextMetricTotals {
  return {
    contextToolCalls: Math.max(0, current.contextToolCalls - previous.contextToolCalls),
    contextToolSuccesses: Math.max(0, current.contextToolSuccesses - previous.contextToolSuccesses),
    contextResultChars: Math.max(0, current.contextResultChars - previous.contextResultChars),
    workspaceInspectCalls: Math.max(0, current.workspaceInspectCalls - previous.workspaceInspectCalls),
  };
}
