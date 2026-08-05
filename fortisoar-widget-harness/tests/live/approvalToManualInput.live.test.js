"use strict";
// LIVE DOM proof for the approve -> parked run -> manual_input arc (#88 / #90).
//
// WHY THIS EXISTS SEPARATELY FROM THE MATRIX. The matrix grades the WIRE: it
// digests transcript frames, so a row can verdict PASS while the analyst's
// screen says the opposite. That is exactly how #90 survived -- the frames were
// perfect (`triggered:true`, a run_pk, a manual_input frame) while the approval
// card rendered "Approved -- but the action did not run" for a run that WAS
// live and parked on the box waiting for that same analyst.
//
// The hermetic spec (widgets-src/fortiaiAgenticAssistant/tests/e2e/
// fortiaiAgenticAssistant.approvalToManualInput.spec.js) pins the same
// assertions against a fixture and fails on a laptop. This one proves the
// deployed widget on a real appliance does it too -- the half a fixture can
// never close, because the payload comes from the connector rather than a file.
//
// Drives the SAME row the matrix uses (SKL-MI): 'Manual Input Demo - Collect
// Note' on a ztpf_devices record. That playbook pauses on a manual-input step
// by design, so the park is intrinsic, not incidental.
//
// LIVE + MUTATING: clicking Approve runs a real playbook on a real box, which
// is why it is gated behind E2E_LIVE like every other live spec here.

const fs = require("fs");
const path = require("path");
const { openWidgetDrawer } = require("../../lib/liveUiDriver");

// Every chat_turn / chat_resume / chat_poll body this run saw, written to disk
// whatever the verdict. Two reasons, and the second is the bigger one:
//
//  1. When the arc fails, the ONE fact that separates "the connector never sent
//     a manual_input" from "it sent one and the widget dropped it" is the raw
//     payload. The DOM tells you neither.
//  2. The hermetic fixtures under widgetAssets/fixtures/ are hand-written, and
//     #91 was seven green hermetic tests against a bug that reproduced on the
//     box every time -- because the fixture I invented tested the connector I
//     imagined. These captures are the ground truth to diff them against.
const CAPTURE_DIR = path.join(__dirname, "../../test-results/live");
const CAPTURE_FILE = path.join(CAPTURE_DIR, "approvalToManualInput.payloads.json");

function captureChatPayloads(page) {
  const captured = [];
  page.on("response", async (r) => {
    if (!/integration\/execute/.test(r.url())) return;
    let req = {};
    try { req = r.request().postDataJSON() || {}; } catch (_) { return; }
    const op = req.operation;
    if (typeof op !== "string" || !/^chat_/.test(op)) return;
    let body = null;
    try { body = await r.json(); } catch (_) { body = { _nonJson: true }; }
    captured.push({ op, params: req.params || null, response: body });
  });
  return captured;
}

function writeCapture(captured) {
  try {
    fs.mkdirSync(CAPTURE_DIR, { recursive: true });
    fs.writeFileSync(CAPTURE_FILE, JSON.stringify(captured, null, 2));
    console.log(`[approvalToManualInput.live] wrote ${captured.length} chat payload(s) `
      + `to ${CAPTURE_FILE}`);
  } catch (e) {
    // Never let the diagnostic sink the run it exists to explain.
    console.warn("[approvalToManualInput.live] capture write failed: " + e.message);
  }
}

const LIVE = process.env.E2E_LIVE === "1";
const d = LIVE ? describe : describe.skip;

const MODULE = process.env.MI_MODULE || "ztpf_devices";
const RECORD = process.env.MI_RECORD || "5b23794a-a657-4169-97d3-98698126d59f";
const PROMPT = process.env.MI_PROMPT
  || "Run the 'Manual Input Demo - Collect Note' playbook on this device.";

if (!LIVE) {
  // Never silently vanish: a skipped live gate that says nothing is
  // indistinguishable from a passing one.
  console.warn("[approvalToManualInput.live] SKIPPED -- set E2E_LIVE=1 (and a "
    + "box env) to run. The deployed approval card is UNVERIFIED in this run.");
}

