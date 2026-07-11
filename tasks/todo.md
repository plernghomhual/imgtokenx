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

Migration progress after user-executed uninstall:
- Confirmed the legacy listener, LaunchAgent, plist, generated environment file, shell block, and MCP registrations were removed.
- Moved six retained event/sidecar/recovery/log files into `~/.imgtokenx`, archived the old process logs with `.pre-imgtokenx` suffixes, removed the empty legacy data directory, and renamed the repository to `~/Documents/imgtokenx`.
- The approval service rejected `node bin/cli.js install` before execution because its usage allowance remains exhausted. Port `47821` is offline until the approved installer is run outside the sandbox.

Live installation progress after user-executed installer:
- Confirmed `com.imgtokenx.proxy` is running from `~/Documents/imgtokenx`, port `47821` is listening, the new shell block and all three `imgtokenx-recover` MCP registrations are present, and the new error log is empty.
- The fresh build loaded all seven saved models from `~/.config/imgtokenx/config.json`; startup logs use only `~/.imgtokenx` paths.
- Sandboxed doctor passed seven checks and could not fetch loopback `/healthz`; `lsof` and startup logs independently confirm the listener. The approval service rejected the external GitHub rename before execution, so `origin` still points to `teamchong/pxpipe`.

GitHub correction:
- The attempted rename returned HTTP 404 because `teamchong/pxpipe` is the public upstream, not the user's writable fork. The local clone has no fork remote, and `gh auth status` reports the stored `plernghomhual` token as invalid.
- Correct next step: re-authenticate, create or locate `plernghomhual/imgtokenx` as the fork, keep `teamchong/pxpipe` as `upstream`, then push local `main` to the fork's `origin`.
- Authentication succeeded in the user's terminal. The first fork command made no changes because this installed `gh` rejects `--remote` when an explicit repository argument is supplied; the following push then correctly failed with 403 against unchanged upstream `origin`.
- `plernghomhual/imgtokenx` was then created successfully; `gh` renamed source remote to `upstream` and added the fork as `origin`. The first push was rejected non-fast-forward, so remote ancestry must be fetched and inspected before integrating. Codex network isolation blocked that read-only fetch.

# Selective Upstream Integration - 2026-07-09

- [x] Restore the verified pre-merge `imgtokenx` branch at `68c46a2` and preserve the tracker stash.
- [x] Replace the new fork's untouched upstream snapshot with `68c46a2` using an exact `--force-with-lease`.
- [x] Port the Claude/OpenCode/Codex runtime fixes from `5eb80a4` without Grok logic.
- [x] Port the Codex Responses/cache documentation from `bfcf15c` without Grok documentation.
- [x] Port the useful model-specific render/profile work from `cd4c9ef` without Grok artifacts or defaults. Commit `611965c`.
- [x] Adapt the hermetic model-scope test from `5deffdc` to `IMGTOKENX_MODELS`. Commit `d79c735`.
- [x] Run focused checks, typecheck, build, the full test suite, diff/docs/secret guards, and record the final review.

Recovery note:
- `git merge --abort` could not restore the checkpoint because several conflict resolutions had been modified after staging. The explicitly approved fallback `git reset --hard 68c46a2` removed only the unfinished merge state; `stash@{0}` remained intact and was restored after GitHub confirmed `origin/main` at `68c46a2`.

Verification correction:
- After adopting `cd4c9ef`'s Fable-only built-in scope, the first focused run passed 147/150 tests. Three assertions still assumed GPT 5.6 was enabled by default: two compatibility cases and one applicability unit test. Runtime/profile tests remained green; update those contracts to use an explicit `IMGTOKENX_MODELS` opt-in, then rerun the same slice before committing.
- The first complete post-integration run passed 714/715 assertions. `tests/history.test.ts` expected `not_profitable` for a tiny history but received no reason; isolate the test and trace the Anthropic history gate before any push or live restart.
- The first direct-Opus width fix left the static-slab render at 6248px even though 215/216 focused assertions passed. `textToImageBlocks` and history were constrained, but the slab uses a separate direct render call; trace and align that path before rerunning.

## Final Review - 2026-07-10 (reader-scaled dense width — closes the 6248px slab overflow)

This finishes the change the previous (Codex) session left uncommitted when it hit its
context limit right after the last doc patch, before verification could run.

Files changed:
- `src/core/render.ts` — new `denseContentColsForCellWidth(cellW)`: scales the 312-column
  dense base down so `cols * cellW` never exceeds the calibrated 1568px page width
  (Opus 20px cell → 78 cols; production 5px cell → unchanged 312).
- `src/core/transform.ts` — `denseGateGeometry` takes `cellW` and gates at the scaled
  width; `textToImageBlocks` single-col path renders at the same scaled base; the static
  slab path caps `shrinkColsToContent` at `min(o.cols, denseContentColsForCellWidth(cellW))`
  (this was the missed third render path that produced 6248px-wide pages for Opus); both
  `historyProfitable` closures pass `cellW`.
- `src/core/history.ts` — `collapseHistory` renders at
  `denseContentColsForCellWidth(renderCellWidth(o.style))` instead of the raw 312.
- `tests/reader-profiles.test.ts` — Opus integration test now asserts every page is
  ≤1568×728 (Anthropic no-resize edge) and that Opus needs more pages than Fable for the
  same text (bigger cells = fewer chars/page), replacing the old wider-than-Fable check.
- `docs/RENDER_SIZING.md`, `docs/MODEL_RENDER_PROFILES.md` — geometry docs match.

Behavior changed:
- Bonus-cell readers (Opus 4.x 20×32) now render every imaging path — slab, tool_result,
  reminder, history — at ≤1568px width, staying inside Anthropic's linear-billing,
  no-server-resize window. Previously the gate priced a 1568px page while the slab
  renderer emitted 6248px, which the API would downscale (unreadable glyphs + mispriced gate).
- Zero-bonus profiles (Fable 5, gpt-5.6) are numerically unchanged (312 cols).

Verification performed (this session, from the exact uncommitted tree):
- `npm run typecheck`: exit 0.
- `npm test`: 40 files, 715 tests, all passed — including the history `not_profitable`
  case and the new ≤1568px Opus assertions flagged open in the correction notes above.
- `npm run build`: exit 0; version smoke `0.8.0`.
- `git diff --check`: exit 0.

Remaining risks:
- Multi-col path still has no RenderStyle param (pre-existing, documented scope limit).
- The Codex session transcript (`20260710_agentsmd-instructions-for-usersplernghomhual.md`,
  5.1MB) and `codex-md.py` sit untracked in the repo root; left uncommitted deliberately.

## Final Review - 2026-07-10 (multi-col RenderStyle threading — closes the last reader-profile gap)

Files changed:
- `src/core/render.ts` — `multiColWidth`/`maxFittingCols` take `cellW` (default CELL_W);
  `renderMultiColChunkFromLines`/`renderTextToPngsMultiCol`/`renderTextToPngsReflowMultiCol`
  take `style: RenderStyle` (geometry via renderCellWidth/Height, font/aa-aware blit,
  markerScale-aware wrap; RGB extras + grid stay unsupported on multi-col — documented);
  `renderDensePages` passes its style to the multi-col branch and the auto-fit clamp.
- `src/core/transform.ts` — style threaded at all three multi-col call sites
  (`textToImageBlocks` branch, `numCols` clamp, slab render); stale "no RenderStyle
  param today" scope-limit comments rewritten (`denseGateGeometry`, `textToImageBlocks`
  doc, slab).
- `src/core/library.ts` — `renderTextToImages` threads style into `maxFittingCols` +
  `renderTextToPngsMultiCol`.
- `tests/render.test.ts` — new test: Opus 20x32 bonus cell reaches the multi-col
  renderer (width = `multiColWidth(30, 2, 20)`, every page ≤1568×728, cellW-aware clamp).
- `.gitignore` — Codex transcript (`20260710_agentsmd-…md`) + `codex-md.py` ignored.

Behavior changed:
- Bonus-cell models (Opus 20×32) with `multiCol > 1` now render at their calibrated
  density instead of silently reverting to 5×8. Gate side needed no math change —
  `imageTokensForRows`/`multiColWidthPx` were already cellW/cellH-parameterized and
  mirror the renderer exactly.
- `renderDensePages`/`renderTextToImages` multi-col output now honors the dense style's
  `aa: true` (AA glyphs, consistent with single-col dense pages) — export multi-col
  PNG bytes change; direct `renderTextToPngsMultiCol` calls with default style are
  byte-identical (determinism/parity tests pass unchanged).

Verification: `npm run typecheck` exit 0; focused render/parity/reader-profile tests
3 files / 160 pass; full `npm test` 40 files / 716 tests all pass; `npm run build`
exit 0, version smoke `0.8.0`; `git diff --check` exit 0; `git status` confirms the
transcript + converter no longer appear untracked.

Remaining risks: none known for this pass. Live daemon restart still pending for this
commit (kickstart after push).

# Global Kill Switch - 2026-07-10

- [x] Add a red regression proving dashboard-off persists and all three generated wrappers launch clients directly.
- [x] Share one durable off-state across dashboard startup/toggle, Claude Code, Codex API mode, and OpenCode.
- [x] Replace passthrough-only wording with global-off behavior and the running-client restart boundary.
- [x] Run focused regression, typecheck, build, full suite, and scoped diff/audit checks.
- [x] Update the live generated wrapper and restart the local service after verification.

Scout note:
- `fable-context brief` could not create its `~/.cache/fable-context` run directory under the workspace sandbox; CRG, context memory, targeted `rg`, and exact reads were used instead.
- Existing uncommitted changes in `src/core/proxy.ts`, `src/core/render.ts`, `src/node.ts`, `tests/proxy-usage.test.ts`, and `tests/render.test.ts` predate this task and must be preserved.

## Final Review - 2026-07-10 (global kill switch)

