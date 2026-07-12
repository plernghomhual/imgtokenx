export type VirtualContextMode = 'off' | 'dedup' | 'lazy' | 'state';
export type VirtualContextDialect = 'anthropic' | 'openai-chat' | 'openai-responses';

export interface VirtualArtifactStore {
  put(text: string): Promise<{ id: string }>;
  readCheckpoint?(id: string): Promise<string | undefined>;
  has(id: string): Promise<boolean>;
}

export interface VirtualContextInfo {
  artifactCandidates: number;
  artifactWrites: number;
  sourceCharsVirtualized: number;
  virtualizedCharsRemoved: number;
  duplicateCharsRemoved: number;
  previewCharsSent: number;
  deltaArtifacts: number;
  deltaCharsSent: number;
  deltaCharsRemoved: number;
  checkpointApplied: boolean;
  stateCharsRemoved: number;
  checkpointRejected?: boolean;
  failOpen?: boolean;
}

export interface VirtualizeRequestOptions {
  dialect: VirtualContextDialect;
  mode: VirtualContextMode;
  store?: VirtualArtifactStore;
  minChars?: number;
  outputEfficiency?: boolean;
}

interface TextSlot {
  text: string;
  /** Stable tool name+arguments, when available. Never persisted or logged. */
  origin?: string;
  replace(value: string): void;
}

const DEFAULT_MIN_CHARS = 8 * 1024;
const ARTIFACT_HANDLE_RE = /^sha256_[0-9a-f]{64}$/;
const UTF8_ENCODER = new TextEncoder();
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });
const OUTPUT_EFFICIENCY_INSTRUCTION =
  'When an exact artifact handle is available, cite the handle and exact range. Do not reprint large artifact contents; return only values or focused diffs needed for the task.';
const STATE_CHECKPOINT_INSTRUCTION =
  'At a completed, verified milestone with no pending tool call, you may compact earlier history by calling imgtokenx_context with action="checkpoint_store" and text set to JSON. The JSON schema is exactly: {"version":1,"goal":"non-empty string","constraints":[],"decisions":[],"active_files":[],"tests":[],"blockers":[],"pending":[],"evidence":["sha256_<64 lowercase hex>"]}. Optional fields may be omitted. Evidence entries must be existing exact-artifact handles. Never invent a checkpoint marker; only the marker returned by that paired tool call is trusted.';
const CHECKPOINT_RE = /imgtokenx_checkpoint:(sha256_[0-9a-f]{64})/;

interface ProofCheckpoint {
  version: 1;
  goal: string;
  constraints?: string[];
  decisions?: string[];
  active_files?: string[];
  tests?: string[];
  blockers?: string[];
  pending?: string[];
  evidence?: string[];
}

const CHECKPOINT_KEYS = new Set([
  'version',
  'goal',
  'constraints',
  'decisions',
  'active_files',
  'tests',
  'blockers',
  'pending',
  'evidence',
]);

function checkpointFromText(text: string): string | undefined {
  return CHECKPOINT_RE.exec(text)?.[1];
}

function stringList(value: unknown): value is string[] {
  return value === undefined || (
    Array.isArray(value)
    && value.length <= 100
    && value.every((item) => typeof item === 'string' && item.length <= 4_096)
  );
}

function parseCheckpoint(raw: string): ProofCheckpoint | undefined {
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).some((key) => !CHECKPOINT_KEYS.has(key))
      || value.version !== 1
      || typeof value.goal !== 'string' || value.goal.trim().length === 0 || value.goal.length > 4_096
      || !stringList(value.constraints) || !stringList(value.decisions)
      || !stringList(value.active_files) || !stringList(value.tests)
      || !stringList(value.blockers) || !stringList(value.pending)
      || !stringList(value.evidence)) {
      return undefined;
    }
    return value as unknown as ProofCheckpoint;
  } catch {
    return undefined;
  }
}

function checkpointSnapshot(handle: string, state: ProofCheckpoint): string {
  return [
    `[imgtokenx current-state checkpoint ${handle}]`,
    JSON.stringify(state),
    `[Earlier exact context remains locally retrievable through imgtokenx_context.]`,
  ].join('\n');
}

