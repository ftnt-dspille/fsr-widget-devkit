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
#   3. guard (scripts/stable_guard.py --promoted-source): the box is stable; each
#      tree's HEAD = the remote's main, and carries a VERIFIED, clean live-sanity
#      stamp taken on an EXPERIMENTAL box
#   4. build + install (scripts/stable_install.py; idempotent per box and heads)
#   5. live sanity on the box, stamping the five heads it just verified
#
# Set CONN_REPO / FSR_FRAMEWORK_REPO through scripts/repo_paths.sh as elsewhere.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONN_REPO="${CONN_REPO:-$(bash "$ROOT/scripts/repo_paths.sh" conn)}"
FSR_FRAMEWORK_REPO="${FSR_FRAMEWORK_REPO:-$(bash "$ROOT/scripts/repo_paths.sh" framework)}"

[[ -n "${BOX:-}" ]] || { echo "make stable: BOX=<alias> is required (there is no default box)" >&2; exit 2; }

# shellcheck source=/dev/null
source "$CONN_REPO/scripts/box.sh"
resolve_box env || exit 2          # prints ">> target box: <alias> [role: ...]"
[[ "$BOX_ROLE" == stable ]] || { echo "make stable: BOX=$BOX is role '$BOX_ROLE'; stable installs only on a stable box" >&2; exit 2; }

PY="$(bash "$CONN_REPO/scripts/dev_env.sh" python)" || exit 2
# shellcheck source=stable_source.sh
source "$ROOT/scripts/stable_source.sh"
stable_source_prepare "$ROOT" "$FSR_FRAMEWORK_REPO" "$CONN_REPO" || exit 1

echo ">> guard: pushed, VERIFIED on an experimental box"
"$PY" "$SRC_CONN/scripts/stable_guard.py" --box "$BOX" --promoted-source \
    --monorepo "$SRC_ROOT" --framework "$SRC_FW" --conn "$SRC_CONN" || exit 1

echo ">> build and import through the Import Wizard"
MONOREPO="$SRC_ROOT" FRAMEWORK="$SRC_FW" CONN_REPO="$SRC_CONN" \
    DIST_STABLE="${DIST_STABLE:-$CONN_REPO/dist/stable}" \
    BOX="$BOX" BOX_ENV="$BOX_ENV" \
    "$PY" "$SRC_CONN/scripts/stable_install.py" ${ARGS:-} || exit $?

case " ${ARGS:-} " in
  *" --build-only "*) echo ">> build-only: the box was not touched"; exit 0 ;;
esac

echo ">> live sanity on BOX=$BOX (stamps the heads this install carries)"
STAMP_REPOS="$SRC_ROOT:$SRC_FW:$SRC_CONN:$SRC_ROOT/widgets-src/agenticAssistant:$SRC_ROOT/widgets-src/agenticAssistantMonitor"
BOX="$BOX" CONN_REPO="$SRC_CONN" LIVE_SANITY_STAMP_REPOS="$STAMP_REPOS" bash "$SRC_ROOT/scripts/live-sanity.sh"
