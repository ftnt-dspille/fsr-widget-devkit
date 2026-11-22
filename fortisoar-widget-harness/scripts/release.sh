#!/usr/bin/env bash
# release.sh - cut a GitHub release for ONE widget.
#
# Each widget under widgets-src/<id>/ is its own git repo on `main`. Its `origin`
# is its GitHub repo, and .github/workflows/release.yml runs on a pushed tag v*:
# it checks that the tag equals widget/info.json's "version", packs widget/ into
# <name>-<version>.tgz with the harness packager, and creates the GitHub release
# with that .tgz attached. The workflow is the only thing that publishes.
#
# This script does the local half:
#   1. bumps info.json through the blessed harness CLI (never a hand edit, which
#      would desync the controller name);
#   2. commits the bump and pushes main;
#   3. creates the annotated tag v<new> and pushes it, which starts the workflow.
# The tag is pushed with your own git credentials. A tag pushed with the
# default GITHUB_TOKEN does not start other workflows, so never move this step
# into a workflow.
#
# Usage:
#   scripts/release.sh <widgetId> [patch|minor|major]   (default: patch)
#   make release WIDGET=<id> [BUMP=patch]               (parent-repo wrapper)
#
# Refuses: a Claude Code shell without CONFIRM_DEPLOY=1 (a human cuts releases),
# a missing or dirty widget repo, a branch other than main, an origin that is not
# on github.com, and a tag v<new> that already exists on origin.
#
# Requirements:
#   A harness server must be reachable (the bump calls /_fsr/... on it). The
#   script probes the dev harness (:4401) then the ship harness (:14400).
#   Override with HARNESS_URL=http://localhost:<port>.
set -euo pipefail

# Claude Code sets CLAUDECODE=1 in every shell it spawns. Releases are the
# user's to cut: refuse unless a human passes CONFIRM_DEPLOY=1.
if [ -n "${CLAUDECODE:-}" ] && [ "${CONFIRM_DEPLOY:-}" != 1 ]; then
  echo "release.sh: deploys/releases are the user's to run; a human can override with CONFIRM_DEPLOY=1" >&2
  exit 2
fi

WIDGET_ID="${1:-}"
BUMP="${2:-patch}"
[ -n "$WIDGET_ID" ] || { echo "usage: release.sh <widgetId> [patch|minor|major]" >&2; exit 2; }
case "$BUMP" in patch|minor|major) ;; *) echo "bump must be patch|minor|major (got '$BUMP')" >&2; exit 2 ;; esac

# FSR_TOOL_HOME: the invoking checkout, set by run_from_main.sh (this script then runs from main's copy in a temp file)
HARNESS_DIR="${FSR_TOOL_HOME:+$FSR_TOOL_HOME/fortisoar-widget-harness}"
HARNESS_DIR="${HARNESS_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
WIDGETS_SRC="${WIDGETS_SRC:-$(cd "$HARNESS_DIR/../widgets-src" && pwd)}"
REPO_DIR="$WIDGETS_SRC/$WIDGET_ID"

say()  { printf '\033[1;36m> %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m+ %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31mx %s\033[0m\n' "$*" >&2; exit 1; }

# ---- 0. validate target is a widget git repo on main, pushed to GitHub ------
[ -d "$REPO_DIR" ]                  || die "no widget folder: $REPO_DIR"
[ -f "$REPO_DIR/widget/info.json" ] || die "no widget/info.json under $REPO_DIR"
git -C "$REPO_DIR" rev-parse --git-dir >/dev/null 2>&1 || die "$REPO_DIR is not its own git repo (no origin to push)."

cd "$REPO_DIR"
[ -z "$(git status --porcelain)" ] || die "working tree not clean - commit or move your changes first."
BRANCH="$(git branch --show-current)"
[ "$BRANCH" = "main" ] || die "not on main (on '$BRANCH') - the release workflow runs on tags pushed from main."
ORIGIN_URL="$(git remote get-url origin 2>/dev/null || true)"
case "$ORIGIN_URL" in *github.com*) ;; *) die "origin is '$ORIGIN_URL', not GitHub - the release workflow lives on GitHub." ;; esac
git fetch -q origin main || die "could not fetch origin/main"
git merge-base --is-ancestor origin/main HEAD || die "local main is behind or diverged from origin/main - reconcile it first."

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
[ "$NEW" != "$OLD" ] || die "version did not change ($OLD) - bump failed."
TAG="v$NEW"
if git ls-remote --tags origin "refs/tags/$TAG" | grep -q .; then
  die "tag $TAG already exists on origin. The bump is in the working tree; revert it with: git -C $REPO_DIR checkout -- ."
fi
ok "bumped $OLD -> $NEW"

# ---- 3. commit, push main, tag, push the tag -> fires the release workflow ----
git add -A
git commit -m "release: bump to $NEW"
git push origin main
ok "pushed main"
git tag -a "$TAG" -m "$TAG"
git push origin "$TAG"
ok "pushed tag $TAG -> release workflow will publish $TAG"
SLUG="$(echo "$ORIGIN_URL" | sed -E 's#.*github.com[/:]##; s#\.git$##')"
echo "watch: gh run watch --repo $SLUG \$(gh run list --repo $SLUG --workflow release.yml --limit 1 --json databaseId --jq '.[0].databaseId')"
echo "release: https://github.com/$SLUG/releases/tag/$TAG"