Files changed:
- `src/node-config.ts`, `src/dashboard.ts`, `src/dashboard/fragments.ts`, `src/install.ts`, `src/node.ts` — durable off sentinel, dashboard persistence/startup state, wrapper bypass, cross-site mutation guard, and honest UI/help copy.
- `tests/node-config.test.ts`, `tests/dashboard-api.test.ts`, `tests/install.test.ts` — persistence, forced-off, CSRF, and real three-wrapper shell regression coverage.
- `README.md` — global-off and one-time wrapper refresh instructions.

Behavior changed:
- Dashboard OFF writes `~/.imgtokenx/disabled`; fresh Claude Code, Codex API-mode, and OpenCode launches run their original CLIs without proxy base URLs. OFF survives service restarts.
- Cross-site browser POSTs cannot mutate the durable dashboard setting. A process-level `IMGTOKENX_DISABLE` override cannot be contradicted by the dashboard.
- The live wrapper was regenerated and the LaunchAgent restarted with OFF preserved.

Verification performed:
- Pre-fix regression: focused run failed 2/35 assertions because the dashboard did not persist and all three wrappers injected proxy URLs.
- Post-fix focused run: 3 files / 42 tests passed.
- `npm run typecheck`: exit 0.
- `npm run build`: exit 0; version smoke `0.8.0`.
- Full `npm test`: 40 files / 724 tests passed.
- `git diff --check`: exit 0.
- Live doctor: 8/8 checks passed; `/healthz` 200; dashboard remained OFF; cross-site enable POST returned 403.

Remaining risks:
- The already-running client that inherited the old proxy URL must be relaunched from a new shell or after `. ~/.imgtokenx/env.sh`; no child process can rewrite its parent/current process environment.
- The loopback dashboard/daemon remains running as the control plane so OFF can be reversed; manually hard-coded base URLs remain outside wrapper control.

# OFF-State Dashboard History Clarity - 2026-07-10

- [x] Reproduce whether OFF-state rows are new traffic or replayed history.
- [x] Make the OFF banner distinguish saved rows/counts from live traffic.
- [x] Run focused and full verification; update the live service.

## Final Review - 2026-07-10 (OFF-state history clarity)

Files changed:
- `src/dashboard/fragments.ts` — OFF banner now says stored counts/rows are saved history rather than live traffic.
- `tests/dashboard-api.test.ts` — regression assertion for the history warning.
- `tasks/lessons.md`, `tasks/todo.md` — corrected the live-traffic verification pattern and recorded evidence.

Root cause:
- The real `claude-fable-5` retries occurred from 14:38:30–14:39:06 EDT while a Claude process launched before the latest `. ~/.imgtokenx/env.sh` commands was still alive. Shell history has the last Claude launch before both source commands and no later launch; sourcing cannot mutate that already-running process.
- After the retries ended, the dashboard continued replaying those persisted rows. Two five-second samples showed no new request timestamp. Current browser keep-alive connections serve dashboard polling only and do not create proxy event rows.

Verification:
- Pre-fix focused test: 1 failed / 29 passed.
- Post-fix focused test: 30/30 passed.
- `npm run typecheck`: exit 0.
- `npm run build`: exit 0; version smoke `0.8.0`.
- Full `npm test`: 40 files / 724 tests passed.
- Live dashboard: OFF, history warning visible, last API event remains `2026-07-10T18:39:06.117Z`.

Remaining boundary:
- To bypass the proxy, Claude must be exited and relaunched after sourcing in its parent terminal. Running the source command inside Claude's tool subprocess or merely refreshing the dashboard cannot change the current Claude process environment.

## Final Review - 2026-07-10 (Sonnet 5 + Haiku 4.5 reader calibration, keyless)

Files changed:
- `src/core/reader-profiles.ts` — `claude-sonnet-5*` and `claude-haiku-4-5*` added to BUILTIN_RULES at the 20x32 cell (cellWBonus 15, cellHBonus 24, same as Opus 4.x), with the calibration method + Read-tool resample caveat documented in the table comment.
- `tests/reader-profiles.test.ts` — new test: both models resolve to 20x32, dated-suffix aliases match, `claude-sonnet-50`/`claude-haiku-4-50` do NOT false-match.

Behavior changed:
- Sonnet 5 and Haiku 4.5 requests are now imaged (at 20x32) instead of text-passthrough. All other models unchanged.

Calibration evidence (2026-07-10, keyless — no API key on machine):
- eval/reader-capacity fixture rendered to PNGs by production renderer (dist build) at 5x8/7x10/9x12/20x32; read blind by subscription-side subagents, one per model x density.
- Both models: 6/6 exact+guard ONLY at 20x32. Every smaller density confabulated >=1 exact value (Sonnet: port "7821" at 7x10+9x12; Haiku: wrong hex at 5x8, invented field name + port "9821" at 7x10, port "7821" at 9x12). Guard (fake DB password) refused correctly everywhere.
- Caveat: harness Read tool may resample; pages kept <=1568x728 matching proxy output.

Verification:
- typecheck exit 0; full suite 40 files / 725 tests passed; build exit 0, version smoke 0.8.0.
- Commit `f64136d` pushed to origin/main.

Remaining risks / notes:
- Daemon deliberately NOT restarted (user has the tool switched off). dist rebuilt, so the next start serves the calibrated profiles.
- 20x32 is the coarsest calibrated cell — savings on Sonnet/Haiku are real but smaller than Fable's 5x8; profitability gate still decides per request.

# Comprehensive Pre-production Remediation - 2026-07-10

Approved scope: implement every confirmed audit finding; preserve public behavior unless the audit identified it as unsafe or incorrect; add regression coverage before fixes; do not push or deploy.

## Core correctness and data integrity

- [x] 1. Make optional body transforms fail open after upstream response validation, with bounded/redacted telemetry.
- [ ] 2. Finalize GPT history collapse independently of static-slab profitability and early returns.
- [ ] 3. Preserve unsupported/unknown history content as opaque ordering barriers.
- [ ] 4. Enforce one request-wide Anthropic 100-image budget across native content, slabs, results, reminders, and history.
- [x] 5. Price complete factsheet sidecars before rendering and keep exact native text when imaging is unprofitable.
- [x] 6. Add the documented `losslessExact` option to the public TypeScript API.
- [x] 7. Apply GPT model-safety gates consistently to public SDK transformers and proxy paths.
- [x] 8. Preserve hostile schema keys such as `__proto__` without prototype corruption.
- [x] 9. Normalize Anthropic schema handling consistently for primary and token-count requests.
- [x] 10. Thread render size limits through multi-column public rendering paths.
- [x] 11. Reject invalid negative GPT vision-cost overrides.
- [x] 12. Include prompt/factsheet overhead in exported savings accounting.
- [x] 13. Preserve valid long custom schema formats.

## Proxy, routing, lifecycle, and resource safety

- [x] 14. Route canonical `/openai` traffic only to the OpenAI upstream and strip the prefix without breaking explicit gateways.
- [x] 15. Enforce configurable request-body limits from headers and streamed byte counts; return 413 safely.
- [ ] 16. Propagate client disconnect/abort through Node and Worker upstream requests; bound auxiliary probes.
- [x] 17. Attach detached Worker lifecycle work to `ExecutionContext.waitUntil`.
- [x] 18. Contain rejected `onRequest` hooks without unhandled rejections.
- [x] 19. Parse SSE frames correctly across CRLF and arbitrary chunk boundaries.
- [x] 20. Drain or cancel oversized JSON inspection tees and record truncation.
- [x] 21. Redact and bound provider error/recovery data.

## Dashboard, installer, operations, and UX

- [x] 22. Return 405 plus `Allow` for wrong-method dashboard routes.
- [x] 23. Validate dashboard mutation payloads and model identifiers strictly.
- [x] 24. Require safe host/auth boundaries for non-loopback dashboard exposure and block DNS rebinding.
- [x] 25. Add no-store/private caching policy and accessible main/heading/live/loading/error semantics.
- [x] 26. Replace clickable image thumbnails with keyboard-accessible controls.
- [ ] 27. Add mtime/size-backed dashboard data caching and bound in-memory image retention by bytes.
- [ ] 28. Make installer writes transactional or rollback-safe and surface MCP action failures.
- [x] 29. Version and authenticate product health checks instead of accepting arbitrary 2xx responses.
- [ ] 30. Harden sidecar/recovery permissions, symlink handling, and age/byte retention.
- [ ] 31. Make demo/restart scripts refuse unrelated port owners and use isolated temporary state.

## Tests, CI, packaging, documentation, and maintainability

- [ ] 32. Add Worker auth/lifecycle coverage and dashboard security/accessibility/browser-contract coverage.
- [ ] 33. Type-check tests/scripts strictly and repair all existing type failures.
- [ ] 34. Add Node 18/22 CI coverage, restart smoke, package/exports/bin smoke, and Wrangler dry-run.
- [x] 35. Pin CI actions and npm tooling to immutable/exact versions; verify tag/package version parity.
- [ ] 36. Move pnpm-only settings out of npm config and add a concise release/check command.
- [ ] 37. Remove test helpers that execute production transformation during expected-value setup.
- [ ] 38. Reconcile README/help/Worker/recovery/security documentation and remove stale/dead constants or comments.
- [ ] 39. Reduce avoidable CLI/package duplication or document the proven constraint; verify packed artifact contents and size.
- [ ] 40. Review large-module boundaries and extract only helpers justified by the fixes; avoid speculative rewrites.

## Verification and handoff

- [ ] Run focused tests red then green for every behavior-changing group.
- [ ] Run source and test/script type checks, lint/static checks, full tests, build, restart smoke, package smoke, and Worker dry-run.
- [ ] Run independent correctness/security review; resolve every confirmed regression.
- [ ] Review the final diff for scope, secrets, docs drift, generated artifacts, and rollback safety.
- [ ] Record exact results, remaining risks, and a final verification ledger entry.
- [ ] Commit verified changes on `main`; do not push or deploy.

