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

import { Page, Response, Browser, BrowserContext } from "@playwright/test";
import soarEnv = require("./soarEnv");
// The generic real-SOAR browser session lives in soarBrowser.js — the single
// source of truth for the desktop-UA / WAF-evasion / login invariants. This
// module is now the SOC-Assistant-drawer-specific layer ON TOP of it.
import soarBrowser = require("./soarBrowser");

type SoarEnvResult = ReturnType<typeof soarEnv.resolveSoarEnv>;

/** Request payload from chat_poll or chat_turn operations. */
interface ChatOperation {
  operation?: string;
  params?: {
    since_turn?: number;
    detached?: boolean;
  };
}

/** Response data from chat_poll or chat_turn. */
interface ChatPollResponse {
  turn?: unknown;
  frames?: unknown[];
  done?: boolean;
}

/** Response from integration/execute endpoint. */
interface ExecuteResponse {
  data?: ChatPollResponse;
}

// The chat composer once the drawer is mounted, in priority order.
const COMPOSER =
  '#custom-modal .composer textarea, #custom-modal .composer [contenteditable="true"], ' +
  '.composer textarea, .composer [contenteditable="true"], .composer input[type="text"]';

interface Poll {
  since: number | undefined;
  turn: unknown;
  frames: number;
  done: boolean;
}

interface Turn {
  detached: boolean;
}

interface ChatFeed {
  polls: Poll[];
  turns: Turn[];
}

/**
 * Attach a chat_poll / chat_turn capture to a page. Returns a `polls` array that
 * fills as the widget polls; each entry is {since, turn, frames, done}. This is
 * the proof surface for "are live messages streaming" — a healthy turn yields
 * polls whose `turn` is non-null with frames>0 (the turn-counter desync bug made
 * every poll return turn:null / 0 frames).
 */
function captureChatFeed(page: Page): ChatFeed {
  const polls: Poll[] = [];
  const turns: Turn[] = [];
  page.on("response", async (r: Response) => {
    if (!/integration\/execute/.test(r.url())) return;
    let req: ChatOperation = {};
    try { req = r.request().postDataJSON() || {}; } catch (_) { return; }
    const op = req.operation;
    if (op !== "chat_poll" && op !== "chat_turn") return;
    let data: ChatPollResponse = {};
    try { data = (await r.json() as ExecuteResponse).data || {}; } catch (_) { /* non-JSON */ }
    if (op === "chat_poll") {
      polls.push({
        since: req.params?.since_turn,
        turn: data.turn,
        frames: (data.frames || []).length,
        done: !!data.done,
      });
    } else {
      turns.push({ detached: !!(req.params?.detached) });
    }
  });
  return { polls, turns };
}

interface SendChatOpts {
  timeoutMs?: number;
  pollEveryMs?: number;
}

interface SendChatResult {
  polls: Poll[];
  sawStreamingTurn: boolean;
  maxFrames: number;
  done: boolean;
  /**
   * Did the submit demonstrably register? True when a chat_turn/chat_poll
   * request appeared in the feed within the submit-verify window. False means
   * the send silently no-op'd (the ng-model debounce race behind the ~1-in-14
   * "no turn captured" flake) — the caller should treat the row as a drive
   * error, not a bad agent verdict. Deliberately NOT auto-retried here: a
   * resubmit could double-send a turn that was merely slow, so surfacing the
   * false is the contract and the matrix layer fails the row loudly.
   */
  submitConfirmed: boolean;
}

interface OpenWidgetDrawerOpts {
  module?: string;
  recordUuid?: string;
  /**
   * Mount the drawer on a NON-record surface (dashboard, playbook designer,
   * a module list) instead of a record deep-link — e.g. "/dashboards" or
   * "/playbooks". Mutually sufficient with recordUuid: supply one or the other.
   */
  mountPath?: string;
  /**
   * Navigate HERE first (a record deep-link like "/modules/keys/<uuid>"), open
   * the drawer, and only THEN go to `mountPath`. The drawer is persistent, so
   * this is how you reproduce a stale-entity bug: the drawer captures the first
   * page's entity context and carries it into the second page.
   */
  visitFirst?: string;
  headless?: boolean;
  widgetTitle?: string;
  env?: Record<string, string | undefined>;
}

