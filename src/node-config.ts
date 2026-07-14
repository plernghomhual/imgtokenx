import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';

interface ConfigEnv {
  IMGTOKENX_CONFIG?: string;
  IMGTOKENX_MODELS?: string;
}

interface RuntimeEnv {
  HOME?: string;
  IMGTOKENX_DISABLE?: string;
}

export const DEFAULT_CONFIG_FILE = path.join(
  os.homedir(),
  '.config',
  'imgtokenx',
  'config.json',
);

export function runtimeDisableFile(env: RuntimeEnv = process.env): string {
  return path.join(env.HOME?.trim() || os.homedir(), '.imgtokenx', 'disabled');
}

export function isRuntimeDisabled(env: RuntimeEnv = process.env): boolean {
  return /^(1|true|yes|on)$/i.test(env.IMGTOKENX_DISABLE?.trim() ?? '')
    || fs.existsSync(runtimeDisableFile(env));
}

export function persistRuntimeEnabled(
  enabled: boolean,
  env: RuntimeEnv = process.env,
): string {
  const file = runtimeDisableFile(env);
  if (enabled) {
    fs.rmSync(file, { force: true });
  } else {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, 'off\n', { mode: 0o600 });
  }
  return file;
}

function configFile(env: ConfigEnv): string {
  return env.IMGTOKENX_CONFIG ?? DEFAULT_CONFIG_FILE;
}

function normalizeModelsConfig(value: unknown): string | undefined {
  const values = Array.isArray(value)
    ? value.map(String)
    : typeof value === 'string' ? value.split(',') : null;
  if (values === null) return undefined;
  const models = values.map((v) => v.trim()).filter((v) => v && v !== 'gpt-5.6');
  return models.length > 0 ? models.join(',') : 'off';
}

function readConfig(file: string): Record<string, unknown> {
  if (!fs.existsSync(file)) return {};
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`config must contain a JSON object: ${file}`);
  }
  return parsed as Record<string, unknown>;
}

export function applyConfigFileDefaults(
  env: ConfigEnv = process.env,
  warn: (message: string) => void = console.warn,
): void {
  const file = configFile(env);
  if (!fs.existsSync(file)) return;
  let cfg: Record<string, unknown>;
  try {
    cfg = readConfig(file);
  } catch (error) {
    warn(`[imgtokenx] ignored invalid config ${file}: ${(error as Error).message}`);
    return;
  }
  if (env.IMGTOKENX_MODELS === undefined) {
    const models = normalizeModelsConfig(cfg.models);
    if (models !== undefined) env.IMGTOKENX_MODELS = models;
  }
}

export function persistModelsConfig(
  models: readonly string[],
  env: ConfigEnv = process.env,
): string {
  const file = configFile(env);
  const cfg = readConfig(file);
  const normalized = models.map((model) => model.trim()).filter((model) => model && model !== 'gpt-5.6');
  cfg.models = normalized.length > 0 ? normalized : 'off';

  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const temp = path.join(dir, `.${path.basename(file)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temp, `${JSON.stringify(cfg, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    fs.renameSync(temp, file);
  } catch (error) {
    try { fs.unlinkSync(temp); } catch {}
    throw error;
  }
  return file;
}
