import { describe, expect, it } from 'vitest';
import {
  LAUNCHD_LABEL,
  MCP_SERVER_NAME,
  applyZshrcInstall,
  applyZshrcUninstall,
  buildInstallPlan,
  doctorExitCode,
  formatDoctor,
  parseInstallArgs,
  runDoctor,
  renderShellEnv,
} from '../src/install.js';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

describe('install artifacts', () => {
  it('renders a launchd plan with absolute node/cli paths and logs under ~/.imgtokenx', () => {
    const plan = buildInstallPlan({
      home: '/tmp/home',
      repoRoot: '/repo/imgtokenx',
      nodePath: '/usr/local/bin/node',
      port: 47899,
    });

    expect(plan.launchAgentPath).toBe(`/tmp/home/Library/LaunchAgents/${LAUNCHD_LABEL}.plist`);
    expect(plan.envPath).toBe('/tmp/home/.imgtokenx/env.sh');
    expect(plan.plist).toContain(`<string>${LAUNCHD_LABEL}</string>`);
    expect(plan.plist).toContain('<string>/usr/local/bin/node</string>');
    expect(plan.plist).toContain('<string>/repo/imgtokenx/bin/cli.js</string>');
    expect(plan.plist).toContain('<string>47899</string>');
    expect(plan.plist).toContain('<string>/tmp/home/.imgtokenx/proxy.out.log</string>');
  });

  it('renders wrappers that route each harness through the right local base URL and keep IMGTOKENX_DISABLE as bypass', () => {
    const env = renderShellEnv({
      nodePath: '/node',
      cliPath: '/repo/bin/cli.js',
      baseUrl: 'http://127.0.0.1:47821',
      port: 47821,
    });

    expect(env).toContain('curl -fsS "$IMGTOKENX_BASE_URL/healthz"');
    expect(env).toContain('launchctl kickstart -k "gui/$(id -u)/com.imgtokenx.proxy"');
    expect(env).toContain('HOST=127.0.0.1 PORT="$IMGTOKENX_PORT" nohup "$IMGTOKENX_NODE" "$IMGTOKENX_CLI"');
    expect(env).toContain('ANTHROPIC_BASE_URL="$IMGTOKENX_BASE_URL" command claude "$@"');
    expect(env).toContain('OPENAI_BASE_URL="$IMGTOKENX_BASE_URL/v1" command codex "$@"');
    expect(env).toContain('ANTHROPIC_BASE_URL="$IMGTOKENX_BASE_URL/anthropic" OPENAI_BASE_URL="$IMGTOKENX_BASE_URL/openai" command opencode "$@"');
    expect(env).toContain('[ "${IMGTOKENX_DISABLE:-}" = "1" ] || [ -e "$HOME/.imgtokenx/disabled" ]');
    expect(env).toContain('if imgtokenx_disabled; then command claude "$@"; return $?; fi');
  });

  it('launches Claude Code, Codex, and OpenCode directly while the global kill switch is off', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'imgtokenx-kill-switch-'));
    try {
      const bin = path.join(home, 'bin');
      fs.mkdirSync(bin, { recursive: true });
      const client = '#!/bin/sh\nprintf "%s|%s|%s\\n" "$(basename "$0")" "${ANTHROPIC_BASE_URL-unset}" "${OPENAI_BASE_URL-unset}"\n';
      for (const command of ['claude', 'codex', 'opencode']) {
        const file = path.join(bin, command);
        fs.writeFileSync(file, client, { mode: 0o755 });
      }
      fs.writeFileSync(path.join(bin, 'curl'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
      fs.mkdirSync(path.join(home, '.imgtokenx'), { recursive: true });
      fs.writeFileSync(path.join(home, '.imgtokenx', 'disabled'), 'off\n');

      const envFile = path.join(home, 'env.sh');
      fs.writeFileSync(envFile, renderShellEnv({
        nodePath: '/node',
        cliPath: '/repo/bin/cli.js',
        baseUrl: 'http://127.0.0.1:47821',
        port: 47821,
      }));
      const run = spawnSync('/bin/zsh', ['-c', '. "$1"; claude; codex; opencode', 'zsh', envFile], {
        encoding: 'utf8',
        env: { HOME: home, PATH: `${bin}:/usr/bin:/bin` },
      });

      expect(run.status, run.stderr).toBe(0);
      expect(run.stdout.trim().split('\n')).toEqual([
        'claude|unset|unset',
        'codex|unset|unset',
        'opencode|unset|unset',
      ]);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('adds and removes exactly one zshrc source block idempotently', () => {
    const plan = buildInstallPlan({ home: '/tmp/home', repoRoot: '/repo/imgtokenx' });
    const original = 'export PATH=/usr/bin\n';
    const once = applyZshrcInstall(original, plan.zshrcBlock);
    const twice = applyZshrcInstall(once, plan.zshrcBlock);

    expect(twice).toBe(once);
    expect(once).toContain('# >>> imgtokenx auto-start >>>');
    expect(once).toContain("[ -r '/tmp/home/.imgtokenx/env.sh' ] && . '/tmp/home/.imgtokenx/env.sh'");
    expect(applyZshrcUninstall(once)).toBe(original);
  });

  it('prepares MCP registrations for Claude, Codex, and OpenCode', () => {
    const plan = buildInstallPlan({
      home: '/tmp/home',
      repoRoot: '/repo/imgtokenx',
      nodePath: '/node',
    });

    expect(plan.mcpCommands).toEqual([
      `claude mcp add --scope user ${MCP_SERVER_NAME} -- '/node' '/repo/imgtokenx/bin/cli.js' mcp`,
      `codex mcp add ${MCP_SERVER_NAME} -- '/node' '/repo/imgtokenx/bin/cli.js' mcp`,
    ]);
    expect(plan.opencodeMcp).toEqual({
      enabled: true,
      type: 'local',
      command: ['/node', '/repo/imgtokenx/bin/cli.js', 'mcp'],
    });
  });

  it('validates install CLI port values', () => {
    expect(parseInstallArgs(['--dry-run', '--port=48721'])).toEqual({ dryRun: true, port: 48721 });
    expect(() => parseInstallArgs(['--port=0'])).toThrow(/invalid --port/);
    expect(() => parseInstallArgs(['--port=nope'])).toThrow(/invalid --port/);
  });

  it('doctor verifies installed files, health, launchd, and MCP wiring without mutating state', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'imgtokenx-doctor-'));
    try {
      const plan = buildInstallPlan({ home, repoRoot: '/repo/imgtokenx', nodePath: '/node' });
      fs.mkdirSync(path.dirname(plan.launchAgentPath), { recursive: true });
      fs.mkdirSync(path.dirname(plan.envPath), { recursive: true });
      fs.mkdirSync(path.join(home, '.config', 'opencode'), { recursive: true });
      fs.writeFileSync(plan.launchAgentPath, plan.plist);
      fs.writeFileSync(plan.envPath, plan.envSh);
      fs.writeFileSync(plan.zshrcPath, applyZshrcInstall('', plan.zshrcBlock));
      fs.writeFileSync(
        path.join(home, '.config', 'opencode', 'opencode.json'),
        JSON.stringify({ mcp: { [MCP_SERVER_NAME]: plan.opencodeMcp } }),
      );

      const result = await runDoctor(
        { home, repoRoot: '/repo/imgtokenx', nodePath: '/node' },
        {
          fetch: (async () => new Response(JSON.stringify({ ok: true }), { status: 200 })) as typeof fetch,
          spawnSync: ((cmd: string) => ({
            status: ['launchctl', 'claude', 'codex'].includes(cmd) ? 0 : 1,
            stdout: '',
            stderr: '',
          })) as any,
        },
      );

      expect(result.checks.map((c) => c.status)).toEqual(result.checks.map(() => 'pass'));
      expect(doctorExitCode(result)).toBe(0);
      expect(formatDoctor(result)).toContain('PASS healthz');
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});
