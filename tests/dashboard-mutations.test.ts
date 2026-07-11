import { describe, it, expect } from 'vitest';
import {
  BadPayloadError,
  MODEL_ID_MAX,
  badRequest,
  parseModelsPayload,
  parseTogglePayload,
  validateModelId,
} from '../src/dashboard-mutations.js';

describe('parseTogglePayload', () => {
  it('accepts { enabled: true }', () => {
    expect(parseTogglePayload('{"enabled":true}')).toEqual({ enabled: true });
  });
  it('accepts { enabled: false }', () => {
    expect(parseTogglePayload('{"enabled":false}')).toEqual({ enabled: false });
  });
  it('rejects string-typed enabled (no coercion)', () => {
    expect(() => parseTogglePayload('{"enabled":"true"}'))
      .toThrow(BadPayloadError);
    expect(() => parseTogglePayload('{"enabled":"true"}'))
      .toThrow(/must be boolean/);
  });
  it('rejects numeric enabled (no coercion)', () => {
    expect(() => parseTogglePayload('{"enabled":1}')).toThrow(BadPayloadError);
    expect(() => parseTogglePayload('{"enabled":0}')).toThrow(BadPayloadError);
  });
  it('rejects missing enabled', () => {
    expect(() => parseTogglePayload('{}')).toThrow(BadPayloadError);
  });
  it('rejects JSON null', () => {
    expect(() => parseTogglePayload('null')).toThrow(BadPayloadError);
  });
  it('rejects JSON array', () => {
    expect(() => parseTogglePayload('[{"enabled":true}]'))
      .toThrow(BadPayloadError);
  });
  it('rejects JSON string', () => {
    expect(() => parseTogglePayload('"enabled:true"'))
      .toThrow(BadPayloadError);
  });
  it('rejects garbage (non-JSON)', () => {
    expect(() => parseTogglePayload('not json')).toThrow(BadPayloadError);
    expect(() => parseTogglePayload('enabled=true')).toThrow(BadPayloadError);
  });
  it('accepts unrelated extra keys (forward-compat)', () => {
    // We don't pin the schema to a closed shape — additions are allowed.
    expect(parseTogglePayload('{"enabled":true,"debug":1}'))
      .toEqual({ enabled: true });
  });
});

describe('parseModelsPayload', () => {
  it('accepts { model: "claude-fable-5", on: true }', () => {
    expect(parseModelsPayload('{"model":"claude-fable-5","on":true}'))
      .toEqual({ model: 'claude-fable-5', on: true });
  });
  it('accepts { model: "gpt-5.6-sol", on: false }', () => {
    expect(parseModelsPayload('{"model":"gpt-5.6-sol","on":false}'))
      .toEqual({ model: 'gpt-5.6-sol', on: false });
  });
  it('rejects string-typed on (no coercion)', () => {
    expect(() => parseModelsPayload('{"model":"claude-fable-5","on":"true"}'))
      .toThrow(/`on` must be boolean/);
  });
  it('rejects numeric on', () => {
    expect(() => parseModelsPayload('{"model":"claude-fable-5","on":1}'))
      .toThrow(/`on` must be boolean/);
  });
  it('rejects missing on', () => {
    expect(() => parseModelsPayload('{"model":"claude-fable-5"}'))
      .toThrow(/`on` must be boolean/);
  });
  it('rejects missing model', () => {
    expect(() => parseModelsPayload('{"on":true}')).toThrow(/`model` must be a string/);
  });
  it('rejects numeric model', () => {
    expect(() => parseModelsPayload('{"model":123,"on":true}'))
      .toThrow(/`model` must be a string/);
  });
  it('passes through validateModelId for invalid charset', () => {
    expect(() => parseModelsPayload('{"model":"./etc/passwd","on":true}'))
      .toThrow(/model id must match/);
    expect(() => parseModelsPayload('{"model":"rm -rf","on":true}'))
      .toThrow(/model id must match/);
    expect(() => parseModelsPayload('{"model":"$(curl evil)","on":true}'))
      .toThrow(/model id must match/);
  });
  it('passes through validateModelId for invalid length', () => {
    const tooLong = 'a'.repeat(MODEL_ID_MAX + 1);
    expect(() => parseModelsPayload(`{"model":"${tooLong}","on":true}`))
      .toThrow(/1-\d+ chars/);
    expect(() => parseModelsPayload('{"model":"","on":true}'))
      .toThrow(/1-\d+ chars/);
  });
  it('rejects garbage (non-JSON) format', () => {
    expect(() => parseModelsPayload('model=claude-fable-5&on=true'))
      .toThrow(BadPayloadError);
  });
});

