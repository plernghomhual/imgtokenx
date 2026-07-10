# imgtokenx Codex/OpenCode Compatibility

- [x] Scout existing proxy endpoint and env handling.
- [x] Patch compatibility gaps with minimal routing changes.
- [x] Add focused tests and README usage notes.
- [x] Run available verification.
- [x] Record final review.

## Final Review - 2026-07-08

Files changed:
- `src/core/proxy.ts`
- `src/node.ts`
- `README.md`
- `tests/proxy-usage.test.ts`
- `tests/gateway.test.ts`

Behavior changed:
- Direct OpenAI root aliases `/responses`, `/responses/*`, `/chat/completions`, `/models`, and `/models/*` now route to the OpenAI upstream instead of falling through to Anthropic.
- Direct root aliases normalize to `/v1/*` for normal OpenAI upstreams and strip `/v1` for Cloudflare AI Gateway OpenAI routes.
- OpenCode provider-prefixed `/openai/chat/completions` now transforms like `/openai/v1/chat/completions`, while provider-prefixed routes still forward with their original path.
- README and CLI help now document Codex/OpenAI and OpenCode provider-prefixed base URLs.

Verification performed:
- `git diff --check` passed.
- `npm run typecheck` attempted; blocked because `tsc` is not installed in this checkout.
- `npm test -- tests/proxy-usage.test.ts tests/gateway.test.ts` attempted; blocked because `vitest` is not installed in this checkout.

Remaining risks:
- Focused tests have been added but not executed locally until dependencies are installed.

# imgtokenx Further Hardening

- [x] Reread upstream README, open issues, and relevant official vision docs.
- [x] Patch native typed-tool handling and GPT tool-description double billing.
- [x] Patch Anthropic image-token accounting to the current patch model.
- [x] Harden exact-risk factsheet/framing for identifiers and abstention.
- [x] Add focused regression tests.
- [x] Run available verification and record final review.

## Final Review - 2026-07-08

Files changed:
- `src/core/transform.ts`
- `src/core/openai.ts`
- `src/core/export.ts`
- `src/core/factsheet.ts`
- `src/core/history.ts`
- `src/core/render.ts`
- `src/core/library.ts`
- `src/core/openai-history.ts`
- `src/core/tracker.ts`
- `docs/RENDER_SIZING.md`
- `docs/TRANSFORM_INFO.md`
- `docs/ADAPTIVE_CPT_PLAN.md`
- `docs/LEGIBILITY-AUDIT-2026-07-01.md`
- `tests/render.test.ts`
- `tests/openai-gpt5.test.ts`
- `tests/export.test.ts`
- `tests/factsheet.test.ts`
- `tests/paging.test.ts`
- `tests/export-proxy-align.test.ts`
- `tests/history.test.ts`

Behavior changed:
- Anthropic native typed tools now pass through untouched and are excluded from imaged custom-tool references.
- GPT Chat/Responses top-level tool descriptions stay native and are no longer duplicated into image docs.
- Anthropic image-cost estimates now use the documented 28px patch formula with the existing 10% safety margin.
- Default Anthropic slab width now aligns with the 1568px standard edge (`DENSE_CONTENT_COLS=312`) instead of overshooting at 313 cols.
- Exact-risk framing now tells models to use factsheets/recovery refs and not guess byte-exact IDs, hashes, paths, secrets, or quoted strings from pixels.
- Factsheets now capture multi-hump camelCase/PascalCase identifiers at tier 1 without letting camel identifiers masquerade as tier-0 opaque IDs.
- Live proxy factsheets now assemble all page-level exact-risk identifiers before applying any reporting cap; the complete sidecar path keeps every extracted identifier.
- Current docs/tests no longer encode stale 1928px / `px/750` Anthropic assumptions except in explicitly marked historical notes.

Verification performed:
- `git diff --check` passed.
- Stale Anthropic-path math scan passed except explicitly historical notes in `docs/RENDER_SIZING.md`.
- `npm install --package-lock=false` installed local dev dependencies.
- `npm run typecheck` passed.
- `npm run build` passed.
- `npm test` passed: 33 files, 657 tests.

