# Widget template

Scaffold for a new FortiSOAR 7.x widget. The files use the placeholder name
`myWidget` throughout.

## Start a new widget

One command — copies this template and fills in every placeholder (camelCase
name, kebab-case testids/classes, display title) across the widget AND its
tests:

```bash
scripts/new-widget.sh incidentSummary "Incident Summary"

make test-unit WIDGET=incidentSummary        # jest passes immediately
make dev                                      # pick "Incident Summary" at :14400
make test-e2e-widget WIDGET=incidentSummary   # Playwright
```

> `scripts/new-widget.sh` is for **starting** a widget. To rename an **existing**
> widget, use `node fortisoar-widget-harness/scripts/widget.js rename <id>
> --title "…"` instead (it also reconciles the deployed widget on the box, but
> deliberately leaves sibling `tests/` for you to migrate).

## Anatomy

| File | Purpose |
|------|---------|
| `widget/info.json` | Widget manifest — name, version, pages, `enableFor`, size. Drives packaging. |
| `widget/view.controller.js` | The VIEW controller. Name resolves to `<name><numericVersion>DevCtrl` (e.g. `myWidget100DevCtrl` at 1.0.0). `widget bump` rewrites the digits — never hand-edit them. |
| `widget/view.html` | The rendered template. |
| `widget/edit.controller.js` / `edit.html` | The config editor (shown when the host opens "Edit Config"). |
| `tests/view.controller.test.js` | jest unit test for controller logic (stays with the widget). |
| `tests/e2e/myWidget.spec.js` | Playwright e2e seed. `new-widget.sh` relocates it to `fortisoar-widget-harness/tests/e2e/<name>.spec.js` — the harness is Playwright's testDir and doesn't crawl the `widgets-src` symlink. |

Read `../../KNOWLEDGEBASE.md` before adding anything non-trivial, and
`../../CONTRIBUTING.md` for the test/ship discipline. Every change ships with a
test.

> This folder ships with the dev kit and is **not** a widget repo of its own. A
> real widget becomes its own git repo; add it to `../../widgets.manifest` once
> it has a remote.
