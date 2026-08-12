// The fixture audit exists because 39 hand-written fixtures each encode their
// author's belief about the wire, and #91 proved a belief can be wrong in a way
// seven green tests cannot see.
//
// These tests hold the audit itself to the same bar every rule in this repo has
// to meet: each firing case is paired with the case that must SILENCE it. A rule
// that cannot be silenced (flags the real wire shape) is exactly as useless as
// one that cannot fire, and costs more, because someone has to triage it.

const path = require("path");
const fs = require("fs");
const { auditFixture, compareToCapture, signature } = require("./live/lib/fixtureAudit");

const rules = (fixture) => auditFixture(fixture).map((f) => f.rule);

// The cumulative resume, as the live capture shows it: the resume repeats the
// tool_use committed in the first turn.
const CUMULATIVE = {
  scenario: "demo",
  responses: [
    { action: "chat_turn", response: { transcript: [
      { type: "tool_use", id: "tu-1", name: "run_playbook", input: { p: 1 } },
      { type: "approval_request", approval_id: "ap-1", tool_use_id: "tu-1", tool: "run_playbook" },
    ] } },
    { action: "chat_resume", response: { transcript: [
      { type: "tool_use", id: "tu-1", name: "run_playbook", input: { p: 1 } },
      { type: "tool_result", call_id: "tu-1", name: "run_playbook",
        content: { ok: false, code: "awaiting_input", triggered: true, run_pk: "9283" } },
      { type: "text", text: "parked" },
    ] } },
  ],
};

// The same scenario in the shape a fixture author invents: the resume carries
// only what is new. Both are valid frame arrays with identical key sets, which
// is why a generic shape diff cannot tell them apart.
const DELTA = JSON.parse(JSON.stringify(CUMULATIVE));
DELTA.responses[1].response.transcript =
  DELTA.responses[1].response.transcript.filter((f) => f.type !== "tool_use");

// resume-is-cumulative was removed after Phase 2.3 captures (Aug 11) proved the
// connector sends the delta shape, not the cumulative one. The rule was firing
// on the correct wire shape. The #91 widget fix (handling cumulative transcripts)
// is still tested by approval_then_manual_input.json, which is intentionally
// cumulative -- but that is a test of widget robustness, not a wire-shape claim.
describe("resume-is-cumulative (removed -- captures show delta is correct)", () => {
  test("the rule is a no-op (delta is the shape the connector sends)", () => {
    expect(rules(DELTA)).not.toContain("resume-is-cumulative");
    expect(rules(CUMULATIVE)).not.toContain("resume-is-cumulative");
  });
});

describe("first-turn-does-not-open-with-prose (the Phase-2 finding)", () => {
  const opensWithProse = (frames) => ({ responses: [
    { action: "chat_turn", response: { transcript: frames } }] });

  test("fires when narration precedes the call the turn goes on to make", () => {
    expect(rules(opensWithProse([
      { type: "text", text: "Let me run that playbook for you." },
      { type: "tool_use", id: "tu-1", name: "run_playbook", input: {} },
    ]))).toContain("first-turn-does-not-open-with-prose");
  });

  test("is silent on the shape every recording shows -- act first, narrate after", () => {
    expect(rules(opensWithProse([
      { type: "tool_use", id: "tu-1", name: "run_playbook", input: {} },
      { type: "tool_result", call_id: "tu-1", name: "run_playbook", content: { ok: true } },
      { type: "text", text: "Done -- the run finished." },
    ]))).toEqual([]);
  });

  // The silencing case that matters most, because getting it wrong would turn
  // the rule into noise on every conversational fixture: a turn that answers a
  // question and never calls anything DOES open with text on the wire.
  test("is silent on a pure-conversational turn, which really does open with text", () => {
    expect(rules(opensWithProse([
      { type: "text", text: "To triage a phishing report, start by..." },
    ]))).toEqual([]);
  });

  test("is silent when activity leads, which is also a real opening", () => {
    expect(rules(opensWithProse([
      { type: "activity", text: "Searching FortiSIEM" },
      { type: "text", text: "I found three events." },
      { type: "tool_use", id: "tu-1", name: "siem_search", input: {} },
    ]))).toEqual([]);
  });

  // Scoped to the OPENING. Mid-conversation prose before a call is ordinary and
  // appears on the wire; flagging it would make the rule unsilenceable.
  test("does not reach past the first chat_turn", () => {
    expect(rules({ responses: [
      { action: "chat_turn", response: { transcript: [
        { type: "tool_use", id: "tu-1", name: "get_record", input: {} }] } },
      { action: "chat_turn", response: { transcript: [
        { type: "text", text: "Now I will contain it." },
        { type: "tool_use", id: "tu-2", name: "block_ip", input: {} }] } },
    ] })).toEqual([]);
  });

  test("counts the leading frames, so the edit is mechanical", () => {
    const f = auditFixture(opensWithProse([
      { type: "text", text: "one" },
      { type: "text", text: "two" },
      { type: "approval_request", approval_id: "ap-1", tool: "run_playbook" },
    ])).find((x) => x.rule === "first-turn-does-not-open-with-prose");
    expect(f.detail).toMatch(/2 text frame\(s\)/);
    expect(f.detail).toMatch(/approval_request/);
  });
});

