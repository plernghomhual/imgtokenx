/**
 * Off-host host/auth for the Node-side imgtokenx proxy + dashboard.
 *
 * Audit #24 E4: when an operator inadvertently binds the proxy to a
 * non-loopback interface (`HOST=0.0.0.0`, exposed via cloudflared/ngrok, or
 * deployed on a server) the service becomes reachable from the LAN or
 * the public internet. Two defenses sit in front of every route:
 *
 *   1. **Host whitelist** (defense against DNS rebinding).
 *      The Host header is CLIENT-controlled. A browser-based DNS rebinding
 *      attack points the browser at a public domain name that resolves —
 *      mid-session — to 127.0.0.1. The browser now sends `Host: evil.com`
 *      while the request lands on our loopback socket. Without a host
 *      whitelist, the loopback bypass in /healthz (and the existing
 *      dashboard same-origin check) would treat it as a trusted local
 *      request. We require the operator to OPT IN to specific Host
 *      header values via `IMGTOKENX_ALLOWED_HOSTS`. Anything else gets a
 *      403 before the route is even matched, so a rebinding browser can't
 *      read `/proxy-stats` or POST `/api/compression`.
 *
 *   2. **Off-host shared secret** (defense against direct reach).
 *      Loopback callers bypass the secret so the dashboard's existing
 *      `localhost` workflow keeps working. Off-host callers must present
 *      `Authorization: Bearer <IMGTOKENX_PROXY_TOKEN>` (proxy routes) or
 *      `<IMGTOKENX_DASHBOARD_TOKEN>` (dashboard routes). Plain-string
 *      comparison is shared with /healthz through secret-compare.ts.
 *      Worker-side keeps its separate `IMGTOKENX_WORKER_SECRET` contract.
 *
 * Defaults: when `IMGTOKENX_ALLOWED_HOSTS` is unset, the proxy + dashboard
 * accept the loopback variants (127.0.0.1:<port>, [::1]:<port>,
 * localhost:<port>) ONLY. That preserves the documented loopback-by-default
 * threat model. Set `IMGTOKENX_ALLOWED_HOSTS=foo.example.com,bar.example.com`
 * to opt into a public deployment.
 */

import { timingSafeEqualStr } from './secret-compare.js';

export interface BindAuthRequest {
  /** HTTP method (any — the gate applies regardless). */
  method: string;
  /** Full request URL — used for the loopback short-circuit (consistent
   *  with the /healthz Batch 11 design). */
  url: string;
  /** Headers — Authorization Bearer + Host are read. */
  headers: Pick<Headers, 'get'>;
  /** Server-side authoritative local interface (set as
   *  `x-imgtokenx-local-address` header in toWebRequest, copied from
   *  `req.socket.localAddress`). When present AND non-loopback, the
   *  loopback bypass is closed (Batch 11 mitigation carried forward). */
  localAddress?: string;
}

export interface BindAuthOpts {
  /** Optional host whitelist. Empty/undefined = "no off-host callers
   *  permitted" for non-loopback requests; the loopback bypass covers
   *  development. When an operator supplies a list, EVERY host not in
   *  the list gets a 403, including loopback variants not enumerated. */
  allowedHosts?: string[];
  /** Optional shared secret for off-host callers. Loopback callers bypass;
   *  off-host callers MUST present `Authorization: Bearer <secret>`. When
   *  the secret is unset AND a remote caller reaches the proxy, we return
   *  403 with a hint to set the env var — same fail-closed posture as the
   *  /healthz handler (Batch 11 audit D21). */
  secret?: string;
}

/** Parse `IMGTOKENX_ALLOWED_HOSTS` (CSV). Empty fields are dropped. The
 *  parse is intentionally simple — no glob/wildcard semantics — because the
 *  threat model is "operator enumerates every public hostname they intend
 *  to expose from", and missing a glob is a silent fail-open. */
