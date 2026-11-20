#!/usr/bin/env bash
# ONE command that builds a complete, self-contained agent tree: all 5 repos as
# git worktrees, laid out so every existing resolver finds the right copy without
# falling back to a shared checkout.
#
#   make agent-tree NAME=<name> [REPOS="repo=branch ..."]   (or bash scripts/agent_tree.sh create ...)
#   bash scripts/agent_tree.sh create NAME [repo=branch ...]   # default: every repo at its remote main, detached
#   bash scripts/agent_tree.sh verify NAME                     # rc 0 only if nothing points at a shared checkout
#   bash scripts/agent_tree.sh env    NAME                     # print the exports (eval "$(... env NAME)")
#   bash scripts/agent_tree.sh remove NAME                     # remove the worktrees; branches survive
#
# repo names: root framework connector agenticAssistant agenticAssistantMonitor
# A repo=branch arg checks that branch out (it must not be checked out anywhere
# else: shared checkouts are never switched). repo=new:<branch> creates it from
# that repo's remote main.
#
# Layout (each line is one git worktree unless noted):
#   $AGENT_TREES/NAME/root                                  root repo (harness inside)
#   $AGENT_TREES/NAME/root/widgets-src/<widget>             widget repos: REAL dirs, not
#                                                           symlinks (the harness resolves
#                                                           realpath, see CLAUDE.md)
#   $AGENT_TREES/NAME/framework                             framework
#   $AGENT_TREES/NAME/connector                             connector; framework_dir.sh rule 4
#                                                           (<root>/../framework) finds the one
#                                                           above, and .fsr_src pins it too
#   $AGENT_TREES/NAME/agent-tree.env                        exports (not a worktree)
#   $AGENT_TREES/NAME/agent-tree.json                       repo -> path, ref, sha at create
#
# Sources (where the worktrees are cut from) default to the shared checkouts and
# can be overridden: AT_ROOT_REPO AT_FRAMEWORK_REPO AT_CONN_REPO AT_WIDGETS_DIR.
# Only their .git is used; their working trees and checked-out branches are never touched.
# "main" is each repo's UPSTREAM main (the framework's remote is not origin).
# AT_NO_BUILD=1 skips pnpm install + harness-build (tests); AT_NO_FETCH=1 skips git fetch.
set -euo pipefail
(( BASH_VERSINFO[0] >= 4 )) || { echo "agent_tree: needs bash >= 4 (macOS /bin/bash is 3.2; run 'bash scripts/agent_tree.sh' with Homebrew bash on PATH)" >&2; exit 2; }

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
_main_of() { local c; c="$(git -C "$1" rev-parse --path-format=absolute --git-common-dir)"; dirname "$c"; }

ROOT_SRC="${AT_ROOT_REPO:-$(_main_of "$HERE")}"
FW_SRC="${AT_FRAMEWORK_REPO:-$(bash "$ROOT_SRC/scripts/repo_paths.sh" framework 2>/dev/null || true)}"
CONN_SRC="${AT_CONN_REPO:-$(bash "$ROOT_SRC/scripts/repo_paths.sh" conn 2>/dev/null || true)}"
WIDGETS_SRC_DIR="${AT_WIDGETS_DIR:-$ROOT_SRC/widgets-src}"
TREES="${AGENT_TREES:-${TMPDIR:-/tmp}/agent-trees}"
WIDGETS=(agenticAssistant agenticAssistantMonitor)
REPOS=(root framework connector "${WIDGETS[@]}")

die() { echo "agent_tree: $*" >&2; exit 1; }

src_of() {
    case "$1" in
        root) echo "$ROOT_SRC" ;; framework) echo "$FW_SRC" ;; connector) echo "$CONN_SRC" ;;
        *) echo "$WIDGETS_SRC_DIR/$1" ;;
    esac
}
dest_of() {  # $1 tree dir, $2 repo
    case "$2" in
        root|framework|connector) echo "$1/$2" ;;
        *) echo "$1/root/widgets-src/$2" ;;
    esac
}
remote_of() {  # the remote main tracks in repo $1 (origin when unset)
    local r; r="$(git -C "$1" for-each-ref --format='%(upstream:remotename)' refs/heads/main)"
    echo "${r:-origin}"
}

