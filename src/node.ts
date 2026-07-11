/**
 * Node entrypoint — `node:http` server + minimal CLI flag parsing.
 *
 * Wraps the runtime-agnostic `createProxy` from src/core/proxy.ts. The
 * heavy lifting (transform, render, PNG) is identical to the Worker
 * version; only the request/response plumbing differs.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createProxy, parseGatewayHeaders, resolveUpstreams, type ProxyConfig } from './core/proxy.js';
import { doctorExitCode, formatDoctor, parseInstallArgs, runDoctor, runInstall, runUninstall } from './install.js';
import {
  applyConfigFileDefaults,
  isRuntimeDisabled,
  persistModelsConfig,
  persistRuntimeEnabled,
} from './node-config.js';
import { defaultRecoverableDir, recoverById, resolveRecoverableDir } from './recovery.js';
export { defaultRecoverableDir, recoverById, resolveRecoverableDir } from './recovery.js';
import { pruneRecoverableDir } from './recovery-retention.js';
export { pruneRecoverableDir, readRecoveryCaps } from './recovery-retention.js';
import {
  parseExportArgv,
  runExportCore,
  type ExportParsed,
  type ExportResult,
} from './core/export.js';
import { redactErrorBody } from './core/redact.js';
import {
  parseModelsPayload,
  parseTogglePayload,
  badRequest as badRequest,
} from './dashboard-mutations.js';
import { readExportTextFile } from './export-collect.js';
import {
  toTrackEvent,
  TRACK_BODY_INLINE_MAX,
  type Tracker,
  type TrackEvent,
} from './core/tracker.js';
import {
  DashboardState,
  dashboardMutationAllowed,
  dashboardPath,
  type DashboardRoute,
} from './dashboard.js';

/** Runtime config. The core transform tuning comes from DEFAULTS in
 *  transform.ts; startup knobs cover deployment plus emergency GPT scope
 *  control. No CLI flags beyond --help/--version. */
interface RuntimeConfig {
  port: number;
  /** Interface to bind. Defaults to 127.0.0.1 (loopback only) — the dashboard
   *  is unauthenticated and serves captured request context, so it must not be
   *  exposed to the LAN by default. Set HOST=0.0.0.0 to opt into all interfaces
   *  (e.g. reaching the dashboard from another device / the host of a container). */
  host: string;
  upstream: string;
  openAIUpstream: string;
  openAIApiKey?: string;
  provider?: 'cloudflare-ai-gateway';
  gatewayBaseUrl?: string;
  gatewayHeaders?: Record<string, string>;
  eventsFile: string;
}

function parseCli(argv: string[]): RuntimeConfig {
  // Only flags accepted are --help and --version. Anything else is an
  // error — there is exactly ONE way to run imgtokenx and the dashboard
  // exposes every metric the operator might want to inspect.
  for (const a of argv) {
    if (a === '-h' || a === '--help') {
      printHelp();
      process.exit(0);
    }
    if (a === '--version') {
      printVersion();
      process.exit(0);
    }
    if (a.startsWith('-')) {
      console.error(`[imgtokenx] unknown option: ${a}`);
      console.error(`[imgtokenx] this build accepts no flags; run \`imgtokenx --help\` for env vars`);
      process.exit(2);
    }
  }
  applyConfigFileDefaults();
  const sharedUpstream = process.env.IMGTOKENX_UPSTREAM;
  return {
    port: Number(process.env.PORT ?? 47821),
    // Loopback by default; opt into all-interfaces exposure explicitly via HOST.
    host: process.env.HOST?.trim() || '127.0.0.1',
    upstream: process.env.ANTHROPIC_UPSTREAM ?? sharedUpstream ?? 'https://api.anthropic.com',
    openAIUpstream: process.env.OPENAI_UPSTREAM ?? sharedUpstream ?? 'https://api.openai.com',
    openAIApiKey: process.env.OPENAI_API_KEY,
    provider: parseProvider(process.env.IMGTOKENX_PROVIDER),
    gatewayBaseUrl: process.env.IMGTOKENX_GATEWAY_BASE_URL,
    gatewayHeaders: parseGatewayHeaders(process.env.IMGTOKENX_GATEWAY_HEADERS),
    eventsFile:
      process.env.IMGTOKENX_LOG ??
      path.join(os.homedir(), '.imgtokenx', 'events.jsonl'),
  };
}

function parseProvider(v: string | undefined): 'cloudflare-ai-gateway' | undefined {
  if (v === undefined || v === '') return undefined;
  if (v === 'cloudflare-ai-gateway') return v;
  console.error(`[imgtokenx] unknown IMGTOKENX_PROVIDER: ${v}`);
  process.exit(2);
}

function printHelp(): void {
  console.log(`imgtokenx — token-saving proxy for Claude Code

Usage:
  imgtokenx                run the proxy (no flags)
  imgtokenx install        install launchd auto-start + shell wrappers
  imgtokenx uninstall      remove launchd auto-start + shell wrappers
  imgtokenx doctor         check launchd, wrappers, healthz, and MCP wiring
  imgtokenx export [...]   render files/diff to PNG pages + cost report (see imgtokenx export --help)
  imgtokenx recover rec_*  print exact source text from IMGTOKENX_RECOVERABLE_DIR

The proxy compresses eligible tools, schemas, reminders, tool_results,
and history; tracks events to disk; and measures real saved_pct via
/v1/messages/count_tokens. The dashboard kill switch persists globally;
restart already-running clients so they drop their inherited proxy base URL.

Stats, sessions, and cleanup tools live in the dashboard at
  http://127.0.0.1:<port>/  (default port 47821)
Health check:
  http://127.0.0.1:<port>/healthz

Flags:
  -h, --help              show this help
      --version           show version

Environment:
  PORT                    listen port (default 47821)
  HOST                    interface to bind (default 127.0.0.1, loopback only).
                          Set 0.0.0.0 to expose the dashboard off-host — note it
                          is unauthenticated and serves captured request context.
  IMGTOKENX_UPSTREAM         upstream API base for every API family
  ANTHROPIC_UPSTREAM      Anthropic API base; overrides IMGTOKENX_UPSTREAM
                           (default https://api.anthropic.com)
  OPENAI_UPSTREAM         OpenAI API base; overrides IMGTOKENX_UPSTREAM
                           (default https://api.openai.com)
  OPENAI_API_KEY          optional OpenAI key override; otherwise forwarded
  IMGTOKENX_PROVIDER         optional: 'cloudflare-ai-gateway' — route both API
                          families through one gateway base URL
  IMGTOKENX_GATEWAY_BASE_URL gateway base URL (required with IMGTOKENX_PROVIDER)
  IMGTOKENX_GATEWAY_HEADERS  extra upstream headers: JSON object or k=v;k2=v2
  IMGTOKENX_MODELS           comma-separated model bases to image (Claude + GPT);
                          default claude-fable-5; off disables
  IMGTOKENX_CONFIG           JSON config path (default ~/.config/imgtokenx/config.json)
                          supports {"models": [...]} or {"models": "off"}
  IMGTOKENX_DISABLE          1/true/yes/on bypasses imaging for this proxy process
  IMGTOKENX_LOG              JSONL events path (default ~/.imgtokenx/events.jsonl)
  IMGTOKENX_DUMP_DIR         debug: write every rendered PNG here (what the model
                          sees); off unless set. Compress arm only.
  IMGTOKENX_RECOVERABLE_DIR  default-on: write exact source text for rec_* recovery
                          refs here (defaults to ~/.imgtokenx/recovery, written
                          0600). Set to "off" / "0" / "false" / "no" to disable.
                          May contain secrets / PII — directory is owner-readable only.
                          Caps (any set to 0 disables that cap; missing or
                          non-numeric envs fall back to the default):
  IMGTOKENX_RECOVERY_MAX_AGE_DAYS  delete .txt files older than N days (default 7)
  IMGTOKENX_RECOVERY_MAX_BYTES    delete oldest until total size ≤ N bytes
                          (default 268435456 = 256 MiB)
  IMGTOKENX_LOSSLESS_EXACT   when true, keep exact-risk blocks as text unless
                          IMGTOKENX_RECOVERABLE_DIR is also set.

Use with Claude Code:
  ANTHROPIC_BASE_URL=http://127.0.0.1:47821 claude

Use with Codex / OpenAI-compatible GPT clients:
  OPENAI_BASE_URL=http://127.0.0.1:47821/v1

Use with OpenCode provider-prefixed routers:
  Anthropic base: http://127.0.0.1:47821/anthropic
  OpenAI base:    http://127.0.0.1:47821/openai
`);
}

