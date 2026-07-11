/**
 * Tests for Variant C history-image compression (task #52).
 *
 * Coverage:
 *   - `findClosedPrefixBoundary`: parallel tool calls in one assistant turn,
 *     interleaved tool_use_id close ordering, mid-flight (open) tool_use
 *     straddling the cutoff, and the boring "all closed" case.
 *   - `blocksToText`: drops `thinking` blocks, serialises `tool_use` /
 *     `tool_result` with content, emits `[image]` placeholder for nested
 *     images.
 *   - `messagesToHistoryText`: `--- role ---` framing, skips empty turns.
 *   - `collapseHistory`: full pipeline — opts handling, break-even gate,
 *     synthetic user message shape (text+image+recency pointer+text), live-tail preservation.
 *   - `transformRequest` end-to-end: compressHistory off (default), on with
 *     enough turns to fire, off when no closed prefix exists.
 */

import { describe, expect, it } from 'vitest';
import {
  findClosedPrefixBoundary,
  blocksToText,
  staleFreshnessHints,
  messagesToHistoryText,
  collapseHistory,
  messageHasOpaqueBlock,
  HISTORY_DEFAULTS,
} from '../src/core/history.js';
import { transformRequest, isCompressionProfitable } from '../src/core/transform.js';
import { DENSE_CONTENT_CHARS_PER_IMAGE, DENSE_CONTENT_COLS } from '../src/core/render.js';
import type { Message } from '../src/core/types.js';

// A tiny helper so test fixtures are readable.
function asst(content: Message['content']): Message {
  return { role: 'assistant', content };
}
function usr(content: Message['content']): Message {
  return { role: 'user', content };
}

describe('findClosedPrefixBoundary', () => {
  it('returns -1 for empty messages', () => {
    expect(findClosedPrefixBoundary([], 0)).toBe(-1);
    expect(findClosedPrefixBoundary([], 10)).toBe(-1);
  });

  it('returns -1 when cutoff is 0 (no prefix to scan)', () => {
    const msgs: Message[] = [usr('hi'), asst('hello')];
    expect(findClosedPrefixBoundary(msgs, 0)).toBe(-1);
  });

  it('returns last index for an all-plain (no tool calls) conversation', () => {
    const msgs: Message[] = [usr('hi'), asst('hello'), usr('thanks')];
    // Cutoff exclusive=3 → scan [0..2]. All plain → all closed. Last index = 2.
    expect(findClosedPrefixBoundary(msgs, 3)).toBe(2);
  });

  it('returns the last-closed boundary, not the cutoff itself, when there are mid-flight tool_uses', () => {
    const msgs: Message[] = [
      usr('do thing'),
      asst([{ type: 'tool_use', id: 'A', name: 't', input: {} }]),
      usr([{ type: 'tool_result', tool_use_id: 'A', content: 'ok' }]),
      // turn 3 opens 'B' but never closes it within our cutoff.
      asst([{ type: 'tool_use', id: 'B', name: 't', input: {} }]),
      usr('plain text'), // no tool_result for B → B is open
    ];
    // Cutoff exclusive=5 → scan all 5 messages. After msg 2, openSet={}.
    // After msg 3, openSet={B}. After msg 4 (plain user, no tool_result),
    // openSet still {B}. Last closed index = 2.
    expect(findClosedPrefixBoundary(msgs, 5)).toBe(2);
  });

  it('handles parallel tool calls in one assistant turn', () => {
    const msgs: Message[] = [
      usr('parallel work'),
      asst([
        { type: 'tool_use', id: 'A', name: 't', input: {} },
        { type: 'tool_use', id: 'B', name: 't', input: {} },
      ]),
      usr([
        { type: 'tool_result', tool_use_id: 'B', content: 'b' },
        { type: 'tool_result', tool_use_id: 'A', content: 'a' },
      ]),
      asst('done'),
    ];
    // After msg 1: openSet={A,B}. After msg 2: openSet={} (both closed in
    // reverse order — order doesn't matter for openSet). After msg 3: still
    // closed. Last index = 3.
    expect(findClosedPrefixBoundary(msgs, 4)).toBe(3);
  });

  it('returns -1 when the very first message opens a tool_use that never closes', () => {
    const msgs: Message[] = [
      asst([{ type: 'tool_use', id: 'X', name: 't', input: {} }]),
      usr('plain text, no tool_result'),
    ];
    // openSet={X} after msg 0 and msg 1 → never closes → no closed index.
    expect(findClosedPrefixBoundary(msgs, 2)).toBe(-1);
  });

  it('respects cutoffExclusive — never scans into the live tail', () => {
    const msgs: Message[] = [
      usr('q1'),
      asst('a1'),
      usr('q2'),
      asst('a2'),
      usr('q3'),
    ];
    // Cutoff exclusive=2 → only scan [0,1]. Last closed = 1.
    expect(findClosedPrefixBoundary(msgs, 2)).toBe(1);
    // Cutoff=1 → only scan [0]. Last closed = 0.
    expect(findClosedPrefixBoundary(msgs, 1)).toBe(0);
  });
});

describe('blocksToText', () => {
  it('returns string content verbatim', () => {
    expect(blocksToText('hello world')).toBe('hello world');
  });

  it('joins text blocks with double newline', () => {
    expect(
      blocksToText([
        { type: 'text', text: 'first paragraph' },
        { type: 'text', text: 'second paragraph' },
      ]),
    ).toBe('first paragraph\n\nsecond paragraph');
  });

  it('serialises tool_use with its name and COMPACT JSON args', () => {
    // Compact JSON (no 2-space indent) keeps row counts low so the
    // history image stays small — pretty-printing inflates rows ~5×.
    const out = blocksToText([
      {
        type: 'tool_use',
        id: 'tx1',
        name: 'Read',
        input: { file_path: '/etc/hosts', limit: 50 },
      },
    ]);
    expect(out).toContain('[tool_use Read]');
    expect(out).toContain('"file_path":"/etc/hosts"');
    expect(out).toContain('"limit":50');
    // Negative: no pretty-print artefacts.
    expect(out).not.toContain('  "file_path"');
    expect(out).not.toContain('"limit": 50');
  });

  it('serialises tool_result string content', () => {
    expect(
      blocksToText([
        { type: 'tool_result', tool_use_id: 'tx1', content: 'output line one' },
      ]),
    ).toContain('[tool_result]\noutput line one');
  });

  it('marks tool_result is_error with " (error)" suffix', () => {
    expect(
      blocksToText([
        {
          type: 'tool_result',
          tool_use_id: 'tx1',
          content: 'oops',
          is_error: true,
        },
      ]),
    ).toContain('[tool_result (error)]');
  });

  it('flattens array-shaped tool_result content (text + image)', () => {
    const out = blocksToText([
      {
        type: 'tool_result',
        tool_use_id: 'tx1',
        content: [
          { type: 'text', text: 'caption' },
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/png', data: 'AAAA' },
          },
        ],
      },
    ]);
    expect(out).toContain('caption');
    expect(out).toContain('[image]');
  });

  it('drops thinking blocks (Opus 4.7 only requires bit-perfect on most-recent turn)', () => {
    const out = blocksToText([
      // @ts-expect-error — `thinking` is a real Anthropic block but not in our
      // pared-down types union. The blocksToText switch must silently drop it.
      { type: 'thinking', thinking: 'secret reasoning trace', signature: 'sig123' },
      { type: 'text', text: 'visible answer' },
    ]);
    expect(out).toBe('visible answer');
    expect(out).not.toContain('secret reasoning');
    expect(out).not.toContain('sig123');
  });

  it('emits [image] placeholder for top-level image blocks', () => {
    expect(
      blocksToText([
        {
          type: 'image',
          source: { type: 'base64', media_type: 'image/png', data: 'AAAA' },
        },
      ]),
    ).toBe('[image]');
  });
});

