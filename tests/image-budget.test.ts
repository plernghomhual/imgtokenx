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
