// Offline unit tests for the live-matrix evaluation engine
// (tests/live/lib/matrixDriver.js): pure evaluate()/isErr()/digestFrames()
// against SYNTHETIC frame arrays -- no browser, no box. This is the offline
// pass/fail signal for the eval logic the live matrix run depends on.
"use strict";

const { evaluate, isErr, digestFrames, canonCard } = require("./live/lib/matrixDriver");

// Synthetic frame builders.
const use = (name, input = {}) => ({ type: "tool_use", name, input });
const okResult = (tool, content = { ok: true, records: [{ id: 1 }] }) => ({ type: "tool_result", tool, content });
const errResult = (tool, content) => ({ type: "tool_result", tool, content });
const text = (t) => ({ type: "text", text: t });
const card = (type) => ({ type });
const end = (stop = "end_turn") => ({ type: "stream_end", stop_reason: stop });

describe("isErr classifier", () => {
  test("type:'error' frame is an error", () => {
    expect(isErr({ type: "error", message: "boom" })).toBe(true);
  });
  test("{ok:false} payload is an error", () => {
    expect(isErr(errResult("run_op", { ok: false }))).toBe(true);
  });
  test("{error:...} payload is an error", () => {
    expect(isErr(errResult("run_op", { error: "No module named 'probes'" }))).toBe(true);
  });
  test("ERR_RX catches degraded string payloads", () => {
    expect(isErr(errResult("search_module_records", "connector unavailable"))).toBe(true);
    expect(isErr(errResult("run_op", { suggestion: "unknown_operation: block_ip" }))).toBe(true);
  });
  test("healthy payloads are not errors", () => {
    expect(isErr(okResult("get_record", { ok: true, severity: "Critical" }))).toBe(false);
    expect(isErr(text("summary"))).toBe(false);
  });
  test("guard redirects (kind:guard_redirect) are steering, not errors", () => {
    expect(isErr(errResult("find_containment_actions", {
      ok: false, kind: "guard_redirect", hunt_floor_guard: true,
      error: "Do NOT call `find_containment_actions` yet -- it was NOT executed.",
    }))).toBe(false);
  });
  test("ok:true payload with nested 'error' strings is DATA, not a failure", () => {
    // list_configured_connectors reports each config's health -- one
    // unconfigured connector on the box must not red-flag the call.
    expect(isErr(okResult("list_configured_connectors", {
      ok: true,
      configured: [{ name: "imap", status: "error" },
                   { name: "smtp", status: "Available" }],
    }))).toBe(false);
  });
  test("native MCP {status:success, error:null} envelope is not an error", () => {
    // mcp_soc__get_indicators returns {status, result, error:null} -- no `ok`
    // field, so the serialized `"error":null` matched ERR_RX and falsely
    // failed a T1 triage whose tool call actually succeeded. status:"success"
    // must short-circuit like ok:true.
    expect(isErr(okResult("mcp_soc__get_indicators", {
      status: "success",
      result: { "hydra:member": [{ value: "198.51.100.23", reputation: "No Reputation Available" }] },
      error: null,
    }))).toBe(false);
    // …but a real failure envelope (status:error / non-null error) still trips.
    expect(isErr(errResult("mcp_soc__get_indicators", {
      status: "error", result: null, error: "connector unavailable",
    }))).toBe(true);
  });
  test("awaiting_input is a PARKED run, not a refusal", () => {
    // An approved run_playbook whose playbook contains a manual_input step
    // comes back ok:false + code:"awaiting_input" + triggered:true + run_pk.
    // The run HAPPENED and is parked on a resumable seam; grading it as a
    // failed call is what made SKL-MI / SKL-MI2 verdict "approval spent on a
    // refusal" 2/2 (tracker #88).
    expect(isErr(errResult("run_playbook", {
      ok: false, code: "awaiting_input", triggered: true, run_pk: "9247",
    }))).toBe(false);
    // A genuinely failed run still trips.
    expect(isErr(errResult("run_playbook", {
      ok: false, code: "error", error: "playbook not found",
    }))).toBe(true);
  });
});

