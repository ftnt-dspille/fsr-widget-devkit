"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NEW_CONVERSATION = exports.COMPOSER = void 0;
exports.captureChatFeed = captureChatFeed;
exports.makeChatSession = makeChatSession;
/**
 * The chat composer once the widget is mounted, in priority order.
 *
 * The `#custom-modal` prefixes match the deployed drawer; the bare `.composer`
 * fallbacks match the same widget mounted in the local harness (where it lives
 * in `#host`, not a SOAR modal). One selector therefore serves both drivers.
 */
exports.COMPOSER = '#custom-modal .composer textarea, #custom-modal .composer [contenteditable="true"], ' +
    '.composer textarea, .composer [contenteditable="true"], .composer input[type="text"]';
/** The widget's "+ New" control -- `newConversation()` in view.html. */
exports.NEW_CONVERSATION = '[data-testid="new-conversation"]';
/**
 * Attach a chat_poll / chat_turn capture to a page. Returns a `polls` array that
 * fills as the widget polls; each entry is {since, turn, frames, done}. This is
 * the proof surface for "are live messages streaming" -- a healthy turn yields
 * polls whose `turn` is non-null with frames>0 (the turn-counter desync bug made
 * every poll return turn:null / 0 frames).
 */
function captureChatFeed(page) {
    const polls = [];
    const turns = [];
    const sent = [];
    const settled = [];
    page.on("request", (r) => {
        if (!/integration\/execute/.test(r.url()))
            return;
        let req = {};
        try {
            req = r.postDataJSON() || {};
        }
        catch (_) {
            return;
        }
        if (typeof req.operation === "string" && /^chat_/.test(req.operation))
            sent.push(req.operation);
    });
    page.on("response", async (r) => {
        var _a, _b;
        if (!/integration\/execute/.test(r.url()))
            return;
        let req = {};
        try {
            req = r.request().postDataJSON() || {};
        }
        catch (_) {
            return;
        }
        const op = req.operation;
        if (op !== "chat_poll" && op !== "chat_turn" && op !== "chat_resume")
            return;
        let data = {};
        try {
            data = (await r.json()).data || {};
        }
        catch (_) { /* non-JSON */ }
        if (op === "chat_resume") {
            settled.push({ op, stopReason: data.stop_reason });
            return;
        }
        if (op === "chat_poll") {
            polls.push({
                since: (_a = req.params) === null || _a === void 0 ? void 0 : _a.since_turn,
                turn: data.turn,
                frames: (data.frames || []).length,
                done: !!data.done,
            });
        }
        else {
            turns.push({ detached: !!((_b = req.params) === null || _b === void 0 ? void 0 : _b.detached) });
        }
    });
    return { polls, turns, sent, settled };
}
/**
 * Build the session handle over an already-mounted widget.
 */
