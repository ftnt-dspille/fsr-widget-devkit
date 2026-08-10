"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.closeSharedSession = closeSharedSession;
exports.openWidgetDrawer = openWidgetDrawer;
/**
 * Local widget driver -- the same `openWidgetDrawer` contract as
 * `liveUiDriver.ts`, but mounting the widget in the LOCAL dev harness against
 * the LOCAL connector sidecar instead of logging in to a deployed FortiSOAR box.
 *
 * ## Why this exists
 *
 * The matrix (`tests/live/matrix.live.test.js` + `tests/live/lib/matrixDriver.js`)
 * is the only real outcome grader for a chat turn -- `exportGrader`'s
 * RED_FLAG_RULES, the verdict ladder, the expected-card gate. Until this driver
 * it could only grade the SHIPPED path: a deployed widget talking to a deployed
 * connector. So every bug the grader can see cost a widget ship + a connector
 * ship + a login + ~2-4 min of headed browser per row, and the fast local loop
 * (`LOCAL_DEV.md`: harness + sidecar + a local LLM gateway) had no oracle at all
 * -- you drove it by hand and eyeballed the answer.
 *
 * The two halves of `captureScenario` split cleanly: the capture taps
 * `/integration/execute` traffic, which is the SAME endpoint in both worlds (on
 * a box the SPA posts to it; locally the harness forwards it to the sidecar).
 * Only the mount differed. This module is that mount.
 *
 * ## What it does and does NOT prove
 *
 * A local row grades the **connector code + the model + the widget** as they
 * exist in your working tree. It does NOT prove the deployment: the pinned
 * `fsr-playbooks` version, the connector's on-box install, the worker recycle.
 * That seam has its own gate (`release-ship` / `ship-verify`) and this driver is
 * not a substitute for it. It replaces the ITERATION loop, not the release gate.
 *
 * ## Differences from the live driver, all deliberate
 *
 *  - **No login, no WAF, no drawer icon.** The harness mounts the widget
 *    directly, so the whole `soarBrowser` login + `img.logo-sm` dance is gone.
 *  - **The widget must be forced out of mock mode.** `view.controller.js` treats
 *    localhost as mock-by-default; `?mode=real` overrides it. Without that the
 *    driver would grade the widget's own canned fixtures and every row would
 *    pass -- the single most dangerous way this could silently lie, so it is
 *    asserted after boot rather than assumed from the URL.
 *  - **`visitFirst` is unsupported and throws.** It reproduces stale-entity
 *    (D1-class) bugs by exploiting the SPA drawer's persistence across
 *    navigations. The harness remounts the widget per navigation, so the
 *    condition cannot occur here. Failing loudly beats running the row against a
 *    mount that structurally cannot exhibit the bug and reporting a pass.
 */
const test_1 = require("@playwright/test");
const chatSession_1 = require("./chatSession");
const DEFAULT_BASE = process.env.FSRPB_LOCAL_BASE || "http://localhost:4401";
const DEFAULT_WIDGET = "fortiaiAgenticAssistant";
/**
 * Seeded into `harness:config:<id>` before mount unless the caller supplies its
 * own. This is NOT a nicety: with no saved config the harness renders its
 * "Configure this widget to preview it" prompt and the widget never mounts at
 * all -- `__HARNESS_RENDER_STATE.phase` sits at `idle` forever, the probe never
 * attaches, and the row dies on a bare `waitForFunction` timeout that names
 * nothing. (Every committed e2e spec seeds a config for the same reason.)
 */
const DEFAULT_WIDGET_CONFIG = {
    connectorName: "connector-fsr-soc-assistant",
    defaultIntent: "triage",
    maxTurns: 10,
    showUsage: true,
};
// The one browser held across rows when reuse is enabled. Module state for the
// same reason as the live driver: the callers are independent jest test bodies
// with nowhere to thread a handle through.
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
 * Preflight the harness before spending a browser launch and an LLM turn on a
 * run that cannot mean what it claims.
 *
 * The second check exists because its failure mode is a SILENT wrong answer,
 * not an error: a harness running WITHOUT `FSR_LOCAL_CONNECTOR=1` happily
 * proxies `/api/integration/execute/` to the DEPLOYED connector on the box, so
 * the row would be graded green against code that is not the code under test.
 */