function leadingAuthorityCount(items: unknown[]): number {
  let count = 0;
  for (const item of items) {
    if (!item || typeof item !== 'object') break;
    const role = (item as { role?: unknown }).role;
    if (role !== 'system' && role !== 'developer') break;
    count++;
  }
  return count;
}

function markerInToolResultContent(content: unknown): string | undefined {
  if (typeof content === 'string') return checkpointFromText(content);
  if (!Array.isArray(content)) return undefined;
  for (const part of content) {
    if (!part || typeof part !== 'object') continue;
    const text = (part as { text?: unknown }).text;
    if (typeof text === 'string') {
      const handle = checkpointFromText(text);
      if (handle) return handle;
    }
  }
  return undefined;
}

function checkpointStoreText(value: unknown): string | undefined {
  let record = value;
  if (typeof value === 'string') {
    try {
      record = JSON.parse(value) as unknown;
    } catch {
      return undefined;
    }
  }
  if (!record || typeof record !== 'object' || Array.isArray(record)) return undefined;
  const args = record as { action?: unknown; text?: unknown };
  return args.action === 'checkpoint_store' && typeof args.text === 'string'
    ? args.text
    : undefined;
}

function completeToolBatch(callIds: string[], resultIds: string[]): boolean {
  if (callIds.length === 0 || callIds.length !== resultIds.length) return false;
  const calls = new Set(callIds);
  const results = new Set(resultIds);
  return calls.size === callIds.length && results.size === resultIds.length
    && callIds.every((id) => results.has(id));
}

