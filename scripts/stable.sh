#!/usr/bin/env bash
# make stable BOX=<alias> [ARGS=--build-only|--force]
#
# The ONLY path that puts code on a stable box (customer demo). It uses the FortiSOAR
# Import Wizard's import API (pyfsr import_config), over REST: no ssh, no rsync, no
# PyPI for the framework. One solution-pack zip carries the connector (with the
# framework wheel built from promoted main bundled in), and both widget packages.
#
#   1. resolve BOX through the registry (scripts/box.sh: no default box)
#   2. source (scripts/stable_source.sh): detached trees of all five repos at each
#      remote's main, removed on exit. The shared checkouts are never built from:
#      other sessions keep them on their own branches, with their own WIP.
#   2b. release-check record (scripts/release_check.sh verify): `make release-check` passed on exactly these mains
#   3. guard (scripts/stable_guard.py --promoted-source): the box is stable; each
#      tree's HEAD = the remote's main, and carries a VERIFIED, clean live-sanity
#      stamp taken on an EXPERIMENTAL box
#   3b. BEFORE any build or upload, ONE pass finds everything that blocks: release-check (keyed on what the mains
#      SHIP, so a tooling or fixture move keeps it), every artifact against the box (same version with different
#      content), and the guard. With BUMP=patch it bumps the conflicting repos through make ship (stable_bump.sh)
#      and re-proves stale experimental-box stamps itself (stable_prove.sh). Otherwise, or when something is
#      left, it prints the COMPLETE list with the one command for each.
#   4. build + install (scripts/stable_install.py; idempotent per box and heads)
#   5. live sanity on the box, stamping the five heads it just verified
#
# Set CONN_REPO / FSR_FRAMEWORK_REPO through scripts/repo_paths.sh as elsewhere.
set -euo pipefail

# FSR_TOOL_HOME: the invoking checkout, set by run_from_main.sh (this script then runs from main's copy in a temp file)
ROOT="${FSR_TOOL_HOME:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
CONN_REPO="${CONN_REPO:-$(bash "$ROOT/scripts/repo_paths.sh" conn)}"
FSR_FRAMEWORK_REPO="${FSR_FRAMEWORK_REPO:-$(bash "$ROOT/scripts/repo_paths.sh" framework)}"

[[ -n "${BOX:-}" ]] || { echo "make stable: BOX=<alias> is required (there is no default box)" >&2; exit 2; }

# shellcheck source=/dev/null
source "$CONN_REPO/scripts/box.sh"
resolve_box env || exit 2          # prints ">> target box: <alias> [role: ...]"
[[ "$BOX_ROLE" == stable ]] || { echo "make stable: BOX=$BOX is role '$BOX_ROLE'; stable installs only on a stable box" >&2; exit 2; }

PY="$(bash "$CONN_REPO/scripts/dev_env.sh" python)" || exit 2
# shellcheck source=stable_source.sh
unset WIDGETS_SRC   # make exports the shared checkout's; the build uses the promoted trees only
source "$ROOT/scripts/stable_source.sh"
stable_source_prepare "$ROOT" "$FSR_FRAMEWORK_REPO" "$CONN_REPO" || exit 1

BUILD_ONLY=0; case " ${ARGS:-} " in *" --build-only "*) BUILD_ONLY=1 ;; esac
RC_SH="$ROOT/scripts/release_check.sh"
INSTALL_ENV() { MONOREPO="$SRC_ROOT" WIDGETS_SRC="$SRC_ROOT/widgets-src" FRAMEWORK="$SRC_FW" CONN_REPO="$SRC_CONN" \
    DIST_STABLE="${DIST_STABLE:-$CONN_REPO/dist/stable}" BOX="$BOX" BOX_ENV="$BOX_ENV" "$@"; }
