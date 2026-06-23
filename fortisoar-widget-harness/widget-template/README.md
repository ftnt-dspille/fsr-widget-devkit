# Widget template

Scaffold for a new FortiSOAR 7.x widget. The files use the placeholder name
`myWidget` throughout. Don't edit this folder directly — copy it with the
scaffold script, which fills in every placeholder.

## Start a new widget

Use the **spec-driven generator** (`scripts/new-widget.js`) — it emits a correct,
harness-wired skeleton (controller-name convention, the playbook-trigger endpoint
split, jest + Playwright scaffolds bound to the harness helpers) so it builds,
mounts, and tests pass right away. This folder is its dashboard reference.

```bash
# Simplest (dashboard widget):
make new-widget NAME=incidentSummary TITLE="Incident Summary"

# A record (View-Panel) widget that also triggers a playbook:
make new-widget NAME=incidentSummary KIND=record TRIGGER=1

# Full control via a spec file (name, title, category, kind, triggersPlaybook, …):
make new-widget SPEC=spec.json
#   { "name": "incidentSummary", "kind": "record", "category": "Investigation",
#     "triggersPlaybook": true }

make test-unit WIDGET=incidentSummary    # jest unit (passes immediately)
npm run dev                              # pick "Incident Summary" at http://localhost:14400
npm run assets                           # once: fetch the SOAR app shell needed for e2e
make test-e2e-widget WIDGET=incidentSummary   # Playwright (hermetic, NS1 fixtures)
```

**Variants** the generator emits:
- **dashboard** (default) — a self-contained view-model widget.
- **`KIND=record`** — a View-Panel widget that reads the open record via
  `FormEntityService`; the NS1 default fixture layer serves the record on the
  mock e2e tier, so it's green with **zero** per-spec platform stubs.
- **`TRIGGER=1`** — adds a playbook-trigger control wired to the correct endpoint
  (`action/<route>` for record-context actions, `notrigger/<uuid>` for
  manual/no-record playbooks — KB §19.3), enforced by the harness lint.

> `scripts/new-widget.sh <name> ["Title"]` still works (it now shims the
> generator). To rename an **existing** widget, use `node scripts/widget.js
> rename <id> --title "…"` instead (it reconciles the deployed widget on the box
> but leaves sibling `tests/` for you to migrate).

## Anatomy

| File | Purpose |
|------|---------|
| `widget/info.json` | Widget manifest — name, version, pages, size. Drives packaging. |
| `widget/view.controller.js` | VIEW controller. Name resolves to `<name><numericVersion>DevCtrl`. Never hand-edit the digits. |
| `widget/view.html` | The rendered template. |
| `widget/edit.controller.js` / `edit.html` | Config editor. Controller name is `edit<PascalName><numericVersion>DevCtrl` — the harness lint blocks mounting if it's wrong. |
| `tests/view.controller.test.js` | jest unit test (stays with the widget). |
| `tests/e2e/myWidget.spec.js` | Playwright e2e seed — `new-widget.sh` relocates it to `tests/e2e/<name>.spec.js` (the harness is Playwright's testDir). |

Read `../../KNOWLEDGEBASE.md` before anything non-trivial, and `../TESTING.md`
for the test conventions. Every change ships with a test.
