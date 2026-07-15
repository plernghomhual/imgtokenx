# Lessons

## Lesson: Self-Heal On Poisoned HTTP/2 Fetch Pool

### Anti-Pattern
A destroyed HTTP/2 session to api.anthropic.com (`ERR_HTTP2_INVALID_SESSION`
in `e.cause`) poisons Node's global `fetch` (undici) connection pool. Every
subsequent request fails in ~55ms without reaching the network. No public
Node API exists to evict the dead session — the process must restart. Manual
restart (`launchctl kickstart -k`) is a workaround, not a fix; the proxy was
down until someone noticed.

### Pattern
On this exact cause code, self-heal: `process.kill(process.pid, 'SIGTERM')`
inside the catch block (guarded by `typeof process.kill === 'function'` so
it's a no-op in the Cloudflare Worker runtime, which shares `proxy.ts`).
launchd's `KeepAlive: true` respawns the process in ~1-2s. Reused the
existing graceful `shutdown()` SIGTERM path in `node.ts` rather than a raw
`process.exit()`. See `src/core/proxy.ts` catch block around the upstream
`fetch()` call.

### Trigger
Proxy returns fast 502s (`imgtokenx upstream unreachable`) on every request
after being healthy — check `~/.imgtokenx/events.jsonl` for
`upstream_error: fetch failed (cause: ...)` detail before assuming a network
or upstream outage.

## Lesson: Keep Model Cleanup On The Current Family

### Anti-Pattern
Replacing a removed model fixture with another older model family that the user does not want represented.

### Pattern
For model-reference cleanup, reuse a current model variant that preserves the test's behavior, such as a current text-only profile for passthrough coverage.

### Trigger
Any request to remove a model version from code, tests, examples, or documentation.

## Lesson: Separate ChatGPT Auth From API Mode

### Anti-Pattern
Treating "Codex" as one transport and presenting API-key/gateway routes without checking the user's actual launch path and authentication mode.

### Pattern
Verify the live client, launcher, and auth mode before claiming proxy coverage. Distinguish Codex App with ChatGPT login from Codex OpenAI-compatible/API mode, and show only routes relevant to the user's setup.

### Trigger
Any imgtokenx install, compatibility, dashboard, or live-traffic claim involving Codex or another multi-auth client.

## Lesson: Persistence Labels Require Durable Writes

### Anti-Pattern
Labeling an in-memory dashboard toggle with "persist with an environment variable" and treating that as persisted behavior.

### Pattern
A control presented as persistent must write durable configuration itself and have a restart-style test proving the next process reads the saved value.

### Trigger
Any dashboard control, setting, or status copy that claims or implies persistence across process restarts.

## Lesson: Verify Remote Ownership Before Rename

### Anti-Pattern
Treating `origin` as the user's writable fork and issuing a repository rename without first validating the authenticated GitHub identity and repository ownership.

### Pattern
Before any remote rename, verify `gh auth status`, the authenticated login, `git remote -v`, repository ownership/fork metadata, and the installed `gh` command's flag constraints. When creating a fork from the current clone, omit the repository argument so `gh` can keep the source as `upstream` and install the user's fork as `origin`. Fetch the newly created `origin/main` and verify ancestry before the first push; the fork may snapshot a newer upstream head than the local remote-tracking ref.

### Trigger
Any GitHub repository rename, transfer, fork creation, or remote reassignment.

## Lesson: Triage Fork Ancestry Before Integration

### Anti-Pattern
Merging every newer upstream commit merely to avoid replacing a newly created fork branch, even when those commits include unrelated models, large evaluation artifacts, or behavior outside the user's requested scope.

### Pattern
Classify remote-only commits before integration. With explicit approval, preserve the verified local product branch using an exact `--force-with-lease`, then port only the requested runtime fixes, documentation, profiles, and tests. Keep model-specific evidence and unsupported providers out unless the user actually needs them.

### Trigger
A newly created fork snapshots a newer upstream `main` while the local product branch has intentionally diverged.

## Lesson: Prove the Live Traffic Owner

### Anti-Pattern
Treating a regenerated shell wrapper and an OFF dashboard as proof that no requests can still reach the proxy, without identifying the process that owns each live connection.

### Pattern
For kill-switch bugs, distinguish historical dashboard rows from new traffic, map current proxy connections to client PIDs and process start times, and verify the client was relaunched after OFF. A sourced wrapper only affects future launches; it cannot rewrite an already-running process or a launcher that hard-codes the base URL.

### Trigger
Any report that traffic still reaches imgtokenx after the global switch is OFF.

## Lesson: Ground Provider Architecture in the User's Real Path

### Anti-Pattern
Reasoning from Anthropic caching, Cloudflare model routing, or Z.ai-specific plans when the required path is provider-neutral OpenCode with official Zen compatibility.

### Pattern
Separate client compatibility from model-provider assumptions. Preserve first-class OpenCode Zen routing and credentials, keep efficiency mechanisms dialect-neutral, and exclude Z.ai or Cloudflare AI-model coupling unless explicitly requested.

### Trigger
Any routing, installer, caching, or savings design involving OpenCode or multiple model providers.

## Lesson: Honor an Explicit Commit Checkpoint Immediately

### Anti-Pattern
Continuing planning or implementation discussion after the user explicitly asks to commit and push the verified current work.

### Pattern
Inspect the diff, run proportionate checkpoint gates, commit, and push before starting the next implementation phase.

### Trigger
The user says “commit and push,” especially while other work is concurrently modifying the tree.

## Lesson: Calibrate the User's Actual OpenCode Model

### Anti-Pattern
Assuming OpenCode uses Claude or GPT when the user's OpenCode lane is for cheap or free models.

### Pattern
Read the live request's exact model ID and calibrate that model before promising compression or savings.

### Trigger
Any OpenCode model-profile, comprehension, or token-savings test.

## Lesson: Live State Accumulators Must Rehydrate Every Field They Track

### Anti-Pattern
`DashboardState.replay()` rebuilt only display rows (`contextHistory`/`recent`)
from persisted JSONL at startup, never touching `this.totals`/`this.sessions`/
measurement counters. `/proxy-stats` always read zero after any restart no
matter how much history was on disk — dashboard showed "literally no savings"
right after a routine restart. `update()` and `replay()` had silently diverged
because the totals-accumulation logic lived inline in `update()` only, with no
shared code path forcing both to touch the same counters.

### Pattern
When a live in-memory accumulator has both a "handle new event" path and a
"rehydrate from persisted log" path, extract the accumulation logic into one
shared method (here: `applyTotals()`) called by both, so they cannot drift on
which counters get bumped. Add a regression test that runs the same event
through both paths and asserts identical `/proxy-stats` output — not just
that replay doesn't crash.

### Trigger
Any dashboard/stats/counter bug that only reproduces after a process restart,
or any new field added to a live per-request handler — check it was also
wired into the corresponding replay/rehydrate path.