describe("evaluate() verdict ladder", () => {
  test("0-tool triage → FAIL (no-investigation), even with a clean deliverable", () => {
    const frames = [text("Looks bad."), card("info_card"), end()];
    const ev = evaluate(frames, { expectedCards: ["info_card"], minTools: 1, errBudget: 1 });
    expect(ev.verdict).toBe("FAIL (no-investigation)");
    expect(ev.hardFail).toBe(true);
    expect(ev.metrics.toolCalls).toBe(0);
  });

  test("missing expected card → FAIL (no deliverable)", () => {
    const frames = [use("get_record"), okResult("get_record"), text("done"), end()];
    const ev = evaluate(frames, { expectedCards: ["action_card"], minTools: 1, errBudget: 1 });
    expect(ev.verdict).toBe("FAIL");
    expect(ev.hardFail).toBe(true);
    expect(ev.metrics.missingExpected).toEqual(["action_card"]);
  });

  test("errors over budget but expected card present → DEGRADED, self-corrected", () => {
    const frames = [
      use("run_op"), errResult("run_op", { error: "invalid endpoint" }),
      use("run_op"), errResult("run_op", { error: "connector not configured" }),
      use("search_module_records"), okResult("search_module_records"),
      card("action_card"), end("awaiting_action_card"),
    ];
    const ev = evaluate(frames, { expectedCards: ["action_card"], minTools: 1, errBudget: 1 });
    expect(ev.verdict).toBe("DEGRADED");
    expect(ev.hardFail).toBe(false);
    expect(ev.why).toContain("self-corrected");
    expect(ev.metrics.errCount).toBe(2);
  });

  test("repeated IDENTICAL error dedupes to distinctCauses === 1", () => {
    const same = { error: "No module named 'probes'" };
    const frames = [
      use("get_record"), errResult("get_record", same),
      use("get_record"), errResult("get_record", same),
      use("get_record"), errResult("get_record", same),
      card("info_card"), end(),
    ];
    const ev = evaluate(frames, { expectedCards: ["info_card"], minTools: 1, errBudget: 1 });
    expect(ev.metrics.errCount).toBe(3);
    expect(ev.metrics.distinctCauses).toBe(1);
    expect(ev.verdict).toBe("DEGRADED");
  });

  test("one error within budget → PASS (minor errors)", () => {
    const frames = [
      use("run_op"), errResult("run_op", { error: "timed out" }),
      use("run_op"), okResult("run_op"),
      card("info_card"), end(),
    ];
    const ev = evaluate(frames, { expectedCards: ["info_card"], minTools: 1, errBudget: 1 });
    expect(ev.verdict).toBe("PASS (minor errors)");
    expect(ev.hardFail).toBe(false);
  });

  test("clean investigative run → PASS", () => {
    const frames = [
      use("get_record"), okResult("get_record"),
      use("search_module_records"), okResult("search_module_records"),
      text("Consolidated findings…"), card("ioc_card"), end(),
    ];
    const ev = evaluate(frames, { expectedCards: ["ioc_card"], minTools: 2, errBudget: 1 });
    expect(ev.verdict).toBe("PASS");
    expect(ev.hardFail).toBe(false);
    expect(ev.metrics.errCount).toBe(0);
    expect(ev.metrics.gotExpected).toEqual(["ioc_card"]);
  });

  test("no expected-card gate: clean run → PASS with 'clean run'", () => {
    const frames = [use("get_record"), okResult("get_record"), text("ok"), end()];
    const ev = evaluate(frames, { expectedCards: [], minTools: 1, errBudget: 1 });
    expect(ev.verdict).toBe("PASS");
    expect(ev.why).toContain("clean run");
  });

  // Regression: the widget renders cards (info_card/status_card/…) that the
  // connector delivers INSIDE the final stream_end.transcript[], NOT as
  // top-level frames. The eval must descend into that transcript or it reports a
  // missing deliverable for a turn that actually produced one (live-observed on
  // T1: an ioc_enrichment info_card was rendered but the eval saw got=[]).
  test("cards nested in stream_end.transcript are counted as the deliverable", () => {
    const endWithTranscript = {
      type: "stream_end", stop_reason: "awaiting_choice",
      transcript: [
        use("run_op", { connector: "fortinet-fortiguard-ioc", op: "ioc_search" }),
        okResult("run_op", { ok: true, data: [{ "@type": "IOCSearch" }] }),
        { type: "info_card", id: "ioc-0", variant: "ioc_enrichment", title: "IOC: 1.2.3.4" },
      ],
    };
    // Top-level frames DON'T include the info_card -- only the transcript does.
    const frames = [use("run_op"), okResult("run_op"), text("summary"), endWithTranscript];
    const ev = evaluate(frames, { expectedCards: ["info_card"], minTools: 1, errBudget: 1 });
    expect(ev.metrics.gotExpected).toContain("info_card");
    expect(ev.metrics.missingExpected).toEqual([]);
    expect(ev.hardFail).toBe(false);
    expect(ev.metrics.terminalStop).toBe("awaiting_choice");
  });
});

