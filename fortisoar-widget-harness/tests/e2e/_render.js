"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.waitForRender = waitForRender;
exports.settleRender = settleRender;
// Wait for the initial mount to reach a terminal phase ('rendered' or 'error'),
// then settle. Throws with the captured render error if the mount errored.
async function waitForRender(page, opts) {
    const { timeout = 15000, failOnError = true } = opts || {};
    await page.waitForFunction(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- window globals are dynamic
        const s = window.__HARNESS_RENDER_STATE;
        return !!s && (s.phase === "rendered" || s.phase === "error");
    }, undefined, { timeout });
    await settleRender(page);
    if (failOnError) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- evaluate result is dynamic
        const err = await page.evaluate(() => { var _a; return ((_a = window.__HARNESS_RENDER_STATE) === null || _a === void 0 ? void 0 : _a.lastError) || null; });
        if (err) {
            const msg = err && (err.message || err.stack || JSON.stringify(err));
            throw new Error("Widget render ERRORED during mount (window.__HARNESS_RENDER_STATE.phase === 'error'). " +
                "A controller/digest throw was swallowed by Angular and captured by the harness:\n  " +
                msg);
        }
    }
}
// Drain the app to quiescence: outstanding $http/templates, pending digests,
// and deferred $timeout / ui-grid canvas repaints. Idempotent and cheap — call
// it after any interaction whose effect lands asynchronously.
async function settleRender(page, settleOpts) {
    await page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- window globals are dynamic
    async (o) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- window globals are dynamic
        const h = window.__harness;
        if (h && typeof h.settle === "function")
            await h.settle(o);
    }, settleOpts || {});
}
