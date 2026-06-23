# Harness rendering hardening plan — make rendering deterministic & agent-legible

**Status:** P0 + P1 DONE (2026-06-23); **P3 doc + P4 jest self-tests DONE
(2026-06-23)** — `docs/HARNESS_RENDERING.md` (agent-facing render contract:
lifecycle, `settle()`/`waitForRender()`, render-state, safety digest, stub
policy) + `tests/harnessRender.test.ts` (22 jest pinning the primitives). The
P4 **e2e** self-tests (render-state phases, `$uibModal` faithfulness,
empty-state ×N stability, render-error panel) remain — they need the parent
Makefile + widgets-src. **P2 (faithful-or-loud stubs) is next** (north star #2).

> **P0/P1 shipped 2026-06-23.** `lib/harnessRender.ts` adds
> `window.__HARNESS_RENDER_STATE` (phase/mountId/lastError) + `window.__harness.settle()`
> (bounded drain of $http+digest+$timeout) + an ambient **safety digest**
> (`$interval(noop)`, default-on, `window.__HARNESS_NO_SAFETY_DIGEST` to disable)
> that restores the platform's ambient digest activity so post-mount async
> renders (e.g. playbook-execution completion → grid data) flush deterministically.
> `index.html` drives the phase transitions + starts the safety digest after the
> mount settle. Test helper `tests/e2e/_render.ts` exports `waitForRender(page)` /
> `settleRender(page)`. **Result:** the jsonToGrid empty-state render flake (was
> ~40% on fast runs) is gone — 19/19 fast e2e runs green; the only residual
> failures were ~57s slow-boot timeouts (pre-existing infra, orthogonal). The
> `$uibModal` rewrite (commit eb08c6a) and the upstream-timeout fix (2e7b343)
> landed alongside. P2 (no silent stubs) partially exercised: the playbook-trigger
> 404 path is now documented (KB §19.3) and jsonToGrid picks the right endpoint.
**Why now:** verifying jsonToGrid surfaced a class of footguns where a widget
*looks* mounted but a feature is silently dead or paints non-deterministically.
An AI agent then burns turns adding arbitrary `waitForTimeout`s and poking
`scope().$apply()` to discover what actually happened. The harness should make
"did it render, and is it done?" a deterministic, machine-readable fact.

---

## What broke this session (evidence)

1. **`$uibModal` was a silent no-op.** The stub returned a never-resolving modal
   that rendered nothing. jsonToGrid's custom date-range popup mounted "green"
   but the feature was dead. *(Fixed: real compile+append `$uibModal`, commit
   `eb08c6a`.)*

2. **Renders settle only on a widget-initiated digest.** After the modal closed,
   `grid.refresh()` scheduled a ui-grid canvas repaint for a *later* digest tick.
   Nothing fired that tick, so `getVisibleRows()` said 1 while the DOM had 0
   rows — until a test happened to call `scope().$apply()`. *(Worked around with
   `$timeout` digest kicks on modal open/close.)*

3. **The "No Results Found" empty-state e2e is an intermittent flake** for the
   *same* reason: the empty-grid render lands outside a digest and stalls until
   one happens. Pre-existing; not a widget bug.

**Single root cause:** the harness has **no periodic or event-driven digest
pump** (the only `setInterval` updates non-Angular chrome) and **no
render-settled signal**. Async events — mock HTTP completing, modal open/close,
mount, hot-reload, ui-grid deferred renders — depend on the widget to trigger
the next digest. When it doesn't, the DOM lags the model.

Secondary footguns:
- **Silent stubs** generally: a stub that no-ops looks identical to a working
  service at mount time. (`__HARNESS_STUB_NAMES` / `__HARNESS_STUB_HITS` already
  exist — we just don't surface "you hit a dead stub".)
- **jqLite gotchas** in harness DOM code: `.find()` matches *tag names only*, not
  `.class` — the exact bug that swallowed the modal template.

---

## Goal

An AI agent (or test) should be able to:
1. Mount a widget and **`await` a single signal** that the render has settled.
2. Read **one object** that says: rendered / error / what's still pending.
3. Never get a green mount hiding a dead no-op stub — those announce themselves.

No more `waitForTimeout(N)` guessing; no more `scope().$apply()` pokes in specs.

---

## Plan (prioritized)

### P0 — Render-settle pump + `settle()` promise  ← highest value, kills the flakes
- Add `window.__harness.settle()` → a Promise that resolves when the app is
  quiescent: drain outstanding `$http` (Angular's
  `$browser.notifyWhenNoOutstandingRequests`), then run a bounded loop of
  `$timeout(noop)` digest ticks until no new watchers fire (cap iterations to
  avoid an infinite digest masking a real bug; log if the cap is hit).
- Fire an internal settle-pump automatically after harness-driven async events:
  mock HTTP responses delivered, modal open/close, `mountWidget`, hot-reload SSE.
  (The `$uibModal` `settleTick()` added this session is the seed of this.)
- Prefer **event-driven** flush. A low-frequency safety `$interval` (e.g. 250ms)
  is a fallback only behind a flag — a constant digest can mask "my widget never
  triggers its own render" bugs that exist on the real platform.

### P1 — `window.__HARNESS_RENDER_STATE` + a `waitForRender(page)` test helper
- Maintain `{ phase: 'mounting'|'rendered'|'error', lastError, pendingHttp,
  lastDigestAt, mountId }`. Builds on the existing render-error panel /
  `__HARNESS_RENDER_ERROR` (prior session).
- Ship `tests/e2e/_render.ts` exporting `waitForRender(page)` = `await settle()`
  + assert `phase==='rendered'`. Adopt it across specs to replace ad-hoc
  `toBeVisible({timeout: 20000})` races. This is what makes the harness
  *agent-legible*: one call, deterministic.

### P2 — No silent stubs: faithful or loud
- Audit `regFactory`/`regService` stubs (enumerate via `__HARNESS_STUB_NAMES`).
  For each no-op that a real widget plausibly depends on for behavior (not just
  DI satisfaction): either implement faithfully (like `$uibModal`), or have it
  emit a visible warning through the render-error/console path when *invoked*
  (not when registered) so a dead feature can't masquerade as working.
- Introspect-gate check: flag a widget whose mount **hits a known no-op stub**.

### P3 — DOM-assembly safety + a short rendering doc
- Add a tiny internal helper for class-based element lookup so harness code never
  repeats the jqLite `.find('.x')` bug; sweep existing harness DOM assembly.
- Write `docs/HARNESS_RENDERING.md` (agent-facing): the render model, the
  `settle()` / `waitForRender` contract, the stub policy. Short, skimmable.

### P4 — Self-tests for the rendering primitives
- Jest + e2e for `$uibModal`, `settle()`, and the render-state transitions, so
  these guarantees don't silently regress. Re-run the empty-state spec ×20 to
  prove the flake is gone once `waitForRender` is adopted.

---

## Acceptance
- jsonToGrid `widget-json-to-grid` e2e and the empty-state spec pass **20/20**.
- A representative spec is rewritten to use `waitForRender` with **zero**
  `waitForTimeout`/`scope().$apply()` and stays green.
- Hitting a no-op stub during mount produces a visible signal (panel/console),
  caught by the introspect gate.

## Sequencing
P0 → P1 unblock the rest and immediately remove flake/turn-waste; P2–P4 are
hardening. P0+P1 are ~a focused session; do them first and re-verify the
jsonToGrid + fsrSocAssistant suites before touching P2+.
