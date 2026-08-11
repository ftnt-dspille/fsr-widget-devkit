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
// The recorder now lives in the DRIVER (Phase 2.1): `openWidgetDrawer({capture:
// true})` attaches it and `session.saveCapture(label)` writes
// tests/live/captures/<label>.payloads.json, which is exactly the filename
// `npm run fixtures:audit` looks for. Two things came free with the move:
// lib/chatCapture.js already closes the tail-drop (it drains in-flight body
// handlers before writing), and attaching at MOUNT time records the boot
// traffic this spec used to miss by attaching after openWidgetDrawer returned.
// The label MUST equal the fixture this arc is the ground truth for: the audit
// matches a capture to a fixture by scenario name (<scenario>.payloads.json).
// A label that matches nothing is not an error anywhere -- the capture is just
// never read, and the fixture stays UNVERIFIED while a recording of it sits on
// disk.
const CAPTURE_LABEL = "approval_then_manual_input";
// Where saveCapture() writes, so the DOM/screenshot dump below lands beside the
// wire capture of the same run. Keep the two in step: a dangling reference here
// throws INSIDE the test and masks the failure the dump exists to explain --
// which is exactly what it did the first time this spec was refactored.
const CAPTURE_DIR = path.join(__dirname, "captures");

// The chat transcript as text. Everything this spec asserts about turns is read
// from the DOM, because `window.__fortiaiAgenticAssistant__` is gated to
// localhost by design ("never reaches a deployed install") -- on a real box it
// is simply absent, and a live assertion built on it silently compares against
// `undefined`.
// Scoped to `.pb-message` (the ng-repeat over chatMessages) rather than the
// whole widget: the widget root's textContent is mostly chrome and whitespace --
// the composer, the "Record context" button, the layout's newlines. A
// "transcript grew" assertion measured against that goes green on a re-render
// that added nothing, which is a gate that passes whether or not the thing it
// checks is true.
async function chatText(page, sel = ".pb-message") {
  if (!(await page.locator(".fsr-pb-widget").count())) {
    throw new Error("the widget body (.fsr-pb-widget) is not on the page -- the "
      + "drawer closed or never rendered. A drive failure, not a verdict.");
  }
  const parts = await page.locator(sel).allTextContents();
  return parts.join("\n").replace(/[ \t]+/g, " ").replace(/\n{2,}/g, "\n").trim();
}

