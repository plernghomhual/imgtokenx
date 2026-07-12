import { createHash, randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { TextDecoder } from 'node:util';

import { pruneRecoverableDir } from './recovery-retention.js';

export type ArtifactHandle = string;

export interface StoredContextArtifact {
  handle: ArtifactHandle;
  byteLength: number;
  created: boolean;
}

export interface StoredContextCheckpoint extends StoredContextArtifact {
  marker: string;
}

export interface ContextPreview {
  totalBytes: number;
  truncated: boolean;
  text?: string;
  head?: string;
  errors?: string[];
  tail?: string;
}

export interface ContextFetch {
  handle: ArtifactHandle;
  startByte: number;
  endByte: number;
  totalBytes: number;
  text: string;
}

export interface ContextSearchMatch {
  byteOffset: number;
  line: number;
  snippet: string;
}

export interface ContextSearch {
  handle: ArtifactHandle;
  query: string;
  matches: ContextSearchMatch[];
  truncated: boolean;
}

export interface ContextDiff {
  beforeHandle: ArtifactHandle;
  afterHandle: ArtifactHandle;
  identical: boolean;
  commonPrefixLines: number;
  commonSuffixLines: number;
  removedLines: number;
  addedLines: number;
  text: string;
}

export const CONTEXT_PREVIEW_THRESHOLD_BYTES = 8 * 1024;
export const CONTEXT_CHECKPOINT_MARKER_PREFIX = 'imgtokenx_checkpoint:';
export const MAX_CONTEXT_FETCH_BYTES = 32 * 1024;
export const MAX_CONTEXT_SEARCH_MATCHES = 20;
export const MAX_CONTEXT_CHECKPOINT_BYTES = 1024 * 1024;

const HANDLE_PREFIX = 'sha256_';
const HANDLE_HEX_LENGTH = 64;
const MAX_CONTEXT_ARTIFACT_BYTES = 64 * 1024 * 1024;
const MAX_CONTEXT_DIFF_INPUT_BYTES = 16 * 1024 * 1024;
const MAX_CONTEXT_DIFF_OUTPUT_BYTES = 8 * 1024;
const MAX_CONTEXT_QUERY_BYTES = 512;
const MAX_CONTEXT_SEARCH_SNIPPET_BYTES = 1024;
const ERROR_MARKERS = ['error', 'fatal', 'panic', 'exception', 'failed', 'failure'];
const UTF8 = new TextDecoder('utf-8', { fatal: true });

export class ContextArtifactError extends Error {
  override name = 'ContextArtifactError';
}

function artifactError(message: string): never {
  throw new ContextArtifactError(message);
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function handleHex(handle: unknown): string {
  if (typeof handle !== 'string' || handle.length !== HANDLE_PREFIX.length + HANDLE_HEX_LENGTH
    || !handle.startsWith(HANDLE_PREFIX)) {
    artifactError('invalid artifact handle');
  }
  const hex = handle.slice(HANDLE_PREFIX.length);
  for (const char of hex) {
    if (!(char >= '0' && char <= '9') && !(char >= 'a' && char <= 'f')) {
      artifactError('invalid artifact handle');
    }
  }
  return hex;
}

function artifactPath(dir: string, handle: ArtifactHandle): string {
  return path.join(dir, `artifact_${handleHex(handle)}.txt`);
}

/** Cheap existence check for checkpoint evidence validation. Exact reads still
 * verify the full SHA-256 before returning any bytes. */
export function hasContextArtifact(dir: string, handle: ArtifactHandle): boolean {
  try {
    // A filename alone is not proof: verify the bytes still hash to the handle
    // before a checkpoint is allowed to discard recoverable history.
    readArtifactBytes(dir, handle);
    return true;
  } catch {
    return false;
  }
}

function ensurePrivateDir(dir: string, create: boolean): void {
  try {
    if (create) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const stat = fs.lstatSync(dir);
    if (stat.isSymbolicLink() || !stat.isDirectory()) artifactError('context storage unavailable');
    fs.chmodSync(dir, 0o700);
  } catch (error) {
    if (error instanceof ContextArtifactError) throw error;
    artifactError('context storage unavailable');
  }
}

function readArtifactBytes(
  dir: string,
  handle: ArtifactHandle,
  maxBytes = MAX_CONTEXT_ARTIFACT_BYTES,
): Buffer {
  handleHex(handle);
  ensurePrivateDir(dir, false);
  const file = artifactPath(dir, handle);
  try {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isFile()) artifactError('artifact unavailable');
    if (stat.size > maxBytes) artifactError('artifact exceeds operation limit');
    const bytes = fs.readFileSync(file);
    if (`${HANDLE_PREFIX}${sha256(bytes)}` !== handle) artifactError('artifact integrity check failed');
    return bytes;
  } catch (error) {
    if (error instanceof ContextArtifactError) throw error;
    artifactError('artifact unavailable');
  }
}

function pruneAndConfirm(dir: string, file: string): void {
  pruneRecoverableDir(dir);
  try {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isFile()) artifactError('artifact not retained');
  } catch (error) {
    if (error instanceof ContextArtifactError) throw error;
    artifactError('artifact not retained');
  }
}

