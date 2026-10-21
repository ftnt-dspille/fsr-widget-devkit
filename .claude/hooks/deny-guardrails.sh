#!/usr/bin/env bash
# PreToolUse Bash guardrail. Denies commands that violate the hard "never" rules
# in CLAUDE.md (root + harness), as a backstop to the allowlists -- it must hold
# even when a broad allow rule (e.g. "make test-unit *") would auto-approve the
# call. Reads the hook payload on stdin and emits a PreToolUse deny decision with
# a one-line reason when a forbidden command matches.
#
# Rules match COMMANDS, not words. The command string is split into simple
# commands at shell separators (| ; & ( ) { } ` and newlines). From each one we
# strip leading VAR=value assignments and wrapper words (sudo env exec time nohup
# command xargs nice if then do ...), so the first remaining word is the program
# being run. A protected word that only appears as an argument does not match:
# `grep jest tests/x`, `/usr/bin/grep -r playwright .` and `make help | grep push`
# pass, while `pnpm exec playwright test`, `pnpm jest`, `make release-ship` and
# `bash -c "git stash"` are denied wherever they sit in the command.
#
# Fails CLOSED: if jq is missing or the payload cannot be parsed, the command is
# denied (the guard being inoperative must not silently allow everything).
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

# Set by check_one when a rule matches; the first match wins.
DENY=""

# Drop leading whitespace, VAR=value assignments and wrapper words.
strip_wrappers() {
  local s="$1" w
  s="${s#"${s%%[![:space:]]*}"}"
  while [ -n "$s" ]; do
    w="${s%%[[:space:]]*}"
    case "$w" in
      sudo|env|exec|time|nohup|command|xargs|nice|builtin|if|then|else|elif|do|while|until|'!') ;;
      [A-Za-z_]*=*) ;;
      *) break ;;
    esac
    s="${s#"$w"}"
    s="${s#"${s%%[![:space:]]*}"}"
  done
  printf '%s' "$s"
}

# Is this single-word token a make variable we must not let an agent override?
recipe_critical_assignment() {
  case "$1" in
    HARNESS=*|SHELL=*|MAKEFLAGS=*|MAKE=*|CONN_REPO=*) return 0 ;;
  esac
  return 1
}

check_make() {
  local -a w=("$@") j t
  local n=${#w[@]}
  # A make arg flows unquoted into recipe shell commands (e.g. WIDGET="$(WIDGET)"
  # pnpm test), so command substitution or backticks in a make command is injection.
  if printf '%s' "$cmd" | grep -Eq '(\$\(|\$\{|`)'; then
    DENY="guardrail: command substitution/backticks in a make command are not allowed (injection risk)."
    return
  fi
  for ((j = 1; j < n; j++)); do
    t="${w[$j]}"
    case "$t" in
      --file|--file=*|--makefile|--makefile=*|--directory|--directory=*|--eval|--eval=*|--old-file|--old-file=*|--assume-old|--assume-old=*)
        DENY="guardrail: 'make' with -f/-C/--eval/-o can run an arbitrary recipe; denying."
        return ;;
      --*) ;;
      -*[fCo]*)
        # Short-option cluster carrying -f, -C or -o (e.g. -f, -Bf, -oTARGET).
        DENY="guardrail: 'make' with -f/-C/--eval/-o can run an arbitrary recipe; denying."
        return ;;
      -*) ;;
      *=*)
        if recipe_critical_assignment "$t"; then
          DENY="guardrail: overriding a recipe-critical make variable can run arbitrary code; denying."
          return
        fi ;;
      release|release-*|push|push-*|widget-push|ship|ship-*)
        DENY="CLAUDE.md: release/ship/push make targets are the user's to run, never an agent's."
        return ;;
    esac
  done
}

