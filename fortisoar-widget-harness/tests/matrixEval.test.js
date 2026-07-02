// Offline unit tests for the live-matrix evaluation engine
// (tests/live/lib/matrixDriver.js): pure evaluate()/isErr()/digestFrames()
// against SYNTHETIC frame arrays — no browser, no box. This is the offline
// pass/fail signal for the eval logic the live matrix run depends on.
"use strict";

const { evaluate, isErr, digestFrames } = require("./live/lib/matrixDriver");

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