function makeChatSession({ page, browser, context, base, feed, composerOpen, closesBrowser, capture, }) {
    return {
        page, browser, context, base, polls: feed.polls, turns: feed.turns, composerOpen,
        /**
         * Type a message, send it, and wait until the turn's chat_poll feed reports
         * done (or timeout). Returns a summary proving whether live frames streamed.
         */
        async sendChat(text, { timeoutMs = 90000, pollEveryMs = 3000 } = {}) {
            const composer = await page.$(exports.COMPOSER);
            if (!composer)
                throw new Error("composer not found -- drawer did not open");
            const before = feed.polls.length;
            await composer.click();
            await composer.type(text, { delay: 15 });
            // Close the no-turn flake at its source: pressing Enter the instant typing
            // finishes can beat Angular's ng-model debounce, so the send handler reads
            // an empty model and no-ops -- the composer keeps the text and no chat_turn
            // fires. Dispatch an explicit input event and let the model settle before
            // submitting. (Enter is the widget's send trigger; do NOT click a
            // `.composer button` -- that matches the "Case context" button too and
            // would inject context instead of sending.)
            await composer.evaluate((el) => el.dispatchEvent(new Event("input", { bubbles: true })));
            await page.waitForTimeout(250);
            await page.keyboard.press("Enter");
            // Confirm the submit registered by watching for the turn to actually
            // start (a chat_turn/chat_poll request appears in the feed). This is the
            // unambiguous signal: if no poll fires within the verify window, the send
            // silently no-op'd (the ng-model debounce race) -- report
            // submitConfirmed=false so the matrix treats it as a drive error rather
            // than a bad agent verdict. (A "composer cleared" heuristic is unreliable:
            // the widget can inject case-context text into the box, so "text changed"
            // is not proof the turn was sent.)
            let submitConfirmed = false;
            const verifyDeadline = Date.now() + 8000;
            while (Date.now() < verifyDeadline) {
                await page.waitForTimeout(500);
                if (feed.polls.slice(before).some((p) => p.turn != null || p.frames > 0)) {
                    submitConfirmed = true;
                    break;
                }
            }
            const deadline = Date.now() + timeoutMs;
            while (Date.now() < deadline) {
                await page.waitForTimeout(pollEveryMs);
                const last = feed.polls[feed.polls.length - 1];
                if (last && last.done)
                    break;
            }
            const mine = feed.polls.slice(before);
            const streaming = mine.filter((p) => p.turn != null && p.frames > 0);
            return {
                polls: mine,
                sawStreamingTurn: streaming.length > 0, // the fix's acceptance signal
                maxFrames: Math.max(0, ...mine.map((p) => p.frames)),
                done: !!(mine[mine.length - 1] && mine[mine.length - 1].done),
                submitConfirmed: submitConfirmed || streaming.length > 0,
            };
        },
        /**
         * Decide any pending inline approval card(s) and wait for each resumed
         * turn to finish.
         *
         * Every tier-3 tool (which is every `run_playbook` against a device) stops
         * the turn at `approval_required`. Everything past that gate -- the
         * playbook's own deliverable, a `manual_input` chain -- is unreachable to a
         * driver that only types and presses Enter, so a scenario expecting a
         * post-approval card could never pass no matter how the agent behaved.
         *
         * Deliberately OPT-IN per scenario (matrixDriver's `autoApprove`): clicking
         * Approve executes a real mutating operation on a real appliance, so it
         * must never happen as a side effect of running the matrix.
         */
        async respondApprovals({ decision = "approve", timeoutMs = 120000, pollEveryMs = 3000, appearMs = 15000, maxRounds = 3, } = {}) {
            const sel = `[data-testid="approval-${decision}"]`;
            const startedAt = feed.polls.length;
            let approved = 0;
            let done = false;
            for (let round = 0; round < maxRounds; round++) {
                // A card only counts if its buttons are live: `ng-disabled="cardBusy(ev)"`
                // means an already-submitting or already-decided card still exists in
                // the transcript, and clicking it is a no-op that would burn a round.
                const deadline = Date.now() + (round === 0 ? appearMs : 5000);
                let btn = null;
                while (Date.now() < deadline) {
                    for (const el of await page.$$(sel)) {
                        if (await el.isVisible() && await el.isEnabled()) {
                            btn = el;
                            break;
                        }
                    }
                    if (btn)
                        break;
                    await page.waitForTimeout(500);
                }
                if (!btn)
                    break; // no (further) gate -- normal exit
                const before = feed.polls.length;
                const sentBefore = feed.sent.length;
                await btn.click();
                // Same contract as sendChat's submitConfirmed: prove the decision
                // reached the connector rather than trusting the click. Watch the
                // REQUEST feed, not the poll feed -- the click's job is to send
                // chat_resume, and the connector holds that request open for as long as
                // the approved playbook takes to run, so a response-level check reports
                // a slow-but-working approval as "the button did nothing".
                let registered = false;
                const verifyDeadline = Date.now() + 10000;
                while (Date.now() < verifyDeadline) {
                    await page.waitForTimeout(500);
                    if (feed.sent.slice(sentBefore).some((op) => op === "chat_resume") ||
                        feed.polls.slice(before).some((p) => p.turn != null || p.frames > 0)) {
                        registered = true;
                        break;
                    }
                }
                if (!registered) {
                    return {
                        approved, polls: feed.polls.slice(startedAt), done,
                        driveError: `an approval card was showing but the "${decision}" click never ` +
                            "registered -- no resumed-turn traffic followed. A drive/capture failure, " +
                            "not agent behaviour. Re-run the row.",
                    };
                }
                approved++;
                // The resumed turn can finish EITHER way: streaming through chat_poll,
                // or synchronously in the chat_resume response body. Watching only the
                // poll feed made an approval that had already answered look like a hung
                // turn -- it burned the full budget and then graded the row on frames it
                // never collected. Whichever channel reports first wins.
                const settledBefore = feed.settled.length;
                const turnDeadline = Date.now() + timeoutMs;
                done = false;
                while (Date.now() < turnDeadline) {
                    await page.waitForTimeout(pollEveryMs);
                    const last = feed.polls[feed.polls.length - 1];
                    if (last && last.done) {
                        done = true;
                        break;
                    }
                    if (feed.settled.length > settledBefore) {
                        done = true;
                        break;
                    }
                }
            }
            return { approved, polls: feed.polls.slice(startedAt), done, driveError: null };
        },
        async screenshot(path, full = false) {
            await page.screenshot({ path, fullPage: full });
            return path;
        },
        async saveCapture(label) {
            if (!capture)
                return null;
            // settle() FIRST: Playwright resolves response bodies asynchronously, so
            // writing on demand records whatever happened to have resolved -- which
            // systematically drops the tail of the last turn, i.e. the frames you
            // most want when something failed at the end. See lib/chatCapture.js.
            const payloads = await capture.settle();
            /* eslint-disable @typescript-eslint/no-var-requires */
            const fs = require("fs");
            const path = require("path");
            /* eslint-enable @typescript-eslint/no-var-requires */
            const dir = path.join(__dirname, "..", "test-results", "live");
            fs.mkdirSync(dir, { recursive: true });
            const safe = String(label).replace(/[^a-zA-Z0-9._-]+/g, "-");
            const file = path.join(dir, `${safe}.payloads.json`);
            fs.writeFileSync(file, JSON.stringify(payloads, null, 2));
            // Say what landed. A capture that silently recorded nothing looks exactly
            // like one that recorded a clean run -- the anti-oracle this whole
            // recorder exists to avoid.
            console.log(`[chatCapture] wrote ${payloads.length} chat payload(s) to ${file}`);
            return file;
        },
        async close() {
            // Under reuse the per-row `close()` must NOT kill the browser -- the
            // whole point is that the next row inherits it. matrixDriver calls this
            // in a finally block per row; the real teardown is the driver's
            // closeSharedSession() from the suite's afterAll.
            if (closesBrowser && !closesBrowser())
                return;
            await browser.close().catch(() => { });
        },
    };
}