async function preflight(base) {
    let info;
    try {
        const r = await fetch(`${base}/_fsr/info`);
        if (!r.ok)
            throw new Error(`HTTP ${r.status}`);
        info = await r.json();
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(`local harness not reachable at ${base} (${msg}). Start it with the local ` +
            `connector wired in:\n  FSR_LOCAL_CONNECTOR=1 PORT=4401 node server.js\n` +
            `See LOCAL_DEV.md.`);
    }
    if (!info.localConnector) {
        throw new Error(`the harness at ${base} is running WITHOUT FSR_LOCAL_CONNECTOR=1, so ` +
            `/api/integration/execute/ proxies to the DEPLOYED connector on ` +
            `${info.proxyHost || "the box"} -- a local run would silently grade the ` +
            `shipped connector instead of your working tree. Restart it as:\n` +
            `  FSR_LOCAL_CONNECTOR=1 PORT=${new URL(base).port || "4401"} node server.js`);
    }
    return info;
}
/** Resolve the installed widget id (e.g. "fortiaiAgenticAssistant-1.0.29"). */
async function resolveWidgetId(base, name) {
    const r = await fetch(`${base}/_fsr/widgets`);
    const data = await r.json();
    const list = data.widgets || data;
    const w = (list || []).find((x) => x.name === name);
    if (!w || !w.id) {
        throw new Error(`widget "${name}" is not installed in the harness at ${base}. ` +
            `Check widgets-src/ and GET ${base}/_fsr/widgets.`);
    }
    return w.id;
}
/**
 * Mount the widget in the local harness and return the same session handle the
 * live driver returns.
 */
