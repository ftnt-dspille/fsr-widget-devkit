#!/usr/bin/env bash
# Summarise the lap ledger (scripts/lap.sh): per step, runs, last, median,
# max, budget and how many went over budget. `LAST=n` (default 200) recent rows.
ledger="${FSR_LAP_LEDGER:-$HOME/.cache/fsr-laps.tsv}"
[[ -s "$ledger" ]] || { echo "laps: no ledger yet at $ledger"; exit 0; }
tail -n "${LAST:-200}" "$ledger" | python3 "$(dirname "$0")/laps_summary.py"
