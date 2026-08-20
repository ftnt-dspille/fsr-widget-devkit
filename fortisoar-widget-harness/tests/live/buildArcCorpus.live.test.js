"use strict";
// The PROMPT CORPUS for the full build arc: each case is a committed prompt
// with an OUTCOME CONTRACT asserted through the API, not through chat text.
// buildApplyRun.live.test.js proved the spine (prompt -> Apply -> landed ->
// run); this file scales it to the shapes analysts actually ask for.
//
// Contracts per case:
//   manual_input_parks  -- the applied playbook RUNS and PARKS awaiting a
//                          human, instead of finishing or dying. The park IS
//                          the pass (manual_input `message` must be a dict --
//                          a string kills the run at execution, which this
//                          catches).
//   decision_branch     -- a Decision step lands and the run still finishes
//                          green (a decision with no matching route hangs).
//   enhance_existing    -- against a designer-shaped FIVE-step playbook
//                          (random uuids, seeded from a compiler-emitted
//                          fixture then uuid-randomized): one step is added,
//                          the original five survive untouched, and the
//                          result still runs green.
//   guided_interview    -- a deliberately VAGUE build ask. The contract is a
//                          QUESTION back (choice card or a clarifying turn),
//                          not a guessed-at offer. Documents today's behavior
//                          either way; see the card-driven-interview idea.
//
// LIVE + MUTATING -- each case owns a scratch collection created in its own
// seed and deleted afterward (leftovers are named "ZZ E2E Corpus*").
//
// Run:  set -a && . <framework>/.env.159 && set +a && E2E_LIVE=1 \
//       npx jest -c jest.live.config.js tests/live/buildArcCorpus.live.test.js
//   or one case: ... -t manual_input_parks

const crypto = require("crypto");
const path = require("path");
const { openWidgetDrawer } = require("../../lib/liveUiDriver");
const { makeClient } = require("./lib/soarClient");
const arc = require("./lib/buildArc");

const LIVE = process.env.E2E_LIVE === "1";
const d = LIVE ? describe : describe.skip;

if (!LIVE) {
  console.warn("[buildArcCorpus.live] SKIPPED -- set E2E_LIVE=1 (and a box env). "
    + "The build-arc prompt corpus is UNVERIFIED in this run.");
}

const SEED_5STEP = require("./fixtures/enhanceSeed.workflow.json");

/** Fresh empty designer-shaped shell (the buildApplyRun substrate). */
function emptyShell(wfUuid) {
  // Name is per-run unique: the connector derives step uuids via uuid5 salted
  // with (playbook name, step name), so a REUSED playbook name collides with
  // orphaned step records from earlier runs (409 uniqueness on uuid) -- a real
  // product defect (filed), but the corpus must not trip over its own litter.
  return { name: `corpuscase_${Date.now()}`, uuid: wfUuid, isActive: true,
           description: "", steps: [], routes: [] };
}

/** The 5-step fixture, re-uuid'd (designer-shaped) and renamed for this run. */
function fiveStepSeed(wfUuid) {
  const { value } = arc.randomizeUuids(SEED_5STEP);
  // Force the workflow's own uuid to the one the test will mount/assert on.
  const oldWf = value.uuid;
  const s = JSON.stringify(value).split(oldWf).join(wfUuid);
  const wf = JSON.parse(s);
  delete wf.collection; // it joins the fresh scratch collection
  // POST rejects explicit nulls for picklist-backed fields; drop them and let
  // the box default.
  for (const k of ["priority", "aliasName", "playbookOrigin"]) {
    if (wf[k] == null) delete wf[k];
  }
  wf.isActive = true;
  wf.name = `enhanceseed_${Date.now()}`; // per-run unique (see emptyShell)
  return wf;
}