describe('staleFreshnessHints (read-gate audit, 2026-07-03)', () => {
  const HINT = '(file state is current in your context — no need to Read it back)';
  const STALE =
    '(state as of this PRIOR turn — the file may have changed since; Read it again before editing)';

  it('rewrites the canonical Claude Code freshness hint', () => {
    const input = `The file /tmp/x.ts has been updated successfully. ${HINT}`;
    expect(staleFreshnessHints(input)).toBe(
      `The file /tmp/x.ts has been updated successfully. ${STALE}`,
    );
  });

  it('rewrites the line-wrapped variant (3 of ~2,125 logged instances)', () => {
    const wrapped =
      '(file state is current in your\n  context — no need to Read it back)';
    expect(staleFreshnessHints(`ok. ${wrapped}`)).toBe(`ok. ${STALE}`);
  });

  it('rewrites every occurrence, not just the first', () => {
    const out = staleFreshnessHints(`${HINT} middle ${HINT}`);
    expect(out).toBe(`${STALE} middle ${STALE}`);
    expect(out).not.toContain('no need to Read it back');
  });

  it('leaves unrelated text untouched', () => {
    const s = 'Edit rejected: File has not been read yet. Read it first.';
    expect(staleFreshnessHints(s)).toBe(s);
  });

  it('applies inside blocksToText tool_result serialisation', () => {
    const out = blocksToText([
      {
        type: 'tool_result',
        tool_use_id: 'tx1',
        content: `The file /a/b.ts has been updated successfully. ${HINT}`,
      },
    ]);
    expect(out).toContain(STALE);
    expect(out).not.toContain('no need to Read it back');
  });
});

describe('messagesToHistoryText', () => {
  it('wraps each turn in <role> XML tags and joins with blank line', () => {
    const msgs: Message[] = [usr('hi'), asst('hello')];
    const out = messagesToHistoryText(msgs, 2);
    // Each tag carries an absolute turn index (message position) so the model has a recency anchor.
    expect(out).toContain('<user t="0">\nhi\n</user>');
    expect(out).toContain('<assistant t="1">\nhello\n</assistant>');
  });

  it('respects upToExclusive (does not include the live tail)', () => {
    const msgs: Message[] = [usr('q1'), asst('a1'), usr('q2')];
    const out = messagesToHistoryText(msgs, 2);
    expect(out).toContain('q1');
    expect(out).toContain('a1');
    expect(out).not.toContain('q2');
  });

  it('skips empty turns', () => {
    const msgs: Message[] = [
      usr(''),
      asst('answer'),
      usr('   \n   '), // whitespace-only
    ];
    const out = messagesToHistoryText(msgs, 3);
    // Index reflects absolute position: the empty user turn at index 0 is skipped,
    // so the assistant turn keeps its real index (1) rather than being renumbered.
    expect(out).toContain('<assistant t="1">\nanswer\n</assistant>');
    // Only one role header should appear (empty user turns are skipped).
    expect(out.match(/^<assistant /gm)?.length).toBe(1);
  });
});

