/**
 * Strict payload validators for the three dashboard POST mutations:
 *
 *   POST /api/compression    { enabled: boolean }
 *   POST /fragments/toggle   { enabled: boolean }
 *   POST /fragments/models   { model: string, on: boolean }
 *
 * Background — audit #23 (D19):
 *   - The previous code accepted `{ enabled: "true" }` / `{ enabled: 1 }` and
 *     silently coerced to `false` via strict `=== true`, which turned
 *     "operator clicks the dashboard toggle" into a no-op with no diagnosis.
 *   - The model id was passed verbatim to `setAllowedModelBases` and persisted
 *     to `~/.config/imgtokenx/config.json` with zero bounds — no length cap,
 *     no character set. A malicious-but-careless client (or a legitimate one
 *     that lost a battle with quoting) could write arbitrary strings to the
 *     persisted config, and the dashboard would render them as model chips.
 *   - A dual JSON / urlencoded body parser meant a malformed JSON request
 *     silently fell through to a second parser that accepted URL parameters;
 *     the second parser had its own type-coercion bugs.
 *
 * This module fixes all three:
 *   - Strict JSON parse with explicit `typeof` per field; no type coercion.
 *   - `validateModelId` enforces 1-80 chars and a tight [A-Za-z0-9._-] charset
 *     starting with an alphanumeric (matches the existing model-id shape used
 *     in `applicability.ts` / `reader-profiles.ts` like 'claude-fable-5' or
 *     'gpt-5.6-sol'). Anything else gets a `BadPayloadError` → 400.
 *   - Unknown code paths stop here — callers funnel through `badRequest(err)`
 *     which yields the JSON 400 the operator/htmx client can render.
 */

export class BadPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BadPayloadError';
  }
}

/** Tight model-id pattern. The `runtimeModelBases` set and the reader-profile
 *  registry both expect ids like `claude-fable-5`, `claude-fable-5-sonnet`,
 *  `gpt-5.6-sol`. The leading alphanumeric guards against JSON-injection-ish
 *  strings ('../foo', '$cmd') and the length cap keeps the persisted config
 *  and the dashboard chip render bounded. Bracketed variant tags
 *  (`claude-fable-5[1m]`) are request-time only — they're stripped by
 *  applicability.ts before scope checking, so we don't allow them in
 *  user-supplied mutation payloads (avoids round-trip ambiguity). */
const MODEL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;

/** Public so tests/dashboards can introspect the contract. */
export const MODEL_ID_MAX = 80;

/** Validate one model id. Returns the unchanged id on success; throws
 *  BadPayloadError on failure — the caller catches via `badRequest`. */
export function validateModelId(id: unknown): string {
  if (typeof id !== 'string') {
    throw new BadPayloadError('`model` must be a string');
  }
  if (id.length === 0 || id.length > MODEL_ID_MAX) {
    throw new BadPayloadError(
      `model id must be 1-${MODEL_ID_MAX} chars (got ${id.length})`,
    );
  }
  if (!MODEL_ID_RE.test(id)) {
    throw new BadPayloadError(
      `model id must match ${MODEL_ID_RE.source} (got ${JSON.stringify(id)})`,
    );
  }
  return id;
}

/** Parse a strict `{ enabled: boolean }` JSON payload. */
export function parseTogglePayload(raw: string): { enabled: boolean } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new BadPayloadError(
      `body must be JSON: ${(err as Error).message}`,
    );
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new BadPayloadError('body must be a JSON object');
  }
  const obj = parsed as Record<string, unknown>;
  const enabled = obj.enabled;
  if (typeof enabled !== 'boolean') {
    throw new BadPayloadError('`enabled` must be boolean (no coercion)');
  }
  return { enabled };
}

/** Parse a strict `{ model: string, on: boolean }` JSON payload. */
export function parseModelsPayload(raw: string): { model: string; on: boolean } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new BadPayloadError(
      `body must be JSON: ${(err as Error).message}`,
    );
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new BadPayloadError('body must be a JSON object');
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.on !== 'boolean') {
    throw new BadPayloadError('`on` must be boolean (no coercion)');
  }
  // validateModelId throws BadPayloadError on bad string — funnels into the
  // same badRequest() response as every other validation failure.
  const model = validateModelId(obj.model);
  return { model, on: obj.on };
}

/** Map an exception from the parsers above to a JSON 400. Only validation
 *  errors become 400 — non-BadPayloadError throws (disk full, EACCES, the
 *  caller-level persistence callback failing) are re-THROWN so the outer
 *  createServer `.catch` still maps them to 500 and the operator gets an
 *  accurate "server error" instead of a misleading "bad request". Centralizing
 *  keeps the response shape (status, content-type, body envelope) consistent
 *  across every mutation route so the htmx client can render errors uniformly. */
export function badRequest(err: unknown): Response {
  if (!(err instanceof BadPayloadError)) throw err;
  return new Response(
    JSON.stringify({ error: 'bad request', detail: err.message }),
    {
      status: 400,
      headers: { 'content-type': 'application/json' },
    },
  );
}
