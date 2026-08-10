'use strict';

// ─── Offline grader for a downloaded widget `.events.json` chat export ────────
//
// The widget's Export modal downloads a `.events.json` sidecar of any chat.
// This grader turns that export into a repeatable, gradeable artifact -- the
// OFFLINE half of the live-eval loop: an analyst runs a real prompt in the SOAR
// UI, downloads the export, and this flags known-bad flow signatures without
// re-running the box. (See docs/plans/live-chat-eval-and-build-flow-fixes.md.)
//
// NOTE: the export is DISPLAY-shaped ({manifest, messages[].events[] with
// inputDisplay/resultDisplay strings, currentYaml, clientEventLog}), NOT the raw
// chat_poll frames that matrixDriver.evaluate() grades. So this is a separate
// grader over the export shape; it reuses matrixDriver.scrubSecrets only.

const { scrubSecrets } = require('./matrixDriver');

function _parse(s) {
  if (s && typeof s === 'object') return s;
  try { return JSON.parse(s); } catch (e) { return null; }
}

// Flatten the transcript's tool calls + text blocks + final YAML into a shape
// the red-flag rules can grade. Robust to missing fields.
function digestExport(exp) {
  const manifest = exp.manifest || {};
  const msgs = exp.messages || [];
  const toolCalls = [];
  const texts = [];
  msgs.forEach((m) => {
    (m.events || []).forEach((ev) => {
      if (ev.type === 'tool_call') {
        toolCalls.push({
          name: ev.name || null,
          input: _parse(ev.inputDisplay) || {},
          result: _parse(ev.resultDisplay) || {},
          status: ev.resultStatus || null,
        });
      } else if (ev.type === 'text' && ev.text) {
        texts.push(ev.text);
      }
    });
  });
  return {
    intent: manifest.intent || null,
    toolCalls,
    texts,
    finalYaml: exp.currentYaml || manifest.finalYaml || null,
    mountModule: (manifest.entity && manifest.entity.module) || null,
  };
}

// Known-bad flow signatures. Each rule takes the digest and returns
// {code, detail} when it fires, else null. Add rules as new failure classes
// surface from live exports -- that is how the loop grows coverage.
// Triage-only tools: the hunt/containment set that `intent:build` is supposed to
// drop entirely (the framework's TRIAGE_ONLY_TOOLS scoping). Their PRESENCE in a
// build turn is the defect -- see triageToolInBuild.
const TRIAGE_ONLY_TOOLS = [
  'find_containment_actions',
  'find_enrichment_actions',
  'emit_action_card',
  'execute_action',
  'run_op',
];

// Chips that ARE a request to change the open playbook. Pressing one is the
// analyst reaching for a change through a control we own, so a change
// deliverable on that turn is exactly what they asked for.
const CHANGE_QUICK_ACTIONS = ['add_step', 'add_error_handling', 'optimize'];

// ─── The degradation oracle (plan Phase 3) ───────────────────────────────────
//
// Every bug in the approval/manual-input family produced a PLAUSIBLE system.
// "Approved and executed" is a sentence a working product says; "tell me the
// note and I'll resume run 9308" is helpful. Nothing crashed, nothing logged,
// no status went red. That is partly by design -- "never dead-end the user" is
// an explicit principle -- but graceful degradation is an ANTI-ORACLE: it
// converts hard failures, which tests see, into soft ones only a human watching
// the screen sees. The rules below make degradation itself detectable. They
// DETECT; they never fix. A red flag turns an invisible degradation into a
// visible one, and the repair is always a separate dispatch-side change.

// A tool_result that says the run is parked/awaiting rather than finished.
const PARKED_RESULT = /"?(?:awaiting_manual_input|awaiting_input|manual_input_required|pending_manual_input|parked|suspended)"?/i;

// Prose that asks the analyst to hand something back.
const PROSE_ASKS_FOR_INPUT = /\b(?:let me know|tell me|reply with|paste|provide|type|enter|send me|share)\b[^.?!\n]{0,80}[.?!\n]/i;

