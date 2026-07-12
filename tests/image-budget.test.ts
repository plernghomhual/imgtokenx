/**
 * Regression tests for audit #4 D4 — shared Anthropic 100-image budget.
 *
 * Covers:
 *  - countExistingImages: pre-existing image blocks across user content AND
 *    tool_result content arrays (the API counts both). Excludes tool_use.
 *  - RequestImageCounter: claim/remaining/toInfo semantics, including the
 *    existing+used+skipped invariant.
 *  - transformRequest end-to-end: a request with 96 pre-existing images can
 *    only emit 4 more (slab clamps at first N); applyAnthropicImageBudget=false
 *    disables the budget entirely; info.imageBudget telemetry is populated.
 */
import { describe, expect, it } from 'vitest';
import {
  countExistingImages,
  RequestImageCounter,
  transformRequest,
} from '../src/core/transform.js';
import type { Message } from '../src/core/types.js';
import { collapseHistory } from '../src/core/history.js';

const imageBlock = (data = 'AAAA'): Message => ({
  role: 'user',
  content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data } }],
});

const textBlock = (text: string): Message => ({ role: 'user', content: [{ type: 'text', text }] });

const toolResultWithImage = (id: string, data = 'BBBB'): Message => ({
  role: 'user',
  content: [
    { type: 'tool_result', tool_use_id: id, content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data } }] },
  ],
});

describe('Audit #4 D4 — countExistingImages', () => {
  it('returns 0 for no messages', () => {
    expect(countExistingImages(undefined)).toBe(0);
    expect(countExistingImages([])).toBe(0);
  });

  it('counts image blocks in user content', () => {
    expect(countExistingImages([imageBlock(), imageBlock()])).toBe(2);
  });

  it('counts images inside tool_result content arrays', () => {
    expect(countExistingImages([toolResultWithImage('a'), toolResultWithImage('b')])).toBe(2);
  });

  it('mixes user-content and tool_result-content images', () => {
    expect(countExistingImages([imageBlock(), toolResultWithImage('a')])).toBe(2);
  });

  it('skips tool_use (Anthropic API rejects images inside tool_use)', () => {
    const m: Message = { role: 'assistant', content: [{ type: 'tool_use', id: 'x', name: 'foo', input: { image: { type: 'image' } } as unknown as Record<string, unknown> }] };
    expect(countExistingImages([m])).toBe(0);
  });

  it('handles string content (no images possible)', () => {
    expect(countExistingImages([textBlock('hello')])).toBe(0);
  });
});

describe('Audit #4 D4 — RequestImageCounter', () => {
  it('remaining = total - existing when nothing claimed', () => {
    const c = new RequestImageCounter([imageBlock(), imageBlock()], 100);
    expect(c.total).toBe(100);
    expect(c.existing).toBe(2);
    expect(c.remaining()).toBe(98);
    expect(c.used).toBe(0);
    expect(c.skipped).toBe(0);
  });

  it('claim reserves up to remaining; remainder goes to skipped', () => {
    const c = new RequestImageCounter([imageBlock()], 100);
    expect(c.claim(50)).toBe(50);
    expect(c.used).toBe(50);
    expect(c.skipped).toBe(0);
    expect(c.remaining()).toBe(49);
    expect(c.claim(100)).toBe(49); // only 49 left
    expect(c.skipped).toBe(51);
  });

  it('claim(0) is a no-op; claim of negative is treated as 0', () => {
    const c = new RequestImageCounter([], 10);
    expect(c.claim(0)).toBe(0);
    expect(c.claim(-5)).toBe(0);
    expect(c.used).toBe(0);
  });

  it('toInfo roundtrips total/existing/used/skipped', () => {
    const c = new RequestImageCounter([imageBlock()], 10);
    // total=10, existing=1, remaining=9. c.claim(5) → used=5, skipped=0.
    c.claim(5);
    // remaining=4 now. c.claim(10) → allowed=4, used+=4=9, skipped+=6=6.
    c.claim(10);
    expect(c.toInfo()).toEqual({ total: 10, existing: 1, used: 9, skipped: 6 });
  });

  it('total < existing → remaining is clamped to 0', () => {
    const c = new RequestImageCounter([imageBlock(), imageBlock(), imageBlock()], 2);
    expect(c.remaining()).toBe(0);
    expect(c.claim(1)).toBe(0);
    expect(c.skipped).toBe(1);
  });
});