// Package version, inlined at bundle time by scripts/build.mjs via esbuild
// `define`. Under a non-bundled dev runner (tsx) the identifier is not defined;
// `typeof` returns "undefined" instead of throwing (ECMA-262 §13.5.3), so the
// guard is safe. `npm_package_version` is only a dev fallback: npm sets it just
// inside its own run-script env, so for `npx imgtokenx` or a global bin it is
// undefined (or reflects the *consumer's* package), never this tool's version.
declare const __IMGTOKENX_VERSION__: string | undefined;

function printVersion(): void {
  const injected = typeof __IMGTOKENX_VERSION__ === 'string' ? __IMGTOKENX_VERSION__ : undefined;
  console.log(injected ?? process.env.npm_package_version ?? 'unknown');
}

function packageRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

// ---- node:http <-> Web Request/Response bridge ---------------------------

function toWebRequest(req: IncomingMessage): Request {
  const proto = (req.headers['x-forwarded-proto'] as string) ?? 'http';
  const host = req.headers.host ?? 'localhost';
  const url = `${proto}://${host}${req.url ?? '/'}`;

  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v == null) continue;
    if (Array.isArray(v)) v.forEach((vv) => headers.append(k, vv));
    else headers.append(k, v);
  }

  const method = req.method ?? 'GET';
  const hasBody = method !== 'GET' && method !== 'HEAD';

  // Buffer the body — proxy needs to read /v1/messages bodies fully anyway,
  // and Node's IncomingMessage → ReadableStream conversion has duplex quirks.
  let body: BodyInit | undefined;
  if (hasBody) {
    body = new ReadableStream<Uint8Array>({
      start(controller) {
        req.on('data', (chunk) => controller.enqueue(chunk));
        req.on('end', () => controller.close());
        req.on('error', (e) => controller.error(e));
      },
    });
  }

  return new Request(url, {
    method,
    headers,
    body,
    // @ts-expect-error — duplex is required for streamed request bodies in Node 18+
    duplex: hasBody ? 'half' : undefined,
  });
}

function isConnectionAbort(err: unknown): boolean {
  const e = err as {
    name?: unknown;
    message?: unknown;
    code?: unknown;
    cause?: { code?: unknown; message?: unknown };
  };
  const name = typeof e?.name === 'string' ? e.name : '';
  const code = typeof e?.code === 'string'
    ? e.code
    : typeof e?.cause?.code === 'string'
      ? e.cause.code
      : '';
  const message = typeof e?.message === 'string' ? e.message : '';
  const causeMessage = typeof e?.cause?.message === 'string' ? e.cause.message : '';
  return name === 'AbortError' ||
    code === 'UND_ERR_SOCKET' ||
    code === 'ECONNRESET' ||
    code === 'EPIPE' ||
    message === 'client response closed' ||
    message === 'terminated' ||
    message.includes('aborted') ||
    causeMessage.includes('other side closed');
}

async function waitForDrain(out: ServerResponse): Promise<void> {
  // Manual listener pairing, not Promise.race(once(), once()): the race leaves the
  // losing 'close' listener attached after every drain, leaking one listener per
  // backpressure event on long streams (upstream pxpipe #92).
  if (out.destroyed || out.writableEnded) throw new Error('client response closed');
  await new Promise<void>((resolve, reject) => {
    const onDrain = (): void => {
      out.off('close', onClose);
      resolve();
    };
    const onClose = (): void => {
      out.off('drain', onDrain);
      reject(new Error('client response closed'));
    };
    out.once('drain', onDrain);
    out.once('close', onClose);
  });
}

async function writeWebResponse(res: Response, out: ServerResponse): Promise<void> {
  out.statusCode = res.status;
  res.headers.forEach((v, k) => out.setHeader(k, v));
  if (!res.body) {
    out.end();
    return;
  }
  const reader = res.body.getReader();
  let finished = false;
  const cancelBody = () => {
    if (!finished) void reader.cancel().catch(() => undefined);
  };
  out.once('close', cancelBody);
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value && !out.write(value)) await waitForDrain(out);
    }
    if (!out.writableEnded) out.end();
  } catch (err) {
    if (isConnectionAbort(err) || out.destroyed || out.writableEnded) {
      if (!out.destroyed && !out.writableEnded) out.destroy(err instanceof Error ? err : undefined);
      return;
    }
    throw err;
  } finally {
    finished = true;
    out.off('close', cancelBody);
    reader.releaseLock();
  }
}

/** Read the entire request body as text. Bounded at 1 MiB — every dashboard
 *  POST is tiny JSON (a few hundred bytes). The cap is a defense against a
 *  pathological/malicious client; legitimate proxy traffic doesn't hit these
 *  routes. */
