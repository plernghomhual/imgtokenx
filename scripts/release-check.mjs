#!/usr/bin/env node
// release:check — concise pre-publish verification for `pnpm run release:check`.
// Confirms the basics that commonly go wrong before tagging:
//   1. package.json has a SemVer version field (otherwise `npm version` fails).
//   2. pnpm-lock.yaml is tracked (otherwise CI reinstalls drift).
//   3. The test:restart script is present (the audit's Batch 5 / item #34
//      finding — restart smoke was missing from CI).
//   4. No pnpm-only keys leaked back into .npmrc (audit #36 — npm strict).
//
// Exits non-zero on any failure with a fixable message; exits 0 with one
// confirmation line on success. Intentionally minimal — anything more goes in
// a runbook, not a 22-line shell-out.
import { readFileSync, existsSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const failures = [];

if (!pkg.version || !/^\d+\.\d+\.\d+(?:-[\w.]+)?$/.test(pkg.version)) {
  failures.push('package.json missing or non-SemVer "version" field');
}
if (!existsSync('pnpm-lock.yaml')) {
  failures.push('pnpm-lock.yaml missing — run `pnpm install`');
}
if (!pkg.scripts?.['test:restart']) {
  failures.push('test:restart script missing from package.json (audit #34)');
}

const PnpmOnlyKeys = ['minimum-release-age', 'minimum-release-age-exclude', 'ignore-pnpmfile'];
if (existsSync('.npmrc')) {
  const npmrc = readFileSync('.npmrc', 'utf8');
  for (const key of PnpmOnlyKeys) {
    const re = new RegExp(`^${key}\\s*=`, 'm');
    if (re.test(npmrc)) failures.push(`.npmrc still contains pnpm-only "${key}" — move to .pnpmrc`);
  }
}

if (failures.length > 0) {
  console.error('release:check FAILED:');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`release:check OK: ready to release v${pkg.version}`);
