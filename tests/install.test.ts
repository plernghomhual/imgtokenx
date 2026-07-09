import { describe, expect, it } from 'vitest';
import {
  LAUNCHD_LABEL,
  MCP_SERVER_NAME,
  applyZshrcInstall,
  applyZshrcUninstall,
  buildInstallPlan,
  parseInstallArgs,
  renderShellEnv,
} from '../src/install.js';

describe('install artifacts', () => {
  it('renders a launchd plan with absolute node/cli paths and logs under ~/.pxpipe', () => {
    const plan = buildInstallPlan({
      home: '/tmp/home',
      repoRoot: '/repo/pxpipe',
      nodePath: '/usr/local/bin/node',
      port: 47899,
    });

    expect(plan.launchAgentPath).toBe(`/tmp/home/Library/LaunchAgents/${LAUNCHD_LABEL}.plist`);
    expect(plan.envPath).toBe('/tmp/home/.pxpipe/env.sh');
    expect(plan.plist).toContain(`<string>${LAUNCHD_LABEL}</string>`);
    expect(plan.plist).toContain('<string>/usr/local/bin/node</string>');
    expect(plan.plist).toContain('<string>/repo/pxpipe/bin/cli.js</string>');
    expect(plan.plist).toContain('<string>47899</string>');
    expect(plan.plist).toContain('<string>/tmp/home/.pxpipe/proxy.out.log</string>');
  });

  it('renders wrappers that route each harness through the right local base URL and keep PXPIPE_DISABLE as bypass', () => {
    const env = renderShellEnv({
      nodePath: '/node',
      cliPath: '/repo/bin/cli.js',
      baseUrl: 'http://127.0.0.1:47821',
      port: 47821,
    });

    expect(env).toContain('curl -fsS "$PXPIPE_BASE_URL/healthz"');
    expect(env).toContain('launchctl kickstart -k "gui/$(id -u)/com.pxpipe.proxy"');
    expect(env).toContain('HOST=127.0.0.1 PORT="$PXPIPE_PORT" nohup "$PXPIPE_NODE" "$PXPIPE_CLI"');
    expect(env).toContain('ANTHROPIC_BASE_URL="$PXPIPE_BASE_URL" command claude "$@"');
    expect(env).toContain('OPENAI_BASE_URL="$PXPIPE_BASE_URL/v1" command codex "$@"');
    expect(env).toContain('ANTHROPIC_BASE_URL="$PXPIPE_BASE_URL/anthropic" OPENAI_BASE_URL="$PXPIPE_BASE_URL/openai" command opencode "$@"');
    expect(env).toContain('if [ "${PXPIPE_DISABLE:-}" = "1" ]; then command claude "$@"; return $?; fi');
  });

  it('adds and removes exactly one zshrc source block idempotently', () => {
    const plan = buildInstallPlan({ home: '/tmp/home', repoRoot: '/repo/pxpipe' });
    const original = 'export PATH=/usr/bin\n';
    const once = applyZshrcInstall(original, plan.zshrcBlock);
    const twice = applyZshrcInstall(once, plan.zshrcBlock);

    expect(twice).toBe(once);
    expect(once).toContain('# >>> pxpipe auto-start >>>');
    expect(once).toContain("[ -r '/tmp/home/.pxpipe/env.sh' ] && . '/tmp/home/.pxpipe/env.sh'");
    expect(applyZshrcUninstall(once)).toBe(original);
  });

  it('prepares MCP registrations for Claude, Codex, and OpenCode', () => {
    const plan = buildInstallPlan({
      home: '/tmp/home',
      repoRoot: '/repo/pxpipe',
      nodePath: '/node',
    });

    expect(plan.mcpCommands).toEqual([
      `claude mcp add --scope user ${MCP_SERVER_NAME} -- '/node' '/repo/pxpipe/bin/cli.js' mcp`,
      `codex mcp add ${MCP_SERVER_NAME} -- '/node' '/repo/pxpipe/bin/cli.js' mcp`,
    ]);
    expect(plan.opencodeMcp).toEqual({
      enabled: true,
      type: 'local',
      command: ['/node', '/repo/pxpipe/bin/cli.js', 'mcp'],
    });
  });

  it('validates install CLI port values', () => {
    expect(parseInstallArgs(['--dry-run', '--port=48721'])).toEqual({ dryRun: true, port: 48721 });
    expect(() => parseInstallArgs(['--port=0'])).toThrow(/invalid --port/);
    expect(() => parseInstallArgs(['--port=nope'])).toThrow(/invalid --port/);
  });
});
