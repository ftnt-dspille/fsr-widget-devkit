# Harness Rendering Contract

Agent-facing reference for the harness render lifecycle, state machine, and test helpers.

## Render Lifecycle

The harness boots with a **widget render state machine** (`window.__HARNESS_RENDER_STATE`):

```
   idle ──→ mounting ──→ rendered
               ↓
              error
```

- **idle**: Boot, before `angular.bootstrap`.
- **mounting**: During bootstrap (controller construction + initial `$digest`).
- **rendered**: Mount succeeded; the widget is live in the DOM.
- **error**: A controller throw or digest exception was caught during mount.

Each new mount (widget switch, reload, edit-modal open) increments `mountId`, so agents can detect a fresh render cycle.

---

## Core API: `window.__harnessRender`

All harness render primitives live here (see `lib/harnessRender.ts` lines 130–216).

### `setInjectorGetter(fn: () => AngularJS.Injector): void`

Called by `index.html` (line ~40) to wire the current injector. Stays abstract so the harness can swap injectors (view vs edit-modal) without stopping/restarting the render module. **Internal use only** — tests/agents don't call this directly.

### `beginMount(): number`

Called when bootstrap starts. Returns the new `mountId`. Also **stops any running safety digest** (so a re-mount doesn't leak digest ticks on a stale injector).

### `endMount(): RenderState`

Called after the initial mount digest settles (see `index.html` line ~50). If `window.__HARNESS_RENDER_ERROR` is set (a swallowed controller/digest throw), sets phase to `'error'` and caches the error in `lastError`. Otherwise phase is `'rendered'`.

Returns a **snapshot** of render state (not a live reference).

### `settle(opts?: { timeoutMs?: number; cycles?: number }): Promise<RenderState>`

Drain outstanding async work and resolve with a snapshot of the render state. Used by e2e specs after user interactions that schedule async work.

**Contract:**
- Each cycle waits for no outstanding `$http`/template requests, flushes a `$digest`, then yields a macrotask so `$timeout` / `requestAnimationFrame` work can run.
- Bounded by `cycles` (default **4**) and `timeoutMs` (default **5000ms**).
- Returns early with a snapshot if the injector is null (safe before/after mount).
- **Idempotent**: safe to call multiple times; does not accumulate side effects.

**Why 4 cycles?** The typical chain is `fetch → digest → grid-defers-render → digest → paint`. A bounded loop handles this deterministically without an unbounded "spin until stable" check that could hang on a broken widget.

### `state(): RenderState`

Snapshot the current render state (phase, mountId, lastError, timestamps).

### `startSafetyDigest(intervalMs?: number): void`

Start an ambient `$interval(noop)` that fires every `intervalMs` (default **250ms**) to trigger periodic digests. This restores SOAR's ambient digest activity (websocket heartbeats, platform timers) that keeps renders flush with the model even when async work completes outside a widget-initiated digest scope.

**Disable** with `window.__HARNESS_NO_SAFETY_DIGEST = true`, set **before mount**, to debug widgets that incorrectly rely on the harness to render them.

### `stopSafetyDigest(): void`

Cancel the ambient digest interval. Called automatically on `beginMount()` (re-mount stops the old one before starting a new injector).

---

## RenderState Shape

```typescript
interface RenderState {
  phase: "idle" | "mounting" | "rendered" | "error";
  mountId: number;           // Increments each mount; test uses this to detect fresh cycles
  lastError: any | null;     // The caught error if phase === 'error'
  lastSettleAt: number;      // Wall-clock ms of last settle() completion
  lastDigestAt: number;      // Wall-clock ms of last digest flush
}
```

**Read a render cycle:**
```typescript
const s = window.__HARNESS_RENDER_STATE;
if (s.phase === 'error') {
  console.log('Widget errored:', s.lastError.message);
  console.log('Mount ID:', s.mountId);
}
```

---

## Test Helpers: `tests/e2e/_render.ts`

Browser-agnostic Playwright utilities that replace ad-hoc `waitForTimeout` + `scope().$apply()` pokes.

### `waitForRender(page: Page, opts?: { timeout?: number; failOnError?: boolean }): Promise<void>`

Wait for the mount to reach a terminal phase (`'rendered'` or `'error'`), then settle. If the mount errored and `failOnError` is true (default), throw with the captured render error before your assertion fails opaquely.

**Example:**
```typescript
await page.goto('/', { waitUntil: 'domcontentloaded' });
await waitForRender(page);  // Mount complete, DOM flush
await expect(page.getByTestId('widget-loaded')).toBeVisible();
```

### `settleRender(page: Page, opts?: { timeoutMs?: number; cycles?: number }): Promise<void>`

Drain the app (outstanding requests, pending digests, deferred renders) and resolve. Called automatically by `waitForRender` after the mount phase; use directly after user interactions that schedule async work.

**Example:**
```typescript
await page.click('[data-testid="filter-button"]');
await settleRender(page);  // Waits for grid filter → refresh → layout paint
await expect(page.getByTestId('grid-rows')).toHaveCount(N);
```

---

## Stub Policy (Faithful vs No-Op-by-Design)

A green mount must not silently hide dead features. The harness registers stubs for stripped vendor modules and SOAR services (see `harness.module.ts` lines 13–25 for hit-counter setup).

### Notable Stubs

| Service | Type | Behavior | Rationale |
|---------|------|----------|-----------|
| `$stomp` (websocket) | no-op-by-design | `connect()` → never-resolving promise; `subscribe/send/disconnect` → no-op | SOAR's websocket is live; harness has no sockets; fallback to polling works |
| `$uibModal` | faithful | Compiles template, runs controller, appends real `<div class="modal">`, wires close/dismiss | Widgets open modals (e.g., jsonToGrid date-range popup); need real DOM behavior |
| `$state`/`$stateParams` | stub | Return a minimal object with params from `window.__HARNESS_STATE` | ui-router is stripped; some widgets read it directly |
| `clipboard` | faithful | Uses native `navigator.clipboard.writeText` when available | Real CommonUtils code path |
| `translationService.instantTranslate` | wrapped | Consults widget-local keys (from `window.__HARNESS_TRANSLATIONS`) before falling back to SOAR's tables | Widget translations loaded by harness boot |
| `settingsService.getSystem` | wrapped | Backfills `publicValues.lightmode` keys so csGrid doesn't throw on theme reads | csGrid hardcodes dereference on keys that a fresh box might lack |

### Introspection: Stub Hit Counters

Every stub increments `window.__HARNESS_STUB_HITS[name]` when instantiated. Use this to verify a mount exercised the expected paths:

```typescript
const hits = await page.evaluate(() => (window as any).__HARNESS_STUB_HITS);
expect(hits['$uibModal']).toBeGreaterThan(0);  // Modal was injected
```

Names are also logged in `window.__HARNESS_STUB_NAMES` (array of all registered stubs).

---

## Cross-References

- **KB §18** ("Drawer + Standalone Widget Rendering"): Why the harness needs ambient digest, phase transitions, error surfacing. This doc is the HOW-TO surface; KB §18 explains the WHY and internals.
- **TESTING.md**: Two-tier model (mock e2e hermetic, live sweep), fixture setup, spec patterns.
- **docs/HARNESS_RENDERING_PLAN.md**: Architecture review and hardening rationale (P0/P1).

---

## Troubleshooting

### "DOM is stale / doesn't match the model"

Call `settleRender(page)` after any interaction that schedules async work (user click, fetch completion, modal close). The harness has no ambient digest like SOAR does, so renders stall until something pokes a digest. `settleRender` fixes this deterministically.

### "Widget errored during render"

Check `window.__HARNESS_RENDER_STATE.phase`. If `'error'`, read `window.__HARNESS_RENDER_STATE.lastError.message` or call `window.__harness.dump()` (see `harnessDrawer.ts` line ~60) to inspect the full error panel. The captured error is the root cause — controller constructor throw or $digest exception.

### "settle() is timing out"

- Check for infinite loops or unbounded async chains in the widget controller.
- Look for $http mocks that don't resolve (stuck requests block drain).
- Use `window.__HARNESS_NO_SAFETY_DIGEST = true` (set before mount) if the widget's own code is starving the digest.
- Check the browser console for stuck promises (`.then()` chains that never complete).

---

## Deferred: Full E2E Render Suite

The following is out-of-scope for this harness-only worktree (requires parent Makefile + widgets-src):

- Render-state phase transitions across multiple mounts (idle → mounting → rendered → idle → mounting again).
- `$uibModal` faithfulness: resolving dependencies, $controller service use, open/close/dismiss cycles.
- Empty-state stability: 5 and 20 concurrent mocks; settle coverage.
- Safety-digest behavior: period granularity, actual digest tick counts.
- Render-error panel: visibility, edit modal, error formatting.

These tests must run via `make test-e2e-spec SPEC="…"` in the parent repo (boots the harness against real widgets, exercises the full boot pipeline).
