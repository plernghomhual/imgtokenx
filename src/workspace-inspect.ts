import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export interface WorkspaceInspectOptions {
  maxFiles?: number;
  contextLines?: number;
}

export interface WorkspaceMatch {
  path: string;
  line: number;
  excerpt: string;
}

export interface WorkspaceInspection {
  query: string;
  scannedFiles: number;
  scannedBytes: number;
  matches: WorkspaceMatch[];
  truncated: boolean;
}

const IGNORED_DIRS = new Set([
  '.git',
  '.ssh',
  '.aws',
  '.gnupg',
  'node_modules',
  'dist',
  '.cache',
  'coverage',
]);
const MAX_SCANNED_FILES = 5_000;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_SCANNED_BYTES = 32 * 1024 * 1024;
const MAX_EXCERPT_BYTES = 8 * 1024;

function boundedInteger(
  name: string,
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}`);
  }
  return value;
}

function sensitiveFile(name: string): boolean {
  const lower = name.toLowerCase();
  return lower === '.env' || lower.startsWith('.env.')
    || lower === '.npmrc' || lower === '.pypirc' || lower === '.netrc'
    || lower === 'credentials' || lower.endsWith('.pem') || lower.endsWith('.key')
    || lower.endsWith('.p12') || lower.endsWith('.pfx');
}

function boundExcerpt(excerpt: string, query: string): string {
  const bytes = Buffer.from(excerpt, 'utf8');
  if (bytes.length <= MAX_EXCERPT_BYTES) return excerpt;
  const queryAt = bytes.indexOf(Buffer.from(query, 'utf8'));
  let start = Math.max(0, queryAt - Math.floor(MAX_EXCERPT_BYTES / 3));
  let end = Math.min(bytes.length, start + MAX_EXCERPT_BYTES);
  if (end - start < MAX_EXCERPT_BYTES) start = Math.max(0, end - MAX_EXCERPT_BYTES);
  while (start < end && (bytes[start]! & 0xc0) === 0x80) start++;
  while (end > start && end < bytes.length && (bytes[end]! & 0xc0) === 0x80) end--;
  return `${start > 0 ? '…' : ''}${bytes.subarray(start, end).toString('utf8')}${end < bytes.length ? '…' : ''}`;
}

/** Literal, read-only workspace search. It never follows symlinks or invokes a
 * shell, and returns relative paths plus bounded line context. */
export function inspectWorkspace(
  root: string,
  query: string,
  opts: WorkspaceInspectOptions = {},
): WorkspaceInspection {
  if (typeof query !== 'string' || query.length === 0 || Buffer.byteLength(query) > 256) {
    throw new Error('query must be a non-empty literal of at most 256 bytes');
  }
  const maxFiles = boundedInteger('max_files', opts.maxFiles, 10, 1, 20);
  const contextLines = boundedInteger('context_lines', opts.contextLines, 2, 0, 5);
  const base = fs.realpathSync(root);
  if (!fs.statSync(base).isDirectory()) throw new Error('workspace root unavailable');
  const filesystemRoot = path.parse(base).root;
  const home = fs.realpathSync(os.homedir());
  if (base === filesystemRoot || base === home) throw new Error('workspace root is too broad');

  const matches: WorkspaceMatch[] = [];
  let scannedFiles = 0;
  let scannedBytes = 0;
  let scanLimitHit = false;

  const visit = (dir: string): void => {
    if (matches.length >= maxFiles || scannedFiles >= MAX_SCANNED_FILES
      || scannedBytes >= MAX_SCANNED_BYTES) {
      scanLimitHit = true;
      return;
    }
    const entries = fs.readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (matches.length >= maxFiles || scannedFiles >= MAX_SCANNED_FILES
        || scannedBytes >= MAX_SCANNED_BYTES) {
        scanLimitHit = true;
        return;
      }
      if (entry.isSymbolicLink()) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) visit(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (sensitiveFile(entry.name)) continue;
      const stat = fs.lstatSync(full);
      if (stat.size > MAX_FILE_BYTES) continue;
      if (scannedBytes + stat.size > MAX_SCANNED_BYTES) {
        scanLimitHit = true;
        return;
      }
      const bytes = fs.readFileSync(full);
      scannedFiles++;
      scannedBytes += bytes.byteLength;
      if (bytes.includes(0)) continue;
      const text = bytes.toString('utf8');
      const lines = text.split(/\r?\n/);
      const at = lines.findIndex((line) => line.includes(query));
      if (at < 0) continue;
      const start = Math.max(0, at - contextLines);
      const end = Math.min(lines.length, at + contextLines + 1);
      const excerpt = boundExcerpt(lines.slice(start, end)
        .map((line, i) => `${start + i + 1}: ${line}`)
        .join('\n'), query);
      matches.push({ path: path.relative(base, full), line: at + 1, excerpt });
    }
  };
  visit(base);
  return { query, scannedFiles, scannedBytes, matches, truncated: scanLimitHit };
}