cmd_create() {
    local name="${1:?NAME required}"; shift
    [[ "$name" =~ ^[A-Za-z0-9._-]+$ ]] || die "NAME must be [A-Za-z0-9._-]"
    local tree="$TREES/$name"
    [[ -e "$tree" ]] && die "$tree exists (use verify, or remove first)"
    declare -A want=()
    local a r b src dest ref sha rem
    for a in "$@"; do
        r="${a%%=*}"; b="${a#*=}"
        [[ " ${REPOS[*]} " == *" $r "* ]] || die "unknown repo '$r' (one of: ${REPOS[*]})"
        want[$r]="$b"
    done
    for r in "${REPOS[@]}"; do
        [[ -d "$(src_of "$r")/.git" || -f "$(src_of "$r")/.git" ]] || die "$r: no git repo at $(src_of "$r")"
    done

    # Check every ref BEFORE creating anything, so a refusal leaves no half-built tree.
    for r in "${!want[@]}"; do
        src="$(src_of "$r")"; b="${want[$r]}"
        case "$b" in
            main) ;;
            new:*) git -C "$src" show-ref -q --verify "refs/heads/${b#new:}" && die "$r: branch '${b#new:}' already exists (drop new:)" ;;
            *) git -C "$src" rev-parse -q --verify "$b^{commit}" >/dev/null || die "$r: no branch '$b'"
               git -C "$src" worktree list --porcelain | grep -qx "branch refs/heads/$b" \
                   && die "$r: '$b' is checked out elsewhere (shared checkouts are never switched; use $r=new:<branch>)" ;;
        esac
    done
    mkdir -p "$tree"
    local json="{" sep=""
    # root first: the widget worktrees live inside it.
    for r in "${REPOS[@]}"; do
        src="$(src_of "$r")"; dest="$(dest_of "$tree" "$r")"; ref="${want[$r]:-main}"; rem="$(remote_of "$src")"
        [[ "${AT_NO_FETCH:-}" == 1 ]] || git -C "$src" fetch -q "$rem" main || die "$r: fetch $rem main failed"
        git -C "$src" worktree prune
        mkdir -p "$(dirname "$dest")"
        case "$ref" in
            main)  git -C "$src" worktree add -q --detach "$dest" "$rem/main" ;;
            new:*) git -C "$src" worktree add -q -b "${ref#new:}" "$dest" "$rem/main" ;;
            *)     git -C "$src" worktree add -q "$dest" "$ref" \
                       || die "$r: cannot check out '$ref' (checked out elsewhere? use $r=new:<branch>)" ;;
        esac
        sha="$(git -C "$dest" rev-parse HEAD)"
        json+="$sep\"$r\":{\"path\":\"$dest\",\"ref\":\"$ref\",\"sha\":\"$sha\"}"; sep=","
    done
    printf '%s}\n' "$json" > "$tree/agent-tree.json"

    # Pin the framework for the connector explicitly (per-checkout, gitignored).
    echo "$tree/framework" > "$tree/connector/.fsr_src"
    # Harness discovery root -> this tree's widgets (relative, so it never dangles to a shared path).
    [[ -d "$tree/root/fortisoar-widget-harness" ]] && ln -sfn ../widgets-src "$tree/root/fortisoar-widget-harness/widgets-src"
    # Per-machine, non-code state: copy, never symlink (a symlink lets this tree write into the shared one).
    local f
    for f in fortisoar-widget-harness/.env fortisoar-widget-harness/.harness-active-env; do
        [[ -f "$ROOT_SRC/$f" ]] && cp "$ROOT_SRC/$f" "$tree/root/$f"
    done
    # Big read-only data stays shared: localData.js already falls back to the main
    # checkout for captures and introspection reports. fsr_src/ is partly tracked;
    # its ignored entries (app.unmin.js and other platform extracts the lint
    # indexer reads) are linked one by one, so tracked files stay the tree's own.
    local e
    while IFS= read -r e; do
        e="${e%/}"; [[ -n "$e" && ! -e "$tree/root/$e" ]] && ln -s "$ROOT_SRC/$e" "$tree/root/$e"
    done < <(git -C "$ROOT_SRC" ls-files --others --ignored --exclude-standard --directory -- fsr_src 2>/dev/null)

    cat > "$tree/agent-tree.env" <<EOF
