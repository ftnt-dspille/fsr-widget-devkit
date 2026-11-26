#!/usr/bin/env bash
# The version-only bump ship `make stable BUMP=patch` runs for artifacts the Import Wizard cannot reinstall
# (same version, different content). One agent tree with a branch at main for each listed repo, then ONE
# `make ship BUMP=<level>` from its root: the door bumps each repo (connector: a version-only commit; widget:
# its own widget-push --bump), proves it on an experimental box, promotes it, and frees the lease. Versions stay
# truthful in the repos; nothing is bumped on the stable box.
#
#   stable_bump.sh <level> <repo>...        repo = connector | agenticAssistant | agenticAssistantMonitor
#
# Env: PROVE_BOX=<alias> pins the experimental box (else the door picks one from the ship pool); STABLE_BUMP_MAKE
# (the make binary) and STABLE_BUMP_TREE (the agent_tree.sh to call) are test hooks.
set -euo pipefail
ROOT="${FSR_TOOL_HOME:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
MAKE="${STABLE_BUMP_MAKE:-make}"
TREE_SH="${STABLE_BUMP_TREE:-$ROOT/scripts/agent_tree.sh}"
level="${1:-}"; shift || true
case "$level" in patch|minor|major) ;; *) echo "stable_bump: level must be patch, minor or major (got '${level}')" >&2; exit 2 ;; esac
(( $# )) || { echo "stable_bump: no repo to bump" >&2; exit 2; }
for r in "$@"; do case "$r" in connector|agenticAssistant|agenticAssistantMonitor) ;; *) echo "stable_bump: cannot bump '$r'" >&2; exit 2 ;; esac; done

name="stablebump$$"
stamp="$(date +%Y%m%d%H%M%S)"
args=()
for r in "$@"; do args+=("$r=new:bump/stable-$stamp"); done
echo ">> stable bump: one agent tree ($name) with a branch at main for: $*"
bash "$TREE_SH" create "$name" "${args[@]}" || { echo "stable bump: could not create the agent tree" >&2; exit 1; }
trap 'bash "$TREE_SH" remove "$name" >/dev/null 2>&1 || true' EXIT
tree_root="$(bash "$TREE_SH" env "$name" | sed -n "s/^export FSR_ALL_WIDGETS='\(.*\)'$/\1/p")"
[[ -d "$tree_root" ]] || { echo "stable bump: no tree root for $name" >&2; exit 1; }
echo ">> stable bump: make ship BUMP=$level (the door bumps, proves on an experimental box, promotes)"
# BOX is the stable box here: the ship must not see it, neither in the env nor in MAKEFLAGS (make stable BOX=81 puts it there) (the door picks an experimental box, or PROVE_BOX pins one)
( eval "$(bash "$TREE_SH" env "$name")"
  cd "$tree_root"
  exec env -u BOX -u BOX_ENV -u ARGS -u MAKEFLAGS -u MAKEOVERRIDES -u MFLAGS BUMP="$level" $MAKE ship BUMP="$level" ${PROVE_BOX:+BOX="$PROVE_BOX"} )