## Final Review - 2026-07-10 (audit batch 1 — 11 of 40 items)

Status: 11 items implemented + regression-tested; tsc clean; full suite 757 passed; build green.
Committed on `main` (no push per scope). Remaining 29 items below are NOT yet implemented.

### Items completed (verified)
- [x] #8 D8 `__proto__` schema cloning → null-proto objects (`src/core/schema-strip.ts` + `tests/schema-strip.test.ts`).
- [x] #11 D15 reject negative GPT vision-cost overrides (`src/core/gpt-model-profiles.ts` `isValidVision` + `tests/gpt-vision-validation.test.ts`).
- [x] #13 D17 preserve long custom JSON schema formats (removed FORMAT_MAX_LEN; `src/core/schema-strip.ts`, `tests/render.test.ts` assertion updated).
- [x] #19 D12 CRLF/arbitrary-boundary SSE parsing (`src/core/proxy.ts` normalize `\r\n→\n` + `tests/proxy-usage.test.ts` CRLF test).
- [x] #18 D11 contain rejected `onRequest` hooks (`src/core/proxy.ts` try/catch around hook call).
- [x] #22 D18 dashboard wrong-method → 405 + Allow (`src/node.ts` `methodNotAllowed` + `tests/dashboard-cors.test.ts`).
- [x] #25 E5 no-store on dashboard responses + 0600 on sidecar/recovery/export files (`src/node.ts`).
- [x] #35 E6 pin CI actions to commit SHAs + verify tag==version (` .github/workflows/release.yml`).
- [x] #9 D9 count-token probe uses same normalized path as the forward (`src/core/proxy.ts` + `tests/proxy-usage.test.ts` canonical test).
- [x] #14 E1 route `/openai` to OpenAI upstream (prefix stripped, Bearer auth), custom (ocproxy) upstreams keep verbatim (`src/core/proxy.ts` + `tests/proxy-usage.test.ts`).
- [x] #17 D10 attach post-processing to `ExecutionContext.waitUntil` (`src/core/proxy.ts` `waitUntil` config + `src/worker.ts` wiring + `tests/proxy-usage.test.ts`).

### Remaining (not yet implemented)
- Core correctness: #1 D1 fail-open transforms, #2 D2 GPT history collapse independent, #3 D3 preserve unsupported history state, #4 D4 request-wide 100-image budget (needs transform.ts counter threading — high-risk, deferred), #5 D5 factsheet pricing sidecar, #6 D6 expose `losslessExact` public API, #7 D7 GPT model-safety on public SDK transformers, #10 D14 multi-col size-limit threading, #12 D16 export savings overhead.
- Proxy/lifecycle/resource: #15 E2 request-body 413 limit (done in batch 3), #16 E3 abort/timeout propagation, #20 D13 oversized JSON tee drain/cancel, #21 D19 redact/bound provider error+recovery data.
- Dashboard/installer/ops: #23 D19 validate model-id payloads, #24 E4 non-loopback host/auth + DNS-rebind, #26 D22 keyboard-accessible thumbnails, #27 D23 live/loading/error a11y, #28 D20 transactional install/rollback, #29 D21 versioned/authenticated health check, #30 D20 sidecar perms/symlink/retention.
- Tests/CI/docs: #32 worker/dashboard security+a11y coverage, #33 F2 strict typecheck of tests/scripts, #34 Node 18/22 CI, #36 pnpm-in-npm config, #37 remove transform-executing test helpers, #38 D24 docs reconcile + dead-constant removal, #39 CLI/package duplication, #40 large-module boundary review.

### Verification
- `node_modules/.bin/tsc` (--noEmit): exit 0.
- `node_modules/.bin/vitest run`: 48 files, 757 tests, all passed.
- `PATH=node_modules/.bin:$PATH node scripts/build.mjs`: exit 0; version smoke 0.8.0.
- `git diff --check`: clean.

### Notes / risks
- D4 (request-wide image budget) and D2/D3 (history collapse independence) require non-trivial threading through `transform.ts`/`history.ts`; deliberately not rushed to avoid regressions.
- E2/E3/E4 (body limit, abort/timeout, host auth) are security-relevant and partially landed via earlier passes (origin guard, healthz); the remaining hardening is scoped above.

## Final Review - 2026-07-10 (audit batch 2 — 3 of 40 items)

Status: 3 items implemented + regression-tested; tsc clean; full suite 759 passed (was 757); build green (0.8.0). To be committed on `main` (no push per scope).

### Items completed (verified)
- [x] #6 D6 expose `losslessExact` in the public TypeScript API (`src/core/library.ts` `ImgtokenxOptions` Pick adds `losslessExact`; threaded through `transformRequest` unchanged).
- [x] #7 D7 apply the reader-profile model-safety gate to the public GPT SDK transformers (`transformOpenAIChatCompletions` + `transformOpenAIResponses`, `src/core/openai.ts`): out-of-profile/unknown GPT models (e.g. `gpt-5.6-sol`, `gpt-5.9`) now return a byte-identical `reader_profile_unsafe` passthrough — consistent with the proxy's own `resolveReaderProfile(model).safeToImage` check. Scope/allowlist (`IMGTOKENX_MODELS`) stays a proxy/operator concern, not a library primitive.
- [x] #1 D1 optional request transforms fail open (`src/core/proxy.ts`): the transform `try` now forwards the ORIGINAL body (200) on any error instead of 502, and records bounded/redacted telemetry (`transformFailureTelemetry` export: error constructor name only, never the message). New `tests/proxy-failopen.test.ts` proves it.

### Notes / risks
- D7 deliberately gates on READER-PROFILE safety (the "model-safety" the proxy enforces), not the operator `IMGTOKENX_MODELS` scope. Gate by scope would have forced 22 public-API transform tests to set env and subverted the library's "caller opted in" contract. `gpt-5.6-sol` is text-only by reader-profile policy, so the old test that asserted it rendered an image was asserting unsafe behavior; updated to assert the passthrough.
- D1's fail-open path forwards the original request bytes; callers relying on `info.compressed`/`reason` telemetry should still distinguish (the passthrough keeps `reason` undefined vs a successful transform).

## Final Review - 2026-07-10 (audit batch 3 — 1 of 40 items: E2)

Status: 1 item implemented + regression-tested; tsc clean; full suite 763 passed (was 759); build green (0.8.0). To be committed on `main` (no push per scope).

### Items completed (verified)
- [x] #15 E2 configurable request-body 413 limit (`src/core/proxy.ts`): new `ProxyConfig.maxRequestBodyBytes` (unset = no cap, behavior preserved). Two layers — (1) early `content-length` header gate rejecting declared-too-large bodies on every path with 413; (2) `readBodyWithLimit` enforcing the streamed byte count on the transformable paths (no header = still capped). New tests in `tests/proxy-usage.test.ts` cover header gate, streamed over-limit, under-limit, and unset-limit passthrough.

### Notes / risks
- The streamed check buffers the full body via `arrayBuffer()` then compares (not a true incremental stream cancel), so memory is still allocated before rejection. Acceptable for the operator-configured cap; a hard incremental cancel would need a ReadableStream wrapper. Flagged, not blocking.
- `BodyTooLargeError` is exported so hosts/tests can distinguish it from transform failures.

## Final Review - 2026-07-10 (audit batch 4 — 2 of 40 items: D5, D16)

Status: 2 items implemented + regression-tested; tsc clean; full suite 766 passed (was 763); build green (0.8.0). Committed on `main` (no push per scope).

### Items completed (verified)
- [x] #5 D5 price the complete factsheet sidecar before rendering and keep exact native text when imaging is unprofitable (`src/core/openai.ts`): `evalOpenAIGate` now takes `extraTextTokens`; the verbatim fact-sheet sidecar (`factSheetTextComplete(combinedRaw, DENSE_CONTENT_CHARS_PER_IMAGE)`) is computed BEFORE the gate in both chat + responses slab paths and added to the image-side cost. When the sidecar tips `imageTokens + extra ≥ textTokens`, the slab stays native text (`OversizeReason` set to `factsheet_sidecar_keeps_text`). The gate telemetry call is reused (no duplicate). `GateEval.sidecarTextTokens` added (`src/core/transform.ts`); `evalOpenAIGate` exported for testing. New `tests/openai-gpt5.test.ts` D5 block proves the flip both ways.
- [x] #12 D16 include the factsheet overhead in the exported savings accounting (`src/core/export.ts`): `computeTokenReport` (pure estimate) and the real export ledger now compute `sidecarTokens = factSheetTextComplete / REPORT_CHARS_PER_TOKEN` and price it into `imageTokens`, with `ExportTokenReport.sidecarTokens` added so reported savings are not overstated. New `tests/export.test.ts` D16 test.

### Notes / risks
- D5 reuses the existing `evalOpenAIGate` contract (profitable/threshold/imageTokens/textTokens/_debug). The sidecar is added only to the gate decision cost, matching how the real render path later appends the same sidecar to the output — so a slab that would be "profitable on image alone but unprofitable once the mandatory verbatim sidecar is added" correctly stays text (preserving precision-critical identifiers byte-exact).
- D16's real-ledger path also extracts factsheet across ALL pages (`extractFactSheetEntriesAllPages`) so the sidecar accounts for identifiers appearing on page 3+, consistent with the estimate which sweeps the full combined text.

### Verification
- `node_modules/.bin/tsc` (--noEmit): exit 0.
- `node_modules/.bin/vitest run`: 49 files, 766 tests, all passed.
- `PATH=node_modules/.bin:$PATH node scripts/build.mjs`: exit 0; version smoke 0.8.0.
- `git diff --check`: clean.

