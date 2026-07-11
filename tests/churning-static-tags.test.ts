/**
 * Regression guard for the static-tag churn canary (audit finding D/G).
 *
 * `observeStaticTagChurn` fingerprints each slab tag's content per session and
 * reports any tag whose content changes between turns. Tags that churn silently
 * bust the image cache every turn, so they must be surfaced in `info` rather
 * than hidden behind the hardcoded static-tag lists.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { __resetTagObservations, transformRequest } from '../src/core/transform.js';

const MODEL = 'claude-fable-5';
const FIRST_USER = 'remember-this-stable-session-key-phrase';

function mkBody(staticTag: string): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      model: MODEL,
      system: `lots of stable slab preamble ${'x'.repeat(4000)}\n<changelog>\n${staticTag}\n</changelog>`,
      messages: [{ role: 'user', content: FIRST_USER }],
    }),
  );
}

describe('static-tag churn canary', () => {
  beforeEach(() => __resetTagObservations());

  it('does NOT flag a tag on its first sighting in a session', async () => {
    const { info } = await transformRequest(mkBody('stable content v1'), { compress: true });
    expect(info.churningStaticTags).toBeUndefined();
  });

  it('flags a tag whose content changed within the same session', async () => {
    await transformRequest(mkBody('stable content v1'), { compress: true });
    const { info } = await transformRequest(mkBody('changed content v2'), { compress: true });
    expect(info.churningStaticTags).toContain('changelog');
  });

  it('does NOT flag a tag that stays byte-stable across turns', async () => {
    await transformRequest(mkBody('same content'), { compress: true });
    const { info } = await transformRequest(mkBody('same content'), { compress: true });
    expect(info.churningStaticTags).toBeUndefined();
  });
});
