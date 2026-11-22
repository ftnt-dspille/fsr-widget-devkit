#!/usr/bin/env bash
# Reuse a passing unit run for widget-push: `unit-pass-cache.sh <widgets_src> <widget> -- <test cmd...>`.
# Skips the test command when the same widget tree and harness tree already passed.
# The key covers the widget's HEAD plus any uncommitted diff, and the root HEAD plus
# the harness's uncommitted diff, so any code or test change re-runs the suites.
# FORCE_UNIT=1 always runs.
set -uo pipefail
# FSR_TOOL_HOME: the invoking checkout, set by run_from_main.sh (this script then runs from main's copy in a temp file)
ROOT="${FSR_TOOL_HOME:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
SRC="$1"; W="$2"; shift 2; [[ "${1:-}" == "--" ]] && shift
WD="$SRC/$W"
key="$( {
    git -C "$WD" rev-parse HEAD
    git -C "$WD" diff HEAD
    git -C "$WD" ls-files --others --exclude-standard | sort | while read -r f; do echo "$f"; cat "$WD/$f"; done
    git -C "$ROOT" rev-parse HEAD
    git -C "$ROOT" diff HEAD -- fortisoar-widget-harness
  } 2>/dev/null | shasum | cut -c1-16)"
dir="${XDG_CACHE_HOME:-$HOME/.cache}/fsr-unit-pass"
mark="$dir/$W-$key"
if [[ -z "${FORCE_UNIT:-}" && -f "$mark" ]]; then
    echo ">> unit: same widget and harness tree already passed ($W, $key); skipping (FORCE_UNIT=1 to re-run)"
    exit 0
fi
"$@" || exit $?
mkdir -p "$dir" && touch "$mark"
