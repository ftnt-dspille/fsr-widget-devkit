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
#   BUMP=patch|minor|major on a connector branch with NOTHING ahead of main makes one version-only commit
#   (info.json version + release_notes entry, same rewrite as deploy.sh) and ships that, so a stable box can
#   take code that kept its version. Without BUMP such a branch still ships nothing.
#
# CI is never out of sight (`door.sh ci`, also run by make doctor): both doors print each repo's latest main CI line at the start.
# ship also refuses to start on a repo whose main is red (one of its required checks failed on main's head) unless
# the branch is green on those same checks (it may be the fix: the branch is pushed and its CI waited for). And a
# framework ship runs the connector suite against the NEW framework head before promote, as the connector's required
# CI leg (which clones framework main) will after it; a red connector refuses the framework promote.
# That connector suite (full, ~5-8 min on the Mac host, ~2 min in Linux) runs in the container through scripts/devloop_docker_py.sh when an
# engine answers (no engine: the host; DOOR_DOCKER=0 forces the host). Measured and left on the host: the framework suites, widget jest, widget e2e.
#
# Test hooks: DOOR_MAKE, DOOR_RED_WAIT / DOOR_RED_POLL (seconds to wait for the branch's CI when main is red),
# DOOR_BUNDLED_ARGS (pytest args of the cross-repo run) (the make binary), FSR_LIVE_SANITY_DIR (the stamp dir).
set -uo pipefail

mode="${1:-}"
case "$mode" in check|ship|ci) ;; *) sed -n '2,3p' "$0" >&2; exit 2 ;; esac
HERE="${FSR_TOOL_HOME:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"   # the root checkout whose Makefile ran
MAKE="${DOOR_MAKE:-make}"
LAPSH="$HERE/scripts/lap.sh"
STAMPS="${FSR_LIVE_SANITY_DIR:-$HOME/.cache/fsr-live-sanity}"

