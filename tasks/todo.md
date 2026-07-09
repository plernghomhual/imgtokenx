# pxpipe Codex/OpenCode Compatibility

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

# pxpipe Further Hardening

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

# pxpipe Exactness Completion Pass

- [x] Add local exact-recall regression fixtures for IDs, hashes, secrets, paths, and camel/Pascal identifiers.
- [x] Add `rec_*` local recovery CLI coverage.
- [x] Add `losslessExact`/`PXPIPE_LOSSLESS_EXACT` so risky exact blocks stay text when no recovery sidecar is available.
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
- `losslessExact` / `PXPIPE_LOSSLESS_EXACT=1` keeps exact-risk blocks as native text when `emitRecoverable` is off.
- `PXPIPE_RECOVERABLE_DIR` now has a local `pxpipe recover rec_1234abcd` / `pxpipe rehydrate rec_1234abcd` command to print exact source text from the private recovery directory.
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

# pxpipe Auto-start + Lossless-by-construction + All-model compat

Plan: `/Users/plernghomhual/.claude/plans/jaunty-whistling-shannon.md`

- [x] Phase 0: commit pending exactness pass as checkpoint (verify green first). Commit `142e964`.
- [ ] Phase 1: lossless-by-default (`losslessExact` on), widen exact-risk detectors, recovery MCP server + `pxpipe mcp`, default `emitRecoverable`/`PXPIPE_RECOVERABLE_DIR`, banner mentions recovery tool.
- [ ] Phase 2: per-model reader-capacity profiles (`reader-profiles.ts`), density selection in transform, safe default for unknown models, calibration harness stub.
- [ ] Phase 3: launchd LaunchAgent + `pxpipe install`/`uninstall`, shell wrappers (claude/codex/opencode) with health-check + kill switch, MCP registration per harness, `/healthz`.
- [ ] Phase 4: compat/lossless/reader-profile tests, doctor self-check.
- [ ] Full verification: typecheck, build, test, install dry-run, final review entry.
