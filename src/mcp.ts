/**
 * Minimal MCP stdio server exposing exact recovery and bounded local-context
 * tools. No tool accepts a filesystem path or performs network access.
 *
 * Recovery sidecars (see src/node.ts's `recoverableDir` default-on wiring)
 * hold the verbatim source text for content that got imaged as a PNG. When
 * imgtokenx renders such a block, the render banner shows the model a `rec_*`
 * id it can hand to this tool to get the exact bytes back instead of
 * transcribing them from pixels — see the render banner text in
 * src/core/transform.ts / src/core/render.ts.
 *
 * No `@modelcontextprotocol/sdk` dependency: this hand-rolls just enough of
 * the MCP stdio transport (newline-delimited JSON-RPC 2.0 over
 * stdin/stdout) for `initialize`, `tools/list`, and `tools/call` to work
 * with Claude Code / Codex / OpenCode as MCP clients. The tool's core logic
 * lives in `recoverById()` (src/recovery.ts), reused as-is so this file is pure
 * protocol framing and stays unit-testable without spawning a subprocess.
 */

import * as readline from 'node:readline';
import { recordContextMetric } from './context-metrics.js';
import {
  ContextArtifactError,
  diffContextArtifacts,
  fetchContextArtifact,
  readContextCheckpoint,
  searchContextArtifact,
  storeContextCheckpoint,
} from './context-artifacts.js';
import { recoverById, resolveRecoverableDir } from './recovery.js';
import { inspectWorkspace } from './workspace-inspect.js';

const PROTOCOL_VERSION = '2024-11-05';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
}

const RECOVER_TOOL_NAME = 'imgtokenx_recover';
const CONTEXT_TOOL_NAME = 'imgtokenx_context';
const INSPECT_TOOL_NAME = 'imgtokenx_inspect';

const RECOVER_TOOL_DEFINITION = {
  name: RECOVER_TOOL_NAME,
  description:
    'Recover the verbatim original source text for an imgtokenx rec_* id shown in an ' +
    'exact-risk render banner. Use this instead of guessing byte-exact IDs, hashes, ' +
    'paths, or secrets from a rendered image.',
  inputSchema: {
    type: 'object',
    properties: {
      rec_id: {
        type: 'string',
        description: 'The recovery id, e.g. rec_1234abcd',
      },
    },
    required: ['rec_id'],
  },
};

const CONTEXT_TOOL_DEFINITION = {
  name: CONTEXT_TOOL_NAME,
  description:
    'Store/read a local checkpoint or search, fetch, and diff exact imgtokenx ' +
    'artifacts by sha256 handle. Literal search only; no paths, regex, or network.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      action: {
        type: 'string',
        enum: ['checkpoint_store', 'checkpoint_read', 'search', 'fetch', 'diff'],
      },
      handle: { type: 'string', description: 'Full sha256_* artifact handle' },
      other_handle: { type: 'string', description: 'Second handle for diff' },
      text: {
        type: 'string',
        description: 'Version-1 proof-checkpoint JSON for checkpoint_store',
      },
      query: { type: 'string', description: 'Case-sensitive literal to find' },
      start_byte: { type: 'integer', minimum: 0 },
      length_bytes: { type: 'integer', minimum: 1, maximum: 32768 },
      limit: { type: 'integer', minimum: 1, maximum: 20 },
    },
    required: ['action'],
  },
};

const INSPECT_TOOL_DEFINITION = {
  name: INSPECT_TOOL_NAME,
  description:
    'Read-only literal workspace search returning bounded relative-path excerpts. ' +
    'Disabled unless the host sets IMGTOKENX_WORKSPACE_ROOT. Never runs shell ' +
    'commands, follows symlinks, or modifies files.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      query: { type: 'string', minLength: 1, maxLength: 256 },
      max_files: { type: 'integer', minimum: 1, maximum: 20 },
      context_lines: { type: 'integer', minimum: 0, maximum: 5 },
    },
    required: ['query'],
  },
};

/** Handle one `tools/call` for `imgtokenx_recover`. Pure function of the id and
 *  the resolved recovery dir — no protocol framing here, so it's directly
 *  unit-testable. Throws on any lookup failure (bad id, disabled recovery,
 *  missing source); callers translate that into a JSON-RPC / tool error. */
export function callRecoverTool(recId: unknown): string {
  if (typeof recId !== 'string' || recId.length === 0) {
    throw new Error('rec_id must be a non-empty string');
  }
  if (!/^rec_[0-9a-f]{8,16}$/.test(recId)) {
    throw new Error('expected a recovery id like rec_1234abcd');
  }
  const dir = resolveRecoverableDir();
  if (!dir) {
    throw new Error('recovery is disabled (IMGTOKENX_RECOVERABLE_DIR=off/0/false/no)');
  }
  try {
    return recoverById(dir, recId);
  } catch {
    throw new Error('recovery source unavailable');
  }
}

