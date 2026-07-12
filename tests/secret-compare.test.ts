import { describe, expect, it } from 'vitest';
import { secretsMatch, timingSafeEqualStr } from '../src/core/secret-compare.js';

describe('timingSafeEqualStr', () => {
  it('accepts equal strings, including empty strings', () => {
    expect(timingSafeEqualStr('same-secret', 'same-secret')).toBe(true);
    expect(timingSafeEqualStr('', '')).toBe(true);
  });

  it('rejects unequal strings and length mismatches', () => {
    expect(timingSafeEqualStr('same-secret', 'other-secret')).toBe(false);
    expect(timingSafeEqualStr('secret', 'secret-longer')).toBe(false);
    expect(timingSafeEqualStr('', 'non-empty')).toBe(false);
  });
});

describe('secretsMatch', () => {
  it('accepts equal strings after hashing, including empty strings', async () => {
    await expect(secretsMatch('same-secret', 'same-secret')).resolves.toBe(true);
    await expect(secretsMatch('', '')).resolves.toBe(true);
  });

  it('rejects unequal strings and length mismatches after hashing', async () => {
    await expect(secretsMatch('same-secret', 'other-secret')).resolves.toBe(false);
    await expect(secretsMatch('secret', 'secret-longer')).resolves.toBe(false);
    await expect(secretsMatch('', 'non-empty')).resolves.toBe(false);
  });
});
