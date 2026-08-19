"use strict";
// FULL-ARC live proof: a build prompt typed into the REAL widget on a REAL box
// produces a playbook that actually RUNS.
//
// Every other live spec deliberately stops AT the offered card (the registry's
// standing limit). This one exists because that boundary is exactly where the
// FK-500 lived: verify_enhancement said ready_to_push, the card rendered, and
// the Apply died on the box -- twice, silently. So this spec crosses the line:
//
//   seed a DESIGNER-shaped substrate (random-uuid collection + empty playbook,
//   the shape real analysts produce and the compiler's uuid5 world never
//   exercises)
//   -> mount the designer, type the build prompt into the real composer
//   -> wait for the enhancement_offer card and CLICK APPLY
//   -> wait for the applied confirmation in the chat
//   -> assert via the API that the steps + trigger actually landed
//   -> trigger the playbook and poll the run to a terminal state
//
// "Works" here means execution truth: the run finishes, not that YAML compiled.
//
// The prompt asks for a self-contained playbook (manual trigger + set_variable)
// so the run needs no external connector and terminates on its own.
//
// LIVE + MUTATING -- but only inside its own scratch collection, which is
// created in beforeAll and deleted in afterAll (best-effort; a leftover
// "ZZ E2E BuildArc*" collection is safe to delete by hand).
//
// Run:  set -a && . <framework>/.env.159 && set +a && E2E_LIVE=1 \
//       npx jest -c jest.live.config.js tests/live/buildApplyRun.live.test.js

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { openWidgetDrawer } = require("../../lib/liveUiDriver");
const { makeClient } = require("./lib/soarClient");

const LIVE = process.env.E2E_LIVE === "1";
const d = LIVE ? describe : describe.skip;
const CAPTURE_DIR = path.join(__dirname, "captures");

if (!LIVE) {
  console.warn("[buildApplyRun.live] SKIPPED -- set E2E_LIVE=1 (and a box env) "
    + "to run. The prompt->apply->run arc is UNVERIFIED in this run.");
}

const PROMPT =
  "Change this playbook itself: give it a manual trigger start, then one step "
  + "that sets a variable named note to the text 'automated e2e', then end. "
  + "No connector steps, no record context -- this playbook must run on its own.";

