#!/usr/bin/env bash
# Time one step: `lap.sh <label> [--budget N] -- <cmd...>` runs cmd, prints
# "   [Ns] <label>" (FAILED / OVER BUDGET when so) and keeps cmd's exit status.
#
# Every lap is appended to one ledger ($FSR_LAP_LEDGER, default
# ~/.cache/fsr-laps.tsv): ts, label, seconds, rc, budget, repo. A step that
# goes over its budget warns on the FIRST run that does, instead of sitting
# slow for days. `make laps` summarises the ledger. Budgets warn, never fail.
label="$1"; shift
budget=""
if [[ "${1:-}" == "--budget" ]]; then budget="$2"; shift 2; fi
[[ "${1:-}" == "--" ]] && shift
t0=$SECONDS
# Keep a copy of the step's output (both streams still reach the caller as
# they happen) so a FAILED step's reason lands in the ledger even when the
# caller filters what it shows.
out="$(mktemp "${TMPDIR:-/tmp}/lap.XXXXXX")"
# A step can report time that is not its own work (promote's wait for CI):
# it appends seconds to $LAP_EXCLUDE_FILE, they are taken off this lap, and the
# step records them as their own ledger line (scripts/lap_record.sh).
LAP_EXCLUDE_FILE="$(mktemp "${TMPDIR:-/tmp}/lap-x.XXXXXX")"; export LAP_EXCLUDE_FILE
"$@" > >(tee -a "$out") 2> >(tee -a "$out" >&2); rc=$?
wait 2>/dev/null
secs=$((SECONDS - t0))
excl=$(awk '{s+=$1} END{print s+0}' "$LAP_EXCLUDE_FILE" 2>/dev/null); rm -f "$LAP_EXCLUDE_FILE"
(( excl > 0 && excl <= secs )) && secs=$((secs - excl))
note=""; [[ $rc -ne 0 ]] && note=" FAILED"
if [[ -n "$budget" && $secs -gt $budget ]]; then
    note="$note OVER BUDGET (${budget}s)"
    echo "lap: WARNING $label took ${secs}s, budget ${budget}s (ledger: make laps)" >&2
fi
echo "   [${secs}s] $label$note"
ledger="${FSR_LAP_LEDGER:-$HOME/.cache/fsr-laps.tsv}"
mkdir -p "$(dirname "$ledger")" 2>/dev/null
ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
faillog="-"
if [[ $rc -ne 0 ]]; then
    # Column 7: the last 20 lines of a failed step, kept beside the ledger.
    faillog="$(dirname "$ledger")/fsr-laps-failed/${ts//:/}-${label// /_}.log"
    mkdir -p "$(dirname "$faillog")" 2>/dev/null
    tail -n 20 "$out" > "$faillog" 2>/dev/null || faillog="-"
fi
rm -f "$out"
printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$ts" "$label" "$secs" "$rc" "${budget:--}" \
    "$(basename "$(git rev-parse --show-toplevel 2>/dev/null || pwd)")" "$faillog" >> "$ledger" 2>/dev/null || true
exit $rc