async function readRequestBody(req: IncomingMessage): Promise<string> {
  const MAX = 1024 * 1024;
  let bytes = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    const b = chunk as Buffer;
    bytes += b.byteLength;
    if (bytes > MAX) throw new Error('request body too large');
    chunks.push(b);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Dispatch a matched DashboardRoute to the appropriate handler. Returns
 * undefined when the method/route combination doesn't apply so the caller
 * can fall through to the upstream proxy (e.g. a GET path that's only
 * defined for POST). Keeps the createServer body small + readable.
 */
// Audit finding D18: a recognized dashboard route hit with the wrong method
// must return 405 + Allow, NOT fall through to the proxy (which would forward
// it to the upstream API). Used by the GET-only dashboard routes below.
function methodNotAllowed(allow: string): Response {
  return new Response('method not allowed', {
    status: 405,
    headers: { Allow: allow, 'content-type': 'text/plain' },
  });
}

export async function dispatchDashboard(
  dashboard: DashboardState,
  route: DashboardRoute,
  req: IncomingMessage,
  url: URL,
  port: number,
): Promise<Response | undefined> {
  const method = req.method ?? 'GET';
  const fetchSite = req.headers['sec-fetch-site'];
  // Apply the origin/fetch-site guard to EVERY method, not just POST. The
  // dashboard GET routes (notably /api/image-source) return verbatim user
  // prompt/system text; an unguarded GET let a cross-site page visited while
  // the loopback proxy runs exfiltrate that content. Same-origin browser
  // requests and non-browser (no Origin header) local clients are still
  // allowed — matches the documented loopback-only threat model.
  if (!dashboardMutationAllowed(
    req.headers.origin,
    url.origin,
    Array.isArray(fetchSite) ? fetchSite[0] : fetchSite,
  )) {
    return new Response('forbidden', { status: 403 });
  }
  let out: Response | Promise<Response> | undefined;
  switch (route.kind) {
    case 'html':
      if (method !== 'GET') { out = methodNotAllowed('GET'); break; }
      out = dashboard.serveHtml(port);
      break;
    case 'icon':
      if (method !== 'GET' && method !== 'HEAD') { out = methodNotAllowed('GET, HEAD'); break; }
      // Icon opts into caching via its own cache-control header; leave it be.
      return new Response(null, {
        status: 204,
        headers: { 'cache-control': 'public, max-age=86400' },
      });
    case 'stats':
      if (method !== 'GET') { out = methodNotAllowed('GET'); break; }
      out = dashboard.serveStats();
      break;
    case 'recent':
      if (method !== 'GET') { out = methodNotAllowed('GET'); break; }
      out = dashboard.serveRecent();
      break;
    case 'png': {
      if (method !== 'GET') { out = methodNotAllowed('GET'); break; }
      const idRaw = url.searchParams.get('id');
      const idNum = idRaw != null ? Number(idRaw) : NaN;
      out = dashboard.servePng(Number.isFinite(idNum) ? idNum : undefined);
      break;
    }
    case 'api-image-source': {
      if (method !== 'GET') { out = methodNotAllowed('GET'); break; }
      const idRaw = url.searchParams.get('id');
      const idNum = idRaw != null ? Number(idRaw) : NaN;
      out = dashboard.serveImageSource(Number.isFinite(idNum) ? idNum : undefined);
      break;
    }
    case 'api-sessions': {
      if (method !== 'GET') { out = methodNotAllowed('GET'); break; }
      out = dashboard.serveSessionsJson({
        project: url.searchParams.get('project') ?? undefined,
        since: url.searchParams.get('since') ?? undefined,
      });
      break;
    }
    case 'api-stats':
      if (method !== 'GET') { out = methodNotAllowed('GET'); break; }
      out = dashboard.serveApiStats();
      break;
    case 'current-session':
      if (method !== 'GET') { out = methodNotAllowed('GET'); break; }
      out = dashboard.serveCurrentSessionJson();
      break;
    case 'fragment': {
      // /fragments/toggle is the one mutating fragment — htmx POSTs the next
      // state and the server flips the global kill switch and returns the
      // re-rendered toggle markup. Body is strict JSON via parseTogglePayload;
      // any malformed payload returns a typed 400 the dashboard can surface.
      if (route.name === 'toggle' && method === 'POST') {
        try {
          const raw = await readRequestBody(req);
          const { enabled } = parseTogglePayload(raw);
          dashboard.handleCompressionToggle({ enabled });
          out = dashboard.serveFragment('toggle', url, port);
        } catch (err) {
          out = badRequest(err);
        }
        break;
      }
      // /fragments/models POSTs one chip flip: {model, on}. The model id goes
      // through validateModelId (1-80 chars, [A-Za-z0-9._-] starting alpha)
      // before any disk persistence, so a malformed or hostile id returns a
      // 400 instead of being silently written to ~/.config/imgtokenx/config.json.
      if (route.name === 'models' && method === 'POST') {
        try {
          const raw = await readRequestBody(req);
          const { model, on } = parseModelsPayload(raw);
          dashboard.handleModelsToggle(model, on);
          out = dashboard.serveFragment('models', url, port);
        } catch (err) {
          out = badRequest(err);
        }
        break;
      }
      if (method !== 'GET') { out = methodNotAllowed('GET'); break; }
      out = dashboard.serveFragment(route.name, url, port);
      break;
    }
    case 'api-compression': {
      if (method !== 'POST') {
        out = new Response(
          JSON.stringify({ error: 'use POST' }),
          { status: 405, headers: { Allow: 'POST', 'content-type': 'application/json' } },
        );
        break;
      }
      // Same strict-JSON contract as /fragments/toggle — single source of
      // truth in parseTogglePayload.
      try {
        const raw = await readRequestBody(req);
        const { enabled } = parseTogglePayload(raw);
        out = dashboard.handleCompressionToggle({ enabled });
      } catch (err) {
        out = badRequest(err);
      }
      break;
    }
  }
  // Audit finding E5: never cache dashboard responses (they can carry verbatim
  // prompt/system text). The icon already sets its own cache-control.
  if (out) out = await out;
  if (out && !out.headers.has('cache-control')) {
    out.headers.set('cache-control', 'no-store');
  }
  return out;
}

// ---- FileTracker ----------------------------------------------------------

/**
 * Append-only JSONL tracker with size-based rotation. One line per request.
 *
 * Node-only — uses node:fs. The Worker host uses tracker.JsonLogTracker with
 * console.log instead (Cloudflare ingests that as Workers Logs).
 *
 * Rotation: when the current file exceeds MAX_FILE_BYTES (100 MB by default),
 * it's renamed to `<path>.1` (overwriting any previous .1) and a fresh file
 * is opened. Keeps one generation of history; for longer retention pipe
 * the file off-host yourself.
 *
 * Failures here NEVER propagate — the proxy must keep serving requests even
 * if the disk is full or the path is unwritable.
 */
class FileTracker implements Tracker {
  private fd: number | null = null;
  private bytesWritten = 0;
  private brokenLogged = false;
  private static readonly MAX_FILE_BYTES = 100 * 1024 * 1024;

  constructor(private readonly filePath: string) {}

  private ensureOpen(): boolean {
    if (this.fd != null) return true;
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    } catch {
      /* dir may already exist or be unmkable; openSync below will surface */
    }
    try {
      const st = fs.statSync(this.filePath);
      this.bytesWritten = st.size;
    } catch {
      this.bytesWritten = 0;
    }
    try {
      this.fd = fs.openSync(this.filePath, 'a');
      return true;
    } catch (err) {
      if (!this.brokenLogged) {
        console.error(
          `[imgtokenx] FileTracker disabled — cannot open ${this.filePath}: ${(err as Error).message}`,
        );
        this.brokenLogged = true;
      }
      return false;
    }
  }

  private rotate(): void {
    if (this.fd != null) {
      try {
        fs.closeSync(this.fd);
      } catch {
        /* ignore */
      }
      this.fd = null;
    }
    try {
      fs.renameSync(this.filePath, this.filePath + '.1');
    } catch {
      /* if rename fails (e.g. .1 locked) we'll just keep growing — better
         than dropping events */
    }
    this.bytesWritten = 0;
  }

  emit(ev: TrackEvent): void {
    if (!this.ensureOpen()) return;
    try {
      const line = JSON.stringify(ev) + '\n';
      const buf = Buffer.from(line, 'utf8');
      fs.writeSync(this.fd!, buf);
      this.bytesWritten += buf.length;
      if (this.bytesWritten > FileTracker.MAX_FILE_BYTES) this.rotate();
    } catch (err) {
      if (!this.brokenLogged) {
        console.error(
          `[imgtokenx] FileTracker write failed: ${(err as Error).message}`,
        );
        this.brokenLogged = true;
      }
    }
  }

  flush(): void {
    if (this.fd != null) {
      try {
        fs.fsyncSync(this.fd);
      } catch {
        /* ignore */
      }
    }
  }

  close(): void {
    if (this.fd != null) {
      try {
        fs.fsyncSync(this.fd);
      } catch {
        /* ignore */
      }
      try {
        fs.closeSync(this.fd);
      } catch {
        /* ignore */
      }
      this.fd = null;
    }
  }
}

