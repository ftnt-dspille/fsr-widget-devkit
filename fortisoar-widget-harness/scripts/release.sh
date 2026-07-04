#!/usr/bin/env bash
# release.sh — one-command GitHub release for ANY widget.
#
# Each widget under widgets-src/<id>/ is its own git repo with `origin` -> its
# GitHub fork and a .github/workflows/release.yml that publishes a .tgz when a
# push to `develop` changes widget/info.json. This script bumps info.json via
# the blessed harness CLI (never hand-edits the version — that would desync the
# controller name), commits the bump, and pushes develop to fire that workflow.
#
# Usage:
#   scripts/release.sh <widgetId> [patch|minor|major]   (default: patch)
#   make release WIDGET=<id> [BUMP=patch]               (parent-repo wrapper)
#
# Requirements:
#   A harness server must be reachable (it serves /_fsr/fix-info). The script
#   probes the dev harness (:4401) then the ship harness (:14400). Override with
#   HARNESS_URL=http://localhost:<port>.
set -euo pipefail

WIDGET_ID="${1:-}"
BUMP="${2:-patch}"
[ -n "$WIDGET_ID" ] || { echo "usage: release.sh <widgetId> [patch|minor|major]" >&2; exit 2; }
case "$BUMP" in patch|minor|major) ;; *) echo "bump must be patch|minor|major (got '$BUMP')" >&2; exit 2 ;; esac

HARNESS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WIDGETS_SRC="${WIDGETS_SRC:-$(cd "$HARNESS_DIR/../widgets-src" && pwd)}"
REPO_DIR="$WIDGETS_SRC/$WIDGET_ID"

say()  { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m✓ %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

# ---- 0. validate target is a widget git repo with info.json -----------------
[ -d "$REPO_DIR" ]                  || die "no widget folder: $REPO_DIR"
[ -f "$REPO_DIR/widget/info.json" ] || die "no widget/info.json under $REPO_DIR"
git -C "$REPO_DIR" rev-parse --git-dir >/dev/null 2>&1 || die "$REPO_DIR is not its own git repo (no origin to push)."

cd "$REPO_DIR"
[ -z "$(git status --porcelain)" ] || die "working tree not clean — commit/stash first."
BRANCH="$(git branch --show-current)"
[ "$BRANCH" = "develop" ] || die "not on develop (on '$BRANCH') — release.yml only fires on develop."

# ---- 1. resolve a reachable harness -----------------------------------------
resolve_harness() {
  for url in "${HARNESS_URL:-}" http://localhost:4401 http://localhost:14400; do
    [ -n "$url" ] || continue
    if curl -s -o /dev/null -m 2 "$url/" 2>/dev/null; then echo "$url"; return 0; fi
  done
  return 1
}
HURL="$(resolve_harness)" || die "no harness reachable (tried :4401, :14400). Start one: cd $HARNESS_DIR && scripts/ship.sh --restart"
say "using harness $HURL"

# ---- 2. bump via the blessed CLI --------------------------------------------
OLD="$(node -p "require('./widget/info.json').version")"
say "bumping $WIDGET_ID ($BUMP) from $OLD"
HARNESS_URL="$HURL" WIDGETS_SRC="$WIDGETS_SRC" node "$HARNESS_DIR/scripts/widget.js" bump "$WIDGET_ID" --bump "$BUMP"
NEW="$(node -p "require('./widget/info.json').version")"
[ "$NEW" != "$OLD" ] || die "version did not change ($OLD) — bump failed."
ok "bumped $OLD -> $NEW"

# ---- 3. commit + push -> fires the release workflow -------------------------
git commit -am "release: bump to $NEW"
git push origin develop
ok "pushed develop -> release workflow will publish v$NEW"
SLUG="$(git remote get-url origin | sed -E 's#.*github.com[/:]##; s#\.git$##')"
echo "watch: gh run watch --repo $SLUG"
