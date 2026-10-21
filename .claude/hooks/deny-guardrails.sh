#!/usr/bin/env bash
# PreToolUse Bash guardrail. Denies commands that violate the hard "never" rules
# in CLAUDE.md (root + harness), as a backstop to the allowlists -- it must hold
# even when a broad allow rule (e.g. "make test-unit *") would auto-approve the
# call. Reads the hook payload on stdin and emits a PreToolUse deny decision with
# a one-line reason when a forbidden command matches.
#
# This is a tripwire, not a sandbox: code that an interpreter writes or fetches
# at run time is opaque to it. Inline interpreter code (python -c, node -e, ...)
# and shell reading from stdin are therefore denied outright.
#
# How it matches. The command is normalised (quotes and backslashes removed),
# then split into simple commands at | ; & ( ) { } ` and newlines. From each one
# we strip leading VAR=value assignments and wrapper words (sudo, env, xargs,
# nice, timeout, ...). When a wrapper was stripped, every word of the command is
# checked, since option values make the launched program's position unknown.
# Otherwise the first word is the program. Plain arguments never match:
# `grep jest tests/x`, `/usr/bin/grep -r playwright .` and `make help | grep push`
# pass, while `pnpm exec playwright`, `pnpm jest`, `make release-ship`,
# `env -i pnpm jest` and `bash -c "git stash"` are denied.
#
# Fails CLOSED: if jq is missing or the payload cannot be parsed, the command is
# denied; and if the separator split fails its self-test, every command is denied.
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

# Globals: the checks set DENY (first match wins); strip_prefix sets WRAPPED and
# STRIPPED. Globals rather than $(...) so the values survive.
DENY=""
WRAPPED=0
STRIPPED=""
HOOK_DEPTH=0
MAX_DEPTH=3
RAW="$cmd"

# Programs whose arguments are programs too (checked at any word after a wrapper).
PROGRAMS=" make git npx pnpm yarn npm bunx node python python3 perl ruby php lua deno bun osascript bash sh zsh dash ksh fish csh tcsh ash busybox eval jest playwright "
SHELLS=" bash sh zsh dash ksh fish csh tcsh ash "
INTERPRETERS=" python python3 perl ruby php lua deno bun osascript "
RELEASE_SCRIPTS=" ship.sh release.sh push.sh dev_push.sh "
RECIPE_CRITICAL=" HARNESS SHELL MAKE MAKEFLAGS MAKEFILES MAKEOVERRIDES GNUMAKEFLAGS CONN_REPO BASH_ENV .SHELLFLAGS "

in_list() { case "$2" in *" $1 "*) return 0 ;; esac; return 1; }

# One simple command per line. tr maps every separator to a newline.
split_simple() { printf '%s\n' "$1" | tr '|;&(){}`' '\n'; }

# Fail closed if the split does not work (BSD/GNU differences, a broken tr).
selftest() {
  [ "$(split_simple 'a;b' | grep -c '')" = 2 ] || return 1
  [ "$(split_simple 'a|b&&c' | grep -c '')" = 4 ] || return 1
  return 0
}

# Remove quotes and backslashes so "pnpm" jest and bash -c "x" match plainly.
normalize() {
  local s="$1"
  s="${s//\"/}"
  s="${s//\'/}"
  s="${s//\\/}"
  printf '%s' "$s"
}

# Remove leading assignments and wrapper words, into STRIPPED. Sets WRAPPED=1
# when a wrapper word was removed. A recipe-critical assignment denies.
strip_prefix() {
  local s="$1" w name
  WRAPPED=0
  STRIPPED=""
  s="${s#"${s%%[![:space:]]*}"}"
  while [ -n "$s" ]; do
    w="${s%%[[:space:]]*}"
    case "$w" in
      [A-Za-z_]*=*)
        name="${w%%=*}"
        if in_list "$name" "$RECIPE_CRITICAL"; then
          DENY="guardrail: overriding a recipe-critical make variable ($name) can run arbitrary code; denying."
          STRIPPED=""
          return 0
        fi ;;
      sudo|env|exec|time|nohup|command|builtin|xargs|nice|timeout|stdbuf|ionice|setsid|caffeinate|unbuffer|busybox|if|then|else|elif|do|while|until|'!')
        WRAPPED=1 ;;
      *) break ;;
    esac
    s="${s#"$w"}"
    s="${s#"${s%%[![:space:]]*}"}"
  done
  STRIPPED="$s"
}