# --- CI of main (make doctor and both doors) ----------------------------------------
# What GitHub CI says about a repo's main, so nobody works blind to a red main.
#   door.sh ci status <repo dir> [label]   one line: green | RED (<failing job names>) | pending | unknown; rc 0 green, 1 red, 3 else
#   door.sh ci red-names <repo dir>        the failing counted job names, one per line
#   door.sh ci sha <repo dir> <sha> <name>...   rc 0 when every named check is success on that sha, 1 failed, 3 missing/unfinished
#   door.sh ci all                         the solution pack: root, connector, framework, the two widgets; rc 1 when any is red
# "Counts" = the names in the repo's .github/required-checks (on its main) when it has one, else every check-run on
# the head, so a continue-on-error leg is not a red main. Per name the newest run wins. Without gh or a GitHub
# remote the answer is "unknown", never "green".
slug_of() {  # slug_of <dir>: owner/repo of its GitHub remote (the main upstream's if that is GitHub, else any)
    local d="$1" r url up
    up="$(git -C "$d" for-each-ref --format='%(upstream:remotename)' refs/heads/main 2>/dev/null)"
    for r in $up $(git -C "$d" remote 2>/dev/null); do
        url="$(git -C "$d" remote get-url "$r" 2>/dev/null)" || continue
        case "$url" in *github.com[:/]*) printf '%s\n' "$url" | sed -E 's#.*github\.com[:/]##; s#\.git$##'; return 0 ;; esac
    done
    return 1
}
required_of() {  # required_of <dir>: names in .github/required-checks on its main
    local d="$1" r ref
    r="$(git -C "$d" for-each-ref --format='%(upstream:remotename)' refs/heads/main 2>/dev/null)"
    for ref in "refs/remotes/${r:-origin}/main" main; do
        if git -C "$d" cat-file -e "$ref:.github/required-checks" 2>/dev/null; then
            git -C "$d" show "$ref:.github/required-checks" | sed 's/#.*//; s/^[[:space:]]*//; s/[[:space:]]*$//' | grep -v '^$'
            return 0
        fi
    done
    return 0
}
runs_of() {  # runs_of <slug> <ref>: id, sha, name, status, conclusion; newest run per name
    gh api "repos/$1/commits/$2/check-runs?per_page=100" \
        --jq '.check_runs[] | [.id, .head_sha, .name, .status, (.conclusion // "")] | @tsv' 2>/dev/null \
        | sort -t$'\t' -k3,3 -k1,1nr | awk -F'\t' '!seen[$3]++'
}
# classify <required names, newline separated> < rows -> prints "<verdict>\t<sha8>\t<detail>"
ci_classify() {
    local req="$1"
    REQ="$req" awk -F'\t' '
        BEGIN { n = split(ENVIRON["REQ"], r, "\n"); for (i = 1; i <= n; i++) if (r[i] != "") want[r[i]] = 1; nreq = 0; for (k in want) nreq++ }
        { sha = substr($2, 1, 8); name = $3; st = $4; co = $5
          have[name] = 1
          if (nreq && !(name in want)) next
          if (st != "completed") { pend = pend (pend ? ", " : "") name; next }
          if (co == "failure" || co == "timed_out" || co == "cancelled" || co == "action_required" || co == "startup_failure") red = red (red ? "\n" : "") name
          else seen_ok++ }
        END {
            for (k in want) if (!(k in have)) miss = miss (miss ? ", " : "") k
            if (red != "") { gsub(/\n/, "\001", red); print "RED\t" sha "\t" red }
            else if (pend != "" || miss != "") print "PENDING\t" sha "\t" pend (pend && miss ? ", " : "") (miss ? miss " (no run yet)" : "")
            else if (seen_ok > 0) print "GREEN\t" sha "\t"
            else print "UNKNOWN\t" sha "\tno check-runs"
        }'
}
main_verdict() {  # main_verdict <dir>: sets V (verdict) S (sha8) D (detail, names joined by \001) SLUG; rc 0 when it could ask
    local d="$1" rows out
    V=UNKNOWN S=""; D=""; SLUG=""
    command -v gh >/dev/null 2>&1 || { D="gh is not installed"; return 1; }
    SLUG="$(slug_of "$d")" || { D="no GitHub remote"; return 1; }
    rows="$(runs_of "$SLUG" main)"
    [[ -n "$rows" ]] || { D="no CI runs on main (or GitHub could not be read)"; return 1; }
    out="$(printf '%s\n' "$rows" | ci_classify "$(required_of "$d")")"
    V="${out%%$'\t'*}"; out="${out#*$'\t'}"; S="${out%%$'\t'*}"; D="${out#*$'\t'}"
    return 0
}
rc_of() { case "$1" in GREEN) return 0 ;; RED) return 1 ;; *) return 3 ;; esac; }

ci_cmd() {
cmd="${1:-}"; shift || true
case "$cmd" in
    status)
        d="${1:?usage: door.sh ci status <repo dir>}"; name="${2:-$(basename "$d")}"
        main_verdict "$d"
        case "$V" in
            GREEN) echo "ci main: $name ($SLUG) green at $S" ;;
            RED) echo "ci main: $name ($SLUG) RED at $S: failing $(printf '%s' "$D" | tr '\001' ';' | sed 's/;/, /g'). Main is red: fix it before piling on" ;;
            PENDING) echo "ci main: $name ($SLUG) pending at $S: $D" ;;
            *) echo "ci main: $name unknown: $D" ;;
        esac
        rc_of "$V" ;;
    red-names)
        main_verdict "${1:?usage: door.sh ci red-names <repo dir>}"
        [[ "$V" == RED ]] && printf '%s\n' "$D" | tr '\001' '\n'
        rc_of "$V" ;;
    sha)
        d="${1:?usage: door.sh ci sha <repo dir> <sha> <name>...}"; sha="${2:?}"; shift 2
        slug="$(slug_of "$d")" || { echo "ci: no GitHub remote for $d" >&2; exit 3; }
        rows="$(runs_of "$slug" "$sha")"
        out="$(printf '%s\n' "$rows" | ci_classify "$(printf '%s\n' "$@")")"
        v="${out%%$'\t'*}"; [[ -z "$rows" ]] && v=PENDING
        rc_of "$v" ;;
    all)
        rc=0
        for n in root conn framework agenticAssistant agenticAssistantMonitor; do
            d="$(bash "$HERE/scripts/repo_paths.sh" "$n" 2>/dev/null)" && [[ -d "$d" ]] || { echo "ci main: $n unknown: repo not found"; continue; }
            line="$(ci_cmd status "$d" "${n/conn/connector}")"; r=$?
            if (( r == 1 )); then printf '\n!!! %s\n\n' "$line"; rc=1; else echo "$line"; fi
        done
        return "$rc" ;;
    *) echo "usage: door.sh ci status <repo dir> | red-names <dir> | sha <dir> <sha> <name>... | all" >&2; return 2 ;;
