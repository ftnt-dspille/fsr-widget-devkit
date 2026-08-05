// Live prompt/flow MATRIX (docs/PROMPT_FLOW_TEST_PLAN.md T1-T10 / P1-P5):
// drive the deployed widget drawer on real records, one prompt per scenario
// row, and evaluate each captured turn with tests/live/lib/matrixDriver.js.
//
// Gated: FSRPB_LIVE=1 (plus FSR_BASE_URL/FSR_USERNAME/FSR_PASSWORD; live UI
// runs are HEADED -- FSRPB_HEADED=1 -- because the WAF blocks headless UAs).
// Run via `make test-matrix-live`, never by hand.
//
// Scenario rows carry box-specific record UUIDs, so they live in the
// GITIGNORED tests/live/scenarios.local.json (copy scenarios.local.example.json
// and fill in real UUIDs). Absent file → skip-with-warning, never red.
//
// PASS/FAIL contract -- now PER ROW (`gate`), see matrixDriver.gateRow:
//   soft   (default) only a hard-FAIL blocks. The original contract: PASS,
//                    PASS (minor errors) and DEGRADED all ship, and DEGRADED is
//                    surfaced in the summary as a fix to chase.
//   strict           hard-FAIL, DEGRADED, or any red flag blocks.
//   xfail            expected to red-flag (an open bug); blocks only when it
//                    comes back clean → promote it.
// `forbidRedFlags[]` blocks on any gate, so a row parked for one open bug still
// guards the bugs already fixed on that turn.
//
// Every row is additionally graded by the exportGrader red-flag rules -- the
// same rules that grade downloaded `.events.json` exports -- so a known-bad flow
// signature caught once offline gates the live matrix forever after.
//
// MATRIX_GATE=strict,xfail runs ONLY the gating rows (`make test-matrix-gate`).
"use strict";

const fs = require("fs");
const path = require("path");
const { runScenario, formatReport, gateRow, GATES } = require("./lib/matrixDriver");

const LIVE = process.env.FSRPB_LIVE === "1";
// Scenario rows are BOX-SPECIFIC (real record UUIDs), and MATRIX_ENV switches
// boxes -- so the rows must switch with it, or a 206 run drives 159's records.
// The Makefile resolves MATRIX_ENV=.env.206 → scenarios.local.206.json when that
// file exists, falling back to scenarios.local.json.
const SCENARIOS_PATH = process.env.MATRIX_SCENARIOS
  ? path.resolve(process.env.MATRIX_SCENARIOS)
  : path.join(__dirname, "scenarios.local.json");

// Only run rows whose gate is in MATRIX_GATE (comma-separated). Unset = all.
const GATE_FILTER = (process.env.MATRIX_GATE || "")
  .split(",").map((s) => s.trim()).filter(Boolean);

// Hand-picked subset by row id (comma-separated, e.g. MATRIX_IDS=Z3,Z5). A full
// sweep is 11 headed browser turns at ~2-4 min each, so targeting the rows that
// cover a specific fix is the common case. Unset = all (subject to GATE_FILTER).
const ID_FILTER = (process.env.MATRIX_IDS || "")
  .split(",").map((s) => s.trim()).filter(Boolean);

// Rows the file DEFINES (after `skip:`), before any filter -- the denominator
// for the "did the run actually cover what it claims" check below.
let definedRunnable = 0;

function loadScenarios() {
  if (!fs.existsSync(SCENARIOS_PATH)) return null;
  const cfg = JSON.parse(fs.readFileSync(SCENARIOS_PATH, "utf8"));
  definedRunnable = (cfg.scenarios || [])
    .filter((s) => s && typeof s === "object" && !Array.isArray(s) && !s.skip).length;
  return (cfg.scenarios || [])
    // JSON has no comments, so hand-edited scenario files tend to grow bare
    // strings as section headers. Spreading one would deserialize into a
    // garbage row ({0:"─",...}) that then "fails" the matrix -- drop non-objects.
    .filter((s) => s && typeof s === "object" && !Array.isArray(s))
    .filter((s) => !s.skip)
    .map((s) => ({ module: cfg.module || "alerts", ...s, gate: s.gate || "soft" }))
    .filter((s) => {
      if (GATES.indexOf(s.gate) < 0) {
        throw new Error(`scenario ${s.id}: unknown gate "${s.gate}" (expected one of ${GATES.join("|")})`);
      }
      return GATE_FILTER.length === 0 || GATE_FILTER.indexOf(s.gate) >= 0;
    })
    .filter((s) => ID_FILTER.length === 0 || ID_FILTER.indexOf(s.id) >= 0);
}

const scenarios = LIVE ? loadScenarios() : null;

// A live matrix run that selects ZERO rows must be a FAILURE, not a warning
// (PLAN_testing_that_can_fail 0.2: a gate that runs over an empty set is
// indistinguishable from a gate that passes). You asked for a live run; if the
// scenario file is missing, empty, or your MATRIX_IDS/MATRIX_GATE filter is a
// typo, the run covers nothing and the console warning scrolls past above a
// green "0 failed". MATRIX_ALLOW_SKIP=1 opts out for the legitimate case of a
// machine that has no box-specific scenario file at all.
const ALLOW_SKIP = process.env.MATRIX_ALLOW_SKIP === "1";
let emptyReason = null;
if (LIVE && !scenarios) {
  emptyReason =
    `${SCENARIOS_PATH} not found -- copy scenarios.local.example.json and fill in ` +
    `real record UUIDs (gitignored; box-specific).`;
} else if (LIVE && scenarios.length === 0) {
  emptyReason = definedRunnable === 0
    ? "the scenario file defines no runnable rows (all `skip: true`, or empty)."
    : `MATRIX_GATE=${process.env.MATRIX_GATE || "<unset>"} / MATRIX_IDS=` +
      `${process.env.MATRIX_IDS || "<unset>"} selected 0 of ${definedRunnable} rows ` +
      "-- almost certainly a typo'd filter.";
}