five() { printf '%s\n' "$SRC_ROOT" "$SRC_FW" "$SRC_CONN" "$SRC_ROOT/widgets-src/agenticAssistant" "$SRC_ROOT/widgets-src/agenticAssistantMonitor"; }
repo_of() {  # the repo a conflicting artifact is bumped in
    case "$1" in connector-*) echo connector ;; *) echo "$1" ;; esac
}

# Everything that can block the install, found in ONE pass so a run reports them all (it used to stop at the first):
#   release-check   the batch gate for exactly what these mains ship (make release-check; a tooling-only move keeps it)
#   preflight       every artifact against the box: same version with different content, or older than the box's
#   guard           clean, on remote main, VERIFIED on an experimental box (a stamp from the stable box does not count)
T="$(mktemp -d "${TMPDIR:-/tmp}/stable-gather.XXXXXX")"
RC_OK=1; CONFLICTS='[]'; GUARD='{"ok":true,"problems":[],"unproven":[]}'; GUARD_RC=0
gather() {
    local rc
    RC_OK=1; CONFLICTS='[]'
    if (( ! BUILD_ONLY )); then
        mapfile -t FIVE < <(five)
        bash "$RC_SH" verify "${FIVE[@]}" >"$T/rc.out" 2>&1 || RC_OK=0
        rc=0; INSTALL_ENV "$PY" "$SRC_CONN/scripts/stable_install.py" --preflight >"$T/pre.out" 2>"$T/pre.err" || rc=$?
        if (( rc != 0 && rc != 3 )); then cat "$T/pre.err" >&2; tail -5 "$T/pre.out" >&2; echo "make stable: the preflight against BOX=$BOX failed (rc $rc)" >&2; exit 1; fi
        CONFLICTS="$(tail -1 "$T/pre.out" | jq -c '.conflicts' 2>/dev/null)" || { cat "$T/pre.err" >&2; echo "make stable: the preflight gave no answer" >&2; exit 1; }
    fi
    GUARD_RC=0
    GUARD="$("$PY" "$SRC_CONN/scripts/stable_guard.py" --box "$BOX" --promoted-source --json \
        --monorepo "$SRC_ROOT" --framework "$SRC_FW" --conn "$SRC_CONN" 2>"$T/guard.err")" || GUARD_RC=$?
    [[ -n "$GUARD" ]] || { cat "$T/guard.err" >&2; exit 1; }
}
blocked() {  # anything left that stops the install
    (( ! RC_OK )) || [[ "$CONFLICTS" != '[]' ]] || (( GUARD_RC != 0 ))
}
report() {  # the COMPLETE list of what blocks, each with its one command
    local n=0 c
    echo "make stable: REFUSED. Everything that blocks BOX=$BOX, with the one command for each:" >&2
    if (( ! RC_OK )); then
        n=$((n+1)); echo "  $n. release-check has not passed on what these mains ship. Run: make release-check   (then make stable again)" >&2
    fi
    if [[ "$CONFLICTS" != '[]' ]]; then
        while IFS= read -r c; do
            n=$((n+1)); echo "  $n. $c" >&2
        done < <(printf '%s' "$CONFLICTS" | jq -r '.[] | .message')
        echo "     Fix for all of them: make stable BOX=$BOX BUMP=patch   (bumps each in its own repo through make ship, then continues)" >&2
    fi
    while IFS= read -r c; do
        n=$((n+1)); echo "  $n. $c" >&2
    done < <(printf '%s' "$GUARD" | jq -r '.problems[]')
    return 0
}

