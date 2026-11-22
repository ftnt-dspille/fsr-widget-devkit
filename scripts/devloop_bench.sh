#!/usr/bin/env bash
# make bench BOX=<alias>: the 11-22 timed task as a repeatable benchmark.
#
# A throwaway branch of the connector gets one fixed small edit in a package file
# (so the diff ships: tests, local-chat, a box push and a stamp all run), and goes
# through the two front doors: `make check`, commit, `make ship DRY_RUN=1`. The
# ship stops before the merge (PROMOTE_DRY_RUN), so nothing is ever promoted. Each
# phase lands in the lap ledger as `bench <phase>`; scripts/devloop_compare.py prints
# them against scripts/devloop_baseline.tsv. The branch, its worktree and the remote
# branch are removed at the end, whatever happened.
#
# Test hooks: BENCH_MAKE (the make binary).
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MAKE="${BENCH_MAKE:-make}"
[[ -n "${BOX:-}" ]] || { echo "bench: pass BOX=<alias> (an experimental box)" >&2; exit 2; }
CONN="${CONN_REPO:-$(bash "$HERE/scripts/repo_paths.sh" conn)}"
LEDGER="${FSR_LAP_LEDGER:-$HOME/.cache/fsr-laps.tsv}"; export FSR_LAP_LEDGER="$LEDGER"
LAPSH="$HERE/scripts/lap.sh"
since="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
stamp="$(date +%Y%m%d-%H%M%S)"
br="bench/devloop-$stamp"
tmp="$(mktemp -d "${TMPDIR:-/tmp}/devloop-bench.XXXXXX")"
wt="$tmp/conn_main"
rem="$(git -C "$CONN" for-each-ref --format='%(upstream:remotename)' refs/heads/main)"; rem="${rem:-origin}"
phase() { local name="$1"; shift; bash "$LAPSH" "bench $name" -- "$@"; }

cleanup() {
    git -C "$CONN" push -q "$rem" --delete "$br" >/dev/null 2>&1 || true
    git -C "$CONN" worktree remove --force "$wt" >/dev/null 2>&1 || true
    git -C "$CONN" branch -D "$br" >/dev/null 2>&1 || true
    rm -rf "$tmp"
    if [[ -z "${BENCH_MAKE:-}" ]]; then $MAKE -s -C "$HERE" box-release BOX="$BOX" >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT

git -C "$CONN" fetch -q "$rem" main || { echo "bench: cannot fetch $rem main" >&2; exit 2; }
phase setup git -C "$CONN" worktree add -q -b "$br" "$wt" "$rem/main" || exit 2

target="connector-fsr-agentic-assistant/tool_labels.py"
phase code bash -c 'printf "\n# bench %s: a fixed one-line edit the benchmark makes and never keeps\n" "$1" >> "$2"' _ "$stamp" "$wt/$target" || exit 2

# The two doors, from the connector worktree, forwarding to this checkout's root door.
export FSR_ALL_WIDGETS="$HERE"
phase check $MAKE -s -C "$wt" check || { echo "bench: make check failed; the run is not a measurement" >&2; exit 1; }
git -C "$wt" add -A && phase commit git -C "$wt" commit -q -m "bench: throwaway edit (never promoted)" || exit 2
phase ship $MAKE -s -C "$wt" ship BOX="$BOX" DRY_RUN=1 || { echo "bench: make ship failed; the run is not a measurement" >&2; exit 1; }

echo
python3 "$HERE/scripts/devloop_compare.py" --ledger "$LEDGER" --since "$since"
