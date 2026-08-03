"use strict";

// ─── Offline grader for downloaded `.events.json` chat exports ───────────────
//
// The offline half of the live-eval loop: a real chat run in the SOAR UI is
// downloaded via the widget Export modal, and gradeExport() flags known-bad flow
// signatures without re-running the box. This asserts the grader on a REAL
// captured failure (the "create a new playbook to block an ip and create an
// alert" build turn) so the four defects it exposed stay detected as regressions
// -- and on synthetic clean input so a good turn grades PASS.
//
// See docs/plans/live-chat-eval-and-build-flow-fixes.md.

const fs = require("fs");
const path = require("path");
const { gradeExport, digestExport } = require("./live/lib/exportGrader");

const FIXTURE = path.join(__dirname, "live/fixtures/exports/build_block_ip_create_alert.events.json");
const realExport = JSON.parse(fs.readFileSync(FIXTURE, "utf8"));

describe("gradeExport -- real captured build failure", () => {
  const report = gradeExport(realExport);
  const codes = report.redFlags.map((f) => f.code);

  test("verdict is FAIL for the derailed build turn", () => {
    expect(report.intent).toBe("build");
    expect(report.verdict).toBe("FAIL");
  });

  test("flags the triage containment guard firing in intent:build", () => {
    expect(codes).toContain("triage_guard_in_build");
  });

  test("flags build_playbook_from_trace with no trace (empty_trace)", () => {
    expect(codes).toContain("trace_tool_no_trace");
  });

  test("flags a native CRUD op ('create alert') hunted for on connectors", () => {
    expect(codes).toContain("crud_searched_as_connector_op");
  });

  test("flags the mounted module (keys) leaking into the playbook Start step", () => {
    expect(codes).toContain("mount_module_leaked_into_start");
  });

  test("tool stats are extracted from the display transcript", () => {
    expect(report.toolStats.total).toBe(8);
    expect(report.toolStats.byName.find_operation).toBe(4);
    expect(report.hasFinalYaml).toBe(true);
  });
});

describe("gradeExport -- a clean build turn grades PASS", () => {
  // A well-behaved authoring turn: build intent, a real create_record alert
  // step, a proper module, no triage guard, no trace tool.
  const clean = {
    manifest: { intent: "build" },
    currentYaml: [
      "playbooks:",
      "  - name: Block IP and Create Alert",
      "    steps:",
      "      - name: Start",
      "        type: start",
      "        module: workflows",
      "      - name: Create Alert",
      "        type: create_record",
      "        module: alerts",
    ].join("\n"),
    messages: [
      { role: "user", text: "create a playbook to block an ip and create an alert" },
      { role: "assistant", events: [
        { type: "tool_call", name: "list_configured_connectors", inputDisplay: "{}",
          resultDisplay: '{"ok":true,"configured":[{"name":"fortigate"}]}', resultStatus: "ok" },
        { type: "text", text: "Here is a playbook that blocks the IP and creates an alert." },
      ] },
    ],
  };

  test("no red flags, verdict PASS", () => {
    const r = gradeExport(clean);
    expect(r.redFlags).toEqual([]);
    expect(r.verdict).toBe("PASS");
  });

  test("a create_record alert step does NOT trip the CRUD-as-connector flag", () => {
    // The bad signature is find_operation hunting for create_alert, not a
    // legitimate create_record step in the YAML.
    const d = digestExport(clean);
    expect(d.toolCalls.some((t) => t.name === "find_operation")).toBe(false);
  });
});

describe("gradeExport -- robustness", () => {
  test("empty / malformed export does not throw and grades PASS", () => {
    expect(() => gradeExport({})).not.toThrow();
    expect(gradeExport({}).verdict).toBe("PASS");
    expect(gradeExport(null).redFlags).toEqual([]);
  });

  test("triage guard flag only fires in build intent, not triage", () => {
    const triage = {
      manifest: { intent: "triage" },
      messages: [{ role: "assistant", events: [
        { type: "tool_call", name: "find_containment_actions", inputDisplay: '{"target_type":"ip"}',
          resultDisplay: '{"ok":false,"hunt_floor_guard":true}', resultStatus: "error" },
      ] }],
    };
    const codes = gradeExport(triage).redFlags.map((f) => f.code);
    expect(codes).not.toContain("triage_guard_in_build");
  });
});