// ---- 4xx body sidecar writer ---------------------------------------------

/**
 * For oversized 4xx body samples that won't fit inline in the JSONL row, we
 * write them to a sidecar file at `<dir>/${ts}-${sha8}.json.gz`. The path
 * lands in the event as `req_body_sample_path`. Survives log rotation and
 * stays out of the streaming dashboard.
 *
 * Failure mode: directory unwritable or write fails → returns undefined and
 * the body sample is silently dropped (we still keep the sha8 and error_body
 * for diagnostics; the request itself was never blocked by this).
 */
async function maybeWriteBodySidecar(
  bytesGz: Uint8Array,
  sha8: string | undefined,
  dir: string,
): Promise<string | undefined> {
  try {
    // Lazy mkdir — only when we actually need to write.
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    return undefined;
  }
  // Filename: timestamp + sha8 keeps collisions effectively impossible and
  // makes the file naturally sortable. Sha8 fallback covers the edge case
  // where the hash wasn't computed (zero-byte body, etc.).
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const tag = sha8 ?? 'nohash';
  const filePath = path.join(dir, `${ts}-${tag}.json.gz`);
  try {
    // 0o600 — these sidecars hold verbatim user prompt/system text from 4xx
    // requests; keep them owner-read only (audit finding E5).
    await fs.promises.writeFile(filePath, bytesGz, { mode: 0o600 });
    return filePath;
  } catch {
    return undefined;
  }
}

// ---- imgtokenx export -------------------------------------------------------

function printExportHelp(): void {
  console.log(`imgtokenx export — render code/text to PNG pages for compressed LLM context

Usage:
  imgtokenx export [target ...]    default target is "." (current directory)

Targets:
  Files or directories to include. Multiple targets are joined with a header
  separator line. Defaults to "." when none are given.

Options:
  --include <glob>   include only files matching glob (repeatable)
  --exclude <glob>   exclude files matching glob (repeatable)
  --git              render "git diff HEAD" plus untracked files
  --diff <ref>       render "git diff <ref>"
  --stdin            read source text from stdin instead of files
  --out <dir>        base output directory (default \$TMPDIR or /tmp)
  --model <id>       model id for vision-token estimate (default claude-sonnet-4-5)
  --json             print report as JSON
  --open             reveal the output folder when done (macOS) so you can
                     drag the PNG pages straight into your chat
  -h, --help         show this help

Output:
  <out>/imgtokenx-export-<hash>/
    page-001.png ...  rendered image pages
    factsheet.txt     verbatim precision tokens (paths, SHAs, ids, numbers)
    manifest.json     metadata + token report
    prompt.txt        paste-ready agent instruction referencing the images

Report columns:
  text tokens   approximate tokens if the source were sent as plain text
  image tokens  estimated tokens to send the rendered PNG pages
  % saved       (text − image) / text × 100

Examples:
  imgtokenx export .                              # whole directory
  imgtokenx export --include "*.ts" src/          # TypeScript files only
  imgtokenx export --git                          # uncommitted changes
  imgtokenx export --diff HEAD~3                  # last 3 commits
  imgtokenx export --open src/                    # render src/, then reveal the folder
  cat big-file.txt | imgtokenx export --stdin
`);
}

/** Directories never descended into when walking files. */
const WALK_SKIP_DIRS = new Set([
  'node_modules', '.git', '.svn', '.hg', 'dist', 'build',
  '__pycache__', '.cache', '.next', '.nuxt', '.turbo',
]);

interface CollectedFile {
  relPath: string;
  content: string;
}

/** Recursively walk a directory, collecting text files that pass include/exclude filters. */
function walkDir(
  dir: string,
  rootDir: string,
  include: string[],
  exclude: string[],
  out: CollectedFile[],
): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
   for (const entry of entries) {
    if (entry.isSymbolicLink()) continue; // don't follow symlinks out of the tree
    const full = path.join(dir, entry.name);
    const rel = path.relative(rootDir, full).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      if (WALK_SKIP_DIRS.has(entry.name)) continue;
      walkDir(full, rootDir, include, exclude, out);
    } else if (entry.isFile()) {
      // Bulk directory walk: skip silently on any gate miss (per-file warnings
      // would be noise across a whole tree).
      const r = readExportTextFile(full, rel, include, exclude);
      if (r.kind === 'ok') out.push({ relPath: rel, content: r.content });
    }
  }
}

