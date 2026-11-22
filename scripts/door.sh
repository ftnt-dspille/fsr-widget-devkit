#!/usr/bin/env bash
# The two front doors of the dev loop. Everything else is internal.
#
#   make check                 tests for what you changed, no box
#   make ship [BOX=<alias>]    push, stamp on a box only if the diff ships, promote
#
# Where it runs: the shared checkout, an agent tree (every changed repo in it, in
# dependency order) or a worktree of one repo (that repo; the connector's own
# `make check` / `make ship` forward here). DOOR_REPO=<path|name> picks one repo, ignoring the tree.
#
# check, per repo (the diff is everything since the merge base with the remote's
# main, plus uncommitted and untracked files):
#   root       the jest files the diff touches or names (tooling suites included)
#   connector  the pytest files the diff touches or imports, minus the shell-heavy
#              ones CI owns, plus the tool sweep
#   framework  the pytest files the diff touches or imports
#   widget     its jest unit tests (and its e2e when markup or CSS changed)
#   then `make local-chat` on a bundle when the diff touches the agent loop
#   (framework fsr_playbooks/llm or mcp_server, or the connector package).
# A repo whose diff maps to no test says so; a skip is not a pass.
#
# ship, per changed repo, framework -> connector -> widgets -> root:
#   refuses a dirty tree, a detached HEAD, main. Classifies the diff with
#   promote's own rule (.github/package-inputs on main). Pushes the branch (CI
#   starts), and only when something ships: BOX is required, a stable box is
#   refused, the code goes to the box and the head is stamped (a head that
#   already has a VERIFIED clean stamp is not re-stamped). Then make promote.
#   DRY_RUN=1 stops promote before the merge: CI and the stamp are still checked.
#
# Test hooks: DOOR_MAKE (the make binary), FSR_LIVE_SANITY_DIR (the stamp dir).
set -uo pipefail

mode="${1:-}"
case "$mode" in check|ship) ;; *) sed -n '2,3p' "$0" >&2; exit 2 ;; esac
HERE="${FSR_TOOL_HOME:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"   # the root checkout whose Makefile ran
MAKE="${DOOR_MAKE:-make}"
LAPSH="$HERE/scripts/lap.sh"
STAMPS="${FSR_LIVE_SANITY_DIR:-$HOME/.cache/fsr-live-sanity}"

die() { echo "door: $*" >&2; exit 2; }
say() { echo "door: $*"; }
lap() { local label="$1" budget="$2"; shift 2; bash "$LAPSH" "$label" --budget "$budget" -- "$@"; }
gc() { git -C "$1" rev-parse --path-format=absolute --git-common-dir 2>/dev/null; }
main_name() { local c; c="$(gc "$1")" || return 1; if [[ "$(basename "$c")" == .git ]]; then basename "$(dirname "$c")"; else basename "$c"; fi; }
kind_of() {  # by what the tree holds, not by its name: the connector's main checkout is called fsr-playbook-builder, its worktrees anything
    local d="$1"
    if [[ -d "$d/connector-fsr-agentic-assistant" ]]; then echo connector
    elif [[ -d "$d/fsr_playbooks" ]]; then echo framework
    elif [[ -f "$d/widget/info.json" ]]; then echo widget
    elif [[ -d "$d/fortisoar-widget-harness" ]]; then echo root
    else echo other; fi
}
remote_of() { local r; r="$(git -C "$1" for-each-ref --format='%(upstream:remotename)' refs/heads/main 2>/dev/null)"; echo "${r:-origin}"; }
branch_of() { git -C "$1" symbolic-ref --quiet --short HEAD 2>/dev/null || true; }
base_of() { git -C "$1" merge-base HEAD "refs/remotes/$(remote_of "$1")/main" 2>/dev/null; }
dirty_of() { [[ -n "$(git -C "$1" status --porcelain --untracked-files=no 2>/dev/null)" ]]; }
ahead_of() { git -C "$1" rev-list --count "refs/remotes/$(remote_of "$1")/main..HEAD" 2>/dev/null || echo 0; }
untracked() { git -C "$1" ls-files --others --exclude-standard 2>/dev/null | grep -v '^fsr_src/' || true; }   # fsr_src/: links an agent tree makes
changed_files() {  # everything the diff holds: committed since the base, uncommitted, untracked
    local d="$1" b; b="$(base_of "$d")" || b=HEAD
    { git -C "$d" diff --name-only --diff-filter=ACMRD "${b:-HEAD}" 2>/dev/null
      untracked "$d"; } | sort -u
}

