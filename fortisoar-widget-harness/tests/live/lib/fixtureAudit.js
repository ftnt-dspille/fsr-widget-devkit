// Structural audit of the hand-written widget fixtures.
//
// WHY. There are 39 fixtures under widget/widgetAssets/fixtures/, every one
// hand-authored, which means each encodes its author's BELIEF about what the
// connector sends. #91 was seven green hermetic tests against a bug that
// reproduced on a real box every single time -- because the fixture tested the
// connector I imagined, not the one that exists.
//
// A generic shape diff does not close that. The #91 defect is invisible to one:
// a delta-on-resume transcript and a cumulative one are both valid frame arrays
// with identical key sets. So the load-bearing property is named explicitly
// (`resume-is-cumulative`) alongside the generic ones, and the generic checks
// are the cheap extras -- not the point.
//
// Everything here is INTRINSIC: it reads a fixture alone and needs no live
// capture. Comparing a fixture against recorded wire traffic is the other half
// (see compareToCapture); a fixture with no capture is reported UNVERIFIED
// rather than passing quietly.

// Frames that carry a committed tool call. The connector has emitted both
// `tool_use_id` and `call_id` for the same thing, so a checker that knows only
// one silently sees zero results and passes.
const resultId = (f) => f.tool_use_id || f.call_id || f.id || null;

const TURN_OPS = new Set(["chat_turn", "chat_resume", "respond_manual_input"]);

// Streaming mechanics, not transcript content. These appear only in a live
// capture's chat_poll frames (a hand-written fixture never models them), so
// counting them would make every recorded turn diverge from every fixture on
// pure transport noise.
const TRANSPORT_FRAMES = new Set(["turn_start", "stream_end", "usage", "heartbeat"]);

// Frames that COMMIT an id a later tool_result can attach to. `tool_use` is the
// obvious one; an `approval_request` / `manual_input` card carries the id of the
// very call it is gating, and the result comes back against that same id. A
// checker that knows only tool_use reports every approval fixture as broken.
// The id lives under a DIFFERENT key per frame type -- a tool_use calls it
// `id`, an approval_request calls it `tool_use_id` and also carries its own
// `approval_id`. Reading only `id` finds nothing on a card and reports every
// approval fixture as an orphaned result.
const CALL_FRAME_TYPES = new Set([
  "tool_use", "approval_request", "manual_input", "action_card"]);
const committedId = (f) => (
  f.type === "tool_use"
    ? f.id
    : (f.tool_use_id || f.preceding_tool_use_id || f.call_id || f.id)) || null;
const commitsAnId = (f) => CALL_FRAME_TYPES.has(f.type) && !!committedId(f);

function transcriptsOf(fixture) {
  return (fixture.responses || [])
    .map((r, i) => ({
      i,
      action: r.action,
      frames: ((r.response || {}).transcript) || [],
      stopReason: (r.response || {}).stop_reason || null,
    }))
    .filter((t) => TURN_OPS.has(t.action));
}

// --- the rules ------------------------------------------------------------
// Each takes the parsed fixture and returns findings [{rule, detail}].

// THE #91 PROPERTY. On resume the connector re-sends the whole conversation,
// including tool_use ids committed in EARLIER turns. A fixture that carries
// only the new frames teaches the widget a wire shape the box never sends, and
// every test built on it is green about nothing.
function resumeIsCumulative(fixture) {
  const out = [];
  const turns = transcriptsOf(fixture);
  const committed = new Set();
  for (const t of turns) {
    if (t.action === "chat_resume" && committed.size) {
      const present = new Set(
        t.frames.filter((f) => f.type === "tool_use").map((f) => f.id));
      const missing = [...committed].filter((id) => !present.has(id));
      if (missing.length === committed.size) {
        out.push({
          rule: "resume-is-cumulative",
          detail: `responses[${t.i}] chat_resume carries NONE of the `
            + `${committed.size} tool_use id(s) committed earlier `
            + `(${[...committed].join(", ")}). That is the delta shape; the `
            + `connector sends the cumulative one.`,
        });
      } else if (missing.length) {
        out.push({
          rule: "resume-is-cumulative",
          detail: `responses[${t.i}] chat_resume drops previously committed `
            + `tool_use id(s): ${missing.join(", ")}`,
        });
      }
    }
    t.frames.filter((f) => f.type === "tool_use" && f.id)
      .forEach((f) => committed.add(f.id));
  }
  return out;
}