function decodeUtf8(bytes: Uint8Array, boundaryError = false): string {
  try {
    return UTF8.decode(bytes);
  } catch {
    artifactError(boundaryError
      ? 'range must align to UTF-8 boundaries'
      : 'artifact is not valid UTF-8');
  }
}

function utf8Prefix(text: string, maxBytes: number): string {
  if (maxBytes <= 0) return '';
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.length <= maxBytes) return text;
  let end = maxBytes;
  while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end--;
  return decodeUtf8(bytes.subarray(0, end));
}

function utf8Suffix(text: string, maxBytes: number): string {
  if (maxBytes <= 0) return '';
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.length <= maxBytes) return text;
  let start = bytes.length - maxBytes;
  while (start < bytes.length && (bytes[start]! & 0xc0) === 0x80) start++;
  return decodeUtf8(bytes.subarray(start));
}

function collectErrorSnippets(text: string, maxBytes: number): string[] {
  const snippets: string[] = [];
  let used = 0;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length && used < maxBytes && snippets.length < 16; i++) {
    let line = lines[i]!;
    if (line.endsWith('\r')) line = line.slice(0, -1);
    const lower = line.toLowerCase();
    if (!ERROR_MARKERS.some((marker) => lower.includes(marker))) continue;
    const prefix = `L${i + 1}: `;
    const remaining = maxBytes - used;
    if (Buffer.byteLength(prefix) >= remaining) break;
    const snippet = prefix + utf8Prefix(line, remaining - Buffer.byteLength(prefix));
    snippets.push(snippet);
    used += Buffer.byteLength(snippet);
  }
  return snippets;
}

/** Produce a deterministic preview. Small text is returned whole; larger text
 * is split into fixed byte-budgeted head, error-line, and tail sections. */
export function previewContextText(text: string): ContextPreview {
  const totalBytes = Buffer.byteLength(text, 'utf8');
  if (totalBytes <= CONTEXT_PREVIEW_THRESHOLD_BYTES) {
    return { totalBytes, truncated: false, text };
  }
  return {
    totalBytes,
    truncated: true,
    head: utf8Prefix(text, 2 * 1024),
    errors: collectErrorSnippets(text, 3 * 1024),
    tail: utf8Suffix(text, 2 * 1024),
  };
}

/** Store exact bytes under their full SHA-256. Writes use a private temporary
 * file followed by an atomic rename; duplicate content reuses the same file. */
