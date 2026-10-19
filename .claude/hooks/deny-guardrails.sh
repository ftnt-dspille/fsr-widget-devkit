#!/usr/bin/env bash
# PreToolUse Bash guardrail. Denies commands that violate the hard "never" rules
# in CLAUDE.md (root + harness), as a backstop to the allowlists -- it must hold
# even when a broad allow rule (e.g. "make test-unit *") would auto-approve the
# call. Reads the hook payload on stdin and emits a PreToolUse deny decision with
# a one-line reason when a forbidden pattern matches.
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

m() { printf '%s' "$cmd" | grep -Eq "$1"; }

# --- git: normalise away global options so "git -C x stash" / "git -c k=v rebase"
#     cannot smuggle the subcommand past the check.
# (uses (^|[[:space:]]) rather than \b: BSD/macOS sed has no \b)
gitnorm="$(printf '%s' "$cmd" | sed -E 's/(^|[[:space:]])git[[:space:]]+((-C[[:space:]]+[^[:space:]]+|-c[[:space:]]+[^[:space:]]+|--git-dir[=[:space:]][^[:space:]]+|--work-tree[=[:space:]][^[:space:]]+|--namespace[=[:space:]][^[:space:]]+|--no-pager|--paginate|--bare|-p)[[:space:]]+)+/\1git /g')"
gm() { printf '%s' "$gitnorm" | grep -Eq "$1"; }

# Shared-checkout protection: never stash/pop/rebase over other people's WIP.
gm '(^|[;&|[:space:]])git[[:space:]]+stash([[:space:]]|$)' \
  && deny "CLAUDE.md: never 'git stash' over shared checkouts (they hold other people's WIP). Use 'git worktree add'."
gm '(^|[;&|[:space:]])git[[:space:]]+rebase([[:space:]]|$)' \
  && deny "CLAUDE.md: never 'git rebase' over shared checkouts. Use 'git worktree add'."

# Never bypass the pre-commit hook (--no-verify, or its -n shorthand on commit).
m '(^|[[:space:]])--no-verify([[:space:]]|$)' \
  && deny "CLAUDE.md: never use --no-verify; the pre-commit hook must run."
if gm 'git[[:space:]]+commit([[:space:]]|$)'; then
  m '(^|[[:space:]])-n([[:space:]]|$)' \
    && deny "CLAUDE.md: never bypass the pre-commit hook ('git commit -n' == --no-verify)."
fi

# --- make: agents never release/ship/push, and must not smuggle an alternate
#     Makefile, directory, eval, or recipe-critical variable override.
if m '(^|[;&|[:space:]])make([[:space:]]|$)'; then
  # A make arg flows unquoted into recipe shell commands (e.g. WIDGET="$(WIDGET)"
  # pnpm test), so command substitution or backticks in a make arg is injection.
  m '(\$\(|\$\{|`)' \
    && deny "guardrail: command substitution/backticks in a make command are not allowed (injection risk)."
  m '(^|[[:space:]])(release|release-ship|push|widget-push|ship-verify|ship)([[:space:]]|$)' \
    && deny "CLAUDE.md: release/ship/push make targets are the user's to run, never an agent's."
  m '(^|[[:space:]])make[[:space:]].*(^|[[:space:]])(-f|--file|-C|--directory|--eval|-o|--old-file)([[:space:]]|=)' \
    && deny "guardrail: 'make' with -f/-C/--eval/-o can run an arbitrary recipe; denying."
  m '(^|[[:space:]])make[[:space:]].*(^|[[:space:]])(HARNESS|SHELL|MAKEFLAGS|MAKE|CONN_REPO)=' \
    && deny "guardrail: overriding a recipe-critical make variable can run arbitrary code; denying."
fi

# --- test runners: never run Playwright/jest directly. Cover every launcher:
#     npx, pnpm (exec), yarn, npm run/exec, node_modules/.bin, and a bare call.
m '(^|[;&|[:space:]])(npx|pnpm|yarn)([[:space:]]+(exec|dlx|run))?[[:space:]]+(@[^[:space:]]*/)?playwright([[:space:]]|$|[/@])' \
  && deny "CLAUDE.md: never run Playwright directly; use 'make test-e2e-spec'."
m '(^|[;&|[:space:]])(npx|pnpm|yarn)([[:space:]]+(exec|dlx|run))?[[:space:]]+(@[^[:space:]]*/)?jest([[:space:]]|$|[/@])' \
  && deny "CLAUDE.md: never run jest directly; use 'make test-unit'."
m 'npm[[:space:]]+(run|exec)[[:space:]].*(playwright|jest)' \
  && deny "CLAUDE.md: never run Playwright/jest directly; use the make targets."
m 'node_modules/\.bin/(playwright|jest)([[:space:]]|$)' \
  && deny "CLAUDE.md: never run Playwright/jest directly; use the make targets."
m '(^|[;&|[:space:]])(playwright|jest)([[:space:]]|$)' \
  && deny "CLAUDE.md: never run Playwright/jest directly; use the make targets."

exit 0
