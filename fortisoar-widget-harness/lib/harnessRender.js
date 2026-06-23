"use strict";
/* Deterministic render-settle + machine-readable render state for the harness.

   Browser-safe: a top-level IIFE with NO `import`/`export`, so `tsc` emits it
   verbatim (an `export` would produce a CommonJS wrapper that throws
   `module is not defined` when loaded via <script>). Loaded after
   harnessDrawer.js; augments the existing `window.__harness` object.

   Why this exists (see docs/HARNESS_RENDERING_PLAN.md): the harness has no
   periodic Angular digest, so async work (mock $http completing, a modal
   open/close, a ui-grid filter change → grid.refresh()) settles the DOM only
   when something happens to trigger the next digest. Tests/agents were forced
   to poll with arbitrary `waitForTimeout`s and poke `scope().$apply()`. This
   module turns "is the render done?" into a single awaitable signal.

   The injector lives in index.html's boot script, so index.html calls
   __harnessRender.setInjectorGetter(() => currentInjector) and drives the phase
   transitions; this module stays injector-source-agnostic. */
(function () {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- browser globals
    const w = window;
    const state = {
        phase: "idle",
        mountId: 0,
        lastError: null,
        lastSettleAt: 0,
        lastDigestAt: 0,
    };
    w.__HARNESS_RENDER_STATE = state;
    // index.html supplies the active injector (view vs edit-modal). Kept as a
    // getter so we always read the *current* one rather than a stale snapshot.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- AngularJS injector
    let injectorGetter = null;
    // Cancel handle for the ambient safety digest (null when not running).
    let safetyStop = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- AngularJS injector
    function injector() {
        try {
            return injectorGetter ? injectorGetter() : null;
        }
        catch (_) {
            return null;
        }
    }
    function nextTick() {
        return new Promise((r) => setTimeout(r, 0));
    }
    /* Drive the app to quiescence and resolve with a snapshot of render state.
  
       Each cycle: wait for no outstanding $http/template requests, flush a digest
       (so watchers + bindings update), then yield a macrotask so pending
       $timeout / requestAnimationFrame work (e.g. ui-grid's deferred canvas
       repaint) actually runs. A bounded loop of cycles handles the common
       fetch → digest → grid-schedules-render → digest → paint chain
       deterministically without an unbounded "until stable" check that could spin
       on a misbehaving widget. Bails at timeoutMs as a hard wall. */
    function settle(opts) {
        const timeoutMs = (opts && opts.timeoutMs) || 5000;
        const cycles = (opts && opts.cycles) || 4;
        const inj = injector();
        if (!inj)
            return Promise.resolve(snapshot());
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- AngularJS services
        let $browser, $rootScope;
        try {
            $browser = inj.get("$browser");
            $rootScope = inj.get("$rootScope");
        }
        catch (_) {
            return Promise.resolve(snapshot());
        }
        const deadline = Date.now() + timeoutMs;
        function noOutstanding() {
            return new Promise((r) => {
                try {
                    $browser.notifyWhenNoOutstandingRequests(() => r());
                }
                catch (_) {
                    r();
                }
            });
        }
        function flushDigest() {
            try {
                if (!$rootScope.$$phase)
                    $rootScope.$digest();
                state.lastDigestAt = Date.now();
            }
            catch (_) {
                /* a digest throw is surfaced via __HARNESS_RENDER_ERROR elsewhere */
            }
        }
        let i = 0;
        function step() {
            if (i >= cycles || Date.now() > deadline) {
                state.lastSettleAt = Date.now();
                return Promise.resolve(snapshot());
            }
            i++;
            return noOutstanding()
                .then(() => {
                flushDigest();
                return nextTick();
            })
                .then(step);
        }
        return step();
    }
    function snapshot() {
        return {
            phase: state.phase,
            mountId: state.mountId,
            lastError: state.lastError,
            lastSettleAt: state.lastSettleAt,
            lastDigestAt: state.lastDigestAt,
        };
    }
    // ---- API consumed by index.html (phase transitions) and tests (settle) ----
    const api = {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- AngularJS injector
        setInjectorGetter(fn) {
            injectorGetter = fn;
        },
        beginMount() {
            // A re-mount (widget switch / reload) bootstraps a fresh injector, so
            // cancel any safety digest bound to the previous one before it leaks.
            if (safetyStop)
                safetyStop();
            state.mountId += 1;
            state.phase = "mounting";
            state.lastError = null;
            return state.mountId;
        },
        // Called once the mount digest has settled. If the harness captured a
        // controller throw, reflect it as the error phase.
        endMount() {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- harness global
            const err = window.__HARNESS_RENDER_ERROR;
            if (err) {
                state.phase = "error";
                state.lastError = err;
            }
            else {
                state.phase = "rendered";
            }
            state.lastSettleAt = Date.now();
            return snapshot();
        },
        settle,
        state() {
            return snapshot();
        },
        // Ambient safety digest. The real SOAR app has constant digest activity
        // (websocket heartbeats, $interval timers) that flushes renders landing
        // outside a widget-initiated digest — e.g. a playbook-execution completion
        // callback that sets grid data, or any async whose `.then` runs after the
        // last digest. The harness has none of that, so such renders intermittently
        // stall (the DOM lags the model until something else pokes a digest). A
        // low-frequency $interval(noop) restores that ambient flush, making renders
        // deterministic for tests/agents. Default ON; disable for debugging a widget
        // that wrongly relies on the harness to render it for it via
        // window.__HARNESS_NO_SAFETY_DIGEST = true (set before mount).
        startSafetyDigest(intervalMs) {
            if (safetyStop)
                return; // already running
            if (w.__HARNESS_NO_SAFETY_DIGEST)
                return;
            const inj = injector();
            if (!inj)
                return;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- AngularJS $interval
            let $interval;
            try {
                $interval = inj.get("$interval");
            }
            catch (_) {
                return;
            }
            // invokeApply defaults true → each tick runs a digest. 250ms is well below
            // human perception and cheap, while keeping the e2e suite snappy.
            const promise = $interval(function () {
                state.lastDigestAt = Date.now();
            }, intervalMs || 250);
            safetyStop = function () {
                try {
                    $interval.cancel(promise);
                }
                catch (_) {
                    /* injector gone */
                }
                safetyStop = null;
            };
        },
        stopSafetyDigest() {
            if (safetyStop)
                safetyStop();
        },
    };
    w.__harnessRender = api;
    // Augment the stable programmatic API (defined in harnessDrawer.js) so probes
    // can call window.__harness.settle() / .renderState() alongside dump()/etc.
    if (w.__harness) {
        w.__harness.settle = settle;
        w.__harness.renderState = snapshot;
    }
})();
