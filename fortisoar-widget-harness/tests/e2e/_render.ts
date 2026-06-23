"use strict";
// Side-effect-free e2e helper (registers NO hooks; safe to require from any
// spec). The harness-level, widget-agnostic counterpart to
// `_waitForWidgetIdle.ts`: that one waits on a widget's OWN probe global; this
// one waits on the harness render state (window.__HARNESS_RENDER_STATE) and
// drains the digest/$http/$timeout queues via window.__harness.settle().
//
// Use it to replace ad-hoc `waitForTimeout(N)` + `scope().$apply()` pokes:
// after an interaction that schedules async work (a mock fetch, a modal
// open/close, a ui-grid filter change → grid.refresh()), `await settleRender`
// guarantees the DOM has caught up with the model before you assert.
//
// See docs/HARNESS_RENDERING_PLAN.md (P0/P1).
import { Page } from "@playwright/test";

interface RenderWaitOptions {
  timeout?: number;
  // If true (default), throw when the harness captured a controller/digest
  // throw (phase === 'error'), surfacing __HARNESS_RENDER_ERROR instead of
  // letting a later assertion fail opaquely.
  failOnError?: boolean;
}

// Wait for the initial mount to reach a terminal phase ('rendered' or 'error'),
// then settle. Throws with the captured render error if the mount errored.
export async function waitForRender(page: Page, opts?: RenderWaitOptions): Promise<void> {
  const { timeout = 15000, failOnError = true } = opts || {};
  await page.waitForFunction(
    () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- window globals are dynamic
      const s = (window as any).__HARNESS_RENDER_STATE;
      return !!s && (s.phase === "rendered" || s.phase === "error");
    },
    undefined,
    { timeout }
  );
  await settleRender(page);
  if (failOnError) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- evaluate result is dynamic
    const err = await page.evaluate(() => (window as any).__HARNESS_RENDER_STATE?.lastError || null);
    if (err) {
      const msg = err && (err.message || err.stack || JSON.stringify(err));
      throw new Error(
        "Widget render ERRORED during mount (window.__HARNESS_RENDER_STATE.phase === 'error'). " +
          "A controller/digest throw was swallowed by Angular and captured by the harness:\n  " +
          msg
      );
    }
  }
}

// Drain the app to quiescence: outstanding $http/templates, pending digests,
// and deferred $timeout / ui-grid canvas repaints. Idempotent and cheap — call
// it after any interaction whose effect lands asynchronously.
export async function settleRender(page: Page, settleOpts?: { timeoutMs?: number; cycles?: number }): Promise<void> {
  await page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- window globals are dynamic
    async (o) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- window globals are dynamic
      const h = (window as any).__harness;
      if (h && typeof h.settle === "function") await h.settle(o);
    },
    settleOpts || {}
  );
}
