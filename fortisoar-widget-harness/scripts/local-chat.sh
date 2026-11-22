#!/usr/bin/env bash
# One local, box-free chat turn: the real agenticAssistant widget in the harness, the
# real connector in local Python (the hermetic sidecar), Frank as the model (fake if
# Frank is down), and a fixture bundle standing in for the FortiSOAR box. Starts
# everything, sends ONE message, saves a screenshot + transcript + tool calls, tears
# everything down. Front door: `make local-chat BUNDLE=<name> [ASK=...]` (root Makefile).
#
#   BUNDLE   a conn_main fixture bundle. If scripts/conversations/sweep/<BUNDLE>.json
#            exists, its mount record and first user message are the defaults.
#   ASK      the message to send (default: the sweep spec's first user message)
#   RECORD   record uuid to mount (default: the sweep spec's mount.uuid)
#   MODULE   module of RECORD (default: the sweep spec's mount.module, else alerts)
#   LLM      auto (default: Frank when reachable, else fake) | frank | fake
#   MODEL    gateway model id (default: the resolver's)
#   OUT      output dir (default: <repo>/scratch/local-chat/<bundle>-<time>)
#   TIMEOUT  seconds to wait for the turn (default 600)
set -uo pipefail

HARNESS="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="$(cd "$HARNESS/.." && pwd)"
CONN="${CONN_REPO:-$(bash "$ROOT/scripts/repo_paths.sh" conn)}"
PY="$HARNESS/.venv-localdev/bin/python"
BUNDLE="${BUNDLE:-}"
[ -n "$BUNDLE" ] || { echo "usage: make local-chat BUNDLE=<bundle> [ASK=\"...\"] [LLM=auto|frank|fake] [MODEL=<id>]" >&2; exit 2; }
[ -x "$PY" ] || { echo "no $PY; run make setup" >&2; exit 2; }
LLM="${LLM:-auto}"
OUT="${OUT:-$ROOT/scratch/local-chat/${BUNDLE##*/}-$(date +%H%M%S)}"
mkdir -p "$OUT"
START=$(date +%s)

# Defaults from the sweep spec (one source: the same row the connector's sweeps run).
SPEC="$CONN/scripts/conversations/sweep/$BUNDLE.json"
eval "$("$PY" - "$SPEC" <<'PYEOF'
import json, os, shlex, sys
spec = {}
if os.path.isfile(sys.argv[1]):
    spec = json.load(open(sys.argv[1]))
mount = spec.get("mount") or {}
steps = spec.get("steps") or [{}]
for k, v in (("SPEC_UUID", mount.get("uuid", "")), ("SPEC_MODULE", mount.get("module", "")),
             ("SPEC_ASK", steps[0].get("user", "")), ("SPEC_RECORDS", spec.get("records", ""))):
    print(f"{k}={shlex.quote(str(v))}")
PYEOF
)"
RECORD="${RECORD:-$SPEC_UUID}"; MODULE="${MODULE:-${SPEC_MODULE:-alerts}}"
ASK="${ASK:-$SPEC_ASK}"; BUNDLE_NAME="${SPEC_RECORDS:-$BUNDLE}"
[ -n "$RECORD" ] || { echo "no RECORD: $BUNDLE has no sweep spec, pass RECORD=<uuid> [MODULE=...]" >&2; exit 2; }
[ -n "$ASK" ] || { echo "no ASK: pass ASK=\"...\"" >&2; exit 2; }

free_port() { "$PY" -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1])'; }
SP=$(free_port); HP=$(free_port)
PIDS=()
cleanup() { for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null; done; wait 2>/dev/null; }
trap cleanup EXIT

wait_for() {  # url, label, log
  for _ in $(seq 1 120); do curl -sf "$1" >/dev/null 2>&1 && return 0; sleep 0.5; done
  echo "$2 failed to start; log tail:" >&2; tail -30 "$3" >&2; return 1
}

CONN_REPO="$CONN" FSRPB_DEV=1 FSRPB_SIDECAR_HERMETIC=1 FSRPB_SIDECAR_PORT="$SP" \
  FSRPB_SIDECAR_BUNDLE="$BUNDLE_NAME" FSRPB_SIDECAR_LLM="$LLM" FSRPB_SIDECAR_MODEL="${MODEL:-}" \
  FSRPB_SIDECAR_TRACE="$OUT/trace.jsonl" \
  "$PY" "$HARNESS/scripts/local-connector-sidecar.py" > "$OUT/sidecar.log" 2>&1 &
PIDS+=($!)
wait_for "http://127.0.0.1:$SP/health" sidecar "$OUT/sidecar.log" || exit 1
curl -s "http://127.0.0.1:$SP/health" | "$PY" -c 'import json,sys;d=json.load(sys.stdin);print("local-chat: model =",d["llm"]["kind"]+":"+d["llm"]["model"],"("+d["llm"]["reason"]+"), bundle =",d["bundle"])' | tee "$OUT/llm.txt"

# FSR_BASE_URL points at a dead loopback port: the harness's .env names a real box,
# and "box-free" must not depend on nobody noticing a stray auth or proxy call.
(cd "$HARNESS" && PORT="$HP" FSR_BASE_URL=https://127.0.0.1:9 FSR_PORT= FSR_USERNAME=local FSR_PASSWORD=local \
  FSR_HERMETIC=1 FSR_LOCAL_CONNECTOR=1 FSR_LOCAL_BOX=1 \
  FSRPB_SIDECAR_URL="http://127.0.0.1:$SP/execute" node server.js > "$OUT/harness.log" 2>&1) &
PIDS+=($!)
wait_for "http://localhost:$HP/_fsr/info" harness "$OUT/harness.log" || exit 1

(cd "$HARNESS" && HARNESS_BASE="http://localhost:$HP" node scripts/widget-inspect.js \
  --widget agenticAssistant --module "$MODULE" --record "$RECORD" --viewport 1200x1600 \
  --send "$ASK" --turn-timeout $(( ${TIMEOUT:-600} * 1000 )) \
  --transcript "$OUT/transcript.json" --screenshot "$OUT/chat.png") > "$OUT/inspect.json" 2> "$OUT/inspect.err"
RC=$?

"$PY" "$HARNESS/scripts/local-chat-report.py" "$OUT" "$ASK" || true
echo "local-chat: $(( $(date +%s) - START ))s wall, rc=$RC, out=$OUT"
exit $RC
