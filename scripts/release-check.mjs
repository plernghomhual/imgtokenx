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

// dist/ must be built — this script previously passed on an EMPTY dist/,
// blessing a tarball whose exports map points at nothing. Walk the exports
// map itself so every promised subpath (import + types) exists on disk;
// a new export added to package.json is covered automatically.
if (!pkg.exports || typeof pkg.exports !== 'object' || Object.keys(pkg.exports).length === 0) {
  failures.push('package.json "exports" map missing — dist artifacts cannot be verified');
}
for (const [subpath, entry] of Object.entries(pkg.exports ?? {})) {
  for (const kind of ['import', 'types']) {
    const rel = entry?.[kind];
    if (typeof rel !== 'string') {
      failures.push(`exports["${subpath}"] missing "${kind}" target`);
    } else if (!existsSync(rel)) {
      failures.push(`exports["${subpath}"].${kind} → ${rel} missing — run \`pnpm run build\` first`);
    }
  }
}

const PnpmOnlyKeys = ['minimum-release-age', 'minimum-release-age-exclude', 'ignore-pnpmfile'];
if (existsSync('.npmrc')) {
  const npmrc = readFileSync('.npmrc', 'utf8');
  for (const key of PnpmOnlyKeys) {
    const re = new RegExp(`^${key}\\s*=`, 'm');
    if (re.test(npmrc)) failures.push(`.npmrc still contains pnpm-only "${key}" — move to pnpm-workspace.yaml`);
  }
}

if (failures.length > 0) {
  console.error('release:check FAILED:');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`release:check OK: ready to release v${pkg.version}`);