Remaining risks:
- Codex ChatGPT local `~/.codex/auth.json` token reuse was intentionally not implemented; reading and forwarding those tokens would require an explicit local-auth design and secret-handling review.

# Next Improvement Backlog

- [x] Add a local exact-recall regression eval for adversarial IDs/hashes/secrets/camelCase/quoted strings.
- [x] Wire `rec_*` recovery refs to an explicit local rehydrate command/tool instead of only writing sidecars.
- [x] Add a lossless mode that leaves high-risk blocks as text when exact sidecar/recovery is unavailable.
- [x] Add telemetry for factsheet size, recovered refs, omitted identifiers, and image/token break-even misses.
- [ ] Revisit Codex ChatGPT local auth only with an explicit secret-handling design.
- [x] Add a compatibility matrix smoke test for Claude Code, Codex OpenAI-compatible mode, OpenCode Anthropic, OpenCode OpenAI, and Cloudflare AI Gateway.

# imgtokenx Exactness Completion Pass

- [x] Add local exact-recall regression fixtures for IDs, hashes, secrets, paths, and camel/Pascal identifiers.
- [x] Add `rec_*` local recovery CLI coverage.
- [x] Add `losslessExact`/`IMGTOKENX_LOSSLESS_EXACT` so risky exact blocks stay text when no recovery sidecar is available.
- [x] Add telemetry for factsheets, recovery refs, omitted identifiers, lossless keeps, and break-even misses.
- [x] Add Codex/OpenCode/Claude/AI Gateway compatibility smoke coverage.
- [x] Update user-facing docs/help for new command and env var.
- [x] Run focused tests, typecheck, build, full test suite, and diff check.

## Final Review - 2026-07-08

Files changed in this pass:
- `README.md`
- `docs/TRANSFORM_INFO.md`
- `src/core/factsheet.ts`
- `src/core/openai.ts`
- `src/core/tracker.ts`
- `src/core/transform.ts`
- `src/node.ts`
- `tests/compatibility-smoke.test.ts`
- `tests/exact-recall-eval.test.ts`
- `tests/recover-cli.test.ts`
- `tests/tracker.test.ts`
- `tasks/todo.md`

Behavior changed:
- Complete exact factsheets now include quoted exact-risk strings and local regression fixtures cover paths, hashes, UUIDs, ticket IDs, camel/Pascal identifiers, quoted exact strings, and env-style exact assignments.
- `losslessExact` / `IMGTOKENX_LOSSLESS_EXACT=1` keeps exact-risk blocks as native text when `emitRecoverable` is off.
- `IMGTOKENX_RECOVERABLE_DIR` now has a local `imgtokenx recover rec_1234abcd` / `imgtokenx rehydrate rec_1234abcd` command to print exact source text from the private recovery directory.
- Transform telemetry now surfaces factsheet counts/chars, recoverable ref counts, lossless keeps/chars, break-even misses, and richer passthrough reasons.
- Added a compatibility smoke matrix for Claude Code, Codex OpenAI-compatible Responses, OpenCode Anthropic/OpenAI prefixes, and Cloudflare AI Gateway OpenAI aliases.

Verification performed:
- Focused tests passed: `npm test -- tests/exact-recall-eval.test.ts tests/recover-cli.test.ts tests/tracker.test.ts tests/compatibility-smoke.test.ts tests/exact-sidecar.test.ts tests/recoverable.test.ts tests/proxy-usage.test.ts tests/gateway.test.ts` => 8 files, 81 tests.
- Fixture cleanup tests passed: `npm test -- tests/exact-recall-eval.test.ts tests/compatibility-smoke.test.ts` => 2 files, 9 tests.
- `npm run typecheck` exited 0.
- `npm run build` passed and version smoke printed `0.8.0`.
- `npm test` passed: 36 files, 669 tests.
- `git diff --check` exited 0.
- Targeted secret-shape scan found only detector names in `src/core/factsheet.ts`, no test/docs/code secret values.

Remaining risks:
- Live target-model quote-back evaluation was not run; the implemented exact-recall eval is deterministic/local and does not call external model APIs.
- Codex ChatGPT local auth remains intentionally unimplemented pending explicit secret-handling design.

