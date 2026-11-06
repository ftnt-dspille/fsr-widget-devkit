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

# Two throwaway repos for the cwd-sensitive git merge rule: "cwd=@MAIN" (on main)
# and "cwd=@FEAT" (on a feature branch). @MAIN/@FEAT in a command expand too.
# Plumbing only (commit-tree), so no hook runs.
fx="$(mktemp -d)"; trap 'rm -rf "$fx"' EXIT
for r in main feat; do
  git -c init.defaultBranch=main init -q "$fx/$r"
  c="$(GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.com GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.com \
    git -C "$fx/$r" commit-tree "$(git -C "$fx/$r" mktree </dev/null)" -m base)"
  git -C "$fx/$r" update-ref refs/heads/main "$c"
done
git -C "$fx/feat" checkout -q -b feat/x

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
  cwd=""
  case "$cmd" in cwd=*) cwd="${cmd%% *}"; cwd="${cwd#cwd=}"; cmd="${cmd#* }" ;; esac
  cwd="${cwd//@MAIN/$fx/main}"; cwd="${cwd//@FEAT/$fx/feat}"
  case "$cmd" in *'\n'*) cmd="$(printf '%b' "$cmd")" ;; esac   # \n = newline (heredoc cases)
  cmd="${cmd//@MAIN/$fx/main}"; cmd="${cmd//@FEAT/$fx/feat}"
  out="$(jq -n --arg c "$cmd" --arg m "$mode" --arg d "$cwd" \
    '{tool_input: {command: $c}} + (if $m == "" then {} else {permission_mode: $m} end) + (if $d == "" then {} else {cwd: $d} end)' \
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