/** Cap the recovery dir so it can't grow unbounded on a long-running proxy.
 *  Three independent caps — any explicit env value of `0` DISABLES that cap.
 *  Run in order: age first (free, mtime already known), then byte + count on
 *  the survivors (newest-first). Each is the longest-lived constraint a
 *  multi-day proxy should ever hold:
 *  - AGE:           `IMGTOKENX_RECOVERY_MAX_AGE_DAYS` default 7 days.
 *  - BYTE:          `IMGTOKENX_RECOVERY_MAX_BYTES`   default 256 MiB.
 *  - COUNT (last):  `MAX_RECOVERABLE_FILES` = 4096. Hard ceiling that
 *                   keeps a runaway pace from walking the whole dir on every
 *                   write; not configurable via env.
 *  Implementation lives in src/recovery-retention.ts so tests can import
 *  the source of truth directly (audit finding E7).
 *  NOTE: `.txt` recovery sources are intentionally NOT redacted — `rec_*` is
 *  the "exact byte recovery" contract and files are 0600 + ttl-pruned.
 *  Redaction happens at the JSONL/stderr layer instead. */

/** Collect files from a list of targets (files or directories). */
export function collectFilesFromTargets(
  targets: string[],
  include: string[],
  exclude: string[],
): CollectedFile[] {
  const files: CollectedFile[] = [];
  for (const target of targets) {
    let st: fs.Stats;
    try { st = fs.statSync(target); } catch {
      console.warn(`[imgtokenx export] skipping inaccessible target: ${target}`);
      continue;
    }
    if (st.isDirectory()) {
      walkDir(target, target, include, exclude, files);
    } else if (st.isFile()) {
      const rel = path.basename(target);
      const r = readExportTextFile(target, rel, include, exclude);
      if (r.kind === 'ok') files.push({ relPath: rel, content: r.content });
      else if (r.kind !== 'excluded') {
        console.warn(`[imgtokenx export] skipping ${r.kind} file: ${target}`);
      }
    }
  }
  return files;
}

/** Run a git command in `cwd`, return stdout string or null on failure. */
function gitRun(args: string[], cwd: string): string | null {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.status !== 0 || result.error) return null;
  return result.stdout ?? null;
}

/** Collect source text for the export run. Returns [sourceText, sourceFiles[]] */
async function collectSource(opts: ExportParsed): Promise<[string, string[]]> {
  // --stdin
  if (opts.stdin) {
    const chunks: string[] = [];
    process.stdin.setEncoding('utf8');
    for await (const chunk of process.stdin) {
      if (typeof chunk === 'string') chunks.push(chunk);
    }
    return [chunks.join(''), []];
  }

  // --diff <ref>
  if (opts.diff !== undefined) {
    const cwd = opts.targets.length > 0 ? opts.targets[0]! : process.cwd();
    const diff = gitRun(['diff', opts.diff], cwd);
    if (diff === null) {
      console.error(`[imgtokenx export] git diff ${opts.diff} failed`);
      process.exit(1);
    }
    return [diff, []];
  }

  // --git
  if (opts.git) {
    const cwd = opts.targets.length > 0 ? opts.targets[0]! : process.cwd();
    const diff = gitRun(['diff', 'HEAD'], cwd) ?? '';
    // Collect untracked files
    const untrackedOut = gitRun(['ls-files', '--others', '--exclude-standard'], cwd) ?? '';
    const untrackedFiles = untrackedOut
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    let untracked = '';
    for (const rel of untrackedFiles) {
      const full = path.join(cwd, rel);
      // Same include/exclude + size + binary gate as directory mode. Untracked
      // files previously bypassed all of it: --include/--exclude were ignored
      // and an oversized file was read fully into memory.
      const r = readExportTextFile(full, rel, opts.include, opts.exclude);
      if (r.kind === 'ok') untracked += `\n===== ${rel} =====\n` + r.content;
      else if (r.kind !== 'excluded') {
        console.warn(`[imgtokenx export] skipping ${r.kind} untracked file: ${rel}`);
      }
    }
    const sourceText = diff + untracked;
    return [sourceText, []];
  }

  // File/directory mode (default)
  const targets = opts.targets.length > 0 ? opts.targets : ['.'];
  const files = collectFilesFromTargets(targets, opts.include, opts.exclude);
  if (files.length === 0) {
    console.warn('[imgtokenx export] no files collected');
  }
  const sourceText = files
    .map((f) => `===== ${f.relPath} =====\n${f.content}`)
    .join('\n\n');
  const sourceFiles = files.map((f) => f.relPath);
  return [sourceText, sourceFiles];
}

function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

function printExportReport(opts: ExportParsed, outDir: string, sourceFiles: string[], result: ExportResult): void {
  const { manifest } = result;
  const { tokenReport, pages } = manifest;
  const totalPngBytes = pages.reduce((s, p) => s + p.bytes, 0);

  if (opts.json) {
    process.stdout.write(
      JSON.stringify({
        outDir,
        fileCount: sourceFiles.length,
        sourceChars: manifest.sourceChars,
        pageCount: pages.length,
        totalPngBytes,
        textTokens: tokenReport.textTokens,
        imageTokens: tokenReport.imageTokens,
        percentSaved: tokenReport.percentSaved,
        factsheetItemCount: tokenReport.factsheetItemCount,
        factsheetDropped: tokenReport.factsheetDropped,
        model: manifest.model,
        cols: manifest.cols,
        generatedAt: manifest.generatedAt,
      }) + '\n',
    );
    return;
  }

  const saved = tokenReport.percentSaved;
  const savedStr = saved >= 0 ? `${saved.toFixed(1)}% saved` : `${Math.abs(saved).toFixed(1)}% more expensive`;
  const droppedNote = tokenReport.factsheetDropped > 0
    ? ` (${tokenReport.factsheetDropped} dropped)`
    : '';
  console.log(
    `\nimgtokenx export\n` +
    `  out:            ${outDir}\n` +
    `  files:          ${formatNumber(sourceFiles.length)}\n` +
    `  source chars:   ${formatNumber(manifest.sourceChars)}\n` +
    `  pages:          ${pages.length} (${formatNumber(totalPngBytes)} bytes)\n` +
    `  text tokens:    ~${formatNumber(tokenReport.textTokens)}\n` +
    `  image tokens:   ~${formatNumber(tokenReport.imageTokens)}  (${savedStr})\n` +
    `  factsheet:      ${tokenReport.factsheetItemCount} items${droppedNote}\n`,
  );
  console.log(
    `next — get this into your chat:\n` +
    `  1. attach the ${pages.length} page-*.png file${pages.length === 1 ? '' : 's'} from that folder\n` +
    `  2. paste prompt.txt alongside them (it tells the model what the images are)\n` +
    `     factsheet.txt has the verbatim paths / ids / numbers if you need exact strings\n` +
    (opts.open ? `  opening the folder…\n` : `  tip: add --open to reveal the folder automatically\n`),
  );
}

