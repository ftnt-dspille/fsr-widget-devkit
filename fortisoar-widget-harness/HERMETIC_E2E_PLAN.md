# Plan: make the mock e2e tier hermetic (zero forticloud dependency)

## Problem (why this exists)
The "mock" e2e suite is only *half* isolated. Two distinct flake sources:

1. **Local boot contention** — historically both Playwright workers shared one
   `node server.js`; Node serves the heavy AngularJS app-shell single-threaded, so
   two simultaneous widget boots starved each other → "boot timeout" failures.
   The old config hid these with `retries: 1` (flaky-green), which we reject.
   → **Already addressed** (this branch): one dev server **per worker**
   (`playwright.config.js` boots ports 14401+`parallelIndex`), `retries: 0`,
   `_isolated.js` baseURL fixture. *Remaining: wire specs to the fixture (Phase 0).*

2. **Proxied platform calls to forticloud** — the harness serves widget assets +
   `public/` + `lib/` + `fsr_src/templates-extracted/` locally, but
   **falls through to the forticloud proxy** (`server.js` proxy at ~:1661,
   `fallthrough:true`) for anything not snapshotted: the SOAR SPA shell, vendor
   bundles, and uncached `/api/3` metadata. A real-box 502 then fails a *mock*
   test (it 502'd `fsrSocAssistant.history` empty-state). **Per-worker servers
   make this WORSE** — two proxies now hammer the same box.

This plan eliminates #2 so the mock tier never touches forticloud, and
`retries: 0` holds against both classes.

## Leak inventory (what currently falls through to the proxy in mock mode)
Evidence-gathered, not assumed:

| Call | When | Source | Disposition |
|---|---|---|---|
| SOAR SPA shell `index.html`, vendor JS | every widget boot | proxy fallthrough | **snapshot locally** (Phase 1) |
| `/app/...` angular templates not yet extracted | render | `fsr_src/templates-extracted` (partial) | **complete the snapshot** (Phase 1) |
| `/api/integration/connectors/?search=assistant` | only the **real push** path (`_executeReal`) | `fsrPbAgent.service.js:34` | smoke "Create Playbook … via the live connector" specs are **intentionally live** — see Phase 3 |
| `/api/3/<module>/<id>?$relationships=true` | drawer/record entity-context only | `view.controller.js:2447` | **stub** in the harness `/api/3` mock layer (Phase 2) |
| auth / `whoami` / `usersService` | boot | proxy / `$injector` | harness already degrades (no usersService) → **stub the HTTP ones** (Phase 2) |

NB: connector *turns* (LLM, connector worker-pool, `history.db`) are already fully
mocked client-side (`executeAction` → `fsrPbMockConnectorService` when a
`?mock=` scenario is active) and never hit forticloud. This plan does NOT touch
that — it only closes the *platform* hole.

## Status (2026-06-12)
- **Phase 0 — DONE + validated.** All harness e2e specs import `./_isolated`
  (via `_fixtures.js` → `_isolated`), `_widgetId.js`/`counter.spec.js` use the
  request fixture's per-worker baseURL (relative paths). `fsrSocAssistant.history`
  green with 2 workers + `retries:0`.
- **Phase 1 — DONE.** `FSR_HERMETIC` loud-miss gate in `server.js` (599
  `HERMETIC-MISS` + `/_fsr/hermetic-misses` worklist endpoint); on by default for
  non-live e2e (`playwright.config.js`). Monaco served locally from
  `node_modules/monaco-editor` (pinned **0.47.0** = the box's version) — it was the
  one boot-critical asset (`await preloadMonaco()`). `/_fsr/stylesheets` short-
  circuits to `[]` under hermetic (was an outbound call returning un-servable
  `/css/...` hrefs). **Full fsrSocAssistant suite: zero HERMETIC-MISS.**
- **Phase 2 — DONE (boot reads).** Harness stubs for `/api/3/actors/current` +
  `/api/system/fixtures` (the only platform `/api/3` reads that surfaced). No
  drawer entity-context `?$relationships=true` miss appeared in the suite, so that
  fixture mechanism isn't needed yet — add per the plan if a future spec hits it.
- **Phase 3 — DONE (moot).** The smoke "live connector" push specs mock the
  connector via `page.route()`, so they're *already* box-independent. The 17
  failures were never hermetic leaks; they were three real bugs (see 2026-06-13
  below). The only genuinely-live spec is `createPlaybookLive.spec.js`, excluded
  unless `E2E_LIVE=1`. **No genuinely-live mock specs remain** — the mock tier is
  fully hermetic.
- **Phase 4 — DONE.** `TESTING.md` two-tier section added; CI/ship-verify
  enforcement wired via a Playwright `globalTeardown`
  (`tests/e2e/_hermeticTeardown.js`) that queries each per-worker server's
  `/_fsr/hermetic-misses` after the suite and **throws if any miss was recorded**
  (no-op on live). Validated the endpoint records a 599'd path with
  `hermetic:true`. *Residual nicety:* extend `scripts/fetch-soar-assets.sh` /
  `make assets` to re-snapshot Monaco on a box version bump (today the version is
  pinned in `package.json` at 0.47.0 by hand).

## Update 2026-06-13 — the 17 "pre-existing" failures fixed; suite 85/0

The 17 red specs were NOT hermetic leaks — three real bugs, now fixed (suite is
**85 passed / 0 failed**):
1. **Stale connector name in route mocks.** Widget repointed
   `fsr-playbook-builder` → `connector-fsr-soc-assistant`, but `smoke.spec.js` /
   `liveDetached.spec.js` fixtures still returned the old name → `_resolveConnector`
   rejected → push chain never ran (`pushResult` null) + detached `chat_poll`
   failed. Fixed the two fixtures.
2. **Hot-reload soft-remount corrupted concurrent runs.** `server.js` watched
   widget dirs + `harness.module.js` and broadcast an SSE soft-remount on any FS
   event; under 2 workers a stray event mid-test re-instantiated the controller
   and wiped its state (the `slow_turn` Stop test). Fixed: skip all watchers when
   `FSR_HERMETIC=1`.
3. **Seed card suppressed the opener (widget).** The init guard bailed on
   `messages.length>0`, but the entity-seed `$watch` adds the summary card first
   when the entity is immediate → opener `chat_turn` never fired (incident triage,
   6 specs). Fixed in `view.controller.js`: bail only on a non-`_seeded` message.
   (KB §18.6.)

## Phases

### Phase 0 — finish the per-worker wiring (small, unblocks the gate)
- Re-point fsrSocAssistant e2e spec imports `require('@playwright/test')` →
  `require('<rel>/_isolated')` (harness specs: `./_isolated`; widget specs:
  `../../../../tests/e2e/_isolated`).
- Make `tests/e2e/_widgetId.js` use the `request` fixture's baseURL (drop the
  hardcoded `http://localhost:14401`) so it follows the worker's own server.
- Validate: `make test-e2e-spec SPEC="fsrSocAssistant.history"` green with 2
  workers + `retries:0`.

### Phase 1 — snapshot the platform shell so the proxy is never hit for chrome
- Extend `scripts/fetch-soar-assets.sh` to also capture: the SPA `index.html`,
  the referenced vendor bundles, and a **full** template-cache extraction into
  `fsr_src/templates-extracted/` (today it's partial → the misses fall through).
- Add a harness "hermetic mode" (env `FSR_HERMETIC=1`, default ON under
  Playwright): when set, the proxy fallthrough is **disabled** — a cache miss
  returns a loud `599 HERMETIC-MISS: <path>` instead of silently proxying. This
  converts "silent forticloud dependency" into a visible, fixable miss.
- Iterate: run the full suite under `FSR_HERMETIC=1`, collect every
  `HERMETIC-MISS`, add each to the snapshot (or to the Phase-2 stub) until zero.

### Phase 2 — stub the residual `/api/3` reads in the harness
- For the handful of metadata/entity `/api/3` GETs the widget makes at render
  (entity-context `?$relationships=true`, any module metadata), add deterministic
  fixtures served by the harness's existing local `/api/3` layer (same mechanism
  that already serves `/_fsr/widgets`), gated by `FSR_HERMETIC`.
- Fixtures live next to the widget (`widgetAssets/fixtures/api3/...`) so they
  version with the widget.

### Phase 3 — separate the genuinely-live specs from the mock gate
- The smoke specs that exercise `_executeReal` ("Create Playbook: compiles then
  pushes **via the live connector**", push_failure, compile_failure) are not
  mock tests — they need forticloud. Two options (pick in review):
  - (a) tag them `*.live.spec.js` so they run only under `E2E_LIVE=1`
    (the existing live lane, serial), OR
  - (b) add a mock for the push path (`_executeReal` honors `?mock=`), keeping a
    DOM-level assertion in the mock gate and moving the real-push assertion to
    the live sweep.
- Outcome: the mock gate has **no** intentionally-live specs, so a forticloud
  outage can never red it.

### Phase 4 — enforce + document
- CI/`ship-verify` runs e2e with `FSR_HERMETIC=1` so a new silent proxy
  dependency fails fast (`HERMETIC-MISS`) instead of becoming a future flake.
- Document the two-tier model in `TESTING.md`: mock gate = hermetic + parallel +
  `retries:0`; live sweep = real box + serial.
- Keep `make assets` (fetch-soar-assets) as the one-time snapshot refresh when
  the box's platform version bumps.

## Definition of done
- `grep`-clean: a full mock e2e run under `FSR_HERMETIC=1` produces **zero**
  `HERMETIC-MISS` and makes **zero** outbound forticloud requests.
- `retries: 0` with 2 workers is green on a machine with forticloud
  **unreachable** (pull the network / point `FSR_BASE_URL` at an invalid host).
- The only specs that need the box are `*.live.spec.js`, run by the live sweep.

## Risk / cost
- Phase 1 is the bulk (snapshot completeness is iterative). The `HERMETIC-MISS`
  loud-miss mechanism makes it tractable — it's a finite worklist, not a guess.
- Snapshotted platform assets are Fortinet's proprietary JS → keep them
  **gitignored** (as today), re-fetchable via `make assets`. No redistribution.
- Phase 3 may reduce what the mock gate asserts about the real push; the live
  sweep already covers that path, so net coverage is unchanged.
</content>
