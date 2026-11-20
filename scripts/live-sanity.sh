#!/usr/bin/env bash
# Live sanity after a dev push: the ONE entry point every push path calls
# (widget-push here; deploy / loop / ship-dev / dev-push in the connector repo),
# and `make doctor BOX=<name> SANITY=1` for a re-check without pushing.
#
#   BOX=<alias>                            box, resolved through the pyfsr registry
#                                          ($CONN_REPO/scripts/box.sh; no default)
#   WIDGETS=a,b                            scope (default: assistant + Monitor + everything)
#   LIVE_SANITY_FRAMEWORK=<path>           framework checkout that was dev-pushed (stamped)
#   SKIP_LIVE_SANITY=1                     opt out, loudly
#
# Checks, verdict and stamps: fortisoar-widget-harness/scripts/live-sanity/.
# Exit: 0 VERIFIED or PARTIAL, 1 FAIL, 2 bad box.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONN_REPO="${CONN_REPO:-$(bash "$ROOT/scripts/repo_paths.sh" conn)}"

if [[ -n "${SKIP_LIVE_SANITY:-}" ]]; then
    echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
    echo "!! live sanity NOT run (SKIP_LIVE_SANITY=1): this push is NOT verified on the box"
    echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
    exit 0
fi

# shellcheck source=/dev/null
source "$CONN_REPO/scripts/box.sh"
# `lease`: take or renew this box's lease (connector box.sh), refused while
# another agent holds it, so these checks test the code this caller deployed.
resolve_box env,lease || exit 2
export LIVE_SANITY_LEASE="${BOX_LEASE:-}"

# The env file is loaded literally by run.js (sourcing it would expand $ in passwords).
export LIVE_SANITY_ENV_FILE="$BOX_ENV" LIVE_SANITY_BOX="$BOX" CONN_REPO
# Scope from what is being proven: when every stamped repo is a widget repo
# (its HEAD has widget/info.json), run only those widgets' checks plus the
# box-wide ones, as widget-push does. A connector, framework or root stamp
# changes what every check exercises, so it keeps the full set. WIDGETS= wins.
if [[ -z "${WIDGETS:-}" && -n "${LIVE_SANITY_STAMP_REPOS:-}" ]]; then
    _scope=""; _all_widgets=1
    IFS=: read -ra _stamp_dirs <<< "$LIVE_SANITY_STAMP_REPOS"
    for _d in "${_stamp_dirs[@]}"; do
        [[ -n "$_d" ]] || continue
        if [[ -f "$_d/widget/info.json" ]]; then _scope="${_scope:+$_scope,}$(basename "$_d")"; else _all_widgets=0; fi
    done
    if [[ "$_all_widgets" == 1 && -n "$_scope" ]]; then
        WIDGETS="$_scope"
        echo "live-sanity: scope $WIDGETS (every stamped repo is a widget; WIDGETS= overrides)"
    fi
fi
export WIDGETS="${WIDGETS:-}"
# A worktree of this repo has no widget repos: default to the main checkout's (D10).
if [[ -z "${WIDGETS_SRC:-}" ]]; then
    WIDGETS_SRC="$ROOT/widgets-src"
    if ! compgen -G "$WIDGETS_SRC/[!_]*/widget/info.json" >/dev/null; then
        WIDGETS_SRC="$(bx_main_checkout "$ROOT")/widgets-src"
        # That is a shared checkout: its widget repos may be on another session's
        # branch, and widget_versions would then compare the box with that
        # branch (live: expected 1.4.6 while main and the box were at 1.4.7).
        for _w in "$WIDGETS_SRC"/[!_]*/; do
            [[ -e "$_w/.git" ]] || continue
            _rem="$(git -C "$_w" for-each-ref --format='%(upstream:remotename)' refs/heads/main)"
            if [[ "$(git -C "$_w" rev-parse HEAD 2>/dev/null)" != "$(git -C "$_w" rev-parse "refs/remotes/${_rem:-origin}/main" 2>/dev/null)" ]]; then
                echo "live-sanity: refusing: no WIDGETS_SRC given, and the shared checkout's $(basename "$_w") is at $(git -C "$_w" rev-parse --abbrev-ref HEAD), not its remote main; widget_versions would check the box against that branch. Run from an agent tree (make agent-tree NAME=<n>), or pass WIDGETS_SRC=<widgets at the code you deployed>." >&2
                exit 2
            fi
        done
    fi
fi
export WIDGETS_SRC
cd "$ROOT/fortisoar-widget-harness" || exit 2
# Connector hooks reach here without make's harness-build: compile if needed.
[[ -f lib/soarBrowser.js && -f lib/chatSession.js ]] || pnpm -s build >/dev/null || exit 2
exec node scripts/live-sanity/run.js