// ── The approval arc: a spent approval must buy a run (#83) ──────────────────
//
// SKL-MIC graded "PASS (minor errors)" on a turn that ran NOTHING: run_playbook
// was staged as a tier-3 approval, the analyst approved, the tool refused
// `record_required`, the model retried correctly, and THAT raised a second
// approval card nobody answered. stop_reason=approval_required, no assistant
// text, zero playbook runs.
//
// Two independent holes let that pass, and each is closed separately below so
// neither can silently carry the other:
//   1. the refusal landed inside `errBudget: 1` -- a refusal that consumes an
//      approval is not a routine error;
//   2. nothing asserted where the turn ENDED, so stopping dead at a second gate
//      scored the same as running the playbook and reporting results.
//
// Same family as the two pre-commit hooks scoped to a deleted directory: a check
// that reports the same thing whether or not the thing it checks is true.
describe("approval arc (#83)", () => {
  // Real wire shape: a tool_result carries ONLY tool_use_id (no `.tool`), and
  // the approval_request names the tool_use it gates. The synthetic `.tool`
  // shorthand used above never occurs live, and the approval split keys on ids.
  const useId = (id, name, input = {}) => ({ type: "tool_use", id, name, input });
  const resId = (id, content) => ({ type: "tool_result", tool_use_id: id, content });
  const approval = (id, tool) => ({ type: "approval_request", tool_use_id: id, tool, tier: 3 });

  // The captured 0.5.95 arc, frame for frame.
  const brokenArc = () => [
    useId("c1", "list_module_playbooks"), resId("c1", { ok: true, playbooks: [{ name: "P" }] }),
    useId("c2", "run_playbook", { playbook: "P", follow: true }),
    approval("c2", "run_playbook"),
    resId("c2", { ok: false, code: "record_required", triggered: false }),
    useId("c3", "run_playbook", { playbook: "P", record: "/api/3/m/u", follow: true }),
    approval("c3", "run_playbook"),
    end("approval_required"),
  ];
  const row = { expectedCards: ["approval_request"], minTools: 1, errBudget: 1, autoApprove: true };

  test("a refusal on an APPROVED call is not absorbed by errBudget", () => {
    const ev = evaluate(brokenArc(), row);
    expect(ev.verdict).toBe("FAIL (approval spent on a refusal)");
    expect(ev.hardFail).toBe(true);
    // The whole point: it is OUT of the routine budget, not merely over it.
    expect(ev.metrics.errCount).toBe(0);
    expect(ev.metrics.approvalRefusals).toBe(1);
  });

  test("the terminal check fires independently of the refusal check", () => {
    // Same dead end, but the approved call SUCCEEDS -- so only the second
    // unanswered gate is left to catch. Without the terminal assertion this is
    // "PASS": the expected card is present and there are zero tool errors.
    const frames = brokenArc();
    frames[4] = resId("c2", { ok: true, runId: "r1" });
    const ev = evaluate(frames, row);
    expect(ev.verdict).toBe("FAIL (wrong terminal)");
    expect(ev.hardFail).toBe(true);
    expect(ev.metrics.terminalStop).toBe("approval_required");
    expect(ev.metrics.expectTerminal).toBe("end_turn");
    expect(ev.metrics.missingExpected).toEqual([]);   // the card gate was happy
    expect(ev.metrics.errCount).toBe(0);              // the error gate was happy
  });

  test("an approved run that resumes and reports results passes", () => {
    const ev = evaluate([
      useId("c1", "run_playbook", { playbook: "P" }),
      approval("c1", "run_playbook"),
      resId("c1", { ok: true, status: "finished", results: [{ device: "FG1" }] }),
      text("The playbook finished; DVMDB info synched."),
      end("end_turn"),
    ], row);
    expect(ev.verdict).toBe("PASS");
    expect(ev.hardFail).toBe(false);
  });

  // The guard against over-tightening. Rows that only STAGE an action card and
  // never click it legitimately end at approval_required -- an action_card halts
  // the turn for confirm by design. Deriving the expectation from autoApprove
  // (rather than applying it to every row) is what keeps those green.
  test("a row that does NOT auto-approve may end at approval_required", () => {
    const frames = [
      useId("c1", "run_op", { op: "block_ip" }),
      approval("c1", "run_op"),
      end("approval_required"),
    ];
    const ev = evaluate(frames, { expectedCards: ["approval_request"], minTools: 1 });
    expect(ev.metrics.expectTerminal).toBe(null);
    expect(ev.verdict).toBe("PASS");
    expect(ev.hardFail).toBe(false);
  });

  test("expectTerminal overrides the autoApprove-derived default", () => {
    const ev = evaluate(brokenArc().slice(0, 4).concat(
      resId("c2", { ok: true }), end("awaiting_choice")),
      { ...row, expectTerminal: "awaiting_choice" });
    expect(ev.metrics.expectTerminal).toBe("awaiting_choice");
    expect(ev.hardFail).toBe(false);
  });

  test("an approved run PARKED at a manual_input gate is not a refusal (#88)", () => {
    // SKL-MI / SKL-MI2: the approved run_playbook DID run (triggered:true, a
    // real run_pk) and stopped at the playbook's own manual_input step. The
    // ok:false seam is a resumable park, not a refusal -- the analyst's
    // approval bought a real run, so this must not verdict
    // "approval spent on a refusal".
    const ev = evaluate([
      useId("c1", "run_playbook", { playbook: "P" }),
      approval("c1", "run_playbook"),
      resId("c1", { ok: false, code: "awaiting_input", triggered: true, run_pk: "9247" }),
      text("The playbook is running and is waiting on your input."),
      end("end_turn"),
    ], row);
    expect(ev.metrics.approvalRefusals).toBe(0);
    expect(ev.metrics.errCount).toBe(0);   // nor does it burn the routine budget
    expect(ev.hardFail).toBe(false);
    expect(ev.verdict).toBe("PASS");
  });

  test("a PARK satisfies the DERIVED end_turn expectation (#88 live re-run)", () => {
    // The whole SKL-MI arc: approved run_playbook -> ran (triggered, run_pk) ->
    // parked at the playbook's own manual_input step -> the turn ends at
    // awaiting_manual_input. Zero tool errors, expected card present. Before
    // this, exempting awaiting_input from isErr just moved the failure one gate
    // down to "wrong terminal".
    const ev = evaluate([
      useId("c1", "run_playbook", { playbook: "P" }),
      approval("c1", "run_playbook"),
      resId("c1", { ok: false, code: "awaiting_input", triggered: true, run_pk: "9247" }),
      card("manual_input"),
      end("awaiting_manual_input"),
    ], { expectedCards: ["manual_input"], minTools: 1, errBudget: 1, autoApprove: true });
    expect(ev.verdict).toBe("PASS");
    expect(ev.hardFail).toBe(false);
    expect(ev.metrics.terminalParked).toBe(true);
    expect(ev.why).toContain("PARKED");   // never a silent pass
  });

  test("a park does NOT excuse a second approval gate", () => {
    // The dead end #83 exists to catch: the row clicked approve and the turn
    // stopped at ANOTHER gate. approval_required is deliberately not a park.
    const ev = evaluate(brokenArc().slice(0, 4).concat(
      resId("c2", { ok: true }), end("approval_required")), row);
    expect(ev.verdict).toBe("FAIL (wrong terminal)");
    expect(ev.hardFail).toBe(true);
  });

  test("an EXPLICIT expectTerminal is still matched exactly", () => {
    // Loosening a derived default must not loosen a deliberate assertion.
    const ev = evaluate([
      useId("c1", "run_playbook", { playbook: "P" }),
      approval("c1", "run_playbook"),
      resId("c1", { ok: false, code: "awaiting_input", triggered: true, run_pk: "9" }),
      card("manual_input"),
      end("awaiting_manual_input"),
    ], { expectedCards: ["manual_input"], minTools: 1, autoApprove: true,
         expectTerminal: "end_turn" });
    expect(ev.verdict).toBe("FAIL (wrong terminal)");
    expect(ev.metrics.terminalParked).toBe(false);
  });

  test("an UNapproved tool error still counts against errBudget", () => {
    // The split must not quietly exempt ordinary failures: only calls that
    // actually passed through an approval gate leave the budget.
    const ev = evaluate([
      useId("c1", "search"), resId("c1", { ok: false, error: "timed out" }),
      useId("c2", "search"), resId("c2", { ok: false, error: "timed out" }),
      card("info_card"), end(),
    ], { expectedCards: ["info_card"], minTools: 1, errBudget: 1 });
    expect(ev.metrics.errCount).toBe(2);
    expect(ev.metrics.approvalRefusals).toBe(0);
    expect(ev.verdict).toBe("DEGRADED");
  });
});

