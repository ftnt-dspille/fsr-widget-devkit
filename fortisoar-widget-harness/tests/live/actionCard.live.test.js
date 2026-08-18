"use strict";
// LIVE DOM proof for the containment action_card (#105, Phase 4).
//
// WHY THIS EXISTS. `action_card` was `hermetic-only` in
// docs/CARD_DOM_COVERAGE.md: every assertion about it came from a fixture, and
// #104 is the standing reminder that a fixture is its author's belief about the
// wire. This card is the one that carries STATE-CHANGING arguments -- the
// firewall rule, the host to isolate -- so "the widget renders what the
// connector actually sends" is not a nicety here. The failure mode a fixture
// cannot catch is the one #78/#120 already produced twice on other cards: keys
// the producer sends and the renderer silently drops, with a green hermetic
// spec over the top.
//
// WHAT IS PROVEN, AND WHAT IS NOT. This spec stops at the STAGED card. It does
// not click Confirm, so nothing here executes a containment op on the lab
// firewall. That is a deliberate limit, not an oversight -- the tier-3 gate
// past Confirm is what approvalToManualInput.live.test.js already drives, and
// pushing a real IP block from a coverage spec buys no evidence the staged card
// does not already give. The registry row says exactly this.
//
// LIVE + READ-ONLY-ISH: the turn runs a real investigation on a real box (read
// ops, enrichment). Nothing mutating is confirmed. Gated behind E2E_LIVE.
//
// @covers-card-live: action_card
// (read by tests/cardDomCoverage.test.js -- the registry in
// docs/CARD_DOM_COVERAGE.md may only call a card live-dom if a spec claims it.)

const fs = require("fs");
const path = require("path");
const { openWidgetDrawer } = require("../../lib/liveUiDriver");

// The capture label MUST equal the fixture this arc is ground truth for, or the
// audit matches it to nothing and the fixture stays UNVERIFIED while a
// recording of it sits on disk (the trap documented in
// approvalToManualInput.live.test.js).
const CAPTURE_LABEL = "action_card_containment";
const CAPTURE_DIR = path.join(__dirname, "captures");

const LIVE = process.env.E2E_LIVE === "1";

// The same record and phrasing the matrix's TB/TO rows use, because those are
// the two prompts already verified live to reach containment on this box. An
// explicit ORDER ("block that source IP") is what makes the agent stage the
// card immediately: an agent-initiated containment has to clear the
// investigation floor first, and a card that never stages is indistinguishable
// here from a card that renders wrong.
const MODULE = process.env.AC_MODULE || "alerts";
// The record and the containment target are BOX data, so they come from the box
// env (.env.<box>, gitignored) rather than living here: a lab address or record
// id baked into a tracked spec is live-capture provenance shipped to a public
// repo. There is deliberately no default -- a placeholder would be worse than
// absent, since it would drive a real turn at an address nobody chose.
const RECORD = process.env.AC_RECORD;
const AC_IP = process.env.AC_IP;
// Phrasing lifted from the live sweep's own containment scenario ("Block the IP
// <addr> on FortiGate"), which reports actionCards:1 against a real connector --
// so the trigger is evidenced rather than guessed. Point AC_IP at the source
// address of the box's own IPS-exploit alert (the one the matrix TB/TO rows
// use); an unrelated address will not reach containment.
const PROMPT = process.env.AC_PROMPT
  || (AC_IP ? `Block the IP ${AC_IP} on FortiGate.` : null);

// Never silently vanish: a skipped live gate that says nothing is
// indistinguishable from a passing one.
if (!LIVE) {
  console.warn("[actionCard.live] SKIPPED -- set E2E_LIVE=1 (and a box env) to "
    + "run. The deployed action card is UNVERIFIED in this run.");
} else if (!RECORD || !PROMPT) {
  console.warn("[actionCard.live] SKIPPED -- this box env sets no AC_RECORD "
    + "and/or AC_IP (or AC_PROMPT). Add them to .env.<box>; the action card is "
    + "UNVERIFIED in this run.");
}

const d = LIVE && RECORD && PROMPT ? describe : describe.skip;