describe("no-orphan-tool-results", () => {
  test("fires on a result whose id was never committed anywhere", () => {
    const bad = { responses: [
      { action: "chat_turn", response: { transcript: [
        { type: "tool_use", id: "tu-1", name: "a" },
        { type: "tool_result", tool_use_id: "tu-ghost", name: "a" },
      ] } },
    ] };
    expect(rules(bad)).toContain("no-orphan-tool-results");
  });

  test("an approval_request commits its id under tool_use_id, not id", () => {
    // The shape every approval fixture uses. Reading only `id` would report all
    // six of them as orphaned results -- a rule nobody would keep.
    const ok = { responses: [
      { action: "chat_turn", response: { transcript: [
        { type: "approval_request", approval_id: "ap-1", tool_use_id: "tu-1", tool: "block" },
      ] } },
      { action: "chat_resume", response: { transcript: [
        { type: "tool_result", call_id: "tu-1", name: "block", result: { ok: true } },
      ] } },
    ] };
    expect(rules(ok)).toEqual([]);
  });

  test("an all-positional transcript is a convention, not a defect", () => {
    const positional = { responses: [
      { action: "chat_turn", response: { transcript: [
        { type: "tool_use", name: "find_connector" },
        { type: "tool_result", tool: "find_connector" },
      ] } },
    ] };
    expect(rules(positional)).toEqual([]);
  });

  test("...but a MIXED transcript is unpairable and does fire", () => {
    const mixed = { responses: [
      { action: "chat_turn", response: { transcript: [
        { type: "tool_use", id: "tu-1", name: "a" },
        { type: "tool_result", tool_use_id: "tu-1", name: "a" },
        { type: "tool_result", tool: "b" },
      ] } },
    ] };
    expect(rules(mixed)).toContain("no-orphan-tool-results");
  });

  test("a manual-input resume answers a server-created call and is exempt", () => {
    const live = { responses: [
      { action: "respond_manual_input", response: { transcript: [
        { type: "tool_result", call_id: "tu-never-announced", name: "resume_playbook" },
      ] } },
    ] };
    expect(rules(live)).toEqual([]);
  });
});

describe("parked-run-carries-its-identity (the double-duty ok:false)", () => {
  test("fires when a parked run has no run_pk to resume", () => {
    const bad = { responses: [
      { action: "chat_turn", response: { transcript: [
        { type: "tool_use", id: "t", name: "run_playbook" },
        { type: "tool_result", tool_use_id: "t",
          content: { ok: false, triggered: true, code: "awaiting_input" } },
      ] } },
    ] };
    expect(rules(bad)).toContain("parked-run-carries-its-identity");
  });

  test("fires when a run awaits input without ever having started", () => {
    const bad = { responses: [
      { action: "chat_turn", response: { transcript: [
        { type: "tool_use", id: "t", name: "run_playbook" },
        { type: "tool_result", tool_use_id: "t",
          content: { ok: false, triggered: false, code: "awaiting_input", run_pk: "1" } },
      ] } },
    ] };
    expect(rules(bad)).toContain("parked-run-carries-its-identity");
  });

  test("reads the payload under `result` as well as `content`", () => {
    // Both keys are in use on the wire. A checker that knows one passes
    // silently on every frame using the other -- green about nothing.
    const bad = { responses: [
      { action: "chat_turn", response: { transcript: [
        { type: "tool_use", id: "t", name: "run_playbook" },
        { type: "tool_result", tool_use_id: "t",
          result: { ok: false, triggered: true, code: "awaiting_input" } },
      ] } },
    ] };
    expect(rules(bad)).toContain("parked-run-carries-its-identity");
  });

  test("a properly parked run is silent", () => {
    expect(rules(CUMULATIVE)).toEqual([]);
  });

  test("an ordinary failure (never triggered) is not a parked run", () => {
    const failed = { responses: [
      { action: "chat_turn", response: { transcript: [
        { type: "tool_use", id: "t", name: "run_playbook" },
        { type: "tool_result", tool_use_id: "t",
          content: { ok: false, triggered: false, code: "not_found" } },
      ] } },
    ] };
    expect(rules(failed)).toEqual([]);
  });
});

