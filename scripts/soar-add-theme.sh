#!/usr/bin/env bash
# soar-add-theme.sh — install a custom theme into SOAR (FortiSOAR 7.6.x)
#
# Usage:
#   sudo ./soar-add-theme.sh <id> "<Display Name>" [base-theme] [palette-file] [overrides-css]
#
# Examples:
#   sudo ./soar-add-theme.sh neon "Neon"
#   sudo ./soar-add-theme.sh neon "Neon" steel ./neon.palette ./neon-overrides.css
#   sudo ./soar-add-theme.sh mybrand "My Brand" dark ./mybrand.palette
#
# A palette file is a 2-column mapping of OLD_HEX -> NEW_HEX, one pair per
# line, '#' comments allowed. If omitted, a built-in Neon palette is used
# and mapped onto the chosen base theme's most-frequent colors.
#
# Idempotent: re-running with the same id replaces the previous install.
# Safe: backs up themes.json before editing. Run again after SOAR upgrades
# (upgrades rewrite themes.json and re-hash stock CSS files).

set -euo pipefail

UI_DIR=/opt/cyops-ui
THEMES_DIR="$UI_DIR/css/themes"
THEMES_JSON="$UI_DIR/app/settings/themes.json"

die() { echo "ERROR: $*" >&2; exit 1; }

[[ $# -ge 2 ]] || die "Usage: $0 <id> \"<Display Name>\" [base-theme] [palette-file]"
[[ $EUID -eq 0 ]] || die "must run as root (files are owned by nginx)"
[[ -d $THEMES_DIR ]] || die "$THEMES_DIR not found — is this a SOAR appliance?"
[[ -f $THEMES_JSON ]] || die "$THEMES_JSON not found"
command -v python3 >/dev/null || die "python3 required for safe JSON edit"

ID=$1
NAME=$2
BASE=${3:-steel}
PALETTE_FILE=${4:-}
OVERRIDES_FILE=${5:-}

[[ $ID =~ ^[a-zA-Z][a-zA-Z0-9]*$ ]] || die "id must be alphanumeric (got: $ID)"

# Locate the base CSS (handles the build-hash suffix).
BASE_CSS=$(ls -1 "$THEMES_DIR"/${BASE}.*.css 2>/dev/null | head -n1 || true)
[[ -n $BASE_CSS ]] || die "base theme '$BASE' not found in $THEMES_DIR (try: dark|light|steel|deepSea)"

OUT_CSS="$THEMES_DIR/${ID}.css"   # unhashed — survives upgrades

echo "==> base:  $BASE_CSS"
echo "==> out:   $OUT_CSS"

# --- Build the palette mapping ----------------------------------------------
# Default = Neon palette, auto-mapped onto the 8 most-frequent colors in the
# base CSS (background-most -> palette[0], etc.). Crude but produces a
# coherent recolor without hand-tuning.
TMP_MAP=$(mktemp)
trap 'rm -f "$TMP_MAP"' EXIT

if [[ -n $PALETTE_FILE ]]; then
    [[ -f $PALETTE_FILE ]] || die "palette file not found: $PALETTE_FILE"
    grep -vE '^\s*(#|$)' "$PALETTE_FILE" | awk 'NF==2 {print tolower($1)"\t"tolower($2)}' > "$TMP_MAP"
    [[ -s $TMP_MAP ]] || die "palette file has no OLD_HEX NEW_HEX pairs"
else
    # Neon palette (deep navy bg, cyan primary, orange accent, white text).
    PALETTE=(
        "#020912"   # 0 deepest background
        "#0a1626"   # 1 panel background
        "#11253d"   # 2 elevated panel
        "#1a3a5c"   # 3 border / divider
        "#6fc3df"   # 4 secondary accent (soft cyan)
        "#00b3ff"   # 5 primary accent (electric cyan)
        "#ffae00"   # 6 warning / orange grid
        "#e6f7ff"   # 7 text
    )
    # Top 8 unique colors by frequency in the base CSS.
    mapfile -t TOP < <(grep -ohE "#[0-9a-fA-F]{6}" "$BASE_CSS" \
        | tr '[:upper:]' '[:lower:]' | sort | uniq -c | sort -rn \
        | awk '{print $2}' | head -n 8)
    [[ ${#TOP[@]} -ge 4 ]] || die "base CSS has fewer than 4 distinct colors — odd, bailing"
    for i in "${!TOP[@]}"; do
        printf '%s\t%s\n' "${TOP[$i]}" "${PALETTE[$i]}" >> "$TMP_MAP"
    done
fi

echo "==> palette mapping (old -> new):"
sed 's/^/    /' "$TMP_MAP"

# --- Generate the themed CSS ------------------------------------------------
# Use python so we don't accidentally chain-replace (sed would: A->B then B->C).
python3 - "$BASE_CSS" "$OUT_CSS" "$TMP_MAP" <<'PY'
import sys, re, pathlib
src, dst, mapfile = sys.argv[1:4]
mapping = {}
for line in pathlib.Path(mapfile).read_text().splitlines():
    line = line.strip()
    if not line: continue
    old, new = line.split()
    mapping[old.lower()] = new.lower()
text = pathlib.Path(src).read_text()
def sub(m):
    return mapping.get(m.group(0).lower(), m.group(0))
text = re.sub(r'#[0-9a-fA-F]{6}', sub, text)
pathlib.Path(dst).write_text(text)
PY

# --- Append overrides (optional) -------------------------------------------
# Overrides are appended verbatim to the recolored CSS. Scope your rules with
# `body.theme-<id>` so they only fire when this theme is active.
if [[ -n $OVERRIDES_FILE ]]; then
    [[ -f $OVERRIDES_FILE ]] || die "overrides file not found: $OVERRIDES_FILE"
    echo "==> appending overrides from: $OVERRIDES_FILE"
    {
        printf '\n/* === overrides: %s === */\n' "$(basename "$OVERRIDES_FILE")"
        cat "$OVERRIDES_FILE"
    } >> "$OUT_CSS"
fi

chown nginx:nginx "$OUT_CSS"
chmod 644 "$OUT_CSS"

# --- Register in themes.json ------------------------------------------------
cp -p "$THEMES_JSON" "${THEMES_JSON}.bak.$(date +%s)"

python3 - "$THEMES_JSON" "$ID" "$NAME" <<'PY'
import json, sys, pathlib
path, tid, tname = sys.argv[1:4]
data = json.loads(pathlib.Path(path).read_text())
data = [t for t in data if t.get("id") != tid]   # idempotent
data.append({
    "id":   tid,
    "name": tname,
    "path": f"css/themes/{tid}.css",
    "type": "dark",
})
pathlib.Path(path).write_text(json.dumps(data, indent=4) + "\n")
PY

chown nginx:nginx "$THEMES_JSON"
chmod 644 "$THEMES_JSON"

echo
echo "Done. To see the new theme:"
echo "  1. In your browser console:"
echo "       Object.keys(localStorage).filter(k=>k.includes('themes')).forEach(k=>localStorage.removeItem(k)); location.reload();"
echo "  2. Or DevTools -> Application -> Clear site data -> reload."
echo "  3. Settings -> System Configuration -> Theme -> '$NAME'."