function checkpointPairAt(
  items: unknown[],
  index: number,
  dialect: VirtualContextDialect,
): { handle: string; pairStart: number; submittedText: string } | undefined {
  if (index < 1) return undefined;
  const current = items[index];
  const previous = items[index - 1];
  if (!current || typeof current !== 'object' || !previous || typeof previous !== 'object') {
    return undefined;
  }

  if (dialect === 'anthropic') {
    const resultMessage = current as { role?: unknown; content?: unknown };
    const callMessage = previous as { role?: unknown; content?: unknown };
    if (resultMessage.role !== 'user' || callMessage.role !== 'assistant'
      || !Array.isArray(resultMessage.content) || !Array.isArray(callMessage.content)) {
      return undefined;
    }
    const calls = callMessage.content.flatMap((call) => {
      if (!call || typeof call !== 'object') return [];
      const tool = call as { type?: unknown; id?: unknown };
      return tool.type === 'tool_use' && typeof tool.id === 'string' ? [tool.id] : [];
    });
    const results = resultMessage.content.flatMap((result) => {
      if (!result || typeof result !== 'object') return [];
      const tool = result as { type?: unknown; tool_use_id?: unknown };
      return tool.type === 'tool_result' && typeof tool.tool_use_id === 'string'
        ? [tool.tool_use_id]
        : [];
    });
    if (!completeToolBatch(calls, results)) return undefined;
    for (const result of resultMessage.content) {
      if (!result || typeof result !== 'object') continue;
      const block = result as { type?: unknown; tool_use_id?: unknown; content?: unknown };
      if (block.type !== 'tool_result' || typeof block.tool_use_id !== 'string') continue;
      const handle = markerInToolResultContent(block.content);
      if (!handle) continue;
      let submittedText: string | undefined;
      const paired = callMessage.content.some((call) => {
        if (!call || typeof call !== 'object') return false;
        const tool = call as { type?: unknown; id?: unknown; name?: unknown; input?: unknown };
        if (tool.type !== 'tool_use' || tool.id !== block.tool_use_id
          || tool.name !== 'imgtokenx_context') return false;
        submittedText = checkpointStoreText(tool.input);
        return submittedText !== undefined;
      });
      if (paired && submittedText !== undefined) {
        return { handle, pairStart: index - 1, submittedText };
      }
    }
    return undefined;
  }

  if (dialect === 'openai-chat') {
    const result = current as { role?: unknown; tool_call_id?: unknown; content?: unknown };
    if (result.role !== 'tool' || typeof result.tool_call_id !== 'string'
      || typeof result.content !== 'string') {
      return undefined;
    }
    let firstResult = index;
    while (firstResult > 0
      && (items[firstResult - 1] as { role?: unknown } | undefined)?.role === 'tool') {
      firstResult--;
    }
    const pairStart = firstResult - 1;
    const call = items[pairStart] as { role?: unknown; tool_calls?: unknown } | undefined;
    if (!call || call.role !== 'assistant' || !Array.isArray(call.tool_calls)) return undefined;
    let afterResults = firstResult;
    while (afterResults < items.length
      && (items[afterResults] as { role?: unknown } | undefined)?.role === 'tool') {
      afterResults++;
    }
    const callIds = call.tool_calls.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const id = (item as { id?: unknown }).id;
      return typeof id === 'string' ? [id] : [];
    });
    const resultIds = items.slice(firstResult, afterResults).flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const id = (item as { role?: unknown; tool_call_id?: unknown }).tool_call_id;
      return typeof id === 'string' ? [id] : [];
    });
    if (callIds.length !== call.tool_calls.length
      || resultIds.length !== afterResults - firstResult
      || !completeToolBatch(callIds, resultIds)) return undefined;
    const handle = checkpointFromText(result.content);
    if (!handle) return undefined;
    let submittedText: string | undefined;
    const paired = call.tool_calls.some((item) => {
      if (!item || typeof item !== 'object') return false;
      const tool = item as { id?: unknown; function?: unknown };
      const fn = tool.function as { name?: unknown; arguments?: unknown } | undefined;
      if (tool.id !== result.tool_call_id || fn?.name !== 'imgtokenx_context') return false;
      submittedText = checkpointStoreText(fn.arguments);
      return submittedText !== undefined;
    });
    return paired && submittedText !== undefined
      ? { handle, pairStart, submittedText }
      : undefined;
  }

  const result = current as { type?: unknown; call_id?: unknown; output?: unknown };
  if (result.type !== 'function_call_output' || typeof result.call_id !== 'string'
    || typeof result.output !== 'string') {
    return undefined;
  }
  let firstResult = index;
  while (firstResult > 0
    && (items[firstResult - 1] as { type?: unknown } | undefined)?.type === 'function_call_output') {
    firstResult--;
  }
  let pairStart = firstResult;
  while (pairStart > 0
    && (items[pairStart - 1] as { type?: unknown } | undefined)?.type === 'function_call') {
    pairStart--;
  }
  const calls = items.slice(pairStart, firstResult).filter((item) => item && typeof item === 'object') as Array<{
    type?: unknown;
    call_id?: unknown;
    name?: unknown;
    arguments?: unknown;
  }>;
  let afterResults = firstResult;
  while (afterResults < items.length
    && (items[afterResults] as { type?: unknown } | undefined)?.type === 'function_call_output') {
    afterResults++;
  }
  const results = items.slice(firstResult, afterResults).filter((item) => item && typeof item === 'object') as Array<{
    call_id?: unknown;
  }>;
  const callIds = calls.flatMap((call) => typeof call.call_id === 'string' ? [call.call_id] : []);
  const resultIds = results.flatMap((item) => typeof item.call_id === 'string' ? [item.call_id] : []);
  if (callIds.length !== calls.length || resultIds.length !== results.length
    || !completeToolBatch(callIds, resultIds)) return undefined;
  const call = calls.find((item) => item.call_id === result.call_id);
  if (!call || call.name !== 'imgtokenx_context') return undefined;
  const submittedText = checkpointStoreText(call.arguments);
  if (submittedText === undefined) return undefined;
  const handle = checkpointFromText(result.output);
  return handle ? { handle, pairStart, submittedText } : undefined;
}