describe("card-type normalization (ioc_card ≡ info_card)", () => {
  // The widget renders status_card/info_card/ioc_card through one path
  // (fsrPbRender.js) and the connector normalizes IOC consolidation to an
  // info_card -- so the acceptance gate must treat ioc_card and info_card as one
  // deliverable, or it FAILs a genuinely-correct run over a frame-name coincidence.
  test("canonCard folds ioc_card → info_card, leaves others untouched", () => {
    expect(canonCard("ioc_card")).toBe("info_card");
    expect(canonCard("info_card")).toBe("info_card");
    expect(canonCard("action_card")).toBe("action_card");
    expect(canonCard("status_card")).toBe("status_card"); // NOT folded -- health card
  });

  test("emitted ioc_card satisfies an info_card expectation", () => {
    const frames = [
      use("get_record"), okResult("get_record"),
      use("search_module_records"), okResult("search_module_records"),
      text("Consolidated."), card("ioc_card"), end(),
    ];
    const ev = evaluate(frames, { expectedCards: ["info_card"], minTools: 2, errBudget: 1 });
    expect(ev.hardFail).toBe(false);
    expect(ev.metrics.missingExpected).toEqual([]);
    expect(ev.metrics.gotExpected).toEqual(["info_card"]);
  });

  test("emitted info_card satisfies an ioc_card expectation (reverse direction)", () => {
    const frames = [
      use("run_op"), okResult("run_op"),
      use("run_op"), okResult("run_op"),
      card("info_card"), end(),
    ];
    const ev = evaluate(frames, { expectedCards: ["ioc_card"], minTools: 2, errBudget: 1 });
    expect(ev.hardFail).toBe(false);
    expect(ev.metrics.gotExpected).toEqual(["ioc_card"]);
  });

  test("status_card does NOT satisfy an info_card expectation", () => {
    const frames = [use("run_op"), okResult("run_op"), card("status_card"), end()];
    const ev = evaluate(frames, { expectedCards: ["info_card"], minTools: 1, errBudget: 1 });
    expect(ev.verdict).toBe("FAIL");
    expect(ev.metrics.missingExpected).toEqual(["info_card"]);
  });
});

