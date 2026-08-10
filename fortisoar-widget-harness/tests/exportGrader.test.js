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

// ─── The degradation oracle (plan Phase 3) ───────────────────────────────────
//
// Graceful degradation is an ANTI-ORACLE: the better the fallback, the more
// invisible this defect class becomes. Every rule below turns a soft failure
// (a plausible sentence) into a hard one (a red flag). Each is paired with the
// FIXED shape, so the test fails if a rule fires on a working turn -- a rule
// that cannot be silenced is as useless as one that cannot fire.
describe("gradeLive -- parked_run_narrated_not_carded", () => {
  const { gradeLive } = require("./live/lib/exportGrader");
  const codes = (frames, requests = [{ intent: "triage" }]) =>
    gradeLive(frames, requests).redFlags.map((f) => f.code);

  // Shape taken from the live approval→manual-input capture: run_playbook
  // returns a parked run, and the gate is owed to the analyst as a card.
  const parkedResult = {
    type: "tool_result", tool_use_id: "t1",
    content: JSON.stringify({ ok: true, status: "awaiting_manual_input", run_pk: "9308" }),
  };
  const parkedCall = { type: "tool_use", id: "t1", name: "run_playbook", input: { playbook: "Collect Note" } };
  const askProse = { type: "text", text: "The run is waiting. Tell me the note and I'll continue." };

  test("a parked run + an ask in prose + no card is flagged", () => {
    expect(codes([parkedCall, parkedResult, askProse]))
      .toContain("parked_run_narrated_not_carded");
  });

  test("the same turn WITH the manual_input card is clean -- this is the fix", () => {
    expect(codes([parkedCall, parkedResult, askProse,
      { type: "manual_input", card_id: "mi-1" }]))
      .not.toContain("parked_run_narrated_not_carded");
  });

  test("a finished run described in prose is not a park", () => {
    expect(codes([parkedCall,
      { type: "tool_result", tool_use_id: "t1", content: JSON.stringify({ ok: true, status: "finished" }) },
      askProse])).not.toContain("parked_run_narrated_not_carded");
  });

  test("an offline export cannot see card frames and must stay silent", () => {
    const exp = { manifest: { intent: "triage" }, messages: [{ role: "assistant", events: [
      { type: "tool_call", name: "run_playbook", inputDisplay: "{}",
        resultDisplay: JSON.stringify({ status: "awaiting_manual_input" }), resultStatus: "ok" },
      { type: "text", text: "Tell me the note and I'll continue." }] }] };
    expect(gradeExport(exp).redFlags.map((f) => f.code))
      .not.toContain("parked_run_narrated_not_carded");
  });
});

describe("gradeLive -- agent_asks_for_data_it_holds", () => {
  const { gradeLive } = require("./live/lib/exportGrader");
  const RUN_PK = "3f43a6bca48e489da25e011a9891f98f";   // shape of a real run pk
  const strand = (history) => ({
    requests: [{ intent: "triage", messages: history }],
    frames: [{ type: "text",
      text: `Happy to resume it -- what is the run id for that execution?` }],
  });
  const codes = (c) => gradeLive(c.frames, c.requests).redFlags.map((f) => f.code);

  test("asking for a run id the session history already carries is flagged", () => {
    // THE session-scoping property. This turn ran ZERO tools -- a rule scoped to
    // the turn's own tool_results could never have fired, which is exactly how
    // the strand shipped.
    const c = strand([
      { role: "user", content: "Run the Collect Note playbook." },
      { role: "assistant", content: `Started run ${RUN_PK}, awaiting your note.` },
      { role: "user", content: "resume it" },
    ]);
    expect(gradeLive(c.frames, c.requests).toolStats.total).toBe(0);
    expect(codes(c)).toContain("agent_asks_for_data_it_holds");
  });

  test("asking for an id the session genuinely never had is legitimate", () => {
    expect(codes(strand([{ role: "user", content: "resume my earlier run" }])))
      .not.toContain("agent_asks_for_data_it_holds");
  });

  test("a turn that just answers is clean", () => {
    const c = { requests: [{ intent: "triage", messages: [
      { role: "assistant", content: `run ${RUN_PK}` }] }],
      frames: [{ type: "text", text: "The run finished successfully." }] };
    expect(codes(c)).not.toContain("agent_asks_for_data_it_holds");
  });

  test("no captured history -> silent rather than guessing", () => {
    const c = { requests: [], frames: [{ type: "text", text: "What is the run id?" }] };
    expect(codes(c)).not.toContain("agent_asks_for_data_it_holds");
  });
});