async function applyStateCheckpoint(
  req: unknown,
  dialect: VirtualContextDialect,
  store: VirtualArtifactStore,
  info: VirtualContextInfo,
): Promise<boolean> {
  if (!store.readCheckpoint || !store.has || !req || typeof req !== 'object') return false;
  const root = req as Record<string, unknown>;
  const items = dialect === 'openai-responses' ? root.input : root.messages;
  if (!Array.isArray(items)) return false;

  let pairStart = -1;
  let handle: string | undefined;
  let submittedText: string | undefined;
  for (let i = items.length - 1; i >= 0; i--) {
    const pair = checkpointPairAt(items, i, dialect);
    if (pair) {
      pairStart = pair.pairStart;
      handle = pair.handle;
      submittedText = pair.submittedText;
      break;
    }
  }
  if (!handle || submittedText === undefined || pairStart < 1) return false;

  try {
    const raw = await store.readCheckpoint(handle);
    if (raw !== submittedText) {
      info.checkpointRejected = true;
      return false;
    }
    const state = raw === undefined ? undefined : parseCheckpoint(raw);
    if (!state) {
      info.checkpointRejected = true;
      return false;
    }
    for (const evidence of state.evidence ?? []) {
      if (!ARTIFACT_HANDLE_RE.test(evidence) || !(await store.has(evidence))) {
        info.checkpointRejected = true;
        return false;
      }
    }

    const start = dialect === 'anthropic' ? 0 : leadingAuthorityCount(items);
    const end = pairStart; // keep the checkpoint tool call and result together
    if (end <= start) return false;
    const removed = items.slice(start, end);
    const snapshot = checkpointSnapshot(handle, state);
    const replacement = dialect === 'openai-responses'
      ? { role: 'user', content: [{ type: 'input_text', text: snapshot }] }
      : { role: 'user', content: snapshot };
    items.splice(start, end - start, replacement);
    info.checkpointApplied = true;
    info.stateCharsRemoved += Math.max(0, JSON.stringify(removed).length - snapshot.length);
    return true;
  } catch {
    info.checkpointRejected = true;
    return false;
  }
}

function addSystemGuidance(
  req: unknown,
  dialect: VirtualContextDialect,
  instruction: string,
): boolean {
  if (!req || typeof req !== 'object') return false;
  const root = req as Record<string, unknown>;
  if (dialect === 'openai-responses') {
    if (root.instructions !== undefined && typeof root.instructions !== 'string') return false;
    const current = typeof root.instructions === 'string' ? root.instructions : '';
    if (current.includes(instruction)) return false;
    root.instructions = [current, instruction].filter(Boolean).join('\n\n');
    return true;
  }
  if (dialect === 'anthropic') {
    if (typeof root.system === 'string') {
      if (root.system.includes(instruction)) return false;
      root.system = `${root.system}\n\n${instruction}`;
      return true;
    }
    if (Array.isArray(root.system)) {
      const alreadyPresent = root.system.some((block) => block && typeof block === 'object'
        && typeof (block as { text?: unknown }).text === 'string'
        && ((block as { text: string }).text).includes(instruction));
      if (alreadyPresent) return false;
      root.system.push({ type: 'text', text: instruction });
      return true;
    }
    if (root.system !== undefined) return false;
    root.system = instruction;
    return true;
  }
  const messages = root.messages;
  if (!Array.isArray(messages)) return false;
  const system = messages.find(
    (message) => message && typeof message === 'object' && (message as { role?: unknown }).role === 'system',
  ) as { content?: unknown } | undefined;
  if (system && typeof system.content === 'string') {
    if (system.content.includes(instruction)) return false;
    system.content = `${system.content}\n\n${instruction}`;
  } else {
    messages.unshift({ role: 'system', content: instruction });
  }
  return true;
}

function stableToolOrigin(name: unknown, input: unknown): string | undefined {
  if (typeof name !== 'string' || name.length === 0) return undefined;
  try {
    const args = typeof input === 'string' ? input : JSON.stringify(input);
    if (typeof args !== 'string' || UTF8_ENCODER.encode(args).byteLength > 16 * 1024) {
      return undefined;
    }
    return `${name}\n${args}`;
  } catch {
    return undefined;
  }
}

