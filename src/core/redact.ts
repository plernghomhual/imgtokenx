/**
 * Redact sensitive patterns from upstream 4xx error bodies before they reach
 * JSONL logs / stderr / dashboard. The proxy captures the first ~2 KiB of an
 * upstream 4xx response verbatim — and providers have been seen echoing back
 * Authorization values, leaked API keys the client mistakenly included in
 * the request, user PII inside 400 messages, etc. (audit finding E7).
 *
 * Strategy: cap input at 32 KiB so regex evaluation stays bounded, then run
 * a layered pattern set in specific→generic order so the more-specific
 * label wins on collisions (e.g. `sk-ant-api03-…` is `anthropic_key`,
 * not `openai_key`). Patterns are intentionally non-greedy / bounded so
 * the 32 KiB input cap elides any ReDoS concern.
 *
 * The replacement marker `[REDACTED:<kind>]` is short, never contains the
 * underlying secret, and never itself matches any pattern, so the function
 * is idempotent.
 */

export const REDACT_INPUT_MAX = 32 * 1024;

/** Stable labels used in the `[REDACTED:<kind>]` marker. Keep enum-like so
 *  dashboards / scan-of-logs can group by label. */
export type RedactionKind =
  | 'email'
  | 'anthropic_key'
  | 'stripe_key'
  | 'openai_key'
  | 'aws_key'
  | 'github_token'
  | 'slack_token'
  | 'jwt'
  | 'bearer'
  | 'card'
  | 'ssn'
  | 'phone'
  | 'ip'
  | 'pem_private_key';

interface Pattern {
  kind: RedactionKind;
  /** Global regex — match → replace. Capture groups let us preserve
   *  surrounding context (e.g. "Bearer " before the secret). */
  pattern: RegExp;
  /** Replacement template — defaults to `[REDACTED:<kind>]`. Use `$1`/`$2`
   *  to interpolate capture groups when the pattern has them. */
  template?: string;
}

/** Ordered pattern set, specific patterns first so prefix collisions resolve
 *  to the more-specific label (e.g. `sk-ant-...` → `anthropic_key`, not
 *  `openai_key`). Multiline PEM applied last; cheap email/PII patterns go
 *  first. */
const REDACTION_PATTERNS: readonly Pattern[] = [
  // Standard email — cheap, common in echoed 400 messages.
  { kind: 'email', pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },

  // Anthropic API keys — must precede the generic sk- pattern.
  { kind: 'anthropic_key', pattern: /\bsk-ant-api03-[A-Za-z0-9_-]{80,100}\b/g },

  // Stripe — sk_live / sk_test / rk_live must precede the generic sk- pattern.
  { kind: 'stripe_key', pattern: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{24,99}\b/g },

  // OpenAI / generic sk-* catch-all (intentionally broad; sk-ant-* and sk_*_*
  // are already trimmed by the previous two patterns).
  { kind: 'openai_key', pattern: /\bsk-(?:proj-|svc-)?[A-Za-z0-9_-]{20,200}\b/g },

  // AWS access key IDs (AKIA / AGPA / AIDA / AROA / AIPA / ANPA / ANVA).
  // We don't match ASIA deliberately — those are temporary and uncommon,
  // matching them adds false positives on AWS-internal tokens.
  { kind: 'aws_key', pattern: /\b(?:AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA)[A-Z0-9]{16}\b/g },

  // GitHub PAT / OAuth / user / server-to-server / refresh tokens.
  { kind: 'github_token', pattern: /\bgh[pousr]_[A-Za-z0-9_]{36,255}\b/g },

  // Slack tokens (bot / app / user-installed / refresh / webhook).
  { kind: 'slack_token', pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,100}\b/g },

  // JWT — three base64url-ish segments (eyJ = `{"`). Length bounded to avoid
  // matching very short false positives in JSON.
  { kind: 'jwt', pattern: /\beyJ[_a-zA-Z0-9-]{10,}\.[_a-zA-Z0-9-]{10,}\.[_a-zA-Z0-9-]{10,}\b/g },

  // `Bearer <token>` (or `bearer`) — preserve the "Bearer " prefix so the
  // JSONL log still reads as a HTTP auth header, redact only the token.
  { kind: 'bearer', pattern: /\b([Bb]earer\s+)([_a-zA-Z0-9.-]{20,})\b/g,
    template: '$1[REDACTED:bearer]' },

  // Card-shaped digit strings: 16-digit Visa/MC/etc. and 15-digit Amex.
  { kind: 'card', pattern: /\b(?:\d{4}[ -]?){3}\d{4}\b|\b3[47]\d{2}[ -]?\d{6}[ -]?\d{5}\b/g },

  // US SSN.
  { kind: 'ssn', pattern: /\b\d{3}-\d{2}-\d{4}\b/g },

  // Phone (US/E.123). Conservative — only matches when dashes/spaces/parens
  // are present, so a 10-digit number in math expressions isn't redacted.
  // Leading `\b` intentionally omitted: when an input starts with `(` the
  // word boundary fails at position 0 (the `\b` matches only when the first
  // char is a word char), causing the match to start at the digits and
  // leaving a stray `(`. End `\b` kept so we don't over-match into larger
  // digit runs.
  { kind: 'phone', pattern: /\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g },

  // Strict valid IPv4 (each octet 0–255).
  { kind: 'ip', pattern: /\b(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g },

  // PEM PRIVATE KEY blocks — applied last (multiline, base64). The
  // `(?:[A-Za-z0-9+/=]+\s+)+` is greedy-but-bounded line-by-line so it
  // never crosses key boundaries; combined with REDACT_INPUT_MAX, no ReDoS
  // risk even on adversarial input.
  { kind: 'pem_private_key', pattern: /-----BEGIN [A-Z0-9_ ]*PRIVATE KEY-----\s*(?:[A-Za-z0-9+/=]+\s+)+-----END [A-Z0-9_ ]*PRIVATE KEY-----/g },
];

/** Apply every pattern in order, replacing each match with `[REDACTED:<kind>]`
 *  (or the pattern's `template` if captures are used to preserve context).
 *  Idempotent — input already containing redacted markers is unchanged. */
export function redactErrorBody(input: string): string {
  if (!input) return input;
  const slice = input.length > REDACT_INPUT_MAX ? input.slice(0, REDACT_INPUT_MAX) : input;
  let out = slice;
  for (const { kind, pattern, template } of REDACTION_PATTERNS) {
    out = out.replace(pattern, template ?? `[REDACTED:${kind}]`);
  }
  return out;
}

/** Read-only view of the pattern set (for tests / future-diagnostic dashboards).
 *  Includes `template?` so a dashboard surfacing context-preserving rules
 *  (e.g. `Bearer [REDACTED:bearer]`) can render them faithfully instead of
 *  guessing. */
export function redactionPatterns(): readonly {
  kind: RedactionKind;
  pattern: RegExp;
  template?: string;
}[] {
  return REDACTION_PATTERNS;
}
