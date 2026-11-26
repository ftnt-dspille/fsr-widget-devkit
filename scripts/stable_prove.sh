#!/usr/bin/env bash
# Re-prove promoted heads on an EXPERIMENTAL box so make stable's guard finds a VERIFIED stamp that did not come from
# the stable box. The same steps `make ship` takes for code that has no stamp (scripts/door.sh): connector and
# framework through dev-push, a widget through widget-push, the rest through doctor SANITY=1 STAMP=.
#
#   stable_prove.sh <src root> <src framework> <src connector> <repo name>...
#       repo name = the guard's: fsr_all_widgets fsr-playbook-framework conn_main agenticAssistant agenticAssistantMonitor
#
# PROVE_BOX=<alias> pins the box; otherwise the first free experimental box of the ship pool is leased (waits up to
# STABLE_PROVE_WAIT seconds). Exit 0 proved, 1 failed, 3 no experimental box was available (the caller prints the commands).
# Test hooks: STABLE_PROVE_MAKE (the make binary), STABLE_PROVE_BOXSH (box.sh).
set -uo pipefail
SRC_ROOT="$1"; SRC_FW="$2"; SRC_CONN="$3"; shift 3
MAKE="${STABLE_PROVE_MAKE:-make}"
BSH="${STABLE_PROVE_BOXSH:-$SRC_CONN/scripts/box.sh}"
export FSR_LEASE_HOLDER="${FSR_LEASE_HOLDER:-stable-prove:$$}"

pick_box() {
    local all a pool cand=() waits="${STABLE_PROVE_WAIT:-600}" deadline
    [[ -z "${PROVE_BOX:-}" ]] || { bash "$BSH" --lease "$PROVE_BOX" >/dev/null 2>&1 && { echo "$PROVE_BOX"; return 0; }; return 3; }
    all="$(bash "$BSH" --list 2>/dev/null)" || return 3
    pool=" $(python3 -c 'import sys, tomllib
try:
    i = tomllib.load(open(sys.argv[1], "rb")).get("instances", {})
except Exception:
    i = {}
print(" ".join(k for k, v in i.items() if isinstance(v, dict) and v.get("ship_pool") is True))' "${PYFSR_INSTANCES:-$HOME/.pyfsr/instances.toml}" 2>/dev/null) "
    for a in $all; do [[ "$pool" == *" $a "* && "$(bash "$BSH" --role "$a" 2>/dev/null)" == experimental ]] && cand+=("$a"); done
    (( ${#cand[@]} )) || return 3
    deadline=$((SECONDS + waits))
    while :; do
        for a in "${cand[@]}"; do bash "$BSH" --lease "$a" >/dev/null 2>&1 && { echo "$a"; return 0; }; done
        (( SECONDS < deadline )) || return 3
        sleep 20
    done
}

BOXX="$(pick_box)" || { echo "stable prove: no experimental box is free (pool boxes need ship_pool = true; pin one with PROVE_BOX=<alias>)" >&2; exit 3; }
trap '$MAKE -s -C "$SRC_ROOT" box-release BOX="$BOXX" >/dev/null 2>&1 || true' EXIT
echo ">> stable prove: re-proving $* on experimental box $BOXX"
rc=0; rest=(); conn_done=0
for r in "$@"; do
    case "$r" in
        conn_main|fsr-playbook-framework)
            (( conn_done )) && continue; conn_done=1
            FSR_SRC="$SRC_FW" $MAKE -C "$SRC_CONN" dev-push BOX="$BOXX" || { echo "stable prove: dev-push failed" >&2; rc=1; } ;;
        agenticAssistant|agenticAssistantMonitor)
            $MAKE -C "$SRC_ROOT" widget-push WIDGET="$r" WIDGETS_SRC="$SRC_ROOT/widgets-src" BOX="$BOXX" || { echo "stable prove: widget-push $r failed" >&2; rc=1; } ;;
        *) rest+=("$r") ;;
    esac
done
if (( ${#rest[@]} && rc == 0 )); then
    dirs=(); for r in "${rest[@]}"; do case "$r" in fsr_all_widgets) dirs+=("$SRC_ROOT") ;; esac; done
    (( ${#dirs[@]} )) && { $MAKE -C "$SRC_ROOT" doctor BOX="$BOXX" SANITY=1 STAMP="$(IFS=:; echo "${dirs[*]}")" CONN_REPO="$SRC_CONN" || { echo "stable prove: doctor SANITY failed" >&2; rc=1; }; }
fi
exit "$rc"