d("live: a build prompt ends in a playbook that RUNS (prompt->apply->execute)", () => {
  jest.setTimeout(600000);

  let api;
  let session;
  const collUuid = crypto.randomUUID();
  const wfUuid = crypto.randomUUID();
  const collName = `ZZ E2E BuildArc ${Date.now()}`;

  beforeAll(async () => {
    api = await makeClient();
    // DESIGNER-shaped substrate: random uuids, hand-POSTed -- the exact shape
    // the compiler's deterministic-uuid world never creates, and the exact
    // shape the FK-500 needed. The playbook starts as the same empty shell the
    // analyst's "new" playbook was.
    const res = await api.post("/api/3/workflow_collections", {
      name: collName, description: "scratch for buildApplyRun.live", visible: true,
      uuid: collUuid,
      workflows: [{ name: "buildarc", uuid: wfUuid, isActive: true,
                    description: "", steps: [], routes: [] }],
    });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`substrate seed failed: HTTP ${res.status} `
        + JSON.stringify(res.json).slice(0, 300));
    }
  });

  afterAll(async () => {
    if (session) {
      try { await session.saveCapture("build_apply_run"); } catch (e) { /* best-effort */ }
      await session.close();
    }
    if (api) {
      try { await api.del(`/api/3/workflow_collections/${collUuid}`); } catch (e) { /* leftover is named ZZ E2E BuildArc* */ }
    }
  });

  test("prompt -> offer -> Apply -> landed -> run terminal", async () => {
    session = await openWidgetDrawer({ mountPath: `/playbooks/${wfUuid}`, capture: true });
    expect(session.composerOpen).toBe(true);
    const page = session.page;

    const sent = await session.sendChat(PROMPT, { timeoutMs: 300000 });
    expect(sent.submitConfirmed).toBe(true);

    // 1. The offer card.
    const card = page.locator('[data-testid^="enhancement-offer-"]').first();
    try {
      await card.waitFor({ state: "visible", timeout: 240000 });
    } catch (e) {
      fs.mkdirSync(CAPTURE_DIR, { recursive: true });
      await page.screenshot({ path: path.join(CAPTURE_DIR, "buildApplyRun.noOffer.png"), fullPage: true });
      const seen = await page.evaluate(() => Array.from(
        document.querySelectorAll("[data-testid]"))
        .map((el) => el.getAttribute("data-testid"))
        .filter((t) => /^(enhancement-offer|patch-proposal|playbook-offer)/.test(t)));
      throw new Error("no enhancement_offer within 240s; cards on screen: "
        + JSON.stringify(seen) + ". Screenshot: captures/buildApplyRun.noOffer.png. "
        + e.message);
    }
    const offerId = ((await card.getAttribute("data-testid")) || "")
      .replace(/^enhancement-offer-/, "");
    expect(offerId).toBeTruthy();

    // 2. APPLY -- the click every other spec refuses to make, and the seam the
    //    FK-500 lived in.
    await page.locator(`[data-testid="enhancement-offer-accept-${offerId}"]`).click();

    // 3. The applied confirmation must reach the CHAT (fix 2: a silent apply
    //    failure is itself a defect). Either outcome text is a finding-bearing
    //    signal; only the success text lets the test continue.
    const done = page.locator("text=/saved it|Applied the edit/i").first();
    const failed = page.locator("text=/saving it to FortiSOAR failed|left your playbook alone|nothing was changed/i").first();
    await Promise.race([
      done.waitFor({ state: "visible", timeout: 180000 }),
      failed.waitFor({ state: "visible", timeout: 180000 }),
    ]);
    if (await failed.count()) {
      const msg = (await failed.textContent()) || "";
      throw new Error("Apply FAILED on the box (honestly reported in chat): " + msg.trim());
    }

    // 4. Execution-truth, half one: the steps really landed on the box.
    const wf = await api.get(`/api/3/workflows/${wfUuid}?$relationships=true`);
    const steps = (wf && wf.steps) || [];
    if (!steps.length) {
      throw new Error("chat says applied, but the workflow on the box has ZERO "
        + "steps -- the phantom-success shape this spec exists to catch.");
    }
    if (!wf.triggerStep) {
      throw new Error("steps landed but no triggerStep -- the playbook cannot "
        + "be started; the 'manual trigger start' half of the prompt was lost.");
    }
    console.log("[buildApplyRun.live] landed steps: "
      + steps.map((s) => (s && s.name) || "?").join(", "));

    // 5. Execution-truth, half two: it RUNS to a terminal state.
    const trig = await api.post(`/api/triggers/1/notrigger/${wfUuid}`, {});
    const taskId = (trig.json && (trig.json.task_id
      || (trig.json.data && trig.json.data.task_id))) || null;
    if (!taskId) {
      throw new Error(`trigger did not return a task_id: HTTP ${trig.status} `
        + JSON.stringify(trig.json).slice(0, 300));
    }
    let status = null;
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      const runs = await api.get(`/api/wf/api/workflows/?task_id=${taskId}&parent_wf__isnull=True`);
      const member = (runs && (runs["hydra:member"] || runs.member)) || [];
      if (member.length && member[0].status) {
        status = member[0].status;
        if (!/active|awaiting|in.?progress|pending/i.test(status)) break;
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
    console.log("[buildApplyRun.live] run status: " + status);
    if (!status) throw new Error("the triggered run never appeared for task_id " + taskId);
    if (!/finish|complet|success/i.test(status)) {
      throw new Error("the applied playbook did not run green: terminal status "
        + JSON.stringify(status) + " -- a playbook that lands but cannot run "
        + "is exactly the class this arc exists to catch.");
    }
  });
});