type ContextAction = 'checkpoint_store' | 'checkpoint_read' | 'search' | 'fetch' | 'diff';

const CONTEXT_FIELDS = new Set([
  'action',
  'handle',
  'other_handle',
  'text',
  'query',
  'start_byte',
  'length_bytes',
  'limit',
]);

const ACTION_FIELDS: Record<ContextAction, ReadonlySet<string>> = {
  checkpoint_store: new Set(['action', 'text']),
  checkpoint_read: new Set(['action', 'handle']),
  search: new Set(['action', 'handle', 'query', 'limit']),
  fetch: new Set(['action', 'handle', 'start_byte', 'length_bytes']),
  diff: new Set(['action', 'handle', 'other_handle']),
};

function contextRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ContextArtifactError('context arguments must be an object');
  }
  const record = value as Record<string, unknown>;
  const prototype = Object.getPrototypeOf(record) as unknown;
  if (prototype !== Object.prototype && prototype !== null) {
    throw new ContextArtifactError('context arguments must be a plain object');
  }
  for (const key of Object.keys(record)) {
    if (!CONTEXT_FIELDS.has(key)) throw new ContextArtifactError('unsupported context argument');
  }
  return record;
}

function requiredString(record: Record<string, unknown>, key: string): string {
  if (!Object.prototype.hasOwnProperty.call(record, key)) {
    throw new ContextArtifactError(`${key} must be a non-empty string`);
  }
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new ContextArtifactError(`${key} must be a non-empty string`);
  }
  return value;
}

function requiredText(record: Record<string, unknown>, key: string): string {
  if (!Object.prototype.hasOwnProperty.call(record, key)) {
    throw new ContextArtifactError(`${key} must be a string`);
  }
  const value = record[key];
  if (typeof value !== 'string') throw new ContextArtifactError(`${key} must be a string`);
  return value;
}

function requiredInteger(record: Record<string, unknown>, key: string): number {
  if (!Object.prototype.hasOwnProperty.call(record, key)) {
    throw new ContextArtifactError(`${key} must be an integer`);
  }
  const value = record[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new ContextArtifactError(`${key} must be an integer`);
  }
  return value;
}

function contextDir(): string {
  const dir = resolveRecoverableDir();
  if (!dir) throw new ContextArtifactError('context storage is disabled');
  return dir;
}

function recordMetricSafe(
  dir: string | undefined,
  kind: 'context' | 'inspect',
  success: boolean,
  resultChars = 0,
): void {
  if (!dir) return;
  try {
    recordContextMetric(dir, kind, success, resultChars);
  } catch {
    // Metrics must never alter an MCP result.
  }
}

/** Execute one bounded provider-neutral context operation. The only storage
 * selector accepted from the caller is a full content hash. */
export function callContextTool(args: unknown): string {
  try {
    const record = contextRecord(args);
    const action = requiredString(record, 'action') as ContextAction;
    const actionFields = ACTION_FIELDS[action];
    if (!actionFields) throw new ContextArtifactError('unsupported context action');
    for (const key of Object.keys(record)) {
      if (!actionFields.has(key)) throw new ContextArtifactError('unsupported context argument');
    }
    const dir = contextDir();
    try {
      let result: string;
      switch (action) {
      case 'checkpoint_store': {
        const stored = storeContextCheckpoint(dir, requiredText(record, 'text'));
        result = JSON.stringify(stored);
        break;
      }
      case 'checkpoint_read': {
        const handle = requiredString(record, 'handle');
        result = JSON.stringify({ handle, ...readContextCheckpoint(dir, handle) });
        break;
      }
      case 'search': {
        const limit = record.limit === undefined ? 20 : requiredInteger(record, 'limit');
        result = JSON.stringify(searchContextArtifact(
          dir,
          requiredString(record, 'handle'),
          requiredString(record, 'query'),
          limit,
        ));
        break;
      }
      case 'fetch': {
        result = JSON.stringify(fetchContextArtifact(
          dir,
          requiredString(record, 'handle'),
          requiredInteger(record, 'start_byte'),
          requiredInteger(record, 'length_bytes'),
        ));
        break;
      }
      case 'diff': {
        result = JSON.stringify(diffContextArtifacts(
          dir,
          requiredString(record, 'handle'),
          requiredString(record, 'other_handle'),
        ));
        break;
      }
      default:
        throw new ContextArtifactError('unsupported context action');
      }
      recordMetricSafe(dir, 'context', true, result.length);
      return result;
    } catch (error) {
      recordMetricSafe(dir, 'context', false);
      throw error;
    }
  } catch (error) {
    if (error instanceof ContextArtifactError) throw error;
    throw new ContextArtifactError('context operation failed');
  }
}

/** Execute the single bounded read-only workspace operation. The workspace
 * root is host-configured, never model-selected. */
