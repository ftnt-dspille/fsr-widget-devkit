#!/usr/bin/env bash
# PreToolUse Bash hook. A thin TRIPWIRE, not the enforcement. It does two things:
#
#   1. Git rules: `git push` (the user pushes), `git merge` while on main (use
#      make promote; scripts/githooks/reference-transaction is the enforcement), and rules with no effect-level home: `git stash`, `git rebase`, and
#      --no-verify, `commit -n` or a core.hooksPath override that skips the
#      pre-commit hook (CLAUDE.md: never bypass it).
#   2. Direct deploy/install scripts (deploy.sh, deploy_chain.sh, install_to_fsr.py,
#      ship_dev.sh, dev_push.sh, ship.sh, widget.js push/ship, scp, rsync host:):
#      agents use the make front doors. The scripts' own CLAUDECODE checks enforce.
#   3. ADVISORY messages for the test runners and deploy targets. They duplicate
#      the effect-level guards, so a miss here costs nothing:
#        - bare jest / playwright (directly, via npx/pnpm/yarn/npm/bunx, or as a
#          node_modules/.bin path)
#        - make release, push, ship-verify (and release-*, push-*): the
#          GitHub/PyPI release path. Box-only deploys (widget-push, loop) are
#          agent-allowed and NOT flagged.
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
# backticks and newlines), after heredoc bodies and quoted-string contents are
# dropped (strip_text), so `bash -c "git stash"` is not seen here. The git rules catch honest slips, not a determined bypass.
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

CWD="$(printf '%s' "$payload" | jq -r '.cwd // empty' 2>/dev/null)"
PROMOTE="Use: make promote REPO=<repo> BRANCH=<branch> (needs a VERIFIED live-sanity stamp)."
FRONT="Agent front doors: make loop, make widget-push WIDGET= SHIP_ENV=, make deploy BOX= (connector), make test-unit, make test-e2e-spec, make doctor, make promote."
DENY=""
DEPLOY_TARGET=""   # set to a GitHub/PyPI release target name when one is seen

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
    push) DENY="CLAUDE.md: agents never git push; the user pushes. To land a branch on local main: $PROMOTE"; return 0 ;;
    merge)
      local dir="$CWD" b
      for ((i = k + 1; i < n; i++)); do [ "${w[$i]}" = -C ] && dir="${w[$((i + 1))]}"; done
      b="$(git -C "${dir:-.}" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
      case "$b" in main|master) DENY="CLAUDE.md: never merge into $b by hand. $PROMOTE"; return 0 ;; esac ;;
    update-ref)
      for ((i = k + 2; i < n; i++)); do case "${w[$i]}" in main|refs/heads/main|master|refs/heads/master) DENY="Never move main by hand. $PROMOTE"; return 0 ;; esac; done ;;
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
  # Deploy/install scripts: run directly or through an interpreter.
  local s="$i"
  while [ "$s" -lt "$n" ]; do
    case "${w[$s]##*/}" in
      bash|sh|zsh|python|python3|node|source|.|uv|exec|env|run|-*) s=$((s + 1)) ;;
      *) break ;;
    esac
  done
  case "${w[$s]##*/}" in
    deploy.sh|deploy_chain.sh|install_to_fsr.py|ship_dev.sh|dev_push.sh|dev_push_deps.sh|ship.sh|release.sh|push.sh|soar-add-theme.sh)
      DENY="Never run deploy/install scripts directly. $FRONT"; return 0 ;;
    widget.js|widget.ts)
      case "${w[$((s + 1))]:-}" in push|ship) DENY="Never run widget.js push/ship directly. $FRONT"; return 0 ;; esac ;;
  esac
  case "$prog" in
    scp) DENY="Never copy to a box by hand. $FRONT"; return 0 ;;
    rsync)
      for ((j = i + 1; j < n; j++)); do
        case "${w[$j]}" in /*|./*|-*) ;; *:*) DENY="Never rsync to a box by hand. $FRONT"; return 0 ;; esac
      done ;;
  esac
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
          release|release-*|push|push-*|ship-verify)
            # The GitHub/PyPI release path -- the user's to run (CLAUDE.md).
            # Box-only dev deploys (widget-push, loop) are NOT here: agents own
            # direct-to-box work, so they are allowed.
            DEPLOY_TARGET="${w[$j]}"
            return 0 ;;
        esac
      done ;;
  esac
}

# Text is not a command: drop heredoc bodies and the contents of quoted strings
# before splitting, so a heredoc or -m message that MENTIONS a target or a tool
# is not read as running it. (Consequence: bash -c "..." is not inspected; the
# effect-level guards still hold.) Needs perl; without it, scan the raw text.
strip_text() {
  if ! command -v perl >/dev/null 2>&1; then cat; return; fi
  perl -e '
    my @end; my $out = "";
    while (my $l = <STDIN>) {
      if (@end) { (my $t = $l) =~ s/^\t+//; chomp $t; shift @end if $t eq $end[0]; next; }
      while ($l =~ /<<-?\s*([\x27"]?)([A-Za-z_][A-Za-z0-9_]*)\1/g) { push @end, $2; }
      $l =~ s/\x27[^\x27]*\x27/\x27\x27/g;
      $l =~ s/"(?:[^"\\]|\\.)*"/""/g;
      $out .= $l;
    }
    print $out;'
}

while IFS= read -r seg; do
  check_git "$seg"; [ -n "$DENY" ] && break
  check_tools "$seg"; [ -n "$DENY" ] && break
done <<< "$(printf '%s\n' "$cmd" | strip_text | tr '|;&(){}`' '\n')"

[ -z "$DENY" ] || deny "$DENY"

# A GitHub/PyPI release target (release, push, ship-verify): the user's to run.
# Box-only dev deploys (widget-push, loop) never reach here. Hard-deny under
# Claude Code; a human overrides on the CLI with CONFIRM_DEPLOY=1.
if [ -n "$DEPLOY_TARGET" ]; then
  deny "advisory: CLAUDE.md: make $DEPLOY_TARGET is a GitHub/PyPI release, the user's to run (box-only deploys like widget-push and loop are agent-allowed). The Makefile refuses it under Claude Code."
fi
exit 0
