#!/usr/bin/env bash
# make release-check: the batch gate. A per-change `make ship` runs only the tests its diff touches and does not wait
# for GitHub CI; everything it skipped is proven here, once, on the exact mains that `make stable` would install:
#
#   1. the FULL connector suite, in the Linux container (host when no engine), against the framework main
#   2. the framework suites (fsr_playbooks/tests and tooling/tests, one process each)
#   3. green CI on every repo's main (door.sh ci status), waiting for a pending run
#
# On success it records the five heads (root, framework, connector, the two widgets) in
# ${FSR_RELEASE_CHECK_DIR:-~/.cache/fsr-release-check}/<key>.json, like a live-sanity stamp. `make stable` calls
# `release_check.sh verify` and refuses unless a record exists for exactly the heads it is about to install.
#
#   release_check.sh run                 build detached trees of every main, run 1-3, record
#   release_check.sh verify <root> <framework> <connector> <widget aa> <widget mon>   rc 0 only for a recorded set of heads
#
# Test hooks: RC_SRC_ROOT RC_SRC_FW RC_SRC_CONN RC_SRC_AA RC_SRC_MON (use these trees, do not build any),
# RC_PY_DOCKER (container runner), RC_PY (python for the framework suites), RC_DOOR (the door script), RC_CI_WAIT / RC_CI_POLL.
set -uo pipefail

ROOT="${FSR_TOOL_HOME:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
DIR="${FSR_RELEASE_CHECK_DIR:-$HOME/.cache/fsr-release-check}"

heads_key() {  # heads_key <root> <fw> <conn> <aa> <mon>: one key for the five heads (content of the commits)
    local d out=""
    for d in "$@"; do out+="$(basename "$d")=$(git -C "$d" rev-parse HEAD 2>/dev/null || echo none)"$'\n'; done
    printf '%s' "$out" | shasum -a 256 | cut -c1-24
}

verify() {
    (( $# == 5 )) || { echo "usage: $0 verify <root> <framework> <connector> <widget aa> <widget mon>" >&2; return 2; }
    local k; k="$(heads_key "$@")"
    if [[ -f "$DIR/$k.json" ]]; then echo ">> release-check: passed on exactly these heads ($k)"; return 0; fi
    echo "release-check: NOT passed on these exact mains (key $k): make stable installs only what make release-check proved. Run make release-check, then make stable again." >&2
    return 1
}

run() {
    local root fw conn aa mon py rc=0 door="${RC_DOOR:-$ROOT/scripts/door.sh}" d name
    if [[ -n "${RC_SRC_ROOT:-}" ]]; then
        root="$RC_SRC_ROOT"; fw="$RC_SRC_FW"; conn="$RC_SRC_CONN"; aa="$RC_SRC_AA"; mon="$RC_SRC_MON"
    else
        CONN_REPO="${CONN_REPO:-$(bash "$ROOT/scripts/repo_paths.sh" conn)}"
        FSR_FRAMEWORK_REPO="${FSR_FRAMEWORK_REPO:-$(bash "$ROOT/scripts/repo_paths.sh" framework)}"
        unset WIDGETS_SRC
        # shellcheck source=stable_source.sh
        source "$ROOT/scripts/stable_source.sh"
        stable_source_prepare "$ROOT" "$FSR_FRAMEWORK_REPO" "$CONN_REPO" || return 1
        root="$SRC_ROOT"; fw="$SRC_FW"; conn="$SRC_CONN"
        aa="$SRC_ROOT/widgets-src/agenticAssistant"; mon="$SRC_ROOT/widgets-src/agenticAssistantMonitor"
    fi
    echo ">> release-check 1/3: the full connector suite against the framework main"
    local pd="${RC_PY_DOCKER:-$ROOT/scripts/devloop_docker_py.sh}"
    DEVLOOP_FRAMEWORK_DIR="$fw" bash "$pd" connector "$conn"; rc=$?
    if (( rc == 75 )); then
        echo "release-check: no container engine; running the connector suite on the host" >&2
        py="${RC_PY:-$(bash "$conn/scripts/dev_env.sh" python)}" || { echo "release-check: no dev python for the connector" >&2; return 1; }
        ( cd "$conn" && FSRPB_DEV=1 FSRPB_FRAMEWORK_DIR="$fw" PYTHONPATH="$fw:$fw/tooling" "$py" -m pytest -q --no-header -n auto -p no:randomly ); rc=$?
    fi
    (( rc == 0 )) || { echo "release-check: FAILED: the full connector suite is red on the mains" >&2; return 1; }
    echo ">> release-check 2/3: the framework suites"
    py="${RC_PY:-$(bash "$conn/scripts/dev_env.sh" python)}" || { echo "release-check: no dev python" >&2; return 1; }
    local suite
    for suite in fsr_playbooks/tests tooling/tests; do
        [[ -d "$fw/$suite" ]] || continue
        ( cd "$fw" && PYTHONPATH="$fw" FSRPB_DEV=1 "$py" -m pytest -q --no-header -p no:randomly -m 'not live and not slow' "$suite" ); rc=$?
        (( rc == 0 )) || { echo "release-check: FAILED: framework $suite is red on main" >&2; return 1; }
    done
    echo ">> release-check 3/3: green CI on every main"
    local wait_s="${RC_CI_WAIT:-1800}" poll="${RC_CI_POLL:-30}" deadline=$((SECONDS + ${RC_CI_WAIT:-1800})) pending line
    for d in "$root" "$fw" "$conn" "$aa" "$mon"; do
        name="$(basename "$d")"
        while :; do
            line="$(bash "$door" ci status "$d" "$name" 2>&1)"; rc=$?
            echo "$line"
            (( rc == 3 && SECONDS < deadline )) || break
            sleep "$poll"
        done
        (( rc == 0 )) || { echo "release-check: FAILED: CI on $name main is not green (waited up to ${wait_s}s for a pending run)" >&2; return 1; }
    done
    mkdir -p "$DIR" || return 1
    local k; k="$(heads_key "$root" "$fw" "$conn" "$aa" "$mon")"
    printf '{"key":"%s","timestamp":"%s","heads":{"root":"%s","framework":"%s","connector":"%s","widget_aa":"%s","widget_mon":"%s"}}\n' \
        "$k" "$(date -u +%FT%TZ)" "$(git -C "$root" rev-parse HEAD)" "$(git -C "$fw" rev-parse HEAD)" "$(git -C "$conn" rev-parse HEAD)" \
        "$(git -C "$aa" rev-parse HEAD 2>/dev/null)" "$(git -C "$mon" rev-parse HEAD 2>/dev/null)" > "$DIR/$k.json"
    echo ">> release-check: PASSED and recorded ($k); make stable may install exactly these mains"
}

case "${1:-}" in
    run) run ;;
    verify) shift; verify "$@" ;;
    *) echo "usage: $0 run | verify <root> <framework> <connector> <widget aa> <widget mon>" >&2; exit 2 ;;
esac
