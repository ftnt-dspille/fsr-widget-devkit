"use strict";
// LIVE DOM proof for the choice_card card (#105, Phase 4).
//
// WHY THIS EXISTS. `choice_card` was fixture-pinned only. It is the card that
// makes a branching decision the ANALYST's rather than the model's -- the tool
// exists so the agent stops and asks with chips instead of asking in prose and
// then guessing at whatever comes back. A choice card that renders its prompt
// but drops its chips is worse than no card: the turn is halted waiting on a
// pick the analyst has no way to make.
//
// HOW THE BRANCH IS REACHED. No box state is perturbed and nothing is
// configured or run. The tool's own documentation names the canonical branch --
// "immediate action vs build a playbook" -- so the prompt below is a genuinely
// two-way ask that does not say which it wants. The agent choosing for us
// instead of asking is a routing fact about the model, not a render failure,
// and the failure message says so.
//
// WHAT IS NOT CLAIMED, AND WHY IT IS DELIBERATE. No chip is clicked. Picking
// resolves the branch and commits the turn down one of the two paths -- and on
// the immediate-action side that path leads toward staging containment against
// a real box. The registry's two open items for this card were live multi-select
// bounds (minSelect/maxSelect) and that a live choice reaches the connector;
// this spec closes NEITHER. It closes the render half: that a real connector
// payload produces a pickable card on screen. A single-select branch is what
// the agent emits naturally, so multi-select bounds stay hermetic rather than
// being forced by a contrived prompt.
//
// @covers-card-live: choice_card
//
// CLAIMED on the first green live run against a real box: the branch rendered
// as choice_card `choose_brute_force_response` with pickable chips; 46 payloads
// captured to captures/choice_card_branch. Until that run the marker was
// deliberately malformed so the coverage gate could not read it -- the claim
// was off precisely because it was not yet true.
//
// RUNNING IT: point the run at a box env explicitly --
//   set -a && . ./.env.<box> && set +a && E2E_LIVE=1 npm run test:live

const fs = require("fs");
const path = require("path");
const { openWidgetDrawer } = require("../../lib/liveUiDriver");

const CAPTURE_LABEL = "choice_card_branch";
const CAPTURE_DIR = path.join(__dirname, "captures");

const LIVE = process.env.E2E_LIVE === "1";
const d = LIVE ? describe : describe.skip;

const MOUNT = process.env.CC_MOUNT || "/playbooks/20f32ef0-5ca1-4293-b961-2cfea235d4bc";
// Deliberately two-way: a real finding, a clear need to respond, and no hint
// about whether to act now or bottle it into a playbook. Saying "handle it"
// rather than "block it" is the whole point -- an unambiguous ask would route
// straight to an action card and never reach this branch.
const PROMPT = process.env.CC_PROMPT
  || "We keep seeing the same brute-force source hitting us: 198.51.100.77. "
  + "I want this handled -- but I am not going to tell you how. Ask me which "
  + "way to go before you do anything.";

if (!LIVE) {
  console.warn("[choiceCard.live] SKIPPED -- set E2E_LIVE=1 (and a box env) to "
    + "run. The deployed choice card is UNVERIFIED in this run.");
}

d("live: a branching decision renders pickable chips (DOM)", () => {
  jest.setTimeout(480000);
  let session;
  let choiceId = null;

  afterAll(async () => {
    if (session) {
      try {
        await session.saveCapture(CAPTURE_LABEL);
      } catch (e) {
        console.warn("[choiceCard.live] capture write failed: " + e.message);
      }
      await session.close();
    }
  });

  test("the agent asks with chips, not with prose it then has to parse", async () => {
    session = await openWidgetDrawer({ mountPath: MOUNT, capture: true });
    expect(session.composerOpen).toBe(true);
    const page = session.page;

    const sent = await session.sendChat(PROMPT, { timeoutMs: 300000 });
    expect(sent.submitConfirmed).toBe(true);

    const card = page.locator('[data-testid^="choice-card-"]').first();
    try {
      await card.waitFor({ state: "visible", timeout: 180000 });
    } catch (e) {
      const seen = await page.evaluate(() => Array.from(
        document.querySelectorAll("[data-testid]"))
        .map((el) => el.getAttribute("data-testid"))
        .filter((t) => /^(choice-card|action-card|approval-|playbook-offer|capability-gap)/.test(t)));
      fs.mkdirSync(CAPTURE_DIR, { recursive: true });
      await page.screenshot({
        path: path.join(CAPTURE_DIR, "choiceCard.missing.png"), fullPage: true,
      });
      throw new Error("no choice_card staged within 180s. Cards on screen: "
        + JSON.stringify(seen) + ". An `action-card-` or `playbook-offer-` "
        + "here means the agent PICKED the branch itself instead of asking -- "
        + "a routing fact about the model, not evidence the widget drops the "
        + "card, and this row must NOT be read as a render failure. Prose "
        + "ending in a question is the same finding in its worse form: the "
        + "agent asked without the card, which is what emit_choice_card "
        + "exists to replace. Screenshot: captures/choiceCard.missing.png. "
        + "Original: " + e.message);
    }

    const testid = await card.getAttribute("data-testid");
    choiceId = (testid || "").replace(/^choice-card-/, "");
    expect(choiceId).toBeTruthy();
    console.log("[choiceCard.live] choice_card id: " + choiceId);

    // 1. The question is on screen. A chip row with no prompt asks the analyst
    //    to choose without saying what the choice is about.
    expect((await card.locator(".card-prompt").textContent() || "").trim().length)
      .toBeGreaterThan(0);

    // 2. …and there are chips to pick. The emit tool rejects fewer than two
    //    options, so a card rendering 0 or 1 chip is a halted turn the analyst
    //    cannot answer -- the failure mode this card can least afford, because
    //    the turn is BLOCKED on the pick.
    const chips = card.locator(".chips .pb-chip");
    const chipCount = await chips.count();
    if (chipCount < 2) {
      throw new Error("choice_card " + choiceId + " rendered " + chipCount
        + " chip(s). emit_choice_card rejects fewer than two options, so the "
        + "connector sent at least two and the widget did not render them. "
        + "The turn is halted waiting on a pick the analyst cannot make. "
        + "Capture: " + CAPTURE_LABEL + ".payloads.json.");
    }

    // 3. Every chip is labelled and actually clickable. A disabled chip on an
    //    unresolved card is an unanswerable question.
    for (let i = 0; i < chipCount; i += 1) {
      const chip = chips.nth(i);
      expect((await chip.textContent() || "").trim().length).toBeGreaterThan(0);
      expect(await chip.isEnabled()).toBe(true);
    }
  });

  test("nothing was picked, and no branch ran behind the card", async () => {
    if (!choiceId) {
      throw new Error("[unpicked] no choice_card was staged -- this assertion "
        + "proves nothing on its own. Fix the first test; this one is not "
        + "independent evidence.");
    }
    const page = session.page;
    // This spec never clicks a chip, so a resolution here would mean the widget
    // answered the analyst's question for them.
    expect(await page.locator(`[data-testid="choice-resolution-${choiceId}"]`).count()).toBe(0);
    const card = page.locator(`[data-testid="choice-card-${choiceId}"]`);
    expect(await card.getAttribute("class")).not.toMatch(/\bresolved\b/);
    // The whole point of halting on the branch is that neither path has been
    // taken yet: nothing staged for execution while the question is open.
    expect(await page.locator('[data-testid^="action-card-"]').count()).toBe(0);
  });
});
