#!/usr/bin/env bash
#
# new-widget.sh — scaffold a new widget from widgets-src/_template.
#
# Unlike `widget rename` (which renames an EXISTING widget and deliberately
# leaves sibling tests/ alone), this is for STARTING a new widget: it copies the
# template and replaces every placeholder form — camelCase name, kebab-case
# testids/classes, and the display title — across the widget AND its tests, so
# `make test-unit WIDGET=<name>` passes immediately.
#
# Usage:
#   scripts/new-widget.sh <camelCaseName> ["Display Title"]
#
# Example:
#   scripts/new-widget.sh incidentSummary "Incident Summary"
#   make test-unit WIDGET=incidentSummary
#
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMPLATE="$REPO_DIR/widgets-src/_template"
NAME="${1:-}"
TITLE="${2:-}"

[ -n "$NAME" ] || { echo "usage: scripts/new-widget.sh <camelCaseName> [\"Display Title\"]" >&2; exit 2; }
case "$NAME" in
  [a-z]*) : ;;
  *) echo "ERROR: name must be camelCase starting with a lowercase letter (e.g. incidentSummary)" >&2; exit 2 ;;
esac
[ -d "$TEMPLATE" ] || { echo "ERROR: template not found at $TEMPLATE" >&2; exit 1; }

DEST="$REPO_DIR/widgets-src/$NAME"
[ -e "$DEST" ] && { echo "ERROR: widgets-src/$NAME already exists" >&2; exit 1; }

# Derive the kebab-case form (myWidget -> my-widget) for testids/CSS classes,
# and a default Title-Case title if none was given.
KEBAB="$(printf '%s' "$NAME" | sed -E 's/([a-z0-9])([A-Z])/\1-\2/g' | tr '[:upper:]' '[:lower:]')"
# PascalCase form (incidentSummary -> IncidentSummary) for the edit controller
# name convention: edit<PascalName><version>DevCtrl. Portable upper-first (BSD
# sed has no \U; macOS bash 3.2 has no ${x^}).
PASCAL="$(printf '%s' "${NAME%"${NAME#?}"}" | tr '[:lower:]' '[:upper:]')${NAME#?}"
if [ -z "$TITLE" ]; then
  spaced="$(printf '%s' "$NAME" | sed -E 's/([a-z0-9])([A-Z])/\1 \2/g')"
  TITLE="$(printf '%s' "${spaced%"${spaced#?}"}" | tr '[:lower:]' '[:upper:]')${spaced#?}"
fi

cp -R "$TEMPLATE" "$DEST"
rm -f "$DEST/README.md"   # the template README is not part of a real widget

# Replace placeholders. Order matters: kebab before camel would corrupt nothing
# here (distinct tokens), but do title first so it isn't touched by the others.
find "$DEST" -type f -print0 | while IFS= read -r -d '' f; do
  sed -i.bak \
    -e "s/My Widget/$TITLE/g" \
    -e "s/MyWidget/$PASCAL/g" \
    -e "s/myWidget/$NAME/g" \
    -e "s/my-widget/$KEBAB/g" \
    "$f"
  rm -f "$f.bak"
done

# Rename any remaining placeholder-named file inside the widget folder.
find "$DEST" -depth -name '*myWidget*' | while IFS= read -r p; do
  mv "$p" "$(dirname "$p")/$(basename "$p" | sed "s/myWidget/$NAME/g")"
done

# Relocate the e2e spec into the harness's tests/e2e/ — Playwright's testDir is
# the harness and it does NOT crawl through the widgets-src symlink, so a spec
# left in the widget folder is never discovered. This matches the convention the
# real widgets use (harness/tests/e2e/<widget>.*.spec.js). The jest UNIT test
# stays with the widget (the WIDGET= jest project loads it directly).
HARNESS_E2E="$REPO_DIR/fortisoar-widget-harness/tests/e2e"
SRC_SPEC="$DEST/tests/e2e/$NAME.spec.js"
if [ -f "$SRC_SPEC" ] && [ -d "$HARNESS_E2E" ]; then
  mv "$SRC_SPEC" "$HARNESS_E2E/$NAME.spec.js"
  rmdir "$DEST/tests/e2e" 2>/dev/null || true
  echo "  e2e spec → fortisoar-widget-harness/tests/e2e/$NAME.spec.js"
fi

echo "✓ created widgets-src/$NAME  (title: \"$TITLE\", kebab: $KEBAB)"
echo "  next:"
echo "    make test-unit WIDGET=$NAME           # jest"
echo "    make dev                              # then pick \"$TITLE\" at http://localhost:14400"
echo "    make test-e2e-widget WIDGET=$NAME     # Playwright"