// ─── New red-flag classes, grounded in the SAME captured failure ─────────────
//
// D2.3: "create an alert" is a platform create_record step on alerts, not a
// connector op. The model instead authored a set_variable that formats a
// message string, and a code-snippet step POSTing to an invented firewall URL.
// Both are in the real fixture, so both are pinned here as regressions.
describe("gradeExport -- hallucinated authoring (D2.3)", () => {
  const report = gradeExport(realExport);
  const codes = report.redFlags.map((f) => f.code);

  test("flags a 'Create Alert' step authored as set_variable, not create_record", () => {
    expect(codes).toContain("native_action_as_wrong_step_type");
  });

  test("flags the invented firewall endpoint in the code-snippet step", () => {
    expect(codes).toContain("hallucinated_http_endpoint");
    const f = report.redFlags.find((x) => x.code === "hallucinated_http_endpoint");
    expect(f.detail).toMatch(/your-firewall-api/);
  });

  test("a legitimate create_record step does NOT trip the wrong-step-type flag", () => {
    const ok = {
      manifest: { intent: "build" },
      currentYaml: "steps:\n      - name: Create Alert\n        type: create_record\n        module: alerts\n",
      messages: [],
    };
    expect(gradeExport(ok).redFlags.map((f) => f.code)).not.toContain("native_action_as_wrong_step_type");
  });

  test("a real connector URL does NOT trip the placeholder-endpoint flag", () => {
    const ok = {
      manifest: { intent: "build" },
      currentYaml: 'script_code: |\n  requests.post("https://fortigate.internal.corp/api/v2/block")\n',
      messages: [],
    };
    expect(gradeExport(ok).redFlags.map((f) => f.code)).not.toContain("hallucinated_http_endpoint");
  });
});

describe("gradeExport -- mount leak is caught on the tool input too", () => {
  test("build_playbook_from_trace called with module:keys flags the leak without any YAML", () => {
    const exp = {
      manifest: { intent: "build" },
      messages: [{ role: "assistant", events: [
        { type: "tool_call", name: "build_playbook_from_trace",
          inputDisplay: '{"name":"Block IP","module":"keys"}',
          resultDisplay: '{"ok":false,"code":"empty_trace"}', resultStatus: "error" },
      ] }],
    };
    const codes = gradeExport(exp).redFlags.map((f) => f.code);
    expect(codes).toContain("mount_module_leaked_into_start");
  });

  test("a workflows module on a build tool is legitimate and does not flag", () => {
    const exp = {
      manifest: { intent: "build" },
      messages: [{ role: "assistant", events: [
        { type: "tool_call", name: "build_playbook_from_trace",
          inputDisplay: '{"name":"Block IP","module":"workflows"}',
          resultDisplay: '{"ok":true}', resultStatus: "ok" },
      ] }],
    };
    expect(gradeExport(exp).redFlags.map((f) => f.code)).not.toContain("mount_module_leaked_into_start");
  });
});