check_make() {
  local -a w=("$@")
  local n=${#w[@]} j t name target
  # A make arg flows unquoted into recipe shell commands (e.g. WIDGET="$(WIDGET)"
  # pnpm test), so command substitution or backticks in a make command is injection.
  if printf '%s' "$RAW" | grep -Eq '(\$\(|\$\{|`)'; then
    DENY="guardrail: command substitution/backticks in a make command are not allowed (injection risk)."
    return 0
  fi
  local prev=""
  for ((j = 1; j < n; j++)); do
    t="${w[$j]}"
    # Quote-stripping can split "VAR =value" style args: an operator word whose
    # PREVIOUS word is a critical or dotted name is still an override.
    case "$t" in
      =*|:=*|+=*|?=*|!=*)
        if in_list "$prev" "$RECIPE_CRITICAL" || case "$prev" in .*) true ;; *) false ;; esac; then
          DENY="guardrail: overriding a recipe-critical make variable ($prev) can run arbitrary code; denying."
          return 0
        fi ;;
    esac
    prev="$t"
    case "$t" in
      --*)
        # GNU make accepts unique prefixes of long options (--fil=, --ev=).
        name="${t#--}"
        name="${name%%=*}"
        [ -n "$name" ] || continue
        for target in file makefile directory eval old-file assume-old; do
          case "$target" in
            "$name"*)
              DENY="guardrail: 'make' with -f/-C/--eval/-o (or an abbreviation of them) can run an arbitrary recipe; denying."
              return 0 ;;
          esac
        done ;;
      -*[fCoE]*)
        # Short-option cluster carrying -f, -C, -o or -E (e.g. -f, -Bf, -oTARGET).
        DENY="guardrail: 'make' with -f/-C/-o/-E can run an arbitrary recipe; denying."
        return 0 ;;
      -*) ;;
      *=*)
        name="${t%%=*}"
        # VAR!=cmd runs a shell command at assignment time.
        case "$name" in
          *!)
            DENY="guardrail: a make '!=' assignment runs a shell command; denying."
            return 0 ;;
        esac
        # Strip assignment-operator remnants (VAR:=x, VAR+=x, VAR?=x).
        name="${name%%[:+?]*}"
        # Dotted make variables (.SHELLFLAGS, .ONESHELL, ...) steer recipes.
        case "$name" in
          .*)
            DENY="guardrail: overriding a dotted make variable ($name) can run arbitrary code; denying."
            return 0 ;;
        esac
        if in_list "$name" "$RECIPE_CRITICAL"; then
          DENY="guardrail: overriding a recipe-critical make variable ($name) can run arbitrary code; denying."
          return 0
        fi ;;
      release|release-*|push|push-*|widget-push|ship|ship-*)
        DENY="CLAUDE.md: release/ship/push make targets are the user's to run, never an agent's."
        return 0 ;;
    esac
  done
}

check_git() {
  local -a w=("$@")
  local i=1 sub="" t n=${#w[@]}
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
      return 0 ;;
    rebase)
      DENY="CLAUDE.md: never 'git rebase' over shared checkouts. Use 'git worktree add'."
      return 0 ;;
  esac
  # Never bypass the pre-commit hook (--no-verify, or -n on commit).
  for ((i = 1; i < n; i++)); do
    t="${w[$i]}"
    if [ "$t" = "--no-verify" ]; then
      DENY="CLAUDE.md: never use --no-verify; the pre-commit hook must run."
      return 0
    fi
    if [ "$sub" = commit ] && [ "$t" = "-n" ]; then
      DENY="CLAUDE.md: never bypass the pre-commit hook ('git commit -n' == --no-verify)."
      return 0
    fi
  done
}

# Package runners: any argument naming the test runner counts, since options may
# take a value (`pnpm --dir x exec jest`).
check_runner() {
  local -a w=("$@")
  local j t n=${#w[@]}
  for ((j = 1; j < n; j++)); do
    t="${w[$j]}"
    case "$t" in
      @playwright/*)
        DENY="CLAUDE.md: never run Playwright directly; use 'make test-e2e-spec'."
        return 0 ;;
    esac
    case "${t##*/}" in
      playwright)
        DENY="CLAUDE.md: never run Playwright directly; use 'make test-e2e-spec'."
        return 0 ;;
      jest)
        DENY="CLAUDE.md: never run jest directly; use 'make test-unit'."
        return 0 ;;
    esac
  done
}

