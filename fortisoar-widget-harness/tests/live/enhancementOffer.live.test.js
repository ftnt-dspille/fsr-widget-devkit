"use strict";
// LIVE DOM proof for the enhancement_offer card (#105, Phase 4).
//
// WHY THIS EXISTS. `enhancement_offer` was the weakest row in
// docs/CARD_DOM_COVERAGE.md: fixture-pinned only, and not even a member of the
// `RenderEvent` union -- the renderer reaches it through `(ev as any)`. That is
// precisely the shape a fixture cannot police, because the fixture was written
// by the same belief the renderer was.
//
// WHAT IT CARRIES. This card is the UPDATE counterpart of playbook_offer: an
// Apply writes `final_yaml` over the playbook the analyst already has open.
// Before the card existed, enhance mode printed YAML into prose and the widget
// SCRAPED it with _extractLastYamlFence() -- text no gate had verified. The
// card's whole reason to exist is that the bytes on screen are the bytes
// verify_enhancement passed. So the load-bearing live assertion is not "a card
// appeared", it is that the change summary and the reviewable YAML are both
// really in the DOM, on a real box, from a real connector payload.
//
// WHAT IS PROVEN, AND WHAT IS NOT. Like patchProposal.live, this spec stops AT
// the offered card: Apply is deliberately NOT clicked, because applying writes
// into a real playbook on a real box. The accept path stays hermetic
// (enhancementOffer.apply.controller.test.js). NOT claimed here: that a live
// Apply lands the edit, that the resumed turn reflects it, or that a warning
// row renders live (a clean enhancement has no warnings, and manufacturing one
// live would mean deliberately proposing a bad edit).
//
// LIVE + NON-MUTATING: the turn reads the open playbook and drafts an edit.
// Nothing is applied, nothing is pushed.
//
// @covers-card-live: enhancement_offer
//
// CLAIMED on the first green live run against a real box: the offer rendered
// with a change summary, the reviewable YAML behind the toggle, and both
// buttons; 37 payloads captured to captures/enhancement_offer_add_step.
// Until that run the marker above was deliberately malformed so the coverage
// gate could not read it -- the claim was off precisely because it was not yet
// true, exactly as patchProposal.live's was.
//
// WHICH BOX, BECAUSE THAT IS WHAT COST THE TIME. The harness's default `.env`
// points at a host that answers HTTP 200 on /login but is not a working
// FortiSOAR, so the driver reached a stripped login form with none of the ids
// `soarBrowser.login` waits for. That reads exactly like a selector bug and is
// not one. Point live runs at a box env explicitly:
//
//   set -a && . ./.env.<box> && set +a && E2E_LIVE=1 npm run test:live
//
// and note some boxes carry FSR_PORT, so a bare curl at the bare host 404s
// even when the box is healthy.
//
// WHY THE PROMPT IS BROAD, WHICH IS THE OPPOSITE OF patchProposal.live. The two
// cards split on scope: `emit_patch_proposal` is a VALUE-level fix on one
// step/field, `emit_enhancement_offer` is the whole-doc path. patchProposal.live
// therefore asks for exactly one field; this one asks for a structural change
// across the playbook. If the agent routes to a patch card instead, that is a
// routing fact about the model, NOT evidence the widget drops this card, and
// the failure message below says so rather than letting a reader conclude the
// renderer is broken.

const fs = require("fs");
const path = require("path");
const { openWidgetDrawer } = require("../../lib/liveUiDriver");

const CAPTURE_LABEL = "enhancement_offer_add_step";
const CAPTURE_DIR = path.join(__dirname, "captures");

const LIVE = process.env.E2E_LIVE === "1";
const d = LIVE ? describe : describe.skip;

// The designer mount forces build intent and puts a playbook in front of the
// agent -- the enhance tools are dropped from the triage slice, which has no
// open playbook to enhance. Same real playbook the matrix's B2/B3 rows and
// patchProposal.live drive ('Link Similar Alerts', 5 steps, isActive).
const MOUNT = process.env.EO_MOUNT
  || "/playbooks/20f32ef0-5ca1-4293-b961-2cfea235d4bc";
const PROMPT = process.env.EO_PROMPT
  || "Add error handling to the open playbook: after the steps that can fail, "
  + "add a step that records the failure so a run does not end silently. "
  + "Change the playbook itself -- do not just describe what you would do.";

if (!LIVE) {
  console.warn("[enhancementOffer.live] SKIPPED -- set E2E_LIVE=1 (and a box "
    + "env) to run. The deployed enhancement offer card is UNVERIFIED in this "
    + "run.");
}