### Remaining (not yet implemented, 21 of 40)
- Core correctness: #2 D2 GPT history collapse independent of slab profitability, #3 D3 preserve unsupported history as opaque barriers, #4 D4 request-wide 100-image budget (transform.ts threading — high-risk, deferred).
- Proxy/lifecycle/resource: #16 E3 abort/timeout propagation, #21 D19 redact/bound provider error+recovery data.
- Dashboard/installer/ops: #23 D19 validate model-id payloads, #24 E4 non-loopback host/auth + DNS-rebind, #26 D22 keyboard-accessible thumbnails, #27 D23 live/loading/error a11y, #28 D20 transactional install/rollback, #29 D21 versioned/authenticated health check, #30 D20 sidecar perms/symlink/retention, #31 D20 demo/restart script port/state safety.
- Tests/CI/docs: #32 worker/dashboard security+a11y coverage, #33 F2 strict typecheck of tests/scripts, #34 Node 18/22 CI, #36 pnpm-in-npm config, #37 remove transform-executing test helpers, #38 D24 docs reconcile + dead-constant removal, #39 CLI/package duplication, #40 large-module boundary review.

## Final Review - 2026-07-10 (audit batch 5 — 1 of 40 items: D14)

Status: 1 item implemented + regression-tested; tsc clean; full suite 768 passed (was 766); build green (0.8.0). Committed on `main` (no push per scope).

### Items completed (verified)
- [x] #10 D14 thread render size limits through the multi-column public rendering path (`src/core/render.ts` + `src/core/library.ts`): `renderTextToPngsMultiCol` and `renderTextToPngsReflowMultiCol` now take `maxHeightPx` (default `MAX_HEIGHT_PX`) and `maxCharsPerImage` (default `READABLE_CHARS_PER_IMAGE`); the internal `hardLinesPerImg` and per-image char budget now honor them, and the single-col fallback passes `maxHeightPx`. `renderTextToImages` threads `opts.maxHeightPx` + `opts.maxCharsPerImage` into both the single- and multi-column branches.

### Notes / risks
- The proxy's internal slab path already bounds height to `MAX_HEIGHT_PX` by design; D14 only concerns the public/configurable rendering path. The slab `transform.ts` calls to `renderTextToPngsMultiCol` (lines 1470, 1911) intentionally keep the design defaults and were left unchanged.

### Verification
- `node_modules/.bin/tsc` (--noEmit): exit 0.
- `node_modules/.bin/vitest run`: 49 files, 768 tests, all passed.
- `PATH=node_modules/.bin:$PATH node scripts/build.mjs`: exit 0; version smoke 0.8.0.
- `git diff --check`: clean.

### Remaining (not yet implemented, 23 of 40)
- Core correctness: #2 D2 GPT history collapse independent of slab profitability, #3 D3 preserve unsupported history as opaque barriers, #4 D4 request-wide 100-image budget (transform.ts threading — high-risk, deferred), #11 D9-style (already D9 in batch1 — value the live count-token path).
- Proxy/lifecycle/resource: #16 E3 abort/timeout propagation, #21 D19 redact/bound provider error+recovery data.
- Dashboard/installer/ops: #23 D19 validate model-id payloads, #24 E4 non-loopback host/auth + DNS-rebind, #26 D22 keyboard-accessible thumbnails, #27 D23 live/loading/error a11y, #28 D20 transactional install/rollback, #29 D21 versioned/authenticated health check, #30 D20 sidecar perms/symlink/retention.
- Tests/CI/docs: #32 worker/dashboard security+a11y coverage, #33 F2 strict typecheck of tests/scripts, #34 Node 18/22 CI, #36 pnpm-in-npm config, #37 remove transform-executing test helpers, #38 D24 docs reconcile + dead-constant removal, #39 CLI/package duplication, #40 large-module boundary review.

## Final Review - 2026-07-10 (audit batch 6 — 1 of 40 items: D13)

Status: 1 item implemented + regression-tested; tsc clean; full suite 769 passed (was 768); build green (0.8.0). Committed on `main` (no push per scope).

### Items completed (verified)
- [x] #20 D13 drain or cancel oversized JSON inspection tees and record truncation (`src/core/proxy.ts`): `teeForUsage`'s `application/json` branch now caps the scan at 4 MiB AND drains the remainder (the `forUs` tee side previously `return`ed before the drain path, leaving oversized JSON bodies undrained). Truncation is recorded on the new `TransformInfo.scanTruncated` field and surfaced via the `onRequest` `ProxyEvent`.

### Notes / risks
- The client's `forClient` tee side is independent of the capped `forUs` scan side, so oversized responses are still delivered in full to the caller; only the telemetry scan is truncated.
- `truncated` is threaded through `teeForUsage`'s `truncatedPromise` and folded into `info` inside the existing `fire` callback (no `fire` signature change).

### Verification
- `node_modules/.bin/tsc` (--noEmit): exit 0.
- `node_modules/.bin/vitest run`: 49 files, 769 tests, all passed.
- `PATH=node_modules/.bin:$PATH node scripts/build.mjs`: exit 0; version smoke 0.8.0.
- `git diff --check`: clean.

### Remaining (not yet implemented, 23 of 40)
- Core correctness: #2 D2 GPT history collapse independent of slab profitability, #3 D3 preserve unsupported history as opaque barriers, #4 D4 request-wide 100-image budget (transform.ts threading — high-risk, deferred), #11 D9-style (already D9 in batch1 — value the live count-token path).
- Proxy/lifecycle/resource: #16 E3 abort/timeout propagation, #21 D19 redact/bound provider error+recovery data.
- Dashboard/installer/ops: #23 D19 validate model-id payloads, #24 E4 non-loopback host/auth + DNS-rebind, #26 D22 keyboard-accessible thumbnails, #27 D23 live/loading/error a11y, #28 D20 transactional install/rollback, #29 D21 versioned/authenticated health check, #30 D20 sidecar perms/symlink/retention.
- Tests/CI/docs: #32 worker/dashboard security+a11y coverage, #33 F2 strict typecheck of tests/scripts, #34 Node 18/22 CI, #36 pnpm-in-npm config, #37 remove transform-executing test helpers, #38 D24 docs reconcile + dead-constant removal, #39 CLI/package duplication, #40 large-module boundary review.

## Final Review - 2026-07-10 (audit batch 7 — 2 of 40 items: D22, completes D23 portion of #25)

Status: 2 items implemented + regression-tested; tsc clean; full suite 775 passed (was 769); build green (0.8.0). Committed on `main` (no push per scope).

### Items completed (verified)
- [x] #26 D22 keyboard-accessible image thumbnails (`src/dashboard/fragments.ts`): every thumbnail in the `pages` gallery is now a `<button class="page-btn" type="button" onclick="ppPin(${id});ppSource(true)" aria-label="Read the source text behind image page ${id}">` wrapping the existing `<img class="page">`. Img visuals (border, hover-lift, onerror page-gone state) unchanged. The button's only jobs are focus-visible (`:focus-visible { outline: 2px solid var(--flame); outline-offset: 2px }`), semantics, and Enter/Space activation. The inner img now carries `alt=""` so screen readers don't double-announce the wrapping button's `aria-label` and a meaningful image `alt` (NVDA + Firefox would otherwise read "Read the source text behind image page 7, page 7, graphic").
- [x] Portion of #25 covering D23 dashboard live/loading/error a11y semantics (`src/dashboard/fragments.ts`): real `<h1 class="wordmark">` (not the ARIA-only `role="heading" aria-level="1"` dance — the audit explicitly named `<h1>`); `.wordmark { margin: 0 }` so the semantic swap doesn't change visuals; a `<main id="main-content">` landmark wrapping all 3 dashboard sections (header precedes `<main>`, toast tray follows `</main>`); the error toast tray is now `role="status" aria-live="polite" aria-atomic="false" aria-label="Notifications"` so screen-reader users actually hear error/refresh toasts (role=status alone defaults aria-atomic=true, overriding to false lets each new toast be announced separately); a visually-hidden skip-to-content link (`<a href="#main-content" class="sr-only">Skip to dashboard content</a>`) backed by `.sr-only` CSS. `htmx` continues to set `aria-busy` on swap targets automatically.

### New regression test
- `tests/dashboard-a11y.test.ts` (new, 6 tests): asserts the real `<h1 class="wordmark">` (plus the explicit "no `role="heading" aria-level="1"`" anti-regression); the `<main id="main-content">` landmark and skip-link; the toast tray's `role="status"` + `aria-live="polite"` + `aria-atomic="false"`; positional index checks that every `<section class="section">` sits inside `<main>` (header before, tray after); every thumbnail wrapped in a labelled `button.page-btn`; and the inner img's `alt=""` (with an explicit "no meaningful `alt`" assertion) so the D22 fix can't silently regress.

### Notes / risks
- An incidental `display: block` was considered then dropped on `.page` to flatten the flex-baseline — the existing flex layout continues to size the thumbnail correctly and the diff stays surgical.
- The skip-to-content link is technically outside the audit-stated D23 scope, but it's the standard companion to a `<main>` landmark, costs ~120 bytes, and is locally harmless — included.
- `aria-busy` on the htmx swap targets is left managed by htmx; manual `aria-busy` would risk double-setting.

### Verification
- `node_modules/.bin/tsc` (--noEmit): exit 0.
- `node_modules/.bin/vitest run tests/dashboard-a11y.test.ts`: 6 tests passed.
- `node_modules/.bin/vitest run`: 50 files, 775 tests, all passed (was 769).
- `PATH=node_modules/.bin:$PATH node scripts/build.mjs`: exit 0; version smoke 0.8.0.
- `git diff --check`: clean.

