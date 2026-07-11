/**
 * Regression guard for the break-even gate's wide-character row math.
 *
 * The gate must predict the renderer's visual-row count using CELL WIDTH
 * (wide CJK = 2 cells), not UTF-16 code-unit length. Before the fix
 * `countVisualRows` used `line.length`, so a CJK line of N chars that the
 * renderer wraps into 2 rows was counted as 1 row — undercounting the image
 * count, letting the gate approve net-loss images and letting the per-tool
 * image cap fail to fire. See audit finding D-HIGH (CJK gate math).
 */

import { describe, expect, it } from 'vitest';
import { estimateImageCount, LINES_PER_IMAGE } from '../src/core/transform.js';
import { DENSE_CONTENT_COLS, wrapLines } from '../src/core/render.js';

const COLS = 100;

// 80 CJK chars/line = 160 cells at cols=100 → renderer wraps each line into 2 rows.
// Old `line.length` math counted 1 row/line and would have undercounted the images.
const cjkLine = '字'.repeat(80);
const cjkBlock = Array.from({ length: 200 }, () => cjkLine).join('\n');

describe('CJK / wide-char gate parity', () => {
  it('counts wide-char rows by cell width, matching the renderer', () => {
    const trueRows = wrapLines(cjkBlock, COLS).length;
    // 200 lines × 2 rows each = 400 visual rows.
    expect(trueRows).toBe(400);
    // Gate must agree with the renderer's row count.
    expect(estimateImageCount(cjkBlock, COLS)).toBe(Math.ceil(trueRows / LINES_PER_IMAGE));
  });

  it('produces more images than the old code-unit math would (regression)', () => {
    // Naive old behavior: 200 lines, ceil(80/100)=1 row each = 200 rows → 3 images.
    // Correct wide-aware behavior: 400 rows → 5 images.
    const naiveImages = Math.ceil(200 / LINES_PER_IMAGE);
    expect(estimateImageCount(cjkBlock, COLS)).toBeGreaterThan(naiveImages);
  });

  it('matches the renderer for ASCII (no regression on Latin content)', () => {
    const asciiLine = 'x'.repeat(80);
    const asciiBlock = Array.from({ length: 200 }, () => asciiLine).join('\n');
    const trueRows = wrapLines(asciiBlock, COLS).length;
    // 80 code units = 80 cells = 1 row/line → 200 rows (same under both old and new).
    expect(trueRows).toBe(200);
    expect(estimateImageCount(asciiBlock, COLS)).toBe(Math.ceil(trueRows / LINES_PER_IMAGE));
  });

  it('honors the dense slab geometry (DENSE_CONTENT_COLS)', () => {
    const line = '字'.repeat(DENSE_CONTENT_COLS / 2); // exactly cols cells → 1 row at dense cols
    const block = Array.from({ length: (LINES_PER_IMAGE + 1) * 2 }, () => line).join('\n');
    const trueRows = wrapLines(block, DENSE_CONTENT_COLS).length;
    expect(estimateImageCount(block, DENSE_CONTENT_COLS)).toBe(
      Math.ceil(trueRows / LINES_PER_IMAGE),
    );
  });
});