async function runExport(argv: string[]): Promise<void> {
  const parseResult = parseExportArgv(argv);

  if (parseResult.kind === 'help') {
    printExportHelp();
    process.exit(0);
  }
  if (parseResult.kind === 'error') {
    console.error(`[imgtokenx export] ${parseResult.message}`);
    console.error(`[imgtokenx export] run \`imgtokenx export --help\` for usage`);
    process.exit(2);
  }

  const opts = parseResult.parsed;

  // Collect source text
  const [sourceText, sourceFiles] = await collectSource(opts);

  // Unique output dir: <out>/imgtokenx-export-XXXXXX/. mkdtemp guarantees a fresh, random
  // directory so concurrent runs never collide and stale page-NNN.png never bleed in.
  fs.mkdirSync(opts.out, { recursive: true });
  const outDir = fs.mkdtempSync(path.join(opts.out, 'imgtokenx-export-'));

  // Run core export
  const result = await runExportCore(sourceText, {
    sourceFiles,
    cols: opts.cols,
    model: opts.model,
  });

  // Write artifacts — 0o600, the export can include full source + prompt
  // text (audit finding E5).
  for (const artifact of result.artifacts) {
    fs.writeFileSync(path.join(outDir, artifact.filename), artifact.data, { mode: 0o600 });
  }

  // Print report
  printExportReport(opts, outDir, sourceFiles, result);

  // --open: reveal the output folder (macOS `open`) so the PNG pages can be
  // dragged straight into a chat. Best-effort; a failed open is non-fatal
  // since the report already printed the path.
  if (opts.open) {
    spawnSync('open', [outDir], { stdio: 'ignore' });
  }
}

function runRecover(argv: string[]): void {
  const id = argv[0]?.trim();
  if (argv.includes('-h') || argv.includes('--help')) {
    console.log(`imgtokenx recover — print exact source text for a rec_* id

Usage:
  imgtokenx recover rec_1234abcd

Reads from IMGTOKENX_RECOVERABLE_DIR, defaulting to ~/.imgtokenx/recovery when
unset. Set IMGTOKENX_RECOVERABLE_DIR=off to confirm recovery is disabled.
`);
    process.exit(0);
  }
  if (!id || !/^rec_[0-9a-f]{8,16}$/.test(id)) {
    console.error('[imgtokenx recover] expected a recovery id like rec_1234abcd');
    process.exit(2);
  }
  const dir = resolveRecoverableDir();
  if (!dir) {
    console.error('[imgtokenx recover] IMGTOKENX_RECOVERABLE_DIR is disabled (set to off/0/false/no)');
    process.exit(2);
  }
  try {
    process.stdout.write(recoverById(dir, id));
  } catch (err) {
    console.error(`[imgtokenx recover] ${(err as Error).message}`);
    process.exit(1);
  }
}

// ---- main ----------------------------------------------------------------

