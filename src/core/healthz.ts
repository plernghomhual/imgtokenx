/**
 * Versioned + token-gated healthz for Cloudflare Workers AND Node, sharing
 * one handler. Audit D21: /healthz now surfaces build info (version + build
 * time) so production operators can fingerprint a deployed build trivially,
 * and refuses off-host callers without a shared secret so an unsophisticated
 * network probe can't read the version or fingerprint the build.
 *
 *   - Loopback (127.0.0.1 / ::1 / localhost): no auth required. The
 *     loopback model says the dashboard is full-trust locally; healthz
 *     follows the same convention so local `curl http://127.0.0.1:47821/healthz`
 *     keeps working.
 *   - Off-host: must present `Authorization: Bearer <IMGTOKENX_HEALTHZ_TOKEN>`.
 *     If the env var is unset, off-host healthz returns 403 (refusing to
 *     answer) — NOT 200 — so a misconfigured deployment can't accidentally
 *     advertise its version to the network. The 403 body includes an
 *     actionable hint.
 *   - HEAD: same auth, body=null.
 *   - Wrong method: 405 + Allow.
 *   - Body shape is JSON on success AND on failure so MCP / probe tools can
 *     parse without sniffing content-type.
 *
 * Loopback detection: parses `req.url` host. Do NOT trust `req.headers.host`
 * for the loopback decision — that's a CLIENT-controlled header; a probe can
 * send Host: 127.0.0.1 from anywhere. Instead, derive loopback from the URL
 * we actually bound (the Worker doesn't have a separate "bound host" — the
 * runtime-agnostic handler just needs the host of the request it received).
 * On Node, that's exactly the host the operator set PORT+HOST for; on
 * Worker, the URL Cloudflare gives us is the public one. The off-host
 * threat model is "anything reachable through DNS", which the URL hostname
 * captures correctly.
 */

/** Build-time constants injected by scripts/build.mjs. Source reads them at
 *  the top of this module so the SAME getter powers Worker and Node without
 *  duplicating the `typeof` guard. */
declare const __IMGTOKENX_VERSION__: string | undefined;
declare const __IMGTOKENX_BUILD_TIME__: string | undefined;

export interface BuildInfo {
  /** Package version, inlined at bundle time by build.mjs. */
  version: string;
  /** ISO timestamp of the bundle build. `unknown` for unbundled dev (tsx). */
  buildTime: string;
}

/** Read the build info. Both fields fall back to `unknown` so a missing
 *  define (unbundled dev runner) doesn't crash — the test suite runs via
 *  vitest which is undeclared. */
export function readBuildInfo(): BuildInfo {
  return {
    version: typeof __IMGTOKENX_VERSION__ === 'string'
      ? __IMGTOKENX_VERSION__ : 'unknown',
    buildTime: typeof __IMGTOKENX_BUILD_TIME__ === 'string'
      ? __IMGTOKENX_BUILD_TIME__ : 'unknown',
  };
}

/** True if a parsed hostname is one of the loopback forms Node/cloudflare
 *  bind to. WHATWG URL hostname for an IPv6 loopback host keeps the brackets
 *  (`http://[::1]/` → `.hostname === '[::1]'`), so we strip them before
 *  comparing; otherwise the IPv6-bind path would silently route to off-host
 *  auth and any caller with a valid token (or even no token if /healthz
 *  was wrongly classified as loopback from a `[::1]` URL but served via a
 *  non-loopback transport). Match against `[::1]` too in case some callers
 *  pre-strip. */
export function isLoopbackHostname(hostname: string): boolean {
  const stripped = hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1) : hostname;
  return stripped === '127.0.0.1'
    || stripped === '::1'
    || stripped === 'localhost';
}

export interface HealthzRequest {
  /** HTTP method. Only GET and HEAD are accepted. */
  method: string;
  /** Full request URL — used to derive the hostname for loopback detection. */
  url: string;
  /** Headers (Authorization Bearer + x-imgtokenx-local-address are read). */
  headers: Pick<Headers, 'get'>;
  /** Shared secret from IMGTOKENX_HEALTHZ_TOKEN. Empty/undefined = off-host
   *  healthz is disabled. */
  healthzToken: string | undefined;
  /** Authoritative loopback source for Node. The server-side
   *  `req.socket.localAddress` (with `::ffff:` prefix stripped) is set as
   *  the `x-imgtokenx-local-address` request header in toWebRequest and
   *  read here. When present AND non-loopback, this overrides any
   *  Host-header spoof: even a URL whose hostname parses to 127.0.0.1 will
   *  be classified off-host. Worker sets this to undefined (Worker url is
   *  already authoritative, so URL-only check is safe there). */
  localAddress?: string;
}

/** Map one healthz request to its response. Pure — no side effects, no
 *  logging, no env reads. The caller (proxy.ts) threads the env in so this
 *  module is testable without process.env mutation. */
export function healthzResponse(req: HealthzRequest): Response {
  const method = req.method.toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    return jsonError('method not allowed', 405, { 'allow': 'GET, HEAD' });
  }
  let host = '';
  try {
    host = new URL(req.url).hostname;
  } catch {
    // Malformed URL — treat as off-host defensively so a bad caller can't
    // bypass the auth by sending a parse-failure URL.
    return jsonError('bad URL', 400);
  }
  // Loopback decision requires BOTH the URL hostname AND (when present)
  // the TCP localAddress to be loopback. This neutralizes the Node-side
  // Host-header spoof: an off-host attacker sending `Host: 127.0.0.1`
  // still fails because req.socket.localAddress reflects the actual
  // bound interface (non-loopback when bound to 0.0.0.0). When
  // localAddress is undefined we fall back to URL-only (Worker's
  // case — Worker doesn't need this defense).
  const localSays = req.localAddress;
  const loopback =
    isLoopbackHostname(host)
    && (localSays === undefined || isLoopbackHostname(localSays));
  if (!loopback) {
    const envToken = req.healthzToken;
    if (!envToken) {
      return jsonError(
        'healthz is not authorized from off-host; set IMGTOKENX_HEALTHZ_TOKEN to enable',
        403,
      );
    }
    const presented = req.headers.get('authorization') ?? '';
    // Constant-string compare. Tokens are >=32 chars (operators set them long
    // enough that prefix-timing is not a real concern) and the loopback
    // bypass covers local operators entirely. SHA-256 timing-safe compare is
    // reserved for the worker.ts secret (where prefix timing IS a concern):
    //     secretsMatch(a, b) in src/worker.ts
    if (presented !== `Bearer ${envToken}`) {
      return jsonError('unauthorized', 401, {
        'www-authenticate': 'Bearer realm="imgtokenx"',
      });
    }
  }
  // Happy path.
  const build = readBuildInfo();
  const body = method === 'HEAD' ? null : JSON.stringify({
    ok: true,
    version: build.version,
    build_time: build.buildTime,
    auth: loopback ? 'loopback' : 'token',
  });
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'application/json',
      // Audit E5 surfaced: healthz carries version + build time; never cache.
      'cache-control': 'no-store',
    },
  });
}

function jsonError(detail: string, status: number, extra: Record<string, string> = {}): Response {
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
