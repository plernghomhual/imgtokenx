import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export function defaultRecoverableDir(): string {
  return path.join(os.homedir(), '.imgtokenx', 'recovery');
}

export function resolveRecoverableDir(): string | undefined {
  const env = process.env.IMGTOKENX_RECOVERABLE_DIR?.trim();
  if (/^(0|false|off|no)$/i.test(env ?? '')) return undefined;
  return env || defaultRecoverableDir();
}

export function recoverById(dir: string, id: string): string {
  if (!id || !/^rec_[0-9a-f]{8}$/.test(id)) {
    throw new Error('expected a recovery id like rec_1234abcd');
  }
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch (error) {
    throw new Error(`cannot read recovery dir: ${(error as Error).message}`);
  }
  const matches = entries
    .filter((name) => name.endsWith('.txt') && name.includes(`${id}_`))
    .map((name) => {
      const file = path.join(dir, name);
      const stat = fs.statSync(file);
      return { file, mtimeMs: stat.mtimeMs, name };
    })
    .sort((a, b) => a.mtimeMs - b.mtimeMs || a.name.localeCompare(b.name));
  const match = matches[matches.length - 1];
  if (!match) throw new Error(`no recovery source found for ${id}`);
  return fs.readFileSync(match.file, 'utf8');
}
