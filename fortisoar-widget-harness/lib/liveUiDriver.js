"use strict";
const soarEnv = require("./soarEnv");
// The generic real-SOAR browser session lives in soarBrowser.js — the single
// source of truth for the desktop-UA / WAF-evasion / login invariants. This
// module is now the SOC-Assistant-drawer-specific layer ON TOP of it.
const soarBrowser = require("./soarBrowser");
// The chat composer once the drawer is mounted, in priority order.
const COMPOSER = '#custom-modal .composer textarea, #custom-modal .composer [contenteditable="true"], ' +
    '.composer textarea, .composer [contenteditable="true"], .composer input[type="text"]';
/**
 * Attach a chat_poll / chat_turn capture to a page. Returns a `polls` array that
 * fills as the widget polls; each entry is {since, turn, frames, done}. This is
 * the proof surface for "are live messages streaming" — a healthy turn yields
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
 * Full flow: launch → login → navigate → open the SOC Assistant drawer.
 * Returns a session handle with sendChat/screenshot/close.
 *
 * opts: { module='alerts', recordUuid | mountPath (one required), visitFirst,
 *         headless=true, env }
 */
async function openWidgetDrawer(opts = {}) {
    const soarEnvResult = soarEnv.resolveSoarEnv(opts.env);
    if (!opts.recordUuid && !opts.mountPath) {
        throw new Error("openWidgetDrawer: one of recordUuid or mountPath is required");
    }
    const mod = opts.module || "alerts";
    const base = soarBrowser.baseUrl(soarEnvResult);
    // Record deep-links MUST be /modules/<module>/<uuid> (ui-router
    // main.modulesDetail) — a bare /alerts/<uuid> silently redirects to the
    // dashboard. A caller-supplied mountPath is used verbatim.
    const target = opts.mountPath || `/modules/${mod}/${opts.recordUuid}`;
    const url = (p) => (/^https?:\/\//.test(p) ? p : `${base}${p.startsWith("/") ? "" : "/"}${p}`);
    // WAF boxes (FortiGuard inline IPS) fingerprint headless Chromium and serve a
    // login page whose "Sign In" button never enables. FSRPB_HEADED=1 forces a
    // real headed browser for live UI runs against such boxes.
    const headed = opts.headless === false || process.env.FSRPB_HEADED === "1";
    const { browser, context } = await soarBrowser.launchContext({ headless: !headed });
    const page = await context.newPage();
    const feed = captureChatFeed(page);
    await soarBrowser.login(page, base, soarEnvResult);
    const goto = async (p) => {
        await page.goto(url(p), { waitUntil: "domcontentloaded", timeout: 60000 });
        await page.waitForTimeout(10000); // record/page + widgets render
        // FortiSOAR renders the right-edge drawer icons on its /not-found page too,
        // so a bad path (a bare `/dashboard` without ?module=<uuid>, a stale record
        // uuid) still opens a composer and the turn "works" — with no entity
        // context. That silently turns a broken mount into a green scenario. Fail
        // loudly instead: the SPA rewrites the URL to /not-found on a bad route.
        if (/\/not-found/.test(new URL(page.url()).pathname)) {
            throw new Error(`openWidgetDrawer: "${p}" resolved to /not-found on this box — the drawer would still ` +
                `mount (with no entity), so this is failed loudly rather than passing silently. ` +
                `Check the path against the box: a dashboard needs ?module=<uuid>, the playbook ` +
                `designer is /playbooks/<collection-uuid>, records are /modules/<module>/<uuid>.`);
        }
    };
    /**
     * Open the drawer if it isn't already. 8.0 renders multiple drawer icons
     * (native "AI Assistant", "Playbook Developer Assistant", plus ours) as
     * `img.logo-sm[title=...]`, so a blind .sub-block click-loop opens the wrong
     * one. Target our widget's icon by its title first; fall back to the
     * click-loop for older layouts. Idempotent — safe to call after a nav.
     */
    const widgetTitle = opts.widgetTitle || process.env.FSRPB_WIDGET_TITLE || "FortiAI Agentic Assistant";
    const openDrawer = async () => {
        if (await page.$(COMPOSER))
            return true;
        const titledIcon = await page.$(`img.logo-sm[title="${widgetTitle}"]`);
        // The icon is in the DOM on EVERY page, but FortiSOAR hides it where the
        // widget's `metadata.view.enableFor` states don't match the current route
        // (a dashboard is not an enableFor state for a modules/playbook drawer).
        // Present-but-hidden is therefore "not available here", not "slow to mount"
        // — waiting or click-looping can never fix it. Say so, because the symptom
        // otherwise surfaces as a generic "composer not found" and reads like a
        // widget bug. NB: a DOM `element.click()` in devtools DOES fire on the
        // hidden icon and appears to work, which makes this doubly misleading — only
        // a real (Playwright) click reveals it.
        if (titledIcon && !(await titledIcon.isVisible())) {
            throw new Error(`openWidgetDrawer: the "${widgetTitle}" drawer icon exists but is HIDDEN on this route ` +
                `(${new URL(page.url()).pathname}) — the widget's metadata.view.enableFor does not cover ` +
                `this state, so the drawer cannot be opened here. Mount on an enableFor surface instead ` +
                `(module list / record detail / playbook designer).`);
        }
        if (titledIcon) {
            await titledIcon.click().catch(() => { });
            // WAIT FOR THE CONDITION, not a fixed guess. A hard `waitForTimeout(3000)`
            // then "if no composer, try the .sub-block loop" is actively harmful: on a
            // slower surface (a dashboard takes ~6s vs a record's ~3s) the composer
            // simply hasn't mounted yet, and the fallback loop then clicks the OTHER
            // drawer icons — opening the native AI Assistant or toggling ours shut —
            // so a drawer that was opening correctly ends as "composer not found".
            // That is exactly how the P6a dashboard row failed while the same mount
            // worked by hand.
            try {
                await page.waitForSelector(COMPOSER, { timeout: 25000 });
                return true;
            }
            catch (_) { /* fall through only if the titled icon truly didn't work */ }
        }
        // Legacy layouts (no titled icon): blind click-loop is the only option.
        if (!titledIcon && !(await page.$(COMPOSER))) {
            const blocks = await page.$$(".sub-block");
            for (const blk of blocks) {
                await blk.click().catch(() => { });
                await page.waitForTimeout(2500);
                if (await page.$(COMPOSER))
                    break;
            }
        }
        return !!(await page.$(COMPOSER));
    };
    // `visitFirst` seeds the persistent drawer with ANOTHER page's entity context
    // before landing on the real target — the only way to drive a stale-entity
    // (D1-class) scenario, where the drawer must carry page A's entity into
    // page B.
    if (opts.visitFirst) {
        await goto(opts.visitFirst);
        await openDrawer();
    }
    await goto(target);
    const composerOpen = await openDrawer();
    return {
        page, browser, context, base, polls: feed.polls, turns: feed.turns, composerOpen,
        /**
         * Type a message, send it, and wait until the turn's chat_poll feed reports
         * done (or timeout). Returns a summary proving whether live frames streamed.
         */
        async sendChat(text, { timeoutMs = 90000, pollEveryMs = 3000 } = {}) {
            const composer = await page.$(COMPOSER);
            if (!composer)
                throw new Error("composer not found — drawer did not open");
            const before = feed.polls.length;
            await composer.click();
            await composer.type(text, { delay: 15 });
            // Close the no-turn flake at its source: pressing Enter the instant typing
            // finishes can beat Angular's ng-model debounce, so the send handler reads
            // an empty model and no-ops — the composer keeps the text and no chat_turn
            // fires. Dispatch an explicit input event and let the model settle before
            // submitting. (Enter is the widget's send trigger; do NOT click a
            // `.composer button` — that matches the "Case context" button too and
            // would inject context instead of sending.)
            await composer.evaluate((el) => el.dispatchEvent(new Event("input", { bubbles: true })));
            await page.waitForTimeout(250);
            await page.keyboard.press("Enter");
            // Confirm the submit registered by watching for the turn to actually
            // start (a chat_turn/chat_poll request appears in the feed). This is the
            // unambiguous signal: if no poll fires within the verify window, the send
            // silently no-op'd (the ng-model debounce race) — report
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
         * the turn at `approval_required`. Everything past that gate — the
         * playbook's own deliverable, a `manual_input` chain — is unreachable to a
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
                    break; // no (further) gate — normal exit
                const before = feed.polls.length;
                const sentBefore = feed.sent.length;
                await btn.click();
                // Same contract as sendChat's submitConfirmed: prove the decision
                // reached the connector rather than trusting the click. Watch the
                // REQUEST feed, not the poll feed — the click's job is to send
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
                            "registered — no resumed-turn traffic followed. A drive/capture failure, " +
                            "not agent behaviour. Re-run the row.",
                    };
                }
                approved++;
                // The resumed turn can finish EITHER way: streaming through chat_poll,
                // or synchronously in the chat_resume response body. Watching only the
                // poll feed made an approval that had already answered look like a hung
                // turn — it burned the full budget and then graded the row on frames it
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
        async close() {
            await browser.close().catch(() => { });
        },
    };
}
module.exports = { openWidgetDrawer, launchContext: soarBrowser.launchContext, login: soarBrowser.login, captureChatFeed, DESKTOP_UA: soarBrowser.DESKTOP_UA };
