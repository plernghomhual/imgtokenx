/**
 * Atomic file writes — write to a tmp file in the SAME directory, fsync, then
 * rename over the target. Single source of truth used by:
 *   - src/install.ts (plist, env.sh, ~/.zshrc, opencode config writes)
 *   - src/sessions.ts (events.jsonl bulk rewrite)
 *
 * Why atomic: a plain `writeFileSync(target, content)` is one syscall but
 * the kernel can hand the system a half-written file if the process dies
 * mid-write (power loss, OOM kill, ENOSPC at the worst possible moment).
 * Rename over an existing file is atomic on Linux + macOS for same-fs
 * renames, so `fsync(tmp) + rename(tmp, target)` is the textbook safe
 * pattern. The tmp file MUST live in path.dirname(target) so the rename
 * stays on one filesystem — otherwise EXDEV (cross-device link) breaks
 * atomicity on macOS/Linux.
 *
 * Used by imgtokenx install because the audit (D20) requires that a
 * multi-step install either completes ALL writes or leaves the system in
 * a state recoverable by a `git restore`-style reinstall, not a half-mixed
 * one with a 0-byte plist.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export interface WriteAtomicOptions {
  /** fs mode for the target file (umask still applies). Use 0o600 for
   *  files with secrets, 0o644 for plist. Defaults to 0o644. */
  mode?: number;
  /** If true, also fsync the parent directory after rename so the rename
   *  itself survives a power loss. Costs ~5-50ms per call. Default false
   *  because most call sites only need crash-consistency, not full
   *  power-loss durability. */
  fsyncDir?: boolean;
  /** Stable label for debug logs. */
  label?: string;
}

/** Write `content` to `targetPath` atomically: tmp file in target's
 *  directory → fsync → rename → optional dir fsync. Throws on any IO
 *  failure; the tmp file is best-effort cleaned up first so a follow-up
 *  retry doesn't see a stale `.tmp.${pid}.${ts}` sibling. */
export function writeFileAtomic(
  targetPath: string,
  content: string | Uint8Array,
  opts: WriteAtomicOptions = {},
): void {
  const mode = opts.mode ?? 0o644;
  const dir = path.dirname(targetPath);
  fs.mkdirSync(dir, { recursive: true });

  // Tmp lives on the SAME filesystem so rename is atomic on POSIX. The
  // pid+epoch suffix prevents two concurrent installs from clobbering the
  // same tmp file (rare in practice but the cost is one extra string
  // concat).
  const tmp = `${targetPath}.tmp.${process.pid}.${Date.now().toString(36)}`;
  let opened: number | undefined;
  try {
    opened = fs.openSync(tmp, 'w', mode);
    const buf = typeof content === 'string'
      ? Buffer.from(content, 'utf8')
      : Buffer.from(content);
    fs.writeSync(opened, buf, 0, buf.byteLength);
    fs.fsyncSync(opened);
    fs.closeSync(opened);
    opened = undefined;
    fs.renameSync(tmp, targetPath);
    if (opts.fsyncDir) {
      try {
        const dirFd = fs.openSync(dir, 'r');
        try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
      } catch {
        /* fsync of a directory ENOTSUP on some macOS tmpfs; best-effort */
      }
    }
  } catch (err) {
    // Best-effort cleanup so the next retry sees a clean slate.
    if (opened !== undefined) { try { fs.closeSync(opened); } catch { /* ignore */ } }
    try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ }
    throw err;
  }
}

/** Read the target's pre-existing bytes (or null if absent). Used by the
 *  installer to capture a backup before overwriting. Synchronous — callers
 *  are install + sessions, both happy with blocking I/O on tiny files. */
export function readFileOrNull(targetPath: string): Buffer | null {
  try {
    return fs.readFileSync(targetPath);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'ENOENT') return null;
    throw err;
  }
}
