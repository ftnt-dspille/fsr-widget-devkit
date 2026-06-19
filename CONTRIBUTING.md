# Contributing — how we build FortiSOAR widgets

New here? Read `ONBOARDING.md` first, then this. These are the working rules
that keep widget development fast and safe on this team.

## 1. KNOWLEDGEBASE.md is the first stop — and the durable home for what you learn

`KNOWLEDGEBASE.md` (repo root) distills how FortiSOAR 7.x widgets actually
behave — lifecycle, drawer/`enableFor` mechanics, platform services
(`FormEntityService`, `$state`, `websocketService`), packaging, and a catalog of
gotchas from 60 certified widgets.

- **Before** designing or changing any widget (template, controller, or a
  service it uses), read the relevant KB section. The table of contents is at
  the top; §18 covers drawer/standalone widgets.
- **After** you discover anything non-obvious about the platform — a new gotcha,
  a service quirk, a state-name mapping, a packaging rule — **add it back to
  KNOWLEDGEBASE.md** in the matching section (terse, with the file reference and
  a short code block where it helps). Conversation/notes are not a substitute.
- If a bug traces to something the KB documents wrongly, fix the KB text in the
  same change.

## 2. Every widget change ships with tests

No test-naked widget changes.

- **Controller logic** → jest unit test.
- **DOM / template behavior** → Playwright e2e test.
- **CSS cascade / visual** → a small targeted Playwright snapshot, not the
  page-tester agent (it's slow for single visual asserts).

Integration tests must check **every** case and assert `failures === []` — don't
bail at the first success (one accidental 2xx has hidden real bugs before).

**`TESTING.md` is the how-to** — controller naming the harness lint enforces,
where e2e specs must live, the `make assets` requirement, and the testid /
no-`ng-controller` conventions. Read it before your first spec.

## 3. Run tests only through the Makefile

```bash
make test-unit WIDGET=<name>            # jest for one widget (+ harness)
make test-e2e-widget WIDGET=<name>      # all e2e specs for one widget
make test-e2e-spec SPEC="tests/e2e/<file>.spec.js [more...]"
make stop                               # kill dev (14400) + test (14401) servers
```

Never hand-start a server (`node server.js`) or run `pnpm exec playwright test`
directly — the Makefile owns the two dedicated ports and kills stale servers so
runs don't race. Raw playwright invocations buffer/hang; fix the real blocker
instead of re-running.

## 4. Start, package, and ship via the scripts — never by hand

- **Dev server:** `make dev` (or `cd fortisoar-widget-harness && npm run dev`).
- **Package + push to the lab box:** `cd fortisoar-widget-harness &&
  scripts/ship.sh <widgetId> --bump patch`. `ship.sh` guarantees a fresh server
  on a free port and verifies the listening PID is the one it launched — this
  removes the stale-server-points-at-wrong-box class of bug.
- **Bump versions through the CLI**, never hand-edit `info.json` `version` — a
  desynced version breaks the controller-name slug and the harness lint refuses
  to mount the widget.
- **Rename a widget** with `node scripts/widget.js rename <old> <new>` (atomic
  name + controller + folder + title rewrite), not by hand. Migrate sibling
  tests/e2e/KB references manually afterward.

## 5. Widget repos are independent

Each widget under `widgets-src/` is its own git repo (its own remote, history,
branches), gitignored by this kit. `widgets-src/` itself ships empty; it's
populated by `make widgets` from `widgets.manifest`. When you add a new widget
repo, add a line to `widgets.manifest` so the next person gets it.

Copy `widgets-src/_template/` to start a new widget; it has the view + edit
controller/template split, an `info.json`, and a jest + e2e test stub.

## 6. Commits

Author commits as yourself — no AI attribution (`Co-Authored-By`, "Generated
with…", etc.) in messages or PR descriptions.
