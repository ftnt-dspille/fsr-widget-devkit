// Live prompt/flow matrix driver — the promoted (committed, repeatable) form of
// the ad-hoc matrixDrive.js live driver. Two halves:
//
//   capture:  openWidgetDrawer({module, recordUuid}) on the deployed widget,
//             send one prompt, tap every chat_poll response for its full frame
//             payloads (captureScenario).
//   evaluate: pure functions over the captured frame array (digestFrames /
//             evaluate / isErr) — no browser, no network — so the offline unit
//             suite (tests/matrixEval.test.js) can exercise the verdict logic
//             with synthetic frames.
//
// Evaluation model (preserve exactly — this is the matrix's contract):
//  - Health axis = TOOL ERRORS, not call count. A clean scenario has ~0 tool
//    errors (errBudget default 1). Above budget we flag it even when the agent
//    self-corrects — a self-correction that costs many failed calls still
//    points at a prompt/tool/connector fix.
//  - minTools: a triage that runs 0 tools is an LLM summarizer, not an
//    investigator → hard FAIL (no-investigation). Every triage/containment
//    scenario should set minTools >= 1.
//  - Distinct error signatures: repeated identical errors (e.g. the same
//    ModuleNotFound on every call) point at ONE root cause, not N problems.
//  - Verdict ladder: FAIL (no-investigation) > FAIL (no deliverable) >
//    DEGRADED > PASS (minor errors) > PASS. Only FAIL* is a hard failure.
"use strict";

// Classify a tool_result / frame payload as an error. Covers the connector's
// structured failures ({ok:false}, {error}, {code:...}), thrown-exception text,
// and the "empty/degraded" results that silently derail a hunt (no matches,
// module/connector unavailable, unknown_operation).
const ERR_RX = /\b(error|unavailable|not available|unknown_operation|no matches|no operations|failed|exception|traceback|denied|forbidden|timed? out|invalid endpoint|invalid credentials|not configured|no close suggestion)\b/i;

function payloadOf(f) { return f.content ?? f.result ?? f.output ?? f.message ?? ""; }

// Card-type equivalence for the expected-card gate. The widget renders
// `status_card`, `info_card`, and `ioc_card` through the SAME path
// (fsrPbRender.js §render: `status_card | info_card | ioc_card` →
// normalizeInfoCard), and the connector normalizes an IOC-consolidation
// deliverable to an `info_card` (variant `ioc_enrichment`). So for acceptance
// they are ONE deliverable — an emitted `ioc_card` satisfies an `info_card`
// expectation and vice versa. Canonicalize both the expected list and the
// observed frame types through this map before matching, so the harness gates on
// real contract behavior, not on which of two interchangeable frame names the
// connector happened to emit. (`status_card` is deliberately NOT folded in — it
// is a connector-health deliverable, semantically distinct from an info/ioc
// finding, so a scenario that wants an info deliverable must not pass on a bare
// status card.)
const CARD_ALIAS = { ioc_card: "info_card" };
function canonCard(t) { return CARD_ALIAS[t] || t; }

function isErr(f) {
  if (f.type === "error") return true;
  const p = payloadOf(f);
  if (p && typeof p === "object") {
    // Guard redirects (hunt-floor / call-once / capability guards) are
    // STEERING, not failures — the framework marks them kind:"guard_redirect"
    // (AGENT_HARDENING §D) exactly so evals and the widget can tell them
    // apart from real tool errors.
    if (p.kind === "guard_redirect") return false;
    if (p.ok === false) return true;
    if (p.error || p.code === "error" || p.exception) return true;
    // Structured success: a nested "error" string is DATA, not a tool
    // failure (list_configured_connectors reports each config's health —
    // an unconfigured imap on the box red-flagged the whole call).
    if (p.ok === true) return false;
    return ERR_RX.test(JSON.stringify(p));
  }
  return typeof p === "string" && ERR_RX.test(p);
}

// The cards the widget actually renders (info_card / status_card /
// capability_gap / ioc_card / action_card / playbook_offer …) are delivered
// INSIDE the final `stream_end.transcript[]`, NOT as top-level chat_poll frames
// (top-level frames are only turn_start/text/tool_use/tool_result/usage/
// stream_end). So any consumer that only scans top-level frames misses every
// card — which made the eval report `got=[]` and FAIL a scenario that actually
// produced an info_card. This returns the canonical rendered timeline: the last
// stream_end's transcript (complete + deduped, WITH cards) plus a terminal
// marker carrying stop_reason; falls back to the raw frames when there is no
// transcript (turn errored / detached). Idempotent: the appended stream_end has
// no `.transcript`, so re-running is a no-op.
function canonicalFrames(allFrames) {
  const se = [...(allFrames || [])].reverse().find(
    (f) => f && f.type === "stream_end" && Array.isArray(f.transcript) && f.transcript.length);
  if (!se) return allFrames || [];
  return [...se.transcript, { type: "stream_end", stop_reason: se.stop_reason || se.reason }];
}

