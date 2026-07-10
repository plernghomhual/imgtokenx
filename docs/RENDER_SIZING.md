# How imgtokenx sizes rendered images

This is the current source-of-truth note for imgtokenx image geometry. Historical
experiments are intentionally summarized at the bottom so future tuning does not
reuse old 1928px / `px/750` assumptions.

## Current behavior

The default Anthropic-facing dense page uses one 5x8 glyph cell per character:

- `PAD_X = PAD_Y = 4`
- `CELL_W = 5`
- `CELL_H = 8`
- `DENSE_CONTENT_COLS = 312`
- `MAX_HEIGHT_PX = 728`
- `DENSE_CONTENT_CHARS_PER_IMAGE = 28,080`
- `READABLE_CHARS_PER_IMAGE = 28,080`

At full width:

```text
width  = 2 * 4 + 312 * 5 = 1568 px
height = 728 px
rows   = floor((728 - 8) / 8) = 90
chars  = 312 * 90 = 28,080
```

That fits Anthropic's standard 1568px edge and the roughly 1.15 MP fidelity
threshold measured in the July 2026 legibility audit.

Reader and transport profiles may select a different cell and column count.
Opus 4.x uses its calibrated 20x32 cell at 78 columns, preserving the same
1568px edge; OpenAI-shaped GPT traffic can select a
different atlas and geometry by exact model id. `gpt-5.6-sol`, for example, has
a 6x11 JetBrains Mono profile at 126 columns, but remains text-only until its
reader profile is explicitly enabled. See
[`MODEL_RENDER_PROFILES.md`](MODEL_RENDER_PROFILES.md).

## Billing model

Anthropic image token estimates use the documented visual-patch formula:

```text
tokens = ceil(width / 28) * ceil(height / 28)
```

imgtokenx gates compression with a 10% safety margin, so a full 1568x728 page is
estimated as:

```text
ceil(1568 / 28) * ceil(728 / 28) = 56 * 26 = 1456
gate estimate = ceil(1456 * 1.10) = 1602 tokens
```

Use `ANTHROPIC_PATCH_PX` and `IMAGE_COST_SAFETY_MARGIN` from
`src/core/transform.ts`; do not duplicate constants in tests or docs.

## Width behavior

The shared renderer can select a font atlas, derive its cell dimensions, shrink
a page to the measured content width, and pack
multiple columns when asked. The proxy's dense default is a single column capped
at `DENSE_CONTENT_COLS`; `denseContentColsForCellWidth` lowers that cap for
larger reader cells.

Relevant entry points:

- `renderCellWidth` / `renderCellHeight` in `src/core/render.ts`
- `renderTextToPngsWithCharLimit` in `src/core/render.ts`
- `renderDensePages` in `src/core/render.ts`
- `renderTextToImages` in `src/core/library.ts`
- `textToImageBlocks` in `src/core/transform.ts`

The export and proxy paths share the same renderer so byte-identical input
produces byte-identical PNG pages at the same options.

## Exactness

Images are for gist, layout, and bulk context. Exact identifiers, hashes, IDs,
paths, secrets, and quoted strings must ride in text via the factsheet or
recoverable sidecar. Do not optimize image geometry assuming OCR alone can
provide byte-exact recall.

## Historical notes

Older docs and tests used a 1928x1932-ish page with `DENSE_CONTENT_COLS=384`
and an area estimate near `width * height / 750`. That was superseded after the
legibility audit showed server-side downscaling destroyed glyph detail before
the vision encoder. The current 1568x728 page deliberately trades fewer
characters per image for stable legibility and predictable patch-grid billing.

The old 7x10 and 5x11 atlas comments are also historical. The current dense
style is the 5x8 cell in `src/core/render.ts`.
