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
# Widget sources come from what is being proven, never from the caller's cwd.
# widget_versions compares the box with <WIDGETS_SRC>/<w>/widget/info.json, so a
# source on another session's branch makes a false FAIL (live: expected 1.4.6
# while main and the box were at 1.4.7). Resolution, first match wins:
#   1. a stamped widget repo: its parent dir (an agent tree's root/widgets-src)
#   2. a stamped root repo that carries widget repos: its widgets-src
#   3. a stamp with neither (connector, framework): the widgets at their remote main
#   4. no stamp: an explicit WIDGETS_SRC, else this checkout's widgets-src when it
#      has widget repos (the caller's own work), else the main checkout's at main
_has_widgets() { compgen -G "$1/[!_]*/widget/info.json" >/dev/null; }
_at_main_tmp=""; _picked=""
_widgets_at_main() {  # $1 shared widgets-src; sets _picked to a dir of its widget repos at their remote main
    local src="$1" w rem
    _at_main_tmp="$(mktemp -d "${TMPDIR:-/tmp}/live-sanity-widgets.XXXXXX")"; mkdir -p "$_at_main_tmp/widgets-src"
    for w in "$src"/[!_]*/; do
        w="${w%/}"; [[ -e "$w/.git" ]] || continue
        rem="$(git -C "$w" for-each-ref --format='%(upstream:remotename)' refs/heads/main)"; rem="${rem:-origin}"
        git -C "$w" fetch -q "$rem" main 2>/dev/null || true
        git -C "$w" worktree add -q --detach "$_at_main_tmp/widgets-src/$(basename "$w")" "refs/remotes/$rem/main" >/dev/null 2>&1 \
            || echo "live-sanity: note: $(basename "$w") has no $rem/main to check out; it is left out of the widget sources" >&2
    done
    _picked="$_at_main_tmp/widgets-src"
}
_cleanup_widgets_at_main() {
    [[ -n "$_at_main_tmp" ]] || return 0
    local w
    for w in "$_at_main_tmp"/widgets-src/*/; do
        [[ -e "${w%/}/.git" ]] || continue
        git -C "${w%/}" worktree remove --force "${w%/}" >/dev/null 2>&1 || true
    done
    rm -rf "$_at_main_tmp"
}
trap _cleanup_widgets_at_main EXIT
_why=""
if [[ -n "${LIVE_SANITY_STAMP_REPOS:-}" ]]; then
    IFS=: read -ra _stamp_dirs <<< "$LIVE_SANITY_STAMP_REPOS"
    for _d in "${_stamp_dirs[@]}"; do
        [[ -n "$_d" && -f "$_d/widget/info.json" ]] || continue
        _picked="$(cd "$_d/.." && pwd)"; _why="the stamped widget repo $(basename "$_d")"; break
    done
    if [[ -z "$_picked" ]]; then
        for _d in "${_stamp_dirs[@]}"; do
            [[ -n "$_d" && -d "$_d/fortisoar-widget-harness" ]] && _has_widgets "$_d/widgets-src" || continue
            _picked="$(cd "$_d/widgets-src" && pwd)"; _why="the stamped root repo's widgets-src"; break
        done
    fi
    if [[ -z "$_picked" ]]; then
        _cand="$ROOT/widgets-src"; _has_widgets "$_cand" || _cand="$(bx_main_checkout "$ROOT")/widgets-src"
        _widgets_at_main "$_cand" || exit 2; _why="the widgets at their remote main (the stamp has no widget or root repo)"
    fi
elif [[ -z "${WIDGETS_SRC:-}" ]]; then
    _picked="$ROOT/widgets-src"
    if ! _has_widgets "$_picked"; then
        _picked="$(bx_main_checkout "$ROOT")/widgets-src"
        # A shared checkout: its widget repos may be on another session's branch.
        _cand="$_picked"
        for _w in "$_cand"/[!_]*/; do
            [[ -e "$_w/.git" ]] || continue
            _rem="$(git -C "$_w" for-each-ref --format='%(upstream:remotename)' refs/heads/main)"
            if [[ "$(git -C "$_w" rev-parse HEAD 2>/dev/null)" != "$(git -C "$_w" rev-parse "refs/remotes/${_rem:-origin}/main" 2>/dev/null)" ]]; then
                _widgets_at_main "$_cand" || exit 2; _why="the widgets at their remote main (the shared checkout is on another branch)"
                break
            fi
        done
    fi
fi
if [[ -n "$_picked" ]]; then
    [[ "$_picked" == "${WIDGETS_SRC:-}" ]] || echo "live-sanity: widget sources from ${_why:-this checkout}: $_picked"
    WIDGETS_SRC="$_picked"
fi
export WIDGETS_SRC
cd "$ROOT/fortisoar-widget-harness" || exit 2
# Connector hooks reach here without make's harness-build: compile if needed.
[[ -f lib/soarBrowser.js && -f lib/chatSession.js ]] || pnpm -s build >/dev/null || exit 2
node scripts/live-sanity/run.js
