#!/usr/bin/env bash
# Runs every case in cases.txt through deny-guardrails.sh. Each line is
#   "<want> [mode=<permission_mode>] <command>"
# where <want> is:
#   allow | deny | ask   -- the exact decision expected
#   win                  -- a deploy/release target in manual mode: expect `ask`
#                           while within the temporary window (today <=
#                           DEPLOY_ASK_UNTIL in deny-guardrails.sh), else `deny`.
#                           Implies mode=default; the harness sends it.
# Without mode=, the payload carries no permission_mode (treated as not-manual).
# Exit 1 if any case disagrees. Needs jq, as the hook does.
set -uo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Keep this in sync with DEPLOY_ASK_UNTIL in deny-guardrails.sh.
WIN_UNTIL="2026-10-26"
today="$(date +%Y-%m-%d)"
in_window=0
if [ "$today" \< "$WIN_UNTIL" ] || [ "$today" = "$WIN_UNTIL" ]; then in_window=1; fi

pass=0
fail=0
while IFS= read -r line; do
  case "$line" in ''|\#*) continue ;; esac
  want="${line%% *}"
  cmd="${line#* }"
  mode=""
  if [ "$want" = win ]; then
    mode="default"
    if [ "$in_window" = 1 ]; then want=ask; else want=deny; fi
  fi
  case "$cmd" in mode=*) mode="${cmd%% *}"; mode="${mode#mode=}"; cmd="${cmd#* }" ;; esac
  out="$(jq -n --arg c "$cmd" --arg m "$mode" \
    '{tool_input: {command: $c}} + (if $m == "" then {} else {permission_mode: $m} end)' \
    | bash "$here/deny-guardrails.sh")"
  got=allow
  case "$out" in
    *'"permissionDecision":"deny"'*) got=deny ;;
    *'"permissionDecision":"ask"'*) got=ask ;;
  esac
  if [ "$got" = "$want" ]; then
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
    echo "FAIL want=$want got=$got mode=${mode:-none}: $cmd"
  fi
done < "$here/cases.txt"
echo "hook cases: $pass passed, $fail failed (window $([ "$in_window" = 1 ] && echo OPEN || echo CLOSED) today=$today)"
[ "$fail" -eq 0 ]
