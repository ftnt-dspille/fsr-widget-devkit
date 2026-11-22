#!/usr/bin/env bash
# make promote runs the promote script AS IT IS ON THIS REPO'S REMOTE MAIN.
#
# Why: agents run make from the shared checkout, which other sessions keep on
# their own branches. A promote run there used that branch's copy, so a
# connector was promoted without the CI gate that was already on main. The
# gate is policy; policy comes from main, not from whoever's branch is out.
#
# The mechanism is scripts/run_from_main.sh (shared with every other tool that
# runs from main). PROMOTE_FROM_TREE=1 (or FROM_TREE=1) runs the working-tree copy
# instead: for developing and testing the promote script itself (its tests set it).
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[ "${PROMOTE_FROM_TREE:-}" = 1 ] && export FROM_TREE=1
bash "$here/scripts/run_from_main.sh" promote.sh
remote="$(git -C "$here" for-each-ref --format='%(upstream:remotename)' refs/heads/main)"
remote="${remote:-origin}"
# Every repo's hooks are root main's (scripts/hooks_central.sh): refresh them now,
# from the root main just fetched (or just pushed, when this promote was root's).
git -C "$here" fetch -q "$remote" main 2>/dev/null || true
sha="$(git -C "$here" rev-parse "refs/remotes/$remote/main")"
if git -C "$here" cat-file -e "$sha:scripts/hooks_central.sh" 2>/dev/null; then
  tmp="$(mktemp "${TMPDIR:-/tmp}/promote.XXXXXX")"
  trap 'rm -f "$tmp"' EXIT
  git -C "$here" show "$sha:scripts/hooks_central.sh" > "$tmp"
  FSR_ROOT_DIR="$here" bash "$tmp" install || echo "promote: WARNING the hooks refresh failed; run: bash scripts/hooks_central.sh install" >&2
fi