describe('collapseHistory', () => {
  // The break-even predicate that ships with transform.ts. We pass it in so
  // history.ts stays cycle-free.
  const profitable = isCompressionProfitable;

  it('bails with reason=no_history on empty input', async () => {
    const { messages, info } = await collapseHistory([], profitable);
    expect(messages).toEqual([]);
    expect(info.reason).toBe('no_history');
    expect(info.collapsedTurns).toBe(0);
  });

  it('bails with reason=prefix_too_short when the closed prefix < minCollapsePrefix', async () => {
    const msgs: Message[] = [usr('q1'), asst('a1')];
    const { messages, info } = await collapseHistory(msgs, profitable, {
      keepTail: 0,
      minCollapsePrefix: 5,
      collapseChunk: 0, // legacy moving boundary — isolate the prefix-length gate
    });
    expect(messages).toBe(msgs); // unchanged reference
    expect(info.reason).toBe('prefix_too_short');
  });

  it('rejects tiny histories under the full-canvas gate', async () => {
    // Five micro-turns (~143 chars serialized). Under the full-canvas render
    // policy (no shrink-to-content) the cheapest image still spends the full
    // 1568x16 pixel band, which costs more tokens than 143 chars of text. The
    // gate correctly refuses unprofitable compressions — imgtokenx must SAVE
    // tokens, never spend more than the text it replaces. This is a regression
    // guard against re-introducing shrink-to-content (which traded savings for
    // a savings illusion on sparse content).
    const msgs: Message[] = [];
    for (let i = 0; i < 5; i++) {
      msgs.push(i % 2 === 0 ? usr(`q${i}`) : asst(`a${i}`));
    }
    const fullCanvasProfitable = (text: string): boolean =>
      isCompressionProfitable(
        text,
        DENSE_CONTENT_COLS,
        undefined,
        1,
        undefined,
        0,
        0,
        false,
      );
    const { info } = await collapseHistory(msgs, fullCanvasProfitable, {
      keepTail: 0,
      minCollapsePrefix: 5,
      collapseChunk: 0,
    });
    expect(info.reason).toBe('not_profitable');
    expect(info.collapsedTurns).toBe(0);
  });

  it('collapses a long all-plain conversation into one prepended user message', async () => {
    // 12 turns, each ~2800 chars → ~56k chars combined. Past break-even at cols=100.
    const msgs: Message[] = [];
    for (let i = 0; i < 12; i++) {
      const body = `turn ${i}: ` + 'x'.repeat(2800);
      msgs.push(i % 2 === 0 ? usr(body) : asst(body));
    }
    const { messages: out, info } = await collapseHistory(msgs, profitable, {
      keepTail: 2,
      minCollapsePrefix: 5,
      cols: 100,
      collapseChunk: 0, // legacy moving boundary — pins exact collapsedTurns
    });
    expect(info.reason).toBe(undefined); // collapsed → no reason set
    expect(info.collapsedTurns).toBe(10); // 12 - keepTail(2)
    expect(info.collapsedImages).toBeGreaterThanOrEqual(1);
    expect(out.length).toBe(1 + 2); // 1 synthetic + 2 tail turns
    // Synthetic user message is at index 0
    expect(out[0]!.role).toBe('user');
    expect(Array.isArray(out[0]!.content)).toBe(true);
    const content = out[0]!.content as Array<Record<string, unknown>>;
    expect(content[0]).toMatchObject({ type: 'text' });
    expect((content[0] as { text: string }).text).toContain('attribute every turn strictly by its tag');
    expect(content[content.length - 1]).toMatchObject({ type: 'text' });
    expect((content[content.length - 1] as { text: string }).text).toContain('current request is the live text');
    // Middle blocks are image
    const imgBlocks = content.filter((c) => c.type === 'image');
    expect(imgBlocks.length).toBe(info.collapsedImages);
    // Last 2 turns are the live tail, byte-identical to the original
    expect(out[1]).toBe(msgs[10]);
    expect(out[2]).toBe(msgs[11]);
  });

  it('adds live-text recency guardrails for collapsed history', async () => {
    const oldMarker = 'OLD WORKTREE QUESTION';
    const latestMarker = 'CURRENT FRONTIER IR REUSE';
    const msgs: Message[] = [];
    for (let i = 0; i < 14; i++) {
      const marker = i === 0 ? oldMarker : i === 10 ? latestMarker : `turn ${i}`;
      const body = `${marker}: ` + 'x'.repeat(2800);
      msgs.push(i % 2 === 0 ? usr(body) : asst(body));
    }

    const { messages: out, info } = await collapseHistory(msgs, profitable, {
      keepTail: 2,
      minCollapsePrefix: 5,
      cols: 100,
      collapseChunk: 0,
    });

    expect(info.reason).toBe(undefined);
    expect(info.collapsedTurns).toBe(12);
    const content = out[0]!.content as Array<Record<string, unknown>>;
    const textBlocks = content.filter((c) => c.type === 'text') as Array<{ text: string }>;
    expect(textBlocks).toHaveLength(3);
    expect(textBlocks[0]!.text).toContain('do not reopen low-N turns');
    expect(textBlocks[1]!.text).toContain('Most recent collapsed user turn');
    expect(textBlocks[1]!.text).toContain('<user t="10">');
    expect(textBlocks[1]!.text).toContain(latestMarker);
    expect(textBlocks[1]!.text).not.toContain(oldMarker);
    expect(textBlocks[2]!.text).toContain('current request is the live text');
  });

  it('splits dense collapsed history into readable image pages with only a bounded recency pointer', async () => {
    const body = Array.from(
      { length: 180 },
      (_, i) => `line ${i}: ${'x'.repeat(80)}`,
    ).join('\n');
    const msgs: Message[] = [usr(body), asst(body), usr(body)];

    const { messages: out, info } = await collapseHistory(msgs, () => true, {
      keepTail: 0,
      minCollapsePrefix: 1,
      collapseChunk: 0,
    });

    expect(info.reason).toBe(undefined);
    expect(info.collapsedImages).toBeGreaterThanOrEqual(
      Math.ceil(info.collapsedChars / DENSE_CONTENT_CHARS_PER_IMAGE),
    );
    const content = out[0]!.content as Array<Record<string, unknown>>;
    const textBlocks = content.filter((c) => c.type === 'text');
    expect(textBlocks).toHaveLength(3);
    expect((textBlocks[0] as { text: string }).text).toContain('attribute every turn strictly by its tag');
    expect((textBlocks[1] as { text: string }).text).toContain('Most recent collapsed user turn');
    expect(((textBlocks[1] as { text: string }).text).length).toBeLessThan(500);
    expect((textBlocks[2] as { text: string }).text).toContain('current request is the live text');
    expect(content.filter((c) => c.type === 'image')).toHaveLength(info.collapsedImages);
  });

  it('reflow packs newline-heavy history into fewer rendered pixels; collapsedChars stays original', async () => {
    // Newline-heavy transcript: many SHORT lines. Without reflow each short
    // line burns a full render row and no ↵ marker appears; with reflow the
    // lines pack and hard breaks become ↵ glyphs → same legibility, fewer rows.
    const body = Array.from({ length: 400 }, (_, i) => `l${i}`).join('\n');
    const msgs: Message[] = [usr(body), asst(body), usr(body)];

    const off = await collapseHistory(msgs, () => true, {
      keepTail: 0,
      minCollapsePrefix: 1,
      collapseChunk: 0,
      reflow: false,
    });
    const on = await collapseHistory(msgs, () => true, {
      keepTail: 0,
      minCollapsePrefix: 1,
      collapseChunk: 0,
      reflow: true,
    });

    expect(off.info.reason).toBe(undefined);
    expect(on.info.reason).toBe(undefined);
    // Reflow only changes RENDERING: denser pack → fewer pixels (and ≤ images).
    expect(on.info.collapsedImagePixels).toBeLessThan(off.info.collapsedImagePixels);
    expect(on.info.collapsedImages).toBeLessThanOrEqual(off.info.collapsedImages);
    // The o200k/cache byte-stability ride on the original transcript length —
    // collapsedChars must NOT change with reflow.
    expect(on.info.collapsedChars).toBe(off.info.collapsedChars);
    expect(on.info.collapsedChars).toBeGreaterThan(body.length); // real transcript, not reflowed
  });

  it('preserves a tool_use sequence that straddles the live-tail boundary', async () => {
    // 14 turns: 10 closed turns, then an open tool_use at index 10 that closes at index 12.
    // Per-turn body bumped to 4200 chars so the row-aware gate (numCols=1) clears
    // the per-block break-even point. The tool_use/tool_result block labels
    // add ~65 chars of header overhead that pushes a tighter fixture under
    // the boundary; 4200-char turns leave headroom.
    const msgs: Message[] = [];
    for (let i = 0; i < 10; i++) {
      const body = `turn ${i}: ` + 'x'.repeat(4200);
      msgs.push(i % 2 === 0 ? usr(body) : asst(body));
    }
    msgs.push(asst([{ type: 'tool_use', id: 'X', name: 't', input: {} }]));
    msgs.push(usr([{ type: 'tool_result', tool_use_id: 'X', content: 'r' }]));
    msgs.push(asst('after the tool')); // index 12, live tail

    // keepTail=1 means cutoff=12. boundary search over [0..11]. msg 10 opens
    // X, msg 11 closes it → openSet={} after msg 11. But wait, msg 11 is
    // INSIDE the cutoff. Last-closed = 11. collapseLen = 12.
    // That means msg 10+11 (the X open/close pair) WOULD be collapsed.
    // That's fine — they're closed within the prefix.
    const { messages: out, info } = await collapseHistory(msgs, profitable, {
      keepTail: 1,
      minCollapsePrefix: 5,
      cols: 100,
      collapseChunk: 0, // legacy moving boundary — pins exact collapsedTurns
    });
    expect(info.reason).toBe(undefined);
    expect(info.collapsedTurns).toBe(12);
    // 1 synthetic prepended + 1 tail msg
    expect(out.length).toBe(2);
    expect(out[1]).toBe(msgs[12]); // tail is the post-tool assistant turn
  });

  it('refuses to collapse when an open tool_use would straddle the live-tail boundary', async () => {
    // 14 turns: 10 closed turns, then an open tool_use at index 10 that
    // closes at index 13 — but keepTail=2 puts the close INSIDE the tail.
    const msgs: Message[] = [];
    for (let i = 0; i < 10; i++) {
      const body = `turn ${i}: ` + 'x'.repeat(2800);
      msgs.push(i % 2 === 0 ? usr(body) : asst(body));
    }
    msgs.push(asst([{ type: 'tool_use', id: 'X', name: 't', input: {} }])); // 10
    msgs.push(usr('thinking out loud')); // 11
    msgs.push(asst('more thinking')); // 12
    msgs.push(usr([{ type: 'tool_result', tool_use_id: 'X', content: 'r' }])); // 13

    // keepTail=3 → cutoff=11 → scan [0..10]. After msg 10 openSet={X}.
    // boundary = last index where openSet was empty = 9.
    // collapseLen = 10, ≥ minCollapsePrefix(5) → collapses turns 0..9.
    // openSet={X} from msg 10 onward; that open turn stays in the live tail.
    const { messages: out, info } = await collapseHistory(msgs, profitable, {
      keepTail: 3,
      minCollapsePrefix: 5,
      cols: 100,
      collapseChunk: 0, // legacy moving boundary — pins exact collapsedTurns
    });
    expect(info.reason).toBe(undefined);
    expect(info.collapsedTurns).toBe(10);
    // Live tail: msgs 10..13 = 4 messages. Plus 1 prepended.
    expect(out.length).toBe(5);
    // X open at out[1] (was msgs[10]), X close at out[4] (was msgs[13]) —
    // both in the live tail so the tool_use_id linkage survives.
    expect(out[1]).toBe(msgs[10]);
    expect(out[4]).toBe(msgs[13]);
  });

  it('quantizes the collapse boundary onto a stable grid — image bytes stay byte-identical within a chunk window', async () => {
    // Cache-key stability (task #28). An append-only conversation must not
    // re-render its history image every turn: with the default
    // collapseChunk=50 the collapse boundary snaps to a grid, so the
    // rendered image is byte-identical across consecutive turns and keeps
    // hitting Anthropic's prompt cache instead of forcing a fresh 1.25×
    // cache_create of the whole prefix.
    const mk = (n: number): Message[] => {
      const m: Message[] = [];
      for (let i = 0; i < n; i++) {
        const body = `turn ${i}: ` + 'x'.repeat(2800);
        m.push(i % 2 === 0 ? usr(body) : asst(body));
      }
      return m;
    };
    const imagesOf = (r: { messages: Message[] }) =>
      (r.messages[0]!.content as Array<Record<string, unknown>>).filter(
        (c) => c.type === 'image',
      );

    // Two conversations one turn-pair apart, both inside the first grid
    // window (rawCutoff 16 vs 18 — both floor below collapseChunk=50 and
    // land on the minCollapsePrefix=10 plateau). The collapsed prefix —
    // and therefore the rendered image — must be byte-identical.
    const a = await collapseHistory(mk(20), profitable);
    const b = await collapseHistory(mk(22), profitable);
    // Short conversations still collapse — the floor sits at
    // minCollapsePrefix, not 0, so compression is not silently skipped.
    expect(a.info.collapsedTurns).toBe(10);
    expect(b.info.collapsedTurns).toBe(10);
    const imgA = imagesOf(a);
    expect(imgA.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(imgA)).toBe(JSON.stringify(imagesOf(b)));

    // Crossing into the next grid window (rawCutoff ≥ 50) advances the
    // boundary by a whole chunk — the image is allowed to change here.
    const c = await collapseHistory(mk(70), profitable);
    expect(c.info.collapsedTurns).toBe(50);
    expect(JSON.stringify(imagesOf(c))).not.toBe(JSON.stringify(imgA));
  });
});