const CASES = [
  {
    name: "manual_input_parks",
    seed: emptyShell,
    prompt:
      "Change this playbook itself: manual trigger start, then a manual input "
      + "step that asks a human reviewer to pick approve or reject (two "
      + "options), then a step that sets a variable named outcome to the text "
      + "'reviewed'. No connector steps, no record context.",
    run: { settleOn: /awaiting/i },
    assert(wf, run) {
      if (!/awaiting/i.test(run.status)) {
        throw new Error("the manual-input playbook did NOT park: terminal "
          + `status ${JSON.stringify(run.status)} -- either the manual_input `
          + "step was dropped, or it died at execution (the string-message "
          + "shape). Landed steps: "
          + (wf.steps || []).map((s) => s.name).join(", "));
      }
    },
  },
  {
    name: "decision_branch",
    seed: emptyShell,
    prompt:
      "Change this playbook itself: manual trigger start, then set a variable "
      + "named count to the number 5, then a decision step: if count is "
      + "greater than 3 go to a step that sets verdict to 'high', otherwise "
      + "to a step that sets verdict to 'low'. No connector steps, no record "
      + "context -- it must run on its own.",
    run: {},
    assert(wf, run) {
      const hasDecision = (wf.steps || []).some((s) =>
        String((s.stepType && (s.stepType["@id"] || s.stepType.uuid)) || s.stepType || "")
          .includes("12254cf5") || /decision/i.test(s.name || ""));
      if (!hasDecision) {
        throw new Error("no Decision step landed; steps: "
          + (wf.steps || []).map((s) => s.name).join(", "));
      }
      if (!/finish|complet|success/i.test(run.status)) {
        throw new Error("the decision playbook did not run green: "
          + JSON.stringify(run.status) + " -- a decision whose condition "
          + "matches no route hangs or dies exactly here.");
      }
    },
  },
  {
    name: "enhance_existing_5step",
    seed: fiveStepSeed,
    prompt:
      "Add one more step to this playbook: after the last existing step, a "
      + "set-variable step named Set extra that sets a variable named extra "
      + "to the text 'added'. Do not change or remove any existing step.",
    run: {},
    assert(wf, run, seeded) {
      const seededNames = seeded.steps.map((s) => s.name);
      const nowNames = (wf.steps || []).map((s) => s.name);
      const lost = seededNames.filter((n) => !nowNames.includes(n));
      if (lost.length) {
        throw new Error("enhancement DESTROYED existing steps: lost "
          + JSON.stringify(lost) + "; now: " + JSON.stringify(nowNames)
          + " -- the unexpanded-pull total-wipe class.");
      }
      if (nowNames.length < seededNames.length + 1) {
        throw new Error("chat says applied but no step was added: "
          + JSON.stringify(nowNames));
      }
      if (!/finish|complet|success/i.test(run.status)) {
        throw new Error("the enhanced playbook no longer runs green: "
          + JSON.stringify(run.status));
      }
    },
  },
];

