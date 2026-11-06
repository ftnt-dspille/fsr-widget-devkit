#!/usr/bin/env bash
# Point each given repo (default: this repo + every widgets-src/* repo) at
# scripts/githooks via a repo-local core.hooksPath. The shims there chain to the
# global hooks, so the en/em-dash pre-commit keeps running. Run by make setup.
# Usage: scripts/install-git-hooks.sh [repo ...]
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
hooks="$root/scripts/githooks"
# A worktree of this repo is not the stable path; prefer the main checkout.
common="$(cd "$root" && cd "$(git rev-parse --git-common-dir)" && pwd)"
[ "$(basename "$common")" = .git ] && [ -d "$(dirname "$common")/scripts/githooks" ] && hooks="$(dirname "$common")/scripts/githooks"
if [ "$#" -eq 0 ]; then set -- "$root"; for d in "$root"/widgets-src/*/; do [ -e "$d/.git" ] && set -- "$@" "${d%/}"; done; fi
for r in "$@"; do
  git -C "$r" config core.hooksPath "$hooks" && echo "git hooks: $r -> $hooks"
done
