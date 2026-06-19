# Writing tests that pass in this framework

Every widget change ships with tests: **controller logic → jest**, **DOM/template
→ Playwright e2e**. This guide captures the conventions that aren't obvious — the
ones that otherwise cost an afternoon. Read it before writing your first spec.

## The two test types

| | jest (unit) | Playwright (e2e) |
|---|---|---|
| Tests | controller view-model logic | real DOM rendered in the harness |
| Runs in | jsdom (no browser) | headless Chromium |
| Needs SOAR assets? | **No** | **Yes** — `make assets` first |
| Spec lives in | `widgets-src/<widget>/tests/*.test.js` | `fortisoar-widget-harness/tests/e2e/<widget>.spec.js` |
| Run with | `make test-unit WIDGET=<widget>` | `make test-e2e-widget WIDGET=<widget>` |

Always run through the Makefile — it owns the dev (14400) / test (14401) ports
and kills stale servers. Never hand-start a server or call `playwright` directly.

## Controller naming — the harness lint will block you

The harness refuses to mount a widget whose controllers aren't named by
convention, and a blocked mount makes **every** e2e for that widget fail with
"element(s) not found" (the widget never renders). The rule:

| Controller | Name pattern | Example (widget `incidentSummary` v1.0.0) |
|------------|--------------|-------------------------------------------|
| view | `<name><numericVersion>DevCtrl` | `incidentSummary100DevCtrl` |
| edit | `edit<PascalName><numericVersion>DevCtrl` | `editIncidentSummary100DevCtrl` |

`<numericVersion>` = the `info.json` version with dots removed (1.0.0 → `100`).
`scripts/new-widget.sh` and `widget bump` generate/rewrite these for you — don't
hand-edit the digits. If e2e fails to render, check the harness error panel: a
`[edit-controller-mismatch]` / `[stale-version-ref]` lint there is the cause.

> **Never hardcode the dotted version in the controller** (even in a comment) —
> the harness `stale-version-ref` lint blocks bootstrap on a stale literal after
> a bump, and a jest guard asserts `info.json.version` never appears verbatim in
> `view.controller.js`. Derive it from the served script URL instead.

## Unit tests (jest)

Pattern (see `widgets-src/_template/tests/view.controller.test.js`): boot a bare
`cybersponse` module, `require()` the controller IIFE (it self-registers), then
`$controller`-instantiate it with mocked injectables and assert the view-model.
angular + angular-mocks resolve from the harness `node_modules`.

```js
angular.module("cybersponse", []);
require("../widget/view.controller.js");
// then window.angular.mock.module / .inject to instantiate "<name>100DevCtrl"
```

Keep view logic pure and small so it's exercisable without a browser. Integration
assertions check **every** case (`expect(failures).toEqual([])`) — don't stop at
the first success.

## E2e tests (Playwright)

**Specs live in `fortisoar-widget-harness/tests/e2e/`, not in the widget folder.**
Playwright's `testDir` is the harness, and it does **not** crawl through the
`widgets-src` symlink — a spec left under `widgets-src/<w>/tests/e2e/` is silently
never discovered. `scripts/new-widget.sh` puts it in the right place.

The harness mounts widgets by `info.json` **name**, and selects which to render
from `localStorage`. Seed it before page scripts run:

```js
// resolve the mounted id (survives version bumps) via the harness API
const { widgets } = await (await request.get(`${HARNESS}/_fsr/widgets`)).json();
const id = widgets.find((w) => w.name === 'incidentSummary').id;   // "incidentSummary-1.0.0"

await page.addInitScript((wid) => {
  localStorage.setItem('harness.widget', wid);
  localStorage.setItem('harness.ctx', 'dashboard');
  localStorage.setItem('harness:config:' + wid, JSON.stringify({ title: 'Alice' }));
}, id);
await page.goto('/', { waitUntil: 'domcontentloaded' });
await expect(page.getByTestId('incident-summary-greeting')).toHaveText('Hello, Alice');
```

Conventions that matter:
- **`data-testid` on every element you assert/drive** — kebab-case, prefixed by
  the widget (`incident-summary-…`). `getByTestId` is selector-stable across
  template churn; CSS classes are not.
- **Don't put `data-ng-controller` on the view root** — the harness (and SOAR
  after publish) wraps the widget with its own; a second one creates a dead
  parallel scope and nothing renders. (KNOWLEDGEBASE.md §18.)
- Let Playwright auto-retry: `await expect(locator).toHaveText(...)` waits for the
  async Angular mount; no manual sleeps.

### E2e needs the SOAR app shell

The harness renders widgets inside the real FortiSOAR app bundle, served from
`fsr_src/`. Those are Fortinet platform assets we don't redistribute — run
**`make assets`** once (after setting `fortisoar-widget-harness/.env`) to fetch
them from your own licensed box. Without it, e2e fails with a
`/_fsr/templates.min.js` 500 / "harness boot failed". Unit tests don't need this.

## Canonical build → test → deploy flow (use this, don't improvise)

One pipeline, one command. This is the consolidated path — every step is a
Makefile target so the build/test/deploy story can't drift between sessions.

```
make ship-verify WIDGET=fsrSocAssistant [BUMP=patch]
```

runs, in order, failing fast:

