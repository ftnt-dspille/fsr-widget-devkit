"use strict";
// LIVE DOM proof for the capability_gap card (#105, Phase 4).
//
// WHY THIS EXISTS. `capability_gap` was fixture-pinned only, and the thing the
// fixture could never claim is stated in the registry itself: "that a REAL
// unconfigured connector produces a gap card". The card's whole job is to keep
// the analyst off a dead end when the instance cannot do what the
// investigation needs -- so a gap card that renders without its fix steps, or
// without its resume button, is precisely the dead end it exists to prevent.
//
// HOW THE GAP IS REACHED WITHOUT BREAKING THE BOX. The obvious way to force
// this card is to un-configure a connector, which perturbs shared box state and
// would leave the next person's live run failing for reasons that have nothing
// to do with their change. It is also unnecessary: the box ALREADY has honest
// gaps. `activedirectory` is installed but has no configuration, and nothing
// configured performs identity containment -- so asking to disable a user's AD
// account is a real capability gap, discovered rather than manufactured.
//
// That makes this spec READ-ONLY in effect: it asks for an action the box
// cannot perform, and the correct outcome is a card explaining why. Nothing is
// configured, nothing is disabled, no account is touched. If the box's
// inventory later changes so that identity containment IS available, this spec
// fails at the card wait, and the failure message says to re-pick a capability
// the box genuinely lacks rather than to "fix" the widget.
//
// WHAT IS NOT CLAIMED. Resume is NOT clicked. Clicking it re-runs the blocked
// discovery, and on a box where the gap is real that just loops back to the
// same card -- it would prove the button dispatches, not that the arc
// completes, and the resume arc stays hermetic.
//
// @covers-card-live(PENDING FIRST GREEN LIVE RUN): capability_gap
//
// The marker is deliberately malformed until this spec has gone green against a
// box -- same discipline as patchProposal.live and enhancementOffer.live. Flip
// it and the registry row together; the coverage gate asserts they agree.
//
// RUNNING IT: the harness's default .env points at a host that answers 200 on
// /login but is not a working FortiSOAR, which presents as a selector bug at
// login. Point the run at a box env explicitly:
//   set -a && . ./.env.<box> && set +a && E2E_LIVE=1 npm run test:live

const fs = require("fs");
const path = require("path");
const { openWidgetDrawer } = require("../../lib/liveUiDriver");

// Name the label for the SCENARIO, not the card. An earlier revision kept one
// label across a changed prompt and the re-run silently overwrote the capture
// that a filed finding cited as its evidence.
const CAPTURE_LABEL = "capability_gap_email_quarantine";
const CAPTURE_DIR = path.join(__dirname, "captures");

// OPT-IN, and not by accident. This spec is kept because the work in it is
// real -- the mount, the target-selection reasoning and the assertions are all
// sound -- but on a box whose alert corpus is entirely network/traffic alerts
// it CANNOT reach the card (see the header). A spec that fails every live run
// trains people to ignore the live suite, and the registry already records the
// gap honestly. So it stays one env var away rather than red by default:
//
//   CG_ENABLE=1 E2E_LIVE=1 ... npx jest -c jest.live.config.js capabilityGap
//
// Turn it on when the box has a record the ask can ground on (a phishing alert)
// or a genuinely uncontainable target, then flip the marker + registry row.
const LIVE = process.env.E2E_LIVE === "1";
const ENABLED = LIVE && process.env.CG_ENABLE === "1";
const d = ENABLED ? describe : describe.skip;

// An ALERT mount, not the playbook designer: this is a triage-shaped ask
// ("contain this"), and the gap is discovered while looking for a containment
// action. The first draft of this spec mounted the designer and the turn went
// straight into build mode -- it drafted a whole disable-user playbook and
// reached for emit_playbook_offer instead of ever considering the gap. Same
// record the action-card spec drives.
const MODULE = process.env.CG_MODULE || "alerts";
const RECORD = process.env.CG_RECORD || "e94dc2dc-23c0-4b8f-a13f-02a1bb147c5f";
// WHICH TARGET, AND WHY IT IS NOT AN OBVIOUS ONE. The gap branch in
// `find_containment_actions` fires only on `if not actions` -- ZERO configured
// containment actions for the target type. Probing the box directly:
//
//   user 1 action · ip 2 · host 3 · endpoint 3 · url 4   -> no card
//   email 0 · domain 0 · process 0                       -> gap card offered
//
// so an identity ask does NOT reach this card here: one partially-relevant
// action (a FortiSIEM OAuth revoke) is enough to suppress the branch, even
// though nothing on the box can disable an AD account. That is a real product
// finding, filed as #125 -- it is NOT what this spec grades, and picking
// `user` here would grade the model's prose instead of the card's DOM.
//
// THE TABLE IS NECESSARY BUT NOT SUFFICIENT, which cost a run: a `domain` ask
// has zero DOMAIN actions and still reached an approval card, because the agent
// generalised it to URL/web filtering on the configured firewall (`url` has 4).
// So the target must be one where no CONFIGURED connector has a plausible
// neighbouring capability either. Mailbox quarantine is that: the only mail
// connectors on the box (exchange, imap) are installed but unconfigured, and
// nothing in the network or endpoint estate can pull a message from a mailbox.
//
// The gap is DISCOVERED rather than manufactured -- nothing is configured,
// changed, or cleaned up to reach it.
const PROMPT = process.env.CG_PROMPT
  || "This phishing mail landed in about forty mailboxes. Pull the message "
  + "out of every mailbox that received it, right now.";

