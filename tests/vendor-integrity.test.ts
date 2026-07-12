import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { PINS } from '../scripts/vendor-pins.mjs';
import { ALPINE_JS, HTMX_JS } from '../src/dashboard/vendor.js';

const bundles: Record<string, string> = { HTMX_JS, ALPINE_JS };

describe('dashboard vendor integrity', () => {
  it('matches every checked-in bundle to its pinned SHA-256', () => {
    expect(PINS.map((pin) => pin.name)).toEqual(['HTMX_JS', 'ALPINE_JS']);
    for (const pin of PINS) {
      const bundle = bundles[pin.name];
      expect(bundle, `${pin.name} export`).toBeTypeOf('string');
      expect(createHash('sha256').update(bundle!, 'utf8').digest('hex')).toBe(pin.sha256);
    }
  });
});