export AGENT_TREE='$tree'
export WIDGETS_SRC='$tree/root/widgets-src'
export FSR_SRC='$tree/framework'
export CONN_REPO='$tree/connector'
export FSR_FRAMEWORK_REPO='$tree/framework'
export FSR_ALL_WIDGETS='$tree/root'
export FSR_WIDGET_HARNESS='$tree/root/fortisoar-widget-harness'
EOF

    if [[ "${AT_NO_BUILD:-}" != 1 ]]; then
        # node_modules per tree: reuse the shared one only when the lockfile is identical.
        local h="$tree/root/fortisoar-widget-harness" sh="$ROOT_SRC/fortisoar-widget-harness"
        if [[ -d "$sh/node_modules" ]] && cmp -s "$sh/pnpm-lock.yaml" "$h/pnpm-lock.yaml"; then
            ln -sfn "$sh/node_modules" "$h/node_modules"
        else
            (cd "$h" && pnpm install --frozen-lockfile --silent)
        fi
        (cd "$h" && pnpm build)
    fi
    cmd_verify "$name"
    echo "agent_tree: ready: $tree"
    echo "  eval \"\$(bash $HERE/scripts/agent_tree.sh env $name)\"; cd $tree/root"
}

cmd_env() { local t="$TREES/${1:?NAME required}"; [[ -f "$t/agent-tree.env" ]] || die "no tree $t"; cat "$t/agent-tree.env"; }

# The check that would have caught this session's bug class: every path an agent's
# tools will resolve is inside the tree, and every repo is where agent-tree.json says.
cmd_verify() {
    local name="${1:?NAME required}" tree="$TREES/$1" bad=0 r dest top
    [[ -f "$tree/agent-tree.json" ]] || die "no tree $tree"
    for r in "${REPOS[@]}"; do
        dest="$(dest_of "$tree" "$r")"
        top="$(git -C "$dest" rev-parse --show-toplevel 2>/dev/null || true)"
        if [[ "$(cd "$dest" 2>/dev/null && pwd -P)" != "$(cd "${top:-/nonexistent}" 2>/dev/null && pwd -P)" ]]; then
            echo "FAIL $r: $dest is not its own worktree (top=$top)" >&2; bad=1
        fi
        if [[ -n "$(git -C "$dest" status --porcelain --untracked-files=no 2>/dev/null)" ]]; then
            echo "note $r: tracked changes present" >&2
        fi
    done
    local link="$tree/root/fortisoar-widget-harness/widgets-src"
    if [[ -L "$link" ]]; then
        [[ "$(cd "$link" && pwd -P)" == "$(cd "$tree/root/widgets-src" && pwd -P)" ]] \
            || { echo "FAIL harness widgets-src -> $(readlink "$link") (outside the tree)" >&2; bad=1; }
    fi
    [[ "$(head -1 "$tree/connector/.fsr_src")" == "$tree/framework" ]] || { echo "FAIL connector/.fsr_src" >&2; bad=1; }
    if [[ -x "$tree/connector/scripts/framework_dir.sh" ]]; then
        local fw; fw="$(env -u FSR_SRC -u FSRPB_FRAMEWORK_DIR bash "$tree/connector/scripts/framework_dir.sh" "$tree/connector" 2>/dev/null || true)"
        [[ "$fw" == "$(cd "$tree/framework" && pwd)" ]] || { echo "FAIL framework_dir.sh resolves to '$fw'" >&2; bad=1; }
    fi
    [[ $bad == 0 ]] && echo "agent_tree: verify OK ($tree)"
    return $bad
}

cmd_remove() {
    local tree="$TREES/${1:?NAME required}" r src dest
    [[ -f "$tree/agent-tree.json" ]] || die "no tree $tree"
    # Files this script created (gitignored in the real repos) go first, so
    # `worktree remove` without --force only refuses on the agent's own work.
    rm -f "$tree/connector/.fsr_src" "$tree/root/fortisoar-widget-harness/widgets-src" \
          "$tree/root/fortisoar-widget-harness/node_modules" \
          "$tree/root/fortisoar-widget-harness/.env" "$tree/root/fortisoar-widget-harness/.harness-active-env"
    find "$tree/root/fsr_src" -maxdepth 1 -type l -lname "$ROOT_SRC/*" -delete 2>/dev/null || true
    # Widgets first: they sit inside root's worktree.
    for r in "${WIDGETS[@]}" connector framework root; do
        src="$(src_of "$r")"; dest="$(dest_of "$tree" "$r")"
        [[ -e "$dest" ]] && git -C "$src" worktree remove ${AT_FORCE:+--force} "$dest"
        git -C "$src" worktree prune
    done
    rm -rf "$tree"
    echo "agent_tree: removed $tree (branches kept)"
}

case "${1:-}" in
    create|verify|env|remove) c="$1"; shift; "cmd_$c" "$@" ;;
    *) sed -n '2,15p' "$0" >&2; exit 2 ;;
esac