check_node() {
  local -a w=("$@")
  local j t n=${#w[@]}
  for ((j = 1; j < n; j++)); do
    t="${w[$j]}"
    case "$t" in
      *node_modules/.bin/playwright|*node_modules/.bin/jest|*node_modules/jest/bin/jest.js|*node_modules/playwright/*)
        DENY="CLAUDE.md: never run Playwright/jest directly; use the make targets."
        return 0 ;;
    esac
  done
}

# Inline code (-c, -e, -p, -r, --eval ...) can run anything: deny it outright.
# Also denied: stdin program text (no script argument, or "-"), data: URL
# modules, and loader hooks that execute code at import time.
check_inline() {
  local -a w=("$@")
  local j t n=${#w[@]} has_script=0
  for ((j = 1; j < n; j++)); do
    t="${w[$j]}"
    case "$t" in
      --)
        [ $((j + 1)) -lt "$n" ] && has_script=1
        break ;;
      --*)
        case "$t" in
          --eval|--eval=*|--print|--print=*|--exec|--exec=*|--import|--import=*|--loader|--loader=*|--experimental-loader|--experimental-loader=*|--require|--require=*|--init-command|--init-command=*)
            DENY="guardrail: inline interpreter code ($t) can run protected commands; write it to a file and run that. Denying."
            return 0 ;;
        esac ;;
      data:*)
        DENY="guardrail: a data: URL module can run protected commands; write it to a file and run that. Denying."
        return 0 ;;
      -|\<*|/dev/stdin|/dev/fd/*|/proc/self/fd/*)
        DENY="guardrail: an interpreter reading its program from stdin/a redirect cannot be checked; denying."
        return 0 ;;
      -*[ceEpr]*)
        DENY="guardrail: inline interpreter code ($t) can run protected commands; write it to a file and run that. Denying."
        return 0 ;;
      -*) ;;
      *) has_script=1 ;;
    esac
  done
  if [ "$has_script" = 0 ]; then
    DENY="guardrail: an interpreter with no script argument reads stdin and cannot be checked; denying."
  fi
}

# Shells: find the -c payload past any options (-x, -o pipefail, -lc ...).
check_shell() {
  local -a w=("$@")
  local n=${#w[@]} i=1 t has_c=0 script=""
  while [ "$i" -lt "$n" ]; do
    t="${w[$i]}"
    case "$t" in
      --) i=$((i + 1)); break ;;
      --*)
        # Fail closed: a long shell option we do not know (fish --init-command,
        # busybox variants) may carry code or shift the payload position.
        DENY="guardrail: unrecognized shell long option ($t); write the commands to a script and run that. Denying."
        return 0 ;;
      -o|+o|-O|+O) i=$((i + 2)) ;;
      -*[cC]*|+*[cC]*) has_c=1; i=$((i + 1)); break ;;
      -*|+*) i=$((i + 1)) ;;
      *) script="$t"; break ;;
    esac
  done
  if [ "$has_c" = 1 ]; then
    if [ "$i" -ge "$n" ]; then
      DENY="guardrail: cannot parse the shell -c payload; denying."
      return 0
    fi
    check_payload "${w[@]:$i}"
    return 0
  fi
  if [ -n "$script" ]; then
    in_list "${script##*/}" "$RELEASE_SCRIPTS" \
      && DENY="CLAUDE.md: release/ship/push scripts are the user's to run, never an agent's."
    return 0
  fi
  DENY="guardrail: a shell reading commands from stdin cannot be checked; denying."
}

# Re-check a payload (eval or a shell -c string) as more commands.
check_payload() {
  HOOK_DEPTH=$((HOOK_DEPTH + 1))
  if [ "$HOOK_DEPTH" -gt "$MAX_DEPTH" ]; then
    DENY="guardrail: command nesting too deep to check; denying."
  else
    check_all "$*"
  fi
  HOOK_DEPTH=$((HOOK_DEPTH - 1))
}

