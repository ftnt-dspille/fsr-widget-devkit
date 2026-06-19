# SOAR Persona Theme Builder

Tooling for adding custom themes to FortiSOAR 7.6.x's
**Settings → System Configuration → Theme** dropdown. Built around six
persona themes (Tron / Ares / Clu / Athena / Aphrodite / Poseidon) but the
pipeline works for any palette.

## How SOAR themes work

- The theme list is a plain JSON registry on the appliance:
  `/opt/cyops-ui/app/settings/themes.json`. Each entry:
  `{id, name, path, type}` where `type` is `dark` or `light`.
- `cindex.html` always loads `css/themes/steel.<hash>.css` as a baseline,
  then layers the selected theme on top via
  `<link rel="stylesheet" data-ng-href="{{theme.path}}">`. Switching themes
  just rebinds `theme.path` — no reload needed.
- `themesService` (`app.unmin.js` ~line 45470) loads `themes.json`,
  translates `name` via `translationService.instantTranslate`, caches via
  `localStorageService` + `PromiseQueue`, and exposes
  `get()` / `applyTheme()`. **There is no filter.** Every entry in the JSON
  is shown. If a theme is in the JSON but missing from the dropdown, it's
  stale browser/local-storage cache — clear and reload.
- The three consumers (`GeneralCtrl`, `UserCtrl`,
  `UserPreferenceSettingsCtrl`) just bind `i.themes = e` with no filtering.

## Files in this directory

| File | Purpose |
|---|---|
| `soar-add-theme.sh` | Installer for a single theme: copies a base CSS, recolors via a palette mapping, optionally appends an overrides file, and registers in `themes.json`. Idempotent. |
| `install.sh` | Bundle entry point — loops every `*.palette` in the current dir and runs `soar-add-theme.sh` for each, applying `overrides.css` to all. |
| `bundle.sh` | Builds a single `.tar.gz` containing the installers, palettes, overrides, icons, and a README — ready to scp to a SOAR appliance. |
| `<persona>.palette` | Color mapping file (`OLD_HEX  NEW_HEX` per line) for one persona. |
| `personas-overrides.css` | Shared structural CSS — hairline borders, focus glows, uppercase headings, scrollbars, toaster accents. Per-persona `body.theme-X` blocks define CSS variables; the rest of the rules read those variables, so all six personas share one rule-set. |
| `icons/<persona>.svg` | 24×24 monochrome stroke icons for an eventual picker widget. Currently unused by `install.sh` (rides along inside the bundle). |
| `dark.*.css` / `light.*.css` / `steel.*.css` | Reference copies of the shipped SOAR themes — used as recolor bases and for diffing. **Proprietary Fortinet build artifacts: not redistributed.** Run `make assets` (or `scripts/fetch-soar-assets.sh`) to pull them from your own licensed box. |

## Building the bundle

```bash
cd scripts
./bundle.sh personas       # produces personas.tar.gz
```

The bundle layout:

```
personas/
├── install.sh
├── soar-add-theme.sh
├── overrides.css           (renamed from personas-overrides.css)
├── neon.palette
├── ares.palette
├── ...
├── icons/                  (rides along; install.sh ignores)
└── README.txt
```

## Installing on a SOAR appliance

```bash
scp personas.tar.gz csadmin@<appliance>:/tmp/
ssh csadmin@<appliance>
cd /tmp && tar xzf personas.tar.gz && cd personas
sudo ./install.sh
```

Then in the browser console (or DevTools → Application → Clear site data):

```js
Object.keys(localStorage).filter(k => k.includes('themes'))
  .forEach(k => localStorage.removeItem(k));
location.reload();
```

Switch theme via **Settings → System Configuration → Theme**.

## How `soar-add-theme.sh` works

```
sudo ./soar-add-theme.sh <id> "<Display Name>" [base-theme] [palette-file] [overrides-css]
```

