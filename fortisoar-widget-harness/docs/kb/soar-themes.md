---
title: "FortiSOAR Themes and Theme Variables (8.0)"
topics: [theme, css-variables, deepSea, dark, light, steel, color]
category: widget-dev
status: canonical
summary: "The four 8.0 themes, the CSS variables each declares on :root, and how a widget should follow the analyst's theme instead of hard-coding a palette."
---

## Themes and theme variables

Supersedes the hard-coded color example in KNOWLEDGEBASE.md section 14 for 8.0.

**The themes.** `app/settings/themes.json` lists them; each loads one
stylesheet, `css/themes/<id>.<hash>.css`:

| id | UI name | notes |
|---|---|---|
| `deepSea` | Deep Sea | **the 8.0 default**: `themesService` falls back to `id:"deepSea"` |
| `dark` | Dark | |
| `steel` | Space | the id is still `steel` |
| `light` | Light | |

`$rootScope.theme.id` holds the active id (section 14).

**Every theme declares the same variables on `:root`.** Captured from the
platform's own theme CSS:

| variable | deepSea | dark | steel | light |
|---|---|---|---|---|
| `--default-body-bg-color` (page) | `#02071A` | `#000` | `#0d1218` | `#f2f2f2` |
| `--font-primary-color` (text) | `#FFFFFF` | `#EFEFEF` | `#FFFFFF` | `#151515` |
| `--active-color` (accent; `.btn-primary` bg) | `#497AD4` | `#2cafc3` | `#22a6af` | `#4676b2` |
| `--highlighted-color` | `#182947` | `#2b2b2b` | `#323b47` | `#e4e4e4` |
| `--default-content-bg` (panel overlay) | white 4% | white 4% | white 4% | black 4% |
| `--default-content-border` | white 4.5% | white 4.5% | white 4.5% | black 9% |
| `--panel-default-bg` | white 4% | `#161616` | `#1b2430` | `#FFFFFF` |
| `--element-default-bg-color` | white 4% | `#262626` | `#29323e` | `#f7f7f7` |

Also defined: `--default-body-bg` (Deep Sea's radial glow), `--default-content-hover-bg`,
`--default-content-fade-bg`, `--panel-default-body-bg`, `--panel-default-border-color`,
`--default-border-radius`, `--default-widget-spacing`, `--alert-success-color`.

**Follow the theme; don't hard-code one.** A widget that draws its own
surfaces should derive them from these variables, with fallbacks for the
harness (which loads no platform theme CSS):

```css
.my-widget {
  --soar-bg: var(--default-body-bg-color, #111317);
  --soar-fg: var(--font-primary-color, #eceef2);
  --surface: color-mix(in srgb, var(--soar-fg) 4%, var(--soar-bg)); /* SOAR's 4% overlay, solid */
  --accent: var(--active-color, #14b8a6);
  background: var(--soar-bg);
  color: var(--soar-fg);
}
```

Blend solid colors with `color-mix` rather than layering SOAR's translucent
`rgba` overlays: an overlay on a popover shows the content beneath it.

The assistant widget does this (fortiaiAgenticAssistant `view.html` tokens). A
fixed neutral-grey palette there read as a visibly different box inside the
Deep Sea designer.

**Testing.** The harness loads no platform theme CSS, so a widget there shows
only its fallbacks. To test theme following, inject one theme's variables with
`page.addStyleTag({ content: ':root { --default-body-bg-color: ... }' })` and
check the computed colors (the assistant's `soarTheme.spec.js`). Check contrast
for every theme: `color-mix` percentages that read well on Deep Sea can fail
WCAG AA on Light.