describe("gradeLive -- action_narrated_not_taken", () => {
  const { gradeLive } = require("./live/lib/exportGrader");
  const codes = (frames) => gradeLive(frames, [{ intent: "triage" }]).redFlags.map((f) => f.code);

  test("claiming containment with no dispatch call is P2 gating theatre", () => {
    expect(codes([{ type: "text", text: "I have blocked 203.0.113.10 at the perimeter." }]))
      .toContain("action_narrated_not_taken");
  });

  test("the same claim WITH the dispatch call is the product working", () => {
    expect(codes([
      { type: "tool_use", id: "a1", name: "run_op", input: { operation: "block_ip_new" } },
      { type: "tool_result", tool_use_id: "a1", content: '{"status":"Success"}' },
      { type: "text", text: "I have blocked 203.0.113.10 at the perimeter." },
    ])).not.toContain("action_narrated_not_taken");
  });

  test("a gate that was SHOWN is not a claim -- the analyst is being asked", () => {
    expect(codes([
      { type: "approval_request", approval_id: "ap-1" },
      { type: "text", text: "I'll block 203.0.113.10 once you approve." },
    ])).not.toContain("action_narrated_not_taken");
  });

  test("proposing an action as a question does not fire", () => {
    expect(codes([{ type: "text", text: "Should I block 203.0.113.10 at the perimeter?" }]))
      .not.toContain("action_narrated_not_taken");
  });
});

describe("gradeLive -- card_type_expected_but_prose", () => {
  const { gradeLive } = require("./live/lib/exportGrader");
  const codes = (frames, scenario) =>
    gradeLive(frames, [{ intent: "triage" }], scenario).redFlags.map((f) => f.code);

  test("the expected card is missing and the prose describes it", () => {
    expect(codes([{ type: "text", text: "I can create a playbook that does this for you." }],
      { expectedCards: ["playbook_offer"] })).toContain("card_type_expected_but_prose");
  });

  test("the card actually arriving is clean", () => {
    expect(codes([
      { type: "playbook_offer", offerId: "p1" },
      { type: "text", text: "I can create a playbook that does this for you." },
    ], { expectedCards: ["playbook_offer"] })).not.toContain("card_type_expected_but_prose");
  });

  test("a missing card the prose never describes does not fire -- that is a\n"
    + "    coverage question for the frame metrics, not a degradation", () => {
    expect(codes([{ type: "text", text: "The alert looks benign." }],
      { expectedCards: ["playbook_offer"] })).not.toContain("card_type_expected_but_prose");
  });

  test("a row that expects nothing cannot fire this rule", () => {
    expect(codes([{ type: "text", text: "I can create a playbook that does this." }], {}))
      .not.toContain("card_type_expected_but_prose");
  });
});

// The degradation rules run against a REAL live capture, not just synthetic
// frames. This is the approval→manual-input arc AFTER its fix (connector
// 0.5.101+): a parked run that DID get carded. None of the four rules may fire
// on it -- a rule that flags working live prose is worse than no rule, because
// the matrix learns to ignore it.
describe("degradation rules -- no false positives on the fixed live arc", () => {
  const { gradeLive } = require("./live/lib/exportGrader");
  const CAPTURE = path.join(__dirname, "..", "test-results", "live",
    "approvalToManualInput.payloads.json");
  const maybe = fs.existsSync(CAPTURE) ? test : test.skip;   // gitignored artifact

  maybe("grades clean", () => {
    const payloads = JSON.parse(fs.readFileSync(CAPTURE, "utf8"));
    const frames = [];
    const requests = [];
    payloads.forEach((e) => {
      if (e.op === "chat_turn" || e.op === "chat_resume") requests.push({ ...e.params });
      if (e.op === "chat_poll") ((e.response.data || {}).frames || []).forEach((f) => frames.push(f));
    });
    const report = gradeLive(frames, requests);
    expect(report.redFlags.map((f) => f.code)).toEqual([]);
  });
});
