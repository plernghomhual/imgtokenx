import { describe, expect, it } from 'vitest';
import { extractFactSheetEntriesAllPages } from '../src/core/factsheet.js';
import { DENSE_CONTENT_CHARS_PER_IMAGE } from '../src/core/render.js';
import { transformRequest } from '../src/core/transform.js';

const enc = new TextEncoder();
const dec = new TextDecoder();

const EXACT_FIXTURES = [
  '/repo/src/exact/NeedleRecall_9271.ts',
  '9d121ac5e77fb71',
  '550e8400-e29b-41d4-a716-446655440000',
  'AUDIT-ZX9-4821',
  'RequestTraceIDAlphaBetaGamma',
  '"ExactRecall-String_9271"',
  'EXAMPLE_SETTING=EXAMPLE_VALUE_123456',
] as const;

function makeReq(toolResult: string): Uint8Array {
  return enc.encode(
    JSON.stringify({
      model: 'claude-fable-5',
      max_tokens: 1,
      system: 'x'.repeat(80_000),
      messages: [
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'toolu_exact_eval', content: toolResult },
          ],
        },
      ],
    }),
  );
}

function collectTextValues(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectTextValues(item, out);
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectTextValues(item, out);
  }
  return out;
}

describe('exact recall eval fixtures', () => {
  it('extracts every adversarial exact-risk class into the complete factsheet', () => {
    const source = [
      'Exact recall fixtures. These values must be quoted byte-for-byte.',
      ...EXACT_FIXTURES,
    ].join('\n');
    const tokens = extractFactSheetEntriesAllPages(
      source,
      DENSE_CONTENT_CHARS_PER_IMAGE,
      Number.POSITIVE_INFINITY,
    ).kept.map((e) => e.token);

    for (const expected of EXACT_FIXTURES) {
      expect(tokens).toContain(expected);
    }
  });

  it('keeps late-page exact fixtures as text beside rendered tool_result images', async () => {
    const toolResult = 'noise '.repeat(60_000) + '\n' + EXACT_FIXTURES.join('\n');
    const { body, info } = await transformRequest(makeReq(toolResult), {
      charsPerToken: 2,
      maxImagesPerToolResult: 20,
      minToolResultChars: 1000,
      multiCol: 1,
    });

    const text = collectTextValues(JSON.parse(dec.decode(body))).join('\n');
    expect(info.toolResultImgs ?? 0).toBeGreaterThan(0);
    expect(info.factSheetItems ?? 0).toBeGreaterThanOrEqual(EXACT_FIXTURES.length);
    expect(info.factSheetChars ?? 0).toBeGreaterThan(0);
    for (const expected of EXACT_FIXTURES) {
      expect(text).toContain(expected);
    }
  });

  it('losslessExact keeps exact-risk tool_result text when recovery is unavailable', async () => {
    const toolResult = 'noise '.repeat(60_000) + '\n' + EXACT_FIXTURES.join('\n');
    const { body, info } = await transformRequest(makeReq(toolResult), {
      charsPerToken: 2,
      losslessExact: true,
      maxImagesPerToolResult: 20,
      minToolResultChars: 1000,
      multiCol: 1,
    });

    const parsed = JSON.parse(dec.decode(body));
    const toolResults = collectTextValues(parsed.messages);
    expect(toolResults).toContain(toolResult);
    expect(info.losslessExactKept ?? 0).toBeGreaterThan(0);
    expect(info.losslessExactChars ?? 0).toBeGreaterThan(0);
    expect(info.passthroughReasons?.lossless_exact ?? 0).toBeGreaterThan(0);
  });

  it('losslessExact still allows imaging when recoverable refs are enabled', async () => {
    const toolResult = 'noise '.repeat(60_000) + '\n' + EXACT_FIXTURES.join('\n');
    const { body, info } = await transformRequest(makeReq(toolResult), {
      charsPerToken: 2,
      emitRecoverable: true,
      losslessExact: true,
      maxImagesPerToolResult: 20,
      minToolResultChars: 1000,
      multiCol: 1,
    });

    const out = dec.decode(body);
    expect(info.toolResultImgs ?? 0).toBeGreaterThan(0);
    expect(info.recoverableRefs ?? 0).toBeGreaterThan(0);
    expect(info.losslessExactKept ?? 0).toBe(0);
    expect(out).toContain('Recoverable exact source: rec_');
  });
});
