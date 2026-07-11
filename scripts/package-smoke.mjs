#!/usr/bin/env node
import { mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const dir = mkdtempSync(join(tmpdir(), 'imgtokenx-pack-'));
/** @param {string} cmd @param {string[]} args @param {string} [cwd] */
const run = (cmd, args, cwd = root) => {
  const out = spawnSync(cmd, args, { cwd, encoding: 'utf8', env: { ...process.env, npm_config_cache: join(dir, 'cache') } });
  if (out.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed:\n${out.stderr || out.stdout}`);
  return out.stdout.trim();
};

try {
  const packed = JSON.parse(run('npm', ['pack', '--json', '--pack-destination', dir]));
  const entry = packed[0];
  if (!entry?.filename || entry.size > 8_000_000) throw new Error(`unexpected packed artifact: ${JSON.stringify(entry)}`);
  run('tar', ['-xzf', join(dir, entry.filename), '-C', dir]);
  const app = join(dir, 'app');
  const modules = join(app, 'node_modules');
  mkdirSync(modules, { recursive: true });
  writeFileSync(join(app, 'package.json'), '{"type":"module"}\n');
  renameSync(join(dir, 'package'), join(modules, 'imgtokenx'));
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  for (const name of Object.keys(pkg.dependencies ?? {})) {
    const target = join(modules, name);
    mkdirSync(join(target, '..'), { recursive: true });
    symlinkSync(join(root, 'node_modules', name), target, 'dir');
  }
  run(process.execPath, ['--input-type=module', '-e', "await import('imgtokenx'); await import('imgtokenx/transform'); await import('imgtokenx/proxy')"], app);
  const version = run(process.execPath, [join(app, 'node_modules', 'imgtokenx', 'bin', 'cli.js'), '--version'], app);
  const expected = run(process.execPath, ['-p', "require('./package.json').version"]);
  if (version !== expected) throw new Error(`packed CLI version ${version} != ${expected}`);
  console.log(`package smoke OK: ${entry.filename} (${entry.size} bytes), exports + bin`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
