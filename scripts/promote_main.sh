#!/usr/bin/env bash
# make promote runs scripts/promote.sh AS IT IS ON THIS REPO'S REMOTE MAIN.
#
# Why: agents run make from the shared checkout, which other sessions keep on
# their own branches. A promote run there used that branch's promote.sh, so a
# connector was promoted without the CI gate that was already on main. The
# gate is policy; policy comes from main, not from whoever's branch is out.
#
# PROMOTE_FROM_TREE=1 runs the working-tree copy instead: for developing and
# testing promote.sh itself (the promote tests set it).
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [ "${PROMOTE_FROM_TREE:-}" = 1 ]; then exec bash "$here/scripts/promote.sh"; fi
remote="$(git -C "$here" for-each-ref --format='%(upstream:remotename)' refs/heads/main)"
remote="${remote:-origin}"
git -C "$here" fetch -q "$remote" main 2>/dev/null \
  || echo "promote: could not fetch $remote main; using the last fetched copy" >&2
sha="$(git -C "$here" rev-parse "refs/remotes/$remote/main")"
tmp="$(mktemp "${TMPDIR:-/tmp}/promote.XXXXXX")"
trap 'rm -f "$tmp"' EXIT
git -C "$here" show "$sha:scripts/promote.sh" > "$tmp"
echo "promote: policy from $remote/main ${sha:0:9}"
bash "$tmp"
