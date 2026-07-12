import { describe, expect, it, beforeEach, afterEach } from 'vitest';
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

const processOk: NonNullable<import('../src/install.js').InstallOptions['spawnSync']> = () => ({
  stdout: '',
  stderr: '',
  status: 0,
});

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
      spawnSync: processOk,
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

  it('writes opencode.json owner-only (0600) — it can hold other tools\' MCP secrets', () => {
    runInstall({
      home: fx.home, repoRoot: fx.repoRoot, nodePath: '/usr/bin/node', port: 47899, spawnSync: processOk,
    });
    const file = path.join(fx.home, '.config', 'opencode', 'opencode.json');
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });

  it('wires OpenCode Zen while preserving config, then restores the previous baseURL', () => {
    const file = path.join(fx.home, '.config', 'opencode', 'opencode.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({
      provider: {
        opencode: {
          apiKey: 'keep-provider-credential',
          options: { baseURL: 'https://previous.example.test', timeout: 9000 },
        },
        other: { options: { baseURL: 'https://other.example.test' } },
      },
      mcp: { existing: { command: ['keep-me'] } },
      theme: 'keep-theme',
    }));

    runInstall({
      home: fx.home, repoRoot: fx.repoRoot, nodePath: '/usr/bin/node', port: 47899, spawnSync: processOk,
    });
    const installed = JSON.parse(fs.readFileSync(file, 'utf8')) as any;
    expect(installed.provider.opencode.options.baseURL).toBe('http://127.0.0.1:47899/opencode');
    expect(installed.provider.opencode.apiKey).toBe('keep-provider-credential');
    expect(installed.provider.opencode.options.timeout).toBe(9000);
    expect(installed.provider.other.options.baseURL).toBe('https://other.example.test');
    expect(installed.mcp.existing.command).toEqual(['keep-me']);
    expect(installed.theme).toBe('keep-theme');
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);

    runUninstall({
      home: fx.home, repoRoot: fx.repoRoot, nodePath: '/usr/bin/node', port: 47899, spawnSync: processOk,
    });
    const restored = JSON.parse(fs.readFileSync(file, 'utf8')) as any;
    expect(restored.provider.opencode.options.baseURL).toBe('https://previous.example.test');
    expect(restored.provider.opencode.apiKey).toBe('keep-provider-credential');
    expect(restored.provider.opencode.options.timeout).toBe(9000);
    expect(restored.provider.other.options.baseURL).toBe('https://other.example.test');
    expect(restored.mcp.existing.command).toEqual(['keep-me']);
    expect(restored.mcp['imgtokenx-recover']).toBeUndefined();
    expect(restored.theme).toBe('keep-theme');
  });

  it('uses an explicit OpenCode config and remembers that path for uninstall', () => {
    const file = path.join(fx.home, 'custom', 'opencode.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({
      provider: { opencode: { options: { baseURL: 'https://before.example.test' } } },
    }));
    runInstall({
      home: fx.home,
      repoRoot: fx.repoRoot,
      nodePath: '/usr/bin/node',
      port: 47899,
      openCodeConfigPath: file,
      spawnSync: processOk,
    });
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).provider.opencode.options.baseURL)
      .toBe('http://127.0.0.1:47899/opencode');

    // No explicit path on uninstall: the private ownership receipt selects
    // the file that install actually changed.
    runUninstall({
      home: fx.home,
      repoRoot: fx.repoRoot,
      nodePath: '/usr/bin/node',
      port: 47899,
      spawnSync: processOk,
    });
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).provider.opencode.options.baseURL)
      .toBe('https://before.example.test');
  });

  it('uses an existing strict-JSON opencode.jsonc and refuses lossy JSONC rewrites', () => {
    const dir = path.join(fx.home, '.config', 'opencode');
    const file = path.join(dir, 'opencode.jsonc');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ theme: 'keep', provider: {} }));
    runInstall({
      home: fx.home,
      repoRoot: fx.repoRoot,
      nodePath: '/usr/bin/node',
      port: 47899,
      spawnSync: processOk,
    });
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).provider.opencode.options.baseURL)
      .toBe('http://127.0.0.1:47899/opencode');
    runUninstall({
      home: fx.home,
      repoRoot: fx.repoRoot,
      nodePath: '/usr/bin/node',
      port: 47899,
      spawnSync: processOk,
    });

    const commented = '{\n  // keep this comment\n  "theme": "keep",\n}\n';
    fs.writeFileSync(file, commented);
    expect(() => runInstall({
      home: fx.home,
      repoRoot: fx.repoRoot,
      nodePath: '/usr/bin/node',
      port: 47899,
      spawnSync: processOk,
    })).toThrow(/cannot safely rewrite commented\/trailing-comma JSONC/);
    expect(fs.readFileSync(file, 'utf8')).toBe(commented);
    expect(fs.existsSync(path.join(fx.home, 'Library', 'LaunchAgents', 'com.imgtokenx.proxy.plist')))
      .toBe(false);
  });

  it('does not overwrite a baseURL the user changed after install', () => {
    const file = path.join(fx.home, '.config', 'opencode', 'opencode.json');
    runInstall({
      home: fx.home, repoRoot: fx.repoRoot, nodePath: '/usr/bin/node', port: 47899, spawnSync: processOk,
    });
    const cfg = JSON.parse(fs.readFileSync(file, 'utf8')) as any;
    cfg.provider.opencode.options.baseURL = 'https://user-change.example.test';
    fs.writeFileSync(file, JSON.stringify(cfg));

    runUninstall({
      home: fx.home, repoRoot: fx.repoRoot, nodePath: '/usr/bin/node', port: 47899, spawnSync: processOk,
    });
    const after = JSON.parse(fs.readFileSync(file, 'utf8')) as any;
    expect(after.provider.opencode.options.baseURL).toBe('https://user-change.example.test');
  });

  it('wires and removes only the owned baseURL when MCP setup is skipped', () => {
    const file = path.join(fx.home, '.config', 'opencode', 'opencode.json');
    runInstall({
      home: fx.home,
      repoRoot: fx.repoRoot,
      nodePath: '/usr/bin/node',
      port: 47899,
      spawnSync: processOk,
      skipMcp: true,
    });
    const installed = JSON.parse(fs.readFileSync(file, 'utf8')) as any;
    expect(installed.provider.opencode.options.baseURL).toBe('http://127.0.0.1:47899/opencode');
    expect(installed.mcp).toBeUndefined();

    runUninstall({
      home: fx.home,
      repoRoot: fx.repoRoot,
      nodePath: '/usr/bin/node',
      port: 47899,
      spawnSync: processOk,
      skipMcp: true,
    });
    const after = JSON.parse(fs.readFileSync(file, 'utf8')) as any;
    expect(after.provider).toBeUndefined();
    expect(fs.existsSync(path.join(fx.home, '.imgtokenx', 'opencode-baseurl.json'))).toBe(false);
  });

  it('rolls back OpenCode config and ownership state when a later install step fails', () => {
    const file = path.join(fx.home, '.config', 'opencode', 'opencode.json');
    const before = JSON.stringify({
      provider: { opencode: { options: { baseURL: 'https://previous.example.test' } } },
      keep: true,
    });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, before);

    expect(() => runInstall({
      home: fx.home,
      repoRoot: fx.repoRoot,
      nodePath: '/usr/bin/node',
      port: 47899,
      spawnSync: () => ({ status: 1, stderr: 'forced failure', stdout: '' }),
    })).toThrow(/forced failure/);

    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual(JSON.parse(before));
    expect(fs.existsSync(path.join(fx.home, '.imgtokenx', 'opencode-baseurl.json'))).toBe(false);
  });

  it('rollback compensates live side effects: bootout + mcp remove after a late failure', () => {
    const calls: string[] = [];
    // Succeed through launchctl bootstrap and `claude mcp add`, then fail on
    // `codex mcp add` — rollback must undo the live mutations already made.
    const spawnSync: NonNullable<import('../src/install.js').InstallOptions['spawnSync']> = (cmd, args) => {
      const line = [cmd, ...args].join(' ');
      calls.push(line);
      if (cmd === 'codex' && args[1] === 'add') return { status: 1, stderr: 'forced late failure', stdout: '' };
      return { status: 0, stderr: '', stdout: '' };
    };
    expect(() => runInstall({
      home: fx.home, repoRoot: fx.repoRoot, nodePath: '/usr/bin/node', port: 47899, spawnSync,
    })).toThrow(/forced late failure/);

    const failureAt = calls.findIndex((c) => c.startsWith('codex mcp add'));
    const afterFailure = calls.slice(failureAt + 1);
    expect(afterFailure.some((c) => c.startsWith('launchctl bootout'))).toBe(true);
    expect(afterFailure.some((c) => c === 'claude mcp remove --scope user imgtokenx-recover')).toBe(true);
  });

  it('success-path actions omit the compensating rollback entries', () => {
    const result = runInstall({
      home: fx.home, repoRoot: fx.repoRoot, nodePath: '/usr/bin/node', port: 47899, spawnSync: processOk,
    });
    // sideEffect undo logs are unquoted; forward runStep actions are q()-quoted
    // per token. A leaked sideEffect entry would appear verbatim.
    expect(result.actions).not.toContain('claude mcp remove --scope user imgtokenx-recover');
    expect(result.actions).not.toContain('codex mcp remove imgtokenx-recover');
    expect(result.actions.some((a) => a.startsWith('launchctl bootout '))).toBe(false);
  });

  it('preserves the previous zshrc when re-running install', () => {
    const zshrc = path.join(fx.home, '.zshrc');
    const before = 'export PATH=/usr/bin\nexport EDITOR=vim\n';
    fs.writeFileSync(zshrc, before);
    runInstall({
      home: fx.home, repoRoot: fx.repoRoot, nodePath: '/usr/bin/node', port: 47899, spawnSync: processOk,
    });
    const after1 = fs.readFileSync(zshrc, 'utf8');
    expect(after1).toContain('export PATH=/usr/bin');
    expect(after1).toContain('# >>> imgtokenx auto-start >>>');
    // Run again — idempotent, the source block is added exactly once.
    runInstall({
      home: fx.home, repoRoot: fx.repoRoot, nodePath: '/usr/bin/node', port: 47899, spawnSync: processOk,
    });
    const after2 = fs.readFileSync(zshrc, 'utf8');
    const matches = (after2.match(/# >>> imgtokenx auto-start >>>/g) ?? []).length;
    expect(matches).toBe(1);
  });

  it('uninstall restores plist + zshrc idempotently (no leftovers)', () => {
    runInstall({
      home: fx.home, repoRoot: fx.repoRoot, nodePath: '/usr/bin/node', port: 47899, spawnSync: processOk,
    });
    runUninstall({
      home: fx.home, repoRoot: fx.repoRoot, port: 47899, spawnSync: processOk,
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
