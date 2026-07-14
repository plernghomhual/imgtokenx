import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyConfigFileDefaults,
  isRuntimeDisabled,
  persistModelsConfig,
  persistRuntimeEnabled,
} from '../src/node-config.js';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function tempConfig(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imgtokenx-config-'));
  dirs.push(dir);
  return path.join(dir, 'config.json');
}

describe('model config persistence', () => {
  it('reloads dashboard model choices in a fresh process environment', () => {
    const file = tempConfig();
    persistModelsConfig(['claude-fable-5', 'gpt-5.6-sol'], { IMGTOKENX_CONFIG: file });

    const freshEnv = { IMGTOKENX_CONFIG: file };
    applyConfigFileDefaults(freshEnv);

    expect(freshEnv).toEqual({
      IMGTOKENX_CONFIG: file,
      IMGTOKENX_MODELS: 'claude-fable-5,gpt-5.6-sol',
    });
  });

  it('persists an empty scope as off and preserves unrelated config', () => {
    const file = tempConfig();
    fs.writeFileSync(file, '{"other":true}\n');

    persistModelsConfig([], { IMGTOKENX_CONFIG: file });

    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({
      other: true,
      models: 'off',
    });
  });

  it('keeps an explicit environment scope over saved config', () => {
    const file = tempConfig();
    persistModelsConfig(['gpt-5.6-sol'], { IMGTOKENX_CONFIG: file });
    const env = { IMGTOKENX_CONFIG: file, IMGTOKENX_MODELS: 'gpt-5.6-luna' };

    applyConfigFileDefaults(env);

    expect(env.IMGTOKENX_MODELS).toBe('gpt-5.6-luna');
  });

  it('drops the removed generic GPT scope from saved configuration', () => {
    const file = tempConfig();
    fs.writeFileSync(file, '{"models":["gpt-5.6","gpt-5.6-terra"]}\n');
    const env: { IMGTOKENX_CONFIG: string; IMGTOKENX_MODELS?: string } = {
      IMGTOKENX_CONFIG: file,
    };

    applyConfigFileDefaults(env);

    expect(env.IMGTOKENX_MODELS).toBe('gpt-5.6-terra');
    persistModelsConfig(['gpt-5.6'], env);
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).models).toBe('off');
  });

  it('does not overwrite invalid config', () => {
    const file = tempConfig();
    fs.writeFileSync(file, 'not json\n');

    expect(() => persistModelsConfig(['gpt-5.6-luna'], { IMGTOKENX_CONFIG: file })).toThrow();
    expect(fs.readFileSync(file, 'utf8')).toBe('not json\n');
  });
});

describe('global kill switch persistence', () => {
  it('survives process state and clears when re-enabled', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'imgtokenx-disable-'));
    dirs.push(home);
    const env = { HOME: home };

    persistRuntimeEnabled(false, env);
    expect(isRuntimeDisabled({ HOME: home })).toBe(true);

    persistRuntimeEnabled(true, env);
    expect(isRuntimeDisabled({ HOME: home })).toBe(false);
  });
});