d("live: build-arc prompt corpus (outcome contracts on the box)", () => {
  jest.setTimeout(600000);

  let api;
  beforeAll(async () => { api = await makeClient(); });

  for (const c of CASES) {
    // eslint-disable-next-line no-loop-func
    test(c.name, async () => {
      const collUuid = crypto.randomUUID();
      const wfUuid = crypto.randomUUID();
      const seeded = c.seed(wfUuid);
      let session;
      try {
        await arc.seedCollection(api, {
          collName: `ZZ E2E Corpus ${c.name} ${Date.now()}`,
          collUuid,
          workflows: [seeded],
        });
        session = await openWidgetDrawer({ mountPath: `/playbooks/${wfUuid}`, capture: true });
        expect(session.composerOpen).toBe(true);
        const page = session.page;

        const sent = await session.sendChat(c.prompt, { timeoutMs: 300000 });
        expect(sent.submitConfirmed).toBe(true);

        // First wait for an apply surface; if instead the agent ended its
        // turn ASKING to proceed (a fully-specified ask should go straight to
        // the card -- the Apply card IS the approval gate), nudge once like a
        // real analyst would and log the nudge as an offer_timing finding.
        try {
          await arc.applyOffer(page, c.name, { offerTimeoutMs: 150000 });
        } catch (e) {
          const feed = (await page.textContent("body").catch(() => "")) || "";
          if (!/if you want me to proceed|shall i|want me to (proceed|go ahead|draft)|would you like me to/i.test(feed)) throw e;
          console.warn(`[buildArcCorpus:${c.name}] FINDING(offer_timing): the `
            + "agent asked permission in prose instead of emitting the apply "
            + "card; nudging once with 'Yes, go ahead.'");
          const nudged = await session.sendChat("Yes, go ahead.", { timeoutMs: 300000 });
          expect(nudged.submitConfirmed).toBe(true);
          await arc.applyOffer(page, c.name);
        }
        // A silent apply is a defect either way -- the question is WHICH.
        // If chat never reports an outcome, execution truth arbitrates: steps
        // on the box = the feed is dead (known resume-feed class); no steps =
        // the apply itself is dead.
        try {
          await arc.awaitApplyOutcome(page, c.name, { timeoutMs: 120000 });
        } catch (e) {
          const probe = await arc.fetchWorkflow(api, wfUuid);
          if (((probe && probe.steps) || []).length) {
            console.warn(`[buildArcCorpus:${c.name}] FINDING(silent_apply_feed): `
              + "the apply LANDED on the box but its outcome never reached the "
              + "chat -- the apply_patch resume produced zero frames (the "
              + "resume-feed class, still open for patch cards).");
          } else {
            throw e;
          }
        }

        const wf = await arc.fetchWorkflow(api, wfUuid);
        if (!((wf && wf.steps) || []).length) {
          throw new Error(`[${c.name}] chat says applied, but the workflow on `
            + "the box has ZERO steps -- the phantom-success shape.");
        }
        if (!wf.triggerStep) {
          throw new Error(`[${c.name}] steps landed but no triggerStep -- the `
            + "playbook cannot be started.");
        }
        console.log(`[buildArcCorpus:${c.name}] landed: `
          + wf.steps.map((s) => s.name).join(", "));

        const run = await arc.triggerAndPoll(api, wfUuid, c.run);
        console.log(`[buildArcCorpus:${c.name}] run status: ${run.status}`);
        c.assert(wf, run, seeded);
      } finally {
        if (session) {
          try { await session.saveCapture(`build_arc_${c.name}`); } catch (e) { /* best-effort */ }
          try { await session.close(); } catch (e) { /* best-effort */ }
        }
        try { await api.del(`/api/3/workflow_collections/${collUuid}`); } catch (e) { /* leftover named ZZ E2E Corpus* */ }
      }
    });
  }

  // The guided-interview probe: a vague ask SHOULD earn a question back (a
  // choice card or a clarifying text turn), not a guessed-at apply offer.
  // Scored informationally for now -- it documents today's behavior and
  // becomes the acceptance test if/when an interview-mode turn plan lands.
  test("guided_interview_vague_ask", async () => {
    const collUuid = crypto.randomUUID();
    const wfUuid = crypto.randomUUID();
    let session;
    try {
      await arc.seedCollection(api, {
        collName: `ZZ E2E Corpus interview ${Date.now()}`,
        collUuid,
        workflows: [emptyShell(wfUuid)],
      });
      session = await openWidgetDrawer({ mountPath: `/playbooks/${wfUuid}`, capture: true });
      const page = session.page;
      const sent = await session.sendChat(
        "help me build a playbook", { timeoutMs: 300000 });
      expect(sent.submitConfirmed).toBe(true);

      // Whichever comes first: a question (choice card) or a guessed offer.
      const choice = page.locator('[data-testid^="choice-card-"]').first();
      const offer = page.locator('[data-testid^="enhancement-offer-"]').first();
      await Promise.race([
        choice.waitFor({ state: "visible", timeout: 240000 }),
        offer.waitFor({ state: "visible", timeout: 240000 }),
      ]).catch(() => { /* neither card: fall through to the text check */ });

      const askedViaCard = (await choice.count()) > 0;
      const guessedOffer = (await offer.count()) > 0;
      console.log(`[buildArcCorpus:guided_interview] asked=${askedViaCard} `
        + `guessed_offer=${guessedOffer}`);
      if (guessedOffer && !askedViaCard) {
        throw new Error("a fully vague 'help me build a playbook' went "
          + "straight to an apply offer without one clarifying question -- "
          + "the interview never happened.");
      }
      if (!askedViaCard) {
        // No card either way: require at least a question mark in the reply.
        const feed = (await page.locator(".chat-feed, [class*=feed]").first()
          .textContent().catch(() => "")) || "";
        if (!/\?/.test(feed)) {
          throw new Error("no choice card, no offer, and no question in the "
            + "reply -- the vague ask dead-ended.");
        }
      }
    } finally {
      if (session) {
        try { await session.saveCapture("build_arc_interview"); } catch (e) { /* best-effort */ }
        try { await session.close(); } catch (e) { /* best-effort */ }
      }
      try { await api.del(`/api/3/workflow_collections/${collUuid}`); } catch (e) { /* leftover */ }
    }
  });
});
