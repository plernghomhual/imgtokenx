# pxpipe

**Cut Claude Code's input tokens by rendering bulky context as images — the same system prompt, tool docs, and history, in a fraction of the tokens.**

An image's token cost is fixed by its pixel dimensions, not by how much text
is inside it. Dense content (code, JSON, tool output) packs ~3.1 chars per
image-token vs ~1 char per text-token on real Claude Code traffic. The
reader is the same vision channel that Anthropic's computer use already
relies on for screenshots. pxpipe is a local proxy that uses that channel
for context: it rewrites the bulky parts of each request into compact PNGs
before it leaves your machine. At current Fable
list prices that lands as a **~59–70% lower end-to-end bill** — but prices
move and workloads differ, so the durable number is the token cut itself,
measured per-request against a free `count_tokens` counterfactual in
`~/.pxpipe/events.jsonl`.

This is what the model sees instead of text:

![example: a real `transformRequest` output: system prompt + tool docs reflowed into one dense 1573×1248 page, instruction banner on top, ↵ marking original newlines](https://raw.githubusercontent.com/teamchong/pxpipe/main/docs/assets/example-render.png)

*~48k chars of system prompt + tool docs: ≈25k tokens as text, ≈2.7k image
tokens as this page. Real pipeline output; the model reads renders like this
at 100/100 (see benchmarks).*

## Demo

**Fable 5 (the default, 100/100 reader) — plain left, pxpipe right:**

https://github.com/user-attachments/assets/1c8ee63a-fcd7-4958-917b-da788d718349

pxpipe counts an exact token **10/10** across 39 imaged filler files
(matches `grep` line-for-line), gets the multi-step ledger arithmetic right,
and ends the session at **$6.06** with context to spare (73.5k/1M) vs
**$42.21** at 96% full. One caveat visible in the clip: the pxpipe arm
needed a nudge to match the requested one-line output format.

**Opus 4.8 (disabled by default) — same layout:**

https://github.com/user-attachments/assets/f4e50137-31b5-426f-a6ed-b83f829b4a2c

Text needles read fine on both arms; the imaged phrase-count doesn't read on
Opus — and pxpipe **says so instead of fabricating a number**. That misread
rate is why Opus is opt-in.

## Try it (30 seconds)

```bash
npx pxpipe-proxy                                  # proxy on 127.0.0.1:47821
ANTHROPIC_BASE_URL=http://127.0.0.1:47821 claude  # point Claude Code at it

# Codex / OpenAI-compatible clients
OPENAI_BASE_URL=http://127.0.0.1:47821/v1 codex

# OpenCode provider-prefixed routing
# Anthropic base: http://127.0.0.1:47821/anthropic
# OpenAI base:    http://127.0.0.1:47821/openai

# Lossless-exact + recovery sidecars are ON by default — no setup needed.
# Recovery sources land in ~/.pxpipe/recovery unless you override the dir:
npx pxpipe-proxy recover rec_1234abcd
PXPIPE_RECOVERABLE_DIR=/private/pxpipe-recovery npx pxpipe-proxy
```

For local auto-start, install the launchd agent and shell wrappers:

```bash
pxpipe install --dry-run  # preview plist, ~/.pxpipe/env.sh, MCP registrations
pxpipe install            # writes launchd + ~/.zshrc source block
pxpipe doctor             # checks launchd/env/zshrc/healthz/MCP wiring
pxpipe uninstall          # removes the launchd/env/zshrc wiring
```

The generated wrappers health-check <http://127.0.0.1:47821/healthz>, kickstart
launchd or start a local fallback process, then run `claude`, `codex`, or
`opencode` with the right base URL. `PXPIPE_DISABLE=1 <tool>` bypasses the
wrapper and runs the original CLI unchanged.

Dashboard at <http://127.0.0.1:47821/>: tokens saved, every text→image
conversion side by side, kill switch, live model chips. Responses stream
normally — pxpipe compresses the *request* only, never the model's output.
Recent turns stay text; the system prompt, tool docs, and older bulk history
are imaged.

## The honest part

- **Images are lossy — so exactness guards are ON by default.** Exact
  12-char hex strings in dense imaged content: **13/15** on Fable 5, **0/15**
  on Opus — and misses are *silent confabulations*, not errors. Two defaults
  now compose to make silent exact-content loss structurally hard:
  1. **Lossless-exact** (primary guard): blocks containing IDs, hashes,
     UUIDs, secrets, paths, URLs with query strings, JWTs/base64 tokens,
     version pins, and similar exact-risk shapes stay native text instead of
     being imaged — they're never at risk in the first place. Opt out with
     `PXPIPE_LOSSLESS_EXACT=0`.
  2. **Recovery sidecars** (backstop): whatever content still *does* get
     imaged gets its verbatim source written to `~/.pxpipe/recovery`
     (override with `PXPIPE_RECOVERABLE_DIR=/path/to/dir`), keyed by a
     `rec_*` id shown next to the image. Recover it via
     `pxpipe recover rec_1234abcd`, or — for a model mid-conversation — the
     bundled `pxpipe mcp` MCP server exposes a `pxpipe_recover` tool it can
     call directly with that id. Opt out with `PXPIPE_RECOVERABLE_DIR=off`.
- **Escape hatch:** subagents on non-allowlisted models pass through as
  text — route byte-exact work there
  (`CLAUDE_CODE_SUBAGENT_MODEL=claude-sonnet-4-6`, or `model: sonnet` in
  agent frontmatter).
- **Real work:** SWE-bench Lite pilot **10/10 both arms** at −65% request
  size; SWE-bench Pro **14/19 ON vs 15/19 OFF** at −60%, verdicts agree
  18/19, and the single split re-resolved 3/3 on replication — run-to-run
  variance, not compression. Small n; receipts in `eval/`.
- **Workload-dependent.** Wins on token-dense content (~1 char/token),
  loses money on sparse prose (~3.5 chars/token); a profitability gate
  (calibrated on N=391 production rows) images only where the math wins.
- **Model scope:** default `PXPIPE_MODELS=claude-fable-5,gpt-5.6`. Opus
  4.7/4.8 misread ~7% of renders and GPT 5.5 degrades on imaged context, so
  both are opt-in via `PXPIPE_MODELS` or the dashboard chips.
  `PXPIPE_MODELS=off` disables imaging. Everything else passes through
  byte-identical. On the GPT path, tool definitions stay native JSON and no
  Anthropic `cache_control` markers are used.

## Benchmarks (reproducible)

Measured with novel random-number problems the model cannot have memorized:

| test | N | text | pxpipe (image) | tokens |
|---|---:|---:|---:|---|
| novel arithmetic, `claude-fable-5` | 100 | 100% | **100%** | **−38%** |
| novel arithmetic, `claude-opus-4-8` | 100 | 100% | 93% | −38% |
| gist recall A/B (decisions, values, paths, names, negations; with distractors; 15k-45k char sessions), Fable 5 | 98/arm | 98/98 | **98/98** | - |
| state tracking (value mutated 3x, final/first/count), Fable 5 | 18/arm | 18/18 | **18/18** | - |
| confabulation on never-stated facts (lower is better), Fable 5 | 16/arm | 0/16 | **0/16** | - |
| verbatim 12-char hex recall, dense render, Opus | 15 | 15/15 | **0/15** | - |
| verbatim 12-char hex recall, dense render, Fable 5 | 15 | - | **13/15** | - |

SWE-bench run totals, receipts, and caveats:
[`eval/swe-bench/`](eval/swe-bench/) ·
[`eval/swe-bench-pro/`](eval/swe-bench-pro/) ·
[`eval/needle-haystack/`](eval/needle-haystack/) ·
[`eval/gist-recall/`](eval/gist-recall/) · analysis in
[`FINDINGS.md`](FINDINGS.md). (GSM8K scored 96% imaged, but it's in training
data — memorized answers survive misreads — so we lead with the novel-number
evals.)

## How it works

```
tool_result string ──► wrap at 1568px-wide columns ──► pack ~28,000 chars/page ──► PNG[]
```

The proxy intercepts Anthropic Messages and OpenAI Chat/Responses requests,
rewrites eligible bulk into image blocks, splices them back cache-friendly
(static prefix preserved, prompt caching keeps working), and forwards. It
accepts both canonical SDK paths and Codex/OpenCode aliases:
`/v1/messages`, `/anthropic/v1/messages`, `/anthropic/messages`,
`/v1/responses`, `/responses`, `/openai/v1/responses`, `/openai/responses`,
`/v1/chat/completions`, `/chat/completions`,
`/openai/v1/chat/completions`, and `/openai/chat/completions`. OpenAI model
list and response-retrieval paths (`/v1/models`, `/models`,
`/v1/responses/*`, `/responses/*`) pass through to the OpenAI upstream so
client capability probes do not fall back to Anthropic by accident.

A full 1568×728 page costs 1,456 visual tokens and holds ≈28,000 chars, so
text wins only at very sparse densities — Claude Code traffic runs ~1.91
chars/token (N=391). A per-request estimator decides; sparse prose stays
text. Events log to `~/.pxpipe/events.jsonl`.

## Library use (no proxy)

```ts
import { renderTextToImages, transformAnthropicMessages } from "pxpipe-proxy";

const { pages } = await renderTextToImages(toolResultText);     // pages[i].png: Uint8Array
const { body, applied, info } = await transformAnthropicMessages({
  body: requestBytes,
  model: "claude-fable-5",
});
```

`options.keepSharp(block)` pins blocks as text; `options.emitRecoverable`
returns the originals of imaged blocks and adds `rec_*` refs beside the
images; `options.losslessExact` keeps exact-risk blocks as text whenever
recoverable refs are off. Pure-JS runtime (Node and edge/Workers);
`@napi-rs/canvas` is build-time only. Full API: `src/core/index.ts`.

## Development

```bash
pnpm install && pnpm test
pnpm run build                # regenerates dist/
```

## FAQ

**Is the headline end-to-end, or only on the requests you touched?**
End-to-end, the whole bill. Most compression tools report savings only on
the input slice they touched, which flatters the number. The end-to-end
denominator is *every* production request: the small ones pxpipe correctly
left untouched, all cache writes and reads, and all output tokens (which the
proxy never compresses). On a 13,709-request snapshot that was 59% ($100 →
~$41); a later 8,904-compressed-request trace measured ~70%. Compressed-only
runs higher (~72–74%) and is quoted separately, never as the headline. The
exact figure is workload-dependent — reproduce it on your own log.

**How is the math measured?**
Both sides of the same request, at the same moment. For every `/v1/messages`
POST the proxy fires a free `count_tokens` probe on the original uncompressed
body (the counterfactual) in parallel with the real forward, and reads
Anthropic's actually-billed usage block off the response. Both land in the
same row of `~/.pxpipe/events.jsonl`, so there is no turn-count or
run-to-run confound. Dollar conversion uses Fable 5 list ratios: input ×1.0,
cache write ×1.25, cache read ×0.1, output ×5. Cache pricing is applied
identically to both sides, so the caching discount cancels and cannot be
double-counted as "savings". Re-derive it yourself from the events log: the
formula and field names are documented in `src/core/baseline.ts`.

**What does it actually compress?**
Three kinds of *input* blocks, each behind a profitability gate:

1. large `tool_result` bodies (file reads, command output, logs) above
   ~6k chars of token-dense content
2. older collapsed history: turns behind the live tail get re-rendered as
   image pages, recent turns always stay text
3. the static system prompt + tool docs slab

Everything else passes through byte-identical: your messages, recent turns,
the model's output (it is the response, the proxy never touches it), sparse
prose, and anything too small to win. Models outside the allowlist pass
through entirely — the default scope is Fable 5 and GPT 5.6 only. Opus 4.8
and GPT 5.5 read imaged content measurably worse (FINDINGS.md 2026-06-16),
so they are deliberately opt-in via the dashboard or `PXPIPE_MODELS`, never
silently imaged.

**Has it ever failed for real, outside the benchmarks?**
Yes, once in weeks of daily use: the model recalled a person's name from
imaged chat history and got it confidently wrong. No error, just a
plausible wrong name. That is the documented failure mode: exact strings
in imaged content are not byte-safe. Coding sessions tolerate this because
the agent re-reads files before editing; pure chat recall has no such check.
This failure mode is measured, not anecdotal:
[the legibility audit](docs/LEGIBILITY-AUDIT-2026-07-01.md) quantifies
exact-string recall off rendered pages (blind reads top out at 63% on dense
identifiers, with every miss predicted by a glyph-confusability matrix) and
documents the shipped mitigations — page geometry clamped to the API's
resample cap so billed pixels actually reach the vision encoder, and exact
identifiers (SHAs, numbers) riding alongside as text.

**Why are misses silent confabulations instead of read errors?**
Because model vision is not OCR: the image becomes patch embeddings, never
discrete characters, so there is no per-glyph confidence to fail loudly
on. When pixels underdetermine a glyph, the language prior fills the gap
with something plausible. Mechanism and receipts:
[docs/NOT-OCR.md](docs/NOT-OCR.md).

**Didn't DeepSeek-OCR show this doesn't hold up in practice?**
No: it proved the channel works, using an encoder/decoder pair trained for
the job. The skepticism dates from October 2025, when no stock production
model could read dense renders; that changed with Fable 5 (0/15 verbatim
hex on Opus 4.8 vs 13/15 on Fable 5, same pages). Timeline and per-model
numbers: [docs/NOT-OCR.md](docs/NOT-OCR.md).

**Why does the README read like an AI wrote it?**
Because one did. Most of this repo's commits — the code and the docs — were
authored by Opus/Fable agent sessions running behind pxpipe itself, reading
their own collapsed history as image pages while they worked.

## Limitations

- Lossy (above); verbatim recall from images is unreliable.
- PNG encoding adds latency to large requests before they leave.
- ASCII/Latin-1 well tested; CJK works but conservatively.

## Roadmap

Rendering research is parked as of 2026-07-05: verbatim misreads are
capacity-bound, not trick-bound, so no font/color/layout change fixes
exact-string recall at profitable density. The why is in
[docs/NOT-OCR.md](docs/NOT-OCR.md); the dated analysis and the three
documented follow-up threads (glyph-style A/B with banked pages, runtime
canary + re-fetch, surrogate-reader pre-flight) are in
[FINDINGS.md](FINDINGS.md), 2026-07-05 entry. Watch condition: re-run the
resolution sweep per model release; readable density moved ~4x in glyph
area from Opus 4.8 to Fable 5, and a model that reads production cells
near 100% means savings rise for free.

Still open, unchanged: whether imaged bulk stretches effective context (~2x
the real content in the same 1M window), and whether a smaller active
context improves long-task accuracy. Hypotheses, not claims — they ship as
numbers with an n or they get cut.

## License

MIT.