// Digest a captured frame array: frame-type counts/order, tool trace, tool
// errors, streamed assistant text, terminal stop_reason. Operates on the
// canonical (transcript-expanded) timeline so emitted cards are counted.
function digestFrames(rawFrames) {
  const allFrames = canonicalFrames(rawFrames);
  const order = [];
  const counts = {};
  const tools = [];
  const toolErrors = [];
  const lastUseByTool = {};
  let text = "";
  let terminalStop = null;
  for (const f of allFrames) {
    const t = f.type || "?";
    counts[t] = (counts[t] || 0) + 1;
    if (order[order.length - 1] !== t) order.push(t);
    if (t === "tool_use") {
      const nm = f.name || f.tool;
      lastUseByTool[nm] = JSON.stringify(f.input || f.params || {}).slice(0, 200);
      tools.push("→ " + nm + "(" + JSON.stringify(f.input || f.params || {}).slice(0, 160) + ")");
    }
    if (t === "tool_result") {
      const nm = f.tool || "";
      tools.push("  ⤷ result " + nm + ": " + JSON.stringify(payloadOf(f)).slice(0, 200));
      if (isErr(f)) toolErrors.push({ tool: nm, args: lastUseByTool[nm], payload: JSON.stringify(payloadOf(f)).slice(0, 300) });
    }
    if (t === "error") toolErrors.push({ tool: "(error frame)", payload: JSON.stringify(f).slice(0, 300) });
    if (t === "text" && f.text) text += f.text;
    if (t === "stream_end") terminalStop = f.stop_reason || f.reason || terminalStop;
  }
  return { order, counts, tools, toolErrors, text, terminalStop };
}

// Pure evaluation: minimal tool ERRORS OR self-correction. When errors DO
// occur, the agent must still self-correct to the expected deliverable;
// otherwise the scenario failed. Even a successful run with many errors is
// DEGRADED — each failed call is a prompt/tool/connector fix waiting.
//
// opts: { expectedCards: string[] (frame types that MUST appear),
//         errBudget: number (default 1), minTools: number (default 1) }
function evaluate(allFrames, opts = {}) {
  const expectedCards = opts.expectedCards || [];
  const errBudget = opts.errBudget ?? 1;
  const minTools = opts.minTools ?? 1;

  const digest = digestFrames(allFrames);
  const { counts, toolErrors, terminalStop } = digest;

  const toolCalls = counts["tool_use"] || 0;
  const errCount = toolErrors.length;
  // Canonicalize emitted card types through the alias map so an `ioc_card`
  // satisfies an `info_card` expectation (and vice versa) — see CARD_ALIAS.
  const emitted = new Set(Object.keys(counts).filter((t) => counts[t] > 0).map(canonCard));
  const gotExpected = expectedCards.filter((t) => emitted.has(canonCard(t)));
  const missingExpected = expectedCards.filter((t) => !emitted.has(canonCard(t)));
  const correct = expectedCards.length === 0 ? null : missingExpected.length === 0;

  // Distinct error signatures — repeated identical errors point at ONE root cause.
  const sigs = [...new Set(toolErrors.map((e) => (e.payload.match(/"(error|message|suggestion)":"[^"]{0,60}/) || [e.payload.slice(0, 60)])[0]))];

  let verdict, why;
  if (toolCalls < minTools) {
    verdict = "FAIL (no-investigation)";
    why = `ran ${toolCalls} tool call(s), needs >=${minTools} — this is an LLM summarizer, not an investigator; the agent narrated the seed context instead of pulling records / enriching / searching`;
  } else if (correct === false) {
    verdict = "FAIL";
    why = `no deliverable (missing: ${missingExpected.join(",")}) after ${errCount} tool errors — agent could NOT self-correct`;
  } else if (errCount > errBudget) {
    verdict = "DEGRADED";
    why = `${errCount} tool errors (budget ${errBudget})` + (correct === true ? " but self-corrected to deliverable" : "") + ` — ${sigs.length} distinct root cause(s) to fix`;
  } else if (errCount > 0) {
    verdict = "PASS (minor errors)";
    why = `${errCount} tool error(s) within budget; ` + (correct === null ? "no expected-card gate" : "deliverable present");
  } else {
    verdict = "PASS";
    why = `0 tool errors; ` + (correct === null ? "clean run" : "deliverable present");
  }

  return {
    digest,
    verdict,
    why,
    hardFail: verdict.startsWith("FAIL"),
    sigs,
    metrics: {
      toolCalls, minTools, errCount, errBudget,
      distinctCauses: sigs.length,
      expected: expectedCards, gotExpected, missingExpected,
      terminalStop,
    },
  };
}

