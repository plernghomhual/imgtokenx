// Build library ESM + declarations with tsc, then overwrite the Node CLI
// entry with a bundled executable. The Worker target can still be built by
// wrangler directly from src/worker.ts, but dist/worker.js is also emitted for
// package consumers via tsc.
import { build } from 'esbuild';
import { mkdir, rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

// Single source of truth for the CLI version: read it here, inline it into the
// bundle via esbuild `define`. Reading npm_package_version at CLI *runtime* is
// unreliable (unset for global bins / npx, or the consumer's version), so the
// value is fixed at build time instead.
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

const OUT = 'dist';
const tscBin = process.platform === 'win32' ? 'tsc.cmd' : 'tsc';

// Probe the toolchain BEFORE wiping dist/: a tsc missing from PATH used to
// surface as a mute `exit 1` (spawnSync ENOENT leaves status null and .error
// was never checked) with dist/ already emptied.
const probe = spawnSync(tscBin, ['--version'], { encoding: 'utf8', shell: false });
if (probe.error || probe.status !== 0) {
  console.error(
    `✗ cannot run '${tscBin}': ${probe.error ? probe.error.message : `exit ${probe.status}`}\n` +
      `  hint: run via \`pnpm run build\` so node_modules/.bin is on PATH`,
  );
  process.exit(1);
}

if (existsSync(OUT)) await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

const tsc = spawnSync(tscBin, ['-p', 'tsconfig.json'], {
  stdio: 'inherit',
  shell: false,
});
if (tsc.error) {
  console.error(`✗ tsc failed to spawn: ${tsc.error.message}`);
  process.exit(1);
}
if (tsc.status !== 0) process.exit(tsc.status ?? 1);
console.log('✓ emitted dist/ library modules + declarations');

await build({
  entryPoints: ['src/node.ts'],
  outfile: 'dist/node.js',
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'esm',
  sourcemap: true,
  // Inline the package version so `imgtokenx --version` is correct for global/npx
  // installs (see the note where `pkg` is read). esbuild replaces the bare
  // identifier with the string literal at every reference.
  define: {
    __IMGTOKENX_VERSION__: JSON.stringify(pkg.version),
    __IMGTOKENX_BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  // No external assets: atlases are base64 strings in TS modules. But those
  // four modules total ~4.8 MB and ALREADY ship unbundled in dist/core/ for
  // the library exports — inlining them again doubled the atlas payload in
  // the tarball. Externalize them and import the dist/core copies at runtime
  // (both files live in the same published package, so the relative import
  // from dist/node.js always resolves).
  external: [],
  plugins: [
    {
      name: 'atlas-dedup',
      setup(b) {
        b.onResolve({ filter: /^\.\/atlas[a-z0-9-]*\.js$/ }, (args) => ({
          path: args.path.replace('./', './core/'),
          external: true,
        }));
      },
    },
  ],
  banner: { js: '#!/usr/bin/env node' },
});

console.log('✓ built dist/node.js');

// Smoke check: the bundled CLI must report the real package version, not a
// stale fallback. Runs the shipped artifact end-to-end and fails the build on
// mismatch, so a broken version injection can never reach a release.
const smoke = spawnSync(process.execPath, ['dist/node.js', '--version'], { encoding: 'utf8' });
const printedVersion = (smoke.stdout ?? '').trim();
if (smoke.status !== 0 || printedVersion !== pkg.version) {
  console.error(
    `✗ version smoke check failed: 'node dist/node.js --version' printed ` +
      `${JSON.stringify(printedVersion)} (exit ${smoke.status}), expected ${JSON.stringify(pkg.version)}`,
  );
  process.exit(1);
}
console.log(`✓ version smoke check: --version prints ${pkg.version}`);
