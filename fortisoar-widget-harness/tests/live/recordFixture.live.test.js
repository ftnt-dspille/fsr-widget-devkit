"use strict";
// Record ONE fixture's arc off a real box (Phase 2.3).
//
// The fixtures under widgetAssets/fixtures/ are hand-written: each encodes its
// author's belief about what the connector sends. `npm run fixtures:audit`
// diffs them against recorded wire, but it can only do that for fixtures that
// HAVE a recording -- everything else it reports as UNVERIFIED, which is the
// honest name for "one author's belief". This spec is how a recording gets
// made, for any fixture, without writing a bespoke live spec per arc.
//
// It is deliberately NOT an assertion suite. The DOM proof for the
// approval->manual-input arc lives in approvalToManualInput.live.test.js and
// stays there. This one has exactly one job: drive the arc and write the wire.
// The only thing it fails on is a DRIVE error -- the send never registered, no
// approval card appeared when the scenario says one must, or the capture came
// back empty. A recording of an arc that did not happen is worse than none: the
// audit would diff the fixture against noise and report findings about it.
//
// Usage (RECORD_SCENARIO must equal the FIXTURE's scenario name -- the audit
// matches capture to fixture by filename, and a mislabelled capture is read by
// nothing):
//
//   set -a; . ./.env.206; set +a
//   E2E_LIVE=1 CAPTURE=1 \
//     RECORD_SCENARIO=approval_containment \
//     RECORD_PROMPT="Block the IP 102.220.160.21 on FortiGate." \
//     RECORD_MODULE=alerts RECORD_RECORD=<uuid> \
//     npx jest -c jest.live.config.js tests/live/recordFixture.live.test.js
//
// Knobs:
//   RECORD_DECISION=approve|reject|none   what to do with an approval card
//   RECORD_EXPECT_GATE=1                  fail if no approval card appeared
//   RECORD_MANUAL_INPUT="note text"       answer a manual-input gate if one parks
//   RECORD_FOLLOWUP="..."                 a second turn after the arc settles
//   RECORD_WAIT_MS=90000                  idle before the follow-up (expire the gate)
//   RECORD_MOUNT=/playbooks               mount somewhere that is not a record
//
// MUTATING when the arc approves something: an Approve click runs a real
// playbook on a real appliance. That is the point -- the wire is only ground
// truth if the run was real.

const { openWidgetDrawer, closeSharedSession } = require("../../lib/liveUiDriver");

const LIVE = process.env.E2E_LIVE === "1";
const SCENARIO = process.env.RECORD_SCENARIO || "";
const PROMPT = process.env.RECORD_PROMPT || "";
const DECISION = process.env.RECORD_DECISION || "approve";
const EXPECT_GATE = process.env.RECORD_EXPECT_GATE === "1";
const MANUAL_INPUT = process.env.RECORD_MANUAL_INPUT || "";
const FOLLOWUP = process.env.RECORD_FOLLOWUP || "";
const WAIT_MS = parseInt(process.env.RECORD_WAIT_MS || "0", 10) || 0;
const MODULE = process.env.RECORD_MODULE || "ztpf_devices";
const RECORD = process.env.RECORD_RECORD || "";
const MOUNT = process.env.RECORD_MOUNT || "";

// Say WHY it is not running. A recorder that skips in silence looks exactly
// like one that recorded -- and the audit's "UNVERIFIED" line is then the only
// symptom, one run too late to connect to the cause.
if (!LIVE || !SCENARIO || !PROMPT) {
  const why = !LIVE ? "E2E_LIVE!=1"
    : !SCENARIO ? "RECORD_SCENARIO is unset"
      : "RECORD_PROMPT is unset";
  console.warn(`[recordFixture] SKIPPED -- ${why}. Nothing was recorded, so every `
    + "fixture stays UNVERIFIED in the next audit.");
}

const d = (LIVE && SCENARIO && PROMPT) ? describe : describe.skip;

