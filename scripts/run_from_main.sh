#!/usr/bin/env bash
# run_from_main.sh <script> [args...]: run scripts/<script> AS IT IS ON THIS ROOT
# REPO'S REMOTE MAIN, not the checkout's branch. Same mechanism as promote_main.sh
# (fetch the upstream main, `git show` the script into a temp file, run it), for
# tooling whose policy lives on main. The script gets FSR_TOOL_HOME=<this checkout>
# so it can still find sibling scripts and the repo; it must honor that instead of
# deriving its home from its own (temp) path.
#
# <script> is a name under scripts/, or a path from the repo root when it contains
# a slash (fortisoar-widget-harness/scripts/ship.sh).
#
# FROM_TREE=1 runs the working-tree copy instead: for developing the script itself
# (it still gets FSR_TOOL_HOME, so both modes take the same code path).
# RUN_FROM_MAIN_QUIET=1 drops the one-line "from origin/main <sha>" notice.
set -euo pipefail
name="${1:?usage: run_from_main.sh <script> [args...]}"; shift
here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
rel="scripts/$name"; case "$name" in */*) rel="$name" ;; esac
if [ "${FROM_TREE:-}" = 1 ]; then FSR_TOOL_HOME="$here" exec bash "$here/$rel" "$@"; fi
remote="$(git -C "$here" for-each-ref --format='%(upstream:remotename)' refs/heads/main)"
remote="${remote:-origin}"
git -C "$here" fetch -q "$remote" main 2>/dev/null \
  || echo "$name: could not fetch $remote main; using the last fetched copy" >&2
sha="$(git -C "$here" rev-parse "refs/remotes/$remote/main")"
tmp="$(mktemp "${TMPDIR:-/tmp}/run_from_main.XXXXXX")"
trap 'rm -f "$tmp"' EXIT
git -C "$here" show "$sha:$rel" > "$tmp"
[ -n "${RUN_FROM_MAIN_QUIET:-}" ] || echo "$name: from $remote/main ${sha:0:9}" >&2
FSR_TOOL_HOME="$here" bash "$tmp" "$@"