if (!ENABLED) {
  console.warn("[capabilityGap.live] SKIPPED -- needs E2E_LIVE=1 AND CG_ENABLE=1 "
    + "(see the header: three live attempts could not reach the card on a box "
    + "whose alerts are all network-traffic ones). The deployed capability gap "
    + "card is UNVERIFIED, and docs/CARD_DOM_COVERAGE.md says so.");
}

d("live: a real missing capability renders a gap card with a way forward (DOM)", () => {
  jest.setTimeout(480000);
  let session;
  let gapId = null;

  afterAll(async () => {
    // Write BEFORE closing -- closing kills the handlers still resolving.
    if (session) {
      try {
        await session.saveCapture(CAPTURE_LABEL);
      } catch (e) {
        console.warn("[capabilityGap.live] capture write failed: " + e.message);
      }
      await session.close();
    }
  });

  test("the analyst gets a gap card, not a dead end or a silent refusal", async () => {
    session = await openWidgetDrawer({ module: MODULE, recordUuid: RECORD, capture: true });
    expect(session.composerOpen).toBe(true);
    const page = session.page;

    const sent = await session.sendChat(PROMPT, { timeoutMs: 300000 });
    expect(sent.submitConfirmed).toBe(true);

    const card = page.locator('[data-testid^="capability-gap-card-"]').first();
    try {
      await card.waitFor({ state: "visible", timeout: 180000 });
    } catch (e) {
      const seen = await page.evaluate(() => Array.from(
        document.querySelectorAll("[data-testid]"))
        .map((el) => el.getAttribute("data-testid"))
        .filter((t) => /^(capability-gap|choice-card|action-card|approval-|patch-proposal|enhancement-offer)/.test(t)));
      fs.mkdirSync(CAPTURE_DIR, { recursive: true });
      await page.screenshot({
        path: path.join(CAPTURE_DIR, "capabilityGap.missing.png"), fullPage: true,
      });
      throw new Error("no capability_gap staged within 180s. Cards on screen: "
        + JSON.stringify(seen) + ". READ THIS BEFORE BLAMING THE WIDGET: an "
        + "`action-card-` or `approval-` here means the box found a way to do "
        + "this after all -- a mail connector got configured, or the agent "
        + "generalised the ask onto a neighbouring capability (which is how "
        + "the earlier domain-blocking version of this prompt died: zero "
        + "DOMAIN actions, but the firewall's URL filtering was close enough). "
        + "Re-probe find_containment_actions per target type, and pick one "
        + "with ZERO actions AND no plausible neighbour on a configured "
        + "connector, rather than 'fixing' anything. Prose with no card is the "
        + "failure this card exists to prevent: the analyst asked for "
        + "something the instance cannot do and was left at a dead end. "
        + "Screenshot: captures/capabilityGap.missing.png. Original: "
        + e.message);
    }

    const testid = await card.getAttribute("data-testid");
    gapId = (testid || "").replace(/^capability-gap-card-/, "");
    expect(gapId).toBeTruthy();
    console.log("[capabilityGap.live] capability_gap id: " + gapId);

    // 1. It names WHAT is missing and WHY. A gap card with an empty head is an
    //    error dialog with extra steps.
    const missing = (await card.locator(".capgap-title").textContent() || "").trim();
    expect(missing.length).toBeGreaterThan("Capability gap:".length);
    expect((await card.locator(".capgap-why").textContent() || "").trim().length)
      .toBeGreaterThan(0);

    // 2. …and it gives the analyst something to DO. fix_steps is validated
    //    non-empty at the tool boundary, so zero rendered steps means the
    //    renderer dropped them between the wire and the screen -- the exact
    //    class of bug a fixture written by the renderer's author cannot catch.
    const steps = await card.locator(".capgap-steps li").count();
    if (steps === 0) {
      throw new Error("capability_gap " + gapId + " rendered NO fix steps. The "
        + "emit tool rejects an empty fix_steps, so the connector sent at "
        + "least one and the widget did not render it -- the analyst is "
        + "looking at a dead end wearing a capability-gap costume. Capture: "
        + CAPTURE_LABEL + ".payloads.json.");
    }

    // 3. The resume button exists and is live, so fixing the gap has a way back
    //    into the turn rather than forcing a fresh conversation.
    const resume = page.locator(`[data-testid="capgap-resume-${gapId}"]`);
    await resume.waitFor({ state: "visible", timeout: 30000 });
    expect((await resume.textContent() || "").trim().length).toBeGreaterThan(0);
    expect(await resume.isEnabled()).toBe(true);
  });

  test("nothing was resumed, and no containment was staged behind the card", async () => {
    if (!gapId) {
      throw new Error("[unresumed] no capability_gap was staged -- this "
        + "assertion proves nothing on its own. Fix the first test; this one "
        + "is not independent evidence.");
    }
    const page = session.page;
    // This spec never clicks Resume, so a resolved card would mean the widget
    // resolved it on its own.
    expect(await page.locator(`[data-testid="capgap-resolution-${gapId}"]`).count()).toBe(0);
    const card = page.locator(`[data-testid="capability-gap-card-${gapId}"]`);
    expect(await card.getAttribute("class")).not.toMatch(/\bresolved\b/);
    // And the gap must not coexist with a staged action for the same ask: a box
    // that cannot do this should not ALSO be offering to do it.
    expect(await page.locator('[data-testid^="action-card-"]').count()).toBe(0);
  });
});