// ASSISTANT messages only. The widget renders the analyst's own prompt into the
// same feed, so "does the transcript mention phishing after I asked about
// phishing?" is true the instant the question is echoed -- green whether or not
// the agent ever answered. Scoping to the assistant's own turns is what makes
// that assertion able to fail.
const assistantText = (page) =>
  chatText(page, '[data-testid^="chat-message-assistant-"]');

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
  const NOTE_TEXT = "live DOM check";

  afterAll(async () => {
    // saveCapture() drains the in-flight response handlers before writing, or
    // the tail of the last turn -- the frames you most need when the arc fails
    // at the end -- never reaches disk. Write BEFORE closing, never after:
    // closing the page kills the handlers that are still resolving. Never let
    // the diagnostic sink the run it exists to explain.
    if (session) {
      try {
        await session.saveCapture(CAPTURE_LABEL);
      } catch (e) {
        console.warn("[approvalToManualInput.live] capture write failed: " + e.message);
      }
      await session.close();
    }
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
    session = await openWidgetDrawer({ module: MODULE, recordUuid: RECORD, capture: true });
    expect(session.composerOpen).toBe(true);
    const page = session.page;

    // Capture ALL console messages for debugging
    const consoleMsgs = [];
    page.on('console', m => consoleMsgs.push(m.type() + ': ' + m.text()));

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
    // NOTE the probe half of this is EMPTY on a real box on purpose (see
    // `chatText`) -- `state`/`eventTypes` being blank here means "not
    // introspectable", NOT "the widget has no messages". Only the DOM fields
    // below carry information live.
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
    console.log("[approvalToManualInput.live] CONSOLE " + JSON.stringify(consoleMsgs.filter(m => m.includes('STALE_REPLAY')), null, 1));
    console.log("[approvalToManualInput.live] ALL CONSOLE " + JSON.stringify(consoleMsgs.slice(-20), null, 1));

    // Debug: dump page HTML + screenshot when the form is missing
    fs.mkdirSync(CAPTURE_DIR, { recursive: true });
    const html = await page.content();
    require("fs").writeFileSync(path.join(CAPTURE_DIR, "approvalToManualInput.dom.html"), html);
    await page.screenshot({ path: path.join(CAPTURE_DIR, "approvalToManualInput.screenshot.png"), fullPage: true });
    console.log("[approvalToManualInput.live] wrote DOM + screenshot to " + CAPTURE_DIR);

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

    const beforeSubmit = await chatText(page);
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
    // transcript ending at the form. Asserted on the DOM, not on
    // `window.__fortiaiAgenticAssistant__`: that probe is deliberately
    // localhost-only and by design NEVER reaches a deployed install, so a live
    // spec that leans on it is asserting against `undefined` -- which is how the
    // first cut of this test reported a working resume as a failure. The text is
    // model-authored, so what's assertable is that the transcript GREW.
    const grown = await chatText(page);
    console.log("[approvalToManualInput.live] post-resume transcript tail: "
      + JSON.stringify(grown.slice(-400)));
    expect(grown.length).toBeGreaterThan(beforeSubmit.length);
  });

  test("an unrelated question in the same session still gets a normal answer", async () => {
    requireParkedForm("follow-up");
    const page = session.page;

    // A session that strands after gated + parked + resumed is still broken
    // from where the analyst sits. Every state this arc touches (the approval
    // singleton, the pending-card gate, viewState) is a way to leave the
    // composer dead or swallow the next prompt.
    // Anchor on the assistant MESSAGE COUNT, not on transcript length.
    //
    // The length-slice version produced a FALSE RED on 2026-08-05: the previous
    // turn's answer was still streaming into the DOM when this test began, so
    // `before` captured a partial transcript and the "new" text was the tail of
    // the PREVIOUS answer ("I will not call resume_playbook..."). The box said
    // otherwise -- `chat_history` showed the follow-up turn had answered the
    // phishing question properly, with a get_record call. The test was
    // measuring the wrong window and reported a shipped, working fix as broken.
    // A gate that cries wolf costs what a sleeping gate costs.
    //
    // Settle the prior turn first, then require a brand-new message element.
    const msgSel = '[data-testid^="chat-message-assistant-"]';
    let stableCount = await page.locator(msgSel).count();
    let stableText = await assistantText(page);
    const settleDeadline = Date.now() + 60000;
    while (Date.now() < settleDeadline) {
      await page.waitForTimeout(3000);
      const t = await assistantText(page);
      const n = await page.locator(msgSel).count();
      if (t === stableText && n === stableCount) break;  // two quiet reads
      stableText = t;
      stableCount = n;
    }
    // Also wait for the chat poll feed to go quiet. The DOM settle loop above
    // can finish before the model's text response to the previous turn's
    // manual-input resolution arrives via chat_poll -- the resolution CARD
    // appeared (test 2 passed), but the model's follow-up text ("The manual
    // input gate with ID N was approved...") streams in seconds later. Without
    // this check, that late text is captured as the "fresh" answer to the
    // phishing question, producing a false red.
    const pollSettleDeadline = Date.now() + 30000;
    let lastPollCount = session.polls.length;
    while (Date.now() < pollSettleDeadline) {
      await page.waitForTimeout(5000);
      if (session.polls.length === lastPollCount) break;
      lastPollCount = session.polls.length;
    }
    stableText = await assistantText(page);
    stableCount = await page.locator(msgSel).count();
    const beforeCount = stableCount;

    const sent = await session.sendChat("How do I triage a phishing report?");
    // Drive failure vs. product failure, kept apart as everywhere else here.
    expect(sent.submitConfirmed).toBe(true);

    // Wait for the ANSWER, not for the driver's done signal. `sendChat` settles
    // on the shared poll feed, which can report done from a poll belonging to
    // the turn before this one -- this test returned in 5s that way, long before
    // any model could have answered.
    // Read the answer as the TEXT DELTA from the settled baseline, not as a new
    // element at index `beforeCount`. The widget does not reliably add one
    // assistant element per turn (tool/progress bubbles share the same testid
    // prefix, and a streaming turn can land in an element that already
    // existed), so an element-count anchor waited out the full budget and
    // reported "" while the box had answered perfectly -- verified via
    // chat_history on 0.5.104. The settle loop above is what fixes the ORIGINAL
    // false red; the delta is just how the answer is read.
    let fresh = "";
    const answerDeadline = Date.now() + 120000;
    while (Date.now() < answerDeadline) {
      const now = await assistantText(page);
      if (now.length > stableText.length) {
        const first = now.slice(stableText.length);
        await page.waitForTimeout(4000);   // let it finish streaming
        const settled = (await assistantText(page)).slice(stableText.length);
        if (settled === first && settled.trim().length > 40) {
          // The widget re-renders the previous turn's assistant message
          // when a new chat_turn is sent, creating a duplicate element with
          // an updated timestamp. This grows assistantText without adding a
          // new answer. Normalize timestamps before comparing: if the delta
          // is the previous message re-rendered (same text, different time),
          // re-baseline and keep waiting for the genuine answer.
          const norm = (s) => s.replace(/\d{1,2}:\d{2}:\d{2}\s*[AP]M/gi, "");
          if (norm(stableText).includes(norm(settled.trim()))) {
            stableText = await assistantText(page);
            await page.waitForTimeout(3000);
            continue;
          }
          fresh = settled;
          break;
        }
      }
      await page.waitForTimeout(3000);
    }
    console.log("[approvalToManualInput.live] follow-up answer: "
      + JSON.stringify(fresh.slice(0, 500)));
    // Empty means the widget never rendered a new assistant message at all.
    expect(fresh).not.toBe("");

    // It answered the NEW question rather than replaying the playbook arc.
    // Asserted on THAT message alone -- matching against the whole transcript
    // would pass on the echo of the question itself, i.e. go green whether or
    // not the agent ever answered.
    //
    // The NEGATIVE is the real assertion. A correct answer need never use the
    // word "phishing" (live it opened "I'll give a concise, actionable triage
    // playbook you can follow"), so requiring that keyword is what made the
    // check unfalsifiable in the useful direction. What must not happen is the
    // strand: the turn coming back about the playbook run instead.
    expect(fresh).not.toMatch(/resume_playbook|run_pk|workflow run (PK|identifier)/i);
    expect(fresh).toMatch(/phish|triage|email|report/i);

    // The old cards stay resolved: no gate re-raised, no second form.
    expect(await page.locator('[data-testid="approval-approve"]').count()).toBe(0);
    expect(await page.locator('[data-testid^="manual-input-submit-"]').count()).toBe(0);
    expect(await page.locator('[data-testid="approval-submitting"]').count()).toBe(0);
    // Settled and ready for another question -- read off the DOM, since the
    // viewState probe does not exist on a deployed install. `chat-stop` renders
    // only while a turn is in flight.
    expect(await page.locator('[data-testid="chat-stop"]').count()).toBe(0);
    expect(await page.locator('[data-testid="chat-input"]').first().isEnabled()).toBe(true);
  });
});
