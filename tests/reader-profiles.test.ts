import { describe, expect, it, afterEach } from 'vitest';
import { resolveReaderProfile, DEFAULT_READER_PROFILE } from '../src/core/reader-profiles.js';
import { transformRequest } from '../src/core/transform.js';

describe('resolveReaderProfile (built-in table)', () => {
  it('claude-fable-5 and gpt-5.6 are safe to image at the bare production cell (no bonus)', () => {
    expect(resolveReaderProfile('claude-fable-5')).toEqual({ safeToImage: true, cellWBonus: 0, cellHBonus: 0 });
    expect(resolveReaderProfile('claude-fable-5-high')).toEqual({ safeToImage: true, cellWBonus: 0, cellHBonus: 0 });
    expect(resolveReaderProfile('gpt-5.6')).toEqual({ safeToImage: true, cellWBonus: 0, cellHBonus: 0 });
  });

  it('keeps the unvalidated GPT 5.6 Sol profile text-only by default', () => {
    expect(resolveReaderProfile('gpt-5.6-sol')).toEqual(DEFAULT_READER_PROFILE);
    expect(resolveReaderProfile('gpt-5.6-sol-codex[1m]')).toEqual(DEFAULT_READER_PROFILE);
  });

  it('claude-opus-4-* gets the measured 20x32 cell bonus (cellWBonus:15, cellHBonus:24)', () => {
    expect(resolveReaderProfile('claude-opus-4-8')).toEqual({ safeToImage: true, cellWBonus: 15, cellHBonus: 24 });
    expect(resolveReaderProfile('claude-opus-4-7')).toEqual({ safeToImage: true, cellWBonus: 15, cellHBonus: 24 });
  });

  it('claude-haiku-4-5 gets the calibrated 20x32 cell (2026-07-10 keyless sweep)', () => {
    const at20x32 = { safeToImage: true, cellWBonus: 15, cellHBonus: 24 };
    expect(resolveReaderProfile('claude-haiku-4-5')).toEqual(at20x32);
    expect(resolveReaderProfile('claude-haiku-4-5-20251001')).toEqual(at20x32);
    // Suffix-alias match must not catch unrelated future ids.
    expect(resolveReaderProfile('claude-haiku-4-50')).toEqual(DEFAULT_READER_PROFILE);
  });

  it('claude-sonnet-5 gets the recalibrated 12x20 cell (2026-07-13 keyless sweep)', () => {
    const at12x20 = { safeToImage: true, cellWBonus: 7, cellHBonus: 12 };
    expect(resolveReaderProfile('claude-sonnet-5')).toEqual(at12x20);
    expect(resolveReaderProfile('claude-sonnet-5-20260315')).toEqual(at12x20);
    // Suffix-alias match must not catch unrelated future ids.
    expect(resolveReaderProfile('claude-sonnet-50')).toEqual(DEFAULT_READER_PROFILE);
  });

  it('strips bracketed variant tags before matching, same as applicability.ts', () => {
    expect(resolveReaderProfile('claude-fable-5[1m]')).toEqual({ safeToImage: true, cellWBonus: 0, cellHBonus: 0 });
    expect(resolveReaderProfile('claude-opus-4-8[1m]')).toEqual({ safeToImage: true, cellWBonus: 15, cellHBonus: 24 });
  });

  it('a bare prefix does not false-match an unrelated model (e.g. claude-fable-50)', () => {
    expect(resolveReaderProfile('claude-fable-50')).toEqual(DEFAULT_READER_PROFILE);
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
    expect(resolveReaderProfile('claude-opus-4-8')).toEqual({ safeToImage: true, cellWBonus: 99, cellHBonus: 99 });
    expect(resolveReaderProfile('claude-opus-4-7')).toEqual({ safeToImage: true, cellWBonus: 1, cellHBonus: 1 });
  });

  it('malformed JSON never throws — silently falls back to the built-in table', () => {
    process.env.IMGTOKENX_READER_PROFILES = '{not valid json';
    expect(() => resolveReaderProfile('claude-fable-5')).not.toThrow();
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

  it('keeps calibrated Opus 20x32 pages within Anthropic\'s 1568px no-resize edge', async () => {
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
    expect(opus.info.imageDims![0]!.width).toBe(1568);
    expect(opus.info.imageDims!.every(({ width, height }) => width <= 1568 && height <= 728)).toBe(true);
    // Larger cells reduce each page to 78x22 characters, so the same source needs more pages.
    expect(opus.info.imageCount).toBeGreaterThan(fable.info.imageCount);
  });
});