describe("digestFrames", () => {
  test("captures counts, order, terminal stop, and streamed text", () => {
    const frames = [use("get_record"), okResult("get_record"), text("a"), text("b"), end("end_turn")];
    const d = digestFrames(frames);
    expect(d.counts.tool_use).toBe(1);
    expect(d.counts.text).toBe(2);
    expect(d.order).toEqual(["tool_use", "tool_result", "text", "stream_end"]);
    expect(d.text).toBe("ab");
    expect(d.terminalStop).toBe("end_turn");
  });
});

// ─── Gate ladder ─────────────────────────────────────────────────────────────
//
// The matrix must hold two kinds of row at once: rows that must stay clean
// (strict) and rows that document an OPEN bug (xfail). A suite that goes
// perma-red on a known bug gets ignored; one that only blocks on hard-FAIL
// ships DEGRADED regressions silently. These pin that contract.
// See docs/plans/live-chat-eval-and-build-flow-fixes.md Phase 4.
describe("gateRow -- per-row gating", () => {
  const { gateRow } = require("./live/lib/matrixDriver");
  const ev = (verdict, { hardFail = false, flags = [] } = {}) => ({
    verdict, hardFail, why: verdict, redFlags: flags.map((code) => ({ code, detail: code })),
  });

  describe("soft (default, the legacy contract)", () => {
    test("only a hard-FAIL blocks", () => {
      expect(gateRow({ evaluation: ev("FAIL", { hardFail: true }) }).blocks).toBe(true);
    });
    test("DEGRADED ships", () => {
      expect(gateRow({ evaluation: ev("DEGRADED") }).blocks).toBe(false);
    });
    test("a red flag alone does not block a soft row", () => {
      expect(gateRow({ evaluation: ev("PASS", { flags: ["trace_tool_no_trace"] }) }).blocks).toBe(false);
    });
    test("an absent gate field defaults to soft", () => {
      expect(gateRow({ evaluation: ev("DEGRADED") }).gateVerdict).toBe("OK");
    });
  });

  describe("strict", () => {
    test("PASS is OK", () => {
      expect(gateRow({ gate: "strict", evaluation: ev("PASS") }).blocks).toBe(false);
    });
    test("DEGRADED blocks", () => {
      expect(gateRow({ gate: "strict", evaluation: ev("DEGRADED") }).blocks).toBe(true);
    });
    test("a red flag blocks even when the frame metrics look clean", () => {
      const g = gateRow({ gate: "strict", evaluation: ev("PASS", { flags: ["hallucinated_http_endpoint"] }) });
      expect(g.blocks).toBe(true);
      expect(g.why).toMatch(/hallucinated_http_endpoint/);
    });
  });

  describe("xfail -- documents an open bug without going perma-red", () => {
    const row = { gate: "xfail", expectRedFlags: ["triage_guard_in_build", "trace_tool_no_trace"] };

    test("still-broken (an expected flag fired) does NOT block", () => {
      const g = gateRow({ ...row, evaluation: ev("FAIL", { hardFail: true, flags: ["triage_guard_in_build"] }) });
      expect(g.blocks).toBe(false);
      expect(g.gateVerdict).toBe("XFAIL (expected)");
    });

    test("ANY one expected flag suffices -- a partial fix does not flake the run", () => {
      // LLM turns are nondeterministic; requiring ALL expected codes every run
      // would red the suite on noise rather than on a real change.
      const g = gateRow({ ...row, evaluation: ev("FAIL", { hardFail: true, flags: ["trace_tool_no_trace"] }) });
      expect(g.blocks).toBe(false);
    });

    test("a CLEAN run REPORTS but does NOT block -- clean != fixed", () => {
      // Learned live: every row is an LLM turn, so a defect is only observable
      // when the model exercises it. The same prompt tripped the triage toolset
      // on 3 of 4 runs against an unchanged, still-broken connector -- so
      // blocking on a clean run would both flake AND assert a live bug was
      // fixed when it wasn't. Report, don't block.
      const g = gateRow({ ...row, evaluation: ev("PASS") });
      expect(g.blocks).toBe(false);
      expect(g.gateVerdict).toBe("XPASS (promote?)");
      expect(g.why).toMatch(/NOT proof/);
    });

    test("with no expectRedFlags, any flag or hard-fail counts as still-broken", () => {
      expect(gateRow({ gate: "xfail", evaluation: ev("FAIL", { hardFail: true }) }).blocks).toBe(false);
      expect(gateRow({ gate: "xfail", evaluation: ev("PASS") }).blocks).toBe(false);
    });
  });

  describe("forbidRedFlags -- keeps an xfail row honest", () => {
    test("a forbidden flag blocks even on an xfail row parked for another bug", () => {
      // P6b is parked for the open D2 connector bug, but D1 (the leaked mount
      // module) is FIXED -- if it regresses on the same turn, the row must red.
      const g = gateRow({
        gate: "xfail",
        expectRedFlags: ["triage_guard_in_build"],
        forbidRedFlags: ["mount_module_leaked_into_start"],
        evaluation: ev("FAIL", { hardFail: true, flags: ["triage_guard_in_build", "mount_module_leaked_into_start"] }),
      });
      expect(g.blocks).toBe(true);
      expect(g.gateVerdict).toBe("BLOCK (regression)");
      expect(g.why).toMatch(/regressed/);
    });

    test("no forbidden flag → the xfail row behaves normally", () => {
      const g = gateRow({
        gate: "xfail",
        expectRedFlags: ["triage_guard_in_build"],
        forbidRedFlags: ["mount_module_leaked_into_start"],
        evaluation: ev("FAIL", { hardFail: true, flags: ["triage_guard_in_build"] }),
      });
      expect(g.blocks).toBe(false);
    });
  });
});