stable_pass() {
    local level="${BUMP:-}" repos=() old5=() new5=() unproven rc
    [[ "$level" != none ]] || level=""
    gather
    blocked || return 0
    # --- the safe parts, done here ---
    if [[ "$CONFLICTS" != '[]' && -n "$level" ]]; then
        mapfile -t repos < <(printf '%s' "$CONFLICTS" | jq -r '.[] | select(.reason=="same-version") | .name' | while IFS= read -r n; do repo_of "$n"; done | sort -u)
        if (( ${#repos[@]} )); then
            echo ">> BUMP=$level: version-only bump ship for: ${repos[*]} (through make ship; versions stay truthful in the repos)"
            mapfile -t old5 < <(five)
            bash "$ROOT/scripts/stable_bump.sh" "$level" "${repos[@]}" || { echo "make stable: the bump ship failed; nothing was installed" >&2; exit 1; }
            # the mains moved: build from the new ones (the old trees stay until exit, for the release-check carry)
            stable_source_prepare "$ROOT" "$FSR_FRAMEWORK_REPO" "$CONN_REPO" || exit 1
            mapfile -t new5 < <(five)
            if (( RC_OK )); then bash "$RC_SH" carry "${old5[@]}" "${new5[@]}" || true; fi
            gather
        fi
    fi
    unproven="$(printf '%s' "$GUARD" | jq -r '.unproven[]' 2>/dev/null | paste -sd' ' -)"
    if [[ -n "$unproven" ]] && (( GUARD_RC != 0 )); then
        echo ">> stale or missing experimental-box stamps for: $unproven. Re-proving them on an experimental box (the door path's own steps)"
        rc=0
        # shellcheck disable=SC2086
        bash "$ROOT/scripts/stable_prove.sh" "$SRC_ROOT" "$SRC_FW" "$SRC_CONN" $unproven || rc=$?
        (( rc == 0 )) || echo "make stable: the re-proof did not complete (rc $rc)" >&2
        gather
    fi
    return 0
}

if (( BUILD_ONLY )); then
    echo ">> guard: pushed, VERIFIED on an experimental box"
    "$PY" "$SRC_CONN/scripts/stable_guard.py" --box "$BOX" --promoted-source \
        --monorepo "$SRC_ROOT" --framework "$SRC_FW" --conn "$SRC_CONN" || exit 1
else
    echo ">> preflight: release-check, every artifact against BOX=$BOX, and the guard, all at once"
    stable_pass
    if blocked; then report; exit 1; fi
    echo ">> release-check passed on what these mains ship; every artifact can be installed as it is; guard: pushed, VERIFIED on an experimental box"
fi
rm -rf "$T"

echo ">> build and import through the Import Wizard"
# The install record outlives the run: it goes in the connector checkout, not the
# temporary tree. (Set before the call: prefix assignments apply left to right, so
# CONN_REPO="$SRC_CONN" below would point it at the tree that is removed on exit.)
RECORD_DIR="${DIST_STABLE:-$CONN_REPO/dist/stable}"
MONOREPO="$SRC_ROOT" WIDGETS_SRC="$SRC_ROOT/widgets-src" FRAMEWORK="$SRC_FW" CONN_REPO="$SRC_CONN" \
    DIST_STABLE="$RECORD_DIR" \
    BOX="$BOX" BOX_ENV="$BOX_ENV" \
    "$PY" "$SRC_CONN/scripts/stable_install.py" ${ARGS:-} || exit $?

case " ${ARGS:-} " in
  *" --build-only "*) echo ">> build-only: the box was not touched"; exit 0 ;;
esac

echo ">> live sanity on BOX=$BOX (stamps the heads this install carries)"
STAMP_REPOS="$SRC_ROOT:$SRC_FW:$SRC_CONN:$SRC_ROOT/widgets-src/agenticAssistant:$SRC_ROOT/widgets-src/agenticAssistantMonitor"
# FSR_TOOL_HOME is the invoking checkout, which may be a worktree with no compiled harness
# (live-sanity runs its harness from there: "tsc: command not found"). The promoted tree's
# harness was installed and compiled by stable_source_prepare, so point the sanity at it.
FSR_TOOL_HOME="$SRC_ROOT" BOX="$BOX" CONN_REPO="$SRC_CONN" WIDGETS_SRC="$SRC_ROOT/widgets-src" LIVE_SANITY_STAMP_REPOS="$STAMP_REPOS" bash "$SRC_ROOT/scripts/live-sanity.sh"