describe("tool-use-ids-are-stable", () => {
  test("fires when the same id means a different call in a later turn", () => {
    const drift = JSON.parse(JSON.stringify(CUMULATIVE));
    drift.responses[1].response.transcript[0].input = { p: 2 };
    expect(rules(drift)).toContain("tool-use-ids-are-stable");
  });
});

describe("compareToCapture", () => {
  const capture = [
    { op: "chat_turn", response: { data: { transcript: [
      { type: "tool_use" }, { type: "approval_request" }] } } },
    { op: "chat_resume", response: { data: { transcript: [
      { type: "tool_use" }, { type: "tool_result" }, { type: "text" }] } } },
  ];

  test("a fixture matching the capture's shape reports no findings", () => {
    const r = compareToCapture(CUMULATIVE, capture);
    expect(r.verified).toBe(true);
    expect(r.findings).toEqual([]);
  });

  test("the delta fixture diverges from the captured frame sequence", () => {
    const r = compareToCapture(DELTA, capture);
    expect(r.verified).toBe(true);
    expect(r.findings.map((f) => f.rule)).toContain("capture-frame-sequence");
  });

  test("NO capture is reported as unverified, never as a pass", () => {
    // The whole point. `findings: []` with `verified: false` must never be
    // read by a caller as "this fixture checks out".
    const r = compareToCapture(CUMULATIVE, null);
    expect(r).toMatchObject({ verified: false, findings: [] });
    expect(r.reason).toMatch(/no capture/i);
  });

  test("signature reads a capture through response.data and a fixture directly", () => {
    expect(signature(capture).map((s) => s.op)).toEqual(["chat_turn", "chat_resume"]);
    expect(signature(CUMULATIVE).map((s) => s.op)).toEqual(["chat_turn", "chat_resume"]);
  });
});

// ── Declared divergence ────────────────────────────────────────────────────
//
// Three fixtures legitimately disagree with their recording (an approval left
// undecided when it was recorded; a deliberately cumulative resume that tests
// the #91 widget fix; a 503 a healthy box will not produce). Those reasons used
// to live in a tracker comment, which no gate reads -- so the audit could never
// be run --strict, and "6 known findings" was a number a person had to carry.
//
// The declaration moves the reason into the fixture. The tests below are the
// price of that: a suppression mechanism has to be shown FIRING as readily as
// silencing, or it is just a way to turn the audit off one line at a time.
describe("capture_divergence declarations", () => {
  const capture = [
    { op: "chat_turn", response: { data: { transcript: [
      { type: "tool_use" }, { type: "approval_request" }] } } },
    { op: "chat_resume", response: { data: { transcript: [
      { type: "tool_use" }, { type: "tool_result" }, { type: "text" }] } } },
  ];
  // The finding DELTA earns against that capture, verbatim.
  const REAL = compareToCapture(DELTA, capture).findings[0];
  const declare = (...d) => ({ ...DELTA, capture_divergence: d });

  test("the finding it names is silenced and reported as declared", () => {
    const r = compareToCapture(declare({ ...REAL, why: "by design" }), capture);
    expect(r.findings).toEqual([]);
    expect(r.declared).toHaveLength(1);
    expect(r.declared[0].why).toBe("by design");
  });

  test("a declared fixture is NOT counted as capture-verified", () => {
    // The capture backs it everywhere except where the fixture says it does
    // not. Folding that into `verified` would inflate the one number this
    // audit exists to keep honest.
    expect(compareToCapture(declare({ ...REAL, why: "by design" }), capture).verified)
      .toBe(false);
  });

  test("a declaration matching nothing is itself a finding", () => {
    // An unused waiver is a dead gate wearing the costume of a live one: it
    // reads as "known and explained" while explaining something that no longer
    // happens.
    const r = compareToCapture(
      declare({ rule: "capture-op-sequence", detail: "something that never fires", why: "x" }),
      capture);
    expect(r.findings.map((f) => f.rule)).toContain("stale-capture-divergence");
  });

  test("declaring against a fixture with no capture is stale, not silent", () => {
    const r = compareToCapture(declare({ ...REAL, why: "x" }), null);
    expect(r.findings.map((f) => f.rule)).toEqual(["stale-capture-divergence"]);
  });

  test("the match is on the EXACT detail, so a moved sequence fires again", () => {
    // The detail string contains both sequences. This is what stops the
    // declaration from covering the NEXT, different mismatch -- the failure
    // mode every per-file suppression list has.
    const drifted = JSON.parse(JSON.stringify(DELTA));
    drifted.responses[1].response.transcript.push({ type: "manual_input", input_id: "m1" });
    drifted.capture_divergence = [{ ...REAL, why: "by design" }];
    const r = compareToCapture(drifted, capture);
    expect(r.findings.map((f) => f.rule).sort())
      .toEqual(["capture-frame-sequence", "stale-capture-divergence"]);
  });

  test("one declaration silences one finding, not every finding like it", () => {
    // Two turns diverging the same way must need two declarations; otherwise a
    // single line disables a whole rule for the fixture.
    const twoBad = JSON.parse(JSON.stringify(DELTA));
    twoBad.responses[0].response.transcript.push({ type: "text" });
    const both = compareToCapture(twoBad, capture).findings;
    expect(both).toHaveLength(2);
    const r = compareToCapture(
      { ...twoBad, capture_divergence: [{ ...both[0], why: "one only" }] }, capture);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].detail).toBe(both[1].detail);
  });
});