function anthropicToolResults(req: unknown): TextSlot[] {
  if (!req || typeof req !== 'object') return [];
  const messages = (req as { messages?: unknown }).messages;
  if (!Array.isArray(messages)) return [];
  const origins = new Map<string, string>();
  for (const message of messages) {
    if (!message || typeof message !== 'object') continue;
    const content = (message as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (!block || typeof block !== 'object') continue;
      const call = block as { type?: unknown; id?: unknown; name?: unknown; input?: unknown };
      if (call.type !== 'tool_use' || typeof call.id !== 'string') continue;
      const origin = stableToolOrigin(call.name, call.input);
      if (origin) origins.set(call.id, origin);
    }
  }
  const out: TextSlot[] = [];
  for (const message of messages) {
    if (!message || typeof message !== 'object') continue;
    const content = (message as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (!block || typeof block !== 'object') continue;
      const tool = block as { type?: unknown; tool_use_id?: unknown; content?: unknown };
      if (tool.type !== 'tool_result') continue;
      if (typeof tool.content === 'string') {
        out.push({
          text: tool.content,
          ...(typeof tool.tool_use_id === 'string' && origins.has(tool.tool_use_id)
            ? { origin: origins.get(tool.tool_use_id)! }
            : {}),
          replace(value) { tool.content = value; },
        });
        continue;
      }
      // Array-shaped results can carry block boundaries, cache_control, and
      // future provider state. Treat them as opaque instead of flattening them
      // into a lossy string artifact.
    }
  }
  return out;
}

function openAIChatToolResults(req: unknown): TextSlot[] {
  if (!req || typeof req !== 'object') return [];
  const messages = (req as { messages?: unknown }).messages;
  if (!Array.isArray(messages)) return [];
  const origins = new Map<string, string>();
  for (const message of messages) {
    if (!message || typeof message !== 'object') continue;
    const calls = (message as { tool_calls?: unknown }).tool_calls;
    if (!Array.isArray(calls)) continue;
    for (const item of calls) {
      if (!item || typeof item !== 'object') continue;
      const call = item as { id?: unknown; function?: unknown };
      const fn = call.function as { name?: unknown; arguments?: unknown } | undefined;
      if (typeof call.id !== 'string') continue;
      const origin = stableToolOrigin(fn?.name, fn?.arguments);
      if (origin) origins.set(call.id, origin);
    }
  }
  const out: TextSlot[] = [];
  for (const message of messages) {
    if (!message || typeof message !== 'object') continue;
    const tool = message as { role?: unknown; tool_call_id?: unknown; content?: unknown };
    if (tool.role !== 'tool' || typeof tool.content !== 'string') continue;
    out.push({
      text: tool.content,
      ...(typeof tool.tool_call_id === 'string' && origins.has(tool.tool_call_id)
        ? { origin: origins.get(tool.tool_call_id)! }
        : {}),
      replace(value) { tool.content = value; },
    });
  }
  return out;
}

function openAIResponsesToolResults(req: unknown): TextSlot[] {
  if (!req || typeof req !== 'object') return [];
  const input = (req as { input?: unknown }).input;
  if (!Array.isArray(input)) return [];
  const origins = new Map<string, string>();
  for (const item of input) {
    if (!item || typeof item !== 'object') continue;
    const call = item as {
      type?: unknown;
      call_id?: unknown;
      name?: unknown;
      arguments?: unknown;
    };
    if (call.type !== 'function_call' || typeof call.call_id !== 'string') continue;
    const origin = stableToolOrigin(call.name, call.arguments);
    if (origin) origins.set(call.call_id, origin);
  }
  const out: TextSlot[] = [];
  for (const item of input) {
    if (!item || typeof item !== 'object') continue;
    const tool = item as { type?: unknown; call_id?: unknown; output?: unknown };
    if (tool.type !== 'function_call_output' || typeof tool.output !== 'string') continue;
    out.push({
      text: tool.output,
      ...(typeof tool.call_id === 'string' && origins.has(tool.call_id)
        ? { origin: origins.get(tool.call_id)! }
        : {}),
      replace(value) { tool.output = value; },
    });
  }
  return out;
}

