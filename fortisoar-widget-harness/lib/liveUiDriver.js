"use strict";
const soarEnv = require("./soarEnv");
// The generic real-SOAR browser session lives in soarBrowser.js -- the single
// source of truth for the desktop-UA / WAF-evasion / login invariants. This
// module is now the SOC-Assistant-drawer-specific layer ON TOP of it.
const soarBrowser = require("./soarBrowser");
// The mounted-widget session (sendChat / respondApprovals / close) is shared
// with localUiDriver -- see chatSession.ts for why it is not duplicated.
const chatSession_1 = require("./chatSession");
// The one live browser held across scenarios when reuse is enabled. Module
// state (not a param) because the callers are independent jest test bodies
// that have no place to thread a handle through.
let _shared = null;
/**
 * Tear down the shared browser. Call from a jest `afterAll` when reuse is on;
 * otherwise the held browser keeps the process alive and a completed run looks
 * like a hang.
 */
async function closeSharedSession() {
    if (!_shared)
        return;
    const b = _shared.browser;
    _shared = null;
    await b.close().catch(() => { });
}
/**
 * Full flow: launch → login → navigate → open the SOC Assistant drawer.
 * Returns a session handle with sendChat/screenshot/close.
 *
 * opts: { module='alerts', recordUuid | mountPath (one required), visitFirst,
 *         headless=true, env, reuse }
 */