export async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv[0] === 'export') {
    await runExport(argv.slice(1));
    return; // server never starts
  }
  if (argv[0] === 'recover' || argv[0] === 'rehydrate') {
    runRecover(argv.slice(1));
    return;
  }
  if (argv[0] === 'mcp') {
    const { runMcpServer } = await import('./mcp.js');
    await runMcpServer();
    return;
  }
  if (argv[0] === 'install') {
    const opts = { ...parseInstallArgs(argv.slice(1)), repoRoot: packageRoot() };
    const { actions } = runInstall(opts);
    for (const a of actions) console.log(`[imgtokenx install] ${a}`);
    return;
  }
  if (argv[0] === 'uninstall') {
    const opts = { ...parseInstallArgs(argv.slice(1)), repoRoot: packageRoot() };
    const { actions } = runUninstall(opts);
    for (const a of actions) console.log(`[imgtokenx uninstall] ${a}`);
    return;
  }
  if (argv[0] === 'doctor') {
    const opts = { ...parseInstallArgs(argv.slice(1)), repoRoot: packageRoot() };
    const result = await runDoctor(opts);
    process.stdout.write(formatDoctor(result));
    const code = doctorExitCode(result);
    if (code !== 0) process.exit(code);
    return;
  }
  // Stats / sessions / cleanup tools live in the dashboard.
  const opts = parseCli(argv);
  // Environment override remains a hard process-lifetime kill switch. The
  // dashboard also persists a shared off-file that generated client wrappers
  // check before injecting any imgtokenx base URL.
  const forcePassthrough = /^(1|true|yes|on)$/i.test(process.env.IMGTOKENX_DISABLE ?? '');
  const startDisabled = isRuntimeDisabled();
  if (startDisabled) {
    console.log('[imgtokenx] global kill switch is off — client wrappers bypass imgtokenx; attached clients use passthrough until restarted');
  }
  // Default-on: exact-risk blocks (IDs/hashes/UUIDs/secrets/paths) stay
  // native text instead of being imaged, so byte-exact content can never be
  // silently lost to pixel misreads. Opt out with IMGTOKENX_LOSSLESS_EXACT=0.
  const losslessExactEnv = process.env.IMGTOKENX_LOSSLESS_EXACT?.trim();
  const losslessExact = !/^(0|false|off|no)$/i.test(losslessExactEnv ?? '');
  if (losslessExactEnv !== undefined && !losslessExact) {
    console.log('[imgtokenx] IMGTOKENX_LOSSLESS_EXACT disabled — exact-risk blocks may be imaged like anything else');
  }
  // Debug aid: when IMGTOKENX_DUMP_DIR is set, persist every rendered PNG this
  // process emits, so you can eyeball exactly what the model received (OCR /
  // legibility audits, demo inspection). Best-effort — never affects requests.
  // Note: the IMGTOKENX_DISABLE arm renders nothing, so only the compress proxy
  // produces files here.
  let imageDumpDir: string | undefined = process.env.IMGTOKENX_DUMP_DIR?.trim() || undefined;
  let imageDumpSeq = 0;
  if (imageDumpDir) {
    try {
      fs.mkdirSync(imageDumpDir, { recursive: true });
      console.log(`[imgtokenx] IMGTOKENX_DUMP_DIR set — dumping rendered PNGs to ${imageDumpDir}`);
    } catch (err) {
      console.warn(`[imgtokenx] IMGTOKENX_DUMP_DIR unusable (${(err as Error).message}) — image dumping disabled`);
      imageDumpDir = undefined;
    }
  }
  // Default-on backstop: whatever content DOES get imaged (gist-safe text,
  // or anything the exact-risk detector misses) gets its verbatim source
  // dumped to a recovery sidecar, keyed by the rec_* id shown in the render
  // banner, so a model that needs the exact bytes can ask for them instead
  // of guessing from pixels. Opt out with IMGTOKENX_RECOVERABLE_DIR=off.
  let recoverableDir: string | undefined = resolveRecoverableDir();
  let recoverableSeq = 0;
  if (recoverableDir) {
    try {
      fs.mkdirSync(recoverableDir, { recursive: true, mode: 0o700 });
      console.log(`[imgtokenx] writing exact recovery sources to ${recoverableDir} (default-on; set IMGTOKENX_RECOVERABLE_DIR=off to disable)`);
    } catch (err) {
      console.warn(`[imgtokenx] recovery dir unusable (${(err as Error).message}) — recovery dumping disabled`);
      recoverableDir = undefined;
    }
  } else if (/^(0|false|off|no)$/i.test(process.env.IMGTOKENX_RECOVERABLE_DIR?.trim() ?? '')) {
    console.log('[imgtokenx] IMGTOKENX_RECOVERABLE_DIR disabled — recovery sidecars will not be written');
  }
  // Transform options pass through empty — the proxy uses the DEFAULTS
  // baked into transform.ts. There are no behavior toggles: system slab,
  // reminders, tool_results, and history compression all run
  // unconditionally; the per-block break-even gate decides per-call
  // whether to actually image each piece. The function-form `transform`
  // below is ONLY a kill switch (IMGTOKENX_DISABLE / dashboard toggle →
  // compress:false); on the active path it returns {}, so the gate always
  // runs on static DEFAULTS — charsPerToken=4, priorWarm*=0 — which leaves
  // the warm-baseline and anti-flapping burn terms inert. That is
  // deliberate, NOT an oversight: there is no live-α feedback loop from
  // the dashboard. Telemetry (2026-06, 897 sessions / 21,347 measured
  // rows) showed 5 mode flips ever and losses at 0.8% of wins — all
  // one-time cache-create amortization — so closing the loop would not
  // change decisions. Re-run that reconciliation before wiring one in.
  const tracker: Tracker = new FileTracker(opts.eventsFile);

  // Sidecar dir for oversized 4xx request-body samples. Lives next to the
  // events.jsonl so a single `rm -rf` cleans up both. Lazy-mkdir'd on first
  // sidecar write (see maybeWriteBodySidecar).
  const bodySidecarDir = path.join(path.dirname(opts.eventsFile), '4xx-bodies');

  // Live dashboard state — populated on every request via onRequest below,
  // served via the route interception in front of the proxy handler. The
  // SessionsPaths handle lets the dashboard surface session/disk/stats data
  // without reaching back into module-scope globals.
  const dashboard = new DashboardState({
    eventsFile: opts.eventsFile,
    sidecarDir: bodySidecarDir,
  }, undefined, persistModelsConfig, (enabled) => {
    persistRuntimeEnabled(enabled);
    return enabled && !forcePassthrough;
  });
  dashboard.setCompressionEnabled(!startDisabled);
  // Seed the "recent requests" table from the JSONL log so a process restart
  // doesn't reset what you can see in the UI. Best-effort; ignored on error.
  await dashboard.replay(opts.eventsFile).catch(() => {});

  const config: ProxyConfig = {
    provider: opts.provider,
    gatewayBaseUrl: opts.gatewayBaseUrl,
    gatewayHeaders: opts.gatewayHeaders,
    upstream: opts.upstream,
    openAIUpstream: opts.openAIUpstream,
    openAIApiKey: opts.openAIApiKey,
    // Per-request transform options:
    //   1. Runtime kill switch — when the dashboard "passthrough" toggle
    //      is off, force compress=false so /v1/messages forwards
    //      untransformed. Lets the operator instantly disable the proxy
    //      when upstream is unhealthy without restarting.
    //   2. Otherwise use DEFAULTS in transform.ts for break-even gating.
    transform: () => {
      // A/B harness: IMGTOKENX_DISABLE=1 forces passthrough (compress=false) for the
      // whole process, so the "normal" arm can be scripted on its own port while
      // still logging real usage + count_tokens baselines to its own IMGTOKENX_LOG.
      // (The dashboard kill switch does the same thing at runtime.)
      if (forcePassthrough || !dashboard.getCompressionEnabled()) return { compress: false };
      // Active path: use DEFAULTS in transform.ts for break-even gating.
      return {
        ...(recoverableDir ? { emitRecoverable: true } : {}),
        ...(losslessExact ? { losslessExact: true } : {}),
      };
    },
    onRequest: async (e) => {
      // Feed the dashboard BEFORE tracker.emit — toTrackEvent strips
      // info.firstImagePng, so capturing has to happen on the raw event.
      dashboard.update(e);
      // Debug: persist this request's rendered PNGs (see IMGTOKENX_DUMP_DIR above).
      // Filenames sort by request order: <stamp>_reqNNN_<model>_pNN.png.
      if (imageDumpDir && e.info?.imagePngs && e.info.imagePngs.length > 0) {
        const seq = ++imageDumpSeq;
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const modelTag = (e.model ?? 'model').replace(/[^A-Za-z0-9._-]+/g, '_');
        const pngs = e.info.imagePngs;
        for (let i = 0; i < pngs.length; i++) {
          const name = `${stamp}_req${String(seq).padStart(3, '0')}_${modelTag}_p${String(i + 1).padStart(2, '0')}.png`;
          try {
            fs.writeFileSync(path.join(imageDumpDir, name), pngs[i]!, { mode: 0o600 });
          } catch (err) {
            console.warn(`[imgtokenx] PNG dump write failed: ${(err as Error).message}`);
            break; // dir vanished / full — stop hammering it this request
          }
        }
        console.log(`  ↳ dumped ${pngs.length} rendered png(s) → ${imageDumpDir}`);
      }
      if (recoverableDir && e.info?.recoverable && e.info.recoverable.length > 0) {
        const seq = ++recoverableSeq;
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const modelTag = (e.model ?? 'model').replace(/[^A-Za-z0-9._-]+/g, '_');
        let written = 0;
        for (const rec of e.info.recoverable) {
          const kind = rec.kind.replace(/[^A-Za-z0-9._-]+/g, '_');
          const name = `${stamp}_req${String(seq).padStart(3, '0')}_${modelTag}_${rec.id}_${kind}.txt`;
          try {
            fs.writeFileSync(path.join(recoverableDir, name), rec.text, { mode: 0o600 });
            written++;
          } catch (err) {
            console.warn(`[imgtokenx] recovery dump write failed: ${(err as Error).message}`);
            break;
          }
        }
        if (written > 0) {
          pruneRecoverableDir(recoverableDir);
          console.log(`  ↳ dumped ${written} recoverable source(s) → ${recoverableDir}`);
        }
      }
      // Terse human-readable console line.
      const extra: string[] = [];
      if (e.info?.reminderImgs) extra.push(`rem+${e.info.reminderImgs}`);
      if (e.info?.toolResultImgs) extra.push(`tr+${e.info.toolResultImgs}`);
      const extraTag = extra.length > 0 ? ` (${extra.join(' ')})` : '';
      const tag = e.info?.compressed
        ? `compressed ${e.info.origChars}ch → ${e.info.imageCount}img/${e.info.imageBytes}B${extraTag}`
        : (e.info?.reason ?? '');
      const cacheRead = e.usage?.cache_read_input_tokens ?? 0;
      const inputTokens = e.usage?.input_tokens ?? 0;
      const usageTag =
        e.usage !== undefined
          ? ` tokens=${inputTokens}+${e.usage.output_tokens ?? 0} cache_read=${cacheRead}`
          : '';
      console.log(
        `[${new Date().toISOString()}] ${e.method} ${e.path} → ${e.status} (${e.durationMs}ms) ${tag}${usageTag}`,
      );

      // Surface upstream 4xx error bodies inline so a regression in the
      // request shape is obvious without having to grep events.jsonl. The
      // tracker JSONL already has the full ~2 KiB capture. Apply redaction
      // first (audit finding E7): the message gets echoed to stderr which
      // can persist in terminal scrollback / systemd journals.
      if (e.errorBody) {
        const redacted = redactErrorBody(e.errorBody);
        const trimmed = redacted.length > 400 ? redacted.slice(0, 400) + '…' : redacted;
        console.warn(`[imgtokenx ${e.status}] upstream body: ${trimmed}`);
      }

      // Canary: surface unknown tag-shaped blocks so a Claude Code release
      // that adds a new dynamic tag is caught within hours.
      if (e.info?.unknownStaticTags && e.info.unknownStaticTags.length > 0) {
        console.warn(
          `[imgtokenx warn] unknown tag(s) in static slab: ${e.info.unknownStaticTags.join(', ')}  ` +
            `— may need to add to DYNAMIC_BLOCK_TAGS (per-turn) or KNOWN_STATIC_TAGS (static) in src/core/transform.ts`,
        );
      }

      // If the proxy captured a gzipped 4xx body that won't fit inline in
      // the JSONL row, write it to a sidecar file and put the path on the
      // event instead. Threshold: gz_bytes * 4/3 > inline cap (b64 expansion).
      if (e.reqBodyGz && e.reqBodyGz.byteLength * 4 > TRACK_BODY_INLINE_MAX * 3) {
        const writtenPath = await maybeWriteBodySidecar(
          e.reqBodyGz,
          e.reqBodySha8,
          bodySidecarDir,
        );
        if (writtenPath) {
          e.reqBodySamplePath = writtenPath;
          e.reqBodyGz = undefined; // tracker will pick up the path instead
        }
        // If write failed: leave reqBodyGz; the tracker will silently drop
        // it (still too big to inline). We never lose the sha8 / error_body.
      }

      // Persistent JSONL event for offline analysis (imgtokenx stats etc.).
      tracker.emit(toTrackEvent(e));
    },
  };
  const handle = createProxy(config);

  const server = createServer((req, res) => {
    Promise.resolve()
      .then(async () => {
        // Local dashboard routes — handled BEFORE the proxy so they never hit
        // api.anthropic.com (which would 404 them).
        const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
        const route = dashboardPath(url.pathname);
        if (route) {
          const webRes = await dispatchDashboard(dashboard, route, req, url, opts.port);
          if (webRes) {
            await writeWebResponse(webRes, res);
            return;
          }
        }
        const webReq = toWebRequest(req);
        const webRes = await handle(webReq);
        await writeWebResponse(webRes, res);
      })
      .catch((err) => {
        console.error('[imgtokenx] handler error:', err);
        if (!res.headersSent) res.statusCode = 500;
        res.end();
      });
  });

  // IPv6 literals need bracket notation to form a valid URL (http://[::1]:47821).
  const displayHost = opts.host.includes(':') ? `[${opts.host}]` : opts.host;
  const isLoopbackHost =
    opts.host === '127.0.0.1' || opts.host === 'localhost' || opts.host === '::1';
  server.listen(opts.port, opts.host, () => {
    console.log(`[imgtokenx] listening on http://${displayHost}:${opts.port}`);
    if (!isLoopbackHost) {
      console.warn(
        `[imgtokenx] WARNING: bound to ${opts.host} — the unauthenticated dashboard ` +
          `(captured request context + kill switch) is reachable off-host. ` +
          `Unset HOST to restrict to loopback.`,
      );
    }
    const routes = resolveUpstreams(config);
    console.log(`[imgtokenx] anthropic upstream → ${routes.anthropic}`);
    console.log(`[imgtokenx] openai upstream → ${routes.openai}`);
    console.log(`[imgtokenx] tracking events → ${opts.eventsFile}`);
    console.log(`[imgtokenx] dashboard → http://127.0.0.1:${opts.port}/`);
  });

  // server.close() only stops accepting new connections and waits for open
  // ones to drain — it does NOT end idle keep-alive sockets. The dashboard tab
  // (htmx polls every 2s) and the Claude Code client both hold keep-alive
  // sockets open, so a naive close() never fires its callback and the first
  // Ctrl+C appears to hang. We drop idle sockets immediately, force-close any
  // in-flight ones after a short grace period, and let a second signal exit now.
  let shuttingDown = false;
  const shutdown = (sig: string) => {
    if (shuttingDown) {
      console.log(`[imgtokenx] ${sig} again — forcing exit`);
      process.exit(130);
    }
    shuttingDown = true;
    console.log(`[imgtokenx] ${sig} — shutting down`);
    // Flush+close the tracker so we don't drop the last few events on exit.
    if (tracker instanceof FileTracker) tracker.close();
    server.close(() => process.exit(0));
    // Drop idle keep-alive sockets so close()'s callback can actually fire.
    server.closeIdleConnections?.();
    // Hard deadline: if a streaming /v1/messages response (or slow upstream)
    // is still in flight, force the rest closed and exit anyway.
    const deadline = setTimeout(() => {
      server.closeAllConnections?.();
      process.exit(0);
    }, 1500);
    deadline.unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

// Only auto-start when invoked as the CLI entrypoint (bin/cli.js → dist/node.js),
// not when imported by tests or other modules. This keeps `node.ts` import-safe
// so its exported helpers (e.g. dispatchDashboard) can be unit-tested without
// binding the listening socket.
const invokedAsEntry =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedAsEntry) {
  main().catch((err) => {
    console.error('[imgtokenx] fatal:', err);
    process.exit(1);
  });
}