function artifactReference(id: string, chars: number): string {
  return `[Exact artifact: ${id} chars=${chars}. Call imgtokenx_context with action="fetch" and handle="${id}" for exact content.]`;
}

function utf8Prefix(bytes: Uint8Array, maxBytes: number): string {
  let end = Math.min(bytes.length, maxBytes);
  while (end > 0) {
    try {
      return UTF8_DECODER.decode(bytes.subarray(0, end));
    } catch {
      end--;
    }
  }
  return '';
}

function utf8Suffix(bytes: Uint8Array, maxBytes: number): string {
  let start = Math.max(0, bytes.length - maxBytes);
  while (start < bytes.length && (bytes[start]! & 0xc0) === 0x80) start++;
  return UTF8_DECODER.decode(bytes.subarray(start));
}

function artifactPreview(id: string, text: string): string {
  const bytes = UTF8_ENCODER.encode(text);
  const head = utf8Prefix(bytes, 2_048);
  const tail = utf8Suffix(bytes, 2_048);
  const errors: string[] = [];
  let errorBytes = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!/(?:error|warn|fail|exception)/i.test(line) || errors.includes(line)) continue;
    const next = utf8Prefix(UTF8_ENCODER.encode(line), 2_048 - errorBytes);
    if (!next) break;
    errors.push(next);
    errorBytes += UTF8_ENCODER.encode(next).byteLength + 1;
    if (errorBytes >= 2_048) break;
  }
  return [
    artifactReference(id, text.length),
    '--- head ---',
    head,
    ...(errors.length > 0 ? ['--- errors/warnings ---', ...errors] : []),
    '--- tail ---',
    tail,
  ].join('\n');
}

function artifactDelta(
  baseId: string,
  id: string,
  before: string,
  after: string,
): string | undefined {
  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');
  let prefix = 0;
  while (prefix < beforeLines.length && prefix < afterLines.length
    && beforeLines[prefix] === afterLines[prefix]) prefix++;
  let suffix = 0;
  while (suffix < beforeLines.length - prefix && suffix < afterLines.length - prefix
    && beforeLines[beforeLines.length - 1 - suffix] === afterLines[afterLines.length - 1 - suffix]) {
    suffix++;
  }
  const insertLines = afterLines.slice(prefix, afterLines.length - suffix);
  const payload = JSON.stringify({
    format: 'replace_lines_v1',
    base_handle: baseId,
    handle: id,
    start_line_0: prefix,
    delete_line_count: beforeLines.length - prefix - suffix,
    insert_lines: insertLines,
  });
  const replacement = [
    `[Exact artifact delta: ${id} from ${baseId}.]`,
    payload,
    `[Apply to base.split("\\n"), then join("\\n"); or call imgtokenx_context action="diff" handle="${baseId}" other_handle="${id}".]`,
  ].join('\n');
  const replacementBytes = UTF8_ENCODER.encode(replacement).byteLength;
  const previewBytes = UTF8_ENCODER.encode(artifactPreview(id, after)).byteLength;
  const sourceBytes = UTF8_ENCODER.encode(after).byteLength;
  return replacementBytes <= 4_096
    && replacementBytes < previewBytes
    && replacementBytes * 2 < sourceBytes
    ? replacement
    : undefined;
}