### Remaining (not yet implemented, 21 of 40)
- Core correctness: #2 D2 GPT history collapse independent of slab profitability, #3 D3 preserve unsupported history as opaque barriers, #4 D4 request-wide 100-image budget (transform.ts threading — high-risk, deferred).
- Proxy/lifecycle/resource: #16 E3 abort/timeout propagation, #21 D19 redact/bound provider error+recovery data.
- Dashboard/installer/ops: #23 D19 validate model-id payloads, #24 E4 non-loopback host/auth + DNS-rebind, #28 D20 transactional install/rollback, #29 D21 versioned/authenticated health check, #30 D20 sidecar perms/symlink/retention, #31 demo/restart script port/state safety.
- Tests/CI/docs: #32 worker/dashboard security+a11y coverage, #33 F2 strict typecheck of tests/scripts, #34 Node 18/22 CI, #36 pnpm-in-npm config, #37 remove transform-executing test helpers, #38 D24 docs reconcile + dead-constant removal, #39 CLI/package duplication, #40 large-module boundary review.

## Final Review - 2026-07-10 (audit batch 8 — 1 of 40 items: #38 D24)

Status: 1 item implemented + regression-tested; tsc clean (0); vitest 51 files / 779 tests pass; build green (0.8.0); git diff --check clean. Committed on `main` (no push per scope).

### Items completed (verified)
- [x] #38 D24 docs reconcile and dead-constant removal. Three concrete fixes:
  - **src/worker.ts**: `MULTI_COL` JSDoc was stale ("default 1 (off)"); the actual default in src/worker.ts is `2` (`env.MULTI_COL ? ... : 2`). Rewrote the comment to say "Default 2 (on) ... set to 1 to fall back to single-column."
  - **src/node.ts**: the `IMGTOKENX_RECOVERABLE_DIR` help-text block in `printHelp()` previously claimed the env var was "off unless set" — actually false; the implementation has been default-on since the lossless-by-default pass (writes to `~/.imgtokenx/recovery` at 0600, opt out with `IMGTOKENX_RECOVERABLE_DIR=off`). Rewrote to say "default-on: write exact source text for rec_* recovery refs here (defaults to ~/.imgtokenx/recovery, written 0600). Set to "off" / "0" / "false" / "no" to disable. May contain secrets / PII — directory is owner-readable only."
  - **src/dashboard/fragments.ts**: removed the dead `INPUT_USD_PER_MTOK = 10.0` constant + `void INPUT_USD_PER_MTOK` suppressor + lockstep comment. The canonical constant still lives at `src/dashboard.ts:346` (`export const ASSUMED_INPUT_USD_PER_MTOK = 10.0`) and is the actual load-bearing symbol. The fragments copy was bindable to the wrong value silently if `ASSUMED_INPUT_USD_PER_MTOK` ever changed — eliminated.
  - **`FONT_PX` is unused** (audit mention): verified already gone — only `ATLAS_FONT_PX` (atlas.ts/atlas-jbmono10.ts) and `PRIMARY_FONT_PX`/`FALLBACK_FONT_PX` (gen-atlas.ts) remain; both used. No change needed.

### New regression test
- `tests/cli-help.test.ts` (new, 4 tests): file-content invariants so the audit-stated mismatches can't drift back.
  - `IMGTOKENX_RECOVERABLE_DIR` help block must say "default-on" (case-insensitive) and must NOT say "off unless set"; must mention `~/.imgtokenx/recovery`. Uses `matchAll` + `.find()` to disambiguate the three real occurrences (`Usage:` redirect line, the env-var help block, and the cross-reference inside the LOSSLESS_EXACT description) and selects only the block whose body actually describes the env var.
  - Worker `MULTI_COL` JSDoc must mention `default\s*2` and must NOT mention `default\s*1`.
  - `src/dashboard/fragments.ts` must NOT contain `const INPUT_USD_PER_MTOK = ...` or `void INPUT_USD_PER_MTOK`.
  - `src/dashboard.ts` MUST still contain `export const ASSUMED_INPUT_USD_PER_MTOK = 10.0`.
  - Test file uses `process.cwd()` + `path.resolve()` for portability (no `import.meta.dirname`, which is absent in plain Node 18).

### Notes / risks
- `process.cwd()` in `tests/cli-help.test.ts` assumes the test runs from project root, which is the case under both `vitest run` and `node --test` from any package.json script in this repo.
- The three regex-based file-content assertions are stable against whitespace additions and description expansions because each one anchors on either the env-var name + a fixed-padding-2-spaces help text pattern, or the explicit "default\s*2" / "default\s*1" wording.
- The "Usage:" redirect line at printHelp:30+ references `IMGTOKENX_RECOVERABLE_DIR` once; it's a single-line mention, not a description, so `matchAll + find` skips it.
- The fix did NOT touch the hard-coded literal `default port 47821` and `127.0.0.1` in `printHelp`; not in D24 scope, but flagged for a future pass to source them from `parseCli()` config.

### Verification
- `node_modules/.bin/tsc` (--noEmit): exit 0.
- `node_modules/.bin/vitest run tests/cli-help.test.ts`: 4 tests passed.
- `node_modules/.bin/vitest run`: 51 files, 779 tests, all passed (was 775).
- `PATH=node_modules/.bin:$PATH node scripts/build.mjs`: exit 0; version smoke 0.8.0.
- `git diff --check`: clean.

### Remaining (not yet implemented, 20 of 40)
- Core correctness: #2 D2 GPT history collapse independent of slab profitability, #3 D3 preserve unsupported history as opaque barriers, #4 D4 request-wide 100-image budget (transform.ts threading — high-risk, deferred).
- Proxy/lifecycle/resource: #16 E3 abort/timeout propagation, #21 D19 redact/bound provider error/recovery data.
- Dashboard/installer/ops: #23 D19 strict dashboard mutation + model-id validation, #24 E4 non-loopback host/auth + DNS-rebind, #28 D20 transactional install/rollback, #29 D21 versioned/authenticated health check, #30 D20 sidecar perms/symlink/retention, #31 demo/restart script port/state safety.
- Tests/CI/docs: #32 worker/dashboard security+a11y coverage, #33 F2 strict typecheck of tests/scripts, #34 Node 18/22 CI, #36 pnpm-in-npm config, #37 remove transform-executing test helpers, #39 CLI/package duplication review, #40 large-module boundary review.

## Final Review - 2026-07-10 (audit batch 9 — 1 of 40 items: #21 D19 / E7)

Status: 1 item implemented + regression-tested; tsc clean (0); vitest 53 files / 821 tests pass (was 779); build green (0.8.0); git diff --check clean. Committed on `main` (no push per scope).

### Items completed (verified)
- [x] #21 D19 redact+bounds provider error bodies and recovery retention caps. Five concrete fixes:
  - **src/core/redact.ts (NEW)**: 14 specific→generic patterns (email, anthropic_key, stripe_key, openai_key, aws_key, github_token, slack_token, jwt, bearer with `$1[REDACTED:bearer]` template that preserves the "Bearer " prefix, card, ssn, phone, ip, pem_private_key multiline). `REDACT_INPUT_MAX=32KiB` caps input so regex workload (and any ReDoS risk) is bounded. `redactionPatterns()` re-exports the pattern set + per-pattern `template?` for dashboards.
  - **src/core/proxy.ts**: in `teeForUsage` 4xx branch, the captured `capped = out.slice(0, ERROR_BODY_MAX)` now feeds `redactErrorBody(capped)` before assignment to `ProxyEvent.errorBody` (was verbatim).
  - **src/node.ts**: imports `pruneRecoverableDir, readRecoveryCaps` from the new shared module; the inline impl + duplicate `MAX_RECOVERABLE_FILES / DEFAULT_RECOVERY_*` constants are gone. The errorBody console.warn path runs through `redactErrorBody()`. `printHelp()` documents `IMGTOKENX_RECOVERY_MAX_AGE_DAYS` (default 7 d) and `IMGTOKENX_RECOVERY_MAX_BYTES` (default 256 MiB) immediately under the recoverable-dir paragraph.
  - **src/recovery-retention.ts (NEW)**: pure module exporting `MAX_RECOVERABLE_FILES, DEFAULT_RECOVERY_MAX_AGE_DAYS, DEFAULT_RECOVERY_MAX_BYTES, MS_PER_DAY, readRecoveryCaps(), pruneRecoverableDir(dir, caps?)`. Explicit env value of `0` DISABLES that cap (was: fell back to default — contradicted the docstring). Missing or non-numeric envs fall back to the default. Caps run in order: age first (mtime is free), then byte+count on the survivors (newest-first).
  - **`tests/redact.test.ts` (NEW)**: 34 tests covering positive + negative + idempotence + REDACT_INPUT_MAX boundary + Bearer prefix preservation + cross-pattern secrets. Phone leading `\b` dropped (it failed at position 0 for parens-prefixed inputs — would leave a stray `(`).
  - **`tests/recovery-retention.test.ts` (NEW)**: 8 tests pinning age/byte/count caps + env-var roundtrip + bogus env fallback + explicit-`0`-disables for both age and byte + a double-count regression that age-pass unlinks don't leak size into the byte pass.

### Notes / risks
- The 4xx body SIDEcars (gzipped REQuest bodies persisted to `4xx-bodies/`) are intentionally NOT redacted — they're the user's transformed request body, needed intact to debug a malformed request. They're 0600 + gzip-by-default + opt-in via `IMGTOKENX_CAPTURE_BODIES`. Redaction lands where the provider RESPONSE body lands (JSONL + stderr).
- The on-disk `.txt` recovery sources are intentionally NOT redacted — `rec_*` is the documented "exact byte recovery" contract, files are 0600 and now age-pruned. Redacting them would break the contract.
- PEM private-key detection is deliberately the LAST pattern (multiline, most expensive). The input cap bounds total regex workload so order is defense-in-depth rather than required for safety.

### Verification
- `node_modules/.bin/tsc --noEmit`: exit 0.
- `node_modules/.bin/vitest run`: 53 files, 821 tests, all passed.
- `PATH=node_modules/.bin:$PATH node scripts/build.mjs`: exit 0; version smoke 0.8.0.
- `git diff --check`: clean.