d("live: approve -> parked run -> manual_input form (DOM)", () => {
  jest.setTimeout(420000);
  let session;
  // The three tests below are ONE arc against ONE live run: t1 parks it, t2
  // resumes it, t3 keeps using the session it left behind. They deliberately
  // share `session` rather than re-driving an approval each time -- every
  // Approve click executes a real mutating playbook on a real appliance, and a
  // per-test re-drive would triple that for no extra coverage. The cost is that
  // a failure in t1 makes t2/t3 meaningless, so each guards on `inputId` and
  // says so out loud instead of failing on a mystery locator.
  let inputId = null;
  let captured = [];
  const NOTE_TEXT = "live DOM check";

  afterAll(async () => {
    writeCapture(captured);
    if (session) await session.close();
  });

  // The one fact t2/t3 cannot proceed without. Assert it explicitly so a
  // cascading failure never reads as a NEW bug in the resume half.
  function requireParkedForm(step) {
    if (!inputId) {
      throw new Error(
        `[${step}] no manual_input id from the park step -- the arc never got `
        + "past the form rendering, so this assertion proves nothing about "
        + "resume. Fix the first test; this one is not independent evidence.");
    }
  }

  test("the form renders and the card does not claim the action failed", async () => {
    session = await openWidgetDrawer({ module: MODULE, recordUuid: RECORD });
    expect(session.composerOpen).toBe(true);
    const page = session.page;
    captured = captureChatPayloads(page);

    const sent = await session.sendChat(PROMPT);
    // A turn that never streamed is a DRIVE failure, not a verdict on the
    // widget -- assert it separately so the two can never be confused (the
    // lesson of the sweep rows that graded a dropped connection as agent
    // behaviour).
    expect(sent.submitConfirmed).toBe(true);

    // The tier-3 gate must appear, then be approved -- this is the click whose
    // aftermath the whole card is about.
    const approvals = await session.respondApprovals({ decision: "approve" });
    expect(approvals.driveError).toBeNull();
    expect(approvals.approved).toBeGreaterThan(0);

    // ── the assertions the matrix structurally cannot make ──────────────────

    // 1. The form the RUN is waiting on is on screen and fillable. Without it
    //    the run is stranded on the box: parked, with no way for anyone to
    //    answer it from chat.
    // Diagnostic FIRST: when this fails, the single most useful fact is whether
    // the manual_input event reached the widget's state but did not render, or
    // never arrived at all. Those are different bugs in different layers, and a
    // bare "locator not found" cannot tell them apart.
    const diag = async () => page.evaluate(() => {
      const p = window.__fortiaiAgenticAssistant__ || {};
      const evTypes = [];
      for (const m of (p.messages || [])) {
        for (const ev of (m.events || [])) evTypes.push(ev.type + (ev.type === 'manual_input' ? '#' + (ev.inputId || ev.id) : ''));
      }
      return {
        state: p.state, msgCount: p.messageCount,
        eventTypes: evTypes,
        manualInputTestids: Array.from(document.querySelectorAll('[data-testid^="manual-input"]')).map(e => e.getAttribute('data-testid')),
        approvalOutcome: (document.querySelector('[data-testid="approval-outcome"]') || {}).textContent,
        lastText: (p.lastTurn && (p.lastTurn.content || p.lastTurn.text) || '').slice(0, 300),
      };
    });
    for (let i = 0; i < 20; i++) {
      const d0 = await diag();
      if (d0.manualInputTestids.length || d0.eventTypes.some(t => t.startsWith('manual_input'))) break;
      await page.waitForTimeout(3000);
    }
    console.log("[approvalToManualInput.live] DIAG " + JSON.stringify(await diag(), null, 1));

    const form = page.locator('[data-testid^="manual-input-"]').first();
    await form.waitFor({ state: "visible", timeout: 60000 });
    const field = page.locator('[data-testid*="manual-input-field-"]').first();
    await field.waitFor({ state: "visible", timeout: 30000 });
    await field.fill(NOTE_TEXT);
    expect(await field.inputValue()).toBe(NOTE_TEXT);

    // The live inputId is assigned by the box, so every selector past this
    // point has to be derived rather than pinned the way the hermetic spec
    // pins 529.
    const fieldTestid = await field.getAttribute("data-testid");
    const m = /^manual-input-field-([^-]+)-/.exec(fieldTestid || "");
    inputId = m && m[1];
    if (!inputId) {
      throw new Error(`could not derive a manual_input id from the field testid `
        + `${JSON.stringify(fieldTestid)} -- the resume half cannot be driven`);
    }
    console.log("[approvalToManualInput.live] manual_input id: " + inputId);

    // 2. The approval card tells the truth about what happened (#90). It must
    //    NOT say the action did not run -- the run is live and parked.
    const outcome = page.locator('[data-testid="approval-outcome"]').first();
    await outcome.waitFor({ state: "visible", timeout: 30000 });
    const text = (await outcome.textContent() || "").trim();
    console.log("[approvalToManualInput.live] approval outcome text: " + JSON.stringify(text));
    expect(text).not.toMatch(/did not run/i);
    expect(text).toMatch(/waiting for your input/i);

    // 3. Not dressed as an error anywhere on the card.
    expect(await page.locator('[data-testid="approval-outcome-error"]').count()).toBe(0);
    expect(await page.locator('.resolution-failed').count()).toBe(0);
  });

  // ── the resume half: everything past the form ────────────────────────────
  //
  // Until this ran on a box, the arc was proven only up to a form that renders.
  // Whether SUBMITTING it actually continues the playbook was covered
  // hermetically and nowhere else -- and #91 is exactly the case where a
  // hermetic pass meant nothing, because the fixture I wrote was not the shape
  // the connector sends. So treat the fixture as a hypothesis and this as the
  // evidence.
  test("submitting the form resumes the run and the card resolves", async () => {
    requireParkedForm("submit");
    const page = session.page;

    const submit = page.locator(`[data-testid="manual-input-submit-${inputId}"]`);
    await submit.waitFor({ state: "visible", timeout: 15000 });
    // A submit button that is disabled here means `manualInputValid` rejects
    // the value we just typed -- a validation bug, not a resume bug. Separate
    // it from the click so the two can't be confused.
    expect(await submit.isEnabled()).toBe(true);
    await submit.click();

    // Resolve EITHER way, and never wait out the full timeout on a card that
    // already errored: a stuck spinner and a rejected resume look identical
    // from a bare `waitFor(resolution)`.
    const resolution = page.locator(`[data-testid="manual-input-resolution-${inputId}"]`);
    const errorCard = page.locator(`[data-testid="manual-input-error-${inputId}"]`);
    let resolved = false;
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline) {
      if (await errorCard.count()) break;
      if (await resolution.count() && await resolution.isVisible()) { resolved = true; break; }
      await page.waitForTimeout(2000);
    }

    // The gate has its own ~1-minute STEP timeout (not a claim-style retrieve),
    // and an expired gate retrieves as `{}`. If that is what we hit, the error
    // must say so -- a silent failure or a false success is the demo-killing
    // outcome, because the analyst reads "submitted" and the run never moves.
    if (await errorCard.count()) {
      const errText = (await errorCard.textContent() || "").trim();
      throw new Error(
        "submit was rejected by the box -- the run did NOT resume. Card error: "
        + JSON.stringify(errText) + ". If this reads as an expired/unknown "
        + "manual-input id, the gate's step timeout elapsed while the form sat "
        + "on screen; that is issue #2 in the follow-up plan, not a widget bug.");
    }
    if (!resolved) {
      throw new Error("the manual-input card never resolved and never errored -- "
        + "it is still parked on screen, so the resume never completed. The run "
        + "is live on the box waiting on a gate nobody can now answer.");
    }

    // Resolved means the connector accepted the resume, not merely that the
    // widget greyed the card out: `_resolveCardVia` only sets it on success.
    expect((await resolution.textContent() || "")).toMatch(/Manual input submitted/i);
    // The form is consumed -- it must not stay clickable, or the analyst can
    // submit the same gate twice.
    expect(await page.locator(`[data-testid="manual-input-submit-${inputId}"]`).count()).toBe(0);
    expect(await page.locator('[data-testid="approval-outcome-error"]').count()).toBe(0);

    // And the run's own outcome comes back into the chat, rather than the
    // transcript ending at the form. The text is model-authored so it cannot be
    // pinned live -- assert a real turn landed and log it for eyeballing.
    const after = await page.evaluate(() => {
      const p = window.__fortiaiAgenticAssistant__ || {};
      return {
        state: p.state, msgCount: p.messageCount,
        lastText: (p.lastTurn && (p.lastTurn.content || p.lastTurn.text) || ""),
      };
    });
    console.log("[approvalToManualInput.live] post-resume " + JSON.stringify(after, null, 1));
    expect(after.lastText.trim().length).toBeGreaterThan(0);
  });

  test("an unrelated question in the same session still gets a normal answer", async () => {
    requireParkedForm("follow-up");
    const page = session.page;

    // A session that strands after gated + parked + resumed is still broken
    // from where the analyst sits. Every state this arc touches (the approval
    // singleton, the pending-card gate, viewState) is a way to leave the
    // composer dead or swallow the next prompt.
    const before = await page.evaluate(
      () => (window.__fortiaiAgenticAssistant__ || {}).messageCount);

    const sent = await session.sendChat("How do I triage a phishing report?");
    // Drive failure vs. product failure, kept apart as everywhere else here.
    expect(sent.submitConfirmed).toBe(true);

    const after = await page.evaluate(() => {
      const p = window.__fortiaiAgenticAssistant__ || {};
      return {
        state: p.state, msgCount: p.messageCount,
        lastText: (p.lastTurn && (p.lastTurn.content || p.lastTurn.text) || ""),
      };
    });
    console.log("[approvalToManualInput.live] follow-up " + JSON.stringify(after, null, 1));
    expect(after.msgCount).toBeGreaterThan(before);
    expect(after.lastText.trim().length).toBeGreaterThan(0);
    // It answered the NEW question rather than replaying the playbook arc.
    expect(after.lastText).toMatch(/phish/i);

    // The old cards stay resolved: no gate re-raised, no second form.
    expect(await page.locator('[data-testid="approval-approve"]').count()).toBe(0);
    expect(await page.locator('[data-testid^="manual-input-submit-"]').count()).toBe(0);
    expect(await page.locator('[data-testid="approval-submitting"]').count()).toBe(0);
    expect(after.state).toBe("idle");
  });
});