async function openWidgetDrawer(opts = {}) {
    if (opts.visitFirst) {
        throw new Error("localUiDriver: `visitFirst` is not supported. It reproduces a stale-entity " +
            "(D1-class) bug by exploiting the deployed SPA drawer's persistence across " +
            "navigations; the harness remounts the widget on every navigation, so that " +
            "condition cannot occur locally. Run this row against a box (MATRIX_TARGET=live) " +
            "rather than grading a mount that structurally cannot exhibit the bug.");
    }
    const base = opts.base || DEFAULT_BASE;
    const mod = opts.module || "alerts";
    const widgetName = opts.widgetName || DEFAULT_WIDGET;
    await preflight(base);
    const widgetId = await resolveWidgetId(base, widgetName);
    const ctx = opts.context
        || (opts.recordUuid ? "viewpanel"
            : /playbook/i.test(opts.mountPath || "") ? "playbook" : "dashboard");
    if (ctx === "viewpanel" && !opts.recordUuid) {
        throw new Error("localUiDriver: the viewpanel context needs a recordUuid to mount against");
    }
    // The mount identity for reuse purposes: a row targeting a different record
    // (or context) needs a real remount, exactly as a live row needs a re-nav.
    const target = `${ctx}:${mod}:${opts.recordUuid || opts.mountPath || ""}`;
    // `mode=real` is REQUIRED -- see the module docstring. Without it the widget
    // serves its own mock fixtures on localhost and every row passes vacuously.
    const url = `${base}/?widget=${encodeURIComponent(widgetId)}&mode=real`;
    const headless = opts.headless !== false && process.env.FSRPB_HEADED !== "1";
    const reuse = opts.reuse === true
        || (opts.reuse !== false && process.env.FSRPB_REUSE_BROWSER === "1");
    let browser, context, page, feed;
    let reusedSession = false;
    if (reuse && _shared && _shared.base === base && !_shared.page.isClosed()) {
        ({ browser, context, page, feed } = _shared);
        reusedSession = true;
    }
    else {
        if (reuse && _shared)
            await closeSharedSession();
        browser = await test_1.chromium.launch({ headless });
        context = await browser.newContext({ ignoreHTTPSErrors: true });
        page = await context.newPage();
        feed = (0, chatSession_1.captureChatFeed)(page);
        if (reuse)
            _shared = { browser, context, page, feed, base, target: null };
    }
    // Seed the harness's own UI prefs + the widget config BEFORE navigation. The
    // harness reads these from localStorage on boot (its `#widget-select` is
    // display:none and driven by a custom dropdown, so setting storage is the
    // supported programmatic path -- the same approach the committed e2e specs
    // take).
    await page.addInitScript(({ id, ctx, mod, rec, cfg }) => {
        localStorage.setItem("harness.widget", id);
        localStorage.setItem("harness.ctx", ctx);
        localStorage.setItem("harness.module", mod);
        if (rec)
            localStorage.setItem("harness.id", rec);
        if (cfg)
            localStorage.setItem("harness:config:" + id, JSON.stringify(cfg));
    }, {
        id: widgetId, ctx, mod, rec: opts.recordUuid || "",
        cfg: (opts.config || DEFAULT_WIDGET_CONFIG),
    });
    const mount = async () => {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
        // WAIT FOR THE CONDITION, not a fixed guess -- the same lesson the live
        // driver's `goto` learned the hard way. The widget attaches its test probe
        // (`window.__fortiaiAgenticAssistant__`, exposed whenever the host is
        // localhost) once the controller has booted, which is a far more honest
        // readiness signal than any DOM poll.
        try {
            await page.waitForFunction(() => {
                const w = window;
                return !!w.__fortiaiAgenticAssistant__ && typeof w.__fortiaiAgenticAssistant__.state === "string";
            }, undefined, { timeout: 45000 });
        }
        catch (_) {
            // A bare waitForFunction timeout names nothing, and the matrix reports it
            // as an anonymous DRIVE ERROR -- indistinguishable from a hung box. Read
            // the harness's own render state and say which of the two very different
            // things actually happened.
            const st = await page.evaluate(() => {
                var _a, _b;
                const w = window;
                return {
                    phase: ((_a = w.__HARNESS_RENDER_STATE) === null || _a === void 0 ? void 0 : _a.phase) || "(none)",
                    err: String(((_b = w.__HARNESS_RENDER_STATE) === null || _b === void 0 ? void 0 : _b.lastError) || ""),
                    record: !!w.__HARNESS_RECORD,
                };
            }).catch(() => ({ phase: "(unreadable)", err: "", record: false }));
            throw new Error(`localUiDriver: the widget never mounted (render phase "${st.phase}", ` +
                `record ${st.record ? "loaded" : "MISSING"}${st.err ? `, error: ${st.err}` : ""}). ` +
                (st.phase === "idle"
                    ? "Phase 'idle' means the harness never started the mount -- almost always the " +
                        "\"Configure this widget to preview it\" prompt, i.e. no saved widget config. " +
                        "Pass `config` or rely on DEFAULT_WIDGET_CONFIG."
                    : "Check the harness log and the widget's controller for a boot throw."));
        }
        // Prove we are NOT on the mock track. `?mode=real` is on the URL, but the
        // probe attaches on ANY localhost mount, so its presence proves nothing --
        // and a widget change that regressed the override would leave every row
        // grading canned fixtures and passing. Assert the state, don't assume it.
        const mocked = await page.evaluate(() => {
            const w = window;
            return !!(w.__fortiaiAgenticAssistant__ && w.__fortiaiAgenticAssistant__.mockActive);
        });
        if (mocked) {
            throw new Error("localUiDriver: the widget booted in MOCK mode despite ?mode=real, so it would " +
                "serve canned fixtures and every row would pass vacuously. Check _mockActive / " +
                "_isMockActive() in view.controller.js.");
        }
        await page.waitForSelector(chatSession_1.COMPOSER, { timeout: 30000 });
    };
    if (reusedSession) {
        if (_shared && _shared.target !== target) {
            await mount();
            _shared.target = target;
        }
        // Reset the CONVERSATION, not the browser -- without this the next row's
        // prompt inherits the previous row's transcript, which silently changes
        // what the model sees and makes a row's verdict depend on the row before it.
        const newBtn = await page.$(chatSession_1.NEW_CONVERSATION);
        if (newBtn) {
            await newBtn.click().catch(() => { });
            await page.waitForTimeout(1000);
        }
        // A row is graded from frames captured during ITS turn, so the shared
        // page's accumulated feed has to be cleared.
        feed.polls.length = 0;
        feed.turns.length = 0;
        feed.sent.length = 0;
        feed.settled.length = 0;
    }
    else {
        await mount();
        if (reuse && _shared)
            _shared.target = target;
    }
    const composerOpen = !!(await page.$(chatSession_1.COMPOSER));
    return (0, chatSession_1.makeChatSession)({
        page, browser, context, base, feed, composerOpen,
        closesBrowser: () => !(reuse && _shared && _shared.browser === browser),
    });
}