describe("gateRow -- a drive error blocks on EVERY gate", () => {
  const { gateRow } = require("./live/lib/matrixDriver");
  // A drive error (login/mount/drawer/timeout) means the row never sent a
  // prompt. It is infrastructure, never an expected bug -- so no gate, not even
  // xfail, may swallow it. Observed live: a broken dashboard mount produced
  // "composer not found" and the xfail row reported "XPASS (promote?)", i.e. it
  // claimed a bug looked fixed for a scenario that never ran.
  const driveErr = {
    verdict: "FAIL (drive error)", why: "composer not found -- drawer did not open",
    hardFail: true, driveError: true, redFlags: [],
  };

  test("xfail does NOT swallow a drive error", () => {
    const g = gateRow({ gate: "xfail", expectRedFlags: ["triage_tool_in_build"], evaluation: driveErr });
    expect(g.blocks).toBe(true);
    expect(g.gateVerdict).toBe("BLOCK (drive error)");
    expect(g.why).toMatch(/never ran/);
  });

  test("strict and soft block it too", () => {
    expect(gateRow({ gate: "strict", evaluation: driveErr }).blocks).toBe(true);
    expect(gateRow({ gate: "soft", evaluation: driveErr }).blocks).toBe(true);
  });

  test("a drive error outranks forbidRedFlags (report the real cause)", () => {
    const g = gateRow({ gate: "xfail", forbidRedFlags: ["mount_module_leaked_into_start"], evaluation: driveErr });
    expect(g.gateVerdict).toBe("BLOCK (drive error)");
  });
});

