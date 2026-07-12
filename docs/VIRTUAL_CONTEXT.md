# Virtual context

Virtual context is an opt-in, provider-neutral layer that runs before image
transformation. Its goal is to stop paying repeatedly for exact bulk that a model
does not need on every turn, while keeping that bulk locally retrievable.

## Modes

Set `IMGTOKENX_VIRTUAL_CONTEXT` to one of:

| mode | behavior |
|---|---|
| `off` | Default. No artifact replacement. |
| `dedup` | For repeated tool results at least 8 KiB, retain the first exact copy and replace later copies with the same SHA-256 handle. |
| `lazy` | Store each large tool result and send a deterministic head/error/tail preview plus the exact handle; small changes from the same stable tool name+arguments use an exact line delta. |
| `state` | Apply `lazy`, then accept a validated proof checkpoint as the boundary for older conversation history. |

The layer recognizes Anthropic `tool_result`, OpenAI Chat `tool` messages, and
Responses `function_call_output` items. It works on `/opencode/*` requests too,
independent of whether the selected Zen model is safe for image input. Once a
result is virtualized, imgtokenx leaves its compact representation as native text
instead of imaging it again.

## Exact artifact tools

`imgtokenx mcp` keeps the existing `imgtokenx_recover` tool and adds:

- `imgtokenx_context`: `search`, `fetch`, `diff`, `checkpoint_store`, and
  `checkpoint_read` actions. Handles are full `sha256_<64 hex>` values. Search is
  case-sensitive literal matching; fetch, match counts, snippets, diffs, and
  checkpoint sizes are bounded.
- `imgtokenx_inspect`: bounded, literal, read-only workspace search with relative
  path excerpts. It never accepts a root path, runs a shell command, follows a
  symlink, or writes a file. It is disabled until the host explicitly sets
  `IMGTOKENX_WORKSPACE_ROOT`; filesystem root and the home directory are refused.
  Sensitive credential filenames are skipped, and total scanned bytes and
  returned excerpts are capped.

Artifact files share `IMGTOKENX_RECOVERABLE_DIR` and its retention controls.
The directory is forced to `0700`, files to `0600`, writes are atomic, and reads
verify the content hash. Disabling recovery storage also disables virtual context.

Automatic deltas are deliberately conservative. Both base and new artifacts
must be stored and exposed in the request, the provider must supply the same
exact tool name+arguments for both results, and the complete reconstructable
delta must be smaller than both the preview and half the new source. Otherwise
the normal deterministic preview is used. The base can be reconstructed with
`split("\n")`, the declared line splice, and `join("\n")`; `diff` remains
available for inspection.

## Proof checkpoints

Store a JSON checkpoint with `checkpoint_store`, then emit the returned marker:

```text
imgtokenx_checkpoint:sha256_<64 lowercase hex>
```

The checkpoint JSON must have `version: 1` and a non-empty `goal`. Optional
bounded string-array fields are `constraints`, `decisions`, `active_files`,
`tests`, `blockers`, `pending`, and `evidence`. Every evidence entry that is an
artifact handle must exist before the checkpoint is trusted.

In `state` mode, a valid marker can replace only history before the checkpoint.
System/developer authority, the checkpointing tool-call pair, and everything
after it stay in order. Missing, malformed, oversized, or unverifiable checkpoints
fail open to the original history.

## Output guidance and accounting

`IMGTOKENX_OUTPUT_EFFICIENCY=1` adds a short instruction to cite artifact ranges
and return focused values/diffs instead of reprinting large retrieved sources.
It is behavioral guidance only: imgtokenx never truncates output, changes the
model, or bypasses client permissions.

Telemetry records only counts and character totals: candidates/writes, source
characters virtualized, duplicate/preview/delta/state characters, checkpoint
status, fail-open status, and aggregate MCP calls/results. Artifact contents,
queries, handles, and filesystem paths are not written to the event log.
Provider usage remains the authority for billed-token savings;
image and virtual-context reductions are not counted twice.

## Rollout

Start with `dedup`, compare task correctness and actual provider usage, then test
`lazy`. Enable `state` only after the client reliably produces proof checkpoints.
Keep all three off if local persistence is inappropriate for the workload.
