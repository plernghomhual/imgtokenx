/** Applicability helpers for imgtokenx's production-safe model scope. */

export type ImgtokenxApplicabilityReason =
  | 'eligible'
  | 'unsupported_model'
  | 'unsupported_method'
  | 'unsupported_path'
  | 'empty_body';

export interface ImgtokenxApplicabilityInput {
  readonly model?: string | null;
  readonly method?: string | null;
  readonly path?: string | null;
  readonly bodyBytes?: number | null;
}

/** Bracketed variant tags (e.g. `[1m]`) stripped before model matching so base and variant gate identically. */
const VARIANT_TAG = /\[[^\]]*\]/g;

function baseModelId(model: string): string {
  return model.replace(VARIANT_TAG, '');
}

/** Host runtime override; null = fall back to IMGTOKENX_MODELS env / built-in default. */
let runtimeModelBases: readonly string[] | null = null;

/** Built-in dashboard/OpenAI scope. Fable is the only default: GPT 5.6 Sol's
 * raw-image pilot scored 0/4 exact at both tested profiles, and other GPT variants
 * lack equivalent reader evidence. Explicit IMGTOKENX_MODELS scope and the
 * independent reader profile must both permit OpenAI-shaped traffic before it is
 * imaged. Claude still enters its transformer by default and is gated there by its
 * reader profile. */
const DEFAULT_MODEL_BASES = ['claude-fable-5'];

function falsey(v: string): boolean {
  return /^(0|false|no|off|none)$/i.test(v.trim());
}

function normalizeModelBases(values: readonly string[]): string[] {
  const out: string[] = [];
  for (const value of values) {
    const model = value.trim();
    if (model && model !== 'gpt-5.6' && !out.includes(model)) out.push(model);
  }
  return out;
}

/** IMGTOKENX_MODELS env / built-in default, ignoring the runtime override. One CSV
 *  controls every family (Claude + GPT). Resolution (read per-call so scope flips LIVE):
 *  - unset or empty        → built-in default (Fable 5 only)
 *  - `off`/`0`/`false`/... → compress nothing
 *  - CSV of model bases    → exactly those families (e.g. `claude-fable-5,gpt-5.6-sol`) */
function envOrDefaultBases(): string[] {
  // Edge-safe: `process` is undefined off-Node; `typeof` avoids a ReferenceError.
  const raw = typeof process !== 'undefined' ? process.env?.IMGTOKENX_MODELS : undefined;
  if (raw === undefined) return [...DEFAULT_MODEL_BASES];
  const trimmed = raw.trim();
  if (!trimmed) return [...DEFAULT_MODEL_BASES];
  if (falsey(trimmed)) return [];
  return normalizeModelBases(trimmed.split(','));
}

function allowedModelBases(): string[] {
  if (runtimeModelBases !== null) return [...runtimeModelBases];
  return envOrDefaultBases();
}

/** Current effective allowed-model scope (Claude + GPT). */
export function getAllowedModelBases(): string[] {
  return allowedModelBases();
}

/** IMGTOKENX_MODELS env / default scope, independent of runtime override.
 *  Dashboard unions this into its chip set so env-enabled models are always shown as toggles. */
export function getConfiguredModelBases(): string[] {
  return envOrDefaultBases();
}

/** Set the dashboard runtime override. Empty array = compress nothing; null = clear override. Not persisted. */
export function setAllowedModelBases(list: readonly string[] | null): void {
  runtimeModelBases = list === null ? null : normalizeModelBases(list);
}

/** Membership test against the single allowed scope. Matches exact base or `-suffix`
 *  alias; [variant] tags stripped first. */
function isAllowed(model: string | null | undefined): boolean {
  if (typeof model !== 'string') return false;
  const base = baseModelId(model);
  return allowedModelBases().some((b) => base === b || base.startsWith(`${b}-`));
}

/** True when the operator has explicitly narrowed/disabled scope — via the dashboard
 *  runtime override or a non-empty IMGTOKENX_MODELS — rather than leaving the built-in
 *  default in place. Explicit overrides always win, for both families, unchanged from
 *  pre-Phase-2 behavior. */
function hasExplicitOverride(): boolean {
  if (runtimeModelBases !== null) return true;
  const raw = typeof process !== 'undefined' ? process.env?.IMGTOKENX_MODELS : undefined;
  return raw !== undefined && raw.trim() !== '';
}

/** True when imgtokenx may transform this Anthropic model. Without an explicit override,
 *  EVERY Claude model is eligible by default — applicability no longer doubles as the
 *  per-model imaging-safety gate for Anthropic. That job belongs to reader-profiles.ts
 *  (consulted inside transform.ts), which defaults unmeasured models to text passthrough
 *  instead of silently imaging them. This function only answers "should imgtokenx touch
 *  this request at all," which by default is yes unless the operator opted out. */
export function isImgtokenxSupportedModel(model: string | null | undefined): boolean {
  if (typeof model !== 'string') return false;
  if (hasExplicitOverride()) return isAllowed(model);
  return true;
}

/** True when this GPT model is in imgtokenx's configured scope. The proxy also
 * requires its independent reader profile to be safe before rendering an image. */
export function isImgtokenxSupportedGptModel(model: string | null | undefined): boolean {
  return isAllowed(model);
}

/** Canonical set of Anthropic Messages routes imgtokenx transforms. Shared with
 *  createProxy (src/core/proxy.ts) so the public applicability helper and the
 *  proxy router can never disagree on which paths are eligible — they did: the
 *  proxy accepts /anthropic/messages, but the helper's old `endsWith` check
 *  rejected it (and would have wrongly accepted /foo/v1/messages). Exact matches
 *  only, so /v1/messages/count_tokens stays unsupported. */
export function isAnthropicMessagesPath(pathname: string): boolean {
  return pathname === '/v1/messages'
    || pathname === '/anthropic/v1/messages'
    || pathname === '/anthropic/messages';
}

export function shouldTransformAnthropicMessages(
  input: ImgtokenxApplicabilityInput,
): { eligible: boolean; reason: ImgtokenxApplicabilityReason } {
  if (input.method !== undefined && input.method !== null && input.method.toUpperCase() !== 'POST') {
    return { eligible: false, reason: 'unsupported_method' };
  }
  if (input.path !== undefined && input.path !== null && !isAnthropicMessagesPath(input.path)) {
    return { eligible: false, reason: 'unsupported_path' };
  }
  if (input.bodyBytes !== undefined && input.bodyBytes !== null && input.bodyBytes <= 0) {
    return { eligible: false, reason: 'empty_body' };
  }
  if (!isImgtokenxSupportedModel(input.model)) {
    return { eligible: false, reason: 'unsupported_model' };
  }
  return { eligible: true, reason: 'eligible' };
}