// ─── The live half of the loop ───────────────────────────────────────────────
//
// gradeLive() adapts a matrixDriver capture ({frames, requests}) onto the same
// digest contract as a downloaded export, so ONE set of rules gates both. These
// pin that equivalence -- a rule written for an offline regression must fire on
// the live wire shape too, or the loop leaks.
describe("gradeLive -- live matrix capture grades through the same rules", () => {
  const { gradeLive, digestLive } = require("./live/lib/exportGrader");

  const liveCapture = {
    requests: [{ op: "chat_turn", intent: "build", messages: [{ role: "user", content: "create a playbook to block an ip and create an alert" }] }],
    frames: [
      { type: "tool_use", id: "t1", name: "find_containment_actions", input: { target_type: "ip" } },
      { type: "tool_result", tool_use_id: "t1", tool: "find_containment_actions",
        content: { ok: false, kind: "guard_redirect", hunt_floor_guard: true } },
      { type: "tool_use", id: "t2", name: "build_playbook_from_trace", input: { name: "Block IP", module: "keys" } },
      { type: "tool_result", tool_use_id: "t2", tool: "build_playbook_from_trace",
        content: { ok: false, code: "empty_trace" } },
      { type: "stream_end", stop_reason: "end_turn" },
    ],
  };

  test("digestLive extracts intent from the chat_turn request", () => {
    expect(digestLive(liveCapture.frames, liveCapture.requests).intent).toBe("build");
  });

  test("digestLive pairs tool_use/tool_result into the export digest shape", () => {
    const d = digestLive(liveCapture.frames, liveCapture.requests);
    const guard = d.toolCalls.find((t) => t.name === "find_containment_actions");
    expect(guard.input).toEqual({ target_type: "ip" });
    expect(guard.result.hunt_floor_guard).toBe(true);
  });

  test("a guard_redirect is status 'ok' live, yet STILL red-flags in a build turn", () => {
    // Cross-module invariant. matrixDriver.isErr() deliberately classifies
    // kind:"guard_redirect" as steering, NOT a tool error (AGENT_HARDENING §D),
    // so the live status is "ok" -- whereas the offline export recorded the same
    // call as resultStatus:"error". The red-flag rule must therefore key off the
    // guard PAYLOAD, not the status, or it would fire offline and silently miss
    // live. That asymmetry is the whole reason this test exists.
    const d = digestLive(liveCapture.frames, liveCapture.requests);
    expect(d.toolCalls.find((t) => t.name === "find_containment_actions").status).toBe("ok");
    expect(gradeLive(liveCapture.frames, liveCapture.requests).redFlags.map((f) => f.code))
      .toContain("triage_guard_in_build");
  });

  test("the triage-guard-in-build rule fires on a LIVE capture", () => {
    const codes = gradeLive(liveCapture.frames, liveCapture.requests).redFlags.map((f) => f.code);
    expect(codes).toContain("triage_guard_in_build");
    expect(codes).toContain("trace_tool_no_trace");
    expect(codes).toContain("mount_module_leaked_into_start");
  });

  test("hard red flags make the live verdict FAIL", () => {
    expect(gradeLive(liveCapture.frames, liveCapture.requests).verdict).toBe("FAIL");
  });

  test("a clean live triage turn grades PASS with no flags", () => {
    const clean = {
      requests: [{ op: "chat_turn", intent: "triage", messages: [{ role: "user", content: "triage this" }] }],
      frames: [
        { type: "tool_use", id: "t1", name: "get_record", input: { iri: "/api/3/alerts/x" } },
        { type: "tool_result", tool_use_id: "t1", tool: "get_record", content: { ok: true, record: { id: 1 } } },
        { type: "stream_end", stop_reason: "end_turn" },
      ],
    };
    const r = gradeLive(clean.frames, clean.requests);
    expect(r.redFlags).toEqual([]);
    expect(r.verdict).toBe("PASS");
  });

  test("empty capture does not throw", () => {
    expect(() => gradeLive([], [])).not.toThrow();
    expect(gradeLive(undefined, undefined).redFlags).toEqual([]);
  });
});

// ─── The defect vs the symptom (learned from three live 206 runs) ────────────
//
// D2 = "triage-only tools are reachable in intent:build". The model called
// find_containment_actions on EVERY live run, but the hunt-floor guard tripped
// on only some of them. A rule (and an xfail row) keyed on the GUARD therefore
// reported "clean → promote, the bug looks fixed" while the defect was fully
// present -- a false all-clear, the worst thing a gate can do. So the toolset
// rule must fire on the CALL, independent of the result.
describe("triage_tool_in_build -- grades the defect, not the symptom", () => {
  const { gradeExport, TRIAGE_ONLY_TOOLS } = require("./live/lib/exportGrader");

  const buildTurn = (result) => ({
    manifest: { intent: "build" },
    messages: [{ role: "assistant", events: [
      { type: "tool_call", name: "find_containment_actions", inputDisplay: '{"target_type":"ip"}',
        resultDisplay: JSON.stringify(result), resultStatus: "ok" },
    ] }],
  });

  test("fires when the triage tool SUCCEEDS (no guard) -- the run-3 false all-clear", () => {
    // This exact shape reported XPASS (promote) before the rule existed.
    const codes = gradeExport(buildTurn({ ok: true, actions: [{ name: "block_ip" }] }))
      .redFlags.map((f) => f.code);
    expect(codes).toContain("triage_tool_in_build");
    expect(codes).not.toContain("triage_guard_in_build"); // no guard in this result
  });

  test("also fires when the guard DOES trip -- both codes, same defect", () => {
    const codes = gradeExport(buildTurn({ ok: false, kind: "guard_redirect", hunt_floor_guard: true }))
      .redFlags.map((f) => f.code);
    expect(codes).toContain("triage_tool_in_build");
    expect(codes).toContain("triage_guard_in_build");
  });

  test("hard-fails the turn regardless of which symptom appeared", () => {
    expect(gradeExport(buildTurn({ ok: true, actions: [] })).verdict).toBe("FAIL");
  });

  test("does NOT fire in a triage turn -- these tools are legitimate there", () => {
    const triage = { manifest: { intent: "triage" }, messages: [{ role: "assistant", events: [
      { type: "tool_call", name: "find_containment_actions", inputDisplay: "{}",
        resultDisplay: '{"ok":true}', resultStatus: "ok" },
    ] }] };
    expect(gradeExport(triage).redFlags.map((f) => f.code)).not.toContain("triage_tool_in_build");
  });

  test("a build turn using only build-legal tools is clean", () => {
    const ok = { manifest: { intent: "build" }, messages: [{ role: "assistant", events: [
      { type: "tool_call", name: "list_configured_connectors", inputDisplay: "{}",
        resultDisplay: '{"ok":true,"configured":[]}', resultStatus: "ok" },
    ] }] };
    expect(gradeExport(ok).redFlags).toEqual([]);
  });

  test("every TRIAGE_ONLY_TOOLS entry is detected", () => {
    for (const name of TRIAGE_ONLY_TOOLS) {
      const exp = { manifest: { intent: "build" }, messages: [{ role: "assistant", events: [
        { type: "tool_call", name, inputDisplay: "{}", resultDisplay: '{"ok":true}', resultStatus: "ok" },
      ] }] };
      expect(gradeExport(exp).redFlags.map((f) => f.code)).toContain("triage_tool_in_build");
    }
  });
});