d(`live: record the ${SCENARIO || "<unset>"} arc`, () => {
  jest.setTimeout(600000);
  let session;
  afterAll(async () => {
    if (session) await session.close().catch(() => {});
    await closeSharedSession();
  });

  test(`drives the arc and writes tests/live/captures/${SCENARIO}.payloads.json`, async () => {
    // Mirror the widget's stream-lifecycle trace into the jest output. On a real
    // appliance `window.__fortiaiAgenticAssistant__` is absent by design, so the
    // console is the only channel that says which poll guard declined -- see #98.
    const trace = [];
    /* eslint-disable no-console */
    const _hook = (page) => page.on("console", (m) => {
      const t = m.text();
      if (t.indexOf("[fsr-pb-stream]") === 0) { trace.push(t); console.log(t); }
    });
    /* eslint-enable no-console */

    session = await openWidgetDrawer({
      module: MODULE,
      recordUuid: RECORD || undefined,
      mountPath: MOUNT || undefined,
      capture: true,
      // Never inherit another scenario's transcript: the capture would carry a
      // prior arc's turns and the audit would diff the fixture against them.
      reuse: false,
    });

    _hook(session.page);

    const sent = await session.sendChat(PROMPT, { timeoutMs: 300000 });
    // submitConfirmed is the ng-model debounce race, not an agent verdict. A
    // recording made from a turn that never left the browser is empty wire that
    // reads as "the connector sent nothing".
    expect(sent.submitConfirmed).toBe(true);

    let gate = { approved: 0, driveError: null };
    if (DECISION !== "none") {
      gate = await session.respondApprovals({
        decision: DECISION,
        timeoutMs: 300000,
      });
      expect(gate.driveError).toBeNull();
      if (EXPECT_GATE) {
        // The scenario SAYS it gates. If it did not, the arc that happened is
        // not the arc this fixture describes, and recording it anyway would
        // quietly redefine the fixture to match whatever the box did today.
        expect(gate.approved).toBeGreaterThan(0);
      }
    }

    // Answer a manual-input gate if the scenario has one. Without this the
    // capture stops at the park, and the audit then reports the FIXTURE as
    // wrong for containing the `respond_manual_input` + follow-up turn that
    // really do happen -- blaming the fixture for an arc the recorder declined
    // to finish. The gate carries its OWN ~1-minute step timeout (separate from
    // any jest budget), so this runs immediately after the resume settles.
    if (MANUAL_INPUT) {
      const page = session.page;
      const field = page.locator('[data-testid*="manual-input-field-"]').first();
      await field.waitFor({ state: "visible", timeout: 120000 });
      await field.fill(MANUAL_INPUT);
      const testid = await field.getAttribute("data-testid");
      const id = /^manual-input-field-([^-]+)-/.exec(testid || "");
      if (!id) throw new Error(`cannot derive the manual-input id from ${testid}`);
      await page.locator(`[data-testid="manual-input-submit-${id[1]}"]`).click();
      // Wait for the gate to leave the screen -- resolved or errored. Recording
      // while the form is still up captures the park, not the answer.
      await page.locator(`[data-testid="manual-input-submit-${id[1]}"]`)
        .waitFor({ state: "detached", timeout: 180000 });
    }

    // Idle gap before the follow-up. The manual-input gate carries its OWN
    // ~1-minute step timeout, so a human who reads the form and types an answer
    // routinely lands AFTER the run has already resolved down the timeout
    // branch. Driving the arc at machine speed never visits that state, which
    // is the difference between a recorder that reproduces #98 and one that
    // proves the happy path over and over.
    if (WAIT_MS) {
      // eslint-disable-next-line no-console
      console.log(`[recordFixture] idling ${WAIT_MS}ms before the follow-up`);
      await session.page.waitForTimeout(WAIT_MS);
    }

    if (FOLLOWUP) await session.sendChat(FOLLOWUP, { timeoutMs: 300000 });

    // eslint-disable-next-line no-console
    console.log(`[recordFixture] ${SCENARIO}: ${trace.length} stream-trace line(s)`);

    const file = await session.saveCapture(SCENARIO);
    expect(file).toBeTruthy();

    /* eslint-disable @typescript-eslint/no-var-requires */
    const payloads = JSON.parse(require("fs").readFileSync(file, "utf8"));
    /* eslint-enable @typescript-eslint/no-var-requires */
    console.log(`[recordFixture] ${SCENARIO}: ${payloads.length} payload(s), `
      + `ops=${[...new Set(payloads.map((p) => p.op || p.operation))].join(",")}, `
      + `approvals=${gate.approved}`);
    // A capture holding only the boot chat_history is an empty recording with a
    // plausible file size -- exactly the artifact that makes an audit report
    // success over nothing.
    const ops = payloads.map((p) => p.op || p.operation);
    expect(ops.filter((o) => o === "chat_turn" || o === "chat_resume").length)
      .toBeGreaterThan(0);
  });
});