let d = describe.skip;
if (!LIVE) {
  // default offline run: silent skip, same as the other *.live.test.js
} else if (emptyReason && ALLOW_SKIP) {
  console.warn(`[matrix] SKIP (MATRIX_ALLOW_SKIP=1): ${emptyReason}`);
} else {
  d = describe;
}

d("live prompt/flow matrix", () => {
  // Serial by design (jest.live.config.js maxWorkers:1). With
  // FSRPB_REUSE_BROWSER=1 the rows SHARE one browser + login and reset between
  // rows via the widget's "+ New" control, which cuts a browser launch, a WAF
  // login and a first paint (~30-45s) off every row after the first. The held
  // browser must be closed here or jest finishes and never exits.
  afterAll(async () => {
    const { closeSharedSession } = require("../../lib/liveUiDriver");
    if (typeof closeSharedSession === "function") await closeSharedSession();
  });

  const budget = (scenarios || []).reduce((ms, s) => ms + (s.timeoutMs || 120000) + 90000, 60000);
  jest.setTimeout(budget);

  test("the run selected rows to grade", () => {
    // Fails LOUDLY where a console.warn used to scroll past a green run.
    expect(emptyReason || "").toBe("");
    expect((scenarios || []).length).toBeGreaterThan(0);
  });

  test("every matrix scenario satisfies its gate", async () => {
    if (emptyReason) return; // the row-selection test above already went red
    const rows = [];
    for (const sc of scenarios) {
      let res, evaluation, artifactPath;
      try {
        ({ res, evaluation, artifactPath } = await runScenario(sc));
        console.log(formatReport(sc, res, evaluation, artifactPath));
      } catch (e) {
        // A drive error (login/drawer/timeout) is a hard failure for that row.
        console.error(`[matrix] ${sc.id}: DRIVE ERROR: ${e && e.message}`);
        evaluation = {
          verdict: "FAIL (drive error)", why: String(e && e.message).slice(0, 200),
          // driveError blocks on every gate -- the row never ran, so no gate may
          // treat it as an expected/tolerated outcome (see gateRow).
          hardFail: true, driveError: true, redFlags: [],
          metrics: { toolCalls: 0, errCount: 0, distinctCauses: 0, gotExpected: [], expected: sc.expectedCards || [] },
        };
      }
      const gate = gateRow({ ...sc, evaluation });
      rows.push({ id: sc.id, kind: sc.kind, gate: sc.gate, evaluation, gateResult: gate });
    }

    // Summary table.
    const pad = (s, n) => String(s ?? "").padEnd(n);
    console.log("\n================ MATRIX SUMMARY ================");
    console.log(pad("id", 5) + pad("kind", 12) + pad("gate", 8) + pad("verdict", 26) + pad("gated", 20) + pad("flags", 7) + pad("tools", 7) + pad("errs", 6) + "cards got/expected");
    for (const r of rows) {
      const m = r.evaluation.metrics;
      console.log(
        pad(r.id, 5) + pad(r.kind, 12) + pad(r.gate, 8) + pad(r.evaluation.verdict, 26) +
        pad(r.gateResult.gateVerdict, 20) + pad((r.evaluation.redFlags || []).length, 7) +
        pad(m.toolCalls, 7) + pad(m.errCount, 6) +
        `[${m.gotExpected.join(",")}] / [${m.expected.join(",")}]`
      );
    }
    // Red flags across the whole run, gating or not -- the fix list.
    const flagged = rows.filter((r) => (r.evaluation.redFlags || []).length);
    if (flagged.length) {
      console.log("\n--- red flags (all rows) ---");
      for (const r of flagged) {
        for (const f of r.evaluation.redFlags) console.log(`  ${r.id}: ✗ ${f.code} -- ${f.detail}`);
      }
    }
    console.log("================================================\n");

    // Every selected row must have produced a graded result. A row that fell
    // out of the loop (an exception outside the try, an early return) would
    // otherwise just be absent from the summary -- and an absent row reads as
    // "nothing wrong with it" (PLAN_testing_that_can_fail 0.2).
    expect(rows.map((r) => r.id)).toEqual(scenarios.map((s) => s.id));

    // Coverage honesty: when no filter is set, the run must cover every row the
    // file defines. `ship-verify` row 2 failing and rows 3-4 then never running
    // is exactly this shape -- the run reports on what it reached, not on what
    // it was supposed to reach.
    if (GATE_FILTER.length === 0 && ID_FILTER.length === 0) {
      expect(rows.length).toBe(definedRunnable);
    } else {
      console.log(
        `[matrix] FILTERED RUN: ${rows.length} of ${definedRunnable} defined rows ` +
        `(gate=${GATE_FILTER.join(",") || "<all>"} ids=${ID_FILTER.join(",") || "<all>"}) ` +
        "-- this run does NOT cover the rest.");
    }

    const blockers = rows.filter((r) => r.gateResult.blocks);
    if (blockers.length) {
      console.error("gate failures:\n" + blockers.map(
        (r) => `  ${r.id} [${r.gate}] ${r.gateResult.gateVerdict}: ${r.gateResult.why}`).join("\n"));
    }
    expect(blockers.map((r) => r.id)).toEqual([]);
  });
});