esac
}

[[ "$mode" == ci ]] && { ci_cmd "${@:2}"; exit $?; }

die() { echo "door: $*" >&2; exit 2; }
say() { echo "door: $*"; }
lap() { local label="$1" budget="$2"; shift 2; bash "$LAPSH" "$label" --budget "$budget" -- "$@"; }
# local-chat starts a dev server, a connector and a model client; any of them can outlive the turn. Never pipe it
# (a leftover child that inherits the pipe keeps `tee` waiting for an EOF that never comes): its output goes to a file,
# shown by a tail we stop ourselves, it runs in its own process group, and that group is killed when the step ends or
# when the hard bound (the model turn + DOOR_CHAT_GRACE seconds) passes. Prints to the door's stdout; rc = the step's.
bounded_chat() {  # bounded_chat <outfile> <cmd...>
    local out="$1" pid wd rc hard off=0 n; shift
    hard=$(( ${DOOR_CHAT_TIMEOUT:-180} + ${DOOR_CHAT_GRACE:-90} ))
    : > "$out"
    perl -e 'setpgrp(0,0); exec @ARGV or exit 127' -- bash "$LAPSH" "check local-chat" --budget 120 -- bash -c '"$@" > "$0" 2>&1' "$out" "$@" > "$out.lap" 2>&1 < /dev/null & pid=$!
    ( sleep "$hard"; kill -TERM -- "-$pid" 2>/dev/null; sleep 3; kill -KILL -- "-$pid" 2>/dev/null ) >/dev/null 2>&1 < /dev/null & wd=$!
    while kill -0 "$pid" 2>/dev/null; do   # show the output as it grows (no pipe for a leftover child to hold)
        n=$(wc -c < "$out"); (( n > off )) && { tail -c +$((off + 1)) "$out"; off=$n; }; sleep 0.5
    done
    wait "$pid"; rc=$?
    kill -TERM -- "-$pid" 2>/dev/null; sleep 0.2; kill -KILL -- "-$pid" 2>/dev/null   # whatever the step left alive
    kill "$wd" 2>/dev/null; pkill -P "$wd" 2>/dev/null
    wait "$wd" 2>/dev/null
    n=$(wc -c < "$out"); (( n > off )) && tail -c +$((off + 1)) "$out"
    cat "$out.lap"; rm -f "$out.lap"
    return "$rc"
}
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
for d in "${DIRS[@]}"; do ci_cmd status "$d" "$(main_name "$d")" | sed 's/^/door: /'; done
# ONE box-lease holder for every step of this ship (the door's own lease calls, dev-push, widget-push, the stamp, the
# release at the end). box.sh derives a holder from $FSR_LEASE_HOLDER, else from the cwd, so a ship started in a plain
# shell took the lease as manual:<user> and its own dev-push (run from the tree it pushes) refused it as tree:<name>.
if [[ -z "${FSR_LEASE_HOLDER:-}" ]]; then
    if [[ -n "$tree" ]]; then FSR_LEASE_HOLDER="tree:$(basename "$tree")"; else FSR_LEASE_HOLDER="manual:${USER:-unknown}"; fi