// A tool_result with no tool_use to attach to. The widget renders it against
// nothing, which looks like a dropped call rather than a malformed fixture.
// Resolution is CROSS-RESPONSE, deliberately. A resume may carry the result of
// a call committed in an earlier turn without repeating the tool_use frame --
// the live-captured fixture does exactly that -- so a per-response check calls
// the real wire shape a violation. Whether a resume SHOULD repeat those frames
// is the cumulative rule's business, and saying it twice would just mean fixing
// one fixture reports two different defects.
// A manual-input resume answers with the result of a call the SERVER created:
// the live capture shows `respond_manual_input` returning a tool_result for a
// resume_playbook id that was never announced in any transcript. Flagging that
// would report the real wire as broken. (One live witness -- if a capture ever
// shows the tool_use, drop this exemption.)
const SERVER_SYNTHESIZED_CALLS = new Set(["respond_manual_input"]);

function noOrphanToolResults(fixture) {
  const out = [];
  const known = new Set();
  for (const t of transcriptsOf(fixture)) {
    if (SERVER_SYNTHESIZED_CALLS.has(t.action)) continue;
    const idBearing = t.frames.some(commitsAnId);
    t.frames.filter(commitsAnId).forEach((f) => known.add(committedId(f)));
    t.frames.filter((f) => f.type === "tool_result").forEach((f) => {
      const id = resultId(f);
      if (!id) {
        // Some fixtures pair calls positionally, with no ids anywhere in the
        // transcript. That is a convention, not a defect, and calling it one
        // would be a claim about the wire this file cannot back without a
        // capture. Only a MIXED transcript -- ids on some frames, not others --
        // is genuinely unpairable.
        if (idBearing) {
          out.push({ rule: "no-orphan-tool-results",
            detail: `responses[${t.i}] has an id-less tool_result `
              + `(name: ${f.name || f.tool || "?"}) in a transcript whose other `
              + "frames DO carry ids -- nothing can pair this one" });
        }
      } else if (!known.has(id)) {
        out.push({ rule: "no-orphan-tool-results",
          detail: `responses[${t.i}] tool_result ${id} has no matching tool_use `
            + "in this or any earlier response" });
      }
    });
  }
  return out;
}

// Order: a result may not precede its own call. Same cross-response resolution
// as above -- earlier turns count as "already called".
function toolUseBeforeItsResult(fixture) {
  const out = [];
  const seen = new Set();
  for (const t of transcriptsOf(fixture)) {
    if (SERVER_SYNTHESIZED_CALLS.has(t.action)) continue;
    t.frames.forEach((f, j) => {
      if (commitsAnId(f)) seen.add(committedId(f));
      if (f.type === "tool_result") {
        const id = resultId(f);
        if (id && !seen.has(id)) {
          out.push({ rule: "tool-use-before-its-result",
            detail: `responses[${t.i}] frame ${j}: tool_result ${id} appears `
              + "before its tool_use" });
        }
      }
    });
  }
  return out;
}

// THE DOUBLE-DUTY ok:false. A run that PARKED reports ok:false with
// triggered:true and a run_pk -- it happened, and it is waiting. A fixture that
// drops run_pk teaches "ok:false means it never ran", which is the sentence the
// approval card wrongly showed an analyst whose run was live on the box.
function parkedRunCarriesItsIdentity(fixture) {
  const out = [];
  for (const t of transcriptsOf(fixture)) {
    t.frames.filter((f) => f.type === "tool_result").forEach((f) => {
      // The payload is `content` on some frames and `result` on others; a
      // checker that knows one key passes silently on every frame using the
      // other.
      const c = f.content || f.result;
      if (!c || typeof c !== "object") return;
      const parked = c.triggered === true && c.ok === false;
      const awaiting = typeof c.code === "string" && /await/i.test(c.code);
      if ((parked || awaiting) && !c.run_pk) {
        out.push({ rule: "parked-run-carries-its-identity",
          detail: `responses[${t.i}] ${resultId(f) || "?"}: a parked run `
            + `(ok:${c.ok}, triggered:${c.triggered}, code:${c.code}) with no `
            + "run_pk -- nothing downstream can resume it" });
      }
      if (awaiting && c.triggered !== true) {
        out.push({ rule: "parked-run-carries-its-identity",
          detail: `responses[${t.i}] ${resultId(f) || "?"}: code ${c.code} but `
            + `triggered:${c.triggered} -- a run cannot await input without `
            + "having started" });
      }
    });
  }
  return out;
}