// ─── ENV-SKIP: box lacks the capability vs the agent misbehaving ─────────────
//
// Both shapes below end in a capability_gap card, but only ONE is the box's
// fault. Observed live on GA: T4 (containment ask, zero containment actions
// configured) correctly emitted capability_gap and must NOT red the suite; T2
// (hunt ask) ALSO emitted a containment capability_gap -- but that was the agent
// self-assigning containment instead of consolidating its IOCs, a real defect.
// Excusing every capability_gap would mask T2. These pin that line.
describe("evaluate() -- ENV-SKIP is narrow by design", () => {
  const noContainment = () => ({
    type: "tool_result", tool: "find_containment_actions",
    content: { ok: true, target_type: "ip", actions: [], count: 0, probed: true },
  });

  test("containment ask + zero configured actions → ENV-SKIP, not FAIL", () => {
    const frames = [
      use("get_record"), okResult("get_record"),
      use("find_containment_actions"), noContainment(),
      card("capability_gap"), end(),
    ];
    const ev = evaluate(frames, { kind: "containment", expectedCards: ["action_card"], minTools: 1, errBudget: 1 });
    expect(ev.verdict).toBe("ENV-SKIP (no containment capability)");
    expect(ev.hardFail).toBe(false);
  });

  test("HUNT ask that drifts to a containment capability_gap still FAILs (the GA T2 defect)", () => {
    // The agent hunted, then self-assigned containment and emitted a gap card
    // instead of the consolidated info_card. Box capability is irrelevant here --
    // it was never asked to contain.
    const frames = [
      use("get_record"), okResult("get_record"),
      use("run_op"), okResult("run_op", { ok: true, data: [{ ioc: "203.0.113.66" }] }),
      use("find_containment_actions"), noContainment(),
      card("capability_gap"), end(),
    ];
    const ev = evaluate(frames, { kind: "triage", expectedCards: ["info_card"], minTools: 2, errBudget: 1 });
    expect(ev.verdict).toBe("FAIL");
    expect(ev.hardFail).toBe(true);
    expect(ev.metrics.missingExpected).toEqual(["info_card"]);
  });

  test("containment ask WITH actions available → no ENV-SKIP; a missing card is a real FAIL", () => {
    const frames = [
      use("find_containment_actions"),
      { type: "tool_result", tool: "find_containment_actions",
        content: { ok: true, actions: [{ connector: "fortigate-firewall", op: "block_ip" }], count: 1 } },
      card("capability_gap"), end(),
    ];
    const ev = evaluate(frames, { kind: "containment", expectedCards: ["action_card"], minTools: 1, errBudget: 1 });
    expect(ev.verdict).toBe("FAIL");
    expect(ev.hardFail).toBe(true);
  });

  test("containment ask with no capability_gap card emitted → not an ENV-SKIP", () => {
    const frames = [use("find_containment_actions"), noContainment(), end()];
    const ev = evaluate(frames, { kind: "containment", expectedCards: ["action_card"], minTools: 1, errBudget: 1 });
    expect(ev.hardFail).toBe(true);
  });
});

// ─── Wire-shaped frames (the shape the box ACTUALLY sends) ───────────────────
//
// Every synthetic frame above sets tool_result.tool -- but a LIVE tool_result is
// {type, tool_use_id, content} with NO .tool; the name lives on the matching
// tool_use.id. Reading f.tool therefore yielded "" on every real run, so the
// tool trace and every tool-ERROR row printed a blank name ("✗  {json}") and you
// could not tell which tool failed. The offline suite missed it for months by
// encoding a shape the wire never produces. These use the REAL shape.
describe("digestFrames -- resolves tool names from tool_use_id (live wire shape)", () => {
  const wireUse = (id, name, input = {}) => ({ type: "tool_use", id, name, input, tier: 1 });
  const wireResult = (id, content) => ({ type: "tool_result", tool_use_id: id, content, duration_ms: 12 });

  test("a live tool_result gets its name from the matching tool_use", () => {
    const d = digestFrames([
      wireUse("toolu_1", "get_record", { iri: "/api/3/alerts/x" }),
      wireResult("toolu_1", { ok: true }),
      end(),
    ]);
    expect(d.tools.join("\n")).toContain("⤷ result get_record:");
  });

  test("a live tool ERROR is attributed to its tool, not blank", () => {
    const d = digestFrames([
      wireUse("toolu_1", "build_playbook_from_trace", {}),
      wireResult("toolu_1", { ok: false, code: "empty_trace" }),
      end(),
    ]);
    expect(d.toolErrors).toHaveLength(1);
    expect(d.toolErrors[0].tool).toBe("build_playbook_from_trace"); // was "" before
  });

  test("interleaved concurrent calls attribute to the right tool", () => {
    // Two tools in flight; results can come back out of order.
    const d = digestFrames([
      wireUse("a", "find_operation", { q: "block" }),
      wireUse("b", "find_connector", { q: "fortigate" }),
      wireResult("b", { matches: [{ name: "fortigate-firewall" }] }),
      wireResult("a", { ok: false, error: "unknown_operation" }),
      end(),
    ]);
    expect(d.toolErrors.map((e) => e.tool)).toEqual(["find_operation"]);
  });

  test("an explicit .tool still wins (legacy/synthetic frames keep working)", () => {
    const d = digestFrames([use("run_op"), errResult("run_op", { ok: false }), end()]);
    expect(d.toolErrors[0].tool).toBe("run_op");
  });
});