describe("the real fixtures", () => {
  const DIR = path.join(__dirname, "..", "..", "widgets-src", "fortiaiAgenticAssistant",
    "widget", "widgetAssets", "fixtures");
  const files = fs.existsSync(DIR)
    ? fs.readdirSync(DIR).filter((f) => f.endsWith(".json")) : [];

  test("the audit has a subject -- an empty run is not a pass", () => {
    expect(files.length).toBeGreaterThan(30);
  });

  test("every fixture parses and the audit survives all of them", () => {
    for (const f of files) {
      const fixture = JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8"));
      expect(() => auditFixture(fixture)).not.toThrow();
    }
  });

  // resume-is-cumulative was removed -- captures show the connector sends delta.
  // No fixture should be flagged for the delta shape.
  // THE GATE. The audit ran advisory while the backlog was worked off; the
  // backlog is off (45 findings -> 0, with the three real divergences declared
  // in the fixtures that own them), so it becomes fatal here rather than
  // waiting for someone to remember to add --strict to CI. `npm test` now goes
  // red on a fixture that drifts from the wire.
  //
  // Run through the CLI on purpose: a test that re-implements the walk would
  // pass while `npm run fixtures:audit -- --strict` was broken, which is the
  // same class of gap as a gate that selects zero files.
  const audit = (dir) => {
    const { spawnSync } = require("child_process");
    const r = spawnSync(process.execPath,
      [path.join(__dirname, "..", "scripts", "fixtures-audit.js"), "--strict",
        "--json", "--fixtures", dir],
      { encoding: "utf8" });
    return { code: r.status, report: JSON.parse(r.stdout) };
  };

  test("the shipped fixtures pass --strict", () => {
    const { code, report } = audit(DIR);
    expect(report.findings.map((f) => `${f.fixture}: [${f.rule}] ${f.detail}`)).toEqual([]);
    expect(code).toBe(0);
  });

  test("...and --strict goes red on a drifted fixture (the mutation proof)", () => {
    // A gate nobody has broken on purpose is a gate nobody knows works. Take a
    // fixture whose capture currently backs it and change the shape the wire
    // actually sends.
    const tmp = fs.mkdtempSync(path.join(require("os").tmpdir(), "fixaudit-"));
    const name = "approval_run_playbook_new.json";
    const f = JSON.parse(fs.readFileSync(path.join(DIR, name), "utf8"));
    const turn = f.responses.find((r) => r.action === "chat_turn");
    turn.response.transcript.unshift({ type: "text", text: "Let me look into that." });
    fs.writeFileSync(path.join(tmp, name), JSON.stringify(f));
    const { code, report } = audit(tmp);
    expect(code).toBe(1);
    expect(report.findings.map((x) => x.rule))
      .toEqual(expect.arrayContaining(["first-turn-does-not-open-with-prose"]));
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test("no fixture is flagged for the delta-on-resume shape", () => {
    const offenders = files.filter((f) => {
      const fixture = JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8"));
      return auditFixture(fixture).some((x) => x.rule === "resume-is-cumulative");
    }).sort();
    expect(offenders).toEqual([]);
  });
});

// ── A live chat_turn streams its frames through chat_poll ──────────────────
//
// The turn's own response is just {accepted:true, turn_id}: the transcript
// arrives in the polls that follow. Reading only the turn body reported every
// captured turn as zero-frame, which would have fired an identical bogus
// finding against all 38 fixtures the moment Phase 2.3 recorded them -- an
// audit that is wrong the same way every time is one nobody reads.
describe("signature folds chat_poll frames into the turn that streamed them", () => {
  const poll = (frames, done = false) => ({
    op: "chat_poll", params: null, response: { data: { frames, done } },
  });
  const liveCapture = [
    { op: "chat_turn", params: null,
      response: { data: { ok: true, accepted: true, turn_id: "t1", stop_reason: "accepted" } } },
    poll([{ type: "turn_start" }]),
    poll([{ type: "tool_use", id: "a" }]),
    poll([{ type: "tool_result", tool_use_id: "a" }, { type: "usage" }]),
    poll([{ type: "approval_request", approval_id: "ap1" }, { type: "usage" }]),
    poll([{ type: "stream_end" }], true),
  ];

  test("an accepted turn is credited with the frames its polls carried", () => {
    expect(signature(liveCapture)).toEqual([
      { op: "chat_turn", frames: ["tool_use", "tool_result", "approval_request"] },
    ]);
  });

  test("transport frames are not transcript content", () => {
    const frames = signature(liveCapture)[0].frames;
    ["turn_start", "stream_end", "usage", "heartbeat"].forEach((t) => {
      expect(frames).not.toContain(t);
    });
  });

  test("without folding the turn looks empty -- the bug this replaced", () => {
    // Same capture, polls dropped: exactly what the old signature() saw.
    const turnOnly = liveCapture.filter((p) => p.op !== "chat_poll");
    expect(signature(turnOnly)).toEqual([{ op: "chat_turn", frames: [] }]);
  });

  test("polls are folded into the MOST RECENT turn, not the first", () => {
    const twoTurns = [
      ...liveCapture,
      { op: "chat_resume", params: null, response: { data: { transcript: [] } } },
      poll([{ type: "text" }]),
      poll([{ type: "manual_input", input_id: "m1" }], true),
    ];
    expect(signature(twoTurns)).toEqual([
      { op: "chat_turn", frames: ["tool_use", "tool_result", "approval_request"] },
      { op: "chat_resume", frames: ["text", "manual_input"] },
    ]);
  });

  test("a poll before any turn belongs to no turn and is dropped", () => {
    expect(signature([poll([{ type: "text" }]), ...liveCapture])).toHaveLength(1);
  });

  test("a chat_resume that answers synchronously keeps its own transcript", () => {
    const sync = [{ op: "chat_resume", params: null,
      response: { data: { transcript: [{ type: "tool_result" }, { type: "manual_input" }] } } }];
    expect(signature(sync)).toEqual([
      { op: "chat_resume", frames: ["tool_result", "manual_input"] },
    ]);
  });
});

// ── Noise that would make every recorded fixture diverge ───────────────────
describe("signature drops what a fixture could never model", () => {
  const sync = (op, frames) => [{ op, params: null,
    response: { data: { transcript: frames.map((t) => ({ type: t })) } } }];

  test("transport frames are dropped from a SYNCHRONOUS transcript too", () => {
    // respond_manual_input answers inline and carries `usage` in its own
    // transcript -- filtering only the poll branch let it leak and reported
    // [text,usage,text] against a fixture's [text].
    expect(signature(sync("respond_manual_input", ["text", "usage", "text"])))
      .toEqual([{ op: "respond_manual_input", frames: ["text"] }]);
  });

  test("a run of consecutive text frames collapses to one", () => {
    // A live answer streamed as 130 text frames; the fixture models one. Chunk
    // count is run-dependent, so comparing it raw diverges on nothing.
    const many = new Array(130).fill("text");
    expect(signature(sync("chat_turn", ["tool_use", ...many]))[0].frames)
      .toEqual(["tool_use", "text"]);
  });

  test("collapsing is text-only -- two tool_use frames are two calls", () => {
    expect(signature(sync("chat_turn", ["tool_use", "tool_use", "tool_result"]))[0].frames)
      .toEqual(["tool_use", "tool_use", "tool_result"]);
  });

  test("text runs separated by another frame stay separate", () => {
    expect(signature(sync("chat_turn", ["text", "tool_use", "text"]))[0].frames)
      .toEqual(["text", "tool_use", "text"]);
  });

  test("the fixture side collapses identically, or every comparison is skewed", () => {
    const fixture = { responses: [{ action: "chat_turn",
      response: { transcript: [{ type: "text" }, { type: "text" }] } }] };
    expect(signature(fixture)).toEqual([{ op: "chat_turn", frames: ["text"] }]);
  });
});
