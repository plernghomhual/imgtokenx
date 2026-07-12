/**
 * Recovery-side retention caps — pure module, importable from
 * src/node.ts AND from tests/recovery-retention.test.ts (audit #21 E7).
 *
 * Three independent caps apply in order:
 *   1. AGE  (IMGTOKENX_RECOVERY_MAX_AGE_DAYS, default 7)
 *   2. BYTE (IMGTOKENX_RECOVERY_MAX_BYTES,   default 256 MiB)
 *   3. COUNT (MAX_RECOVERABLE_FILES,         default 4096)
 *
 * Any explicit value of `0` DISABLES its cap. A missing or non-numeric env
 * var falls back to the default (not to "disabled").
 *
 * The age pass runs first (mtime is already on each file). The byte+count
 * pass then drops oldest first until both are within budget.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export const MAX_RECOVERABLE_FILES = 4096;
export const DEFAULT_RECOVERY_MAX_AGE_DAYS = 7;
export const DEFAULT_RECOVERY_MAX_BYTES = 256 * 1024 * 1024;
export const MS_PER_DAY = 86_400_000;

export interface RecoveryCaps {
  /** Max age in ms. 0 = disabled. */
  maxAgeMs: number;
  /** Max total bytes. 0 = disabled. */
  maxBytes: number;
  /** Max file count. 0 = disabled. */
  maxFiles: number;
}

function readCaps(ageValue: string | undefined, bytesValue: string | undefined): RecoveryCaps {
  const age = readEnvNumber(ageValue);
  const bytes = readEnvNumber(bytesValue);
  return {
    maxAgeMs: age === undefined ? DEFAULT_RECOVERY_MAX_AGE_DAYS * MS_PER_DAY
      : Math.floor(age * MS_PER_DAY),
    maxBytes: bytes === undefined ? DEFAULT_RECOVERY_MAX_BYTES : bytes,
    maxFiles: MAX_RECOVERABLE_FILES,
  };
}

/** Read caps from env each call (cheap; values fit in registers). Missing or
 *  non-numeric envs fall back to defaults; explicit `0` disables the cap. */
export function readRecoveryCaps(): RecoveryCaps {
  return readCaps(
    process.env.IMGTOKENX_RECOVERY_MAX_AGE_DAYS,
    process.env.IMGTOKENX_RECOVERY_MAX_BYTES,
  );
}

/** Artifact files share the defaults and count ceiling, but not the recovery
 *  sidecar age/byte budget. */
export function readArtifactCaps(): RecoveryCaps {
  return readCaps(
    process.env.IMGTOKENX_ARTIFACTS_MAX_AGE_DAYS,
    process.env.IMGTOKENX_ARTIFACTS_MAX_BYTES,
  );
}

function readEnvNumber(v: string | undefined): number | undefined {
  if (v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** Prune `.txt` recovery files in `dir` to satisfy all caps. Failure-tolerant
 *  — every unlink is wrapped in try/catch so a single vanished file can't
 *  abort the rest of the sweep. */
export function pruneRecoverableDir(
  dir: string,
  caps = readRecoveryCaps(),
  filter?: (name: string) => boolean,
): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  const now = Date.now();
  const files = entries
    .filter((e) => e.isFile() && e.name.endsWith('.txt'))
    .filter((e) => filter?.(e.name) ?? true)
    .map((e) => {
      let mtimeMs = 0;
      let size = 0;
      try {
        const st = fs.statSync(path.join(dir, e.name));
        mtimeMs = st.mtimeMs;
        size = st.size;
      } catch { /* gone */ }
      return { name: e.name, mtimeMs, size };
    });
  // (1) Age cap. Strictly-older; 0 disables.
  if (caps.maxAgeMs > 0) {
    for (const f of files) {
      if (now - f.mtimeMs > caps.maxAgeMs) {
        try { fs.unlinkSync(path.join(dir, f.name)); } catch { /* gone */ }
      }
    }
  }
  // Re-read survivors so the byte/count pass doesn't double-count
  // unlinked files. The in-memory `files` array could be mutated
  // (mark removed entries) but that creates drift between mtime and
  // reality — a fresh stat after unlink is the only honest signal.
  const survivors = files
    .filter((f) => {
      try { return fs.statSync(path.join(dir, f.name)).isFile(); } catch { return false; }
    })
    .sort((a, b) => a.mtimeMs - b.mtimeMs || a.name.localeCompare(b.name));
  let totalBytes = 0;
  for (const f of survivors) totalBytes += f.size;
  // (2+3) Byte+count caps; drop oldest first until both are within budget.
  let i = 0;
  while (
    i < survivors.length
    && ((caps.maxBytes > 0 && totalBytes > caps.maxBytes)
      || (caps.maxFiles > 0 && survivors.length - i > caps.maxFiles))
  ) {
    try { fs.unlinkSync(path.join(dir, survivors[i]!.name)); } catch { /* gone */ }
    totalBytes -= survivors[i]!.size;
    i += 1;
  }
}

export function pruneRecoverySidecars(dir: string): void {
  pruneRecoverableDir(dir, readRecoveryCaps(), (name) => !name.startsWith('artifact_'));
}

export function pruneContextArtifacts(dir: string): void {
  pruneRecoverableDir(dir, readArtifactCaps(), (name) => name.startsWith('artifact_'));
}
