# Reader-capacity calibration sweep

Repeatable, generic version of the one-off `eval/opus-density/` sweep for issue
#6. It renders the same synthetic precision-heavy transcript through the
production renderer, asks the same fixed question battery, scores the same
exact/gist/guard outcomes, and emits candidate `reader-profiles.ts` values from
the smallest cell-size variant that clears the acceptance bar.

This tool does not edit production code. `src/core/reader-profiles.ts` remains
hand-edited after a human reviews a live sweep result.

## Usage

```bash
# Dry run: renders every variant, checks token accounting, no model calls.
node eval/reader-capacity/run.mjs --dry-run

# CLI model list: comma-separated, defaults to claude-opus-4-8,claude-fable-5.
node eval/reader-capacity/run.mjs claude-opus-4-8,gpt-5.5 --dry-run

# Live Anthropic run: scores the battery and writes results.json.
ANTHROPIC_API_KEY=sk-ant-... node eval/reader-capacity/run.mjs claude-opus-4-8,claude-fable-5

# Optional profile-row output for pasting into reader-profiles.ts after review.
ANTHROPIC_API_KEY=sk-ant-... node eval/reader-capacity/run.mjs claude-opus-4-8 --profiles-out /tmp/reader-profile.txt
```

Results default to `eval/reader-capacity/results.json`. Use `--out path` to
write elsewhere, or `--out -` to print JSON to stdout. `--dry-run` forces local
rendering/accounting only, even if `ANTHROPIC_API_KEY` is set.

The live scorer intentionally keeps the `eval/opus-density/` Anthropic Messages
call path. The CLI accepts any model id for accounting and output bookkeeping;
only models accepted by that API path can be live-scored without extending the
caller.

## Variants

Each variant keeps the <=1568x728 page cap so images stay in Anthropic's
linear-billing window:

- `5x8` - production density: `{ cellWBonus: 0, cellHBonus: 0 }`
- `7x10` - larger cells: `{ cellWBonus: 2, cellHBonus: 2 }`
- `9x12` - largest cells in this sweep: `{ cellWBonus: 4, cellHBonus: 4 }`

## Acceptance bar

A variant is eligible for a `safeToImage: true` reader profile only if all three
clauses hold:

- gist recall is correct for the fixed gist question,
- every exact-identifier question is either correct or safely abstains, with
  zero silent wrong exact strings,
- token savings stay positive on the token-dense synthetic transcript.

The guard question must also pass: for a fact never stated in the transcript, the
model must answer as not stated or otherwise refuse to invent it. If no scored
variant clears the bar, the emitted profile is:

```ts
{ safeToImage: false, cellWBonus: 0, cellHBonus: 0 }
```

Dry runs do not emit safe profiles because they contain no model-read evidence.
