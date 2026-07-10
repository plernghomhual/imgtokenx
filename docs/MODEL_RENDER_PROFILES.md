# Model render profiles

OpenAI-shaped endpoints are wire protocols, not rendering profiles. Claude and
GPT requests can both arrive on `/v1/responses`, so imgtokenx resolves image
geometry, font, style, and billing from the exact model id.

## Built-in profiles

| Model rule | Reader default | Font / cell | Columns | Max height |
|---|---|---|---:|---:|
| `claude-fable-5` | image | Spleen + Unifont, 5x8 | 312 | 728 px |
| `claude-opus-4-*` | image | Spleen + Unifont, 20x32 | 78 | 728 px |
| other Claude models | text only until calibrated | Spleen + Unifont, 5x8 | 312 | 728 px |
| generic `gpt-5.6` | image | Spleen + Unifont, 5x8 | 152 | 1932 px |
| `gpt-5.6-sol` | **text only until calibrated** | JetBrains Mono 10 + Unifont fallback, 6x11 | 126 | 1932 px |
| other GPT/o-series models | text only until calibrated | conservative 5x8 fallback | 152 | 1932 px |

Model scope and reader safety are separate gates. `IMGTOKENX_MODELS` decides
which model ids may reach the transformer. `IMGTOKENX_READER_PROFILES` decides
whether an imaged profile is trusted. A model that fails either gate remains
ordinary text.

## GPT 5.6 Sol evidence

The Sol renderer is exact-model-specific: sibling ids such as
`gpt-5.6-terra` retain the generic profile. Its first paid raw-image pilot
failed the acceptance bar at both tested densities:

| Profile | Exact | Confabulations | Gist | Guard |
|---|---:|---:|---|---|
| JetBrains 6x11 / 126 columns | 0/4 | 4 | pass | pass |
| Spleen 5x8 / 152 columns | 0/4 | 4 | fail | pass |

The renderer remains available for retuning, but Sol stays text-only by
default. Receipts and the guarded evaluator live in
[`eval/sol-profile/`](../eval/sol-profile/).

An operator accepting that risk must enable both gates explicitly:

```bash
IMGTOKENX_MODELS='claude-fable-5,gpt-5.6-sol'
IMGTOKENX_READER_PROFILES='{"gpt-5.6-sol":{"safeToImage":true}}'
```

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