1. **lint** — `widget.js lint` (controller naming / stale-version guards)
2. **unit** — `make test-unit` (jest; must exit 0 — see "trustworthy green" below)
3. **e2e (mock)** — `make test-e2e-widget` (all non-live specs; `[Ll]ive` excluded)
4. **deploy** — `scripts/ship.sh` (bulletproof fresh-server start + push), pointed
   at the **harness `.env`** so it deploys to the *same* box the tests hit
5. **live-sweep** — `make test-live-sweep` (real UI vs the real connector)

Sub-commands you'll also use directly:

| Command | What |
|---|---|
| `make test-unit WIDGET=<w>` | jest only |
| `make test-e2e-widget WIDGET=<w>` | mock e2e only |
| `make test-live-sweep [RUNS=n]` | the live UI bug-hunt sweep, repeated `n`× |
| `make ship-verify WIDGET=<w> BUMP=<p>` | the whole pipeline above |

### Two tiers: hermetic mock gate vs live sweep

The mock e2e tier is **hermetic** — it must never touch the FortiSOAR box, so a
box outage can't red a mock test. The harness enforces this with `FSR_HERMETIC=1`
(set by default for non-live e2e in `playwright.config.js`):

- **Proxy fallthrough is disabled.** Anything not served from a local
  snapshot/stub returns a loud `599 HERMETIC-MISS: <path>` instead of silently
  proxying to forticloud. A miss is a *bug to fix* (snapshot or stub the path),
  not a flake to retry — `GET /_fsr/hermetic-misses` dumps the worklist.
- **Platform chrome is served locally**: Monaco from `node_modules/monaco-editor`
  (pinned to the box's version), templates from `fsr_src/templates-extracted/`,
  and the boot reads (`/api/3/actors/current`, `/api/system/fixtures`) from
  harness stubs. `/_fsr/stylesheets` returns `[]` under hermetic (platform CSS is
  cosmetic; theme fidelity is a live-sweep concern).
- Run with `retries: 0` and one dev server **per worker** (no boot contention),
  so a single failure is a real failure — never masked as flaky-green.
- **The hermetic guarantee is enforced after the suite**, not just per-test: a
  Playwright `globalTeardown` (`tests/e2e/_hermeticTeardown.js`) queries every
  per-worker server's `/_fsr/hermetic-misses` and **fails the run** if any path
  leaked to the proxy — even one no test happened to assert on. So `ship-verify`
  / CI go red on a new silent box dependency.
- Hot-reload (the SSE soft-remount on file change) is **off under hermetic** —
  under concurrent workers a stray FS event would otherwise re-mount a widget
  mid-test and wipe its in-flight state. Tests never edit source mid-run.

The **live sweep** (`E2E_LIVE=1`, serial, `FSR_HERMETIC=0`) is the only tier that
reaches the real box. Refresh the local platform snapshot with `make assets` when
the box's FortiSOAR version bumps.

### The live sweep (`fsrSocAssistant.liveSweep.spec.js`)

Drives the widget **through the UI only** against the real
`connector-fsr-soc-assistant` on the box in `.env`, across the four scenario
classes (entity-context triage, hunt chain, direct containment, build→create→
verify→delete). Gated on `E2E_LIVE=1 FSRPB_LIVE_UI=1` (the make target sets both).
Each scenario captures console errors, uncaught JS, 4xx/5xx `/api` calls, and the
error banner, and prints a `[[SWEEP]] {json}` line for triage. The build scenario
self-cleans (creates, verifies, then deletes a real workflow), so it's safe to
run repeatedly / on a schedule.

### Single source of truth for the connector identity

The widget hardcodes its connector name in `fsrPbAgent.service.js` (it must ship
self-contained). **Test infra never hardcodes a second copy** — it reads
`tests/live/lib/connectorIdentity.js`, which *derives* the name/search/config
from that widget file. (The stale `fsr-playbook-builder` name that once aborted
the live build test was a second copy drifting after the rename — this kills that
class.)

### Env transients vs real failures (gateway preflight)

The forticloud→OpenAI gateway is intermittently flaky (502 / `ERR_EMPTY_RESPONSE`).
Two layers keep that from reading as a widget bug:

- **Per-request blips** are *survived* by the widget's `chat_poll` retry — the
  sweep is meant to exercise that resilience, so blips are not skipped.
- **A hard backend outage** (box down, `health_check` not ok, no LLM key) is
  caught by the sweep's preflight and turns the run into an **ENV-SKIP**
  (`[[SWEEP-ENV-SKIP]]`), not a wall of FAILs.

So: live-sweep FAIL ⇒ look at the widget. ENV-SKIP ⇒ look at the backend.

### Trustworthy green

`make test-unit` must exit 0. If a guard can't run because an *external artifact*
is missing (e.g. the contract markdown lost in the backend reorg), it **skips with
a `console.warn`** and auto-re-arms when the artifact returns — it never sits
perma-red, because a permanent red trains everyone to ignore the suite and hides
real regressions.

## Quick visual checks

For a one-off "did the color/layout change" check, write a tiny ad-hoc Playwright
snippet (boot the harness on 14401, `addInitScript` the widget, screenshot) — do
**not** spin up the page-tester agent for a single assertion; it's far slower.

## Known issues

- The harness's own `soarEnv` keychain tests can report 2 failures under a
  multi-project run (`make test-unit WIDGET=<x>`) on a fresh install — a jest
  cross-project isolation quirk, not your widget. The default gate `make test`
  (harness only) is clean. Validate your widget with `make test-unit WIDGET=<x>`
  and read the `PASS <widget>` line for your suite specifically.
