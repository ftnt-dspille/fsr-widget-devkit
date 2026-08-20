// Shared driver for the prompt -> Apply -> landed -> run live arcs.
//
// Extracted from buildApplyRun.live.test.js so a CORPUS of prompts can share
// one execution-truth spine: seed a designer-shaped substrate (random uuids),
// type the prompt into the real composer, click Apply on the offer card,
// require the apply outcome in chat, then assert what actually happened on the
// box -- steps landed, run reached the contracted state.
//
// Every failure message distinguishes agent behavior from substrate: a seed
// that cannot even be POSTed is a SUBSTRATE failure and must not read as the
// agent failing the prompt.
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const CAPTURE_DIR = path.join(__dirname, "..", "captures");

/** Replace every uuid in a JSON-serializable object with a fresh random one
 *  (consistently -- the same old uuid maps to the same new uuid, so step/route
 *  IRIs stay coherent). This is what makes a compiler-emitted fixture
 *  DESIGNER-shaped: random uuids the uuid5 world never produces. */
function randomizeUuids(obj) {
  const s = JSON.stringify(obj);
  const map = new Map();
  // PLATFORM-reference uuids must stay canonical: step types and picklists are
  // shared box entities, not part of the seeded playbook's identity.
  const out = s.replace(
    /(workflow_step_types\/|picklists\/)?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi,
    (whole, prefix, u) => {
      if (prefix) return whole;
      const k = u.toLowerCase();
      if (!map.has(k)) map.set(k, crypto.randomUUID());
      return map.get(k);
    }
  );
  return { value: JSON.parse(out), map };
}

/** POST a scratch collection with the given workflows. Throws a
 *  SUBSTRATE-tagged error on failure so it never reads as agent behavior. */
async function seedCollection(api, { collName, collUuid, workflows }) {
  const res = await api.post("/api/3/workflow_collections", {
    name: collName,
    description: "scratch for buildArcCorpus.live",
    visible: true,
    uuid: collUuid,
    workflows,
  });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`SUBSTRATE: seed failed: HTTP ${res.status} `
      + JSON.stringify(res.json).slice(0, 300));
  }
}

/** Wait for EITHER apply surface -- enhancement_offer or patch_proposal --
 *  and click its Apply/accept. The corpus contract is the outcome on the box,
 *  not which card class the agent chose for the edit. On neither, screenshot
 *  + list whatever cards ARE on screen. */
async function applyOffer(page, caseName, { offerTimeoutMs = 240000 } = {}) {
  const offer = page.locator('[data-testid^="enhancement-offer-"]').first();
  const patch = page.locator('[data-testid^="patch-proposal-"]').first();
  try {
    await Promise.race([
      offer.waitFor({ state: "visible", timeout: offerTimeoutMs }),
      patch.waitFor({ state: "visible", timeout: offerTimeoutMs }),
    ]);
  } catch (e) {
    fs.mkdirSync(CAPTURE_DIR, { recursive: true });
    const shot = path.join(CAPTURE_DIR, `buildArc.${caseName}.noOffer.png`);
    await page.screenshot({ path: shot, fullPage: true });
    const seen = await page.evaluate(() => Array.from(
      document.querySelectorAll("[data-testid]"))
      .map((el) => el.getAttribute("data-testid"))
      .filter((t) => /^(enhancement-offer|patch-proposal|playbook-offer|capability-gap)/.test(t)));
    throw new Error(`[${caseName}] no apply surface within ${offerTimeoutMs / 1000}s; `
      + "cards on screen: " + JSON.stringify(seen) + `. Screenshot: ${shot}. ` + e.message);
  }
  if (await offer.count()) {
    const offerId = ((await offer.getAttribute("data-testid")) || "")
      .replace(/^enhancement-offer-/, "");
    if (!offerId) throw new Error(`[${caseName}] offer card has no id in its testid`);
    await page.locator(`[data-testid="enhancement-offer-accept-${offerId}"]`).click();
    return "enhancement_offer";
  }
  const cardId = ((await patch.getAttribute("data-testid")) || "")
    .replace(/^patch-proposal-/, "");
  if (!cardId) throw new Error(`[${caseName}] patch card has no id in its testid`);
  await page.locator(`[data-testid="patch-apply-${cardId}"]`).click();
  return "patch_proposal";
}

/** After Apply: require an HONEST outcome in chat; only success lets the arc
 *  continue. A reported failure is a finding, not a flake. */
async function awaitApplyOutcome(page, caseName, { timeoutMs = 180000 } = {}) {
  const done = page.locator("text=/saved it|Applied the edit/i").first();
  const failed = page.locator("text=/saving it to FortiSOAR failed|left your playbook alone|nothing was changed/i").first();
  await Promise.race([
    done.waitFor({ state: "visible", timeout: timeoutMs }),
    failed.waitFor({ state: "visible", timeout: timeoutMs }),
  ]);
  if (await failed.count()) {
    const msg = (await failed.textContent()) || "";
    throw new Error(`[${caseName}] Apply FAILED on the box (honestly reported in chat): ` + msg.trim());
  }
}

/** Execution-truth half one: fetch the workflow as the box now holds it. */
async function fetchWorkflow(api, wfUuid) {
  return api.get(`/api/3/workflows/${wfUuid}?$relationships=true`);
}

/** Execution-truth half two: trigger the playbook and poll its run until it
 *  leaves in-flight states OR matches `settleOn` (for park contracts, an
 *  awaiting status IS the terminal we want). Returns {status, runId}. */
async function triggerAndPoll(api, wfUuid, { settleOn = null, timeoutMs = 120000 } = {}) {
  const trig = await api.post(`/api/triggers/1/notrigger/${wfUuid}`, {});
  const taskId = (trig.json && (trig.json.task_id
    || (trig.json.data && trig.json.data.task_id))) || null;
  if (!taskId) {
    throw new Error(`trigger did not return a task_id: HTTP ${trig.status} `
      + JSON.stringify(trig.json).slice(0, 300));
  }
  let status = null;
  let runId = null;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const runs = await api.get(`/api/wf/api/workflows/?task_id=${taskId}&parent_wf__isnull=True`);
    const member = (runs && (runs["hydra:member"] || runs.member)) || [];
    if (member.length && member[0].status) {
      status = member[0].status;
      runId = member[0].id || member[0].uuid || null;
      if (settleOn && settleOn.test(status)) break;
      // Without a settleOn, only a TRUE terminal ends the poll -- an awaiting
      // run keeps polling so a wrongly-parked run fails loudly at timeout
      // instead of passing as "no longer active".
      if (!/active|awaiting|in.?progress|pending/i.test(status)) break;
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  if (!status) throw new Error("the triggered run never appeared for task_id " + taskId);
  return { status, runId, taskId };
}

module.exports = {
  randomizeUuids, seedCollection, applyOffer, awaitApplyOutcome,
  fetchWorkflow, triggerAndPoll,
};
