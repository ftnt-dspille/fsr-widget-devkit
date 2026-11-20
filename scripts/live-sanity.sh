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
resolve_box env || exit 2

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
    compgen -G "$WIDGETS_SRC/[!_]*/widget/info.json" >/dev/null || WIDGETS_SRC="$(bx_main_checkout "$ROOT")/widgets-src"
fi
export WIDGETS_SRC
cd "$ROOT/fortisoar-widget-harness" || exit 2
# Connector hooks reach here without make's harness-build: compile if needed.
[[ -f lib/soarBrowser.js && -f lib/chatSession.js ]] || pnpm -s build >/dev/null || exit 2
exec node scripts/live-sanity/run.js