# imgtokenx Auto-start + Lossless-by-construction + All-model compat

Plan: `/Users/plernghomhual/.claude/plans/jaunty-whistling-shannon.md`

- [x] Phase 0: commit pending exactness pass as checkpoint (verify green first). Commit `142e964`.
- [x] Phase 1: lossless-by-default (`losslessExact` on), widen exact-risk detectors, recovery MCP server + `imgtokenx mcp`, default `emitRecoverable`/`IMGTOKENX_RECOVERABLE_DIR`, banner mentions recovery tool. Commit `65a85a1`.
- [x] Phase 2a (miner-xhigh): per-model reader-capacity profiles (`reader-profiles.ts`), density selection threaded through transform.ts + history.ts, safe default (text passthrough) for unknown/uncalibrated models, `applicability.ts` GPT-vs-Anthropic split documented. Commit `2268cdd`.
- [x] Phase 2b: calibration harness (`eval/reader-capacity/`, live-API opt-in sweep tool). See Final Review below.
- [x] Phase 3: launchd LaunchAgent + `imgtokenx install`/`uninstall`, shell wrappers (claude/codex/opencode) with health-check + kill switch, MCP registration per harness, `/healthz`. See Final Review below.
- [x] Phase 4: compat/lossless/reader-profile tests, doctor self-check. See Final Review below.
- [x] Full verification: typecheck, build, test, install dry-run, final review entry.

## Final Review - 2026-07-09 (Phase 2a — per-model reader profiles)

Files changed:
- `src/core/reader-profiles.ts` (new) — `ReaderProfile`, `DEFAULT_READER_PROFILE` (safeToImage:false), `BUILTIN_RULES` (claude-fable-5, gpt-5.6 → no bonus; claude-opus-4-* → cellWBonus:15/cellHBonus:24 per FINDINGS.md 2026-06-16 sweep), `IMGTOKENX_READER_PROFILES` env override, `resolveReaderProfile`.
- `src/core/render.ts` — added `cellDims(style)` helper.
- `src/core/applicability.ts` — comment rewrite explaining the GPT-vs-Anthropic split (GPT still allowlist-gated; Claude default now gated by reader-profiles.ts).
- `src/core/transform.ts` — single centralized gate right after `JSON.parse`: unsafe/uncalibrated model → `reader_profile_unsafe` passthrough (zero images, original body, `outgoingTextChars` still recorded for telemetry). Threaded `RenderStyle`/`cellW`/`cellH` through every gate and render call (`singleColWidthPx`, `multiColWidthPx`, `imageTokensForRows`, `imageTokensCost`, `denseGateGeometry`, `linesPerImageFor`/`maxCharsPerImage`, `evalCompressionProfitability`, `isCompressionProfitable(Amortized)`, `textToImageBlocks`, slab/reminder/tool_result render calls, both `historyProfitable` closures). `renderTextToPngsMultiCol` deliberately left un-threaded (no `RenderStyle` param exists) with comments at each call site explaining the scope limit.
- `src/core/history.ts` — `HistoryCollapseOptions.style: RenderStyle` (new field, default `DENSE_RENDER_STYLE`), threaded into `collapseHistory`'s own independent render call so history-collapsed images also respect the per-model cell bonus (this path doesn't go through `textToImageBlocks` at all).
- `tests/render.test.ts`, `tests/history.test.ts`, `tests/paging.test.ts`, `tests/exact-sidecar.test.ts`, `tests/keep-sharp.test.ts`, `tests/recoverable.test.ts` — placeholder `model: 'claude'` / `'claude-3-5-sonnet'` fixtures switched to `'claude-fable-5'` (a calibrated, zero-bonus profile, numerically identical to the prior hardcoded defaults) since `transformRequest` now gates imaging by model.

