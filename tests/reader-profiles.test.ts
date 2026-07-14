import { describe, expect, it, afterEach } from 'vitest';
import { resolveReaderProfile, DEFAULT_READER_PROFILE } from '../src/core/reader-profiles.js';
import { transformRequest } from '../src/core/transform.js';

describe('resolveReaderProfile (built-in table)', () => {
  it('claude-fable-5 is safe to image at the bare production cell (no bonus)', () => {
    expect(resolveReaderProfile('claude-fable-5')).toEqual({ safeToImage: true, cellWBonus: 0, cellHBonus: 0 });
    expect(resolveReaderProfile('claude-fable-5-high')).toEqual({ safeToImage: true, cellWBonus: 0, cellHBonus: 0 });
  });

  it('enables every GPT 5.6 variant at its proxy-validated profile', () => {
    for (const model of [
      'gpt-5.6-sol', 'gpt-5.6-sol-codex[1m]',
      'gpt-5.6-terra', 'gpt-5.6-terra-codex',
      'gpt-5.6-luna', 'gpt-5.6-luna[1m]',
    ]) {
      expect(resolveReaderProfile(model)).toEqual({ safeToImage: true, cellWBonus: 0, cellHBonus: 0 });
    }
  });

  it('claude-opus-4-* gets the recalibrated JetBrains 7x13 cell (2026-07-14 keyless sweep)', () => {
    const at7x13 = { safeToImage: true, cellWBonus: 1, cellHBonus: 2, font: 'jetbrains-mono-10' };
    expect(resolveReaderProfile('claude-opus-4-8')).toEqual(at7x13);
    expect(resolveReaderProfile('claude-opus-4-7')).toEqual(at7x13);
  });

  it('claude-haiku-4-5 gets the recalibrated JetBrains 7x13 cell (2026-07-14 keyless sweep)', () => {
    const at7x13 = { safeToImage: true, cellWBonus: 1, cellHBonus: 2, font: 'jetbrains-mono-10' };
    expect(resolveReaderProfile('claude-haiku-4-5')).toEqual(at7x13);
    expect(resolveReaderProfile('claude-haiku-4-5-20251001')).toEqual(at7x13);
    // Suffix-alias match must not catch unrelated future ids.
    expect(resolveReaderProfile('claude-haiku-4-50')).toEqual(DEFAULT_READER_PROFILE);
  });

  it('claude-sonnet-5 gets the recalibrated bare JetBrains 6x11 cell (2026-07-14 keyless sweep)', () => {
    const at6x11 = { safeToImage: true, cellWBonus: 0, cellHBonus: 0, font: 'jetbrains-mono-10' };
    expect(resolveReaderProfile('claude-sonnet-5')).toEqual(at6x11);
    expect(resolveReaderProfile('claude-sonnet-5-20260315')).toEqual(at6x11);
    // Suffix-alias match must not catch unrelated future ids.
    expect(resolveReaderProfile('claude-sonnet-50')).toEqual(DEFAULT_READER_PROFILE);
  });

  it('strips bracketed variant tags before matching, same as applicability.ts', () => {
    expect(resolveReaderProfile('claude-fable-5[1m]')).toEqual({ safeToImage: true, cellWBonus: 0, cellHBonus: 0 });
    expect(resolveReaderProfile('claude-opus-4-8[1m]')).toEqual({
      safeToImage: true,
      cellWBonus: 1,
      cellHBonus: 2,
      font: 'jetbrains-mono-10',
    });
  });

  it('a bare prefix does not false-match an unrelated model (e.g. claude-fable-50)', () => {
    expect(resolveReaderProfile('claude-fable-50')).toEqual(DEFAULT_READER_PROFILE);
  });

  it('claude-sonnet-4-6 gets the recalibrated JetBrains 7x13 cell (2026-07-14 keyless sweep)', () => {
    const at7x13 = { safeToImage: true, cellWBonus: 1, cellHBonus: 2, font: 'jetbrains-mono-10' };
    expect(resolveReaderProfile('claude-sonnet-4-6')).toEqual(at7x13);
    expect(resolveReaderProfile('claude-sonnet-4-6-20250722')).toEqual(at7x13);
    // Must not catch unrelated future ids.
    expect(resolveReaderProfile('claude-sonnet-4-60')).toEqual(DEFAULT_READER_PROFILE);
  });

  it('unknown/uncalibrated models default to never-image (conservative fallback)', () => {
    expect(resolveReaderProfile('claude-sonnet-4-7')).toEqual(DEFAULT_READER_PROFILE);
    expect(resolveReaderProfile('claude-mythos-5')).toEqual(DEFAULT_READER_PROFILE);
    expect(resolveReaderProfile(null)).toEqual(DEFAULT_READER_PROFILE);
    expect(resolveReaderProfile(undefined)).toEqual(DEFAULT_READER_PROFILE);
  });
});

