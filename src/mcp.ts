/**
 * Minimal MCP stdio server exposing one tool: `imgtokenx_recover`.
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
import { recoverById, resolveRecoverableDir } from './recovery.js';

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

const TOOL_NAME = 'imgtokenx_recover';

const TOOL_DEFINITION = {
  name: TOOL_NAME,
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

/** Handle one `tools/call` for `imgtokenx_recover`. Pure function of the id and
 *  the resolved recovery dir — no protocol framing here, so it's directly
 *  unit-testable. Throws on any lookup failure (bad id, disabled recovery,
 *  missing source); callers translate that into a JSON-RPC / tool error. */
export function callRecoverTool(recId: unknown): string {
  if (typeof recId !== 'string' || recId.length === 0) {
    throw new Error('rec_id must be a non-empty string');
  }
  const dir = resolveRecoverableDir();
  if (!dir) {
    throw new Error('recovery is disabled (IMGTOKENX_RECOVERABLE_DIR=off/0/false/no)');
  }
  return recoverById(dir, recId);
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
        const result = { tools: [TOOL_DEFINITION] };
        return respond ? { jsonrpc: '2.0', id, result } : undefined;
      }
      case 'tools/call': {
        const params = (req.params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
        if (params.name !== TOOL_NAME) {
          return respond
            ? { jsonrpc: '2.0', id, error: { code: -32601, message: `unknown tool: ${params.name}` } }
            : undefined;
        }
        try {
          const text = callRecoverTool(params.arguments?.rec_id);
          const result = { content: [{ type: 'text', text }], isError: false };
          return respond ? { jsonrpc: '2.0', id, result } : undefined;
        } catch (err) {
          // Tool-level failure: reported as a successful JSON-RPC call whose
          // result carries isError, per MCP convention — so the client sees
          // a clean error message instead of a transport-level failure.
          const result = {
            content: [{ type: 'text', text: `imgtokenx_recover failed: ${(err as Error).message}` }],
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
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  await new Promise<void>((resolve) => {
    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
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