Behavior changed:
- `transformRequest` no longer images content for any model outside `reader-profiles.ts`'s `BUILTIN_RULES` (claude-fable-5, gpt-5.6, claude-opus-4-*) or an explicit `IMGTOKENX_READER_PROFILES` override — those get full text passthrough, reason `reader_profile_unsafe`.
- Opus 4.x requests now render at a 20×32 cell (cellWBonus:15, cellHBonus:24) instead of the production 5×8 cell, everywhere imaging can happen (slab, reminders, tool_results, history-collapse), matching the FINDINGS.md 2026-06-16 sweep's 100%-exact-read density.
- `TransformInfo.passthroughReasons` gained `reader_profile_unsafe`.

Verification performed:
- `npm run typecheck`: exit 0.
- `npm test`: 37 files, 676 tests, all passed (was 6 files / 47-54 failing before the two fixes below).
- `npm run build`: exit 0, version smoke `0.8.0`.
- `git diff --check`: exit 0.

Bugs found and fixed during verification (not part of the original brief, found by running the full suite rather than trusting the diff):
1. The new reader-profile gate returned early before `info.outgoingTextChars = countOutgoingTextChars(req)` ran, silently zeroing the token-accounting denominator for any passthrough caused by an unsafe/uncalibrated model. Fixed by computing it in the early-return branch too (mirrors what every other exit path in `transformRequest` already does).
2. Six test files used `claude` / `claude-3-5-sonnet` as a generic placeholder `model` value (documented in `keep-sharp.test.ts`/`recoverable.test.ts` as "the library wrapper gates on supported models... the [raw transform] path transforms any model" — a design assumption Phase 2 deliberately overturns). Confirmed via grep that no assertion depended on the literal model string, then switched the placeholders to `claude-fable-5` (a calibrated, zero-bonus profile — no numeric behavior change for those tests beyond making imaging reachable again).

## Auditor pass - 2026-07-09 (post-delegate review)