export function storeContextArtifact(
  dir: string,
  data: string | Uint8Array,
): StoredContextArtifact {
  const bytes = typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data);
  if (bytes.length > MAX_CONTEXT_ARTIFACT_BYTES) artifactError('artifact exceeds storage limit');
  ensurePrivateDir(dir, true);

  const handle = `${HANDLE_PREFIX}${sha256(bytes)}`;
  const finalPath = artifactPath(dir, handle);
  try {
    const stat = fs.lstatSync(finalPath);
    if (stat.isSymbolicLink() || !stat.isFile()) artifactError('context storage unavailable');
    const existing = fs.readFileSync(finalPath);
    if (existing.equals(bytes)) {
      fs.chmodSync(finalPath, 0o600);
      const now = new Date();
      fs.utimesSync(finalPath, now, now);
      pruneAndConfirm(dir, finalPath);
      return { handle, byteLength: bytes.length, created: false };
    }
  } catch (error) {
    if (error instanceof ContextArtifactError) throw error;
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') artifactError('context storage unavailable');
  }

  const tempPath = path.join(
    dir,
    `.tmp_${process.pid}_${randomBytes(8).toString('hex')}_${handleHex(handle)}.txt`,
  );
  let fd: number | undefined;
  try {
    fd = fs.openSync(tempPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(tempPath, finalPath);
    fs.chmodSync(finalPath, 0o600);
  } catch {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* best effort */ }
    }
    try { fs.unlinkSync(tempPath); } catch { /* best effort */ }
    artifactError('context storage unavailable');
  }
  pruneAndConfirm(dir, finalPath);
  return { handle, byteLength: bytes.length, created: true };
}

/** Fetch one exact byte range. A range that would split a UTF-8 sequence is
 * rejected instead of returning replacement characters. */
export function fetchContextArtifact(
  dir: string,
  handle: ArtifactHandle,
  startByte: number,
  lengthBytes: number,
): ContextFetch {
  if (!Number.isSafeInteger(startByte) || startByte < 0
    || !Number.isSafeInteger(lengthBytes) || lengthBytes <= 0
    || lengthBytes > MAX_CONTEXT_FETCH_BYTES) {
    artifactError('invalid fetch range');
  }
  const bytes = readArtifactBytes(dir, handle);
  const endByte = startByte + lengthBytes;
  if (!Number.isSafeInteger(endByte) || endByte > bytes.length) artifactError('invalid fetch range');
  const text = decodeUtf8(bytes.subarray(startByte, endByte), true);
  return { handle, startByte, endByte, totalBytes: bytes.length, text };
}

function lineSnippet(bytes: Buffer, matchAt: number, queryBytes: number): string {
  const lineStartAt = bytes.lastIndexOf(0x0a, Math.max(0, matchAt - 1));
  const lineEndAt = bytes.indexOf(0x0a, matchAt + queryBytes);
  const lineStart = lineStartAt < 0 ? 0 : lineStartAt + 1;
  const lineEnd = lineEndAt < 0 ? bytes.length : lineEndAt;
  if (lineEnd - lineStart <= MAX_CONTEXT_SEARCH_SNIPPET_BYTES) {
    return decodeUtf8(bytes.subarray(lineStart, lineEnd));
  }
  const before = Math.floor((MAX_CONTEXT_SEARCH_SNIPPET_BYTES - queryBytes) / 2);
  let start = Math.max(lineStart, matchAt - Math.max(0, before));
  let end = Math.min(lineEnd, start + MAX_CONTEXT_SEARCH_SNIPPET_BYTES);
  while (start < matchAt && (bytes[start]! & 0xc0) === 0x80) start++;
  while (end > matchAt + queryBytes && end < bytes.length && (bytes[end]! & 0xc0) === 0x80) end--;
  const prefix = start > lineStart ? '…' : '';
  const suffix = end < lineEnd ? '…' : '';
  return prefix + decodeUtf8(bytes.subarray(start, end)) + suffix;
}

/** Search a single artifact for a case-sensitive literal. No regex or path is
 * accepted; results and snippets are hard bounded. */
export function searchContextArtifact(
  dir: string,
  handle: ArtifactHandle,
  query: string,
  maxMatches = 20,
): ContextSearch {
  const needle = Buffer.from(query, 'utf8');
  if (needle.length === 0 || needle.length > MAX_CONTEXT_QUERY_BYTES
    || !Number.isSafeInteger(maxMatches) || maxMatches <= 0
    || maxMatches > MAX_CONTEXT_SEARCH_MATCHES) {
    artifactError('invalid literal search');
  }
  const bytes = readArtifactBytes(dir, handle);
  decodeUtf8(bytes);
  const matches: ContextSearchMatch[] = [];
  let from = 0;
  let line = 1;
  let lineCursor = 0;
  while (matches.length < maxMatches) {
    const at = bytes.indexOf(needle, from);
    if (at < 0) break;
    while (lineCursor < at) {
      if (bytes[lineCursor] === 0x0a) line++;
      lineCursor++;
    }
    matches.push({
      byteOffset: at,
      line,
      snippet: lineSnippet(bytes, at, needle.length),
    });
    from = at + needle.length;
  }
  const truncated = matches.length === maxMatches && bytes.indexOf(needle, from) >= 0;
  return { handle, query, matches, truncated };
}

