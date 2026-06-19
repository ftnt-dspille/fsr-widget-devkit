"use strict";
/**
 * Live FortiSOAR UI driver — repeatable browser automation against the real
 * forticloud demo box (NOT the local harness). Encapsulates the hard-won quirks
 * of driving a deployed FortiSOAR 7.x SPA so other widget tests/scripts don't
 * re-derive them.
 *
 * Quirks this module owns (each a thing that silently breaks naive automation):
 *
 *  - **FortiGuard inline IPS blocks the default headless UA.** A bare
 *    Playwright/HeadlessChrome request to the box returns a "Web Page Blocked!"
 *    interstitial (FortiGuard Attack ID 20000051) even though authenticated API
 *    POSTs to /api/integration/execute/ pass fine. Presenting a real desktop
 *    Chrome User-Agent (+ Accept-Language) clears the signature. This is why the
 *    UI was historically "un-driveable" on forticloud — it was the WAF, not SSO.
 *  - **csadmin is a LOCAL login, not SSO.** The login form is `#username` +
 *    `#login_password`; submit via `button[type=submit]` / "Login". (verify-remote
 *    couldn't drive *SSO* — but the local admin bypasses SSO entirely.)
 *  - **Record deep-links use `/modules/<module>/<uuid>`** (ui-router state
 *    `main.modulesDetail`). A bare `/alerts/<uuid>` silently redirects to the
 *    dashboard.
 *  - **The SOC Assistant is a drawer widget**, toggled by a `.sub-block` button
 *    in the right-edge `#global-drawer`. When open it mounts as
 *    `#custom-modal .composer` (the chat input lives there).
 *  - **TLS**: the box may present certs the headless browser distrusts; we set
 *    ignoreHTTPSErrors + --ignore-certificate-errors (same allowance the harness
 *    proxy and live API client already make).
 *
 * Credentials come from the shared soarEnv resolver (env > keychain > .env).
 *
 * Usage (see tests/live/widgetUi.live.test.js and scripts/drive-live-widget.js):
 *
 *   const { openWidgetDrawer } = require("../lib/liveUiDriver");
 *   const s = await openWidgetDrawer({ module: "alerts", recordUuid });
 *   const res = await s.sendChat("What is the severity of this alert?");
 *   // res.sawStreamingTurn === true once chat_poll returns a non-null turn+frames
 *   await s.screenshot("/tmp/out.png");
 *   await s.close();
 */

const { resolveSoarEnv } = require("./soarEnv");
// The generic real-SOAR browser session lives in soarBrowser.js — the single
// source of truth for the desktop-UA / WAF-evasion / login invariants. This
// module is now the SOC-Assistant-drawer-specific layer ON TOP of it.
const { DESKTOP_UA, baseUrl, launchContext, login } = require("./soarBrowser");

// The chat composer once the drawer is mounted, in priority order.
const COMPOSER =
  '#custom-modal .composer textarea, #custom-modal .composer [contenteditable="true"], ' +
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
  page.on("response", async (r) => {
    if (!/integration\/execute/.test(r.url())) return;
    let req = {};
    try { req = r.request().postDataJSON() || {}; } catch (_) { return; }
    const op = req.operation;
    if (op !== "chat_poll" && op !== "chat_turn") return;
    let data = {};
    try { data = (await r.json()).data || {}; } catch (_) { /* non-JSON */ }
    if (op === "chat_poll") {
      polls.push({
        since: req.params && req.params.since_turn,
        turn: data.turn,
        frames: (data.frames || []).length,
        done: !!data.done,
      });
    } else {
      turns.push({ detached: !!(req.params && req.params.detached) });
    }
  });
  return { polls, turns };
}

/**
 * Full flow: launch → login → open record → open the SOC Assistant drawer.
 * Returns a session handle with sendChat/screenshot/close.
 *
 * opts: { module='alerts', recordUuid (required), headless=true, env }
 */
async function openWidgetDrawer(opts = {}) {
  const soar = resolveSoarEnv(opts.env);
  if (!opts.recordUuid) throw new Error("openWidgetDrawer: recordUuid is required");
  const mod = opts.module || "alerts";
  const base = baseUrl(soar);

  const { browser, context } = await launchContext({ headless: opts.headless !== false });
  const page = await context.newPage();
  const feed = captureChatFeed(page);

  await login(page, base, soar);
  await page.goto(`${base}/modules/${mod}/${opts.recordUuid}`, {
    waitUntil: "domcontentloaded", timeout: 60000,
  });
  await page.waitForTimeout(10000); // record + widgets render

  // Open the drawer: click each right-edge .sub-block until the composer mounts.
  const blocks = await page.$$(".sub-block");
  for (const blk of blocks) {
    await blk.click().catch(() => {});
    await page.waitForTimeout(2500);
    if (await page.$(COMPOSER)) break;
  }
  await page.waitForTimeout(2000);
  const composerOpen = !!(await page.$(COMPOSER));

  return {
    page, browser, context, base, polls: feed.polls, turns: feed.turns, composerOpen,

    /**
     * Type a message, send it, and wait until the turn's chat_poll feed reports
     * done (or timeout). Returns a summary proving whether live frames streamed.
     */
    async sendChat(text, { timeoutMs = 90000, pollEveryMs = 3000 } = {}) {
      const composer = await page.$(COMPOSER);
      if (!composer) throw new Error("composer not found — drawer did not open");
      const before = feed.polls.length;
      await composer.click();
      await composer.type(text, { delay: 15 });
      await page.keyboard.press("Enter");

      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        await page.waitForTimeout(pollEveryMs);
        const last = feed.polls[feed.polls.length - 1];
        if (last && last.done) break;
      }
      const mine = feed.polls.slice(before);
      const streaming = mine.filter((p) => p.turn != null && p.frames > 0);
      return {
        polls: mine,
        sawStreamingTurn: streaming.length > 0,    // the fix's acceptance signal
        maxFrames: Math.max(0, ...mine.map((p) => p.frames)),
        done: !!(mine[mine.length - 1] && mine[mine.length - 1].done),
      };
    },

    async screenshot(path, full = false) {
      await page.screenshot({ path, fullPage: full });
      return path;
    },

    async close() {
      await browser.close().catch(() => {});
    },
  };
}

module.exports = { openWidgetDrawer, launchContext, login, captureChatFeed, DESKTOP_UA };
