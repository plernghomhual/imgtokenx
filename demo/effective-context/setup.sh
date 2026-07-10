#!/usr/bin/env bash
# Effective-context demo setup: generate the big context, kill old proxies, build,
# start BOTH proxies (background, fresh logs), seed two fresh /tmp working copies.
# Run this ONCE, then run a.sh and b.sh in two other terminals.
#
#   bash demo/effective-context/setup.sh
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1   # -> repo root

PORT_ON=47824          # imgtokenx      -> b.sh (right)
PORT_OFF=47823         # passthrough -> a.sh (left, plain but logged)
LOG_ON="$HOME/.imgtokenx/ec-on.jsonl"
LOG_OFF="$HOME/.imgtokenx/ec-off.jsonl"
DUMP_DIR="/tmp/ec-png"   # imgtokenx arm dumps every rendered PNG here for debug/inspection (wiped each run)
# Model under test: defaults to Fable 5 — the production default, where Opus is
# OFF. Pass a model as the first arg to ADD it to the proxy's compress scope:
#   bash setup.sh           -> Fable only (Opus off, matches production)
#   bash setup.sh opus      -> Fable + Opus 4.8   (then: a.sh opus / b.sh opus)
#   bash setup.sh sonnet|haiku|claude-...  -> Fable + that model
case "${1:-fable}" in
  fable)  MODEL=claude-fable-5 ;;
  opus)   MODEL=claude-opus-4-8 ;;
  sonnet) MODEL=claude-sonnet-5 ;;
  haiku)  MODEL=claude-haiku-4-5 ;;
  *)      MODEL="$1" ;;
esac
# Compress scope = Fable (production default) + the chosen model (Fable-only by default).
# Entries are model BASES: the proxy strips [variant] tags (e.g. [1m]) before matching
# (see src/core/applicability.ts), so base "claude-fable-5" already covers the
# claude-fable-5[1m] that a.sh/b.sh now request. Do NOT add [1m] here — the stripped
# incoming base would no longer equal this entry and imgtokenx would quietly stop compressing.
MODELS="claude-fable-5"; [ "$MODEL" = "claude-fable-5" ] || MODELS="claude-fable-5,$MODEL"
EC="demo/effective-context"

kill_port() { local p; p=$(lsof -ti tcp:"$1" 2>/dev/null || true); [ -n "$p" ] && kill "$p" 2>/dev/null || true; }

echo "[1/5] kill old proxies ($PORT_ON, $PORT_OFF)"
kill_port "$PORT_ON"; kill_port "$PORT_OFF"; sleep 1

echo "[2/5] build"
pnpm run build >/tmp/ec-build.log 2>&1 || { echo "  build FAILED -> /tmp/ec-build.log"; exit 1; }

echo "[3/5] generate context (flood + needle)"
ANSWER=$(node "$EC/generate.mjs" | tee /tmp/ec-gen.log | sed -n 's/^--- expected answer (ground truth): \(.*\) ---$/\1/p')

echo "[4/5] start proxies (background, fresh logs)"
: >"$LOG_ON"; : >"$LOG_OFF"
rm -rf "$DUMP_DIR"; mkdir -p "$DUMP_DIR"   # fresh PNG dump for the imgtokenx (compress) arm; the passthrough arm renders nothing
IMGTOKENX_LOG="$LOG_ON"  PORT="$PORT_ON"  IMGTOKENX_MODELS="$MODELS" IMGTOKENX_DUMP_DIR="$DUMP_DIR" nohup node dist/node.js >/tmp/ec-on.log  2>&1 & disown
IMGTOKENX_LOG="$LOG_OFF" PORT="$PORT_OFF" IMGTOKENX_MODELS="$MODELS" IMGTOKENX_DISABLE=1            nohup node dist/node.js >/tmp/ec-off.log 2>&1 & disown
sleep 2

echo "[5/5] seed two read-only working copies (context/ only)"
rm -rf /tmp/pp-ec-left /tmp/pp-ec-right
mkdir -p /tmp/pp-ec-left /tmp/pp-ec-right
cp -R "$EC/context" /tmp/pp-ec-left/context
cp -R "$EC/context" /tmp/pp-ec-right/context

cat <<EOF

Ready. Proxies up: imgtokenx :$PORT_ON  ·  passthrough :$PORT_OFF
Compress scope: $MODELS  (Opus is OFF by default — 'setup.sh opus' to include it; pass the SAME model to a.sh/b.sh)
GROUND-TRUTH ANSWER: ${ANSWER:-see /tmp/ec-gen.log}   <- both columns should reply with exactly this
Rendered PNGs (what the imgtokenx model actually sees): $DUMP_DIR   (wiped + refilled each setup; passthrough arm renders none)

In a browser, open the live dashboard (context/token reduction, updates as it reads):
  http://localhost:$PORT_ON     # imgtokenx   -> "THIS SESSION — N% fewer tokens"
  http://localhost:$PORT_OFF    # plain    -> ~0% (the passthrough control)

Then, in TWO separate terminals:
  bash $EC/a.sh        # LEFT  = normal  (may DROWN in filler -> wrong integer)
  bash $EC/b.sh        # RIGHT = imgtokenx  (images filler, keeps needle as text -> ${ANSWER:-right})

The win is CAPABILITY, not cost: watch each column's final integer. To redo, re-run
this setup (fresh context, fresh logs, fresh copies), then a.sh / b.sh.
EOF
