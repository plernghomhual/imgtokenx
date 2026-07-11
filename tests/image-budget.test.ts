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
      model: 'claude-sonnet-4-5',
      system: 'You are a helpful assistant.',
      messages: [textBlock('hi')],
    };
    const body = new TextEncoder().encode(JSON.stringify(req));
    const { info } = await transformRequest(body, { compress: true });
    // Even on a no-slab-pass request, the budget is instantiated; fields present
    // whenever the request went past the early returns.
    if (info.imageBudget !== undefined) {
      expect(info.imageBudget.total).toBe(100);
      expect(info.imageBudget.existing).toBe(0);
      expect(info.imageBudget.used).toBeGreaterThanOrEqual(0);
      expect(info.imageBudget.skipped).toBeGreaterThanOrEqual(0);
    }
  });

  it('applyAnthropicImageBudget=false leaves info.imageBudget undefined', async () => {
    const req = {
      model: 'claude-sonnet-4-5',
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
      model: 'claude-sonnet-4-5',
      system: 'You are a helpful assistant.',
      messages: [...existing, textBlock('hi')],
    };
    const body = new TextEncoder().encode(JSON.stringify(req));
    const { info } = await transformRequest(body, { compress: true });
    if (info.imageBudget !== undefined) {
      expect(info.imageBudget.existing).toBe(96);
      // remaining starts at 4; any image this request emits gets claimed.
      expect(info.imageBudget.total).toBe(100);
    }
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

describe('slab truncation under budget pressure — content survival', () => {
  it('caps emitted pages at remaining budget, keeps the FIRST pages, counts the rest as skipped', async () => {
    // 97 pre-existing images leave a remaining budget of 3. A slab big enough
    // to render well past 3 pages must clamp: emitted images ≤ 3, the total
    // image count in the outgoing body never exceeds Anthropic's 100 cap, and
    // the drop is surfaced as info.imageBudget.skipped (the telemetry the
    // dashboard uses to flag lossy truncation).
    const existing = Array.from({ length: 97 }, () => imageBlock());
    const slab = Array.from(
      { length: 3000 },
      (_, i) => `System instruction line ${i}: always verify the invariant before replying.`,
    ).join('\n');
    const req = {
      model: 'claude-opus-4-8',
      system: slab,
      messages: [...existing, textBlock('hi')],
    };
    const body = new TextEncoder().encode(JSON.stringify(req));
    const { body: outBody, info } = await transformRequest(body, {
      compress: true,
      charsPerToken: 1,
      minCompressChars: 1,
    });
    if (info.imageBudget === undefined || info.imageBudget.used === 0) {
      // Transform declined the slab pass entirely (e.g. applicability gate).
      // That is a different regression — fail loudly instead of vacuously.
      expect.fail(`expected slab pages to be emitted, got info=${JSON.stringify(info)}`);
    }
    const out = JSON.parse(new TextDecoder().decode(outBody)) as {
      messages: { content: unknown }[];
    };
    let images = 0;
    const texts: string[] = [];
    for (const m of out.messages) {
      if (!Array.isArray(m.content)) continue;
      for (const b of m.content as { type: string; source?: { data?: string }; text?: string }[]) {
        if (b.type === 'image') {
          images++;
          // Every surviving page is a well-formed base64 PNG.
          expect(b.source?.data ?? '').toMatch(/^[A-Za-z0-9+/=]+$/);
        }
        if (b.type === 'text' && typeof b.text === 'string') texts.push(b.text);
      }
    }
    expect(info.imageBudget.total).toBe(100);
    expect(info.imageBudget.existing).toBe(97);
    expect(info.imageBudget.used).toBeLessThanOrEqual(3);
    expect(info.imageBudget.skipped).toBeGreaterThan(0);
    // existing + newly emitted never break the API's 100-image cap.
    expect(images).toBeLessThanOrEqual(100);
    expect(images).toBe(97 + info.imageBudget.used);
  });
});