interface WidgetDrawerSession {
  page: Page;
  browser: Browser;
  context: BrowserContext;
  base: string;
  polls: Poll[];
  turns: Turn[];
  composerOpen: boolean;
  sendChat(text: string, opts?: SendChatOpts): Promise<SendChatResult>;
  screenshot(path: string, full?: boolean): Promise<string>;
  close(): Promise<void>;
}

/**
 * Full flow: launch → login → navigate → open the SOC Assistant drawer.
 * Returns a session handle with sendChat/screenshot/close.
 *
 * opts: { module='alerts', recordUuid | mountPath (one required), visitFirst,
 *         headless=true, env }
 */
async function openWidgetDrawer(opts: OpenWidgetDrawerOpts = {}): Promise<WidgetDrawerSession> {
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
  const url = (p: string) => (/^https?:\/\//.test(p) ? p : `${base}${p.startsWith("/") ? "" : "/"}${p}`);

  // WAF boxes (FortiGuard inline IPS) fingerprint headless Chromium and serve a
  // login page whose "Sign In" button never enables. FSRPB_HEADED=1 forces a
  // real headed browser for live UI runs against such boxes.
  const headed = opts.headless === false || process.env.FSRPB_HEADED === "1";
  const { browser, context } = await soarBrowser.launchContext({ headless: !headed });
  const page = await context.newPage();
  const feed = captureChatFeed(page);

  await soarBrowser.login(page, base, soarEnvResult);

  const goto = async (p: string): Promise<void> => {
    await page.goto(url(p), { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(10000); // record/page + widgets render
    // FortiSOAR renders the right-edge drawer icons on its /not-found page too,
    // so a bad path (a bare `/dashboard` without ?module=<uuid>, a stale record
    // uuid) still opens a composer and the turn "works" — with no entity
    // context. That silently turns a broken mount into a green scenario. Fail
    // loudly instead: the SPA rewrites the URL to /not-found on a bad route.
    if (/\/not-found/.test(new URL(page.url()).pathname)) {
      throw new Error(
        `openWidgetDrawer: "${p}" resolved to /not-found on this box — the drawer would still ` +
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
  const openDrawer = async (): Promise<boolean> => {
    if (await page.$(COMPOSER)) return true;
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
      throw new Error(
        `openWidgetDrawer: the "${widgetTitle}" drawer icon exists but is HIDDEN on this route ` +
        `(${new URL(page.url()).pathname}) — the widget's metadata.view.enableFor does not cover ` +
        `this state, so the drawer cannot be opened here. Mount on an enableFor surface instead ` +
        `(module list / record detail / playbook designer).`);
    }
    if (titledIcon) {
      await titledIcon.click().catch(() => {});
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
      } catch (_) { /* fall through only if the titled icon truly didn't work */ }
    }
    // Legacy layouts (no titled icon): blind click-loop is the only option.
    if (!titledIcon && !(await page.$(COMPOSER))) {
      const blocks = await page.$$(".sub-block");
      for (const blk of blocks) {
        await blk.click().catch(() => {});
        await page.waitForTimeout(2500);
        if (await page.$(COMPOSER)) break;
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
    async sendChat(text: string, { timeoutMs = 90000, pollEveryMs = 3000 }: SendChatOpts = {}): Promise<SendChatResult> {
      const composer = await page.$(COMPOSER);
      if (!composer) throw new Error("composer not found — drawer did not open");
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
      await composer.evaluate((el: HTMLElement) =>
        el.dispatchEvent(new Event("input", { bubbles: true })));
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
        if (last && last.done) break;
      }
      const mine = feed.polls.slice(before);
      const streaming = mine.filter((p) => p.turn != null && p.frames > 0);
      return {
        polls: mine,
        sawStreamingTurn: streaming.length > 0,    // the fix's acceptance signal
        maxFrames: Math.max(0, ...mine.map((p) => p.frames)),
        done: !!(mine[mine.length - 1] && mine[mine.length - 1].done),
        submitConfirmed: submitConfirmed || streaming.length > 0,
      };
    },

    async screenshot(path: string, full: boolean = false): Promise<string> {
      await page.screenshot({ path, fullPage: full });
      return path;
    },

    async close(): Promise<void> {
      await browser.close().catch(() => {});
    },
  };
}

export = { openWidgetDrawer, launchContext: soarBrowser.launchContext, login: soarBrowser.login, captureChatFeed, DESKTOP_UA: soarBrowser.DESKTOP_UA };