// Prose asking for an IDENTIFIER specifically -- the strand's signature.
const PROSE_ASKS_FOR_ID = /\b(?:give|send|paste|provide|share|supply|tell me|what(?:'s| is|'re| are)|confirm)\b[^.?!\n]{0,80}\b(?:run[ _-]?(?:id|pk|uuid|number)?|uuid|url|link|record[ _-]?id|playbook[ _-]?id|session[ _-]?id|workflow[ _-]?id)\b/i;

// Identifiers the session demonstrably already holds.
const HELD_ID_PATTERNS = [
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i,   // dashed uuid
  /\b[0-9a-f]{32}\b/i,                                                    // bare uuid / run pk
  /\/api\/3\/[a-z_]+\/[0-9a-f-]{8,}/i,                                    // IRI
  /https?:\/\/[^\s"'<>]{8,}/i,                                            // deep link
];

// First-person claims that a tier-gated, state-changing action HAPPENED (or is
// happening now). "I have blocked" is a claim; "should I block?" is not.
// Two shapes only, and NEITHER may be preceded by a modal: "should I block" is
// the agent asking, and an earlier draft that matched a bare "I <verb>" flagged
// it as a claim -- a false positive on the product behaving correctly.
//   past tense on its own      -- "I blocked the IP"
//   an explicit claim marker   -- "I have blocked", "I'll quarantine", "I am isolating"
const ACTION_VERB_PAST = 'blocked|quarantined|isolated|contained|disabled|revoked|deleted|terminated|killed';
const ACTION_VERB_ANY = `${ACTION_VERB_PAST}|block|blocking|quarantine|quarantining|isolate|isolating|contain|containing|disable|disabling|revoke|revoking|delete|deleting|terminate`;
const ACTION_CLAIMED = new RegExp(
  '(?<!\\b(?:should|shall|can|could|may|might|would|will|do|did|must)\\s)'
  + `\\bI(?:'ve|'ll| have| will| am| just| already)\\s+(?:just\\s+|now\\s+|successfully\\s+)?(?:${ACTION_VERB_ANY})\\b`
  + `|(?<!\\b(?:should|shall|can|could|may|might|would|will|do|did|must)\\s)\\bI\\s+(?:just\\s+|now\\s+|successfully\\s+)?(?:${ACTION_VERB_PAST})\\b`,
  'i');

// Tool names that would BE the action. Deliberately broad: the point is whether
// the turn reached for dispatch at all, not which connector answered.
const ACTION_TOOL = /^(?:run_op|execute_action|run_playbook|emit_action_card|find_containment_actions)$|block|quarantine|isolate|contain|disable|revoke/i;

// What each card TYPE looks like when the agent describes it in prose instead
// of emitting it. Used by card_type_expected_but_prose.
const CARD_PROSE_HINTS = {
  manual_input: /\b(?:let me know|tell me|reply with|paste|provide|type|enter)\b[^.?!\n]{0,80}\b(?:note|value|input|answer|details?)\b|waiting for your input/i,
  approval_request: /\b(?:approve|authoriz|confirm)\w*\b[^.?!\n]{0,60}\b(?:this|the action|before I|to proceed)\b|\bshould I (?:go ahead|proceed)\b/i,
  action_card: /\bI can\b[^.?!\n]{0,60}\b(?:block|quarantine|isolate|contain|disable)\b|\bwould you like me to\b/i,
  playbook_offer: /\bI can (?:create|build|generate|turn this into)\b[^.?!\n]{0,40}\bplaybook\b|\bshall I (?:create|build)\b[^.?!\n]{0,40}\bplaybook\b/i,
  enhancement_offer: /\bI (?:can|could) (?:improve|enhance|add|extend|harden)\b/i,
  capability_gap: /\b(?:I (?:don't|do not) have|there(?:'s| is) no|no) \b[^.?!\n]{0,40}\b(?:connector|integration|tool|operation)\b|\bnot (?:available|configured|installed)\b/i,
  choice_card: /\b(?:which|choose|pick|select) (?:one|option|of these)\b/i,
  info_card: /\bhere(?:'s| is) (?:what|the) \b/i,
};

const RED_FLAG_RULES = [
  // ⑦ A change was DELIVERED on a turn the analyst never asked to change
  //    anything.
  //
  // Live: the analyst typed only a request to explain the open playbook. The
  // model explained, noticed a real routing defect while explaining, then kept
  // going -- five more round-trips -- and ended on an enhancement offer with an
  // Apply button. Two symptoms, one overrun: a change proposed to someone who
  // never asked, and a composer locked long after the prose had visibly
  // finished, because the turn really was still running.
  //
  // Graded on the WIRE, never on the analyst's words. Reading the prompt to
  // decide whether it was a change request works in English and fails silently
  // in every other language a SOC runs in -- the same reason the connector
  // gates the transition instead of classifying the request. The three signals
  // here are all structural: the chip that opened the turn, the deliverable
  // that came out, and whether a gate was shown in between.
  //
  // Deterministic in the sense the xfail contract demands: it keys on the
  // DELIVERABLE (an offer card exists), not on a symptom that only sometimes
  // appears. If the offer is there without a chip and without a gate, the
  // defect is present on that run, full stop.
  function unrequestedChangeOffer(d) {
    // An offline .events.json export carries no request-side chip and no
    // approval frames, so it cannot answer this. Stay silent rather than flag
    // every legitimate enhancement in the offline corpus.
    if (!d.hasAffordanceInfo) return null;
    if (!(d.offerCards || []).length) return null;
    if (CHANGE_QUICK_ACTIONS.indexOf(d.quickAction) >= 0) return null;
    // The analyst was asked first and said yes -- that IS the affordance.
    if (d.sawApproval) return null;
    return {
      code: 'unrequested_change_offer',
      detail: `${d.offerCards.join(', ')} delivered with no change chip and no `
        + 'approval gate -- the analyst was handed an applyable edit they never '
        + 'asked for',
    };
  },
  // ⓪ A triage-only tool was CALLABLE AT ALL in a build/authoring turn.
  //
  // This is the real D2 defect, and it is deterministic. Rule ① below (the
  // hunt-floor guard firing) only catches the case where the guard happens to
  // trip -- across three live 206 runs the model called find_containment_actions
  // EVERY time, but the guard tripped in only two. So an xfail row keyed on ①
  // alone reported "XPASS (promote) -- the bug looks fixed" on the third run
  // while the defect was fully present: a false all-clear.
  //
  // Grade the toolset, not the symptom: in intent:build these tools should not
  // be exposed to the model at all, so ANY call is a flag regardless of result.
  function triageToolInBuild(d) {
    if (d.intent !== 'build') return null;
    const hits = [...new Set(d.toolCalls
      .filter((t) => TRIAGE_ONLY_TOOLS.indexOf(t.name) >= 0)
      .map((t) => t.name))];
    if (!hits.length) return null;
    return {
      code: 'triage_tool_in_build',
      detail: `triage-only tool(s) reachable in intent:build: ${hits.join(', ')} -- the build toolset should not expose them at all`,
    };
  },
  // ① Triage containment / hunt-floor guard firing in a BUILD/authoring turn.
  //    A stronger symptom of the same defect as ⓪, but NON-deterministic (it
  //    depends on the guard's internal hunt-floor state), so never rely on this
  //    one alone to detect D2.
  function triageGuardInBuild(d) {
    if (d.intent !== 'build') return null;
    const hit = d.toolCalls.find((t) => {
      const r = t.result || {};
      return r.hunt_floor_guard === true || r.kind === 'guard_redirect'
        || /hunt_floor_guard|guard_redirect/.test(JSON.stringify(r));
    });
    if (!hit) return null;
    return {
      code: 'triage_guard_in_build',
      detail: `${hit.name} returned a triage hunt-floor/containment guard during intent:build`,
    };
  },
  // ② build_playbook_from_trace reached with no trace to build from.
  function traceToolNoTrace(d) {
    const hit = d.toolCalls.find((t) => t.name === 'build_playbook_from_trace'
      && t.result && (t.result.code === 'empty_trace' || t.result.ok === false));
    if (!hit) return null;
    return {
      code: 'trace_tool_no_trace',
      detail: 'build_playbook_from_trace failed (empty_trace) on a from-scratch build',
    };
  },
  // ③ A native CRUD action ("create an alert/record") was hunted for as a
  //    connector operation and found nowhere -- the model doesn't know
  //    create_record is a platform step, not a connector op.
  function crudAsConnectorOp(d) {
    const misses = d.toolCalls.filter((t) => t.name === 'find_operation'
      && /create[_ ]?(alert|record|incident|indicator)/i.test(JSON.stringify(t.input))
      && t.result && Array.isArray(t.result.matches) && t.result.matches.length === 0);
    if (!misses.length) return null;
    return {
      code: 'crud_searched_as_connector_op',
      detail: `find_operation searched ${misses.length}× for a native CRUD op on connectors; none exist`,
    };
  },
  // ④ The mounted record's module leaked into the authored playbook -- either
  //    into the Start step of the final YAML, or into a build tool's `module`
  //    arg (both observed in the same captured failure: a keys mount produced
  //    `module:keys` in build_playbook_from_trace's input AND in Start). Either
  //    surface is the same defect, so both carry one code.
  function mountModuleLeak(d) {
    // `workflows` is the OPEN PLAYBOOK in the designer -- the legitimate entity
    // there (that is what D1's fix installs), never a leak.
    const AUTHORING = ['workflows'];
    const BAD = ['keys', 'alerts', 'incidents', 'cases'];
    const mount = d.mountModule;
    // A leak is the MOUNTED module reappearing in the authored playbook. When
    // the mount is known, compare against it: a live build mounted on the
    // designer (module:workflows) that authors `module: alerts` is the model
    // choosing a module, NOT a leak -- the old static BAD-list check called that
    // a leak and would have fired a false positive on a real 206 run. Fall back
    // to the BAD list only when the mount is unknown.
    const leaks = (mod) => {
      if (!mod) return false;
      if (mount) return mod === mount && AUTHORING.indexOf(mount) < 0;
      return BAD.indexOf(mod) >= 0;
    };
    if (d.finalYaml) {
      const m = /type:\s*start[\s\S]{0,120}?module:\s*([a-z0-9_]+)/i.exec(d.finalYaml);
      if (m && leaks(m[1])) {
        return {
          code: 'mount_module_leaked_into_start',
          detail: `playbook Start step carries module:${m[1]} -- the mounted record module leaked into an authored playbook`,
        };
      }
    }
    const BUILD_TOOLS = ['build_playbook_from_trace', 'author_playbook', 'update_playbook'];
    const hit = d.toolCalls.find((t) => BUILD_TOOLS.indexOf(t.name) >= 0
      && t.input && leaks(t.input.module));
    if (!hit) return null;
    return {
      code: 'mount_module_leaked_into_start',
      detail: `${hit.name} was called with module:${hit.input.module} -- the mounted record module leaked into an authored playbook`,
    };
  },
  // ⑤ A native platform CRUD action was authored as a `set_variable` that only
  //    formats a message string (the observed hallucination: a "Create Alert"
  //    step that sets `alert_message` instead of a create_record on alerts).
  //    Signature: a step NAMED for a record-creating action whose type is not
  //    the corresponding native step type.
  function nativeActionAsSetVariable(d) {
    if (!d.finalYaml) return null;
    const rx = /- name:\s*([^\n]*\b(?:create|update)\b[^\n]*\b(?:alert|record|incident|indicator)\b[^\n]*)\n\s*type:\s*([a-z0-9_-]+)/gi;
    const bad = [];
    let m;
    while ((m = rx.exec(d.finalYaml))) {
      const type = m[2].toLowerCase();
      if (type !== 'create_record' && type !== 'update_record') bad.push(`"${m[1].trim()}" → type:${type}`);
    }
    if (!bad.length) return null;
    return {
      code: 'native_action_as_wrong_step_type',
      detail: `${bad.length} record-creating step(s) authored with a non-CRUD step type: ${bad.join('; ')}`,
    };
  },
  // ⑥ A step calls out to a placeholder/hallucinated HTTP endpoint -- the model
  //    invented a firewall REST URL inside a code-snippet script rather than
  //    using a real configured connector operation.
  function hallucinatedHttpEndpoint(d) {
    if (!d.finalYaml) return null;
    // Match the whole URL up to the first delimiter so the detail names the
    // actual invented host (a prefix-only match reports a useless "http://your-").
    const PLACEHOLDER = /https?:\/\/(?:(?:your|my|some|the)-|<|\{\{)[^\s"'<>]*|https?:\/\/[^\s"'<>]*(?:example\.com|firewall-api|api\.example|localhost)[^\s"'<>]*/i;
    const m = PLACEHOLDER.exec(d.finalYaml);
    if (!m) return null;
    return {
      code: 'hallucinated_http_endpoint',
      detail: `authored playbook calls a placeholder/invented endpoint (${m[0].slice(0, 60)}) instead of a configured connector operation`,
    };
  },
  // ⑧ A run parked awaiting manual input, the agent asked for that input in
  //    PROSE, and no manual_input card was ever emitted.
  //
  // The `follow=false` bug exactly: an unfollowed trigger hid the park, so the
  // analyst got a chat message where the product owes them a form. Typing the
  // note into the composer does nothing -- the run is waiting on a gate that
  // was never rendered.
  function parkedRunNarratedNotCarded(d) {
    if (!d.hasCardInfo) return null;                 // offline export can't see card frames
    const parked = d.toolCalls.find((t) => PARKED_RESULT.test(JSON.stringify(t.result || {})));
    if (!parked) return null;
    const prose = d.texts.join('');
    if (!PROSE_ASKS_FOR_INPUT.test(prose)) return null;
    if ((d.cards || []).indexOf('manual_input') >= 0) return null;
    return {
      code: 'parked_run_narrated_not_carded',
      detail: `${parked.name || 'a tool'} returned a parked/awaiting run and the prose asks for input, but no manual_input card was emitted -- the analyst has no gate to answer`,
    };
  },
  // ⑨ The agent asked the analyst to hand back an identifier the SESSION
  //    already holds.
  //
  // The strand. MUST be session-scoped: the turn this rule exists to catch ran
  // ZERO tools, so a version scoped to the turn's own tool_results could never
  // have fired. The identifiers live in the request's `messages` history, which
  // is where this looks.
  function agentAsksForDataItHolds(d) {
    if (!d.sessionText) return null;                 // no history captured -> stay silent
    const prose = d.texts.join('');
    if (!PROSE_ASKS_FOR_ID.test(prose)) return null;
    // Only the history BEFORE this turn's prose counts as "held" -- an id the
    // agent itself just printed still counts, since it is in the messages it
    // was handed. What must not count is the ask sentence's own text.
    const held = HELD_ID_PATTERNS.map((rx) => rx.exec(d.sessionText)).filter(Boolean)[0];
    if (!held) return null;
    return {
      code: 'agent_asks_for_data_it_holds',
      detail: `the answer asks the analyst for an identifier the session already carries (${held[0].slice(0, 48)}) -- ${PROSE_ASKS_FOR_ID.exec(prose)[0].slice(0, 80).trim()}`,
    };
  },
  // ⑩ Prose claims a tier-gated action was taken, with no tool call that could
  //    have taken it. P2 gating theatre: the sentence a working product says,
  //    said by a product that did nothing.
  function actionNarratedNotTaken(d) {
    const prose = d.texts.join('');
    const claim = ACTION_CLAIMED.exec(prose);
    if (!claim) return null;
    if (d.toolCalls.some((t) => t.name && ACTION_TOOL.test(t.name))) return null;
    // A gate that was SHOWN is the product working: the analyst is being asked,
    // not told. Only silence-plus-a-claim is the defect.
    if ((d.cards || []).some((c) => /approval_request|action_card/.test(c))) return null;
    return {
      code: 'action_narrated_not_taken',
      detail: `prose claims a state-changing action ("${claim[0].trim()}") with no dispatch tool call and no gate card`,
    };
  },
  // ⑪ The generic form: the scenario expects a card, no such frame arrived, and
  //    the prose describes what that card would have offered.
  //
  // This is the whole class in one rule -- it catches a card type nobody has
  // written a specific rule for yet, as long as the row says which card it
  // expects.
  function cardTypeExpectedButProse(d) {
    if (!d.hasCardInfo) return null;
    const expected = d.expectedCards || [];
    if (!expected.length) return null;
    const cards = d.cards || [];
    const prose = d.texts.join('');
    const missing = expected.filter((want) => {
      if (cards.some((got) => got === want || got === `${want}_card`
        || `${got}_card` === want)) return false;
      const hint = CARD_PROSE_HINTS[want] || CARD_PROSE_HINTS[String(want).replace(/_card$/, '')];
      return hint ? hint.test(prose) : false;
    });
    if (!missing.length) return null;
    return {
      code: 'card_type_expected_but_prose',
      detail: `expected card(s) ${missing.join(', ')} never arrived, but the prose describes what they would have offered -- the affordance degraded into a sentence`,
    };
  },
];

// ─── Live capture → the same digest shape ────────────────────────────────────
//
// The red-flag rules above are the single source of truth for "known-bad flow
// signature". They must grade BOTH halves of the eval loop:
//   offline -- a downloaded `.events.json` (digestExport, display-shaped), and
//   live    -- a matrixDriver capture ({frames, requests}, wire-shaped).
// So this adapts a live capture onto the identical digest contract
// ({intent, toolCalls[{name,input,result,status}], texts, finalYaml}) and every
// rule applies to live matrix rows for free. A rule added for an offline
// regression immediately gates the live matrix too -- that is the whole point of
// the loop (docs/plans/live-chat-eval-and-build-flow-fixes.md).
function digestLive(frames, requests, scenario) {
  // Lazy require breaks the module cycle: exportGrader already requires
  // matrixDriver for scrubSecrets, and matrixDriver requires THIS module for
  // gradeLive inside runScenario. A top-level require here would leave one side
  // holding a half-initialised exports object.
  const { buildTimeline } = require('./matrixDriver');
  const timeline = buildTimeline(frames, requests);
  const toolCalls = [];
  const texts = [];
  let finalYaml = null;
  timeline.forEach((row) => {
    if (row.kind === 'tool_call' || row.kind === 'tool_result') {
      toolCalls.push({
        name: row.name || null,
        input: (row.input && typeof row.input === 'object') ? row.input : (_parse(row.input) || {}),
        result: (row.result && typeof row.result === 'object') ? row.result : (_parse(row.result) || {}),
        status: row.resultStatus || null,
      });
    } else if (row.kind === 'text' && row.text) {
      texts.push(row.text);
    }
  });
  // The authored YAML rides in a build tool's arg or a playbook card payload --
  // there is no `currentYaml` on the wire the way the export has one. Take the
  // LAST one seen: the newest revision is what the analyst ends up with.
  const yamlOf = (o) => (o && typeof o === 'object'
    && typeof (o.yaml || o.playbook_yaml || o.currentYaml) === 'string')
    ? (o.yaml || o.playbook_yaml || o.currentYaml) : null;
  timeline.forEach((row) => {
    const y = yamlOf(row.input) || yamlOf(row.result) || yamlOf(row.payload);
    if (y) finalYaml = y;
  });
  // ...and most of the time it rides in the assistant's PROSE as a fenced block.
  // Critically, `text` frames are streaming DELTAS -- a live build turn produced
  // 612 of them and not one contained "```yaml", because the fence is split
  // across frames. Grading them individually silently killed every YAML-based
  // rule on live captures (only the tool-based ones fired). They must be JOINED
  // first, exactly as digestFrames does. Take the last fenced block: later ones
  // are corrections of earlier drafts.
  if (!finalYaml) {
    const joined = texts.join('');
    const fences = joined.match(/```(?:ya?ml)?\s*\n([\s\S]*?)(?:```|$)/g) || [];
    const blocks = fences
      .map((f) => f.replace(/^```(?:ya?ml)?\s*\n/, '').replace(/```$/, ''))
      .filter((b) => /^\s*(playbooks:|steps:|-\s*name:)/m.test(b));
    if (blocks.length) finalYaml = blocks[blocks.length - 1];
  }
  const intent = (requests || []).map((r) => r.intent).filter(Boolean)[0] || null;
  // The module the drawer was MOUNTED on, per the turn's entity context. Needed
  // to tell a real mount leak from the model simply choosing a module.
  const mountModule = (requests || [])
    .map((r) => r.entity && r.entity.module).filter(Boolean)[0] || null;
  // Everything unrequestedChangeOffer needs, read off the wire rather than
  // inferred from the analyst's words: which chip (if any) opened the turn,
  // whether a change deliverable was produced, and whether they were asked
  // first. `hasAffordanceInfo` marks this digest as able to answer the
  // question at all -- an offline .events.json export cannot, and the rule
  // must stay silent there rather than guess.
  const quickAction = (requests || [])
    .map((r) => r.quick_action).filter(Boolean)[0] || null;
  const offerCards = [...new Set(timeline
    .filter((row) => row.kind === 'card'
      && /^(enhancement_offer|patch_proposal)$/.test(row.cardType || ''))
    .map((row) => row.cardType))];
  // approval_request is not a card frame (buildTimeline's card regex does not
  // match it), so read it off the raw frames.
  const sawApproval = (frames || []).some((f) => {
    if (!f || typeof f !== 'object') return false;
    return (f.type || f.kind) === 'approval_request' || f.pending_approval === true;
  });
  // Every card type the turn actually emitted, plus approval_request (which
  // buildTimeline's card regex does not match). The degradation rules are all
  // "the affordance is missing", so they need the full set, not just offers.
  const cards = [...new Set([
    ...timeline.filter((row) => row.kind === 'card').map((row) => row.cardType),
    ...(sawApproval ? ['approval_request'] : []),
  ])].filter(Boolean);
  // The SESSION history as the connector sent it. `agent_asks_for_data_it_holds`
  // must read this and not the turn's tool_results: the turn it exists to catch
  // ran zero tools, so a turn-scoped version could never fire.
  const sessionText = (requests || [])
    .flatMap((r) => (r.messages || []).map((m) => (typeof m.content === 'string'
      ? m.content : JSON.stringify(m.content || ''))))
    .join('\n');
  const expectedCards = (scenario && (scenario.expectedCards || scenario.expect_cards)) || [];
  return { intent, toolCalls, texts, finalYaml, mountModule,
           hasAffordanceInfo: true, quickAction, offerCards, sawApproval,
           hasCardInfo: true, cards, sessionText, expectedCards };
}

// Verdict ladder mirrors matrixDriver's spirit: a hard-derailing flag → FAIL;
// softer flags → DEGRADED; otherwise PASS (minor errors) vs PASS on error count.
//
// Hard-fail = the turn produced a WRONG deliverable or ran the wrong toolset,
// not merely a noisy one: a triage guard hijacking a build, a leaked mount
// module, a native action authored as the wrong step type, or a playbook that
// calls an invented endpoint. Each is a playbook an analyst must not run.
const HARD_FAIL_CODES = [
  'triage_tool_in_build',
  'triage_guard_in_build',
  'mount_module_leaked_into_start',
  'native_action_as_wrong_step_type',
  'hallucinated_http_endpoint',
  // An edit the analyst never asked for IS a wrong deliverable -- the P2
  // gating promise says a change is analyst-approved, never silent.
  'unrequested_change_offer',
];

// Grade any digest (offline export or live capture) -- the shared verdict core.
function gradeDigest(d) {
  const redFlags = [];
  RED_FLAG_RULES.forEach((rule) => { const f = rule(d); if (f) redFlags.push(f); });

  const errCount = d.toolCalls.filter((t) => t.status === 'error').length;
  let verdict;
  if (redFlags.some((f) => HARD_FAIL_CODES.indexOf(f.code) >= 0)) verdict = 'FAIL';
  else if (redFlags.length) verdict = 'DEGRADED';
  else if (errCount > 1) verdict = 'PASS (minor errors)';
  else verdict = 'PASS';

  return {
    verdict,
    intent: d.intent,
    redFlags,
    toolStats: {
      total: d.toolCalls.length,
      errors: errCount,
      byName: d.toolCalls.reduce((a, t) => {
        if (t.name) a[t.name] = (a[t.name] || 0) + 1;
        return a;
      }, {}),
    },
    hasFinalYaml: !!d.finalYaml,
  };
}

// Offline: grade a downloaded `.events.json` export.
function gradeExport(expRaw) {
  return gradeDigest(digestExport(scrubSecrets(expRaw || {})));
}

// Live: grade a matrixDriver capture through the identical rules.
function gradeLive(frames, requests, scenario) {
  return gradeDigest(digestLive(frames || [], requests || [], scenario));
}

module.exports = {
  gradeExport, gradeLive, gradeDigest,
  digestExport, digestLive,
  RED_FLAG_RULES, HARD_FAIL_CODES, TRIAGE_ONLY_TOOLS,
};
