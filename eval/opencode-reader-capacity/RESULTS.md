# OpenCode free-model reader calibration — 2026-07-14

The exact live Zen aliases were tested through the user's authenticated OpenCode
CLI. No API key was read or copied. A model is eligible only with image input,
zero confabulation, exact/gist/guard success, and positive paired input-token
savings.

## Capability

| Model | Catalog image input | Live PNG smoke | Reader result |
|---|:---:|---|---|
| `hy3-free` | no | refused image input | text only |
| `north-mini-code-free` | no | refused image input | text only |
| `nemotron-3-ultra-free` | no | refused image input | text only |
| `deepseek-v4-flash-free` | no | could not inspect image | text only |
| `big-pickle` | no | refused image input | text only |
| `mimo-v2.5-free` | yes | read visible image text | swept below |

## MiMo V2.5 Free

Production OpenAI-shaped geometry (maximum 768×1932) was used. Savings compare
provider-reported input-equivalent tokens for paired native-text and image runs.
Every arm used the same seeded exact/gist/guard fixture.

| Profile | Exact | Confabulations | Gist | Guard | Input savings | Result |
|---|---:|---:|:---:|:---:|---:|:---:|
| Spleen 5×8 | 1/4 | 3 | fail | pass | 6.1% | fail |
| JetBrains 6×11 | 0/4 | 3 | pass | pass | 5.5% | fail |
| Spleen 7×10 | 1/4 | 3 | fail | pass | 5.5% | fail |
| JetBrains 7×13 | 1/4 | 3 | pass | pass | 5.5% | fail |
| Spleen 9×12 | 1/4 | 2 | fail | pass | 5.1% | fail |
| JetBrains 9×12 | 1/4 | 2 | pass | pass | 5.0% | fail |
| Spleen 10×16 | 2/4 | 1 | pass | pass | 4.4% | fail |
| Spleen 11×18 | 0/4 | 3 | pass | pass | 4.1% | fail |
| Spleen 12×20 | 0/4 | 3 | pass | pass | 3.3% | fail |
| Spleen 14×22 | 1/4 | 3 | pass | pass | 2.4% | fail |
| Spleen 20×32 | 1/4 | 3 | pass | pass | -1.5% | fail |

Aggregate: 0/11 clean profiles, 9/44 exact fields, 29 confabulations,
8/11 gist, and 11/11 guard. The first native-text control also miscopied one
identifier; its retry passed 4/4, confirming model-level exact-copy variance.

## Decision

No OpenCode free model is enabled for imaging. The existing uncalibrated-model
gate remains correct: all six stay lossless text passthrough. MiMo accepts images
but fails the zero-confabulation bar at every tested cell; the other five cannot
consume image input at all.

Re-run with:

```bash
node eval/opencode-reader-capacity/run.mjs --models=mimo-v2.5-free
```

Zen aliases may be remapped, so capability and calibration must be repeated
before enabling a future revision.
