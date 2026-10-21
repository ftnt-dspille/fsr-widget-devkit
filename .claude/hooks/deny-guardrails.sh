#!/usr/bin/env bash
# PreToolUse Bash hook. A thin TRIPWIRE, not the enforcement. It does two things:
#
#   1. Git rules that have no effect-level home: `git stash`, `git rebase`, and
#      --no-verify, `commit -n` or a core.hooksPath override that skips the
#      pre-commit hook (CLAUDE.md: never bypass it).
#   2. ADVISORY messages for the test runners and deploy targets. They duplicate
#      the effect-level guards, so a miss here costs nothing:
#        - bare jest / playwright (directly, via npx/pnpm/yarn/npm/bunx, or as a
#          node_modules/.bin path)
#        - make release, push, widget-push, ship-verify (and release-*, push-*)
#
# The real enforcement runs AFTER the shell has interpreted the command, so
# quoting, wrappers or eval cannot fool it:
#   - Makefile deploy-guard (CLAUDECODE + CONFIRM_DEPLOY) on the deploy targets
#   - VIA_MAKE=1, checked by the jest globalSetup and playwright.config.ts
#   - the same CLAUDECODE + CONFIRM_DEPLOY check at the top of the deploy scripts
#     and in widget.ts push/ship
# TESTING.md, "Guardrails", has the full model. Cases: cases.txt (test-hook.sh).
#
# Matching is by plain words, one simple command at a time (split on | ; & ( ) { }
# backticks and newlines). Quotes are not stripped, so `bash -c "git stash"` is not
# seen here. The git rules catch honest slips, not a determined bypass.
#
# Fails CLOSED: if jq is missing or the payload does not parse, the command is denied.
set -uo pipefail

deny() {
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":%s}}\n' \
    "$(printf '%s' "$1" | jq -R -s '.' 2>/dev/null || printf '"blocked by guardrail"')"
  exit 0
}

command -v jq >/dev/null 2>&1 || deny "guardrail inoperative: jq not found. Install jq or review this command manually."

payload="$(cat)"
cmd="$(printf '%s' "$payload" | jq -r '.tool_input.command // empty' 2>/dev/null)" \
  || deny "guardrail could not parse the tool payload; denying to fail closed."

# Nothing to inspect -> allow (e.g. a non-Bash call routed here).
[ -n "$cmd" ] || exit 0

DENY=""

# Git: the first word whose basename is git, then its subcommand after global options.
check_git() {
  local -a w
  local n i k sub="" t
  read -r -a w <<< "$1"
  n=${#w[@]}
  for ((k = 0; k < n; k++)); do [ "${w[$k]##*/}" = git ] && break; done
  [ "$k" -lt "$n" ] || return 0
  i=$((k + 1))
  while [ "$i" -lt "$n" ]; do
    case "${w[$i]}" in
      -C|-c|--git-dir|--work-tree|--namespace) i=$((i + 2)) ;;
      -*) i=$((i + 1)) ;;
      *) sub="${w[$i]}"; break ;;
    esac
  done
  case "$sub" in
    stash) DENY="CLAUDE.md: never 'git stash' over shared checkouts (they hold other people's WIP). Use 'git worktree add'."; return 0 ;;
    rebase) DENY="CLAUDE.md: never 'git rebase' over shared checkouts. Use 'git worktree add'."; return 0 ;;
  esac
  for ((i = k + 1; i < n; i++)); do
    t="${w[$i]}"
    if [ "$t" = --no-verify ] || { [ "$sub" = commit ] && [ "$t" = -n ]; }; then
      DENY="CLAUDE.md: never bypass the pre-commit hook (--no-verify, or commit -n)."; return 0
    fi
    case "$t" in
      core.hooksPath=*) DENY="CLAUDE.md: never override core.hooksPath; the pre-commit hook must run."; return 0 ;;
    esac
  done
}

# Advisory: the program is the first word after VAR=value assignments.
check_tools() {
  local -a w
  local n i j t prog
  read -r -a w <<< "$1"
  n=${#w[@]}
  i=0
  while [ "$i" -lt "$n" ]; do
    case "${w[$i]}" in [A-Za-z_]*=*) i=$((i + 1)) ;; *) break ;; esac
  done
  [ "$i" -lt "$n" ] || return 0
  prog="${w[$i]##*/}"
  case "$prog" in
    jest|playwright)
      DENY="advisory: CLAUDE.md: never run jest or Playwright directly. Use make test-unit or make test-e2e-spec."; return 0 ;;
    npx|pnpm|yarn|npm|bunx)
      for ((j = i + 1; j < n; j++)); do
        t="${w[$j]}"
        case "$t" in @playwright/*) DENY="advisory: CLAUDE.md: never run Playwright directly. Use make test-e2e-spec."; return 0 ;; esac
        case "${t##*/}" in
          jest|playwright) DENY="advisory: CLAUDE.md: never run jest or Playwright directly. Use make test-unit or make test-e2e-spec."; return 0 ;;
        esac
      done ;;
    make)
      for ((j = i + 1; j < n; j++)); do
        case "${w[$j]}" in
          release|release-*|push|push-*|widget-push|ship-verify)
            DENY="advisory: CLAUDE.md: make ${w[$j]} is a deploy or release, the user's to run. The Makefile refuses it under Claude Code."
            return 0 ;;
        esac
      done ;;
  esac
}

while IFS= read -r seg; do
  check_git "$seg"; [ -n "$DENY" ] && break
  check_tools "$seg"; [ -n "$DENY" ] && break
done <<< "$(printf '%s\n' "$cmd" | tr '|;&(){}`' '\n')"

[ -z "$DENY" ] || deny "$DENY"
exit 0
