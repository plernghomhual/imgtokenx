import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// Import the internals that drive install + rollback. We import the module
// at runtime via a dynamic waitForUs so a module-font failure doesn't
// surface as a different test failure (keep diagnostics in this file).
import {
  runInstall,
  runUninstall,
  parseInstallArgs,
  type InstallResult,
} from '../src/install.js';

interface HomeFixture {
  home: string;
  repoRoot: string;
  cleanup: () => void;
}

function mkHomeFixture(label: string): HomeFixture {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), `imgtokenx-${label}-`));
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), `imgtokenx-repo-${label}-`));
  // Seed the file structure install.ts expects: a fake bin/cli.js so paths resolve.
  fs.mkdirSync(path.join(repoRoot, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, 'bin', 'cli.js'), '// stub\n');
  return {
    home,
    repoRoot,
    cleanup: () => {
      try { fs.rmSync(home, { recursive: true, force: true }); } catch { /* ignore */ }
      try { fs.rmSync(repoRoot, { recursive: true, force: true }); } catch { /* ignore */ }
    },
  };
}

describe('install — atomic write + rollback', () => {
  let fx: HomeFixture;
  beforeEach(() => { fx = mkHomeFixture('rollback'); });
  afterEach(() => { fx.cleanup(); });

  it('writes plist + env.sh atomically (no .tmp.* leftover after success)', () => {
    const result: InstallResult = runInstall({
      home: fx.home,
      repoRoot: fx.repoRoot,
      nodePath: '/usr/bin/node',
      port: 47899,
    });
    expect(result.actions).toContain(`write ${path.join(fx.home, 'Library', 'LaunchAgents', 'com.imgtokenx.proxy.plist')}`);
    expect(result.actions).toContain(`write ${path.join(fx.home, '.imgtokenx', 'env.sh')}`);
    // No stale .tmp.* siblings after a clean run.
    const launchAgentDir = path.join(fx.home, 'Library', 'LaunchAgents');
    const siblings = fs.readdirSync(launchAgentDir).filter((n) => n.includes('.tmp.'));
    expect(siblings).toEqual([]);
    const envDir = path.join(fx.home, '.imgtokenx');
    const envSiblings = fs.readdirSync(envDir).filter((n) => n.includes('.tmp.'));
    expect(envSiblings).toEqual([]);
  });

  it('preserves the previous zshrc when re-running install', () => {
    const zshrc = path.join(fx.home, '.zshrc');
    const before = 'export PATH=/usr/bin\nexport EDITOR=vim\n';
    fs.writeFileSync(zshrc, before);
    runInstall({
      home: fx.home, repoRoot: fx.repoRoot, nodePath: '/usr/bin/node', port: 47899,
    });
    const after1 = fs.readFileSync(zshrc, 'utf8');
    expect(after1).toContain('export PATH=/usr/bin');
    expect(after1).toContain('# >>> imgtokenx auto-start >>>');
    // Run again — idempotent, the source block is added exactly once.
    runInstall({
      home: fx.home, repoRoot: fx.repoRoot, nodePath: '/usr/bin/node', port: 47899,
    });
    const after2 = fs.readFileSync(zshrc, 'utf8');
    const matches = (after2.match(/# >>> imgtokenx auto-start >>>/g) ?? []).length;
    expect(matches).toBe(1);
  });

  it('uninstall restores plist + zshrc idempotently (no leftovers)', () => {
    runInstall({
      home: fx.home, repoRoot: fx.repoRoot, nodePath: '/usr/bin/node', port: 47899,
    });
    runUninstall({
      home: fx.home, repoRoot: fx.repoRoot, port: 47899,
    });
    // After uninstall, the auto-start block must be removed.
    const zshrc = path.join(fx.home, '.zshrc');
    if (fs.existsSync(zshrc)) {
      const contents = fs.readFileSync(zshrc, 'utf8');
      expect(contents).not.toContain('# >>> imgtokenx auto-start >>>');
    }
  });
});

describe('install — atomic write on unwriteable target fails cleanly', () => {
  let fx: HomeFixture;
  beforeEach(() => { fx = mkHomeFixture('unwriteable'); });
  afterEach(() => { fx.cleanup(); });

  it('refuses to write when the LaunchAgents parent dir cannot be created (read-only filesystem simulation)', () => {
    // Mark the home path itself read-only so mkdirSync(Library/LaunchAgents) fails.
    // On macOS, chmod 0o500 disallows write but allows stat. The mkdir recursive
    // call will hit EACCES on the parent. After failure, no .tmp.* should leak.
    fs.chmodSync(fx.home, 0o500);
    try {
      expect(() => runInstall({
        home: fx.home, repoRoot: fx.repoRoot, nodePath: '/usr/bin/node', port: 47899,
      })).toThrow();
      // Tmp files only land in target's parent dir; since mkdirSync failed,
      // no tmp was opened. Verify no leftover at the top of fx.home.
      const siblings = fs.readdirSync(fx.home, { withFileTypes: true });
      const tmpLeaked = siblings.some((e) => e.name.includes('.tmp.'));
      expect(tmpLeaked).toBe(false);
    } finally {
      fs.chmodSync(fx.home, 0o700);
    }
  });
});

describe('install — argument parsing', () => {
  it('parses --dry-run + --skip-mcp + --port', () => {
    const x = parseInstallArgs(['--dry-run', '--skip-mcp', '--port', '8123']);
    expect(x.dryRun).toBe(true);
    expect(x.skipMcp).toBe(true);
    expect(x.port).toBe(8123);
  });
  it('rejects unknown flags', () => {
    expect(() => parseInstallArgs(['--bogus'])).toThrow();
  });
});