// Capture one scenario against the live box: open the deployed widget drawer
// on a real record, send the prompt, and collect full chat_poll frame payloads
// until the turn converges. Requires FSR_BASE_URL/FSR_USERNAME/FSR_PASSWORD
// (WAF-safe driving — headed + desktop UA — is owned by lib/liveUiDriver).
async function captureScenario({ module = "alerts", recordUuid, prompt, timeoutMs = 120000 }) {
  // Lazy require: keeps the pure eval half loadable in offline jest without
  // pulling in Playwright/the browser stack.
  const { openWidgetDrawer } = require("../../../lib/liveUiDriver");

  const session = await openWidgetDrawer({ module, recordUuid });
  const page = session.page;

  // Tap the live connector traffic for the FULL timeline: chat_poll responses
  // carry the frames (tool_use/tool_result/text/error, untruncated), and the
  // chat_turn/chat_resume REQUESTS carry the input side (messages[], intent,
  // entity, decision/card_id). Both are needed to see WHY a turn failed —
  // truncated console digests hid, e.g., that two find_enrichment_actions calls
  // had different target_type args (domain vs ip).
  const allFrames = [];
  const requests = [];
  page.on("response", async (r) => {
    if (!/integration\/execute/.test(r.url())) return;
    let req = {};
    try { req = r.request().postDataJSON() || {}; } catch (_) { return; }
    const op = req.operation;
    if (op === "chat_turn" || op === "chat_resume") {
      const p = req.params || req.body || {};
      requests.push({
        op,
        messages: p.messages, intent: p.intent, entity: p.entity,
        decision: p.decision, card_id: p.card_id, session_id: p.session_id,
      });
      return;
    }
    if (op !== "chat_poll") return;
    let data = {};
    try { data = (await r.json()).data || {}; } catch (_) { return; }
    for (const f of (data.frames || [])) allFrames.push(f);
  });

  const res = await session.sendChat(prompt, { timeoutMs });
  await session.close();
  return { frames: allFrames, res, requests };
}