describe('resolveReaderProfile (IMGTOKENX_READER_PROFILES env override)', () => {
  const prev = process.env.IMGTOKENX_READER_PROFILES;
  afterEach(() => {
    if (prev === undefined) delete process.env.IMGTOKENX_READER_PROFILES;
    else process.env.IMGTOKENX_READER_PROFILES = prev;
  });

  it('opts an unknown model in via env, partial fields falling back to its built-in match', () => {
    process.env.IMGTOKENX_READER_PROFILES = JSON.stringify({ 'claude-mythos-5': { safeToImage: true } });
    expect(resolveReaderProfile('claude-mythos-5')).toEqual({ safeToImage: true, cellWBonus: 0, cellHBonus: 0 });
  });

  it('requires an explicit reader override before enabling Sol imaging', () => {
    process.env.IMGTOKENX_READER_PROFILES = JSON.stringify({
      'gpt-5.6-sol': { safeToImage: true },
    });
    expect(resolveReaderProfile('gpt-5.6-sol-codex')).toEqual({
      safeToImage: true,
      cellWBonus: 0,
      cellHBonus: 0,
    });
  });

  it('longest matching prefix wins', () => {
    process.env.IMGTOKENX_READER_PROFILES = JSON.stringify({
      'claude-opus-4-': { cellWBonus: 1, cellHBonus: 1 },
      'claude-opus-4-8': { cellWBonus: 99, cellHBonus: 99 },
    });
    // Partial overrides omit `font`, which falls back to Opus's built-in (jetbrains-mono-10).
    expect(resolveReaderProfile('claude-opus-4-8')).toEqual({
      safeToImage: true,
      cellWBonus: 99,
      cellHBonus: 99,
      font: 'jetbrains-mono-10',
    });
    expect(resolveReaderProfile('claude-opus-4-7')).toEqual({
      safeToImage: true,
      cellWBonus: 1,
      cellHBonus: 1,
      font: 'jetbrains-mono-10',
    });
  });

  it('malformed JSON never throws — silently falls back to the built-in table', () => {
    process.env.IMGTOKENX_READER_PROFILES = '{not valid json';
    expect(() => resolveReaderProfile('claude-fable-5')).not.toThrow();
    expect(resolveReaderProfile('claude-fable-5')).toEqual({ safeToImage: true, cellWBonus: 0, cellHBonus: 0 });
  });

  it('an explicit font override wins, and an invalid font value falls back to the built-in', () => {
    process.env.IMGTOKENX_READER_PROFILES = JSON.stringify({
      'claude-fable-5': { font: 'jetbrains-mono-10' },
    });
    expect(resolveReaderProfile('claude-fable-5')).toEqual({
      safeToImage: true,
      cellWBonus: 0,
      cellHBonus: 0,
      font: 'jetbrains-mono-10',
    });

    process.env.IMGTOKENX_READER_PROFILES = JSON.stringify({
      'claude-fable-5': { font: 'not-a-real-font' },
    });
    // Fable's built-in has no font (Spleen base) — an invalid override value falls back to that.
    expect(resolveReaderProfile('claude-fable-5')).toEqual({ safeToImage: true, cellWBonus: 0, cellHBonus: 0 });
  });
});

describe('transformRequest reader-profile gate (integration)', () => {
  it('uncalibrated model: full text passthrough, zero images, reader_profile_unsafe reason + counter', async () => {
    const raw = JSON.stringify({
      model: 'claude-sonnet-4-7',
      system: 'x'.repeat(150_000),
      messages: [{ role: 'user', content: 'hi' }],
    });
    const bytes = new TextEncoder().encode(raw);
    const { body, info } = await transformRequest(bytes);
    expect(info.compressed).toBe(false);
    expect(info.reason).toBe('reader_profile_unsafe');
    expect(info.passthroughReasons?.reader_profile_unsafe).toBe(1);
    expect(info.outgoingTextChars).toBeGreaterThan(0);
    // Passthrough returns the original body byte-for-byte — no image blocks anywhere.
    expect(body).toBe(bytes);
    const out = JSON.parse(new TextDecoder().decode(body));
    const hasImage = (out.messages ?? []).some(
      (m: any) => Array.isArray(m.content) && m.content.some((c: any) => c?.type === 'image'),
    );
    expect(hasImage).toBe(false);
  });

  it('keeps calibrated Opus JetBrains 7x13 pages within Anthropic\'s 1568px no-resize edge', async () => {
    const system = 'x'.repeat(150_000);
    const reqFor = (model: string) => new TextEncoder().encode(JSON.stringify({
      model,
      system,
      messages: [{ role: 'user', content: 'hi' }],
    }));
    const FORCE = { charsPerToken: 1, minCompressChars: 1 };
    const fable = await transformRequest(reqFor('claude-fable-5'), FORCE);
    const opus = await transformRequest(reqFor('claude-opus-4-8'), FORCE);
    expect(fable.info.compressed).toBe(true);
    expect(opus.info.compressed).toBe(true);
    expect(fable.info.imageDims?.[0]?.width).toBeDefined();
    expect(opus.info.imageDims?.[0]?.width).toBeDefined();
    expect(fable.info.imageDims![0]!.width).toBe(1568);
    // JetBrains's 7px cell width doesn't divide the 1568px edge exactly (Spleen's
    // 12px cell does) — the invariant that matters is staying under the no-resize
    // edge, not landing on it exactly.
    expect(opus.info.imageDims!.every(({ width, height }) => width <= 1568 && height <= 728)).toBe(true);
    // Larger cells reduce each page's character grid, so the same source needs more pages.
    expect(opus.info.imageCount).toBeGreaterThan(fable.info.imageCount);
  });

  it('keeps calibrated Sonnet-5 bare JetBrains 6x11 pages within the same 1568px edge', async () => {
    const system = 'x'.repeat(150_000);
    const req = new TextEncoder().encode(JSON.stringify({
      model: 'claude-sonnet-5',
      system,
      messages: [{ role: 'user', content: 'hi' }],
    }));
    const FORCE = { charsPerToken: 1, minCompressChars: 1 };
    const sonnet5 = await transformRequest(req, FORCE);
    expect(sonnet5.info.compressed).toBe(true);
    expect(sonnet5.info.imageDims?.[0]?.width).toBeDefined();
    expect(sonnet5.info.imageDims!.every(({ width, height }) => width <= 1568 && height <= 728)).toBe(true);
  });
});