d("live: containment action_card renders its arguments (DOM)", () => {
  jest.setTimeout(420000);
  let session;
  let cardId = null;

  afterAll(async () => {
    // Write BEFORE closing: closing the page kills the response handlers that
    // are still resolving, and the tail of the last turn is exactly the part
    // you need when the arc fails at the end.
    if (session) {
      try {
        await session.saveCapture(CAPTURE_LABEL);
      } catch (e) {
        console.warn("[actionCard.live] capture write failed: " + e.message);
      }
      await session.close();
    }
  });

  test("the agent stages a containment card rather than acting silently", async () => {
    session = await openWidgetDrawer({ module: MODULE, recordUuid: RECORD, capture: true });
    expect(session.composerOpen).toBe(true);
    const page = session.page;

    const sent = await session.sendChat(PROMPT, { timeoutMs: 240000 });
    // A turn that never streamed is a DRIVE failure, not a verdict on the
    // widget. Assert it separately so the two can never be confused.
    expect(sent.submitConfirmed).toBe(true);

    // The card may land a little after the turn's poll feed reports done (the
    // widget commits the transcript, then renders). Wait on the CONDITION.
    const card = page.locator('[data-testid^="action-card-"]').first();
    try {
      await card.waitFor({ state: "visible", timeout: 120000 });
    } catch (e) {
      // Diagnose rather than assert-and-shrug. "No action card" has two very
      // different causes -- the agent never staged one (a routing/model fact,
      // and an honest ENV-ish outcome), or it staged one the widget failed to
      // render (the bug this spec exists to catch). The DOM alone cannot tell
      // them apart, so dump what did arrive.
      const seen = await page.evaluate(() => Array.from(
        document.querySelectorAll("[data-testid]"))
        .map((el) => el.getAttribute("data-testid"))
        .filter((t) => /^(action-card|approval-|choice-|manual-input|capability-gap|info-card)/.test(t)));
      fs.mkdirSync(CAPTURE_DIR, { recursive: true });
      await page.screenshot({
        path: path.join(CAPTURE_DIR, "actionCard.missing.png"), fullPage: true,
      });
      throw new Error("no action_card staged within 120s. Cards on screen: "
        + JSON.stringify(seen) + ". If this lists an approval- or choice- card "
        + "instead, the agent took a different route to containment on this box "
        + "and the prompt needs revisiting -- that is NOT evidence the widget "
        + "drops the card. Screenshot: captures/actionCard.missing.png. "
        + "Original: " + e.message);
    }

    const testid = await card.getAttribute("data-testid");
    cardId = (testid || "").replace(/^action-card-/, "");
    expect(cardId).toBeTruthy();
    console.log("[actionCard.live] action_card id: " + cardId);

    // 1. The card carries the ARGUMENTS, not just a summary sentence. This is
    //    the whole point of staging: the analyst approves a specific call, and
    //    an args block that renders empty is how a card becomes a blank cheque
    //    (the #124-class defect that shipped on the enhancement offer).
    const args = page.locator(`[data-testid^="action-arg-${cardId}-"]`);
    expect(await args.count()).toBeGreaterThan(0);

    // 2. The value the analyst is being asked to approve is on screen. A card
    //    that names the operation and renders its labelled form, but does not
    //    carry the IP anywhere, is the approval-without-information failure the
    //    gate exists to prevent.
    //
    //    Read the CONTROL VALUES, not textContent: the args render as editable
    //    inputs/selects, and an input's value is not a text node -- a
    //    textContent assertion here passes or fails for reasons that have
    //    nothing to do with what the card will send.
    const argValues = await card.evaluate((el) => Array.from(
      el.querySelectorAll("input, select, textarea"))
      .map((c) => String(c.value == null ? "" : c.value)));
    console.log("[actionCard.live] arg values: " + JSON.stringify(argValues));
    expect(argValues.join(" | ")).toMatch(/10\.100\.88\.102/);

    // 3. Confirm exists and is actionable -- a staged card the analyst cannot
    //    act on strands the turn (the dead-end this project refuses).
    const confirm = page.locator(`[data-testid="action-confirm-${cardId}"]`);
    await confirm.waitFor({ state: "visible", timeout: 30000 });
    expect(await confirm.isEnabled()).toBe(true);

    // 4. …and Cancel does too, so approving is a CHOICE. A card with only one
    //    button is a prompt, not a gate.
    const cancel = page.locator(`[data-testid="action-cancel-${cardId}"]`);
    expect(await cancel.count()).toBe(1);

    // 5. Not dressed as an error while it is merely waiting on the analyst.
    expect(await page.locator(`[data-testid="action-error-${cardId}"]`).count()).toBe(0);
  });

  test("the staged card is not left claiming an outcome it never had", async () => {
    if (!cardId) {
      throw new Error("[outcome] no action_card was staged -- this assertion "
        + "proves nothing on its own. Fix the first test; this one is not "
        + "independent evidence.");
    }
    const page = session.page;
    // Nothing was confirmed in this run, so the card must still read as
    // pending. The mirror of #90: there the card claimed a live run had not
    // run; the same class of lie in this direction is a card that reads as
    // executed when the analyst never pressed anything.
    const card = page.locator(`[data-testid="action-card-${cardId}"]`).first();
    const text = (await card.textContent() || "").toLowerCase();
    expect(text).not.toMatch(/executed|approved & executed|action complete/);
    expect(await page.locator(`[data-testid="action-submitting-${cardId}"]`).count()).toBe(0);
  });
});
