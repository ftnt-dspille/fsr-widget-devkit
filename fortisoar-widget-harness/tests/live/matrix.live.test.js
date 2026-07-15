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
// PASS/FAIL contract — now PER ROW (`gate`), see matrixDriver.gateRow:
//   soft   (default) only a hard-FAIL blocks. The original contract: PASS,
//                    PASS (minor errors) and DEGRADED all ship, and DEGRADED is
//                    surfaced in the summary as a fix to chase.
//   strict           hard-FAIL, DEGRADED, or any red flag blocks.
//   xfail            expected to red-flag (an open bug); blocks only when it
//                    comes back clean → promote it.
// `forbidRedFlags[]` blocks on any gate, so a row parked for one open bug still
// guards the bugs already fixed on that turn.
//
// Every row is additionally graded by the exportGrader red-flag rules — the
// same rules that grade downloaded `.events.json` exports — so a known-bad flow
// signature caught once offline gates the live matrix forever after.
//
// MATRIX_GATE=strict,xfail runs ONLY the gating rows (`make test-matrix-gate`).
"use strict";

const fs = require("fs");
const path = require("path");
const { runScenario, formatReport, gateRow, GATES } = require("./lib/matrixDriver");

const LIVE = process.env.FSRPB_LIVE === "1";
// Scenario rows are BOX-SPECIFIC (real record UUIDs), and MATRIX_ENV switches
// boxes — so the rows must switch with it, or a 206 run drives 159's records.
// The Makefile resolves MATRIX_ENV=.env.206 → scenarios.local.206.json when that
// file exists, falling back to scenarios.local.json.
const SCENARIOS_PATH = process.env.MATRIX_SCENARIOS
  ? path.resolve(process.env.MATRIX_SCENARIOS)
  : path.join(__dirname, "scenarios.local.json");

// Only run rows whose gate is in MATRIX_GATE (comma-separated). Unset = all.
const GATE_FILTER = (process.env.MATRIX_GATE || "")
  .split(",").map((s) => s.trim()).filter(Boolean);

function loadScenarios() {
  if (!fs.existsSync(SCENARIOS_PATH)) return null;
  const cfg = JSON.parse(fs.readFileSync(SCENARIOS_PATH, "utf8"));
  return (cfg.scenarios || [])
    // JSON has no comments, so hand-edited scenario files tend to grow bare
    // strings as section headers. Spreading one would deserialize into a
    // garbage row ({0:"─",...}) that then "fails" the matrix — drop non-objects.
    .filter((s) => s && typeof s === "object" && !Array.isArray(s))
    .filter((s) => !s.skip)
    .map((s) => ({ module: cfg.module || "alerts", ...s, gate: s.gate || "soft" }))
    .filter((s) => {
      if (GATES.indexOf(s.gate) < 0) {
        throw new Error(`scenario ${s.id}: unknown gate "${s.gate}" (expected one of ${GATES.join("|")})`);
      }
      return GATE_FILTER.length === 0 || GATE_FILTER.indexOf(s.gate) >= 0;
    });
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

  test("every matrix scenario satisfies its gate", async () => {
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
          // driveError blocks on every gate — the row never ran, so no gate may
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
    // Red flags across the whole run, gating or not — the fix list.
    const flagged = rows.filter((r) => (r.evaluation.redFlags || []).length);
    if (flagged.length) {
      console.log("\n--- red flags (all rows) ---");
      for (const r of flagged) {
        for (const f of r.evaluation.redFlags) console.log(`  ${r.id}: ✗ ${f.code} — ${f.detail}`);
      }
    }
    console.log("================================================\n");

    const blockers = rows.filter((r) => r.gateResult.blocks);
    if (blockers.length) {
      console.error("gate failures:\n" + blockers.map(
        (r) => `  ${r.id} [${r.gate}] ${r.gateResult.gateVerdict}: ${r.gateResult.why}`).join("\n"));
    }
    expect(blockers.map((r) => r.id)).toEqual([]);
  });
});
