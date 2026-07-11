/** Tests for the roll-back path in runInstall/runUninstall. We mock
 *  child_process.spawnSync so the launchctl step throws AFTER the plist +
 *  env.sh were already written but BEFORE zshrc was updated — exactly the
 *  scenario the audit D20 finding names ("writes half-completed and leaves
 *  the system in an inconsistent state"). After runInstall throws, the
 *  revert stack must have removed plist + env.sh (no rollback target existed
 *  on first install) and the original error must surface.
 *
 * Mock design: vitest hoists `vi.mock(mod, factory)` to the TOP of the file
 * at parse time. With SEVERAL vi.mock calls on the same module, only the
 * LAST factory wins (it replaces previous registrations). So we use ONE
 * vi.mock at module top with a flag-controlled factory. The flag `failMode`
 * is at MODULE scope so the hoisted factory can close over it.
 */
// Module-scope state, declared BEFORE vi.mock so the hoisted factory
// closure captures it correctly.
type FailMode =
  | 'install-bootstrap'
  | 'uninstall-claude-remove'
  | 'install-enoent-claude'
  | 'install-eacces-launchctl'
  | 'none';
let failMode: FailMode = 'none';

const FAIL_PATTERNS: Record<Exclude<FailMode, 'none'>, (cmd: string, args: string[]) => boolean> = {
  'install-bootstrap': (cmd, args) =>
    cmd === 'launchctl' && args[0] === 'bootstrap',
  'uninstall-claude-remove': (cmd, args) =>
    cmd === 'claude' && args[0] === 'mcp' && args[1] === 'remove',
  // Pin the new ENOENT-tolerant + EACCES-loud runStep semantics. ENOENT on
  // `claude mcp add` is what a real operator sees when claude isn't
  // installed; EACCES is what a misconfigured system sees when launchctl
  // itself isn't launchable (e.g. permission flip on /bin/launchctl).
  'install-enoent-claude': (cmd, args) =>
    cmd === 'claude' && args[0] === 'mcp' && args[1] === 'add',
  'install-eacces-launchctl': (cmd, args) =>
    cmd === 'launchctl' && args[0] === 'bootstrap',
};
const FAIL_MESSAGES: Record<Exclude<FailMode, 'none'>, string> = {
  'install-bootstrap': 'service bootstrap refused',
  'uninstall-claude-remove': 'claude CLI missing or refusing',
  'install-enoent-claude': 'spawn claude ENOENT',
  'install-eacces-launchctl': 'spawn launchctl EACCES',
};

// Object-shaped mock results for failures that don't fit the
// `status:1 + stderr` shape (spawn errors leave status:null and put detail
// on r.error). When a failMode has a non-null entry here, the factory below
// returns it VERBATIM instead of the legacy status:1+stderr shape.
const FAIL_OBJECTS: Partial<Record<Exclude<FailMode, 'none'>, Record<string, unknown>>> = {
  'install-enoent-claude': {
    status: null,
    error: Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' }),
  },
  'install-eacces-launchctl': {
    status: null,
    error: Object.assign(new Error('spawn launchctl EACCES'), { code: 'EACCES' }),
  },
};

// Module-top vi.mock: hoisted by vitest, factory is invoked at module-load.
// `failMode` is a closure-captured module-scope let; reassigning it in
// beforeEach propagates to spawnSync at call-time because closures capture
// variable BINDINGS (live reads), not values.
vi.mock('node:child_process', () => ({
  spawnSync: (cmd: string, args: string[], _opts: unknown) => {
    if (failMode !== 'none' && FAIL_PATTERNS[failMode](cmd, args ?? [])) {
      const obj = FAIL_OBJECTS[failMode];
      if (obj) return obj;
      return { status: 1, stderr: FAIL_MESSAGES[failMode], stdout: '' };
    }
    return { status: 0, stderr: '', stdout: '' };
  },
}));

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const launchAgentPath = (home: string): string =>
  path.join(home, 'Library', 'LaunchAgents', 'com.imgtokenx.proxy.plist');
const envPath = (home: string): string =>
  path.join(home, '.imgtokenx', 'env.sh');

interface HomeFixture { home: string; repoRoot: string; cleanup: () => void }

function mkHome(): HomeFixture {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'imgtokenx-midfail-'));
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'imgtokenx-midfail-repo-'));
  fs.mkdirSync(path.join(repoRoot, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, 'bin', 'cli.js'), '// stub\n');
  return {
    home, repoRoot,
    cleanup: () => {
      try { fs.rmSync(home, { recursive: true, force: true }); } catch { /* ignore */ }
      try { fs.rmSync(repoRoot, { recursive: true, force: true }); } catch { /* ignore */ }
    },
  };
}

describe('install — rollback removes net-new plist + env.sh when launchctl bootstrap fails (audit D20)', () => {
  let fx: HomeFixture;
  beforeEach(() => { fx = mkHome(); failMode = 'install-bootstrap'; });
  afterEach(() => {
    vi.restoreAllMocks();
    failMode = 'none';
    fx.cleanup();
  });

  it('throws AND rolls back plist + env.sh (net-new files)', async () => {
    const install = await import('../src/install.js');
    expect(() => install.runInstall({
      home: fx.home,
      repoRoot: fx.repoRoot,
      nodePath: '/usr/bin/node',
      port: 47899,
    })).toThrow(/bootstrap/i);

    // After rollback: plist + env.sh should NOT exist (net-new files; the
    // rollback stack's revert() calls fs.rmSync for net-new writes).
    expect(fs.existsSync(launchAgentPath(fx.home))).toBe(false);
    expect(fs.existsSync(envPath(fx.home))).toBe(false);
    // No `.tmp.*` siblings leaked.
    const libLaunchAgents = path.join(fx.home, 'Library', 'LaunchAgents');
    if (fs.existsSync(libLaunchAgents)) {
      const siblings = fs.readdirSync(libLaunchAgents).filter((n) => n.includes('.tmp.'));
      expect(siblings).toEqual([]);
    }
    expect(fx.home.startsWith(os.tmpdir())).toBe(true);
  });
});