# Dispatch on the program at word 0 of one simple command.
check_words() {
  local -a w=("$@")
  local n=${#w[@]} base j k
  [ "$n" -gt 0 ] || return 0
  base="${w[0]##*/}"
  case "$base" in
    jest|playwright)
      DENY="CLAUDE.md: never run Playwright/jest directly; use the make targets."
      return 0 ;;
    make) check_make "${w[@]}" ;;
    git) check_git "${w[@]}" ;;
    npx|pnpm|yarn|npm|bunx) check_runner "${w[@]}" ;;
    node)
      check_node "${w[@]}"
      [ -n "$DENY" ] || check_inline "${w[@]}" ;;
    python|python3|perl|ruby|php|lua|osascript)
      check_inline "${w[@]}" ;;
    deno|bun)
      # Their eval/repl subcommands run inline or stdin code.
      for ((j = 1; j < n; j++)); do
        case "${w[$j]}" in
          -*) ;;
          eval|repl)
            DENY="guardrail: '$base ${w[$j]}' runs inline code; write it to a file and run that. Denying."
            return 0 ;;
          *) break ;;
        esac
      done
      check_inline "${w[@]}" ;;
    export|declare|typeset|readonly)
      # Exported recipe-critical vars poison later make/shell commands.
      for ((j = 1; j < n; j++)); do
        k="${w[$j]}"
        case "$k" in
          -*) continue ;;
          *=*) k="${k%%=*}" ;;
        esac
        k="${k%+}"
        if in_list "$k" "$RECIPE_CRITICAL"; then
          DENY="guardrail: exporting a recipe-critical variable ($k) can run arbitrary code later; denying."
          return 0
        fi
      done ;;
    printf|read)
      # printf -v NAME / read NAME can set a recipe-critical variable.
      for ((j = 1; j < n; j++)); do
        if in_list "${w[$j]}" "$RECIPE_CRITICAL"; then
          DENY="guardrail: assigning a recipe-critical variable (${w[$j]}) can run arbitrary code later; denying."
          return 0
        fi
      done ;;
    bash|sh|zsh|dash|ksh|fish|csh|tcsh|ash) check_shell "${w[@]}" ;;
    busybox)
      if [ "$n" -gt 1 ]; then check_words "${w[@]:1}"; fi ;;
    eval) check_payload "${w[@]:1}" ;;
  esac
  [ -n "$DENY" ] && return 0
  # Running a release/ship script directly is a deploy, whatever the launcher.
  if in_list "$base" "$RELEASE_SCRIPTS" || in_list "$base" "$SHELLS" || [ "$base" = node ]; then
    for ((k = 0; k < n; k++)); do
      if in_list "${w[$k]##*/}" "$RELEASE_SCRIPTS"; then
        DENY="CLAUDE.md: release/ship/push scripts are the user's to run, never an agent's."
        return 0
      fi
    done
  fi
  # widget.js / widget.ts ship|push|release are deploys.
  if [ "$base" = node ]; then
    for ((k = 0; k < n; k++)); do
      case "${w[$k]##*/}" in
        widget.js|widget.ts)
          for ((j = k + 1; j < n; j++)); do
            case "${w[$j]}" in
              ship|push|release)
                DENY="CLAUDE.md: widget ship/push/release is the user's to run, never an agent's."
                return 0 ;;
            esac
          done ;;
      esac
    done
  fi
}

check_one() {
  local seg="$1" b k n
  local -a w
  strip_prefix "$seg"
  [ -z "$DENY" ] || return 0
  [ -n "$STRIPPED" ] || return 0
  read -r -a w <<< "$STRIPPED"
  n=${#w[@]}
  if [ "$WRAPPED" = 1 ]; then
    # A wrapper's options and their values make the launched program's
    # position unknown, so every word is a candidate.
    for ((k = 0; k < n; k++)); do
      b="${w[$k]##*/}"
      case "$b" in
        jest|playwright)
          DENY="CLAUDE.md: never run Playwright/jest directly; use the make targets."
          return 0 ;;
      esac
      if in_list "$b" "$PROGRAMS"; then
        check_words "${w[@]:$k}"
        [ -z "$DENY" ] || return 0
      fi
    done
    return 0
  fi
  check_words "${w[@]}"
}

# Check every simple command in a string.
check_all() {
  local c="$1" seg
  while IFS= read -r seg; do
    check_one "$seg"
    [ -z "$DENY" ] || return 0
  done <<< "$(split_simple "$c")"
}

selftest || deny "guardrail self-test failed: command separators do not split; denying every command until the hook is fixed."

check_all "$(normalize "$cmd")"
[ -z "$DENY" ] || deny "$DENY"

exit 0