fi
export FSR_LEASE_HOLDER
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
            */test_*.py) # a test file counts only for the suite directory it lives in
                  for tg in "$@"; do [[ "$f" == "$tg"/* && -f "$d/$f" ]] && sel[$f]=1; done ;;
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

prep_harness() {  # prints why local-chat cannot run here (rc 1), or nothing (rc 0). A root worktree has no node_modules or
    # local-chat python of its own: reuse the shared checkout's, as agent_tree.sh does (node_modules only when the lockfile is identical).
    local h="$HERE/fortisoar-widget-harness" c shared sh
    c="$(gc "$HERE")" && [[ "$(basename "$c")" == .git ]] && shared="$(dirname "$c")" || shared=""
    sh="${shared:+$shared/fortisoar-widget-harness}"
    if [[ ! -e "$h/.venv-localdev" && -n "$sh" && "$sh" != "$h" && -d "$sh/.venv-localdev" ]]; then ln -sfn "$sh/.venv-localdev" "$h/.venv-localdev"; fi
    if [[ ! -e "$h/node_modules" && -n "$sh" && "$sh" != "$h" && -d "$sh/node_modules" ]] && cmp -s "$sh/pnpm-lock.yaml" "$h/pnpm-lock.yaml"; then
        ln -sfn "$sh/node_modules" "$h/node_modules"
    fi
    if [[ -n "$shared" && "$shared" != "$HERE" ]]; then   # the platform extracts the harness mounts the app shell from (ignored, so absent in a worktree)
        local e
        while IFS= read -r e; do
            e="${e%/}"; [[ -n "$e" && "$e" != */.DS_Store && ! -e "$HERE/$e" ]] && { mkdir -p "$(dirname "$HERE/$e")"; ln -s "$shared/$e" "$HERE/$e"; }
        done < <(git -C "$shared" ls-files --others --ignored --exclude-standard --directory -- fsr_src 2>/dev/null)
    fi
    [[ -e "$h/node_modules" ]] || { echo "the harness is not set up in $HERE (no node_modules, and the shared checkout's is missing or has a different pnpm-lock.yaml); run pnpm install in fortisoar-widget-harness there"; return 1; }
    return 0
}

