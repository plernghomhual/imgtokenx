#!/usr/bin/env node
// Post-build regression pin for the Node HTTP wrapper in src/node.ts.
//
// The audit-E3 caller-abort wiring once did `req.once('close', () => abort())`,
// but Node >=15 emits 'close' on an IncomingMessage when the request MESSAGE
// completes (right after the body is consumed) — not when the client
// disconnects. Every upstream fetch was aborted the moment the request body
// finished uploading, so ALL proxied traffic returned 502 "imgtokenx request
// aborted". The vitest suite calls the proxy core directly and never crosses
// the real HTTP server, which is why nothing caught it. This script spawns the
// built CLI against a local mock upstream and asserts a proxied POST with a
// body comes back with the upstream's 200, not an abort 502.
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
/** @type {import('node:child_process').ChildProcess | undefined} */
let child;
/** @param {string} msg */
const fail = (msg) => {
  console.error(`http smoke FAIL: ${msg}`);
  if (child) child.kill('SIGKILL');
  process.exit(1);
};

// Mock upstream: consume the body, answer with a recognizable 200.
const upstream = http.createServer((req, res) => {
  let bytes = 0;
  req.on('data', (c) => { bytes += c.length; });
  req.on('end', () => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ mock: true, bodyBytes: bytes }));
  });
});
await new Promise((resolve) => upstream.listen(0, '127.0.0.1', () => resolve(null)));
const upPort = /** @type {import('node:net').AddressInfo} */ (upstream.address()).port;

// ponytail: pid-derived port, collision just fails the run — rerun wins.
const port = 47000 + (process.pid % 500);
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'imgtokenx-http-smoke-'));
child = spawn(process.execPath, [path.join(repo, 'bin', 'cli.js')], {
  env: {
    ...process.env,
    HOME: home,
    PORT: String(port),
    HOST: '127.0.0.1',
    ANTHROPIC_UPSTREAM: `http://127.0.0.1:${upPort}`,
    IMGTOKENX_DISABLE: '',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let childOut = '';
child.stdout?.on('data', (c) => { childOut += c; });
child.stderr?.on('data', (c) => { childOut += c; });
child.on('exit', (code) => {
  if (!done) fail(`proxy exited early (code ${code})\n${childOut}`);
});
let done = false;

// Wait for the proxy to accept connections.
const deadline = Date.now() + 15_000;
for (;;) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/healthz`);
    if (r.ok) break;
  } catch { /* not up yet */ }
  if (Date.now() > deadline) fail(`proxy never became healthy\n${childOut}`);
  await new Promise((r) => setTimeout(r, 200));
}

// The regression trigger: a POST whose body completes before the upstream
// responds. Under the bug this 502s in single-digit milliseconds.
const res = await fetch(`http://127.0.0.1:${port}/v1/messages`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-api-key': 'smoke-test-key' },
  body: JSON.stringify({
    model: 'claude-fable-5',
    max_tokens: 16,
    messages: [{ role: 'user', content: 'hi' }],
  }),
});
const body = await res.text();
if (res.status === 502) fail(`proxied POST returned 502 (abort regression): ${body}`);
if (res.status !== 200) fail(`expected upstream 200 through the proxy, got ${res.status}: ${body}`);
if (!body.includes('"mock":true')) fail(`response is not the mock upstream's body: ${body}`);

done = true;
child.kill('SIGTERM');
upstream.close();
console.log(`http smoke OK: proxied POST reached mock upstream (status 200, ${body.length}-byte body)`);
process.exit(0);