// The same id must mean the same call everywhere it appears.
function toolUseIdsAreStable(fixture) {
  const out = [];
  const seen = new Map();
  for (const t of transcriptsOf(fixture)) {
    t.frames.filter((f) => f.type === "tool_use" && f.id).forEach((f) => {
      const prev = seen.get(f.id);
      const sig = `${f.name}|${JSON.stringify(f.input || null)}`;
      if (prev && prev !== sig) {
        out.push({ rule: "tool-use-ids-are-stable",
          detail: `responses[${t.i}]: tool_use ${f.id} changes identity `
            + `between turns (${prev} -> ${sig})` });
      }
      seen.set(f.id, sig);
    });
  }
  return out;
}

const RULES = [
  resumeIsCumulative,
  noOrphanToolResults,
  toolUseBeforeItsResult,
  parkedRunCarriesItsIdentity,
  toolUseIdsAreStable,
];

function auditFixture(fixture) {
  return RULES.flatMap((r) => r(fixture));
}

// --- the capture half -----------------------------------------------------

// A live turn streams its prose as MANY incremental `text` frames -- one real
// answer arrived as 130 of them -- while a fixture models the same answer as a
// single `text`. Comparing those raw would make every recorded turn diverge on
// nothing but chunk count, which is run-dependent by nature. Collapse runs of
// consecutive `text` into one; every other frame type keeps its multiplicity,
// because two tool_use frames really are two calls.
function collapseText(types) {
  const out = [];
  for (const t of types) {
    if (t === "text" && out[out.length - 1] === "text") continue;
    out.push(t);
  }
  return out;
}

// A structural signature: op order + frame-type sequence + which frames carry a
// card. Content legitimately differs per run; shape must not.
function signature(source) {
  if (Array.isArray(source)) {
    // A live capture: [{op, params, response}].
    //
    // A live `chat_turn` does NOT answer with its transcript -- it returns
    // {accepted:true, turn_id} and the frames stream in through the `chat_poll`
    // responses that follow. Reading only the turn's own body therefore reports
    // EVERY captured turn as having zero frames, and would fire a
    // "fixture [...] vs capture []" finding against all 38 fixtures the moment
    // they get recorded: a check that is wrong the same way every time, which
    // is how an audit teaches people to ignore it.
    //
    // So fold each turn's polls back into it. `chat_resume` is the other shape
    // -- it answers synchronously with a `transcript` -- so take whichever the
    // response actually carried.
    const out = [];
    for (const p of source) {
      const body = (p.response || {}).data || p.response || {};
      if (TURN_OPS.has(p.op)) {
        // Transport frames must be dropped HERE too, not only in the poll
        // branch: a turn that answers synchronously carries `usage` inside its
        // own transcript, and a fixture never models it.
        out.push({ op: p.op, frames: (body.transcript || [])
          .map((f) => f.type).filter((t) => !TRANSPORT_FRAMES.has(t)) });
        continue;
      }
      // A poll before any turn belongs to no turn -- drop it rather than
      // inventing an entry the fixture could never match.
      if (p.op !== "chat_poll" || !out.length) continue;
      for (const f of body.frames || []) {
        if (!TRANSPORT_FRAMES.has(f.type)) out[out.length - 1].frames.push(f.type);
      }
    }
    return out.map((e) => ({ op: e.op, frames: collapseText(e.frames) }));
  }
  return transcriptsOf(source).map((t) => ({
    op: t.action,
    frames: collapseText(t.frames.map((f) => f.type)),
  }));
}

// Compare a fixture's shape against a recorded capture of the same scenario.
// Absence of a capture is NOT a pass -- it returns {verified:false}, and the
// caller must report that as loudly as a failure.
function compareToCapture(fixture, capture) {
  if (!capture || !capture.length) {
    return { verified: false, findings: [], reason: "no capture on disk" };
  }
  const a = signature(fixture);
  const b = signature(capture);
  const findings = [];
  const ops = (s) => s.map((x) => x.op).join(",");
  if (ops(a) !== ops(b)) {
    findings.push({ rule: "capture-op-sequence",
      detail: `fixture ops [${ops(a)}] vs capture ops [${ops(b)}]` });
  }
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i].frames.join(",") !== b[i].frames.join(",")) {
      findings.push({ rule: "capture-frame-sequence",
        detail: `${a[i].op}#${i}: fixture [${a[i].frames.join(",")}] vs `
          + `capture [${b[i].frames.join(",")}]` });
    }
  }
  return { verified: true, findings };
}

module.exports = {
  auditFixture, compareToCapture, signature, transcriptsOf, RULES,
};