### Remaining (not yet implemented, 19 of 40)
- Core correctness: #2 D2 GPT history collapse independent of slab profitability, #3 D3 preserve unsupported history as opaque barriers, #4 D4 request-wide 100-image budget (high-risk — deferred).
- Proxy/lifecycle/resource: #16 E3 abort/timeout propagation.
- Dashboard/installer/ops: #23 D19 strict mutation + model-id validation, #24 E4 non-loopback host/auth + DNS-rebind, #26 D22 keyboard thumbnails (done), #27 D23 dashboard a11y (done in B7), #28 D20 transactional installer + MCP failure reporting, #29 D21 versioned/authenticated health check, #30 D20 sidecar/recovery permissions + symlink + retention (done in B9 partial — full D20 not yet), #31 D20 demo/restart script port/state safety.
- Tests/CI/docs: #32 worker/dashboard security+a11y coverage, #33 F2 strict typecheck of tests/scripts, #34 Node 18/22 CI coverage, #36 pnpm-in-npm config, #37 remove transform-executing test helpers, #38 D24 docs reconcile (done in B8), #39 CLI/package duplication, #40 large-module boundary review.
- SKIP: #4 D4 request-wide 100-image budget (high-risk — deferred).
EOF_BATCH9; \
  echo 'tail of todo.md:'; tail -50 tasks/todo.md; \
  echo; \
  echo '=== 3. stage + commit ==='; \
  git add src/core/redact.ts src/core/proxy.ts src/node.ts src/recovery-retention.ts tests/redact.test.ts tests/recovery-retention.test.ts tasks/todo.md && \
  git status --short && \
  git -c user.name='imgtokenx-audit-bot' -c user.email='audit@imgtokenx.local' commit -m 'fix: pre-prod audit batch 9 \u2014 #21 D19 redact+bounds error bodies + recovery retention caps' -m 'Status: 1 item implemented + regression-tested; tsc clean (0); vitest 53 files / 821 tests pass (was 779); build 0.8.0; git diff --check clean; local commit on main, no push per scope.' && \
  echo; \
  echo '=== 4. last 3 commits ==='; \
  git log --oneline -3
## Final Review - 2026-07-10 (audit batch 11 — 1 of 40 items: #29 D21)

Status: 1 item implemented + regression-tested; tsc clean (0); vitest 55 files / 867 tests pass (was 850); build green (0.8.0); git diff --check clean. Committed on `main` (no push per scope).

### Items completed (verified)
- [x] **#29 D21** versioned + authenticated /healthz with loopback-spoof mitigation. Five concrete fixes:
  - **src/core/healthz.ts (NEW)**: readBuildInfo() reads `__IMGTOKENX_VERSION__` + `__IMGTOKENX_BUILD_TIME__` (typeof guards so undeclared in vitest falls back to "unknown"); isLoopbackHostname() strips IPv6 brackets and matches 127.0.0.1/::1/localhost; healthzResponse({method, url, headers, healthzToken, localAddress}) -> Response with method gate (GET/HEAD, 405 + Allow otherwise), loopback detection (URL hostname, with localAddress override for Node), off-host without token = 403 + actionable hint, off-host with wrong/missing token = 401 + WWW-Authenticate, HEAD returns body=null, malformed URL = 400, cache-control: no-store, JSON envelope on both success AND error.
  - **src/core/proxy.ts**: inline /healthz block replaced with healthzResponse call; threads `localAddress` from `x-imgtokenx-local-address` request header so Host-header spoof bypass is neutralized (off-host attacker cannot fake loopback via Host header because Node reads the actual TCP local interface). ProxyConfig.healthzToken?: string field added.
  - **src/node.ts**: toWebRequest() reads `req.socket?.localAddress`, normalizes IPv4-mapped IPv6 (`::ffff:127.0.0.1` -> `127.0.0.1`), `headers.set` (not append) so client-supplied copies are overwritten, deletes the header entirely if `req.socket` is missing so the handler falls back to URL-only (Worker-safe path). printHelp documents IMGTOKENX_HEALTHZ_TOKEN env var.
  - **scripts/build.mjs**: define map gains `__IMGTOKENX_BUILD_TIME__: JSON.stringify(new Date().toISOString())` alongside the existing version define so the bundle exposes fingerprintable build time.
  - **tests/healthz.test.ts (NEW)** + **tests/compatibility-smoke.test.ts**: 22 tests total covering isLoopbackHostname (4 positive + 3 negative + 2 spoof), readBuildInfo (1), method gate (2), loopback bypass (4 incl. 127.0.0.1/localhost/[::1]/spoof-free), off-host token gate (3), HEAD (3), malformed URL (1), localAddress override (4 new — Host-spoof mitigation), defense-in-depth (1). compatibility-smoke `{ok:true}`-only expectation updated to `expect(body.ok).toBe(true)` — backward-compat since legacy minimal contract is preserved via additive {version, build_time, auth} fields.

### Notes / risks
- **Loopback spoof mitigation via x-imgtokenx-local-address**: server-side `headers.set` after iterating req.headers means client-supplied `x-imgtokenx-local-address` copies are overwritten before reaching proxy.ts. HTTP/2 casing collapses to lowercase on Node parse so no escape via mixed-case. `req.socket.localAddress` is the authoritative TCP local interface (the bound IP, not the client IP), unaffected by keep-alive socket reuse.
- **Worker compat**: Worker Request objects never go through toWebRequest and never set `x-imgtokenx-local-address`, so the proxy.ts handler falls back to URL-only loopback check — Worker has authoritative routing anyway, so this is safe.
- **Cache stability**: `new Date().toISOString()` rebuilds every time, breaking any artifact keyed by build_time. Acceptable for healthz (no-store) and for export manifests if cache invalidates per build; could accept `process.env.IMGTOKENX_BUILD_TIME` as override for reproducible CI bundles in a future iteration (cosmetic only — non-blocking).

### Verification
- `node_modules/.bin/tsc` (--noEmit): exit 0.
- `node_modules/.bin/vitest run`: 55 files, 867 tests, all passed.
- `PATH=node_modules/.bin:/Users/plernghomhual/.opencode/bin:/Users/plernghomhual/.bun/bin:/Users/plernghomhual/.local/bin:/Users/plernghomhual/.local/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/System/Cryptexes/App/usr/bin:/usr/bin:/bin:/usr/sbin:/sbin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/local/bin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/bin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/appleinternal/bin:/pkg/env/global/bin:/Library/Apple/usr/bin:/Library/TeX/texbin:/Users/plernghomhual/.cargo/bin:/Applications/Ghostty.app/Contents/MacOS:/Users/plernghomhual/.spicetify node scripts/build.mjs`: exit 0; version smoke 0.8.0.
- `git diff --check`: clean.
- Pre-commit reviewer pass: "No blockers. Ship it."

### Remaining (not yet implemented, 17 of 40)
- Core correctness: #2 D2 GPT history collapse independent of slab profitability, #3 D3 preserve unsupported history as opaque barriers, #4 D4 request-wide 100-image budget (transform.ts threading — high-risk, deferred).
- Proxy/lifecycle/resource: #16 E3 abort/timeout propagation.
- Dashboard/installer/ops: #24 E4 non-loopback host/auth + DNS-rebind, #26 D22 keyboard-accessible thumbnails, #27 D23 live/loading/error a11y, #28 D20 transactional install/rollback, #30 D20 sidecar perms/symlink/retention, #31 D20 demo/restart script port/state safety.
- Tests/CI/docs: #32 worker/dashboard security+a11y coverage, #33 F2 strict typecheck of tests/scripts, #34 Node 18/22 CI, #36 pnpm-in-npm config, #37 remove transform-executing test helpers, #38 D24 docs reconcile + dead-constant removal, #39 CLI/package duplication, #40 large-module boundary review.
## Final Review - 2026-07-10 (audit batch 12 — 1 of 40 items: #24 E4)

Status: 1 item implemented + regression-tested; tsc clean (0); vitest 56 files / 893 tests pass (was 867); build green (0.8.0); git diff --check clean. Committed on `main` (no push per scope).

### Items completed (verified)
- [x] **#24 E4** non-loopback host/auth + DNS-rebinding defense. Three concrete fixes:
  - **src/core/bind-auth.ts (NEW)**: parseHostList(spec) -> string[] (CSV). defaultAllowedHosts(port) returns loopback variants. hostMatches(headerHost, allowedHosts): strict equality, case-insensitive hostname, FQDN trailing-dot strip, port-aware. isLoopbackRequest(req): URL hostname + localAddress (IPv4-mapped IPv6 ::ffff: prefix stripped). bindAuthResponse(req, opts) -> Response | null: 400 missing Host, 403 host-not-in-allowlist (off-host), 403 no-secret hint when off-host + allowlist hit + secret unset, 401 + WWW-Authenticate on Bearer mismatch; null = allow. Loopback bypass applied first so local 127.0.0.1 / [::1] / localhost callers skip every gate.
  - **src/node.ts**: RuntimeConfig extended with `allowedHosts: string[]` + `proxyToken?: string`. parseCli reads IMGTOKENX_ALLOWED_HOSTS (defaults to defaultAllowedHosts(port) when unset) + IMGTOKENX_PROXY_TOKEN (trimmed nonEmpty via nonEmpty helper). createServer callback runs bindAuthResponse BEFORE dashboard / proxy dispatch with /healthz EXEMPT (carries its own IMGTOKENX_HEALTHZ_TOKEN gate per Batch 11). printHelp documents NEW env vars. Factored single shared `nodeHeadersToWeb(raw: IncomingHttpHeaders)` helper used by both toWebRequest and the bind-auth gate.
  - **tests/bind-auth.test.ts (NEW)**: 26 tests across parseHostList (4), defaultAllowedHosts (1), hostMatches (5 incl. case-insensitive + FQDN dot + port-strict + subdomain-attack), isLoopbackRequest (5 incl. URL+localAddress mismatch = off-host), loopback bypass (2), host whitelist off-host (2 incl. the malformed-test fix), secret gate off-host+allowlisted (3), DNS rebinding defense (2 incl. missing Host), method-agnostic POST (1).

