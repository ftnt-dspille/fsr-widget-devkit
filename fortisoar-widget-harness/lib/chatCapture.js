// Wire capture for the live chat specs: every chat_* request/response this run
// saw, written to disk whatever the verdict.
//
// Why this is its own module rather than a closure inside one spec: the capture
// is the ground truth the hand-written fixtures get diffed against, so every
// live spec and every matrix row needs the same recorder, recording the same
// shape.
//
// THE TAIL-DROP. Playwright's `page.on("response")` handler is async, and the
// body is only known after `await r.json()`. A run that writes its capture the
// moment the test ends therefore writes whatever had resolved by then -- which
// systematically drops the END of the last turn, i.e. exactly the frames you
// need when a test fails at the end. Recording an unresolved handler as
// "nothing happened" is the same anti-oracle as any other graceful
// degradation: the artifact still looks complete.
//
// So every handler registers its promise, and `settle()` drains them before the
// write. It loops because draining takes real time, during which more responses
// can land.

const DEFAULT_SETTLE_MS = 15000;

/**
 * @param {{on: Function}} page  a Playwright page (only `.on` is used)
 * @param {{opPattern?: RegExp, urlPattern?: RegExp, timeoutMs?: number}} [opts]
 * @returns {{payloads: Array, settle: (ms?: number) => Promise<Array>, pending: () => number}}
 */
function createChatCapture(page, opts = {}) {
  const urlPattern = opts.urlPattern || /integration\/execute/;
  // `respond_manual_input` is a TURN op -- the fixture audit compares it in the
  // op sequence -- but it does not start with `chat_`. A `^chat_` default
  // therefore drops it from every recording, and the audit then reports the
  // fixture as diverging on an op the capture was never allowed to see. Any op
  // the audit grades must be recordable.
  const opPattern = opts.opPattern || /^(chat_|respond_manual_input)/;
  const defaultTimeout = opts.timeoutMs || DEFAULT_SETTLE_MS;

  const payloads = [];
  const inflight = new Set();

  page.on("response", (r) => {
    let req = {};
    try {
      if (!urlPattern.test(r.url())) return;
      req = r.request().postDataJSON() || {};
    } catch (_) {
      return;
    }
    const op = req.operation;
    if (typeof op !== "string" || !opPattern.test(op)) return;

    // Register BEFORE the first await, or `settle()` can observe an empty set
    // in the window between the response arriving and the body resolving --
    // the very race this module exists to close.
    const p = (async () => {
      let body = null;
      try {
        body = await r.json();
      } catch (_) {
        body = { _nonJson: true };
      }
      payloads.push({ op, params: req.params || null, response: body });
    })().catch(() => {}).then(() => {
      inflight.delete(p);
    });
    inflight.add(p);
  });

  async function settle(ms) {
    const deadline = Date.now() + (ms == null ? defaultTimeout : ms);
    // A handler can enqueue another handler's work; keep draining until the set
    // is genuinely empty (or we run out of patience, which we say out loud --
    // a truncated capture must never present as a complete one).
    while (inflight.size) {
      if (Date.now() > deadline) {
        console.warn(`[chatCapture] ${inflight.size} response handler(s) still `
          + `in flight after the settle timeout -- the capture is INCOMPLETE at `
          + `the tail.`);
        break;
      }
      await Promise.race([
        Promise.all([...inflight]),
        new Promise((res) => setTimeout(res, 50)),
      ]);
    }
    return payloads;
  }

  return { payloads, settle, pending: () => inflight.size };
}

module.exports = { createChatCapture, DEFAULT_SETTLE_MS };
