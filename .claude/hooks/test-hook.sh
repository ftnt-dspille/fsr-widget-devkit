#!/usr/bin/env bash
# Runs every case in cases.txt through deny-guardrails.sh. Each line is
# "allow <command>" or "deny <command>". Exit 1 if any case disagrees.
# Needs jq, as the hook does (no jq means every case is denied).
set -uo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
pass=0
fail=0
while IFS= read -r line; do
  case "$line" in ''|\#*) continue ;; esac
  want="${line%% *}"
  cmd="${line#* }"
  out="$(jq -n --arg c "$cmd" '{tool_input: {command: $c}}' | bash "$here/deny-guardrails.sh")"
  got=allow
  case "$out" in *'"permissionDecision":"deny"'*) got=deny ;; esac
  if [ "$got" = "$want" ]; then
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
    echo "FAIL want=$want got=$got: $cmd"
  fi
done < "$here/cases.txt"
echo "hook cases: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
