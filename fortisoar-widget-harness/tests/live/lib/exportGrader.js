'use strict';

// ─── Offline grader for a downloaded widget `.events.json` chat export ────────
//
// The widget's Export modal downloads a `.events.json` sidecar of any chat.
// This grader turns that export into a repeatable, gradeable artifact — the
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
// surface from live exports — that is how the loop grows coverage.
// Triage-only tools: the hunt/containment set that `intent:build` is supposed to
// drop entirely (the framework's TRIAGE_ONLY_TOOLS scoping). Their PRESENCE in a
// build turn is the defect — see triageToolInBuild.
const TRIAGE_ONLY_TOOLS = [
  'find_containment_actions',
  'find_enrichment_actions',
  'emit_action_card',
  'execute_action',
  'run_op',
];

const RED_FLAG_RULES = [
  // ⓪ A triage-only tool was CALLABLE AT ALL in a build/authoring turn.
  //
  // This is the real D2 defect, and it is deterministic. Rule ① below (the
  // hunt-floor guard firing) only catches the case where the guard happens to
  // trip — across three live 206 runs the model called find_containment_actions
  // EVERY time, but the guard tripped in only two. So an xfail row keyed on ①
  // alone reported "XPASS (promote) — the bug looks fixed" on the third run
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
      detail: `triage-only tool(s) reachable in intent:build: ${hits.join(', ')} — the build toolset should not expose them at all`,
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
  //    connector operation and found nowhere — the model doesn't know
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
  // ④ The mounted record's module leaked into the authored playbook — either
  //    into the Start step of the final YAML, or into a build tool's `module`
  //    arg (both observed in the same captured failure: a keys mount produced
  //    `module:keys` in build_playbook_from_trace's input AND in Start). Either
  //    surface is the same defect, so both carry one code.
  function mountModuleLeak(d) {
    // `workflows` is the OPEN PLAYBOOK in the designer — the legitimate entity
    // there (that is what D1's fix installs), never a leak.
    const AUTHORING = ['workflows'];
    const BAD = ['keys', 'alerts', 'incidents', 'cases'];
    const mount = d.mountModule;
    // A leak is the MOUNTED module reappearing in the authored playbook. When
    // the mount is known, compare against it: a live build mounted on the
    // designer (module:workflows) that authors `module: alerts` is the model
    // choosing a module, NOT a leak — the old static BAD-list check called that
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
          detail: `playbook Start step carries module:${m[1]} — the mounted record module leaked into an authored playbook`,
        };
      }
    }
    const BUILD_TOOLS = ['build_playbook_from_trace', 'author_playbook', 'update_playbook'];
    const hit = d.toolCalls.find((t) => BUILD_TOOLS.indexOf(t.name) >= 0
      && t.input && leaks(t.input.module));
    if (!hit) return null;
    return {
      code: 'mount_module_leaked_into_start',
      detail: `${hit.name} was called with module:${hit.input.module} — the mounted record module leaked into an authored playbook`,
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
  // ⑥ A step calls out to a placeholder/hallucinated HTTP endpoint — the model
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
];

// ─── Live capture → the same digest shape ────────────────────────────────────
//
// The red-flag rules above are the single source of truth for "known-bad flow
// signature". They must grade BOTH halves of the eval loop:
//   offline — a downloaded `.events.json` (digestExport, display-shaped), and
//   live    — a matrixDriver capture ({frames, requests}, wire-shaped).
// So this adapts a live capture onto the identical digest contract
// ({intent, toolCalls[{name,input,result,status}], texts, finalYaml}) and every
// rule applies to live matrix rows for free. A rule added for an offline
// regression immediately gates the live matrix too — that is the whole point of
// the loop (docs/plans/live-chat-eval-and-build-flow-fixes.md).
function digestLive(frames, requests) {
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
  // The authored YAML rides in a build tool's arg or a playbook card payload —
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
  // Critically, `text` frames are streaming DELTAS — a live build turn produced
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
  return { intent, toolCalls, texts, finalYaml, mountModule };
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
];

// Grade any digest (offline export or live capture) — the shared verdict core.
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
function gradeLive(frames, requests) {
  return gradeDigest(digestLive(frames || [], requests || []));
}

module.exports = {
  gradeExport, gradeLive, gradeDigest,
  digestExport, digestLive,
  RED_FLAG_RULES, HARD_FAIL_CODES, TRIAGE_ONLY_TOOLS,
};
