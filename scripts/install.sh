#!/usr/bin/env bash
# install.sh — one-shot theme installer for a SOAR appliance.
#
# Run from inside an unpacked theme bundle:
#     sudo ./install.sh
#
# Behavior:
#   - Installs every *.palette file in the current directory as its own theme,
#     using the file's basename as the id and a Title-Cased name for the label.
#   - Each palette is applied against the bundled `base.css` (or whichever
#     base theme is on the appliance, controlled by $BASE_THEME).
#   - If `overrides.css` is present, it's appended to every theme.
#
# Env overrides:
#     BASE_THEME=steel        # base theme to recolor against (default: steel)
#     CSS_DIR=/opt/cyops-ui/css/themes
#     THEMES_JSON=/opt/cyops-ui/app/settings/themes.json

set -euo pipefail

cd "$(dirname "$0")"

[[ $EUID -eq 0 ]] || { echo "must run as root" >&2; exit 1; }
[[ -x ./soar-add-theme.sh ]] || { echo "soar-add-theme.sh not found in bundle" >&2; exit 1; }

BASE_THEME=${BASE_THEME:-steel}
OVERRIDES=""
[[ -f ./overrides.css ]] && OVERRIDES=./overrides.css

shopt -s nullglob
PALETTES=( *.palette )
shopt -u nullglob

[[ ${#PALETTES[@]} -gt 0 ]] || { echo "no *.palette files in bundle" >&2; exit 1; }

titlecase() {
    # foo-bar -> Foo Bar; neon -> Neon
    echo "$1" | tr '_-' '  ' | awk '{for(i=1;i<=NF;i++) $i=toupper(substr($i,1,1)) tolower(substr($i,2))}1'
}

for p in "${PALETTES[@]}"; do
    id=${p%.palette}
    name=$(titlecase "$id")
    echo
    echo "================================================================"
    echo " Installing theme: $id  ($name)"
    echo "================================================================"
    ./soar-add-theme.sh "$id" "$name" "$BASE_THEME" "./$p" ${OVERRIDES:+"$OVERRIDES"}
done

echo
echo "All themes installed. To activate in browser:"
echo "  Object.keys(localStorage).filter(k=>k.includes('themes')).forEach(k=>localStorage.removeItem(k)); location.reload();"