# --- which repos ----------------------------------------------------------------
tree=""
if [[ -n "${DOOR_REPO:-}" ]]; then :   # an explicit repo wins over a tree
elif [[ -n "${AGENT_TREE:-}" && -f "$AGENT_TREE/agent-tree.json" ]]; then tree="$AGENT_TREE"
elif [[ -f "$(dirname "$HERE")/agent-tree.json" ]]; then tree="$(dirname "$HERE")"; fi
DIRS=()
if [[ -n "$tree" ]]; then
    for d in "$tree/framework" "$tree/connector" "$tree/root/widgets-src/agenticAssistant" "$tree/root/widgets-src/agenticAssistantMonitor" "$tree/root"; do
        [[ -e "$d/.git" ]] || continue
        git -C "$d" fetch -q "$(remote_of "$d")" main 2>/dev/null || true
        if (( $(ahead_of "$d") > 0 )) || dirty_of "$d" || [[ -n "$(untracked "$d")" ]]; then DIRS+=("$d"); fi
    done
    (( ${#DIRS[@]} )) || { say "nothing in the tree is ahead of main or changed"; exit 0; }
else
    r="${DOOR_REPO:-}"
    if [[ -z "$r" ]]; then r="$(git -C "$PWD" rev-parse --show-toplevel 2>/dev/null)" || die "not inside a git repo; pass DOOR_REPO=<path>"
    elif [[ ! -d "$r" ]]; then r="$(bash "$HERE/scripts/repo_paths.sh" resolve "$r")" || die "cannot resolve '$r' to one tree; pass the path"; fi
    git -C "$r" fetch -q "$(remote_of "$r")" main 2>/dev/null || true
    DIRS=("$r")
fi
# The pieces other repos' steps need.
CONN=""; FW=""
if [[ -n "$tree" ]]; then CONN="$tree/connector"; FW="$tree/framework"; fi
for d in "${DIRS[@]}"; do
    case "$(kind_of "$d")" in connector) CONN="$d" ;; framework) FW="$d" ;; esac
done
[[ -n "$CONN" ]] || CONN="$(bash "$HERE/scripts/repo_paths.sh" conn)"
[[ -n "$FW" ]] || FW="$(bash "$HERE/scripts/repo_paths.sh" framework)"

# --- check ------------------------------------------------------------------------
select_by_import() {  # select_by_import <dir> <test-glob-dirs...>: test files the diff touches or imports (stdin: changed files)
    local d="$1"; shift; local f m t tg; declare -A sel=(); local tests=()
    mapfile -t tests < <(cd "$d" && git ls-files "${@/%//test_*.py}")
    while IFS= read -r f; do
        [[ -n "$f" ]] || continue
        case "$f" in
            */test_*.py) [[ -f "$d/$f" ]] && sel[$f]=1 ;;
            *.py) m="$(basename "$f" .py)"; [[ "$m" == __init__ ]] && continue
                  (( ${#tests[@]} )) || continue
                  while IFS= read -r t; do [[ -n "$t" ]] && sel[$t]=1; done < <(cd "$d" && grep -lE \
                      "^[[:space:]]*(from|import)[[:space:]]+([A-Za-z0-9_.]*\.)?$m([^A-Za-z0-9_]|\$)|^[[:space:]]*from[[:space:]]+[A-Za-z0-9_.]+[[:space:]]+import[[:space:]](.*[^A-Za-z0-9_])?$m([^A-Za-z0-9_]|\$)" "${tests[@]}" 2>/dev/null) ;;
        esac
    done
    printf '%s\n' "${!sel[@]}" | sort
}
select_root_tests() {  # stdin: changed files -> jest test basenames the diff touches or names
    local d="$1" f n t; declare -A sel=(); local tests=()
    mapfile -t tests < <(cd "$d" && git ls-files 'fortisoar-widget-harness/tests/*.test.js' 'fortisoar-widget-harness/tests/*.test.ts')
    while IFS= read -r f; do
        [[ -n "$f" ]] || continue
        case "$f" in
            fortisoar-widget-harness/tests/*.test.js|fortisoar-widget-harness/tests/*.test.ts) [[ -f "$d/$f" ]] && sel[$(basename "$f")]=1 ;;
            scripts/*|fortisoar-widget-harness/*|Makefile|.github/*)
                n="$(basename "$f")"; case "$n" in *.ts|*.js) n="${n%.*}" ;; esac
                while IFS= read -r t; do [[ -n "$t" ]] && sel[$(basename "$t")]=1; done < <(cd "$d" && grep -lF -- "$n" "${tests[@]}" 2>/dev/null) ;;
        esac
    done
    printf '%s\n' "${!sel[@]}" | sort
}
bundle_for() {  # the local-chat bundle: a sweep spec the diff touches, else the default
    local f
    while IFS= read -r f; do
        case "$f" in scripts/conversations/sweep/*.json) basename "$f" .json; return ;; esac
    done
    echo "${DOOR_BUNDLE:-ka_c2_beacon}"
}
touches_agent_loop() {  # touches_agent_loop <kind>: stdin changed files
    case "$1" in
        framework) grep -qE '^fsr_playbooks/(llm/|mcp_server)' ;;
        connector) grep -qE '^connector-fsr-agentic-assistant/' ;;
        *) return 1 ;;
    esac
}
FAILED=(); NOT_RUN=()
fail() { FAILED+=("$1"); echo "door: FAILED $1" >&2; }
not_run() { NOT_RUN+=("$1"); echo "door: NOT RUN: $1" >&2; }

check_repo() {
    local d="$1" kind name br files n sel py rc
    kind="$(kind_of "$d")"; name="$(main_name "$d")"; br="$(branch_of "$d")"
    files="$(changed_files "$d")"; n="$(printf '%s' "$files" | grep -c .)"
    say "check $name (${br:-detached}): $n file(s) changed"
    (( n > 0 )) || { not_run "$name: no changes against its main"; return; }
    case "$kind" in
        root)
            sel="$(printf '%s\n' "$files" | select_root_tests "$d" | paste -sd' ' -)"
            if [[ -z "$sel" ]]; then not_run "$name: no jest file maps to this diff (CI runs the full suite)"
            else lap "check tests" 120 $MAKE -C "$d" test-unit FULL=1 TESTS="$sel" || fail "$name jest: $sel"; fi ;;
        connector)
            sel="$(printf '%s\n' "$files" | (cd "$d" && bash scripts/changed_tests.sh --files) | paste -sd' ' -)"
            if [[ -n "$sel" ]]; then
                lap "check tests" 120 $MAKE -C "$d" test PYTEST_ARGS="-m 'not shell' --disable-warnings $sel"; rc=$?
                if (( rc == 5 )); then not_run "$name: every mapped test is shell-heavy and left to CI"
                elif (( rc != 0 )); then fail "$name pytest: $sel"; fi
            else not_run "$name: no pytest file maps to this diff (CI runs the full suite)"; fi
            printf '%s\n' "$files" | grep -q '^connector-fsr-agentic-assistant/' \
                && { lap "check tool-sweep" 30 $MAKE -C "$d" tool-sweep >/dev/null || fail "$name tool-sweep"; } ;;
        framework)
            sel="$(printf '%s\n' "$files" | select_by_import "$d" tooling/tests fsr_playbooks/tests | paste -sd' ' -)"
            if [[ -z "$sel" ]]; then not_run "$name: no pytest file maps to this diff (CI runs the full suite)"
            else
                py="$(bash "$CONN/scripts/dev_env.sh" python)" || die "no dev python; run make setup in $CONN"
                # shellcheck disable=SC2086
                ( cd "$d" && PYTHONPATH="$d" FSRPB_DEV=1 lap "check tests" 120 "$py" -m pytest -q -p no:randomly -m 'not live and not slow' $sel ) || fail "$name pytest: $sel"
            fi ;;
        widget)
            local w ws; w="$(basename "$d")"; ws="$(dirname "$d")"
            [[ "$(basename "$ws")" == widgets-src ]] || die "$w: put a widget worktree at <dir>/widgets-src/$w (or use an agent tree), so the harness finds it"
            [[ -e "$(dirname "$ws")/fortisoar-widget-harness" ]] || ln -s "$HERE/fortisoar-widget-harness" "$(dirname "$ws")/fortisoar-widget-harness"
            lap "check tests" 180 $MAKE -C "$HERE" test-unit WIDGET="$w" WIDGETS_SRC="$ws" || fail "$name unit"
            if printf '%s\n' "$files" | grep -qE '\.(html|css|less|scss)$|\.spec\.js$'; then
                lap "check e2e" 240 $MAKE -C "$HERE" test-e2e-spec WIDGET="$w" WIDGETS_SRC="$ws" || fail "$name e2e"
            fi ;;
        *) not_run "$name: no check is defined for this repo" ;;
    esac
    if printf '%s\n' "$files" | touches_agent_loop "$kind"; then
        local b; b="$(printf '%s\n' "$files" | bundle_for)"
        say "the diff touches the agent loop: local-chat on $b (framework: $FW)"
        lap "check local-chat" 120 env CONN_REPO="$CONN" FSR_SRC="$FW" $MAKE -C "$HERE" local-chat BUNDLE="$b" || fail "$name local-chat $b"
    fi
}

# --- ship -------------------------------------------------------------------------
stamp_ok() {  # stamp_ok <dir>: a VERIFIED, clean stamp for this head
    local f="$STAMPS/$(main_name "$1")/$(git -C "$1" rev-parse HEAD).json"
    [[ -f "$f" ]] && [[ "$(jq -r '.verdict' "$f" 2>/dev/null)" == VERIFIED ]] && [[ "$(jq -r '.dirty' "$f" 2>/dev/null)" == false ]]
}
classify() {  # classify <dir> <branch> -> shipped|tooling (promote's own rule, read from main; no ledger lap)
    local out
    out="$(REPO="$1" BRANCH="$2" CLASSIFY_ONLY=1 RUN_FROM_MAIN_QUIET=1 bash "$HERE/scripts/run_from_main.sh" promote.sh 2>&1)" || { echo "$out" >&2; return 1; }
    printf '%s\n' "$out" | sed -n 's/^promote: classified \([a-z]*\).*/\1/p' | head -1
}

ship_all() {
    local d br kind name cls shipped=() pushes=() pids=() i rc=0 stampdirs=()
    declare -A CLS=()
    for d in "${DIRS[@]}"; do
        name="$(main_name "$d")"; br="$(branch_of "$d")"; kind="$(kind_of "$d")"
        [[ -n "$br" ]] || die "$name is on a detached HEAD: make a branch (git switch -c <branch>) and commit"
        [[ "$br" != main ]] || die "$name is on main: main moves only through ship; make a branch and commit"
        dirty_of "$d" && die "$name has uncommitted changes to tracked files: commit them (ship proves a commit, not a working tree)"
        (( $(ahead_of "$d") > 0 )) || { say "$name: $br has nothing ahead of main"; continue; }
        cls="$(classify "$d" "$br")" || die "$name: could not classify the diff"
        [[ -n "$cls" ]] || die "$name: promote did not say how it classifies the diff"
        CLS[$d]="$cls"; say "$name ($br): $cls"
        pushes+=("$d"); [[ "$cls" == shipped ]] && shipped+=("$d")
    done
    (( ${#pushes[@]} )) || { say "nothing to ship"; exit 0; }
    if (( ${#shipped[@]} )); then
        [[ -n "${BOX:-}" ]] || die "$(for d in "${shipped[@]}"; do main_name "$d"; done | paste -sd, -) ship(s) to a box: pass BOX=<alias> (an experimental box; scripts/box.sh --list)"
        BOX="$BOX" bash "$CONN/scripts/box.sh" --need env,push >/dev/null || die "BOX=$BOX cannot take code (a stable box takes it only through make stable)"
        trap '$MAKE -s -C "$HERE" box-release BOX="$BOX" >/dev/null 2>&1 || true' EXIT   # the pushes took the box lease: free it when ship ends, whatever happened
    fi
    # 1. push the branches (CI starts); the box work below runs meanwhile.
    local plog; plog="$(mktemp -d "${TMPDIR:-/tmp}/door-push.XXXXXX")"
    for d in "${pushes[@]}"; do
        ( lap "ship push" 90 git -C "$d" push -q -u "$(remote_of "$d")" "$(branch_of "$d")" ) > "$plog/$(main_name "$d")" 2>&1 &
        pids+=($!)
    done
    # 2. code to the box and the stamp, only for what ships and is not stamped yet.
    local need=() any_conn=0 any_fw=0 w
    for d in "${shipped[@]}"; do
        stamp_ok "$d" && { say "$(main_name "$d"): head already stamped VERIFIED"; continue; }
        need+=("$d")
    done
    if (( ${#need[@]} )); then
        for d in "${need[@]}"; do
            case "$(kind_of "$d")" in
                connector) any_conn=1 ;;
                framework) any_fw=1 ;;
            esac
        done
        if (( any_conn || any_fw )); then
            if (( ! any_conn )) && [[ -z "$tree" ]]; then   # framework alone: the connector must be a clean main, never someone's WIP
                [[ -z "$(git -C "$CONN" status --porcelain --untracked-files=no)" && "$(git -C "$CONN" rev-parse HEAD)" == "$(git -C "$CONN" rev-parse "refs/remotes/$(remote_of "$CONN")/main")" ]] \
                    || die "framework ships through a connector at its main; $CONN is not (use an agent tree: make agent-tree)"
            fi
            say "code to $BOX: connector + framework (dev-push stamps what it pushed)"
            lap "ship stamp" 420 env FSR_SRC="$FW" $MAKE -C "$CONN" dev-push BOX="$BOX" || { rc=1; say "dev-push failed"; }
        fi
        for d in "${need[@]}"; do
            [[ "$(kind_of "$d")" == widget ]] || continue
            (( rc == 0 )) || break
            w="$(basename "$d")"
            say "code to $BOX: widget $w"
            lap "ship stamp" 420 $MAKE -C "$HERE" widget-push WIDGET="$w" WIDGETS_SRC="$(dirname "$d")" BOX="$BOX" || { rc=1; say "widget-push failed"; }
        done
        # Whatever still has no stamp (root, or a push that stamped less than it pushed): one live run stamps them all.
        for d in "${need[@]}"; do stamp_ok "$d" || stampdirs+=("$d"); done
        if (( rc == 0 && ${#stampdirs[@]} )); then
            say "stamping $(for d in "${stampdirs[@]}"; do main_name "$d"; done | paste -sd' ' -) on $BOX"
            lap "ship stamp" 420 $MAKE -C "$HERE" doctor BOX="$BOX" SANITY=1 STAMP="$(IFS=:; echo "${stampdirs[*]}")" CONN_REPO="$CONN" || rc=1
        fi
    fi
    for i in "${!pids[@]}"; do
        wait "${pids[$i]}" || { echo "door: push of $(main_name "${pushes[$i]}") failed:" >&2; tail -n 20 "$plog/$(main_name "${pushes[$i]}")" >&2; rc=1; }
    done
    rm -rf "$plog"
    (( rc == 0 )) || die "stopped before promote; fix the cause and run make ship again (it re-uses what already passed)"
    # 3. promote, one call per repo, dependency order; stops at the first refusal.
    for d in "${pushes[@]}"; do
        say "promote $(main_name "$d") ($(branch_of "$d"))${DRY_RUN:+ (dry run: CI and proof checked, nothing merged)}"
        env ${DRY_RUN:+PROMOTE_DRY_RUN=1} $MAKE -C "$HERE" promote REPO="$d" BRANCH="$(branch_of "$d")" || die "promote stopped at $(main_name "$d"); the repos before it were promoted. Fix it and run make ship again"
    done
    say "ship done: $(for d in "${pushes[@]}"; do main_name "$d"; done | paste -sd' ' -)"
}

case "$mode" in
    check)
        for d in "${DIRS[@]}"; do check_repo "$d"; done
        if (( ${#FAILED[@]} )); then say "check FAILED: ${FAILED[*]}"; exit 1; fi
        (( ${#NOT_RUN[@]} )) && say "check passed; ${#NOT_RUN[@]} part(s) NOT RUN (listed above)" || say "check passed"
        ;;
    ship) ship_all ;;
esac