function compactText(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text;
  const marker = '\n…\n';
  const contentBudget = Math.max(0, maxBytes - Buffer.byteLength(marker));
  const headBudget = Math.floor(contentBudget / 2);
  return utf8Prefix(text, headBudget) + marker + utf8Suffix(text, contentBudget - headBudget);
}

/** Return one bounded line-oriented replacement diff after trimming identical
 * prefix and suffix lines.
 * ponytail: one changed region; add bounded Myers diff only if consumers need
 * multiple hunks. */
export function diffContextArtifacts(
  dir: string,
  beforeHandle: ArtifactHandle,
  afterHandle: ArtifactHandle,
): ContextDiff {
  const before = decodeUtf8(readArtifactBytes(dir, beforeHandle, MAX_CONTEXT_DIFF_INPUT_BYTES));
  const after = decodeUtf8(readArtifactBytes(dir, afterHandle, MAX_CONTEXT_DIFF_INPUT_BYTES));
  if (before === after) {
    return {
      beforeHandle,
      afterHandle,
      identical: true,
      commonPrefixLines: before.split('\n').length,
      commonSuffixLines: 0,
      removedLines: 0,
      addedLines: 0,
      text: 'no changes',
    };
  }
  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');
  let prefix = 0;
  while (prefix < beforeLines.length && prefix < afterLines.length
    && beforeLines[prefix] === afterLines[prefix]) prefix++;
  let suffix = 0;
  while (suffix < beforeLines.length - prefix && suffix < afterLines.length - prefix
    && beforeLines[beforeLines.length - 1 - suffix] === afterLines[afterLines.length - 1 - suffix]) {
    suffix++;
  }
  const removed = beforeLines.slice(prefix, beforeLines.length - suffix).join('\n');
  const added = afterLines.slice(prefix, afterLines.length - suffix).join('\n');
  const removedLines = beforeLines.length - prefix - suffix;
  const addedLines = afterLines.length - prefix - suffix;
  const header = `@@ line ${prefix + 1}; -${removedLines} +${addedLines} @@\n--- before\n`;
  const middle = '\n+++ after\n';
  const overhead = Buffer.byteLength(header) + Buffer.byteLength(middle);
  const contentBudget = MAX_CONTEXT_DIFF_OUTPUT_BYTES - overhead;
  const beforeBudget = Math.floor(contentBudget / 2);
  const text = header + compactText(removed, beforeBudget)
    + middle + compactText(added, contentBudget - beforeBudget);
  return {
    beforeHandle,
    afterHandle,
    identical: false,
    commonPrefixLines: prefix,
    commonSuffixLines: suffix,
    removedLines,
    addedLines,
    text,
  };
}

export function contextCheckpointMarker(handle: ArtifactHandle): string {
  handleHex(handle);
  return `${CONTEXT_CHECKPOINT_MARKER_PREFIX}${handle}`;
}

export function storeContextCheckpoint(dir: string, text: string): StoredContextCheckpoint {
  if (Buffer.byteLength(text, 'utf8') > MAX_CONTEXT_CHECKPOINT_BYTES) {
    artifactError('checkpoint exceeds storage limit');
  }
  const stored = storeContextArtifact(dir, text);
  return { ...stored, marker: contextCheckpointMarker(stored.handle) };
}

/** Return the exact checkpoint text for local state restoration. MCP callers
 * receive a bounded preview and can use fetch ranges for exact large reads. */
export function readContextCheckpointText(dir: string, handle: ArtifactHandle): string {
  return decodeUtf8(readArtifactBytes(dir, handle, MAX_CONTEXT_CHECKPOINT_BYTES));
}

export function readContextCheckpoint(dir: string, handle: ArtifactHandle): ContextPreview {
  return previewContextText(readContextCheckpointText(dir, handle));
}