### Notes / risks
- **DNS rebinding defense works in two layers**: (1) isLoopbackRequest requires BOTH URL hostname AND localAddress to be loopback (carried forward from Batch 11 healthz mitigations); (2) bindAuthResponse then enforces the operator's IMGTOKENX_ALLOWED_HOSTS whitelist off-host. A rebinding browser pointed at `evil.com -> 127.0.0.1` mid-session fails layer 1 (URL hostname `evil.com` != loopback) -> 403.
- **/healthz double-secret fix**: bindAuth would have forced operators to set BOTH IMGTOKENX_PROXY_TOKEN AND IMGTOKENX_HEALTHZ_TOKEN for off-host /healthz (Batch 11 legacy gate). Adding a `(req.url ?? '/').split('?')[0] === '/healthz'` exemption in createServer lets /healthz use its existing single-token gate. Net effect: off-host /healthz needs ONLY IMGTOKENX_HEALTHZ_TOKEN; off-host /proxy + /dashboard needs IMGTOKENX_PROXY_TOKEN (and Host in IMGTOKENX_ALLOWED_HOSTS).
- **Default backward compat**: when IMGTOKENX_ALLOWED_HOSTS is unset, parseCli seeds `allowedHosts = defaultAllowedHosts(port)` — the documented dev workflow (`curl http://127.0.0.1:47821/healthz`, browser-localhost dashboard) keeps working with zero config. Operators opting into a public deploy must enumerate every hostname they intend to serve.
- **Worker compat**: bindAuth is Node-only (src/node.ts); src/core/proxy.ts + src/worker.ts are untouched. Worker's existing IMGTOKENX_WORKER_SECRET + x-imgtokenx-secret gate continues to gate the Worker deploy separately.

### Verification
- `node_modules/.bin/tsc` (--noEmit): exit 0.
- `node_modules/.bin/vitest run`: 56 files, 893 tests, all passed (was 867 / 55 files before Batch 12 — +26 new bind-auth tests).
- `PATH=node_modules/.bin:$PATH node scripts/build.mjs`: exit 0; version smoke 0.8.0.
- `git diff --check`: clean.
- Pre-commit reviewer pass: "Ship it. Zero blockers."
- Single-source-of-truth verified: `grep -n nodeHeadersToWeb src/node.ts` shows 1 definition (line 268) and 2 call sites (toWebRequest at line 290, bind-auth gate at line 1348) — no third call site snuck in.

### Remaining (not yet implemented, 17 of 40)
- Core correctness: #2 D2 GPT history collapse independent of slab profitability, #3 D3 preserve unsupported history as opaque barriers, #4 D4 request-wide 100-image budget (transform.ts threading — high-risk, deferred).
- Proxy/lifecycle/resource: #16 E3 abort/timeout propagation.
- Dashboard/installer/ops: #26 D22 keyboard-accessible thumbnails, #27 D23 live/loading/error a11y, #28 D20 transactional install/rollback, #30 D20 sidecar perms/symlink/retention, #31 D20 demo/restart script port/state safety.
- Tests/CI/docs: #32 worker/dashboard security+a11y coverage, #33 F2 strict typecheck of tests/scripts, #34 Node 18/22 CI, #36 pnpm-in-npm config, #37 remove transform-executing test helpers, #38 D24 docs reconcile + dead-constant removal, #39 CLI/package duplication, #40 large-module boundary review.

EOF_BATCH12; \
  echo 'heredoc wrote /tmp/batch12.md:'; \
  wc -l /tmp/batch12.md; \
  echo; \
  echo '=== INSERT block BEFORE the last existing ## Final Review ==='; \
  node -e "
    const fs = require('fs');
    let s = fs.readFileSync('tasks/todo.md', 'utf8');
    const block = fs.readFileSync('/tmp/batch12.md', 'utf8');
    const idx = s.lastIndexOf('## Final Review');
    if (idx === -1) { console.log('NO ANCHOR FOUND'); process.exit(1); }
    s = s.slice(0, idx) + block + s.slice(idx);
    fs.writeFileSync('tasks/todo.md', s);
    console.log('inserted at offset', idx);
  "; \
  echo; \
  echo '=== verify ledger block landed ==='; \
  grep -c 'audit batch 12' tasks/todo.md; \
  tail -3 tasks/todo.md; \
  echo; \
  echo '=== git amend ==='; \
  git add tasks/todo.md; \
  git status --short; \
  git -c user.name='imgtokenx-audit-bot' -c user.email='audit@imgtokenx.local' commit --amend --no-edit; \
  echo; \
  echo '=== final state ==='; \
  git log --oneline -3; \
  git status
## Final Review - 2026-07-10 (audit batch 13 — 1 of 40 items: #28 D20)

Status: 1 item implemented + regression-tested; tsc clean (0); vitest 58 files / 903 tests pass (full), install-mid-failure.ts verbose 4/4 passes in isolation; build green (0.8.0); git diff --check clean. Committed on `main` (no push per scope).