describe('validateModelId', () => {
  it('accepts valid ids', () => {
    for (const id of [
      'claude-fable-5',
      'claude-fable-5-sonnet',
      'gpt-5.6-sol',
      'gpt-5',
      'a',
      'a1',
      'model.test',
      'model_name',
    ]) {
      expect(validateModelId(id)).toBe(id);
    }
  });
  it('rejects leading dot / dash / underscore', () => {
    expect(() => validateModelId('.foo')).toThrow(BadPayloadError);
    expect(() => validateModelId('-foo')).toThrow(BadPayloadError);
    expect(() => validateModelId('_foo')).toThrow(BadPayloadError);
  });
  it('rejects spaces and shell metacharacters', () => {
    expect(() => validateModelId('foo bar')).toThrow(BadPayloadError);
    expect(() => validateModelId('foo$bar')).toThrow(BadPayloadError);
    expect(() => validateModelId('foo&bar')).toThrow(BadPayloadError);
    expect(() => validateModelId('foo|bar')).toThrow(BadPayloadError);
    expect(() => validateModelId('foo\\bar')).toThrow(BadPayloadError);
    expect(() => validateModelId('foo/bar')).toThrow(BadPayloadError);
    expect(() => validateModelId('foo`bar')).toThrow(BadPayloadError);
  });
  it('rejects bracket [variant] tags in mutation inputs', () => {
    // applicability.ts strips these at request-time; persistence keeps base ids.
    expect(() => validateModelId('claude-fable-5[1m]')).toThrow(BadPayloadError);
    expect(() => validateModelId('foo[bar]')).toThrow(BadPayloadError);
  });
  it('rejects non-string input', () => {
    expect(() => validateModelId(123)).toThrow(/must be a string/);
    expect(() => validateModelId(null)).toThrow(/must be a string/);
    expect(() => validateModelId(undefined)).toThrow(/must be a string/);
    expect(() => validateModelId(true)).toThrow(/must be a string/);
  });
  it('enforces 1-MODEL_ID_MAX length', () => {
    expect(MODEL_ID_MAX).toBe(80);
    const max = 'a'.repeat(MODEL_ID_MAX);
    expect(validateModelId(max)).toBe(max);
    expect(() => validateModelId('a'.repeat(MODEL_ID_MAX + 1))).toThrow(BadPayloadError);
  });
});

describe('badRequest envelope', () => {
  it('returns 400 with a JSON envelope for BadPayloadError', async () => {
    let err: Error;
    try { parseTogglePayload('not json'); }
    catch (e) { err = e as Error; }
    const res = badRequest(err!);
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toBe('application/json');
    const body = await res.json() as { error: string; detail: string };
    expect(body.error).toBe('bad request');
    expect(body.detail).toMatch(/JSON/);
  });
  it('re-throws non-BadPayloadError so the caller can map to 5xx', () => {
    // Persistence failures (disk full, EACCES, the .tmp rename race in
    // persistModelsConfig) MUST NOT be classified as 'bad request' — the
    // outer server handler should still emit a 500. badRequest() is the
    // narrow contract: only validation errors become 400.
    expect(() => badRequest(new Error('disk full'))).toThrow(/disk full/);
    expect(() => badRequest(new Error('disk full'))).toThrow(Error);
    expect(() => badRequest('just a string')).toThrow(/just a string/);
    expect(() => badRequest(null)).toThrow();
  });
});
