#!/usr/bin/env bash
# The promoted source for `make stable`: every repo at its remote's main, in
# detached trees this script creates and always removes.
#
#   source scripts/stable_source.sh
#   stable_source_prepare <monorepo> <framework repo> <connector repo>
#       -> exports SRC_ROOT SRC_FW SRC_CONN (the widgets sit at
#          $SRC_ROOT/widgets-src/<name>, where the build expects them) and
#          registers stable_source_cleanup on EXIT.
#
# Why: `make stable` used to build from the shared checkouts. Several sessions
# work in them, so they are often on someone else's branch ("checked out on
# 'release-form', not main" refused a fully promoted install), and the harness
# packager they had compiled could carry someone's uncommitted edit into the
# widget package. A tree made here holds exactly the promoted commit: nothing
# in a shared checkout (branch, WIP, compiled output) is read, and nothing there
# is changed except a short-lived worktree entry, removed on exit.
#
# Each tree is `git worktree add --detach` at the fetched remote main, not a
# `git archive` export: the framework wheel takes its version from git tags.

_ss_dirs=()      # "repo|tree" pairs to remove

_ss_upstream() {   # the remote that main tracks in repo $1
    git -C "$1" for-each-ref --format='%(upstream:remotename)' refs/heads/main
}

_ss_tree() {       # _ss_tree <repo> <dest>: a detached tree at <remote>/main
    local repo="$1" dest="$2" remote sha
    remote="$(_ss_upstream "$repo")"
    [[ -n "$remote" ]] || { echo "stable source: $repo: main tracks no remote" >&2; return 1; }
    git -C "$repo" fetch -q "$remote" main \
        || { echo "stable source: $repo: cannot fetch $remote main" >&2; return 1; }
    sha="$(git -C "$repo" rev-parse "refs/remotes/$remote/main")" || return 1
    git -C "$repo" worktree add -q --detach "$dest" "$sha" \
        || { echo "stable source: $repo: cannot create a tree at $sha" >&2; return 1; }
    _ss_dirs+=("$repo|$dest")
    echo ">> stable source: $(basename "$repo") at $remote/main ${sha:0:9}"
}

stable_source_cleanup() {
    local pair repo dest i
    # Nested trees (the widgets inside the root tree) go first.
    for (( i=${#_ss_dirs[@]}-1; i>=0; i-- )); do
        pair="${_ss_dirs[$i]}"; repo="${pair%%|*}"; dest="${pair#*|}"
        git -C "$repo" worktree remove --force "$dest" 2>/dev/null || rm -rf "$dest"
        git -C "$repo" worktree prune 2>/dev/null || true
    done
    _ss_dirs=()
    [[ -n "${_SS_BASE:-}" && -d "$_SS_BASE" ]] && rm -rf "$_SS_BASE"
    return 0
}

stable_source_prepare() {
    local mono="$1" fw="$2" conn="$3" w
    _SS_BASE="$(mktemp -d "${TMPDIR:-/tmp}/fsr-stable-src.XXXXXX")"
    trap stable_source_cleanup EXIT
    SRC_ROOT="$_SS_BASE/fsr_all_widgets"; SRC_FW="$_SS_BASE/fsr-playbook-framework"
    SRC_CONN="$_SS_BASE/conn_main"
    _ss_tree "$mono" "$SRC_ROOT" || return 1
    _ss_tree "$fw" "$SRC_FW" || return 1
    _ss_tree "$conn" "$SRC_CONN" || return 1
    mkdir -p "$SRC_ROOT/widgets-src"
    for w in agenticAssistant agenticAssistantMonitor; do
        _ss_tree "$mono/widgets-src/$w" "$SRC_ROOT/widgets-src/$w" || return 1
    done
    # The widget packer is compiled from the harness sources at this commit
    # (packager.js is build output, not tracked). Offline: the lockfile is
    # pinned and the store already holds it.
    echo ">> stable source: compiling the harness at the promoted commit"
    ( cd "$SRC_ROOT/fortisoar-widget-harness" \
        && pnpm install --frozen-lockfile --offline --silent >/dev/null ) \
        || { echo "stable source: harness install/compile failed" >&2; return 1; }
    export SRC_ROOT SRC_FW SRC_CONN
}
