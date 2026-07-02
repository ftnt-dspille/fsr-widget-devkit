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

function isErr(f) {
  if (f.type === "error") return true;
  const p = payloadOf(f);
  if (p && typeof p === "object") {
    if (p.ok === false) return true;
    if (p.error || p.code === "error" || p.exception) return true;
    return ERR_RX.test(JSON.stringify(p));
  }
  return typeof p === "string" && ERR_RX.test(p);
}

// Digest a captured frame array: frame-type counts/order, tool trace, tool
// errors, streamed assistant text, terminal stop_reason.
function digestFrames(allFrames) {
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
  const gotExpected = expectedCards.filter((t) => (counts[t] || 0) > 0);
  const missingExpected = expectedCards.filter((t) => !(counts[t] > 0));
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

  // Tap chat_poll responses for full frame payloads.
  const allFrames = [];
  page.on("response", async (r) => {
    if (!/integration\/execute/.test(r.url())) return;
    let req = {};
    try { req = r.request().postDataJSON() || {}; } catch (_) { return; }
    if (req.operation !== "chat_poll") return;
    let data = {};
    try { data = (await r.json()).data || {}; } catch (_) { return; }
    for (const f of (data.frames || [])) allFrames.push(f);
  });

  const res = await session.sendChat(prompt, { timeoutMs });
  await session.close();
  return { frames: allFrames, res };
}

// Capture + evaluate one scenario row. Scenario: { id, kind, module?,
// recordUuid, prompt, expectedCards[], minTools, errBudget, timeoutMs }.
async function runScenario(scenario) {
  const { frames, res } = await captureScenario(scenario);
  const evaluation = evaluate(frames, scenario);
  return { frames, res, evaluation };
}

// Render the same transcript digest + evaluation block the ad-hoc driver
// printed — the human-readable per-scenario report.
function formatReport(scenario, res, evaluation) {
  const { digest, verdict, why, sigs, metrics } = evaluation;
  const lines = [];
  lines.push("\n================ TRANSCRIPT DIGEST ================");
  lines.push(`scenario: ${scenario.id || "?"}  record: ${scenario.recordUuid}`);
  lines.push("prompt: " + scenario.prompt);
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

module.exports = { ERR_RX, payloadOf, isErr, digestFrames, evaluate, captureScenario, runScenario, formatReport };