describe('install — rollback restores pre-existing plist + env.sh when claude mcp remove fails (audit D20)', () => {
  let fx: HomeFixture;
  beforeEach(() => {
    fx = mkHome();
    failMode = 'uninstall-claude-remove';
    // Seed a pre-existing plist + env.sh as if install already succeeded.
    const laPath = launchAgentPath(fx.home);
    const ePath = envPath(fx.home);
    fs.mkdirSync(path.dirname(laPath), { recursive: true });
    fs.mkdirSync(path.dirname(ePath), { recursive: true });
    fx['_originalPlist'] = '<?xml version="1.0"?>\n<plist version="1.0"><dict><key>Label</key><string>com.imgtokenx.proxy</string></dict></plist>\n';
    fx['_originalEnv'] = 'export FOO=bar\n';
    fs.writeFileSync(laPath, fx['_originalPlist']!);
    fs.writeFileSync(ePath, fx['_originalEnv']!);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    failMode = 'none';
    fx.cleanup();
  });

  it('throws AND restores plist + env.sh byte-for-byte', async () => {
    const laPath = launchAgentPath(fx.home);
    const ePath = envPath(fx.home);
    const originalPlist = fx['_originalPlist']!;
    const originalEnv = fx['_originalEnv']!;

    const install = await import('../src/install.js');
    expect(() => install.runUninstall({
      home: fx.home,
      repoRoot: fx.repoRoot,
      port: 47899,
    })).toThrow(/claude/i);

    // After rollback: launchd plist + env.sh must be RESTORED byte-for-byte.
    expect(fs.existsSync(laPath)).toBe(true);
    expect(fs.readFileSync(laPath, 'utf8')).toBe(originalPlist);
    expect(fs.existsSync(ePath)).toBe(true);
    expect(fs.readFileSync(ePath, 'utf8')).toBe(originalEnv);
  });
});

describe('install — ENOENT (missing CLI) is silently tolerated, audit D20', () => {
  let fx: HomeFixture;
  beforeEach(() => { fx = mkHome(); failMode = 'install-enoent-claude'; });
  afterEach(() => {
    vi.restoreAllMocks();
    failMode = 'none';
    fx.cleanup();
  });

  it('runInstall does NOT throw when claude mcp add returns ENOENT (audit D20 silent on missing-CLI)', async () => {
    const install = await import('../src/install.js');
    // ENOENT must be silent — operators without claude installed locally
    // should still be able to run `imgtokenx install`. The mocked claude
    // mcp add returns r.status:null + r.error.code:'ENOENT'.
    const result = install.runInstall({
      home: fx.home,
      repoRoot: fx.repoRoot,
      nodePath: '/usr/bin/node',
      port: 47899,
    });
    // After successful install: plist + env.sh should exist (ENOENT
    // doesn't trigger rollback because the runStep ENOENT silent branch
    // returns early).
    expect(fs.existsSync(launchAgentPath(fx.home))).toBe(true);
    expect(fs.existsSync(envPath(fx.home))).toBe(true);
    // The failing step was at least attempted (runStep pushes the joined
    // command line to actionLog BEFORE invoking spawnSync, so the ENOENT
    // silent branch can't drop the log entry). The q() helper wraps every
    // argv token in single quotes on the way out, so the action is
    // `'claude' 'mcp' 'add' ...`. Match a stable middle to avoid
    // hard-coding the q-quoted cmd prefix.
    expect(result.actions.some((a) => a.includes("'mcp' 'add'"))).toBe(true);
  });
});

describe('install — EACCES (non-ENOENT exec error) DOES throw + rollback, audit D20', () => {
  let fx: HomeFixture;
  beforeEach(() => { fx = mkHome(); failMode = 'install-eacces-launchctl'; });
  afterEach(() => {
    vi.restoreAllMocks();
    failMode = 'none';
    fx.cleanup();
  });

  it('runInstall throws AND rolls back plist + env.sh when launchctl bootstrap returns EACCES', async () => {
    const install = await import('../src/install.js');
    // EACCES with status:null must NOT be silently dropped — audit D20
    // requires real spawn failures to be loud. r.status !== 0 catches
    // status:null on spawn errors (EACCES, EPERM, ELIBBAD, ...) that the
    // old `(r.status ?? 0) !== 0` short-circuit silently dropped.
    expect(() => install.runInstall({
      home: fx.home,
      repoRoot: fx.repoRoot,
      nodePath: '/usr/bin/node',
      port: 47899,
    })).toThrow(/EACCES|launchctl|bootstrap/i);
    // After rollback, plist + env.sh should NOT exist (net-new files).
    expect(fs.existsSync(launchAgentPath(fx.home))).toBe(false);
    expect(fs.existsSync(envPath(fx.home))).toBe(false);
  });
});