check_git() {
  local -a w=("$@") i=1 sub="" t
  local n=${#w[@]}
  # Skip global options so "git -C x stash" / "git -c k=v rebase" cannot
  # smuggle the subcommand past the check.
  while [ "$i" -lt "$n" ]; do
    case "${w[$i]}" in
      -C|-c|--git-dir|--work-tree|--namespace) i=$((i + 2)) ;;
      -*) i=$((i + 1)) ;;
      *) sub="${w[$i]}"; break ;;
    esac
  done
  case "$sub" in
    stash)
      DENY="CLAUDE.md: never 'git stash' over shared checkouts (they hold other people's WIP). Use 'git worktree add'."
      return ;;
    rebase)
      DENY="CLAUDE.md: never 'git rebase' over shared checkouts. Use 'git worktree add'."
      return ;;
  esac
  # Never bypass the pre-commit hook (--no-verify, or -n on commit).
  for ((i = 1; i < n; i++)); do
    t="${w[$i]}"
    if [ "$t" = "--no-verify" ]; then
      DENY="CLAUDE.md: never use --no-verify; the pre-commit hook must run."
      return
    fi
    if [ "$sub" = commit ] && [ "$t" = "-n" ]; then
      DENY="CLAUDE.md: never bypass the pre-commit hook ('git commit -n' == --no-verify)."
      return
    fi
  done
}

check_runner() {   # "$@" = the words of a simple command launched by npx/pnpm/yarn/npm/bunx
  local -a w=("$@") j t
  local n=${#w[@]}
  # Any argument naming the test runner counts: options may take a value
  # (`pnpm --dir x exec jest`), so the launched word is not always the first.
  for ((j = 1; j < n; j++)); do
    t="${w[$j]}"
    case "$t" in
      @playwright/*)
        DENY="CLAUDE.md: never run Playwright directly; use 'make test-e2e-spec'."
        return ;;
    esac
    case "${t##*/}" in
      playwright)
        DENY="CLAUDE.md: never run Playwright directly; use 'make test-e2e-spec'."
        return ;;
      jest)
        DENY="CLAUDE.md: never run jest directly; use 'make test-unit'."
        return ;;
    esac
  done
}

# Check one simple command (already split at separators).
check_one() {
  local s base
  s="$(strip_wrappers "$1")"
  [ -n "$s" ] || return 0
  local -a w
  read -r -a w <<< "$s"
  base="${w[0]##*/}"
  case "$base" in
    playwright|jest)
      DENY="CLAUDE.md: never run Playwright/jest directly; use the make targets."
      return ;;
    make)
      check_make "${w[@]}"
      return ;;
    git)
      check_git "${w[@]}"
      return ;;
    node)
      if [ "${#w[@]}" -gt 1 ]; then
        case "${w[1]}" in
          *node_modules/.bin/playwright|*node_modules/.bin/jest|*node_modules/jest/bin/jest.js)
            DENY="CLAUDE.md: never run Playwright/jest directly; use the make targets."
            return ;;
        esac
      fi
      return ;;
    bash|sh|zsh|dash|eval)
      # A shell (or eval) runs its quoted payload; check that payload as a command.
      local payload
      payload="$(printf '%s' "$s" | sed -E 's/^[^[:space:]]+[[:space:]]*//; s/^-[a-zA-Z]+[[:space:]]+//; s/["'\'']//g')"
      [ -n "$payload" ] && check_all "$payload" 1
      return ;;
    npx|pnpm|yarn|npm|bunx)
      check_runner "${w[@]}"
      return ;;
  esac
}

# Split a command string into simple commands and check each in turn.
check_all() {
  local c="$1" depth="$2" seg
  [ "$depth" -le 2 ] || return 0
  while IFS= read -r seg; do
    check_one "$seg"
    [ -z "$DENY" ] || return 0
  done <<< "$(printf '%s\n' "$c" | sed -E 's/[|;&(){}`]+/\n/g')"
}

check_all "$cmd" 0
[ -z "$DENY" ] || deny "$DENY"

exit 0