async function openWidgetDrawer(opts = {}) {
    const soarEnvResult = soarEnv.resolveSoarEnv(opts.env);
    if (!opts.recordUuid && !opts.mountPath) {
        throw new Error("openWidgetDrawer: one of recordUuid or mountPath is required");
    }
    const mod = opts.module || "alerts";
    const base = soarBrowser.baseUrl(soarEnvResult);
    // Record deep-links MUST be /modules/<module>/<uuid> (ui-router
    // main.modulesDetail) -- a bare /alerts/<uuid> silently redirects to the
    // dashboard. A caller-supplied mountPath is used verbatim.
    const target = opts.mountPath || `/modules/${mod}/${opts.recordUuid}`;
    const url = (p) => (/^https?:\/\//.test(p) ? p : `${base}${p.startsWith("/") ? "" : "/"}${p}`);
    // WAF boxes (FortiGuard inline IPS) fingerprint headless Chromium and serve a
    // login page whose "Sign In" button never enables. FSRPB_HEADED=1 forces a
    // real headed browser for live UI runs against such boxes.
    const headed = opts.headless === false || process.env.FSRPB_HEADED === "1";
    // --- browser reuse across scenarios -------------------------------------
    //
    // A matrix sweep paid browser launch + WAF login + first paint on EVERY row
    // (~30-45s of a ~2-4min row), even though consecutive rows usually drive the
    // SAME record. The widget already ships the only reset that matters: "+ New"
    // (`newConversation()`, data-testid="new-conversation") starts a fresh chat
    // session. So with reuse on we hold one browser/page open, click "+ New"
    // between rows, and re-navigate only when the row targets a different record.
    //
    // Opt-in (FSRPB_REUSE_BROWSER=1, or opts.reuse) because it trades isolation
    // for speed: rows then share cookies/localStorage and any widget state the
    // previous row left. A target change forces a re-navigation, which remounts
    // the widget and bounds that bleed; `closeSharedSession()` ends the run.
    const reuse = opts.reuse === true
        || (opts.reuse !== false && process.env.FSRPB_REUSE_BROWSER === "1");
    let browser, context, page, feed;
    let reusedSession = false;
    if (reuse && _shared && _shared.base === base && !_shared.page.isClosed()) {
        ({ browser, context, page, feed } = _shared);
        reusedSession = true;
    }
    else {
        // A shared session for a DIFFERENT box is not reusable -- close it rather
        // than leak a browser (the leak is what makes jest hang past the run).
        if (reuse && _shared)
            await closeSharedSession();
        ({ browser, context } = await soarBrowser.launchContext({ headless: !headed }));
        page = await context.newPage();
        feed = (0, chatSession_1.captureChatFeed)(page);
        await soarBrowser.login(page, base, soarEnvResult);
        if (reuse)
            _shared = { browser, context, page, feed, base, target: null };
    }
    const goto = async (p) => {
        await page.goto(url(p), { waitUntil: "domcontentloaded", timeout: 60000 });
        // WAIT FOR THE CONDITION, not a fixed guess -- same lesson as the composer
        // wait below, which this line used to violate. A flat waitForTimeout(10000)
        // is enough for a record page (~4s to icons) but NOT for the playbook
        // designer: on 8.0 that page has rendered NO drawer icons and not even
        // resolved `$state` at 10s (measured: logo-sm total=0, state="" at 10.0s;
        // icons land 12-14s). Sampling once at 10s therefore found no titled icon,
        // skipped the composer wait entirely, and fell into the blind .sub-block
        // click-loop -- a DETERMINISTIC "composer not found" on every B-row that
        // looked like a widget/enableFor bug but was purely this timing.
        await page
            .waitForFunction(() => document.querySelectorAll("img.logo-sm").length > 0, undefined, { timeout: 45000 })
            .catch(() => { });
        await page.waitForTimeout(1500); // let the icon row settle after first paint
        // FortiSOAR renders the right-edge drawer icons on its /not-found page too,
        // so a bad path (a bare `/dashboard` without ?module=<uuid>, a stale record
        // uuid) still opens a composer and the turn "works" -- with no entity
        // context. That silently turns a broken mount into a green scenario. Fail
        // loudly instead: the SPA rewrites the URL to /not-found on a bad route.
        if (/\/not-found/.test(new URL(page.url()).pathname)) {
            throw new Error(`openWidgetDrawer: "${p}" resolved to /not-found on this box -- the drawer would still ` +
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
     * click-loop for older layouts. Idempotent -- safe to call after a nav.
     */
    const widgetTitle = opts.widgetTitle || process.env.FSRPB_WIDGET_TITLE || "FortiAI Agentic Assistant";
    const openDrawer = async () => {
        if (await page.$(chatSession_1.COMPOSER))
            return true;
        const titledIcon = await page.$(`img.logo-sm[title="${widgetTitle}"]`);
        // The icon is in the DOM on EVERY page, but FortiSOAR hides it where the
        // widget's `metadata.view.enableFor` states don't match the current route
        // (a dashboard is not an enableFor state for a modules/playbook drawer).
        // Present-but-hidden is therefore "not available here", not "slow to mount"
        // -- waiting or click-looping can never fix it. Say so, because the symptom
        // otherwise surfaces as a generic "composer not found" and reads like a
        // widget bug. NB: a DOM `element.click()` in devtools DOES fire on the
        // hidden icon and appears to work, which makes this doubly misleading -- only
        // a real (Playwright) click reveals it.
        if (titledIcon && !(await titledIcon.isVisible())) {
            throw new Error(`openWidgetDrawer: the "${widgetTitle}" drawer icon exists but is HIDDEN on this route ` +
                `(${new URL(page.url()).pathname}) -- the widget's metadata.view.enableFor does not cover ` +
                `this state, so the drawer cannot be opened here. Mount on an enableFor surface instead ` +
                `(module list / record detail / playbook designer).`);
        }
        if (titledIcon) {
            await titledIcon.click().catch(() => { });
            // WAIT FOR THE CONDITION, not a fixed guess. A hard `waitForTimeout(3000)`
            // then "if no composer, try the .sub-block loop" is actively harmful: on a
            // slower surface (a dashboard takes ~6s vs a record's ~3s) the composer
            // simply hasn't mounted yet, and the fallback loop then clicks the OTHER
            // drawer icons -- opening the native AI Assistant or toggling ours shut --
            // so a drawer that was opening correctly ends as "composer not found".
            // That is exactly how the P6a dashboard row failed while the same mount
            // worked by hand.
            try {
                await page.waitForSelector(chatSession_1.COMPOSER, { timeout: 25000 });
                return true;
            }
            catch (_) { /* fall through only if the titled icon truly didn't work */ }
        }
        // Legacy layouts (no titled icon): blind click-loop is the only option.
        if (!titledIcon && !(await page.$(chatSession_1.COMPOSER))) {
            const blocks = await page.$$(".sub-block");
            for (const blk of blocks) {
                await blk.click().catch(() => { });
                await page.waitForTimeout(2500);
                if (await page.$(chatSession_1.COMPOSER))
                    break;
            }
        }
        return !!(await page.$(chatSession_1.COMPOSER));
    };
    // `visitFirst` seeds the persistent drawer with ANOTHER page's entity context
    // before landing on the real target -- the only way to drive a stale-entity
    // (D1-class) scenario, where the drawer must carry page A's entity into
    // page B.
    if (opts.visitFirst) {
        await goto(opts.visitFirst);
        await openDrawer();
    }
    if (reusedSession) {
        // Re-navigate only on a target change; otherwise the page is already where
        // this row wants it and the nav would cost the same first-paint we're
        // trying to avoid.
        if (_shared.target !== target) {
            await goto(target);
            _shared.target = target;
        }
        await openDrawer();
        // Reset the CONVERSATION, not the browser. Without this the next row's
        // prompt lands in the previous row's session and inherits its transcript --
        // which would silently change what the model sees and make a row's verdict
        // depend on the row before it.
        const newBtn = await page.$(chatSession_1.NEW_CONVERSATION);
        if (newBtn) {
            await newBtn.click().catch(() => { });
            await page.waitForTimeout(1000);
        }
        // A row is graded from frames captured during ITS turn, so the shared
        // page's accumulated feed has to be cleared or row N would be graded on
        // rows 1..N's frames.
        feed.polls.length = 0;
        feed.turns.length = 0;
    }
    else {
        await goto(target);
        if (reuse && _shared)
            _shared.target = target;
    }
    const composerOpen = await openDrawer();
    return (0, chatSession_1.makeChatSession)({
        page, browser, context, base, feed, composerOpen,
        // Under reuse the shared browser outlives the row; only a non-reused (or
        // superseded) browser is ours to close here.
        closesBrowser: () => !(reuse && _shared && _shared.browser === browser),
    });
}
module.exports = { openWidgetDrawer, closeSharedSession, launchContext: soarBrowser.launchContext, login: soarBrowser.login, captureChatFeed: chatSession_1.captureChatFeed, DESKTOP_UA: soarBrowser.DESKTOP_UA };
