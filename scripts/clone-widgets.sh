#!/usr/bin/env bash
#
# clone-widgets.sh — populate widgets-src/ from widgets.manifest.
#
# Each manifest entry is cloned into widgets-src/<name> as an INDEPENDENT repo
# (not a submodule). Re-running is safe: an existing clone is fetched + fast-
# forwarded to the manifest branch instead of re-cloned. A widget you've edited
# (dirty working tree) is left untouched with a warning.
#
# Usage:
#   scripts/clone-widgets.sh                 # all manifest entries
#   scripts/clone-widgets.sh fsrSocAssistant # just one
#
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MANIFEST="$REPO_DIR/widgets.manifest"
DEST_ROOT="$REPO_DIR/widgets-src"
ONLY="${1:-}"

[ -f "$MANIFEST" ] || { echo "ERROR: no widgets.manifest at $MANIFEST" >&2; exit 1; }
mkdir -p "$DEST_ROOT"

say()  { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m✓ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$*"; }

found=0
# Strip comments/blank lines, then read name/url/branch.
while read -r name url branch _rest; do
  [ -z "${name:-}" ] && continue
  case "$name" in \#*) continue ;; esac
  [ -n "$ONLY" ] && [ "$ONLY" != "$name" ] && continue
  found=1

  dest="$DEST_ROOT/$name"
  if [ -d "$dest/.git" ]; then
    if [ -n "$(git -C "$dest" status --porcelain)" ]; then
      warn "$name: local changes present — leaving as-is (commit/stash, then re-run)"
      continue
    fi
    say "$name: updating ($url)"
    git -C "$dest" fetch --quiet origin
    if [ -n "${branch:-}" ]; then
      git -C "$dest" checkout --quiet "$branch"
      git -C "$dest" merge --ff-only --quiet "origin/$branch" 2>/dev/null \
        || warn "$name: could not fast-forward to origin/$branch (diverged?)"
    fi
    ok "$name updated"
  else
    say "$name: cloning ($url)"
    if [ -n "${branch:-}" ]; then
      git clone --quiet --branch "$branch" "$url" "$dest" \
        || { warn "$name: clone failed (auth? branch '$branch' missing?)"; continue; }
    else
      git clone --quiet "$url" "$dest" \
        || { warn "$name: clone failed (auth?)"; continue; }
    fi
    ok "$name cloned → widgets-src/$name"
  fi
done < "$MANIFEST"

[ "$found" = 1 ] || { warn "no matching manifest entry${ONLY:+ for '$ONLY'}"; exit 1; }
ok "widgets-src/ is up to date"
