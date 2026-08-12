"use strict";
// LIVE DOM proof for the value-level patch_proposal card (#105, Phase 4).
//
// WHY THIS EXISTS. `patch_proposal` was `hermetic-only` in
// docs/CARD_DOM_COVERAGE.md, pinned by applyPatch/applyPatchResume against
// fixtures and by nothing else. Like the action card it carries a
// state-changing argument -- the replacement snippet that will be written into
// the analyst's open playbook -- so a card whose before/after panes render
// empty, or render the wrong side, is a change applied blind.
//
// WHAT IS PROVEN, AND WHAT IS NOT. This spec stops at the PROPOSED card: it
// asserts the card, its two snippets and its buttons, and does NOT click Apply.
// Applying would write to a real playbook on the box, and the resume half is
// already pinned hermetically (applyPatchResume) -- the thing a fixture could
// never close is whether the connector's real payload renders, and that is
// closed the moment the card is on screen with both snippets in it.
//
// WHY THIS ONE MAY LEGITIMATELY NOT STAGE. `emit_patch_proposal` is a
// VALUE-level fix on one step/field; `emit_enhancement_offer` is the whole-doc
// path, and a broad ask ("add error handling") reaches for the latter -- which
// is exactly what the matrix's B2 row does, and why it expects no cards at all.
// So the prompt below is deliberately narrow: one field, one step, one value.
// If the agent still routes to an enhancement offer, that is a routing fact
// about the model, NOT evidence the widget drops the card, and the failure
// message says so rather than letting a reader draw the wrong conclusion.
//
// LIVE + NON-MUTATING: the turn reads the open playbook. Nothing is applied.
//
// NOT YET CLAIMING patch_proposal. The claim marker below is deliberately
// broken (`covers-card-live` with a space) so tests/cardDomCoverage.test.js
// does NOT read it, because this spec has not yet passed on a box:
//
//   covers-card-live : patch_proposal
//
// On its first live run the turn never reached a patch card. It stopped on
// "Approval required: emit_patch_proposal (tier 3)" -- the change-affordance
// gate, which escalated the whole write frontier when the analyst had not
// pressed a change chip. A free-typed change request therefore paid for TWO
// approvals: one to permit drafting the edit, then the patch card's own
// Apply/Dismiss. The emit is pure, so the first one gated nothing; it is
// removed in the framework (CHANGE_GATED_TOOLS is now empty).
//
// That fix has to reach the BOX before this spec can pass, so the claim stays
// off and the registry keeps calling patch_proposal hermetic-only. Repairing
// the marker above (the at-sign, and no space before the colon) and flipping
// the registry row are one commit, to be made when this goes green live -- not
// before. Do not write the repaired marker anywhere else in this file, even in
// prose: the gate greps for it, so describing it is the same as claiming it.

const fs = require("fs");
const path = require("path");
const { openWidgetDrawer } = require("../../lib/liveUiDriver");

const CAPTURE_LABEL = "patch_proposal_value_fix";
const CAPTURE_DIR = path.join(__dirname, "captures");

const LIVE = process.env.E2E_LIVE === "1";
const d = LIVE ? describe : describe.skip;

// The designer mount is what forces build intent and puts a playbook in front
// of the agent -- `emit_patch_proposal` is dropped from the triage slice
// entirely, because triage has no open playbook to patch. Same real playbook
// the matrix's B2/B3 rows drive ('Link Similar Alerts', 5 steps, isActive).
const MOUNT = process.env.PP_MOUNT
  || "/playbooks/20f32ef0-5ca1-4293-b961-2cfea235d4bc";
const PROMPT = process.env.PP_PROMPT
  || "Look at the open playbook and propose a fix for exactly one field on one "
  + "step -- the smallest concrete value change you would make. Show it as a "
  + "before/after on that single field; do not rewrite the playbook.";

if (!LIVE) {
  console.warn("[patchProposal.live] SKIPPED -- set E2E_LIVE=1 (and a box env) "
    + "to run. The deployed patch proposal card is UNVERIFIED in this run.");
}