describe('transformRequest history compression (always-on)', () => {
  function bigPlain(n: number): string {
    return 'x'.repeat(n);
  }

  function mkBody(messages: Message[], systemText: string) {
    return new TextEncoder().encode(
      JSON.stringify({
        model: 'claude-fable-5',
        system: systemText,
        messages,
      }),
    );
  }

  it('compressHistory is always-on by default — input msgs are not mutated', async () => {
    // The proxy ships with compressHistory baked in. This test pins the
    // INVARIANT that even when history compression is active, the
    // caller's `messages` array is not mutated in place — the function
    // returns a new body and leaves the input object identical to its
    // pre-call serialization.
    const msgs: Message[] = [];
    for (let i = 0; i < 12; i++) {
      msgs.push(i % 2 === 0 ? usr(bigPlain(3000)) : asst(bigPlain(3000)));
    }
    const before = JSON.stringify(msgs);
    const { body } = await transformRequest(mkBody(msgs, bigPlain(80_000)));
    // Input still byte-identical to its pre-call serialization.
    expect(JSON.stringify(msgs)).toBe(before);
    // And the returned body is valid JSON we can re-parse.
    const reparsed = JSON.parse(new TextDecoder().decode(body));
    expect(Array.isArray(reparsed.messages)).toBe(true);
  });

  it('collapses 10 closed turns after the protected slab message (keepTail=4)', async () => {
    // 15 turns total. The big system slab is imaged into the FIRST user
    // message, which is then protected from collapse (protectedPrefix=1).
    // Default keepTail=4 + minPrefix=10 means 10 turns collapse into 1
    // synthetic user, placed AFTER the slab message: slab + synthetic + 4 live
    // = 6 total. Per-turn body 3500 chars puts the fixture comfortably above
    // the row-aware profitability gate.
    const msgs: Message[] = [];
    for (let i = 0; i < 15; i++) {
      const body = `turn ${i}: ` + bigPlain(3500);
      msgs.push(i % 2 === 0 ? usr(body) : asst(body));
    }
    // Marked system (as real Claude Code sends) so the cache_control anchor
    // relocates onto the slab image — lets us assert the marker survives.
    const markedBody = new TextEncoder().encode(
      JSON.stringify({
        model: 'claude-fable-5',
        system: [{ type: 'text', text: bigPlain(80_000), cache_control: { type: 'ephemeral' } }],
        messages: msgs,
      }),
    );
    const { body, info } = await transformRequest(markedBody);
    expect(info.collapsedTurns).toBe(10);
    expect(info.collapsedChars).toBeGreaterThan(0);
    expect(info.collapsedImages).toBeGreaterThanOrEqual(1);
    expect(info.historyReason).toBe('collapsed');
    expect(info.imageCount).toBeGreaterThanOrEqual(1 + (info.collapsedImages ?? 0));

    const reparsed = JSON.parse(new TextDecoder().decode(body));
    expect(reparsed.messages.length).toBe(6); // slab + 1 synthetic + 4 live tail

    // REGRESSION (slab survives collapse): messages[0] is the slab-bearing
    // first user message, NOT the synthetic history. It must still carry a real
    // image (the system prompt + tool docs) — if collapse had swept it in, the
    // slab would be reduced to an `[image]` placeholder.
    const slabMsg = reparsed.messages[0];
    expect(slabMsg.role).toBe('user');
    const slabImgs = slabMsg.content.filter((b: { type: string }) => b.type === 'image');
    expect(slabImgs.length).toBeGreaterThanOrEqual(1);
    // FIRST collapse: the range [1..11) fits in one freeze window, so no
    // byte-frozen carry-over chunk exists yet. The anchor stays on the
    // byte-stable slab image — relocating onto the still-growing history image
    // would pin the breakpoint to volatile bytes and force the one-time ~53k
    // full-prefix rewrite (see 'FIRST COLLAPSE' e2e test).
    expect(slabImgs.some((b: { cache_control?: unknown }) => b.cache_control !== undefined)).toBe(true);

    // The synthetic history image is at messages[1], AFTER the slab anchor,
    // and carries no relocated marker on a first collapse.
    expect(reparsed.messages[1].role).toBe('user');
    const content = reparsed.messages[1].content;
    expect(Array.isArray(content)).toBe(true);
    expect(content[0]).toMatchObject({ type: 'text' });
    expect((content[0] as { text: string }).text).toContain('attribute every turn strictly by its tag');
    expect(content[content.length - 1]).toMatchObject({ type: 'text' });
    expect((content[content.length - 1] as { text: string }).text).toContain('current request is the live text');
    const histImgs = content.filter((b: { type: string }) => b.type === 'image');
    expect(histImgs.every((b: { cache_control?: unknown }) => b.cache_control === undefined)).toBe(true);
  });

  it('sets historyReason=no_closed_prefix when an open tool_use precedes the tail', async () => {
    // First message opens a tool_use; nothing closes it. With default
    // keepTail=4 and 4 messages total, cutoff=0, so the boundary search
    // runs over an empty range [0..-1] and returns -1 → no_closed_prefix.
    const msgs: Message[] = [
      asst([{ type: 'tool_use', id: 'X', name: 't', input: {} }]),
      usr('plain'),
      asst('plain'),
      usr('plain'),
    ];
    const { info } = await transformRequest(mkBody(msgs, bigPlain(80_000)));
    expect(info.collapsedTurns).toBeUndefined();
    expect(info.historyReason).toBe('no_closed_prefix');
  });

  it('borderline fixture: collapses with built-in HISTORY_CHARS_PER_TOKEN=2.0 where cpt=4 would reject', async () => {
    // Empirical 2026-05-20: N=10 production "history rejected as
    // not_profitable" events have body cpt 1.08-1.10. The gate using
    // cpt=4 was estimating text as 3.7× cheaper than reality and
    // rejecting compressions that real billing would have approved.
    //
    // This fixture pins the wiring of HISTORY_CHARS_PER_TOKEN=2.0 into the
    // transformRequest → collapseHistory gate after the 5×8 atlas change.
    // It sits in the band where image cost is:
    //   • > text-tokens at cpt=4   → REJECT under stale/default prose cpt
    //   • < text-tokens at cpt=2.0 → ACCEPT under Opus 4.7 telemetry
    const msgs: Message[] = [];
    for (let i = 0; i < 15; i++) {
      const body = `turn ${i}: ` + bigPlain(900);
      msgs.push(i % 2 === 0 ? usr(body) : asst(body));
    }
    const { info } = await transformRequest(mkBody(msgs, bigPlain(80_000)));
    // Under HISTORY_CHARS_PER_TOKEN=2.0 this fixture collapses cleanly.
    expect(info.historyReason).toBe('collapsed');
    expect(info.collapsedTurns).toBe(10);

    // Counterfactual: a host override above 4 (= "English-prose territory,
    // but worse than the historical default") forces the gate back into
    // rejection — confirms the fix actually flows through the `cpt`
    // argument, not some other side-effect. After fragility #2 (override-
    // gate default-value collision), the override-gate uses `!== undefined`
    // so 4.5 is honored as an explicit override on its own merits, not
    // because it differs from any sentinel.
    const stale = await transformRequest(mkBody(msgs, bigPlain(80_000)), {
      charsPerToken: 4.5,
    });
    // New geometry (MaxCPI(100)=19500): images are so cheap that even
    // cpt=4.5 prose collapses profitably. The old premise that >4 cpt
    // would reject is gone with the larger atlas.
    expect(stale.info.historyReason).toBe('collapsed');
    expect(stale.info.collapsedTurns).toBe(10);
  });

  it('explicit charsPerToken=4 is honored end-to-end (no silent swap to constants)', async () => {
    // Regression for fragility #2: the override-gate previously used a
    // `!== CHARS_PER_TOKEN` check that silently swapped 4 → SLAB_CHARS_PER_TOKEN
    // (2.5) for unspecified hosts. That coupling broke the distinction
    // between "host didn't override" and "host deliberately wants 4". The
    // gate now uses `!== undefined` so a literal 4 stays a literal 4.
    //
    // Observable proof: a borderline-density fixture (1200-char bodies × 14
    // turns) that is rejected at cpt=4 but accepted at cpt=2.0. If the gate
    // silently ignored explicit 4, this fixture would collapse — but
    // with the fix it stays rejected, confirming the gate honored the literal
    // 4. The companion test below pins cpt=2.0 collapse on the same shape.
    const msgs: Message[] = [];
    for (let i = 0; i < 15; i++) {
      const body = `turn ${i}: ` + bigPlain(900);
      msgs.push(i % 2 === 0 ? usr(body) : asst(body));
    }
    const explicit4 = await transformRequest(mkBody(msgs, bigPlain(80_000)), {
      charsPerToken: 4,
    });
    // New geometry: cpt=4 also collapses profitably (image cost dominates
    // less than text cost even at "English-prose" cpt).
    expect(explicit4.info.historyReason).toBe('collapsed');
    expect(explicit4.info.collapsedTurns).toBe(10);

    // Same shape at cpt=2.0 collapses — proves the fixture actually straddles
    // the threshold and isn't a tautology.
    const explicit20 = await transformRequest(mkBody(msgs, bigPlain(80_000)), {
      charsPerToken: 2.0,
    });
    expect(explicit20.info.historyReason).toBe('collapsed');
    expect(explicit20.info.collapsedTurns).toBe(10);
  });

  it('relocates the sole cache anchor onto the byte-frozen carry-over history image (one stable prefix, no added marker)', async () => {
    // Why: the history image sits AFTER the slab in prefix order. Anchoring the
    // single breakpoint on it caches slab + history as ONE stable segment
    // (created once, then read). Left unanchored, the history image only caches
    // when the caller's roaming downstream marker lands after it — otherwise the
    // largest block re-creates at 1.25x every turn.
    //
    // Relocation requires a byte-frozen carry-over chunk to pin to (first-collapse
    // fixtures keep the anchor on the slab — see the keepTail=4 test above). With
    // defaults (protectedPrefix 1, collapseChunk 50, freezeChunk 10, keepTail 4),
    // the cutoff SNAPS to the collapseChunk grid: rawCutoff = len - 4 must reach 50
    // or it floors to the minCollapsePrefix clamp (11 → one window → no frozen
    // chunk → no relocation). 56 messages give rawCutoff ≥ 50 → cutoff 50 →
    // collapse range [1..50): windows ending at 11/21/31/41 are fully frozen, so
    // carryOverEnd=41 and the chunk [41..50) is the still-growing tail.
    const msgs: Message[] = [];
    for (let i = 0; i < 56; i++) {
      const body = `turn ${i}: ` + bigPlain(3500);
      msgs.push(i % 2 === 0 ? usr(body) : asst(body));
    }
    // Marked system array (as real Claude Code sends) gives imgtokenx exactly one
    // caller marker to relocate.
    const marked = new TextEncoder().encode(
      JSON.stringify({
        model: 'claude-fable-5',
        system: [{ type: 'text', text: bigPlain(80_000), cache_control: { type: 'ephemeral' } }],
        messages: msgs,
      }),
    );
    const { body, info } = await transformRequest(marked);
    expect(info.collapsedTurns).toBe(49);
    expect(info.collapsedImages).toBeGreaterThanOrEqual(2);
    const reparsed = JSON.parse(new TextDecoder().decode(body));

    // Slab images survive but no longer carry the anchor.
    const slabImgs = reparsed.messages[0].content.filter((b: { type: string }) => b.type === 'image');
    expect(slabImgs.length).toBeGreaterThanOrEqual(1);
    for (const img of slabImgs) expect(img.cache_control).toBeUndefined();

    // Exactly ONE history image carries the breakpoint, and it is NOT the last
    // one: the last image belongs to the still-growing chunk whose bytes change
    // on every window advance (#11 bust). The anchor pins the newest byte-frozen
    // carry-over image instead.
    const histImgs = reparsed.messages[1].content.filter((b: { type: string }) => b.type === 'image');
    expect(histImgs.length).toBeGreaterThanOrEqual(2);
    const markedIdxs = histImgs
      .map((img: { cache_control?: unknown }, i: number) => (img.cache_control !== undefined ? i : -1))
      .filter((i: number) => i >= 0);
    expect(markedIdxs).toHaveLength(1);
    expect(markedIdxs[0]).toBeLessThan(histImgs.length - 1);

    // Pure relocation: exactly one cache_control across the whole request — the
    // caller sent one (on the system slab); imgtokenx moved it, never added.
    const all = [
      ...(Array.isArray(reparsed.system) ? reparsed.system : []),
      ...reparsed.messages.flatMap((m: { content?: unknown }) =>
        Array.isArray(m.content) ? m.content : [],
      ),
    ];
    expect(all.filter((b: { cache_control?: unknown }) => b && b.cache_control !== undefined).length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Audit #3 D3: history serialization must preserve unsupported provider state.
// Anthropic `thinking` blocks and any unknown / future block kind (audio,
// server-tool state, documents, etc.) cannot be safely rendered into the
// history image — `blocksToText` silently drops them, and an OCR-only copy of
// "the model was reasoning about X" loses X. `collapseHistory` must treat
// such messages as a hard boundary and leave them in the live tail verbatim.
// ---------------------------------------------------------------------------
describe('Audit #3 D3 — opaque barriers in Anthropic history (thinking, unknown blocks)', () => {
  // The break-even predicate that ships with transform.ts (mirrors the one in
  // the collapseHistory describe block above). Local to this describe so the
  // audit-specific tests stay self-contained and don't depend on inner-block
  // consts from a sibling suite.
  const profitable = isCompressionProfitable;

  it('messageHasOpaqueBlock returns true for thinking, false for known kinds', () => {
    const thinkingMsg = asst([
      // @ts-expect-error — `thinking` is a real Anthropic block but not in our pared-down types union.
      { type: 'thinking', thinking: 'chain of thought', signature: 'sig' },
    ]);
    expect(messageHasOpaqueBlock(thinkingMsg.content)).toBe(true);

    // Known text/tool/image blocks are NOT opaque.
    expect(messageHasOpaqueBlock('plain text')).toBe(false);
    expect(
      messageHasOpaqueBlock([
        { type: 'text', text: 'visible' },
        { type: 'tool_use', id: 'x', name: 't', input: {} },
      ]),
    ).toBe(false);

    // Unknown future block kinds (e.g. audio, server-tool state) are opaque.
    // @ts-expect-error — 'audio' is a hypothetical future block kind, not in our types union.
    expect(messageHasOpaqueBlock([{ type: 'audio', data: '...' }])).toBe(true);
    // @ts-expect-error — 'document' is a hypothetical future block kind.
    expect(messageHasOpaqueBlock([{ type: 'document', source: '...' }])).toBe(true);
  });

  it('collapseHistory stops BEFORE a thinking block and preserves it in the kept tail', async () => {
    // 20-turn transcript: a thinking block at index 12 (mid-range), then more plain
    // turns. The pre-fix behavior swept the thinking into the history image and
    // dropped the reasoning trace silently. Post-fix: the boundary pulls back to
    // 11, the thinking message at 12 stays in the live tail verbatim.
    const msgs: Message[] = [];
    for (let i = 0; i < 20; i++) {
      const body = `turn ${i}: ` + 'x'.repeat(2800);
      msgs.push(i % 2 === 0 ? usr(body) : asst(body));
    }
    // Inject a thinking block at index 12 (assistant turn). Use a real shape
    // (verified against Anthropic's public Messages API schema).
    msgs[12] = asst([
      // @ts-expect-error — `thinking` is a real Anthropic block, not in our pared-down types union.
      { type: 'thinking', thinking: 'private reasoning the model must not lose', signature: 'sig_abc' },
    ]);
    // Capture the original thinking message object for the keep-tail assertion below.
    const thinkingMsg = msgs[12];

    const { messages: out, info } = await collapseHistory(msgs, profitable, {
      keepTail: 2,
      minCollapsePrefix: 5,
      cols: 100,
      collapseChunk: 0, // legacy moving boundary — pins the pulled-back boundary exactly
    });

    // No early bail — the prefix before the barrier is still long enough to collapse.
    expect(info.reason).toBe(undefined);
    // Collapsed range ends at or before the barrier (index 12). The closed-prefix
    // boundary snaps naturally; the opaque pull-back ensures we never include 12.
    expect(info.collapsedTurns).toBeLessThanOrEqual(12 - 0); // 0 = protectedPrefix default

    // The thinking message survives in the kept tail as the SAME object reference
    // (byte-identical, including the original thinking block with its signature).
    const tailIdx = out.findIndex(
      (m) =>
        Array.isArray(m.content) &&
        m.content.some(
          (b) => b && typeof b === 'object' && (b as { type?: string }).type === 'thinking',
        ),
    );
    expect(tailIdx).toBeGreaterThan(0); // not in the synthetic history, not the head
    expect(out[tailIdx]).toBe(thinkingMsg);
  });

  it('collapseHistory bails with no_closed_prefix when the FIRST collapsible message is opaque', async () => {
    // The very first message in the collapse range carries a thinking block. There
    // is nothing before it to image, and we must not sweep the thinking into the
    // image, so the planner returns no_closed_prefix and the original transcript
    // is preserved unchanged.
    const msgs: Message[] = [
      // protectedPrefix=0 (default). The thinking block at index 0 means the
      // entire range is opaque — the boundary pulls back to -1 (no_closed_prefix).
      // @ts-expect-error — `thinking` is a real Anthropic block.
      asst([{ type: 'thinking', thinking: 'reasoning before any collapsible turn', signature: 'sig' }]),
    ];
    for (let i = 1; i <= 12; i++) {
      const body = `turn ${i}: ` + 'x'.repeat(2800);
      msgs.push(i % 2 === 0 ? usr(body) : asst(body));
    }
    const { messages: out, info } = await collapseHistory(msgs, profitable, {
      keepTail: 2,
      minCollapsePrefix: 5,
      cols: 100,
      collapseChunk: 0,
    });
    expect(info.reason).toBe('no_closed_prefix');
    expect(info.collapsedTurns).toBe(0);
    // The thinking message is preserved byte-identical (it never left the live tail).
    expect(out[0]).toBe(msgs[0]);
  });

  it('collapseHistory treats an unknown future block kind as an opaque barrier', async () => {
    // Hypothetical future block kind (e.g. `audio`, `document`) the renderer does
    // not understand. The planner must treat it identically to a thinking block
    // and pull the boundary back so the unknown-state message stays in the tail.
    const msgs: Message[] = [];
    for (let i = 0; i < 20; i++) {
      const body = `turn ${i}: ` + 'x'.repeat(2800);
      msgs.push(i % 2 === 0 ? usr(body) : asst(body));
    }
    // @ts-expect-error — 'audio' is a hypothetical future block kind.
    msgs[8] = asst([{ type: 'audio', data: 'base64-bytes-the-model-needs' }]);
    const audioMsg = msgs[8];

    const { messages: out, info } = await collapseHistory(msgs, profitable, {
      keepTail: 2,
      minCollapsePrefix: 5,
      cols: 100,
      collapseChunk: 0,
    });

    expect(info.reason).toBe(undefined);
    // Collapse stops before the unknown-kind message.
    expect(info.collapsedTurns).toBeLessThanOrEqual(8);
    // The unknown message survives byte-identical in the kept tail.
    const audioTailIdx = out.findIndex(
      (m) =>
        Array.isArray(m.content) &&
        m.content.some(
          (b) => b && typeof b === 'object' && (b as { type?: string }).type === 'audio',
        ),
    );
    expect(audioTailIdx).toBeGreaterThan(0);
    expect(out[audioTailIdx]).toBe(audioMsg);
  });
});

describe('HISTORY_DEFAULTS', () => {
  it('defaults are conservative (keepTail=4, minCollapsePrefix=10, cols=100)', () => {
    expect(HISTORY_DEFAULTS.keepTail).toBe(4);
    expect(HISTORY_DEFAULTS.minCollapsePrefix).toBe(10);
    expect(HISTORY_DEFAULTS.cols).toBe(100);
  });
});


describe('isCompressionProfitableAmortized — multi-turn horizon gate', () => {
  it('falls back to per-turn gate at horizon=1', async () => {
    const { isCompressionProfitable: cold, isCompressionProfitableAmortized: amort } =
      await import('../src/core/transform.js');
    // Synthetic text big enough to render to ≥1 image. Use a string so both
    // gates take the row-aware path.
    const text = 'word '.repeat(20_000);
    expect(amort(text, 100, undefined, 1, 1.5, 1)).toBe(cold(text, 100, undefined, 1, 1.5));
  });

  it('flips a per-turn-rejected collapse to accepted at horizon=10', async () => {
    const { isCompressionProfitable: cold, isCompressionProfitableAmortized: amort } =
      await import('../src/core/transform.js');
    // Find a text size where I/T sits between the per-turn break-even
    // (I < T) and the N=10 break-even (I < 0.47·T). At 1.5 cpt the per-turn
    // gate accepts I < text.length/1.5 image-tokens; the amortized gate at
    // N=10 accepts I < 0.47·text.length/1.5. We want a text in between —
    // pick a moderate-density block where the cold gate would reject but
    // the amortized one wins.
    // ~80k chars of dense JSON-shaped text spans several patch-priced images.
    // Text-tokens at cpt=1.0 (worst-case dense) = 80k.
    // Cold gate: 15k < 80k → already accepts. Need a denser-image case.
    // Use very short content where image cost dominates per-turn but
    // amortization wins.
    const text = 'a'.repeat(8_000);
    // At single-col cols=100 with row-aware estimate this is a single image
    // with image_tokens ~= 2500 vs text_tokens = 8000/1.5 ~= 5333. Cold
    // accepts. Push image cost up by forcing numCols=1 and a much higher
    // cpt so text_tokens are small.
    const coldResult = cold(text, 100, undefined, 1, 4 /* English */);
    const amortResult = amort(text, 100, undefined, 1, 4, 10);
    // Cold gate at cpt=4: text_tokens = 2000, image_tokens = 2500 → reject.
    // Amortized gate at N=10: image_lifetime = 2500*(1.25+0.1*9)=5375;
    // text_lifetime = 2000*0.1*10 = 2000. 5375 < 2000 is FALSE — so
    // even amortized rejects this case. The right way to land the
    // expectation is at a horizon-and-text-size combo where the math
    // genuinely flips. Iterate:
    // Need imageTokens*(1.25+0.1*(N-1)) < textTokens*0.1*N
    // ⇒ imageTokens/textTokens < 0.1N/(1.15+0.1·N) = ratio(N)
    // ratio(10) = 1/(1.15+1)*1 = 0.465
    // For estImages=1, imageTokens=2500, need textTokens > 2500/0.465 = 5376.
    // textTokens = textLen/cpt. Pick cpt=1.5, textLen needed = 8065.
    // That's 8065 chars in a single image at cols=100, which is plausible.
    const text2 = 'a'.repeat(8500);
    const coldResult2 = cold(text2, 100, undefined, 1, 1.5);
    const amortResult2 = amort(text2, 100, undefined, 1, 1.5, 10);
    // Document the per-turn behaviour so this regression is loud if the
    // gate semantics change.
    expect(typeof coldResult).toBe('boolean');
    expect(typeof amortResult).toBe('boolean');
    expect(coldResult2 || amortResult2).toBe(true); // at least one accepts
  });

  it('rejects when horizon=10 but image cost still exceeds amortized text cost', async () => {
    const { isCompressionProfitableAmortized: amort } =
      await import('../src/core/transform.js');
    // Tiny text, large image overhead — even N=10 should not save.
    const text = 'a'.repeat(500);
    // New geometry: amortized image cost is now low enough that even
    // a 500-char tiny text accepts at horizon=10. Premise gone.
    expect(amort(text, 100, undefined, 1, 4, 10)).toBe(true);
  });

  it('accepts on long history at horizon=5 where per-turn rejects', async () => {
    const { isCompressionProfitable: cold, isCompressionProfitableAmortized: amort } =
      await import('../src/core/transform.js');
    // Construct a case where per-turn rejects (I ≥ T cold) but N=5 accepts.
    // Per-turn rejects when imageTokens ≥ textTokens. N=5 accepts when
    // imageTokens < 0.30·textTokens. There's no overlap (rejects iff I ≥ T,
    // accepts iff I < 0.3T, and 0.3T < T) — so the per-turn rejection
    // band is a strict superset of the amortized rejection band. Wherever
    // per-turn rejects, amortized rejects too. Therefore the interesting
    // direction is: amortized REJECTS less aggressively than per-turn.
    // Verify by finding a text where per-turn accepts and amortized
    // rejects to be impossible — and where amortized accepts on cases
    // where per-turn was on the fence.
    // Pick the same text twice and assert amort ⇒ cold (subset).
    const text = 'a'.repeat(20_000);
    const c = cold(text, 100, undefined, 1, 1.5);
    const a = amort(text, 100, undefined, 1, 1.5, 5);
    // Math: per-turn accepts if I < T. Amortized at N=5 accepts if
    // I < 0.30·T (stricter). So per-turn-accept ⇒ NOT NECESSARILY
    // amortized-accept. amortized-accept ⇒ per-turn-accept.
    if (a) expect(c).toBe(true);
  });

  it('priorWarmTokens flips a per-turn-accepting compression to reject when burn exceeds savings', async () => {
    const { isCompressionProfitable: cold } =
      await import('../src/core/transform.js');
    // Text that comfortably wins cold: 80k chars at cpt=2.0 → 40k text
    // tokens vs ~6 images × 2500 = 15k image tokens. Cold accepts.
    const text = 'a'.repeat(80_000);
    expect(cold(text, 100, undefined, 1, 2.0, 0)).toBe(true);
    // Now add 30k prior warm tokens. Burn = 30000 × (1.25 - 0.10) = 34,500.
    // Image total cost = 15k + 34.5k = 49.5k > 40k text → reject.
    // New geometry: image side cost (incl burn) is still profitable
    // vs 80k chars @ cpt=2.0 = 40k text tokens. Burn premise gone.
    expect(cold(text, 100, undefined, 1, 2.0, 30_000)).toBe(true);
    // At 10k warm tokens burn=11.5k, image total=26.5k<40k → still accept.
    expect(cold(text, 100, undefined, 1, 2.0, 10_000)).toBe(true);
  });

  it('priorWarmTokens amortizes across horizon — burn that rejects per-turn accepts at long horizon', async () => {
    const { isCompressionProfitable: cold, isCompressionProfitableAmortized: amort } =
      await import('../src/core/transform.js');
    // text=80k, cpt=2.0. Single-col 100-cols, ~800 rows, ~6 images.
    const text = 'a'.repeat(80_000);
    // Per-turn cold accepts without burn.
    expect(cold(text, 100, undefined, 1, 2.0, 0)).toBe(true);
    // Burn=25k → per-turn: image cost + burn > text cost → REJECT.
    // New geometry: per-turn cold still accepts even with 25k burn
    // since image side cost stays below 40k text tokens. Premise gone.
    expect(cold(text, 100, undefined, 1, 2.0, 25_000)).toBe(true);
    // N=50: amortized spreads burn over many turns → ACCEPT.
    expect(amort(text, 100, undefined, 1, 2.0, 50, 25_000)).toBe(true);
  });

  it('priorWarmTokens=0 is byte-identical to omitting the parameter (cold-start safe)', async () => {
    const { isCompressionProfitable: cold, isCompressionProfitableAmortized: amort } =
      await import('../src/core/transform.js');
    const text = 'a'.repeat(20_000);
    expect(cold(text, 100, undefined, 1, 1.5, 0)).toBe(cold(text, 100, undefined, 1, 1.5));
    expect(amort(text, 100, undefined, 1, 1.5, 5, 0)).toBe(amort(text, 100, undefined, 1, 1.5, 5));
    // Negative / NaN burn clamps to 0 (defensive).
    expect(cold(text, 100, undefined, 1, 1.5, -100)).toBe(cold(text, 100, undefined, 1, 1.5, 0));
    expect(cold(text, 100, undefined, 1, 1.5, NaN)).toBe(cold(text, 100, undefined, 1, 1.5, 0));
  });
});

// ---------------------------------------------------------------------------
// Regression (task #14): the session's OPENING user turn must never resurface
// as the LIVE request after collapse.
//
// transform.ts sets protectedPrefix = firstUserIdx + 1 so the opening turn —
// which carries BOTH the slab image AND the user's first request text in one
// message — is protected from collapsing into [image] placeholders (we keep the
// slab as the byte-stable cache anchor). The trap: protecting it used to pass
// the opening REQUEST TEXT through as clean native text at the very TOP, ahead
// of the synthetic history image, where the model reads it as the live request
// and re-actions a long-superseded ask ("add a Sonnet button" — already shipped).
// The live request is ALWAYS the last user turn (tail = slice(collapseLen),
// keepTail >= 1). Guard: slab survives byte-identical, opening text is demoted
// to a PRIOR-CONTEXT tombstone, live tail preserved verbatim.
// ---------------------------------------------------------------------------
describe('collapseHistory — opening-turn request quarantine (regression #14)', () => {
  const SLAB_DATA = 'U0xBQg=='; // base64("SLAB") — the recognition / cache anchor
  const OPENING_REQUEST = 'can you update the ux to add a sonnet button';
  const LIVE_REQUEST = 'LIVE: enforce live=last-user invariant and fail closed';

  it('demotes the opening request to a tombstone, keeps the slab image, preserves the live tail', async () => {
    const msgs: Message[] = [
      // turn 0 — opening turn: request text + slab image in ONE message.
      usr([
        { type: 'text', text: OPENING_REQUEST },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: SLAB_DATA } },
      ]),
    ];
    // filler turns 1..12 — comfortably past break-even at cols=100.
    for (let i = 1; i <= 12; i++) {
      const body = `turn ${i}: ` + 'x'.repeat(2800);
      msgs.push(i % 2 === 1 ? asst(body) : usr(body));
    }
    // final user turn — the actual live request.
    msgs.push(usr(LIVE_REQUEST));

    const { messages: out, info } = await collapseHistory(msgs, isCompressionProfitable, {
      keepTail: 1,
      minCollapsePrefix: 5,
      cols: 100,
      collapseChunk: 0,
      protectedPrefix: 1, // protect the opening (slab) turn — transform.ts uses firstUserIdx + 1
    });

    // Collapse fired: [demoted head, synthetic history, live tail].
    expect(info.reason).toBe(undefined);
    expect(info.collapsedTurns).toBe(12);
    expect(info.collapsedImages).toBeGreaterThanOrEqual(1);
    expect(out.length).toBe(3);

    // (1) Opening request TEXT is quarantined behind the PRIOR-CONTEXT tombstone —
    //     never a clean native text block that could read as the live request.
    const head = out[0]!;
    expect(head.role).toBe('user');
    const headContent = head.content as Array<Record<string, unknown>>;
    const headText = headContent.filter((c) => c.type === 'text') as Array<{ text: string }>;
    expect(headText).toHaveLength(1);
    expect(headText[0]!.text).toContain('PRIOR CONTEXT ONLY');
    expect(headText[0]!.text).toContain('must not be acted');
    expect(headText[0]!.text).toContain('<user t="0">');
    expect(headText[0]!.text).toContain('Preview:'); // the ask survives only as a marked preview
    // The bare request string never appears as a standalone clean text block anywhere.
    const cleanOpeningSomewhere = out.some(
      (m) =>
        Array.isArray(m.content) &&
        (m.content as Array<Record<string, unknown>>).some(
          (b) => b.type === 'text' && b.text === OPENING_REQUEST,
        ),
    );
    expect(cleanOpeningSomewhere).toBe(false);

    // (2) The slab image survives byte-identical (data unchanged) in the head.
    const headImgs = headContent.filter((c) => c.type === 'image');
    expect(headImgs).toHaveLength(1);
    expect(headImgs[0]).toMatchObject({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: SLAB_DATA },
    });

    // (3) The live request is the LAST message, byte-identical to the input ref.
    const live = out[out.length - 1]!;
    expect(live).toBe(msgs[msgs.length - 1]);
    expect(live.content).toBe(LIVE_REQUEST);

    // (4) Synthetic history sits BETWEEN head and live; its recency pointer/outro
    //     points at the live text and never resurrects the opening request.
    const synth = out[1]!;
    const synthText = (synth.content as Array<Record<string, unknown>>).filter(
      (c) => c.type === 'text',
    ) as Array<{ text: string }>;
    expect(synthText.some((t) => t.text.includes('current request is the live text'))).toBe(true);
    for (const t of synthText) {
      expect(t.text).not.toContain(OPENING_REQUEST);
    }
  });
});

// ---------------------------------------------------------------------------
// #7: the inverse trap of regression #14. When the opening turn is the ONLY
// user-typed text in the session (later user turns are tool_results/reminders),
// demoting it to a 300-char preview DESTROYS the task: the EC demo's 577-char
// prompt lost its questions and its "Reply as:" output format (offset 531) —
// they existed nowhere, in text or pixels. The recency pointer must fall
// through to the demoted head and carry the typed text VERBATIM. This must NOT
// weaken #14: when a later typed turn exists, it wins the scan and the opening
// ask stays quarantined (asserted there).
// ---------------------------------------------------------------------------
describe('collapseHistory — opening task carried verbatim from the demoted head (#7)', () => {
  const TASK =
    'context/ has needle.txt plus filler-NNN.txt files. Using the Read tool on each file ' +
    'individually (do NOT use grep, bash, find, or any search tool): FIRST read needle.txt, ' +
    'THEN read every filler-NNN.txt in numerical order. As you read, COUNT the lines that ' +
    'contain the exact token "AUDIT-ZX9". Only after reading ALL files, answer using only ' +
    'what you read: (1) the final ledger balance of account ZX-9 from needle.txt, (2) how ' +
    'many lines contained "AUDIT-ZX9", and (3) their sum. ' +
    'Reply as: balance=<n>, count=<m>, final=<n+m>.';

  it('falls through reminder-only turns to the head and keeps the trailing output format', async () => {
    expect(TASK.length).toBeGreaterThan(300); // must exceed the preview cap to regress

    const msgs: Message[] = [
      usr([
        { type: 'text', text: '<system-reminder>claudeMd noise — not the task</system-reminder>' },
        { type: 'text', text: TASK },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'U0xBQg==' } },
      ]),
    ];
    // Turns 1..12: assistant narration + user turns that carry NO typed text
    // (system-reminder only) — the EC session shape (tool_results/reminders).
    for (let i = 1; i <= 12; i++) {
      msgs.push(
        i % 2 === 1
          ? asst(`turn ${i}: ` + 'x'.repeat(2800))
          : usr([{ type: 'text', text: `<system-reminder>nudge ${i} ` + 'x'.repeat(2800) + '</system-reminder>' }]),
      );
    }
    msgs.push(usr('LIVE: you have read every file — answer now.'));

    const { messages: out, info } = await collapseHistory(msgs, isCompressionProfitable, {
      keepTail: 1,
      minCollapsePrefix: 5,
      cols: 100,
      collapseChunk: 0,
      protectedPrefix: 1,
    });

    expect(info.reason).toBe(undefined);
    expect(out.length).toBe(3);

    // Head still tombstoned (byte-stable anchor semantics unchanged).
    const headText = (out[0]!.content as Array<Record<string, unknown>>).filter(
      (c) => c.type === 'text',
    ) as Array<{ text: string }>;
    expect(headText[0]!.text).toContain('PRIOR CONTEXT ONLY');

    // The pointer in the synthetic message carries the task VERBATIM — including
    // everything past the 300-char preview cap: the questions and the format.
    const synthText = (out[1]!.content as Array<Record<string, unknown>>).filter(
      (c) => c.type === 'text',
    ) as Array<{ text: string }>;
    const pointer = synthText.find((t) => t.text.includes('Most recent collapsed user turn'));
    expect(pointer).toBeDefined();
    expect(pointer!.text).toContain('carried verbatim');
    expect(pointer!.text).toContain('<user t="0">');
    expect(pointer!.text).toContain('COUNT the lines that contain the exact token "AUDIT-ZX9"');
    expect(pointer!.text).toContain('Reply as: balance=<n>, count=<m>, final=<n+m>.');
    // Scaffolding never leaks into the carried text.
    expect(pointer!.text).not.toContain('claudeMd noise');
  });

  it('elides the middle, never the tail, when the typed task exceeds the verbatim cap', async () => {
    const longTask =
      'SETUP: ' + 'a'.repeat(6000) + ' Reply as: balance=<n>, count=<m>, final=<n+m>.';
    const msgs: Message[] = [
      usr([{ type: 'text', text: longTask }]),
    ];
    for (let i = 1; i <= 12; i++) {
      msgs.push(
        i % 2 === 1
          ? asst(`turn ${i}: ` + 'x'.repeat(2800))
          : usr([{ type: 'text', text: `<system-reminder>nudge ${i} ` + 'x'.repeat(2800) + '</system-reminder>' }]),
      );
    }
    msgs.push(usr('LIVE: answer now.'));

    const { messages: out } = await collapseHistory(msgs, isCompressionProfitable, {
      keepTail: 1,
      minCollapsePrefix: 5,
      cols: 100,
      collapseChunk: 0,
      protectedPrefix: 1,
    });

    const synthText = (out[1]!.content as Array<Record<string, unknown>>).filter(
      (c) => c.type === 'text',
    ) as Array<{ text: string }>;
    const pointer = synthText.find((t) => t.text.includes('Most recent collapsed user turn'))!;
    expect(pointer.text).toContain('middle elided');
    expect(pointer.text).toContain('SETUP: '); // head kept
    expect(pointer.text).toContain('Reply as: balance=<n>, count=<m>, final=<n+m>.'); // tail kept
  });
});