describe('Audit #4 D4 — transformRequest end-to-end', () => {
  it('populates info.imageBudget with existing/used/skipped telemetry', async () => {
    const req = {
      // claude-sonnet-4-5 resolves to reader_profile_unsafe (early return, no
      // budget) — pin a reader-safe model so the budget path actually runs.
      model: 'claude-opus-4-8',
      system: 'You are a helpful assistant.',
      messages: [textBlock('hi')],
    };
    const body = new TextEncoder().encode(JSON.stringify(req));
    const { info } = await transformRequest(body, { compress: true });
    // Even on a no-slab-pass request, the budget is instantiated; fields present
    // whenever the request went past the early returns. Unconditional so a
    // regression that stops populating imageBudget fails loudly instead of
    // silently skipping every assertion.
    expect(info.imageBudget).toBeDefined();
    expect(info.imageBudget!.total).toBe(100);
    expect(info.imageBudget!.existing).toBe(0);
    expect(info.imageBudget!.used).toBeGreaterThanOrEqual(0);
    expect(info.imageBudget!.skipped).toBeGreaterThanOrEqual(0);
  });

  it('applyAnthropicImageBudget=false leaves info.imageBudget undefined', async () => {
    const req = {
      model: 'claude-opus-4-8',
      system: 'You are a helpful assistant.',
      messages: [textBlock('hi')],
    };
    const body = new TextEncoder().encode(JSON.stringify(req));
    const { info } = await transformRequest(body, {
      compress: true,
      applyAnthropicImageBudget: false,
    });
    // When the budget is a no-op, the telemetry field is omitted.
    expect(info.imageBudget).toBeUndefined();
  });

  it('a request with 96 pre-existing images has remaining=4 in the budget', async () => {
    const existing = Array.from({ length: 96 }, () => imageBlock());
    const req = {
      model: 'claude-opus-4-8',
      system: 'You are a helpful assistant.',
      messages: [...existing, textBlock('hi')],
    };
    const body = new TextEncoder().encode(JSON.stringify(req));
    const { info } = await transformRequest(body, { compress: true });
    expect(info.imageBudget).toBeDefined();
    expect(info.imageBudget!.existing).toBe(96);
    // remaining starts at 4; any image this request emits gets claimed.
    expect(info.imageBudget!.total).toBe(100);
  });
});

describe('Audit #4 D4 — history shares the request budget', () => {
  it('keeps history native when no image slots remain', async () => {
    const messages: Message[] = Array.from({ length: 16 }, (_, i) => ({
      role: i % 2 ? 'assistant' : 'user',
      content: `turn ${i} ${'history '.repeat(200)}`,
    }));
    const result = await collapseHistory(messages, () => true, {
      keepTail: 2,
      minCollapsePrefix: 2,
      collapseChunk: 0,
      freezeChunk: 0,
      maxImages: 0,
    });
    expect(result.messages).toBe(messages);
    expect(result.info.collapsedImages).toBe(0);
    expect(result.info.reason).toBe('too_many_images');
  });
});

describe('slab budget pressure — content survival', () => {
  it('keeps the complete native slab and tools when every rendered page cannot fit', async () => {
    // 97 pre-existing images leave only 3 slots. Partial imaging would remove
    // the complete native slab/tools while sending only the first 3 pages, so
    // the transform must decline the whole slab and preserve the input bytes.
    const existing = Array.from({ length: 97 }, () => imageBlock());
    const lateMarker = 'LATE_SLAB_MARKER_MUST_SURVIVE_NATIVELY';
    const slab = Array.from(
      { length: 3000 },
      (_, i) => `System instruction line ${i}: always verify the invariant before replying.`,
    ).join('\n') + `\n${lateMarker}`;
    const tools = [{
      name: 'late_tool',
      description: 'TOOL_DESCRIPTION_MUST_REMAIN_NATIVE',
      input_schema: { type: 'object', properties: { value: { type: 'string' } } },
    }];
    const req = {
      model: 'claude-opus-4-8',
      system: slab,
      tools,
      messages: [...existing, textBlock('hi')],
    };
    const body = new TextEncoder().encode(JSON.stringify(req));
    const { body: outBody, info } = await transformRequest(body, {
      compress: true,
      charsPerToken: 1,
      minCompressChars: 1,
    });
    expect(info.imageBudget).toBeDefined();
    const out = JSON.parse(new TextDecoder().decode(outBody)) as {
      system?: string;
      tools?: typeof tools;
      messages: { content: unknown }[];
    };
    let images = 0;
    for (const m of out.messages) {
      if (!Array.isArray(m.content)) continue;
      for (const b of m.content as { type: string; source?: { data?: string }; text?: string }[]) {
        if (b.type === 'image') {
          images++;
          // Every surviving page is a well-formed base64 PNG.
          expect(b.source?.data ?? '').toMatch(/^[A-Za-z0-9+/=]+$/);
        }
      }
    }
    expect(info.imageBudget).toMatchObject({ total: 100, existing: 97, used: 0 });
    expect(info.imageBudget!.skipped).toBeGreaterThan(3);
    expect(info.imageCount).toBe(0);
    expect(info.imageBytes).toBe(0);
    expect(info.imagePixels ?? 0).toBe(0);
    expect(info.imagePngs ?? []).toHaveLength(0);
    expect(info.imageDims ?? []).toHaveLength(0);
    expect(images).toBe(97);
    expect(out.system).toContain(lateMarker);
    expect(out.tools).toEqual(tools);
    expect(outBody).toEqual(body);
  });
});
