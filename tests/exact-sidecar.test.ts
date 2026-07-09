import { describe, expect, it } from 'vitest';
import { transformRequest } from '../src/core/transform.js';

const enc = new TextEncoder();
const dec = new TextDecoder();

function makeReq(toolResult: string): Uint8Array {
  return enc.encode(
    JSON.stringify({
      model: 'claude-fable-5',
      system: 'x'.repeat(80_000),
      messages: [
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'toolu_late', content: toolResult },
          ],
        },
      ],
    }),
  );
}

describe('exact sidecar', () => {
  it('keeps late-page tool_result identifiers as text beside rendered images', async () => {
    const latePath = '/late/page/only-visible-after-old-scan-limit.ts';
    const toolResult = 'x '.repeat(140_000) + latePath;

    const { body, info } = await transformRequest(makeReq(toolResult), {
      charsPerToken: 2,
      maxImagesPerToolResult: 20,
      minToolResultChars: 1000,
      multiCol: 1,
    });

    const out = dec.decode(body);
    expect(info.toolResultImgs ?? 0).toBeGreaterThan(0);
    expect(out).toContain(latePath);
    expect(out).toContain('Exact identifiers');
  });

  it('adds recoverable refs when exact recovery is enabled', async () => {
    const marker = '/recover/me/from-sidecar.ts';
    const toolResult = 'x '.repeat(50_000) + marker;

    const { body, info } = await transformRequest(makeReq(toolResult), {
      charsPerToken: 2,
      emitRecoverable: true,
      maxImagesPerToolResult: 20,
      minToolResultChars: 1000,
      multiCol: 1,
    });

    const out = dec.decode(body);
    expect(out).toContain('Recoverable exact source: rec_');
    expect(info.recoverable?.some((r) => r.kind === 'static_slab')).toBe(true);
    expect(info.recoverable?.some((r) => r.kind === 'tool_result' && r.text.includes(marker))).toBe(true);
  });
});
