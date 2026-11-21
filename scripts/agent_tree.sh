#!/usr/bin/env bash
# ONE command that builds a complete, self-contained agent tree: all 5 repos as
# git worktrees, laid out so every existing resolver finds the right copy without
# falling back to a shared checkout.
#
#   make agent-tree NAME=<name> [REPOS="repo=branch ..."]   (or bash scripts/agent_tree.sh create ...)
#   bash scripts/agent_tree.sh create NAME [repo=branch ...]   # default: every repo at its remote main, detached
#   bash scripts/agent_tree.sh verify NAME                     # rc 0 only if nothing points at a shared checkout
#   bash scripts/agent_tree.sh selfcheck NAME                  # venv imports (repaired if broken), framework-path, doctor LOCAL=1 -> READY / NOT READY
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
    # Fetch every repo at once (each is ~2-4s, network plus git's own work), wait
    # for all of them, and refuse by name before building anything.
    if [[ "${AT_NO_FETCH:-}" != 1 ]]; then
        local flog; flog="$(mktemp -d "${TMPDIR:-/tmp}/agent-tree-fetch.XXXXXX")"
        declare -A fpid=()
        for r in "${REPOS[@]}"; do
            src="$(src_of "$r")"; rem="$(remote_of "$src")"
            git -C "$src" fetch -q "$rem" main >"$flog/$r" 2>&1 &
            fpid[$r]=$!
        done
        local failed=()
        for r in "${REPOS[@]}"; do wait "${fpid[$r]}" || failed+=("$r"); done
        if (( ${#failed[@]} )); then
            for r in "${failed[@]}"; do echo "agent_tree: fetch failed for $r: $(tr '\n' ' ' < "$flog/$r")" >&2; done
            rm -rf "$flog"; die "nothing was built (fetch failed: ${failed[*]})"
        fi
        rm -rf "$flog"
    fi
    mkdir -p "$tree"
    local json="{" sep=""
    # root first: the widget worktrees live inside it.
    for r in "${REPOS[@]}"; do
        src="$(src_of "$r")"; dest="$(dest_of "$tree" "$r")"; ref="${want[$r]:-main}"; rem="$(remote_of "$src")"
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
export FSR_LEASE_HOLDER='tree:$name'
# Plain python in the tree imports the tree's framework, not the shared venv's
# editable checkout (pytest's conftest already did; scripts run directly did not).
export PYTHONPATH='$tree/framework'
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
    local rc=0
    [[ "${AT_NO_SELFCHECK:-}" == 1 ]] || cmd_selfcheck "$name" || rc=1
    echo "  eval \"\$(bash $HERE/scripts/agent_tree.sh env $name)\"; cd $tree/root"
    return $rc
}

cmd_env() {
    local t="$TREES/${1:?NAME required}"; [[ -f "$t/agent-tree.env" ]] || die "no tree $t"
    cat "$t/agent-tree.env"
    # Trees built before the box lease: the holder is still the tree.
    grep -q FSR_LEASE_HOLDER "$t/agent-tree.env" || echo "export FSR_LEASE_HOLDER='tree:$1'"
    grep -q PYTHONPATH "$t/agent-tree.env" || echo "export PYTHONPATH='$t/framework'"
}

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
    # The hooks that run in this tree's repos are the one central copy, at root main's guard.
    # The central hooks are machine state; a fixture world without them sets AT_NO_HOOKS_CHECK=1.
    [[ "${AT_NO_HOOKS_CHECK:-}" == 1 ]] || bash "$HERE/scripts/hooks_central.sh" check >&2 || bad=1
    # Plain python (not pytest, whose conftest fixes sys.path) in the tree must
    # import the tree's framework, not the shared venv's editable checkout.
    local py got; py="$(bash "$tree/connector/scripts/dev_env.sh" python 2>/dev/null || true)"
    if [[ -x "$py" ]]; then
        got="$( (eval "$(cmd_env "$name")"; cd "$tree/connector" && "$py" -c 'import fsr_playbooks,os;print(os.path.dirname(os.path.dirname(os.path.realpath(fsr_playbooks.__file__))))') 2>/dev/null)"
        [[ "$got" == "$(cd "$tree/framework" && pwd -P)" ]] \
            || { echo "FAIL python in the tree imports fsr_playbooks from '$got', not $tree/framework" >&2; bad=1; }
    fi
    [[ $bad == 0 ]] && echo "agent_tree: verify OK ($tree)"
    return $bad
}

# The last step of create (and `agent_tree.sh selfcheck NAME` on an existing tree):
# prove the tree is usable BEFORE a subagent is told to use it, so nobody debugs the
# environment mid-task. Three checks, one verdict line:
#   1. the connector's dev python imports what the suites need (a package that
#      imported as an empty namespace, e.g. pluggy or pyyaml missing __init__.py,
#      is reinstalled at its installed version, no deps; then re-probed)
#   2. `make framework-path` in the tree's connector resolves to the tree's framework
#   3. `make doctor LOCAL=1` in the tree's root passes
# Prints "agent_tree: READY (<tree>)" or "agent_tree: NOT READY: <reasons>" (rc 1).
# Test hooks: AT_SELFCHECK_PY, AT_SELFCHECK_IMPORTS, AT_SELFCHECK_PYPATH,
# AT_SELFCHECK_INSTALL (command taking <python> <dist==version>), AT_SELFCHECK_MAKE.
_probe_py='import importlib.util, sys
bad = []
for n in sys.argv[1:]:
    try:
        sp = importlib.util.find_spec(n)
        if sp is None or sp.origin in (None, "namespace"):
            bad.append(n); continue
        __import__(n)
    except Exception:
        bad.append(n)
print(" ".join(bad))'
_dist_of() { case "$1" in yaml) echo pyyaml ;; xdist) echo pytest-xdist ;; *) echo "$1" ;; esac; }
cmd_selfcheck() {
    local name="${1:?NAME required}" tree="$TREES/$1" py mk imports bad n d v why=() fixed=() fw got log
    [[ -f "$tree/agent-tree.json" ]] || die "no tree $tree"
    mk="${AT_SELFCHECK_MAKE:-make}"; imports="${AT_SELFCHECK_IMPORTS:-pluggy yaml pytest xdist fsr_playbooks}"
    py="${AT_SELFCHECK_PY:-$(bash "$tree/connector/scripts/dev_env.sh" python 2>/dev/null || true)}"
    local pp="$tree/framework${AT_SELFCHECK_PYPATH:+:$AT_SELFCHECK_PYPATH}"
    if [[ ! -x "$py" ]]; then
        why+=("no connector dev python (run make setup in $tree/connector)")
    else
        bad="$(PYTHONPATH="$pp" "$py" -c "$_probe_py" $imports 2>/dev/null)"
        for n in $bad; do
            [[ "$n" == fsr_playbooks ]] && continue
            d="$(_dist_of "$n")"
            v="$(PYTHONPATH="$pp" "$py" -c 'import importlib.metadata as m,sys;print(m.version(sys.argv[1]))' "$d" 2>/dev/null || true)"
            [[ -n "$v" ]] || { why+=("$n is broken and its version is unknown, cannot reinstall"); continue; }
            echo "agent_tree: selfcheck: $n imports empty or fails; reinstalling $d==$v into the dev venv" >&2
            if [[ -n "${AT_SELFCHECK_INSTALL:-}" ]]; then $AT_SELFCHECK_INSTALL "$py" "$d==$v" >/dev/null 2>&1 || true
            elif command -v uv >/dev/null 2>&1; then uv pip install -q --python "$py" --reinstall --no-deps "$d==$v" >/dev/null 2>&1 || true
            else "$py" -m pip install -q --force-reinstall --no-deps "$d==$v" >/dev/null 2>&1 || true; fi
            fixed+=("$n")
        done
        bad="$(PYTHONPATH="$pp" "$py" -c "$_probe_py" $imports 2>/dev/null)"
        [[ -z "$bad" ]] || why+=("venv imports still broken: $bad")
        [[ -n "$bad" || ${#fixed[@]} -eq 0 ]] || echo "agent_tree: selfcheck: repaired ${fixed[*]}" >&2
    fi
    fw="$(cd "$tree/framework" && pwd -P)"
    got="$( (eval "$(cmd_env "$name")"; "$mk" -s -C "$tree/connector" framework-path 2>/dev/null | tail -1) )"
    got="$( (cd "$got" 2>/dev/null && pwd -P) || echo "$got")"
    [[ "$got" == "$fw" ]] || why+=("make framework-path is '${got:-nothing}', not the tree framework $fw")
    log="$(mktemp "${TMPDIR:-/tmp}/agent-tree-doctor.XXXXXX")"
    if ! (eval "$(cmd_env "$name")"; "$mk" --no-print-directory -C "$tree/root" doctor LOCAL=1 CONN_REPO="$tree/connector") >"$log" 2>&1; then
        why+=("make doctor LOCAL=1 failed: $(grep -v '^[[:space:]]*$' "$log" | tail -1 | cut -c1-200)")
    fi
    rm -f "$log"
    if (( ${#why[@]} )); then
        echo "agent_tree: NOT READY: $(IFS=';'; echo "${why[*]}" | sed 's/;/; /g') ($tree)"
        return 1
    fi
    echo "agent_tree: READY ($tree)"
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

# --- whole-tree operations: so nobody loops over make targets by hand -----------
# A repo is CHANGED when it is on a branch whose HEAD is not in its remote main.
# Promote order: framework, connector, widgets, root (what depends on what).
PROMOTE_ORDER=(framework connector "${WIDGETS[@]}" root)
_branch_of() { git -C "$1" symbolic-ref --quiet --short HEAD 2>/dev/null || true; }
_changed() {  # $1 dest dir: 0 when on a branch with commits not in remote main
    local d="$1" rem; [[ -n "$(_branch_of "$d")" ]] || return 1
    rem="$(remote_of "$d")"
    ! git -C "$d" merge-base --is-ancestor HEAD "refs/remotes/$rem/main" 2>/dev/null
}
_stamp_of() {  # $1 dest dir -> "VERIFIED@92" | "none"
    local d="$1" common repo sha f
    common="$(cd "$d" && cd "$(git rev-parse --git-common-dir)" && pwd)"
    repo="$(basename "$([[ "$(basename "$common")" == .git ]] && dirname "$common" || echo "$common")")"
    sha="$(git -C "$d" rev-parse HEAD)"; f="${FSR_LIVE_SANITY_DIR:-$HOME/.cache/fsr-live-sanity}/$repo/$sha.json"
    [[ -f "$f" ]] || { echo none; return; }
    python3 -c 'import json,sys; s=json.load(open(sys.argv[1])); print("%s@%s%s" % (s.get("verdict"), s.get("box"), " dirty" if s.get("dirty") else ""))' "$f" 2>/dev/null || echo "?"
}
cmd_status() {
    local name="${1:?NAME required}" tree="$TREES/$1" r d br ahead dirty rem
    [[ -f "$tree/agent-tree.json" ]] || die "no tree $tree"
    printf '%-24s %-28s %-9s %5s %-5s %s\n' repo branch head ahead dirty stamp
    for r in "${PROMOTE_ORDER[@]}"; do
        d="$(dest_of "$tree" "$r")"; [[ -d "$d" ]] || continue
        br="$(_branch_of "$d")"; rem="$(remote_of "$d")"
        ahead="$(git -C "$d" rev-list --count "refs/remotes/$rem/main..HEAD" 2>/dev/null || echo "?")"
        dirty="$([[ -n "$(git -C "$d" status --porcelain --untracked-files=no)" ]] && echo yes || echo no)"
        printf '%-24s %-28s %-9s %5s %-5s %s\n' "$r" "${br:-(detached)}" "$(git -C "$d" rev-parse --short=9 HEAD)" "$ahead" "$dirty" "$(_stamp_of "$d")"
    done
}
cmd_stamp() {  # one live run that stamps every changed repo in the tree
    local name="${1:?NAME required}" tree="$TREES/$1" r d dirs=()
    [[ -f "$tree/agent-tree.json" ]] || die "no tree $tree"
    [[ -n "${BOX:-}" ]] || die "stamp-tree needs BOX=<alias> (scripts/box.sh --list)"
    for r in "${PROMOTE_ORDER[@]}"; do d="$(dest_of "$tree" "$r")"; [[ -d "$d" ]] && _changed "$d" && dirs+=("$d"); done
    (( ${#dirs[@]} )) || { echo "agent_tree: nothing in $name is ahead of main; nothing to stamp"; return 0; }
    echo "agent_tree: stamping ${#dirs[@]} changed repo(s) on BOX=$BOX: $(for d in "${dirs[@]}"; do basename "$d"; done | paste -sd' ' -)"
    local joined; joined="$(IFS=:; echo "${dirs[*]}")"
    ( eval "$(cmd_env "$name")"
      make --no-print-directory -C "$tree/root" doctor BOX="$BOX" SANITY=1 STAMP="$joined" CONN_REPO="$tree/connector" )
}
cmd_promote() {  # every changed repo, in dependency order; stops at the first refusal
    local name="${1:?NAME required}" tree="$TREES/$1" r d br n=0
    [[ -f "$tree/agent-tree.json" ]] || die "no tree $tree"
    for r in "${PROMOTE_ORDER[@]}"; do
        d="$(dest_of "$tree" "$r")"; [[ -d "$d" ]] && _changed "$d" || continue
        br="$(_branch_of "$d")"
        echo "agent_tree: promote $r ($br)"
        if ! make --no-print-directory -C "$ROOT_SRC" promote REPO="$(src_of "$r")" BRANCH="$br"; then
            die "promote-tree stopped at $r ($br); the repos before it were promoted. Fix it, then re-run make promote-tree NAME=$name"
        fi
        n=$((n+1))
    done
    echo "agent_tree: promoted $n repo(s) from $name"
}

case "${1:-}" in
    create|verify|env|remove|status|stamp|promote|selfcheck) c="$1"; shift; "cmd_$c" "$@" ;;
    *) sed -n '2,16p' "$0" >&2; exit 2 ;;
esac