// ─── unrequested_change_offer ────────────────────────────────────────────────
//
// The analyst asked to EXPLAIN and was handed an applyable edit. Graded on the
// wire (chip / deliverable / gate), never on the analyst's words -- reading the
// prompt to decide whether it was a change request works in English and fails
// silently in every other language a SOC runs in.
describe("gradeLive -- unrequested change offer", () => {
  const { gradeLive } = require("./live/lib/exportGrader");

  const explainTurn = (extra = {}) => ({
    requests: [{ intent: "build", ...extra }],
    frames: [
      { type: "text", text: "This playbook converts a duration and creates an alert." },
      ...(extra._frames || []),
    ],
  });

  const codes = (c) => gradeLive(c.frames, c.requests).redFlags.map((f) => f.code);

  test("an offer with no chip and no gate is flagged", () => {
    const c = explainTurn({ _frames: [{ type: "enhancement_offer", offerId: "e1" }] });
    expect(codes(c)).toContain("unrequested_change_offer");
  });

  test("it hard-fails the row -- an unasked-for edit is a wrong deliverable", () => {
    const c = explainTurn({ _frames: [{ type: "enhancement_offer", offerId: "e1" }] });
    expect(gradeLive(c.frames, c.requests).verdict).toBe("FAIL");
  });

  test("a change chip makes the same offer legitimate", () => {
    for (const chip of ["add_step", "add_error_handling", "optimize"]) {
      const c = explainTurn({ quick_action: chip,
        _frames: [{ type: "enhancement_offer", offerId: "e1" }] });
      expect(codes(c)).not.toContain("unrequested_change_offer");
    }
  });

  test("an offer the analyst was ASKED for first is legitimate", () => {
    // The gate fired, they approved, the offer followed -- that IS the affordance.
    const c = explainTurn({ _frames: [
      { type: "approval_request", approval_id: "ap-1", reason: "unrequested_change" },
      { type: "enhancement_offer", offerId: "e1" },
    ] });
    expect(codes(c)).not.toContain("unrequested_change_offer");
  });

  test("explaining WITHOUT proposing an edit is clean", () => {
    expect(codes(explainTurn())).not.toContain("unrequested_change_offer");
  });

  test("a read-only chip that produced no offer is clean", () => {
    const c = explainTurn({ quick_action: "explain" });
    expect(codes(c)).not.toContain("unrequested_change_offer");
  });

  test("an offline export cannot answer this and must stay silent", () => {
    // .events.json carries no request-side chip and no approval frames. Guessing
    // there would flag every legitimate enhancement in the offline corpus.
    const exp = { manifest: { intent: "build" }, messages: [{ role: "assistant",
      events: [{ type: "tool_call", name: "emit_enhancement_offer",
                 inputDisplay: "{}", resultDisplay: '{"ok":true}', resultStatus: "ok" }] }] };
    expect(gradeExport(exp).redFlags.map((f) => f.code))
      .not.toContain("unrequested_change_offer");
  });
});