# Root jest: the tooling suites (the ONE list is TOOLING_SUITES in jest.config.js) spawn git and make hundreds of
# times, which takes minutes on the Mac host (process starts stall) and seconds in a Linux container, so they run
# through `make test-docker` when a container engine answers (or colima can start). No engine, or DOOR_DOCKER=0:
# the same files on the host, as before. Non-tooling files always run on the host.
root_jest() {  # root_jest <dir> <name> <test file basename>...
    local d="$1" name="$2"; shift 2
    local f b tool=() host=() list
    list="$(sed -n '/const TOOLING_SUITES = \[/,/^\];/p' "$d/fortisoar-widget-harness/jest.config.js" | grep -oE '"[A-Za-z0-9_.]+"' | tr -d '"')"
    for f in "$@"; do
        b="${f%.test.*}"
        if grep -qxF -- "$b" <<<"$list"; then tool+=("$f"); else host+=("$f"); fi
    done
    if (( ${#tool[@]} )) && [[ "${DOOR_DOCKER:-1}" != 0 ]]; then
        lap "check tests (container)" 120 $MAKE -C "$d" test-docker TESTS="${tool[*]}"; local rc=$?
        if (( rc == 2 )); then echo "door: no container engine; running the tooling suites on the host" >&2; host+=("${tool[@]}")
        elif (( rc != 0 )); then fail "$name jest (container): ${tool[*]}"; fi
    else host+=("${tool[@]}"); fi
    (( ${#host[@]} )) && { lap "check tests" 120 $MAKE -C "$d" test-unit FULL=1 TESTS="${host[*]}" || fail "$name jest: ${host[*]}"; }
    return 0
}

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
            else root_jest "$d" "$name" $sel; fi ;;
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
            # The framework refuses a pytest process that mixes its suites (tooling/tests vs fsr_playbooks/tests):
            # one process per suite, each reported on its own.
            local suite any=0
            py=""
            for suite in tooling/tests fsr_playbooks/tests; do
                sel="$(printf '%s\n' "$files" | select_by_import "$d" "$suite" | paste -sd' ' -)"
                if [[ -z "$sel" ]]; then not_run "$name: no $suite file maps to this diff (CI runs the full suite)"; continue; fi
                any=1
                [[ -n "$py" ]] || py="$(bash "$CONN/scripts/dev_env.sh" python)" || die "no dev python; run make setup in $CONN"
                # shellcheck disable=SC2086
                ( cd "$d" && PYTHONPATH="$d" FSRPB_DEV=1 lap "check tests ($suite)" 120 "$py" -m pytest -q -p no:randomly -m 'not live and not slow' $sel ) || fail "$name pytest ($suite): $sel"
            done
            (( any )) || true ;;
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
        if ! why="$(prep_harness)"; then not_run "$name: local-chat $b: $why"; return; fi
        local lc rc=0 lcdir; lc="$(mktemp "${TMPDIR:-/tmp}/door-lc.XXXXXX")"; lcdir="$(mktemp -d "${TMPDIR:-/tmp}/door-lcout.XXXXXX")"
        # TIMEOUT bounds the model turn (local-chat defaults to 600s); a gateway that stalls must not hold the door for 10 minutes.
        rc=0; bounded_chat "$lc" env CONN_REPO="$CONN" FSR_SRC="$FW" TIMEOUT="${DOOR_CHAT_TIMEOUT:-180}" OUT="$lcdir" $MAKE -C "$HERE" local-chat BUNDLE="$b" || rc=$?
        if (( rc )); then fail "$name local-chat $b"; else judge_local_chat "$name" "$b" "$lc" "$lcdir"; fi
        rm -rf "$lc" "$lcdir"
    fi
}
judge_local_chat() {  # judge_local_chat <repo> <bundle> <captured output> <out dir>: rc 0 is not a pass when the model did nothing
    local name="$1" b="$2" out="$3" tools text card
    tools="$(sed -n 's/^local-chat: tools called: //p' "$out" | tail -1)"
    text="$(sed -n '/^\*\*Assistant:\*\*/,/^\*\*Card/p' "$4/transcript.md" 2>/dev/null | sed '1d;/^\*\*Card/d' | tr -d '[:space:]' | wc -c | tr -d ' ')"   # what the model said, from the transcript
    card="$(sed -n 's/^local-chat: verdict card: \([^;]*\);.*/\1/p' "$out" | tail -1)"
    if [[ -z "$tools" ]]; then not_run "$name: local-chat $b: no report was produced (the turn did not finish or the gateway was unavailable)"; return; fi
    if [[ "$tools" == none* ]]; then
        if [[ "${text:-0}" == 0 ]]; then not_run "$name: local-chat $b: the model gave no answer and called no tools (gateway unavailable or the turn timed out)"
        else fail "$name local-chat $b: the model answered but called no tools"; fi
        return
    fi
    if [[ "$b" == ka_* && "${card:-none}" == none ]]; then fail "$name local-chat $b: tools ran but no verdict card was produced"; fi
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

main_red_gate() {  # main_red_gate <dir> <branch>: refuse to ship onto a red main unless this branch is green on the failing checks
    local d="$1" br="$2" names=() waits poll deadline rc
    mapfile -t names < <(ci_cmd red-names "$d") || true
    (( ${#names[@]} )) || return 0
    say "$(main_name "$d"): main is red on: $(printf '%s; ' "${names[@]}"). Shipping is allowed only if $br is green on the same checks (it may be the fix); pushing it to find out"
    git -C "$d" push -q -u "$(remote_of "$d")" "$br" || die "$(main_name "$d"): could not push $br to read its CI"
    waits="${DOOR_RED_WAIT:-900}"; poll="${DOOR_RED_POLL:-20}"; deadline=$((SECONDS + waits))
    while :; do
        ci_cmd sha "$d" "$(git -C "$d" rev-parse HEAD)" "${names[@]}"; rc=$?
        (( rc == 3 && SECONDS < deadline )) || break
        sleep "$poll"
    done
    case "$rc" in
        0) say "$(main_name "$d"): $br is green on the checks main fails: shipping (this ship can be the fix)" ;;
        1) die "$(main_name "$d"): main is red and $br is red on the same checks too. Fix the failing checks (gh run list -b main), then ship" ;;
        *) die "$(main_name "$d"): main is red and $br's CI on those checks is not finished or has not started after ${waits}s. Wait for it (the branch is pushed), then run make ship again" ;;
    esac
}
bundled_gate() {  # bundled_gate <framework dir>: the connector's required leg (framework main), run against this framework head
    local fw="$1" conn="$CONN" tmp="" py rc=0 d together=0
    for d in "${pushes[@]}"; do [[ "$(kind_of "$d")" == connector ]] && { conn="$d"; together=1; }; done   # shipping together: the connector's branch
    if (( ! together )); then   # not shipping: the connector as main has it
        git -C "$CONN" fetch -q "$(remote_of "$CONN")" main 2>/dev/null || true
        tmp="$(mktemp -d "${TMPDIR:-/tmp}/door-bundled.XXXXXX")"; rm -rf "$tmp"
        git -C "$CONN" worktree add -q --detach "$tmp" "refs/remotes/$(remote_of "$CONN")/main" || die "cross-repo gate: cannot check out the connector's main from $CONN"
        conn="$tmp"
    fi
    py="$(bash "$CONN/scripts/dev_env.sh" python)" || die "cross-repo gate: no dev python for the connector; run make setup in $CONN"
    say "cross-repo gate: connector suite ($(main_name "$conn"), as CI's 'bundled framework' leg) against framework $(git -C "$fw" rev-parse --short HEAD)"
    # The full connector suite spawns processes in bulk, which stalls on the Mac host: it runs in the Linux container when
    # an engine answers (devloop_docker_py.sh; exit 75 = no engine), else on the host. DOOR_DOCKER=0 forces the host.
    local ran=0
    if [[ "${DOOR_DOCKER:-1}" != 0 ]]; then
        # shellcheck disable=SC2086
        DEVLOOP_FRAMEWORK_DIR="$fw" lap "ship bundled (container)" 600 bash "${DOOR_PY_DOCKER:-$HERE/scripts/devloop_docker_py.sh}" connector "$conn" ${DOOR_BUNDLED_ARGS:-}; rc=$?
        if (( rc == 75 )); then echo "door: no container engine; running the connector suite on the host" >&2; rc=0; else ran=1; fi
    fi
    if (( ! ran )); then
        # shellcheck disable=SC2086
        ( cd "$conn" && FSRPB_DEV=1 FSRPB_FRAMEWORK_DIR="$fw" PYTHONPATH="$fw:$fw/tooling" lap "ship bundled" 600 "$py" -m pytest -q --no-header -n auto ${DOOR_BUNDLED_ARGS:--p no:randomly} ) || rc=$?
    fi
    [[ -z "$tmp" ]] || git -C "$CONN" worktree remove --force "$tmp" >/dev/null 2>&1
    (( rc == 0 )) || die "cross-repo gate: the connector's suite is RED against this framework head, so connector main would go red once it lands. Nothing was promoted. Fix the framework change (or ship the connector change that goes with it in the same tree)"
}

box_pick() {  # box_pick: no BOX= given. Take the lease on a free experimental box (never a stable one); sets BOX. Waits, bounded, when all are leased.
    local bsh="$CONN/scripts/box.sh" a all f b sha d waits poll deadline last=-999 out="" cand=() order=() pref=""
    all="$(bash "$bsh" --list 2>/dev/null)" || die "cannot list the boxes ($bsh --list); pass BOX=<alias>"
    for a in $all; do [[ "$(bash "$bsh" --role "$a" 2>/dev/null)" == experimental ]] && cand+=("$a"); done
    (( ${#cand[@]} )) || die "no experimental box in the registry (roles: scripts/box.sh --role <alias>); a ship that puts code on a box needs one. A stable box takes code only through make stable"
    # Prefer the box that last ran this tree's code: the newest stamp on a commit of a shipped branch names it.
    for d in "${shipped[@]}"; do
        while IFS= read -r sha; do
            f="$STAMPS/$(main_name "$d")/$sha.json"; [[ -f "$f" ]] || continue
            b="$(jq -r '.box // ""' "$f" 2>/dev/null)"
            for a in "${cand[@]}"; do [[ "$a" == "$b" ]] && { pref="$a"; break 3; }; done
        done < <(git -C "$d" rev-list -n 40 HEAD 2>/dev/null)
    done
    [[ -z "$pref" ]] || order+=("$pref")
    for a in "${cand[@]}"; do [[ "$a" == "$pref" ]] || order+=("$a"); done
    held() { local l c; while IFS= read -r l; do for c in "${cand[@]}"; do [[ "$l" == "$c "* ]] && echo "$l"; done; done < <(bash "$bsh" --leases 2>/dev/null); }   # who holds which candidate
    waits="${DOOR_BOX_WAIT:-1800}"; poll="${DOOR_BOX_POLL:-20}"; deadline=$((SECONDS + waits))
    while :; do
        for a in "${order[@]}"; do
            if out="$(bash "$bsh" --lease "$a" 2>&1)"; then
                BOX="$a"; say "no BOX= given: took the lease on experimental box $a${pref:+ (last ran this code: $pref)} as $FSR_LEASE_HOLDER"; return 0
            fi
        done
        if (( SECONDS >= deadline )); then
            die "every experimental box (${cand[*]}) stayed leased for ${waits}s. Who holds what:
$(held | sed 's/^/  /')
Wait for one (make box-leases), or pin a box with BOX=<alias>. Nothing was pushed"
        fi
        if (( SECONDS - last >= 60 )); then
            say "every experimental box is leased; waiting for one (up to ${waits}s, checking every ${poll}s). Who holds what:"
            held | sed 's/^/door:   /'
            last=$SECONDS
        fi
        sleep "$poll"
    done
}

bump_only() {  # bump_only <dir>: BUMP=<level> on a branch with nothing ahead of main -> one version-only commit
    local d="$1" name info notes new
    name="$(main_name "$d")"
    case "$BUMP" in patch|minor|major) ;; *) die "$name: BUMP must be patch, minor or major (got '$BUMP')" ;; esac
    info="$d/connector-fsr-agentic-assistant/info.json"; notes="$d/connector-fsr-agentic-assistant/release_notes.md"
    [[ -f "$info" ]] || die "$name: no $info to bump"
    # The same arithmetic (preflight_version.apply_bump) and targeted version-line rewrite as scripts/deploy.sh (info.json stays
    # byte-identical but for the version), and the release-notes entry deploy.sh would stub, so version and notes cannot drift.
    new="$(python3 - "$info" "$notes" "$BUMP" "$d/scripts" <<'PY'
import json, re, sys
info, notes, bump, scripts = sys.argv[1:5]
sys.path.insert(0, scripts)
from preflight_version import apply_bump
cur = json.load(open(info))["version"]
new = apply_bump(cur, bump)
src = open(info).read()
out, n = re.subn(r'("version"\s*:\s*")%s(")' % re.escape(cur), r'\g<1>%s\g<2>' % new, src, count=1)
if n != 1:
    sys.exit("could not rewrite version %r in %s" % (cur, info))
open(info, "w").write(out)
try:
    body = open(notes).read()
except OSError:
    body = "# Release notes\n"
if not re.search(r"^## %s( |$)" % re.escape(new), body, re.M):
    head, _, rest = body.partition("\n")
    entry = "\n## %s\n\n- Version-only bump: the code merged since %s is unchanged, so a box that already has %s can take it.\n" % (new, cur, cur)
    open(notes, "w").write(head + "\n" + entry + rest)
print(new)
PY
    )" || die "$name: could not bump the version"
    [[ -n "$new" ]] || die "$name: the bump produced no version"
    git -C "$d" add -- "$info" "$notes" || die "$name: could not stage the bump"
    git -C "$d" commit -q -m "Bump to $new" || die "$name: could not commit the bump"
    say "$name: nothing ahead of main, BUMP=$BUMP: committed a version-only bump to $new"
}

ship_all() {
    local d br kind name cls shipped=() pushes=() pids=() i rc=0 stampdirs=()
    declare -A CLS=()
    for d in "${DIRS[@]}"; do
        name="$(main_name "$d")"; br="$(branch_of "$d")"; kind="$(kind_of "$d")"
        [[ -n "$br" ]] || die "$name is on a detached HEAD: make a branch (git switch -c <branch>) and commit"
        [[ "$br" != main ]] || die "$name is on main: main moves only through ship; make a branch and commit"
        dirty_of "$d" && die "$name has uncommitted changes to tracked files: commit them (ship proves a commit, not a working tree)"
        if (( $(ahead_of "$d") == 0 )) && [[ -n "${BUMP:-}" && "${BUMP:-}" != none && "$kind" == connector ]]; then bump_only "$d"; fi
        (( $(ahead_of "$d") > 0 )) || { say "$name: $br has nothing ahead of main"; continue; }
        cls="$(classify "$d" "$br")" || die "$name: could not classify the diff"
        [[ -n "$cls" ]] || die "$name: promote did not say how it classifies the diff"
        CLS[$d]="$cls"; say "$name ($br): $cls"
        pushes+=("$d"); [[ "$cls" == shipped ]] && shipped+=("$d")
    done
    (( ${#pushes[@]} )) || { say "nothing to ship"; exit 0; }
    for d in "${pushes[@]}"; do main_red_gate "$d" "$(branch_of "$d")"; done
    if (( ${#shipped[@]} )); then
        if [[ -z "${BOX:-}" ]]; then
            box_pick   # sets BOX and holds its lease: free it when ship ends, whatever happened
            trap '$MAKE -s -C "$HERE" box-release BOX="$BOX" >/dev/null 2>&1 || true' EXIT
        fi
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
    for d in "${pushes[@]}"; do [[ "$(kind_of "$d")" == framework ]] && bundled_gate "$d"; done
    # A framework and a connector branch in ONE ship land together: promoting framework first leaves connector main
    # broken against framework main until the connector lands (a new framework contract that only the connector branch
    # adapts to). So check BOTH first (promote's own dry run: classification, CI on the head, the box stamp), merge
    # neither until both pass, then merge back to back.
    local have_fw=0 have_conn=0 merged=() recover m
    for d in "${pushes[@]}"; do case "$(kind_of "$d")" in framework) have_fw=1 ;; connector) have_conn=1 ;; esac; done
    if (( have_fw && have_conn )) && [[ -z "${DRY_RUN:-}" ]]; then
        say "framework and connector land together: checking both (CI on both heads, proof, merge) before merging either"
        for d in "${pushes[@]}"; do
            case "$(kind_of "$d")" in framework|connector) ;; *) continue ;; esac
            say "pre-check $(main_name "$d") ($(branch_of "$d"))"
            env PROMOTE_DRY_RUN=1 $MAKE -C "$HERE" promote REPO="$d" BRANCH="$(branch_of "$d")" \
                || die "$(main_name "$d") ($(branch_of "$d")) is not ready to merge, so NOTHING was merged (framework and connector land together). Fix it and run make ship again"
        done
    fi
    for d in "${pushes[@]}"; do
        say "promote $(main_name "$d") ($(branch_of "$d"))${DRY_RUN:+ (dry run: CI and proof checked, nothing merged)}"
        if ! env ${DRY_RUN:+PROMOTE_DRY_RUN=1} $MAKE -C "$HERE" promote REPO="$d" BRANCH="$(branch_of "$d")"; then
            if (( ${#merged[@]} )); then
                recover="make promote REPO=$d BRANCH=$(branch_of "$d")"
                {
                    echo
                    echo "door: !!! HALF LANDED: $(for m in "${merged[@]}"; do main_name "$m"; done | paste -sd' ' -) main was promoted, but $(main_name "$d") ($(branch_of "$d")) was NOT."
                    echo "door: !!! Until it lands, the merged main(s) may not work with the unmerged one. Main was not reverted and nothing was force-pushed."
                    echo "door: !!! Recovery: fix what the promote above refused (a rejected push, a hook, the network), then run:  $recover"
                    echo "door: !!! (it retries, and finds the branch's CI and stamp already in place). Do not force-push or reset main."
                    echo
                } >&2
                exit 2
            fi
            die "promote stopped at $(main_name "$d"); nothing was merged before it. Fix it and run make ship again"
        fi
        merged+=("$d")
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