// Redact obvious secrets before an artifact hits disk (mirrors the widget
// export's _scrubSecrets). Artifacts are gitignored, but creds should never be
// written even locally.
function scrubSecrets(obj) {
  let s = JSON.stringify(obj);
  s = s.replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [REDACTED]");
  s = s.replace(/eyJ[A-Za-z0-9._-]{10,}/g, "[JWT-REDACTED]");
  s = s.replace(/("(?:password|api_key|apiKey|token|secret)"\s*:\s*")[^"]*(")/gi,
    "$1[REDACTED]$2");
  return JSON.parse(s);
}

// Join each tool_use to its tool_result by call id → one row per tool call
// carrying the FULL input, output, and error flag. Interleaves input messages,
// assistant text, cards, and error frames in wire order — the whole timeline.
function buildTimeline(rawFrames, requests) {
  const frames = canonicalFrames(rawFrames);
  const timeline = [];
  for (const req of (requests || [])) {
    for (const m of (req.messages || [])) {
      timeline.push({ kind: "input_message", op: req.op, role: m.role,
        intent: req.intent, content: m.content, decision: req.decision,
        card_id: req.card_id });
    }
    if (!(req.messages || []).length && (req.decision || req.card_id)) {
      timeline.push({ kind: "input_message", op: req.op, role: "user",
        decision: req.decision, card_id: req.card_id });
    }
  }
  const useById = {};
  for (const f of (frames || [])) {
    const t = f.type;
    if (t === "tool_use") {
      const row = { kind: "tool_call", name: f.name, input: f.input ?? f.params ?? {},
        result: undefined, resultStatus: "pending", isError: undefined };
      if (f.id) useById[f.id] = row;
      timeline.push(row);
    } else if (t === "tool_result") {
      const payload = payloadOf(f);
      const row = f.tool_use_id && useById[f.tool_use_id];
      const err = isErr(f);
      if (row) { row.result = payload; row.resultStatus = err ? "error" : "ok"; row.isError = err; }
      else timeline.push({ kind: "tool_result", name: f.name, result: payload,
        resultStatus: err ? "error" : "ok", isError: err });
    } else if (t === "text") {
      timeline.push({ kind: "text", text: f.text ?? f.content ?? "" });
    } else if (t === "error") {
      timeline.push({ kind: "error", payload: f });
    } else if (/_card$|^info_card$|playbook_offer|capability_gap|manual_input|choice_card/.test(t || "")) {
      timeline.push({ kind: "card", cardType: t, payload: f });
    } else if (t === "usage") {
      timeline.push({ kind: "usage", input_tokens: f.input_tokens, output_tokens: f.output_tokens,
        stop_reason: f.stop_reason });
    }
  }
  return timeline;
}

// Write the FULL captured timeline (input messages + every tool call's full
// input/output/error + raw frames) to a gitignored artifact so a failing
// scenario is fully inspectable WITHOUT bloating the console/agent context.
// Returns the artifact path (or null if the write failed — never throws).
function writeArtifact(scenario, res, evaluation, frames, requests) {
  try {
    const fs = require("fs");
    const path = require("path");
    const dir = path.join(__dirname, "..", "_artifacts");
    fs.mkdirSync(dir, { recursive: true });
    const timeline = buildTimeline(frames, requests);
    const d = evaluation.digest || {};
    const artifact = scrubSecrets({
      manifest: {
        id: scenario.id, kind: scenario.kind, record: scenario.recordUuid,
        prompt: scenario.prompt, verdict: evaluation.verdict, why: evaluation.why,
        frameCounts: d.counts, toolCalls: (d.tools || []).length,
        toolErrors: (d.toolErrors || []).length, terminalStop: d.terminalStop,
        done: res.done, streamedTurn: res.sawStreamingTurn,
      },
      timeline,          // paired, full input/output/error — the human view
      requests,          // raw chat_turn/chat_resume inputs
      frames,            // raw untruncated chat_poll frames — nothing lost
    });
    const file = path.join(dir, `${scenario.id || "scenario"}.json`);
    fs.writeFileSync(file, JSON.stringify(artifact, null, 2));
    return file;
  } catch (_) {
    return null;
  }
}

// Capture + evaluate one scenario row. Scenario: { id, kind, module?,
// recordUuid, prompt, expectedCards[], minTools, errBudget, timeoutMs }.
async function runScenario(scenario) {
  const { frames, res, requests } = await captureScenario(scenario);
  const evaluation = evaluate(frames, scenario);
  const artifactPath = writeArtifact(scenario, res, evaluation, frames, requests);
  return { frames, res, requests, evaluation, artifactPath };
}

// Render the same transcript digest + evaluation block the ad-hoc driver
// printed — the human-readable per-scenario report.
function formatReport(scenario, res, evaluation, artifactPath) {
  const { digest, verdict, why, sigs, metrics } = evaluation;
  const lines = [];
  lines.push("\n================ TRANSCRIPT DIGEST ================");
  lines.push(`scenario: ${scenario.id || "?"}  record: ${scenario.recordUuid}`);
  lines.push("prompt: " + scenario.prompt);
  if (artifactPath) lines.push("full timeline artifact: " + artifactPath);
  lines.push(`streamedTurn: ${res.sawStreamingTurn} | maxFrames: ${res.maxFrames} | done: ${res.done}`);
  lines.push("frame counts: " + JSON.stringify(digest.counts));
  lines.push("frame order: " + digest.order.join(" → "));
  lines.push("terminal stop_reason: " + digest.terminalStop);
  lines.push(`\n--- TOOL ERRORS (${digest.toolErrors.length}) ---`);
  if (digest.toolErrors.length === 0) lines.push("(none)");
  else for (const e of digest.toolErrors) lines.push("✗ " + e.tool + (e.args ? " " + e.args : "") + "\n    " + e.payload);
  lines.push("\n--- tool trace ---");
  lines.push(digest.tools.length ? digest.tools.join("\n") : "(no tool calls)");
  lines.push("\n--- assistant text ---");
  lines.push(digest.text.slice(0, 2000) || "(none)");
  lines.push("\n================ EVALUATION ================");
  lines.push("verdict: " + verdict);
  lines.push("why: " + why);
  lines.push(`metrics: toolErrors=${metrics.errCount} (budget ${metrics.errBudget}) distinctCauses=${metrics.distinctCauses} toolCalls=${metrics.toolCalls} (min ${metrics.minTools}) expected=[${metrics.expected.join(",")}] got=[${metrics.gotExpected.join(",")}] terminal=${metrics.terminalStop}`);
  if (sigs.length) lines.push("distinct error signatures:\n  " + sigs.join("\n  "));
  lines.push("==================================================\n");
  return lines.join("\n");
}

module.exports = { ERR_RX, CARD_ALIAS, canonCard, payloadOf, isErr, canonicalFrames, digestFrames, evaluate, buildTimeline, scrubSecrets, writeArtifact, captureScenario, runScenario, formatReport };