1. Locates the base CSS (default `steel`) by glob — handles SOAR's hash
   suffixes (`steel.*.css`).
2. Builds the palette mapping. If a `.palette` file is provided, parses
   `OLD_HEX  NEW_HEX` pairs. If not, falls back to a built-in Neon palette
   auto-mapped onto the base CSS's 8 most-frequent colors by frequency.
3. Recolors via Python `re.sub` on `#RRGGBB` literals — single-pass to
   avoid the sed chain-replacement trap (where `A→B` then `B→C` collapses
   chains).
4. Writes the recolored CSS to `/opt/cyops-ui/css/themes/<id>.css` —
   **unhashed**, so SOAR upgrades don't clobber it (upgrades re-hash stock
   filenames but leave unknown ones alone).
5. Optionally appends the overrides CSS verbatim. Override rules must be
   scoped to `body.theme-<id>` so they only fire when the theme is active.
6. Backs up `themes.json` (timestamped), then idempotently adds/replaces
   the entry via Python (no fragile JSON regex).
7. `chown nginx:nginx` + `chmod 644` on both files.

## Authoring a new persona

1. Drop `<persona>.palette` in this directory. Format: `OLD_HEX  NEW_HEX`,
   one pair per line, `#` comments allowed. Use the same color *slots* as
   `neon.palette` (void / bg / panel / elevated / border / accent /
   accent-soft / text / text-muted / danger / success).
2. Add a per-persona variable block to `personas-overrides.css`:
   ```css
   body.theme-<id> {
     --p-bg-void:     #...;
     --p-bg:          #...;
     --p-bg-panel:    #...;
     --p-bg-elevated: #...;
     --p-border:      #...;
     --p-accent:      #...;
     --p-accent-rgb:  R, G, B;     /* triplet for rgba() glows */
     --p-accent-soft: #...;
     --p-text:        #...;
     --p-text-muted:  #...;
     --p-danger:      #...;
     --p-success:     #...;
     --p-warn:        #...;
   }
   ```
3. (Optional) Add `icons/<id>.svg` for the future picker widget.
4. Re-run `./bundle.sh && ssh ... ./install.sh`. The bundle picks the
   palette up automatically.

### Authoring tips

- Vary the void temperature per persona, not just the hue — Ares warms
  black with red, Aphrodite stays near-pure black at the deepest layer,
  Poseidon leans indigo. Without this, all themes feel like "Tron with
  a hue slider."
- When the persona accent is red (Ares), orange (Clu), or gold (Athena),
  the default danger/warn semantics collide with the accent — shift
  `--p-danger` and `--p-warn` per-persona so toasts still read as alerts.
- The `--p-accent-rgb` triplet is the trick that lets one shared rule-set
  drive all six personas — every `rgba()` glow/hover/selection computes
  from the persona accent without redefining each rgba string per theme.
- `:is(...)` keeps specificity equal to the most-specific selector inside.
  Swap to `:where(...)` only in the structural section if you specifically
  want flatter specificity for per-page overrides.

## Surviving SOAR upgrades

A SOAR upgrade rewrites `themes.json` and re-hashes the stock CSS
filenames. Your `<persona>.css` files survive (they're unhashed), but the
JSON entries are wiped. Re-run `install.sh` after each upgrade — it's
idempotent.

## Limitations

- The card-grid theme picker (the `IDENTITY: SELECT` mock) is **not** part
  of this pipeline. SOAR's built-in picker is a `<select>`. The
  `icons/` SVGs are pre-staged for a future "picker widget" that would
  render the card grid by reading `themesService.get()` and broadcasting
  `cs:themeChanged` on selection. ~1 day of widget work.
- This is appliance-side: requires shell access to the SOAR host. Without
  shell access, the only path is a widget that injects its own
  `<link rel="stylesheet">` and toggles a class on `<body>` — but it
  can't add an option to the system-settings dropdown.