export function callInspectTool(args: unknown): string {
  const metricsDir = resolveRecoverableDir();
  try {
    if (typeof args !== 'object' || args === null || Array.isArray(args)) {
      throw new Error('inspect arguments must be an object');
    }
    const record = args as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (key !== 'query' && key !== 'max_files' && key !== 'context_lines') {
        throw new Error('unsupported inspect argument');
      }
    }
    if (typeof record.query !== 'string') throw new Error('query must be a non-empty string');
    const integer = (key: 'max_files' | 'context_lines'): number | undefined => {
      const value = record[key];
      if (value === undefined) return undefined;
      if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
        throw new Error(`${key} must be an integer`);
      }
      return value;
    };
    const root = process.env.IMGTOKENX_WORKSPACE_ROOT?.trim();
    if (!root) throw new Error('workspace inspection unavailable');
    const result = JSON.stringify(inspectWorkspace(root, record.query, {
      maxFiles: integer('max_files'),
      contextLines: integer('context_lines'),
    }));
    recordMetricSafe(metricsDir, 'inspect', true);
    return result;
  } catch (error) {
    recordMetricSafe(metricsDir, 'inspect', false);
    const message = (error as Error).message;
    if (/^(query|max_files|context_lines|unsupported inspect)/.test(message)) throw error;
    throw new Error('workspace inspection unavailable');
  }
}

function send(res: JsonRpcResponse): void {
  process.stdout.write(JSON.stringify(res) + '\n');
}

function handleRequest(req: JsonRpcRequest): JsonRpcResponse | undefined {
  const id = req.id ?? null;
  // Notifications (no id) get no response, per JSON-RPC 2.0 / MCP.
  const respond = req.id !== undefined && req.id !== null;

  try {
    switch (req.method) {
      case 'initialize': {
        const result = {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: 'imgtokenx-recover', version: '1.0.0' },
        };
        return respond ? { jsonrpc: '2.0', id, result } : undefined;
      }
      case 'notifications/initialized':
        return undefined;
      case 'tools/list': {
        const result = {
          tools: [RECOVER_TOOL_DEFINITION, CONTEXT_TOOL_DEFINITION, INSPECT_TOOL_DEFINITION],
        };
        return respond ? { jsonrpc: '2.0', id, result } : undefined;
      }
      case 'tools/call': {
        const params = (req.params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
        if (
          params.name !== RECOVER_TOOL_NAME
          && params.name !== CONTEXT_TOOL_NAME
          && params.name !== INSPECT_TOOL_NAME
        ) {
          return respond
            ? { jsonrpc: '2.0', id, error: { code: -32601, message: 'unknown tool' } }
            : undefined;
        }
        try {
          const text = params.name === RECOVER_TOOL_NAME
            ? callRecoverTool(params.arguments?.rec_id)
            : params.name === CONTEXT_TOOL_NAME
              ? callContextTool(params.arguments)
              : callInspectTool(params.arguments);
          const result = { content: [{ type: 'text', text }], isError: false };
          return respond ? { jsonrpc: '2.0', id, result } : undefined;
        } catch (err) {
          // Tool-level failure: reported as a successful JSON-RPC call whose
          // result carries isError, per MCP convention — so the client sees
          // a clean error message instead of a transport-level failure.
          const result = {
            content: [{
              type: 'text',
              text: `${params.name} failed: ${(err as Error).message}`,
            }],
            isError: true,
          };
          return respond ? { jsonrpc: '2.0', id, result } : undefined;
        }
      }
      default:
        return respond
          ? { jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${req.method}` } }
          : undefined;
    }
  } catch (err) {
    return respond
      ? { jsonrpc: '2.0', id, error: { code: -32603, message: (err as Error).message } }
      : undefined;
  }
}

/** Run the MCP stdio server: read newline-delimited JSON-RPC requests from
 *  stdin, write newline-delimited JSON-RPC responses to stdout. Resolves
 *  when stdin closes (client disconnects). */
export async function runMcpServer(): Promise<void> {
  // ponytail: 8 MiB/line ceiling — largest legit request is a recover call with
  // an artifact id (bytes, not content). Reject instead of buffering unbounded
  // stdin into JSON.parse. Raise if a future tool legitimately streams content in.
  const MAX_LINE_BYTES = 8 * 1024 * 1024;
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  await new Promise<void>((resolve) => {
    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      if (trimmed.length > MAX_LINE_BYTES) {
        send({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32600, message: `request exceeds ${MAX_LINE_BYTES} byte line limit` },
        });
        return;
      }
      let req: JsonRpcRequest;
      try {
        req = JSON.parse(trimmed) as JsonRpcRequest;
      } catch {
        send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } });
        return;
      }
      const res = handleRequest(req);
      if (res) send(res);
    });
    rl.on('close', () => resolve());
  });
}
