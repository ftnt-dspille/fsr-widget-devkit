// The grading vocabulary is shared across three repos (P0a of
// docs/plans/agentic-tooling-best-practices-alignment.md). These tests hold the
// two properties that make sharing it safe:
//
//   1. matrixDriver READS the vocabulary -- it must not carry a second, drifting
//      copy of the error pattern / card aliases / gates.
//   2. the vocabulary is language-NEUTRAL -- a Python consumer must be able to
//      compile the same regex and read the same ladder without a JS runtime.
//
// Without (1) this file is decoration; without (2) the Python side silently
// forks. Both are the parallel-name-list bug class, which is why they are
// asserted rather than documented.
"use strict";

const fs = require("fs");
const path = require("path");

const VOCAB_PATH = path.join(__dirname, "live/lib/verdict-vocabulary.json");
const DRIVER_PATH = path.join(__dirname, "live/lib/matrixDriver.js");
const VOCAB = require(VOCAB_PATH);
const { isErr, evaluate, GATES } = require("./live/lib/matrixDriver");

describe("verdict vocabulary is the single source", () => {
  test("matrixDriver loads the vocabulary file", () => {
    const src = fs.readFileSync(DRIVER_PATH, "utf8");
    expect(src).toContain('require("./verdict-vocabulary.json")');
  });

  test("no second copy of the error pattern lives in the driver", () => {
    const src = fs.readFileSync(DRIVER_PATH, "utf8");
    // The old hardcoded literal began with this alternation. If it comes back,
    // the two definitions will drift the moment one is edited.
    expect(src).not.toMatch(/\/\\b\(error\|unavailable/);
  });

  test("gate names come from the vocabulary", () => {
    expect(GATES).toEqual(VOCAB.gates.names);
  });

  test("every hardFail verdict in the ladder is spelled FAIL", () => {
    // The driver used to infer hardFail from `startsWith("FAIL")`. It now uses
    // ladder membership, so this asserts the two agree -- if a future non-FAIL
    // verdict needs to block, that is a deliberate change and this test is
    // where you notice.
    for (const v of VOCAB.verdicts.ladder) {
      expect(v.hardFail === true).toBe(v.name.startsWith("FAIL"));
    }
  });

  test("a drive error is always also a hard fail", () => {
    for (const v of VOCAB.verdicts.ladder) {
      if (v.driveError) expect(v.hardFail).toBe(true);
    }
  });
});

describe("vocabulary is language-neutral", () => {
  test("the error pattern uses no JS-only regex syntax", () => {
    const src = VOCAB.errorPattern.source;
    expect(src).not.toMatch(/\(\?<[=!]/);   // lookbehind -- not portable
    expect(src).not.toMatch(/\(\?<\w+>/);   // named groups -- differing syntax
    expect(src).not.toMatch(/\\[dswDSW]\{/); // JS-specific quantified classes
  });

  test("the file is pure data -- no comments outside $comment keys", () => {
    const raw = fs.readFileSync(VOCAB_PATH, "utf8");
    expect(() => JSON.parse(raw)).not.toThrow();
    expect(raw).not.toMatch(/^\s*\/\//m);
  });

  test("it carries a version so a stale vendored copy is detectable", () => {
    expect(typeof VOCAB.version).toBe("number");
  });
});

describe("behaviour is unchanged by the extraction", () => {
  test("the shared pattern still classifies the documented error shapes", () => {
    expect(isErr({ type: "tool_result", content: { ok: false } })).toBe(true);
    expect(isErr({ type: "tool_result", content: "unknown_operation" })).toBe(true);
    expect(isErr({ type: "error" })).toBe(true);
  });

  test("a guard_redirect is steering, not an error", () => {
    expect(isErr({ type: "tool_result", content: { kind: "guard_redirect" } }))
      .toBe(false);
  });

  test("ok:true with a nested error string is DATA, not a failure", () => {
    expect(isErr({ type: "tool_result", content: { ok: true, detail: "error" } }))
      .toBe(false);
  });

  test("hardFail is decided by ladder membership", () => {
    const noTools = evaluate([{ type: "text" }], { minTools: 1 });
    expect(noTools.verdict).toBe("FAIL (no-investigation)");
    expect(noTools.hardFail).toBe(true);

    const clean = evaluate(
      [{ type: "tool_use", id: "1", name: "get_record" },
       { type: "tool_result", tool_use_id: "1", content: { ok: true } }],
      { minTools: 1 });
    expect(clean.hardFail).toBe(false);
  });

  // The .159 TB/TO rows failed with `got=[]` while their transcript digest
  // showed `action_card: 1` and stop_reason `awaiting_action_card` -- the card
  // WAS staged. The connector now renders a tier-3 run_op approval as an
  // action_card (`_approval_to_action_card`), so the box scenario files' older
  // `approval_request` expectation could never be met. Same defect on .206
  // (Z4/C1/SKL-MIC). The checked-in example file already says action_card.
  test("an approval_request expectation is met by a staged action_card", () => {
    const frames = [
      { type: "tool_use", id: "1", name: "emit_action_card" },
      { type: "tool_result", tool_use_id: "1", content: { ok: true } },
      { type: "stream_end",
        stop_reason: "awaiting_action_card",
        transcript: [
          { type: "tool_use", id: "1", name: "emit_action_card" },
          { type: "tool_result", tool_use_id: "1", content: { ok: true } },
          { type: "action_card", id: "block_ip", connector: "fortigate-firewall" },
        ] },
    ];
    const r = evaluate(frames, { expectedCards: ["approval_request"], minTools: 0 });
    expect(r.metrics.missingExpected).toEqual([]);
    expect(r.hardFail).toBe(false);
  });

  test("the alias is symmetric -- a legacy approval_request meets action_card", () => {
    const frames = [
      { type: "stream_end",
        stop_reason: "awaiting_approval",
        transcript: [
          { type: "tool_use", id: "1", name: "run_op" },
          { type: "tool_result", tool_use_id: "1", content: { ok: true } },
          { type: "approval_request", approval_id: "a1" },
        ] },
    ];
    const r = evaluate(frames, { expectedCards: ["action_card"], minTools: 0 });
    expect(r.metrics.missingExpected).toEqual([]);
  });

  test("the alias does not make every card interchangeable", () => {
    const frames = [
      { type: "stream_end",
        stop_reason: "end_turn",
        transcript: [
          { type: "tool_use", id: "1", name: "get_record" },
          { type: "tool_result", tool_use_id: "1", content: { ok: true } },
          { type: "info_card", id: "i1" },
        ] },
    ];
    const r = evaluate(frames, { expectedCards: ["approval_request"], minTools: 0 });
    expect(r.metrics.missingExpected).toEqual(["approval_request"]);
  });

  test("the defaults match the documented contract", () => {
    expect(VOCAB.defaults.errBudget).toBe(1);
    expect(VOCAB.defaults.minTools).toBe(1);
  });
});