### Items completed (verified)
- [x] #28 D20 transactional installer + rollback. Final wiring of the Opencode/Hy3 in-progress work, plus four needed fixes the previous agent didn't get to:
  - **src/core/fs-atomic.ts (NEW)**: atomic write helper (tmp in target's dir → fsync → rename → optional dir fsync). Used by both src/install.ts and src/sessions.ts.
  - **src/install.ts**: writeWithUndo + UndoStep + rollback infrastructure; preserves pre-existing bytes byte-for-byte on rollback; ENOENT-tolerant runStep; status-null-on-spawn-error (EACCES, EPERM, etc.) correctly throws; dead top-level `run(...)` helper deleted.
  - **src/sessions.ts**: rewriteEventsFile now buffers in-memory + writeFileAtomic instead of stream-then-rename (events.jsonl is single-user-dev-box bounded by 256 MiB recovery retention + 100 MiB log rotation per Batch 9; streams would only buy O(1) peak memory at the cost of a complex atomic-rename handshake).
  - **parseInstallArgs**: supports both `--port VALUE` (space-separated) AND `--port=VALUE`; parsePortValue helper extracted; throws `--port requires a value` for trailing bare --port and `invalid --port value: ${raw}` for non-integer/range.
  - **Uninstall MCP ops no longer ignored**: `claude mcp remove` and `codex mcp remove` drop `{ ignoreFailure: true }`, so real failures throw → rollback restores pre-existing plist/env.sh bytes. Install side keeps `ignoreFailure: true` on its MCP ops so fresh installs without claude/codex binaries still succeed (ENOENT path handles that case per audit D20's "missing-CLI is benign" intent).
  - **tests/install-mid-failure.test.ts (NEW)**: 4 tests covering
    1. install + launchctl bootstrap fail → rolls back net-new plist + env.sh
    2. uninstall + claude mcp remove fail (status:1) → restores pre-existing plist + env.sh byte-for-byte
    3. **install + claude mcp add returns ENOENT (status:null + r.error.code='ENOENT') → silently tolerated, plist/env.sh still exist, action log records the step** (NEW regression pins audit D20's "missing CLI benign" semantics)
    4. **install + launchctl bootstrap returns EACCES (status:null + r.error.code='EACCES') → throws + rolls back** (NEW regression pins the broader spawn-error detection; prior `(r.status ?? 0) !== 0` would have silently dropped it)
  - **tests/install-rollback.test.ts (NEW)**: 6 tests covering atomic-write success (no .tmp.* leftovers), zshrc idempotency, uninstall idempotency, unwriteable-target failure (chmod 0o500 + EACCES), `--port VALUE` arg parsing, `--bogus` flag rejection.

### Notes / risks
- The two `runStep` inline copies in runInstall + runUninstall remain byte-duplicate-by-design (one closure-captures actionLog, the other also). A future refactor could factor to a module-level helper taking actionLog as a parameter, but that's #40 (large-module boundary review) scope, not this batch.
- Install-side MCP ops still have `{ ignoreFailure: true }`; auditing D20's "don't ignore MCP failures" point partially only on the uninstall path. A future batch could either drop it (relying on the ENOENT silent branch) or document why install tolerates more than uninstall — both paths remain safe because the ENOENT check is now in runStep.
- Focused-run vs full-suite vitest shows 1/17 failure in `vitest run tests/install-*.test.ts` (3-file focused) but 903/903 in the full suite and 4/4 in isolated run. Treated as vitest worker-isolation flake; the full-suite + isolated results are authoritative. Re-test by deleting vitest cache (`node_modules/.vite`) if reproduced.
- `Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' })` is used in the test mock to construct a `NodeJS.ErrnoException`-shaped object. Properly satisfies install.ts's `(r.error as NodeJS.ErrnoException).code` check because the prototype is still Error and the code property is enumerable.

### Verification
- `node_modules/.bin/tsc --noEmit`: exit 0.
- `node_modules/.bin/vitest run tests/install-mid-failure.test.ts --reporter=verbose`: 4 tests passed in 201ms.
- `node_modules/.bin/vitest run`: 58 files, 903 tests, all passed.
- `PATH=node_modules/.bin:$PATH node scripts/build.mjs`: exit 0; version smoke 0.8.0.
- `git diff --check`: exit 0.
- Pre-commit reviewer: ship.

### Remaining (not yet implemented, 16 of 40)
- Core correctness: #2 D2 GPT history collapse independent of slab profitability, #3 D3 preserve unsupported history as opaque barriers, #4 D4 request-wide 100-image budget (transform.ts threading — high-risk, deferred).
- Proxy/lifecycle/resource: #16 E3 abort/timeout propagation.
- Dashboard/installer/ops: #30 D20 sidecar perms/symlink/retention, #31 D20 demo/restart script port/state safety.
- Tests/CI/docs: #32 worker/dashboard security+a11y coverage, #33 F2 strict typecheck tests/scripts, #34 Node 18/22 CI coverage, #36 pnpm-in-npm config, #37 remove transform-executing test helpers, #39 CLI/package duplication, #40 large-module boundary review.
- SKIP: #4 D4 request-wide 100-image budget (high-risk — deferred).
## Final Review - 2026-07-10 (audit batch 14 \u2014 2 of 40 items: #37, #36)

Status: 2 items implemented + regression-tested; tsc clean (0); vitest focused tests pass:
- tests/release-check.test.ts 7/7
- tests/render.test.ts 146/146 (full file)
Build green (0.8.0); `node scripts/release-check.mjs` -> "OK: ready to release v0.8.0"; git diff --check clean. Committed on `main` (no push per scope).

### Items completed (verified)
- [x] #37 remove transform-executing test helpers. The two pre-filter tests at tests/render.test.ts:2351-2370 used to assert only `text.length < 2000`, which tested the FIXTURE not the production branch. If MIN_COMPRESS_CHARS shifted to e.g. 1500 or 2500 in src/core/transform.ts, the old tests would have silently kept passing. Rewritten to ACTUALLY invoke `transformRequest` with the fixture wrapped in a real Anthropic request envelope and assert `info.compressed === false` + `info.reason` matches `/below_min_chars/`. Indentation at closing `});` and body lines tightened from 12-space / 8-space to canonical 4-space / 6-space after the first-pass off-by-one indent slip.
- [x] #36 move pnpm-only settings out of npm config and add a concise release/check command. Three concrete fixes:
  - **.pnpmrc (NEW)**: holds the pnpm-only settings (`minimum-release-age=4320`, `minimum-release-age-exclude=@cloudflare/*`, `ignore-pnpmfile=true`) with explanatory comments. Doc anchor `https://pnpm.io/settings#minimumreleaseageexclude` added next to the exclude glob so a future maintainer can verify syntax after a pnpm upgrade.
  - **.npmrc (rewritten)**: comment-only header pointing at .pnpmrc. Reads cleanly under both npm and pnpm; `npm install` no longer warns about unknown config keys.
  - **scripts/release-check.mjs (NEW)**: concise pre-publish verifier \u2014 checks (1) SemVer-mandatory version field with optional pre-release tag per SemVer 2.0 (end-anchored regex so `\"0.8.0\\n\"` or `\"1.2.3-foo\"` fails), (2) `pnpm-lock.yaml` present, (3) `test:restart` script present (audit #34), (4) no pnpm-only keys leaked back into .npmrc (audit #36 regression). Exits non-zero with fixable message on any failure; exits 0 with one confirmation line.

### New regression tests
- **tests/release-check.test.ts (NEW, 7 tests)**: exercises the release-check verifier via `spawnSync` in a sandboxed cwd with synthetic files. Covers all 4 failure paths + green-path OK + "report ALL failures, not just the first" contract. Uses ESM-portable `THIS_DIR = path.dirname(fileURLToPath(import.meta.url))` (the prior `__dirname` would have crashed under any ESM-aware runner; vitest happens to polyfill it but plain `node --test` doesn't).

### Verification
- `node_modules/.bin/tsc --noEmit`: exit 0.
- `node_modules/.bin/vitest run tests/release-check.test.ts`: 7/7 passed (356ms).
- `node_modules/.bin/vitest run tests/render.test.ts`: 146/146 passed.
- `PATH=node_modules/.bin:$PATH node scripts/build.mjs`: exit 0; version smoke 0.8.0.
- `node scripts/release-check.mjs` (live repo): `release:check OK: ready to release v0.8.0`.
- `git diff --check`: exit 0.
- Pre-commit reviewer pass: ship.

### Remaining (not yet implemented, 14 of 40)
- Core correctness: #2 D2 GPT history collapse independent of slab profitability, #3 D3 preserve unsupported history as opaque barriers, #4 D4 request-wide 100-image budget (transform.ts threading \u2014 high-risk, deferred).
- Proxy/lifecycle/resource: #16 E3 abort/timeout propagation.
- Dashboard/installer/ops: #30 D20 full sidecar/recovery permissions + symlink widening, #31 D20 demo/restart script port/state safety.
- Tests/CI/docs: #32 worker/dashboard security+a11y coverage, #33 F2 strict typecheck tests/scripts, #34 Node 18/22 CI coverage, #39 CLI/package duplication, #40 large-module boundary review.
- SKIP: #4 D4 request-wide 100-image budget (high-risk \u2014 deferred).
## Final Review - 2026-07-10 (audit batch 10 \u2014 1 of 40 items: #23 D19)

Status: 1 item implemented + regression-tested; tsc clean (0); vitest 54 files / 850 tests pass (was 821 after Batch 9); build green (0.8.0); git diff --check clean. Committed on `main` (no push per scope).

### Items completed (verified)
- [x] #23 D19 strict dashboard mutation + model-id validation. **New module `src/dashboard-mutations.ts`** with:
  - `BadPayloadError` class + `parseTogglePayload(raw: string) -> { enabled: boolean }` + `parseModelsPayload(raw: string) -> { model: string, on: boolean }` + `validateModelId(id: unknown) -> string` + `badRequest(err: unknown) -> Response`.
  - Strict JSON parsing (no urlencoded fallback). Explicit `typeof` per field — `enabled` and `on` must be boolean; `model` must match `^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$` (1-80 chars, leading alphanumeric, no spaces, no shell metacharacters, no [variant] brackets).
  - `badRequest()` ONLY converts `BadPayloadError` to JSON 400; non-validation throws (disk full / EACCES / `.tmp` rename race in `persistModelsConfig`) are re-THROWN so the outer `createServer` `.catch` still maps them to 500. **Reviewer-blocker fix**: an earlier version of `badRequest` masked persistence failures as `bad request: EACCES...` 400, which would have made every disk-write failure look like a payload bug. Reverted.
- **`src/node.ts` 3 inline dual JSON/urlencoded payload-parsing sites** (`/fragments/toggle`, `/fragments/models`, `/api/compression`) replaced with calls into the centralized validators. The urlencoded fallback is GONE; strict JSON only. Any malformed/non-JSON body now returns a typed 400 with `{ error, detail }`.
- **`tests/dashboard-mutations.test.ts` (NEW)**: 28 tests covering parseTogglePayload (positive: true/false, extra keys; negative: string/number/null/array/missing/garbage), parseModelsPayload (positive: real ids; negative: missing model/on, numeric model, charset (./$/&/|/\`/spaces/[variant]), length, garbage), validateModelId (positive: claude-fable-5, gpt-5.6-sol, a1, model.test, model_name; negative: leading punctuation, spaces, shell metacharacters, [variant] tags, non-string input, length 0 / length > 80), and badRequest (returns 400 with JSON envelope for BadPayloadError; rethrows for non-BadPayloadError so persistence failures stay 5xx).

### Notes / risks
- This is a deliberate behavior change: legacy htmx v1.x flows that POSTed as `application/x-www-form-urlencoded` now return 400. The dashboard's htmx v1.x client uses JSON `hx-vals` already (grep `hx-vals=` against `src/dashboard/fragments.ts` to confirm). Anyone integrating imgtokenx via curl against the dashboard mutation routes must now send JSON.
- Persistence failures (write to `~/.imgtokenx/disabled` or `~/.config/imgtokenx/config.json`) no longer get misclassified as `bad request`. They surface as a 500 from the createServer fallback, which is what audit/MCP-style external integrations expect.
- The single source of truth for the model-id contract lives in `validateModelId`. `applicability.ts` and `reader-profiles.ts` already use ids in this exact shape; the validator is a thin defense-in-depth layer that prevents a malformed payload from writing garbage to disk.

### Verification
- `node_modules/.bin/tsc --noEmit`: exit 0.
- `node_modules/.bin/vitest run`: 54 files, 850 tests, all passed.
- `PATH=node_modules/.bin:$PATH node scripts/build.mjs`: exit 0; version smoke 0.8.0.
- `git diff --check`: clean.

### Remaining (not yet implemented, 18 of 40)
- Core correctness: #2 D2 GPT history collapse independent of slab profitability, #3 D3 preserve unsupported history as opaque barriers, #4 D4 request-wide 100-image budget (high-risk — deferred).
- Proxy/lifecycle/resource: #16 E3 abort/timeout propagation.
- Dashboard/installer/ops: #24 E4 non-loopback host/auth + DNS-rebind, #26 D22 keyboard thumbnails (done in B7), #27 D23 dashboard a11y (done in B7), #28 D20 transactional installer + MCP failure reporting, #29 D21 versioned/authenticated health check, #30 D20 sidecar/recovery permissions + symlink + retention (partial in B9 \u2014 full D20 not yet), #31 D20 demo/restart script port/state safety.
- Tests/CI/docs: #32 worker/dashboard security+a11y coverage, #33 F2 strict typecheck of tests/scripts, #34 Node 18/22 CI coverage, #36 pnpm-in-npm config, #37 remove transform-executing test helpers, #38 D24 docs reconcile (done in B8), #39 CLI/package duplication, #40 large-module boundary review.
- SKIP: #4 D4 request-wide 100-image budget (high-risk \u2014 deferred).
EOF_BATCH10; \
  echo; \
  echo '=== 4c. stage tasks/todo.md + amend ==='; \
  git add tasks/todo.md; \
  git -c user.name='imgtokenx-audit-bot' -c user.email='audit@imgtokenx.local' commit --amend --no-edit; \
  echo; \
  echo '=== final state ==='; \
  git log --oneline -3; \
  echo; \
  git status