d("live: value-level patch_proposal renders both snippets (DOM)", () => {
  jest.setTimeout(480000);
  let session;
  let cardId = null;

  afterAll(async () => {
    // Write BEFORE closing -- closing kills the handlers still resolving, and
    // the tail of the turn is what explains a late failure.
    if (session) {
      try {
        await session.saveCapture(CAPTURE_LABEL);
      } catch (e) {
        console.warn("[patchProposal.live] capture write failed: " + e.message);
      }
      await session.close();
    }
  });

  test("the agent proposes the fix as a card, not as prose to copy by hand", async () => {
    session = await openWidgetDrawer({ mountPath: MOUNT, capture: true });
    expect(session.composerOpen).toBe(true);
    const page = session.page;

    const sent = await session.sendChat(PROMPT, { timeoutMs: 300000 });
    expect(sent.submitConfirmed).toBe(true);

    const card = page.locator('[data-testid^="patch-proposal-"]').first();
    try {
      await card.waitFor({ state: "visible", timeout: 150000 });
    } catch (e) {
      const seen = await page.evaluate(() => Array.from(
        document.querySelectorAll("[data-testid]"))
        .map((el) => el.getAttribute("data-testid"))
        .filter((t) => /^(patch-proposal|enhancement|playbook-offer|action-card|approval-)/.test(t)));
      fs.mkdirSync(CAPTURE_DIR, { recursive: true });
      await page.screenshot({
        path: path.join(CAPTURE_DIR, "patchProposal.missing.png"), fullPage: true,
      });
      throw new Error("no patch_proposal staged within 150s. Cards on screen: "
        + JSON.stringify(seen) + ". An `enhancement-` or `playbook-offer-` card "
        + "here means the agent took the WHOLE-DOC route instead of the "
        + "value-level one -- a routing fact about the model, not evidence the "
        + "widget drops the card, and this row must NOT be read as a render "
        + "failure. Screenshot: captures/patchProposal.missing.png. "
        + "Original: " + e.message);
    }

    const testid = await card.getAttribute("data-testid");
    cardId = (testid || "").replace(/^patch-proposal-/, "");
    expect(cardId).toBeTruthy();
    console.log("[patchProposal.live] patch_proposal id: " + cardId);

    // 1. BOTH sides of the change are on screen. A proposal showing only the
    //    "after" is a change the analyst approves without seeing what it
    //    replaces -- the same blind-approval shape as an empty args block on
    //    the action card.
    const before = page.locator(`[data-testid="patch-before-${cardId}"]`);
    const after = page.locator(`[data-testid="patch-after-${cardId}"]`);
    await before.waitFor({ state: "visible", timeout: 30000 });
    await after.waitFor({ state: "visible", timeout: 30000 });
    expect((await before.textContent() || "").trim().length).toBeGreaterThan(0);
    expect((await after.textContent() || "").trim().length).toBeGreaterThan(0);

    // 2. …and they are DIFFERENT. A card whose two panes render the same text
    //    is indistinguishable from a working one at a glance, and it is exactly
    //    what a renderer that reads one field for both panes would produce.
    expect((await after.textContent() || "").trim())
      .not.toBe((await before.textContent() || "").trim());

    // 3. Apply and Dismiss both exist, so accepting is a choice rather than the
    //    only way forward.
    const apply = page.locator(`[data-testid="patch-apply-${cardId}"]`);
    await apply.waitFor({ state: "visible", timeout: 30000 });
    expect(await apply.isEnabled()).toBe(true);
    expect(await page.locator(`[data-testid="patch-dismiss-${cardId}"]`).count()).toBe(1);

    // 4. Not dressed as an error while it waits on the analyst.
    expect(await page.locator(`[data-testid="patch-error-${cardId}"]`).count()).toBe(0);
  });

  test("nothing was applied, and the card does not pretend otherwise", async () => {
    if (!cardId) {
      throw new Error("[unapplied] no patch_proposal was staged -- this "
        + "assertion proves nothing on its own. Fix the first test; this one is "
        + "not independent evidence.");
    }
    const page = session.page;
    // This spec never clicks Apply, so a resolved/submitting card would mean
    // the widget resolved it on its own -- the write-without-a-click failure
    // that a card carrying a playbook edit can least afford.
    expect(await page.locator(`[data-testid="patch-submitting-${cardId}"]`).count()).toBe(0);
    expect(await page.locator(`[data-testid="patch-resolution-${cardId}"]`).count()).toBe(0);
  });
});