A second independent pass over the Phase 2a diff (not the delegate's own self-review above) found one more real bug and one real coverage gap:

3. **`src/core/applicability.ts` was dead-code'd against its own comment.** The delegate's module comment already claimed a "GPT-vs-Anthropic split" (GPT stays allowlist-gated; Claude defaults open, reader-profiles.ts gates safety instead) — but `isImgtokenxSupportedModel`/`DEFAULT_MODEL_BASES` were never actually changed to match. With the old code, the *default* (unset `IMGTOKENX_MODELS`) scope was still `['claude-fable-5', 'gpt-5.6']` only, so `isImgtokenxSupportedModel('claude-opus-4-8')` returned `false` by default and `shouldTransformAnthropicMessages` rejected Opus at `unsupported_model` *before* `transformRequest`/`reader-profiles.ts` ever ran. This made the brand-new Opus reader-profile entry (`cellWBonus:15, cellHBonus:24`) unreachable in production — Opus would never even reach the gate this whole phase exists to add. Fixed `isImgtokenxSupportedModel` to be open-by-default (only `hasExplicitOverride()` narrows it), matching what the comment already said and what `reader-profiles.ts` now assumes. `isImgtokenxSupportedGptModel` correctly left allowlist-gated (GPT has no reader-profile system).
4. `tests/public-api.test.ts` had 6 assertions hard-coded to the old default-2-model behavior (`isImgtokenxSupportedModel('claude-opus-4-8')` expected `false`, etc.) — these were silently masking bug #3 by asserting the broken behavior was correct. Updated to assert the intended open-by-default behavior instead (Opus/unknown Claude models eligible by default; `IMGTOKENX_MODELS`/dashboard override still narrows explicitly; GPT allowlist unchanged).
5. **Added `tests/reader-profiles.test.ts`** (new, 10 tests) — `reader-profiles.ts` had zero test coverage despite being the safety-critical module the whole phase is about. Covers: built-in table resolution (Fable/gpt-5.6 zero-bonus, Opus 4.x 20×32 bonus, prefix/variant-tag matching, no false-match on `claude-fable-50`), unknown-model conservative default, `IMGTOKENX_READER_PROFILES` env override (longest-prefix-wins, partial-field fallback, malformed-JSON never throws), and two `transformRequest` integration tests: an uncalibrated model gets a byte-identical passthrough with `reason: 'reader_profile_unsafe'` and `passthroughReasons.reader_profile_unsafe === 1`, and Opus 4.8 actually renders wider images than Fable 5 for identical text (proves `cellWBonus` reaches the real PNG, not just the gate math).

Verification performed (re-run after the auditor-pass fixes, from a clean state):
- `npm run typecheck`: exit 0.
- `npm test`: 38 files, 686 tests, all passed. (Two unrelated flakes — a GPT e2e test timeout and a proxy-usage 4xx-capture test — seen once under full-suite parallel load; both pass individually and passed on a clean re-run of the full suite, confirming resource-contention flakes, not regressions.)
- `npm run build`: exit 0, version smoke `0.8.0`.
- `git diff --check`: exit 0.

Remaining risks / next steps:
- Phase 2b (calibration harness, `eval/reader-capacity/`) is explicitly out of scope for this pass — it's a separate live-API opt-in sweep tool per the plan, not a numeric-correctness change to the render/gate path. Needs its own delegated task.
- `renderTextToPngsMultiCol` still hardcodes `CELL_H`/no `RenderStyle` param — multi-col imaging for a bonus-cell model (e.g. Opus 4.x with `multiCol` set >1, an opt-in/off-by-default feature) will under-size glyphs relative to its calibrated profile, silently reverting to the unsafe 5×8 density. Documented at each call site; not fixed here per the brief's explicit scope limit. Should be closed before `multiCol` is recommended for any non-default-profile model.
- Ready to commit as a single Phase 2a checkpoint.

## Final Review - 2026-07-09 (Phase 2b — calibration harness)

Files changed:
- `eval/reader-capacity/run.mjs` (new) — generalized calibration harness copied from the proven `opus-density` shape: CLI model list, same 5x8/7x10/9x12 sweep, same question battery/scoring, dry-run mode, results JSON, and live-score profile-row recommendations.
- `eval/reader-capacity/README.md` (new) — usage, dry-run/live-run notes, acceptance bar, and relationship to the `eval/opus-density/` one-off receipt.
- `src/core/reader-profiles.ts` — comment-only pointer to `eval/reader-capacity/` for safely adding a model.
- `tasks/todo.md` — Phase 2b status and this review entry.

Behavior changed:
- No production behavior changed; `src/` changed only by a documentation comment. New eval tooling only.
- `eval/reader-capacity/run.mjs` accepts a comma-separated CLI model list, defaults to `claude-opus-4-8,claude-fable-5`, renders with the production renderer through `src/core/library.ts`, and emits live profile candidates only when live scoring exists.
- `eval/opus-density/` was not modified.

Verification performed:
- `env -u ANTHROPIC_API_KEY node eval/reader-capacity/run.mjs claude-opus-4-8,gpt-5.5 --dry-run --out /tmp/imgtokenx-reader-capacity-dry-run.json`: exit 0; parsed the explicit CLI model list; rendered 5x8/7x10/9x12 as 280/504/728 image tokens vs 1335 text tokens (79%/62%/45% saved); made no model calls.
- `env -u ANTHROPIC_API_KEY node eval/reader-capacity/run.mjs --dry-run --out /tmp/imgtokenx-reader-capacity-default-dry-run.json`: exit 0; defaulted to `claude-opus-4-8,claude-fable-5`; rendered the same accounting; made no model calls.
- `npm run typecheck`: exit 0 (`tsc --noEmit`; npm printed existing unknown-project-config warnings).
- `npm test`: exit 0; 38 files, 686 tests passed.
- `git diff --check`: exit 0.

Remaining risks / next steps:
- Live calibration was intentionally not run because this phase must not use a real `ANTHROPIC_API_KEY`; dry-run proves rendering, token accounting, and CLI parsing only.
- The live scorer intentionally keeps the `eval/opus-density/` Anthropic Messages call path; non-Anthropic model IDs are accepted for dry-run/accounting but require a provider caller extension before live scoring.
- Phase 3 (launchd/wrappers) and Phase 4 (compat hardening) remain unstarted and still require explicit confirmation before touching user shell/launchd state.

## Final Review - 2026-07-09 (Phase 3 — auto-start install/wrappers)

Files changed:
- `src/install.ts` (new) — pure launchd/env/MCP artifact generation plus `runInstall`/`runUninstall` with `--dry-run`, `--skip-mcp`, idempotent zshrc block handling, launchctl bootstrap/kickstart, Claude/Codex MCP CLI registration, and OpenCode local MCP config merge.
- `src/node.ts` — added `imgtokenx install` / `imgtokenx uninstall` subcommands, help text, and package-root detection so generated ProgramArguments point at this checkout's `bin/cli.js` even when invoked from another directory.
- `src/core/proxy.ts` — added local `GET`/`HEAD /healthz` JSON response before upstream routing.
- `tests/install.test.ts` (new) — validates launchd plist, shell wrappers, zshrc idempotency, CLI port validation, and MCP registration artifacts.
- `tests/compatibility-smoke.test.ts` — asserts `/healthz` returns locally and makes no upstream fetch.
- `README.md` — documents `imgtokenx install --dry-run`, install/uninstall, wrapper health-check behavior, and `IMGTOKENX_DISABLE=1`.
- `tasks/todo.md` — Phase 3 status and this review entry.

Behavior changed:
- New install CLI can preview or install a macOS LaunchAgent at `~/Library/LaunchAgents/com.imgtokenx.proxy.plist`, generated wrapper file at `~/.imgtokenx/env.sh`, and one marked source block in `~/.zshrc`.
- Generated wrappers health-check `/healthz`, kickstart launchd or start a fallback local proxy process, then run `claude`, `codex`, or `opencode` with the intended local base URL; `IMGTOKENX_DISABLE=1` bypasses wrappers.
- `imgtokenx uninstall` removes the launchd/env/zshrc wiring and MCP registrations.
- `/healthz` now returns `{"ok":true}` without touching Anthropic/OpenAI upstreams.

Verification performed:
- `npm run typecheck`: exit 0 (`tsc --noEmit`; npm printed existing unknown-project-config warnings).
- `npm test -- tests/install.test.ts tests/compatibility-smoke.test.ts`: exit 0; 2 files, 11 tests passed.
- `npm run build`: exit 0; emitted dist, bundled CLI, version smoke printed `0.8.0`.
- `npm test`: exit 0; 39 files, 692 tests passed.
- `git diff --check`: exit 0.
- `node /Users/plernghomhual/Documents/imgtokenx/bin/cli.js install --dry-run --skip-mcp` from `/private/tmp`: exit 0; previewed plist/env/zshrc using `/Users/plernghomhual/Documents/imgtokenx/bin/cli.js`; no files/config changed.
- `node --import /Users/plernghomhual/Documents/imgtokenx/node_modules/tsx/dist/loader.mjs /Users/plernghomhual/Documents/imgtokenx/src/node.ts install --dry-run` from `/private/tmp`: exit 0; previewed MCP commands/config and proved source CLI package-root detection outside the repo.
- Temporary localhost probe of built CLI with `PORT=48721`, `HOME=<tmp>`, `IMGTOKENX_RECOVERABLE_DIR=off`, `IMGTOKENX_LOG=<tmp>/events.jsonl`: exit 0; `curl http://127.0.0.1:48721/healthz` returned `{"ok":true}`. Initial sandboxed bind failed with `listen EPERM`, then the same probe passed with approved localhost-bind escalation.

Remaining risks / next steps:
- A real `imgtokenx install` was intentionally not executed in this pass; no live `~/.zshrc`, LaunchAgent, or MCP client config was changed.
- OpenCode base-URL routing is implemented through the generated wrapper's `ANTHROPIC_BASE_URL` / `OPENAI_BASE_URL` provider-prefixed environment. Its local MCP registration is written by config merge because local `opencode mcp add --help` does not expose command-argument syntax.
- At Phase 3 completion, Phase 4 (compat hardening + doctor/self-check) remained unstarted; see the Phase 4 review below for current status.

## Final Review - 2026-07-09 (Phase 4 — compat hardening + doctor)

Files changed:
- `src/install.ts` — added non-mutating `runDoctor`, `formatDoctor`, and `doctorExitCode` helpers checking LaunchAgent/env/zshrc, `/healthz`, launchd service state, Claude/Codex MCP registration, and OpenCode MCP config.
- `src/node.ts` — added `imgtokenx doctor` CLI subcommand and help text.
- `tests/install.test.ts` — added mocked doctor self-check coverage for daemon/env/MCP wiring without touching live state.
- `tests/compatibility-smoke.test.ts` — extended client matrix to assert Claude root, Codex `/v1`, OpenCode `/anthropic` and `/openai`, and Cloudflare gateway routing plus strong-model image insertion vs weak/unknown-model passthrough.
- `README.md` — documented `imgtokenx doctor`.
- `tasks/todo.md` — Phase 4 status and this review entry.

Behavior changed:
- New `imgtokenx doctor` command reports `PASS`/`FAIL`/`WARN` checks and exits nonzero if any check fails.
- No production compression, lossless, reader-profile, or model-gating behavior changed; Phase 4 adds self-check tooling and stronger compatibility tests.
- No live `~/.zshrc`, launchd, or MCP client configuration was changed.

Verification performed:
- `npm run typecheck`: exit 0 (`tsc --noEmit`; npm printed existing unknown-project-config warnings).
- `npm test -- tests/install.test.ts tests/compatibility-smoke.test.ts tests/reader-profiles.test.ts tests/mcp-recover.test.ts tests/exact-recall-eval.test.ts`: exit 0; 5 files, 37 tests passed.
- `npm run build`: exit 0; emitted dist, bundled CLI, version smoke printed `0.8.0`.
- `npm test`: exit 0; 39 files, 698 tests passed.
- `git diff --check`: exit 0.
- `env -u ANTHROPIC_API_KEY node eval/reader-capacity/run.mjs --dry-run --out /tmp/imgtokenx-reader-capacity-phase4-dry-run.json`: exit 0; rendered 5x8/7x10/9x12 at 280/504/728 image tokens vs 1335 text tokens (79%/62%/45% saved); made no model calls.
- `node bin/cli.js doctor --help`: exit 0; printed `Usage: imgtokenx install|uninstall|doctor [--dry-run] [--skip-mcp] [--port=47821]`.
- `node bin/cli.js install --dry-run --skip-mcp`: exit 0; printed no-write install preview; no files or live config changed.

Remaining risks / next steps:
- A real `imgtokenx doctor` against the user's live LaunchAgent/MCP state was intentionally not run because no real `imgtokenx install` has been executed in this plan.

## Live Installation Verification - 2026-07-09

Performed after explicit user approval:
- `node bin/cli.js install` completed. The first bootstrap attempt was blocked at the sandbox boundary (`launchctl bootstrap ...` error 5); retrying the same approved installer with OS-level launchd permission completed the LaunchAgent and all MCP registrations.
- `node bin/cli.js doctor` with local-network permission passed every check: plist, shell env, zshrc source block, `/healthz`, launchd service, and Claude/Codex/OpenCode `imgtokenx-recover` registrations.
- `launchctl print gui/501/com.imgtokenx.proxy` reported `state = running`, and `lsof -nP -iTCP:47821 -sTCP:LISTEN` confirmed the Node process listening on `127.0.0.1:47821`.
- A fresh interactive shell resolved `claude`, `codex`, and `opencode` as functions. `zsh -ic 'IMGTOKENX_DISABLE=1 claude --version'` exited 0 and printed Claude Code `2.1.205`, confirming the kill-switch bypass.
- `npm test` exited 0: 39 files and 698 tests passed.

Remaining risks:
- No authenticated Anthropic/OpenAI request was sent through a harness during this local install validation, so live upstream credentials and provider behavior remain intentionally unexercised.

# Dashboard Model + Exactness Parity

- [x] Derive dashboard imaging status from `reader-profiles.ts` instead of label-only model chips.
- [x] Show the all-model safe-passthrough contract and the configured-client/auth boundary.
- [x] Unhide OpenAI controls and update Claude-only dashboard copy.
- [x] Add focused dashboard tests for calibrated, uncalibrated, and custom models.
- [x] Run typecheck, build, focused tests, full tests, live restart/health checks, and record final review.

## Final Review - 2026-07-09 (dashboard model/auth parity)

Files changed:
- `README.md` — clarified that Codex support means OpenAI-compatible/API mode and that ChatGPT-auth Codex App sessions are not captured.
- `src/dashboard/fragments.ts` — reader-profile-backed model labels, visible OpenAI scope, Claude Code/OpenCode/Codex API-mode boundary, neutral high-contrast surfaces/focus styles, and removal of gradient text/side-stripe treatment.
- `src/dashboard.ts`, `src/node.ts` — local 204 handling for browser favicon/touch-icon probes so they never reach upstream tracking.
- `tests/dashboard-api.test.ts` — model policy, custom-model escaping, visible OpenAI controls, ChatGPT-auth boundary, and icon-route coverage.
- `tasks/lessons.md`, `tasks/todo.md` — corrected transport/auth lesson and this review.

Behavior changed:
- The dashboard now derives each listed model and profile badge's `image WxH` versus `text only` status from `resolveReaderProfile`; unknown and uncalibrated models are explicitly shown as safe text passthrough.
- Client status is scoped to the user's actual tools: Claude Code, OpenCode, and Codex API mode. It explicitly says Codex App with ChatGPT login runs direct and does not appear in imgtokenx.
- OpenAI model controls are visible. Cloudflare/Google routes are no longer promoted in the dashboard.
- Browser icon probes return locally with 204 and no longer inflate request totals or recent-request rows.

Verification performed:
- `npm test -- tests/dashboard-api.test.ts tests/docs-integrity.test.ts`: exit 0; 2 files, 29 tests passed.
- `npm run typecheck`: exit 0.
- `npm run build`: exit 0; dist emitted and version smoke printed `0.8.0`.
- Initial sandboxed `npm test` run executed all 699 assertions but reported one `listen EPERM` unhandled error from the existing `src/node.ts` import-time server bind. `PORT=0 npm test` with localhost-bind permission then exited 0: 39 files, 699 tests passed.
- `git diff --check`: exit 0.
- Rebuilt LaunchAgent restarted with `launchctl kickstart -k gui/501/com.imgtokenx.proxy`; `imgtokenx doctor` passed all eight live checks, launchd reported `state = running`, and `proxy.err.log` was empty.

Remaining risks:
- Codex App sessions authenticated through a ChatGPT plan bypass the shell wrapper and are not compressed. Supporting them requires a separate, explicit secret-handling/auth-upstream design; no global Codex config or token handling was changed here.
- The in-app browser runtime had no available browser, and the local HTTP content probe was blocked by the environment guard. The server-rendered DOM is covered by tests, but the post-change live page was not screenshot-verified in this session.

# imgtokenx Universal Rename + Model Persistence

- [x] Inventory tracked text, paths, public identifiers, install state, and the dashboard model-toggle flow.
- [x] Persist dashboard model selections atomically to the JSON config and prove restart loading.
- [x] Rename the product, package, CLI, public types, environment variables, paths, service/MCP identifiers, docs, tests, fixtures, and tracked artifacts to `imgtokenx`.
- [x] Verify no tracked text or path retains the old names.
- [x] Run focused tests, typecheck, build, and the complete test suite.
- [ ] Preserve data while migrating the live installation, local repository path, and GitHub origin.
- [ ] Run live doctor/listener checks and record the final review.

Implementation note:
- The first tracked-path rename command escaped Git's NUL delimiter incorrectly and exited before moving any path (`RENAMES 0`, `DELETES 0`). The retry uses `String.fromCharCode(0)` and starts from the unchanged path set.
- The first full sandboxed suite passed all 40 files and 703 assertions but failed on one unhandled `listen EPERM`: `src/mcp.ts` imported recovery helpers from executable `src/node.ts`, which started the server during test import. Recovery helpers were moved to side-effect-free `src/recovery.ts` before retrying.

Migration blocker:
- The approval service rejected the preserved old uninstaller before execution because its usage allowance was exhausted. The running legacy service and data remain untouched. The new `~/.config/imgtokenx/config.json` was safely written with the seven models checked in the supplied dashboard screenshot and mode `0600`.
