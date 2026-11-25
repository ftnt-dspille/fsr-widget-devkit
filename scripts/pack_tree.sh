#!/usr/bin/env bash
# pack_tree.sh <dir>: the working tree as a tar on stdout, tracked and untracked files
# (gitignore respected). A tracked file deleted in the working tree is left out: `git ls-files -c`
# still lists it, and tar then failed the whole pack ("Cannot stat"), which refused a push.
set -euo pipefail
cd "${1:?usage: pack_tree.sh <dir>}"
git ls-files -z -co --exclude-standard | while IFS= read -r -d '' f; do
    [[ -e "$f" || -L "$f" ]] && printf '%s\0' "$f"
done | COPYFILE_DISABLE=1 tar --null -T - -cf -