d("live: enhancement_offer renders its change summary and verified YAML (DOM)", () => {
  jest.setTimeout(480000);
  let session;
  let offerId = null;

  afterAll(async () => {
    // Write BEFORE closing -- closing kills the handlers still resolving, and
    // the tail of the turn is what explains a late failure.
    if (session) {
      try {
        await session.saveCapture(CAPTURE_LABEL);
      } catch (e) {
        console.warn("[enhancementOffer.live] capture write failed: " + e.message);
      }
      await session.close();
    }
  });

  test("the edit arrives as an offer card, not as YAML to scrape out of prose", async () => {
    session = await openWidgetDrawer({ mountPath: MOUNT, capture: true });
    expect(session.composerOpen).toBe(true);
    const page = session.page;

    const sent = await session.sendChat(PROMPT, { timeoutMs: 300000 });
    expect(sent.submitConfirmed).toBe(true);

    const card = page.locator('[data-testid^="enhancement-offer-"]').first();
    try {
      await card.waitFor({ state: "visible", timeout: 180000 });
    } catch (e) {
      const seen = await page.evaluate(() => Array.from(
        document.querySelectorAll("[data-testid]"))
        .map((el) => el.getAttribute("data-testid"))
        .filter((t) => /^(enhancement-offer|patch-proposal|playbook-offer|action-card|approval-)/.test(t)));
      fs.mkdirSync(CAPTURE_DIR, { recursive: true });
      await page.screenshot({
        path: path.join(CAPTURE_DIR, "enhancementOffer.missing.png"), fullPage: true,
      });
      throw new Error("no enhancement_offer staged within 180s. Cards on "
        + "screen: " + JSON.stringify(seen) + ". A `patch-proposal-` card here "
        + "means the agent took the VALUE-level route instead of the whole-doc "
        + "one, and a `playbook-offer-` card means it drafted a NEW playbook "
        + "instead of editing the open one -- both are routing facts about the "
        + "model, not evidence the widget drops the card, and this row must NOT "
        + "be read as a render failure. Screenshot: "
        + "captures/enhancementOffer.missing.png. Original: " + e.message);
    }

    // The prefix matcher above also matches the card's own children
    // (`enhancement-offer-added-<id>` and friends), so recover the id from the
    // outer card and re-scope every later locator to it.
    const testid = await card.getAttribute("data-testid");
    offerId = (testid || "").replace(/^enhancement-offer-/, "");
    expect(offerId).toBeTruthy();
    console.log("[enhancementOffer.live] enhancement_offer id: " + offerId);

    // 1. The card says WHAT CHANGES. An offer with no change rows is an Apply
    //    button over an unstated edit -- the same blind-approval shape #120
    //    found on the record-write card, and the reason changeCount gates the
    //    whole `.eo-changes` block.
    const changeRows = await Promise.all(["added", "modified", "removed"].map(
      (kind) => page.locator(`[data-testid="enhancement-offer-${kind}-${offerId}"]`).count(),
    ));
    const shown = changeRows.reduce((a, b) => a + b, 0);
    if (shown === 0) {
      throw new Error("enhancement_offer " + offerId + " rendered with NO "
        + "added/changed/removed row. Either the connector sent empty "
        + "steps_added/modified/removed (a payload defect) or the renderer "
        + "dropped them (a render defect) -- read the capture "
        + CAPTURE_LABEL + ".payloads.json to tell which. Either way the "
        + "analyst is being asked to Apply an unstated edit.");
    }

    // 2. The bytes that will be written are REVIEWABLE. This is the claim the
    //    card exists to make: pre-card, enhance mode scraped a YAML fence out
    //    of prose. The toggle only renders when finalYaml is non-empty, so its
    //    absence is itself the finding.
    const review = page.locator(`[data-testid="enhancement-offer-review-${offerId}"]`);
    if (await review.count() === 0) {
      throw new Error("enhancement_offer " + offerId + " has no 'Review the "
        + "full playbook' toggle, which renders only when finalYaml is "
        + "non-empty. A live offer with no reviewable YAML means the analyst "
        + "would Apply bytes they cannot see -- exactly the pre-card "
        + "scrape-from-prose failure this card replaced.");
    }
    await review.click();
    const yaml = page.locator(`[data-testid="enhancement-offer-yaml-${offerId}"]`);
    await yaml.waitFor({ state: "visible", timeout: 30000 });
    const yamlText = (await yaml.textContent() || "").trim();
    expect(yamlText.length).toBeGreaterThan(0);
    // Not a stray fragment: whatever Apply writes has to look like a playbook.
    expect(yamlText).toMatch(/steps\s*:/);

    // 3. Apply and Not now both exist, so accepting is a choice rather than the
    //    only way forward.
    const accept = page.locator(`[data-testid="enhancement-offer-accept-${offerId}"]`);
    await accept.waitFor({ state: "visible", timeout: 30000 });
    expect(await accept.isEnabled()).toBe(true);
    expect(await page.locator(`[data-testid="enhancement-offer-decline-${offerId}"]`).count()).toBe(1);
  });

  test("nothing was applied, and the card does not pretend otherwise", async () => {
    if (!offerId) {
      throw new Error("[unapplied] no enhancement_offer was staged -- this "
        + "assertion proves nothing on its own. Fix the first test; this one is "
        + "not independent evidence.");
    }
    const page = session.page;
    // This spec never clicks Apply. A resolution footer here would mean the
    // widget resolved the offer on its own -- the write-without-a-click failure
    // a card that overwrites the analyst's open playbook can least afford.
    expect(await page.locator(`[data-testid="enhancement-offer-resolution-${offerId}"]`).count()).toBe(0);
    // The resolved class drives the same conclusion straight from the card's
    // own state, independent of whether a resolution string was set.
    const card = page.locator(`[data-testid="enhancement-offer-${offerId}"]`);
    expect(await card.getAttribute("class")).not.toMatch(/\bresolved\b/);
    // …and the actions the analyst has NOT taken are still on offer.
    expect(await page.locator(`[data-testid="enhancement-offer-accept-${offerId}"]`).count()).toBe(1);
  });
});