export function parseHostList(spec: string | undefined): string[] {
  if (spec === undefined) return [];
  return spec
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Default loopback host list when `IMGTOKENX_ALLOWED_HOSTS` is unset.
 *  The port-matching host strings are accepted from the operator's CLI
 *  clients (e.g. `curl http://127.0.0.1:47821/healthz`). */
export function defaultAllowedHosts(port: number): string[] {
  return [
    `127.0.0.1:${port}`,
    `[::1]:${port}`,
    `localhost:${port}`,
    '127.0.0.1',
    '[::1]',
    'localhost',
  ];
}

/** True when `headerHost` matches one of the entries in `allowedHosts`. The
 *  match is exact-case-insensitive at the hostname part but strict on the
 *  port. FQDN trailing dots are stripped (RFC 6265 §5.2.3). No subdomain
 *  matching: `evil.com` ≠ `myhost.com`. */
export function hostMatches(headerHost: string, allowedHosts: readonly string[]): boolean {
  if (allowedHosts.length === 0) return false;
  // Normalize: lowercase hostname, strip trailing dot, normalize IPv6 brackets.
  const norm = (s: string): string => {
    let h = s.toLowerCase();
    if (h.endsWith('.')) h = h.slice(0, -1);
    return h;
  };
  const target = norm(headerHost);
  for (const allowed of allowedHosts) {
    if (norm(allowed) === target) return true;
  }
  return false;
}

/** Loopback decision shared with the Batch 11 /healthz handler. Reads the
 *  URL hostname AND (when present) the localAddress — both must be loopback
 *  for the bypass to apply. */
export function isLoopbackRequest(req: BindAuthRequest): boolean {
  let host = '';
  try {
    host = new URL(req.url).hostname;
  } catch {
    return false; // bad URL → not loopback by definition
  }
  const stripped = host.startsWith('[') && host.endsWith(']')
    ? host.slice(1, -1) : host;
  const urlLoopback =
    stripped === '127.0.0.1'
    || stripped === '::1'
    || stripped === 'localhost';
  if (!urlLoopback) return false;
  if (req.localAddress === undefined) return true;
  const local = req.localAddress.startsWith('::ffff:')
    ? req.localAddress.slice('::ffff:'.length) : req.localAddress;
  return local === '127.0.0.1'
    || local === '::1'
    || local === 'localhost';
}

/** Top-level decision. Returns `null` when the request is permitted (no
 *  auth/host gate applies), or a `Response` describing why it was blocked.
 *  The caller (proxy.ts / node.ts dispatch) writes the response directly.
 *
 *  Pure — no side effects, no env reads. The caller threads the env in.
 */
export function bindAuthResponse(req: BindAuthRequest, opts: BindAuthOpts): Response | null {
  // Method-agnostic — POSTs, GETs, all rejected on bad Host. This is what
  // closes the DNS rebinding window: the loopback bypass CANNOT save a
  // request whose Host header isn't trusted.
  const headerHost = req.headers.get('host') ?? '';
  if (headerHost.length === 0) {
    return reject('missing Host header', 400);
  }
  // Loopback short-circuit: when the request is genuinely on a loopback
  // interface, both the URL hostname AND localAddress are loopback (per
  // isLoopbackRequest). Host whitelist + secret are skipped.
  if (isLoopbackRequest(req)) return null;
  // Off-host: host MUST be in the operator's allowlist.
  if (!hostMatches(headerHost, opts.allowedHosts ?? [])) {
    return reject(
      `Host not in IMGTOKENX_ALLOWED_HOSTS; set the env var to enable "${headerHost}"`,
      403,
    );
  }
  // Off-host AND in the allowlist: secret is required. Loopback-via-URL is
  // already excluded above, so a remote caller that supplies a valid Host
  // still needs the secret.
  if (!opts.secret || opts.secret.length === 0) {
    return reject(
      'off-host callers require IMGTOKENX_PROXY_TOKEN (or IMGTOKENX_DASHBOARD_TOKEN); unset value refuses them with 403',
      403,
    );
  }
  const presented = req.headers.get('authorization') ?? '';
  if (!timingSafeEqualStr(presented, `Bearer ${opts.secret}`)) {
    return reject('missing or invalid Bearer token', 401, {
      'www-authenticate': `Bearer realm="imgtokenx"`,
    });
  }
  return null;
}

function reject(detail: string, status: number, extra: Record<string, string> = {}): Response {
  return new Response(
    JSON.stringify({ ok: false, error: detail }),
    {
      status,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-store',
        ...extra,
      },
    },
  );
}
