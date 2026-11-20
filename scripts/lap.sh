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
"$@"; rc=$?
secs=$((SECONDS - t0))
note=""; [[ $rc -ne 0 ]] && note=" FAILED"
if [[ -n "$budget" && $secs -gt $budget ]]; then
    note="$note OVER BUDGET (${budget}s)"
    echo "lap: WARNING $label took ${secs}s, budget ${budget}s (ledger: make laps)" >&2
fi
echo "   [${secs}s] $label$note"
ledger="${FSR_LAP_LEDGER:-$HOME/.cache/fsr-laps.tsv}"
mkdir -p "$(dirname "$ledger")" 2>/dev/null
printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$label" "$secs" "$rc" "${budget:--}" \
    "$(basename "$(git rev-parse --show-toplevel 2>/dev/null || pwd)")" >> "$ledger" 2>/dev/null || true
exit $rc