// ─── Zero frames is a DRIVE failure, not an agent verdict ────────────────────
//
// Observed live on GA: T2 returned 0 chat_poll frames AND 0 chat_turn requests --
// the prompt never reached the connector. The eval nonetheless reported
// "FAIL (no-investigation) -- this is an LLM summarizer, not an investigator; the
// agent narrated the seed context", inventing a specific behavioural accusation
// about a turn that never ran. "No tools among real frames" and "no frames at
// all" are different facts and must not share a verdict.
describe("evaluate() -- an empty capture is not blamed on the agent", () => {
  test("zero frames → FAIL (no turn captured) + driveError, NOT no-investigation", () => {
    const ev = evaluate([], { kind: "triage", expectedCards: ["info_card"], minTools: 2, errBudget: 1 });
    expect(ev.verdict).toBe("FAIL (no turn captured)");
    expect(ev.driveError).toBe(true);
    expect(ev.why).not.toMatch(/summarizer|narrated/);
  });

  test("a genuine 0-tool turn (frames present) still reports no-investigation", () => {
    // The agent really did answer from seed context -- that IS an agent defect.
    const ev = evaluate([text("Looks like a C2 beacon."), card("info_card"), end()],
      { kind: "triage", expectedCards: ["info_card"], minTools: 2, errBudget: 1 });
    expect(ev.verdict).toBe("FAIL (no-investigation)");
    expect(ev.driveError).toBe(false);
    expect(ev.why).toMatch(/summarizer/);
  });

  test("an empty capture blocks on every gate, including xfail", () => {
    const { gateRow } = require("./live/lib/matrixDriver");
    const evaluation = evaluate([], { kind: "build", minTools: 1 });
    const g = gateRow({ gate: "xfail", expectRedFlags: ["triage_tool_in_build"], evaluation });
    expect(g.blocks).toBe(true);
    expect(g.gateVerdict).toBe("BLOCK (drive error)");
  });

  test("submitConfirmed=false → drive error even when a stray frame leaked in", () => {
    // A frame from an earlier turn is present, so the zero-frames guard would
    // miss it -- but the submit never registered, so THIS turn never ran.
    const ev = evaluate([text("stale frame from a prior turn")],
      { kind: "triage", expectedCards: ["info_card"], minTools: 2, errBudget: 1,
        submitConfirmed: false });
    expect(ev.verdict).toBe("FAIL (no turn captured)");
    expect(ev.driveError).toBe(true);
    expect(ev.why).toMatch(/submitConfirmed/);
  });

  test("submitConfirmed=true (or omitted) does not force a drive error", () => {
    const ev = evaluate([text("Looks like a C2 beacon."), card("info_card"), end()],
      { kind: "triage", expectedCards: ["info_card"], minTools: 2, errBudget: 1,
        submitConfirmed: true });
    expect(ev.verdict).toBe("FAIL (no-investigation)");   // graded on merits, not drive
    expect(ev.driveError).toBe(false);
  });

  test("approvalDriveError → drive error, not a missing-deliverable verdict", () => {
    // The turn streamed and gated correctly, but the driver's Approve click
    // never registered, so the post-gate half never ran. Grading these frames
    // on merit would blame the agent for a manual_input card the driver
    // prevented it from ever emitting.
    const ev = evaluate([card("approval_request"), end()],
      { kind: "ztpf", expectedCards: ["approval_request", "manual_input"],
        minTools: 1, errBudget: 1, submitConfirmed: true,
        approvalDriveError: 'the "approve" click never registered' });
    expect(ev.verdict).toBe("FAIL (no turn captured)");
    expect(ev.driveError).toBe(true);
    expect(ev.why).toMatch(/never registered/);
  });

  test("a decided approval that reaches the post-gate card grades on merit", () => {
    const ev = evaluate([use("run_playbook"), card("approval_request"), card("manual_input"), end()],
      { kind: "ztpf", expectedCards: ["approval_request", "manual_input"],
        minTools: 1, errBudget: 1, submitConfirmed: true, approvalDriveError: null });
    expect(ev.driveError).toBe(false);
    expect(ev.verdict).toMatch(/^PASS/);
  });
});
