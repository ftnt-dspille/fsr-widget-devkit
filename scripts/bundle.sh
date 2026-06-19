#!/usr/bin/env bash
# bundle.sh — produce a single tarball that scp's to a SOAR appliance and
# installs every *.palette in the scripts/ directory as a theme.
#
# Usage:
#     ./bundle.sh                 # builds soar-themes-bundle.tar.gz
#     ./bundle.sh mybundle        # builds mybundle.tar.gz
#
# Resulting tarball layout:
#     soar-themes-bundle/
#       install.sh
#       soar-add-theme.sh
#       overrides.css           (if any *-overrides.css present)
#       <persona>.palette       (one per persona)
#       README.txt

set -euo pipefail
cd "$(dirname "$0")"

NAME=${1:-soar-themes-bundle}
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
DEST="$STAGE/$NAME"
mkdir -p "$DEST"

# Required files
cp install.sh soar-add-theme.sh "$DEST/"
chmod +x "$DEST/install.sh" "$DEST/soar-add-theme.sh"

# Palettes
shopt -s nullglob
PALETTES=( *.palette )
[[ ${#PALETTES[@]} -gt 0 ]] || { echo "no *.palette files to bundle" >&2; exit 1; }
cp "${PALETTES[@]}" "$DEST/"

# Overrides — first *-overrides.css wins, renamed to overrides.css.
OVERRIDES=( *-overrides.css )
if [[ ${#OVERRIDES[@]} -gt 0 ]]; then
    cp "${OVERRIDES[0]}" "$DEST/overrides.css"
fi

# Icons (optional, for a future picker widget; install.sh ignores them).
if [[ -d icons ]]; then
    cp -r icons "$DEST/icons"
fi
shopt -u nullglob

# README
cat > "$DEST/README.txt" <<EOF
SOAR Themes Bundle
==================

Contents:
$(cd "$DEST" && ls -1 | sed 's/^/  /')

Install on the SOAR appliance:
  scp $NAME.tar.gz csadmin@<appliance>:/tmp/
  ssh csadmin@<appliance>
  cd /tmp && tar xzf $NAME.tar.gz && cd $NAME
  sudo ./install.sh

Then in the browser console (or DevTools -> Application -> Clear site data):
  Object.keys(localStorage).filter(k=>k.includes('themes'))
    .forEach(k=>localStorage.removeItem(k));
  location.reload();

Switch theme via Settings -> System Configuration -> Theme.

Re-run install.sh after SOAR upgrades — upgrades rewrite themes.json and
strip your entries. The CSS files survive.
EOF

# Tar
TAR="$NAME.tar.gz"
tar -C "$STAGE" -czf "$TAR" "$NAME"
echo "Built: $(pwd)/$TAR"
echo "Contains:"
tar -tzf "$TAR" | sed 's/^/  /'
