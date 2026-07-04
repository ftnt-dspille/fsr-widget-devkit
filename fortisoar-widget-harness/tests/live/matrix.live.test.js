// Live prompt/flow MATRIX (docs/PROMPT_FLOW_TEST_PLAN.md T1–T10 / P1–P5):
// drive the deployed widget drawer on real records, one prompt per scenario
// row, and evaluate each captured turn with tests/live/lib/matrixDriver.js.
//
// Gated: FSRPB_LIVE=1 (plus FSR_BASE_URL/FSR_USERNAME/FSR_PASSWORD; live UI
// runs are HEADED — FSRPB_HEADED=1 — because the WAF blocks headless UAs).
// Run via `make test-matrix-live`, never by hand.
//
// Scenario rows carry box-specific record UUIDs, so they live in the
// GITIGNORED tests/live/scenarios.local.json (copy scenarios.local.example.json
// and fill in real UUIDs). Absent file → skip-with-warning, never red.
//
// PASS/FAIL contract (deliberate — documented so nobody "fixes" it):
// only hard-FAIL verdicts (FAIL / FAIL (no-investigation)) fail this jest
// test. PASS, PASS (minor errors), and DEGRADED do NOT — DEGRADED rows are
// surfaced in the summary table as prompt/tool/connector fixes to chase, not
// as gate failures.
"use strict";

const fs = require("fs");
const path = require("path");
const { runScenario, formatReport } = require("./lib/matrixDriver");

const LIVE = process.env.FSRPB_LIVE === "1";
const SCENARIOS_PATH = path.join(__dirname, "scenarios.local.json");

function loadScenarios() {
  if (!fs.existsSync(SCENARIOS_PATH)) return null;
  const cfg = JSON.parse(fs.readFileSync(SCENARIOS_PATH, "utf8"));
  return (cfg.scenarios || [])
    .filter((s) => !s.skip)
    .map((s) => ({ module: cfg.module || "alerts", ...s }));
}

const scenarios = LIVE ? loadScenarios() : null;

let d = describe.skip;
if (!LIVE) {
  // default offline run: silent skip, same as the other *.live.test.js
} else if (!scenarios) {
  console.warn(
    `[matrix] SKIP: ${SCENARIOS_PATH} not found — copy scenarios.local.example.json ` +
    `and fill in real record UUIDs (gitignored; box-specific).`
  );
} else if (scenarios.length === 0) {
  console.warn("[matrix] SKIP: scenarios.local.json has no runnable rows (all skipped or empty).");
} else {
  d = describe;
}

d("live prompt/flow matrix", () => {
  // Serial by design (jest.live.config.js maxWorkers:1): one browser session
  // per scenario against the shared live SOAR.
  const budget = (scenarios || []).reduce((ms, s) => ms + (s.timeoutMs || 120000) + 90000, 60000);
  jest.setTimeout(budget);

  test("every matrix scenario avoids a hard-FAIL verdict", async () => {
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
          hardFail: true, metrics: { toolCalls: 0, errCount: 0, distinctCauses: 0, gotExpected: [], expected: sc.expectedCards || [] },
        };
      }
      rows.push({ id: sc.id, kind: sc.kind, evaluation });
    }

    // Summary table.
    const pad = (s, n) => String(s ?? "").padEnd(n);
    console.log("\n================ MATRIX SUMMARY ================");
    console.log(pad("id", 5) + pad("kind", 12) + pad("verdict", 26) + pad("tools", 7) + pad("errs", 6) + pad("causes", 8) + "cards got/expected");
    for (const r of rows) {
      const m = r.evaluation.metrics;
      console.log(
        pad(r.id, 5) + pad(r.kind, 12) + pad(r.evaluation.verdict, 26) +
        pad(m.toolCalls, 7) + pad(m.errCount, 6) + pad(m.distinctCauses, 8) +
        `[${m.gotExpected.join(",")}] / [${m.expected.join(",")}]`
      );
    }
    console.log("================================================\n");

    const hardFails = rows.filter((r) => r.evaluation.hardFail);
    if (hardFails.length) {
      console.error("hard failures:\n" + hardFails.map((r) => `  ${r.id}: ${r.evaluation.verdict} — ${r.evaluation.why}`).join("\n"));
    }
    expect(hardFails.map((r) => r.id)).toEqual([]);
  });
});
