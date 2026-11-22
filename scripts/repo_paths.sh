#!/usr/bin/env bash
# The ONE place the connector and framework repo locations are decided for this
# repo (Makefile, live-sanity, push, the widget harness sidecar, the agreement
# check). Nothing else carries a `PycharmProjects/...` default.
#
#   bash scripts/repo_paths.sh conn        # connector repo root   (CONN_REPO)
#   bash scripts/repo_paths.sh framework   # framework repo root   (FSR_FRAMEWORK_REPO)
#
#   bash scripts/repo_paths.sh root        # this repo's shared checkout (or $AGENT_TREE/root)
#   bash scripts/repo_paths.sh agenticAssistant | agenticAssistantMonitor   # a widget repo
#   bash scripts/repo_paths.sh resolve <name>   # caller-aware: a name (framework, connector,
#                                               # root, agenticAssistant, agenticAssistantMonitor)
#                                               # -> the path of the tree the caller is in; exit 3
#                                               # with a message when that is ambiguous
#
# Precedence, per name: the explicit env var, then FSR_MONOREPO (<mono>/connector
# and <mono>/framework once the two repos are one), then today's sibling clones.
set -u
what="${1:-}"
_here="${FSR_TOOL_HOME:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
_shared_root() {  # the shared root checkout, even when this script runs from a worktree of it
  local c; c="$(cd "$_here" && git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" || return 1
  dirname "$c"
}
_common() { git -C "$1" rev-parse --path-format=absolute --git-common-dir 2>/dev/null; }
_resolve() {  # _resolve <name>
  local n="$1" key shared top gd cd_ env=""
  case "$n" in
    framework) key=framework; env="${FSR_FRAMEWORK_REPO:-}" ;;
    connector|conn|conn_main) key=conn; env="${CONN_REPO:-}" ;;
    root|fsr_all_widgets) key=root ;;
    agenticAssistant|agenticAssistantMonitor) key="$n" ;;
    *) echo "repo_paths: unknown repo name '$n' (framework, connector, root, agenticAssistant, agenticAssistantMonitor)" >&2; return 2 ;;
  esac
  # An agent tree is the caller's declared tree: its copy, always.
  if [ -n "${AGENT_TREE:-}" ]; then
    case "$key" in
      root) printf '%s\n' "$AGENT_TREE/root" ;;
      agenticAssistant*) printf '%s\n' "$AGENT_TREE/root/widgets-src/$key" ;;
      *) bash "${BASH_SOURCE[0]}" "$key" ;;
    esac
    return 0
  fi
  [ -n "$env" ] && { printf '%s\n' "$env"; return 0; }   # an explicit env var is unambiguous
  shared="$(bash "${BASH_SOURCE[0]}" "$key")"
  top="$(git rev-parse --show-toplevel 2>/dev/null || true)"
  gd="$(git rev-parse --path-format=absolute --git-dir 2>/dev/null || true)"
  cd_="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
  # Not inside a linked worktree: the shared checkout is the only candidate.
  if [ -z "$top" ] || [ "$gd" = "$cd_" ]; then printf '%s\n' "$shared"; return 0; fi
  # Inside a linked worktree: use it only when it is a worktree of the asked-for repo.
  if [ "$key" = root ] || [ "$key" = conn ] || [ "$key" = framework ]; then
    if [ "$(_common "$shared")" = "$cd_" ]; then printf '%s\n' "$top"; return 0; fi
  elif [ -e "$top/widgets-src/$key/.git" ]; then printf '%s\n' "$top/widgets-src/$key"; return 0
  fi
  echo "repo_paths: you are inside the worktree $top, which is not a worktree of '$n', so '$n' could be the shared checkout ($shared) or a copy you made. Pass the path: REPO=<path>" >&2
  return 3
}
case "$what" in
  resolve) _resolve "${2:-}"; exit $? ;;
  root)
    if [ -n "${AGENT_TREE:-}" ]; then printf '%s\n' "$AGENT_TREE/root"
    elif [ -n "${FSR_MONOREPO:-}" ]; then printf '%s\n' "$FSR_MONOREPO"
    else _shared_root || { echo "repo_paths: cannot find the root repo" >&2; exit 2; }; fi ;;
  agenticAssistant|agenticAssistantMonitor)
    r="$(bash "${BASH_SOURCE[0]}" root)" || exit 2; printf '%s\n' "$r/widgets-src/$what" ;;
  conn)
    if [ -n "${CONN_REPO:-}" ]; then printf '%s\n' "$CONN_REPO"
    elif [ -n "${FSR_MONOREPO:-}" ]; then printf '%s\n' "$FSR_MONOREPO/connector"
    else printf '%s\n' "$HOME/PycharmProjects/ConnectorsV2/conn_main"; fi ;;
  framework)
    if [ -n "${FSR_FRAMEWORK_REPO:-}" ]; then printf '%s\n' "$FSR_FRAMEWORK_REPO"
    elif [ -n "${FSR_MONOREPO:-}" ]; then printf '%s\n' "$FSR_MONOREPO/framework"
    else printf '%s\n' "$HOME/PycharmProjects/fsr-playbook-framework"; fi ;;
  *) echo "usage: repo_paths.sh conn|framework|root|agenticAssistant|agenticAssistantMonitor|resolve <name>" >&2; exit 2 ;;
esac
