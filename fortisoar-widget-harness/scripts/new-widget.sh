#!/usr/bin/env bash
#
# new-widget.sh - thin shim over the spec-driven generator (scripts/new-widget.js).
#
# The generator is now the single source of truth (North Star #5): it emits
# dashboard / record-context / playbook-triggering variants from a spec, with the
# controller-name convention, the NS4 trigger-endpoint split, and harness-wired
# jest + Playwright scaffolds. This shim preserves the original positional CLI.
#
# Usage:
#   scripts/new-widget.sh <camelCaseName> ["Display Title"]        # quick form
#   scripts/new-widget.sh <name> --kind record --triggers-playbook # pass-through
#   # full control: node scripts/new-widget.js --spec spec.json
#
set -euo pipefail
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# The generator defaults WIDGETS_SRC to the harness's own widgets-src, which is
# not where widgets live in the monorepo. Default it to the monorepo widgets-src
# (where the retired root copy of this script wrote) unless the caller sets it.
if [ -z "${WIDGETS_SRC:-}" ] && [ -d "$REPO_DIR/../widgets-src" ]; then
  export WIDGETS_SRC="$(cd "$REPO_DIR/../widgets-src" && pwd)"
fi
exec node "$REPO_DIR/scripts/new-widget.js" "$@"