export async function virtualizeRequestBody(
  body: Uint8Array,
  opts: VirtualizeRequestOptions,
): Promise<{ body: Uint8Array; info: VirtualContextInfo }> {
  const info: VirtualContextInfo = {
    artifactCandidates: 0,
    artifactWrites: 0,
    sourceCharsVirtualized: 0,
    virtualizedCharsRemoved: 0,
    duplicateCharsRemoved: 0,
    previewCharsSent: 0,
    deltaArtifacts: 0,
    deltaCharsSent: 0,
    deltaCharsRemoved: 0,
    checkpointApplied: false,
    stateCharsRemoved: 0,
  };
  if (opts.mode === 'off' && !opts.outputEfficiency) return { body, info };
  if (opts.mode !== 'off' && (!opts.store || typeof opts.store.has !== 'function'
    || (opts.mode === 'state' && typeof opts.store.readCheckpoint !== 'function'))) {
    return { body, info: { ...info, failOpen: true } };
  }

  try {
    const req = JSON.parse(new TextDecoder().decode(body)) as unknown;
    let changed = opts.outputEfficiency
      ? addSystemGuidance(req, opts.dialect, OUTPUT_EFFICIENCY_INSTRUCTION)
      : false;
    if (opts.mode === 'state') {
      changed = addSystemGuidance(req, opts.dialect, STATE_CHECKPOINT_INSTRUCTION) || changed;
    }
    if (opts.mode === 'off') {
      return changed
        ? { body: new TextEncoder().encode(JSON.stringify(req)), info }
        : { body, info };
    }
    const slots = opts.dialect === 'anthropic'
      ? anthropicToolResults(req)
      : opts.dialect === 'openai-chat'
        ? openAIChatToolResults(req)
        : openAIResponsesToolResults(req);
    const minChars = opts.minChars ?? DEFAULT_MIN_CHARS;
    const counts = new Map<string, number>();
    for (const slot of slots) {
      if (slot.text.length < minChars) continue;
      info.artifactCandidates++;
      counts.set(slot.text, (counts.get(slot.text) ?? 0) + 1);
    }

    const ids = new Map<string, string>();
    const storeText = async (text: string): Promise<string> => {
      const known = ids.get(text);
      if (known) return known;
      const { id } = await opts.store!.put(text);
      if (!ARTIFACT_HANDLE_RE.test(id) || !(await opts.store!.has(id))) {
        throw new Error('artifact store returned an unavailable handle');
      }
      ids.set(text, id);
      info.artifactWrites++;
      return id;
    };

    if (opts.mode === 'dedup') {
      for (const [text, count] of counts) {
        if (count < 2) continue;
        const id = await storeText(text);
        let seen = false;
        for (const slot of slots) {
          if (slot.text !== text) continue;
          if (!seen) {
            seen = true;
            continue;
          }
          const replacement = artifactReference(id, text.length);
          slot.replace(replacement);
          info.sourceCharsVirtualized += text.length;
          const removed = Math.max(0, text.length - replacement.length);
          info.virtualizedCharsRemoved += removed;
          info.duplicateCharsRemoved += removed;
          changed = true;
        }
      }
    } else {
      const exposedTexts = new Set<string>();
      const previousByOrigin = new Map<string, { id: string; text: string }>();
      for (const slot of slots) {
        if (slot.text.length < minChars) continue;
        const id = await storeText(slot.text);
        const duplicate = exposedTexts.has(slot.text);
        const previous = slot.origin ? previousByOrigin.get(slot.origin) : undefined;
        const delta = !duplicate && previous && previous.text !== slot.text
          ? artifactDelta(previous.id, id, previous.text, slot.text)
          : undefined;
        const replacement = duplicate
          ? artifactReference(id, slot.text.length)
          : delta ?? artifactPreview(id, slot.text);
        slot.replace(replacement);
        info.sourceCharsVirtualized += slot.text.length;
        const removed = Math.max(0, slot.text.length - replacement.length);
        info.virtualizedCharsRemoved += removed;
        if (duplicate) info.duplicateCharsRemoved += removed;
        else if (delta) {
          info.deltaArtifacts++;
          info.deltaCharsSent += replacement.length;
          info.deltaCharsRemoved += removed;
        } else {
          info.previewCharsSent += replacement.length;
        }
        exposedTexts.add(slot.text);
        if (slot.origin) previousByOrigin.set(slot.origin, { id, text: slot.text });
        changed = true;
      }
    }
    if (opts.mode === 'state' && opts.store) {
      changed = (await applyStateCheckpoint(req, opts.dialect, opts.store, info)) || changed;
    }
    if (!changed) return { body, info };
    return { body: new TextEncoder().encode(JSON.stringify(req)), info };
  } catch {
    return { body, info: { ...info, failOpen: true } };
  }
}
