# Model render profiles

OpenAI-shaped endpoints are wire protocols, not rendering profiles. Claude and
GPT requests can both arrive on `/v1/responses`, so imgtokenx resolves image
geometry, font, style, and billing from the exact model id.

## Built-in profiles

| Model rule | Reader default | Font / cell | Columns | Max height |
|---|---|---|---:|---:|
| `claude-fable-5` | image | Spleen + Unifont, 5x8 | 312 | 728 px |
| `claude-opus-4-*` | image | Spleen + Unifont, 20x32 | 78 | 728 px |
| `claude-sonnet-5` | image | Spleen + Unifont, 20x32 | 78 | 728 px |
| `claude-haiku-4-5` | image | Spleen + Unifont, 20x32 | 78 | 728 px |
| other Claude models | text only until calibrated | Spleen + Unifont, 5x8 | 312 | 728 px |
| `gpt-5.6-sol` | image | JetBrains Mono 10 + Unifont fallback, 6x11 | 126 | 1932 px |
| `gpt-5.6-terra` | image | Spleen + Unifont fallback, 5x8 | 152 | 1932 px |
| `gpt-5.6-luna` | image | Spleen + Unifont fallback, 5x8 | 152 | 1932 px |
| other GPT/o-series models | text only until calibrated | conservative 5x8 fallback | 152 | 1932 px |

Model scope and reader safety are separate gates. `IMGTOKENX_MODELS` decides
which model ids may reach the transformer. `IMGTOKENX_READER_PROFILES` decides
whether an imaged profile is trusted. A model that fails either gate remains
ordinary text.

## GPT 5.6 Terra / Luna proxy evidence (2026-07-14)

Three independent subscription-side subagents blindly read six scored fields
at all seven production densities. The Terra and Luna proxy readers each scored
42/42 (100%) and passed all seven densities; 5x8 wins as the smallest tied
profile. The Sol proxy scored 35/42 (83.3%) by lowercasing the exact camelCase
field at every density, which triggered the stricter follow-up documented below.
These are assigned proxy-reader results, not provider-routed exact-model API
measurements.

## Sonnet 5 / Haiku 4.5 evidence (2026-07-10)

Calibrated keylessly: the `eval/reader-capacity/` fixture was rendered to PNG
pages by the production renderer at four densities and read blind by
subscription-side subagents (one per model x density, so answers cannot leak
across variants). Both models scored 6/6 on the exact/gist/guard battery only
at 20x32; every smaller density (5x8, 7x10, 9x12) confabulated at least one
exact value (invented ports, an invented field name, a wrong hex digit). The
guard question was refused correctly at all densities on both models. Pages
were kept within 1568x728, matching what the proxy emits.

## GPT 5.6 Sol evidence

The Sol renderer is exact-model-specific: Terra and Luna retain the
conservative fallback and do not inherit Sol tuning. Its first paid raw-image pilot
failed the acceptance bar at both tested densities:

| Profile | Exact | Confabulations | Gist | Guard |
|---|---:|---:|---|---|
| JetBrains 6x11 / 126 columns | 0/4 | 4 | pass | pass |
| Spleen 5x8 / 152 columns | 0/4 | 4 | fail | pass |

The approved subscription-side proxy follow-up tightened the exact-case prompt,
used two fresh fixtures, and added both JetBrains and Spleen candidates. Three
blind readers scored 324/324 fields across nine profiles. The existing
JetBrains 6x11 profile therefore became the built-in Sol reader without a
renderer change. This proxy evidence does not erase the earlier exact-provider
failure; receipts and the guarded evaluator remain in
[`eval/sol-profile/`](../eval/sol-profile/).

Lossless-exact blocks, factsheets, and `rec_*` recovery references remain
active independently of the selected visual profile.

## Overrides

`IMGTOKENX_GPT_PROFILES` maps model-id prefixes to partial profiles. The
longest prefix wins. Supported style fields are `font`, `cellWBonus`,
`cellHBonus`, `aa`, `grid`, `gridCols`, `colorCycle`, `markerScale`, and
`markerRed`; geometry fields are `stripCols` and `maxHeightPx`.

```bash
IMGTOKENX_GPT_PROFILES='{
  "gpt-5.6-sol": {
    "stripCols": 120,
    "style": { "grid": true, "gridCols": 4 }
  }
}'
```

The profitability gate derives width, row capacity, pagination, and image cost
from the same resolved profile used by slab and history rendering.
