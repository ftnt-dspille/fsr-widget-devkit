"use strict";
// Does the widget READ the keys the connector puts on a card?
//
// THE DEFECT THIS EXISTS FOR. The connector has shipped `target` / `changes` /
// `context_match` on record-write approval cards since tracker #78. The widget's
// `normalizeActionCard` never read one of them, so the analyst saw the same args
// blob as before -- for months, with tests green on both sides. A live producer
// with no consumer reads, from either side, exactly like the feature not
// existing, and nothing in either repo could see the gap: the connector tested
// what it emitted, the widget tested what it rendered, and no test compared the
// two.
//
// The same shape runs the other way. `unrequested_change.json` sends an
// `enhancement_offer` with `after_yaml` + `diff`, and the producer sends
// `final_yaml` + `steps_added/removed/modified`. The card's whole purpose is to
// carry the VERIFIED bytes, so the fixture put an Apply button on a card holding
// nothing -- and the e2e spec, which asserts the button exists, passed.
//
// So: for every card frame in the fixtures, every key must be one the renderer
// reads for THAT card type. Per-type matters -- `after_yaml` is read by
// patch_proposal, which is exactly why a file-wide read set would have missed
// the enhancement_offer bug.
//
// Direction of error, chosen deliberately: the read set is extracted broadly
// (any `.key` or `['key']` inside the type's branch, whatever the receiver is
// named -- `ev`, `event`, `_e`, a cast in parens). Broad means this UNDER-
// reports rather than crying wolf, so a finding here is close to certain.

// Keys every frame carries for transport/threading rather than display.
const STRUCTURAL = new Set(["type", "preceding_tool_use_id", "tool_use_id", "call_id"]);

// Slice the dispatch branch for one card type: from its `type === 'x'` test up
// to the next type test. Anything the branch delegates to (normalizeActionCard,
// normalizePatchProposal, ...) is appended, or every delegating card type would
// look like it reads nothing.
function branchFor(src, cardType) {
  const marker = new RegExp(`type\\s*===\\s*'${cardType}'`);
  const m = marker.exec(src);
  if (!m) return null;
  const rest = src.slice(m.index + m[0].length);
  // End at the next type test OR at the next top-level function, whichever
  // comes first. Without the second bound the LAST branch in the chain swallows
  // every helper below it and reads as covering keys it never touches -- an
  // audit that silently passes the one card at the end of the file.
  const bounds = [/type\s*===\s*'[a-z_]+'/, /\nfunction\s+/]
    .map((re) => { const x = re.exec(rest); return x ? x.index : -1; })
    .filter((i) => i >= 0);
  let body = bounds.length ? rest.slice(0, Math.min(...bounds)) : rest;
  const seen = new Set();
  let calls = /\b(normalize[A-Za-z0-9_]*)\s*\(/g;
  let c;
  const bodies = [body];
  while ((c = calls.exec(body))) {
    if (seen.has(c[1])) continue;
    seen.add(c[1]);
    const fn = new RegExp(`function\\s+${c[1]}\\s*\\(`).exec(src);
    if (!fn) continue;
    const after = src.slice(fn.index);
    const end = after.search(/\n(?:function|\/\/ ---)/);
    bodies.push(end > 0 ? after.slice(0, end) : after);
  }
  return bodies.join("\n");
}

function keysRead(body) {
  const out = new Set();
  if (!body) return out;
  let m;
  const dot = /\.([A-Za-z_][A-Za-z0-9_]*)\b/g;
  while ((m = dot.exec(body))) out.add(m[1]);
  const brk = /\[\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*\]/g;
  while ((m = brk.exec(body))) out.add(m[1]);
  return out;
}

// The renderer's per-card read sets. `null` for a type with no branch at all --
// which is itself a finding, not a silent pass.
function readSets(rendererSrc, cardTypes) {
  const out = {};
  cardTypes.forEach((t) => {
    const body = branchFor(rendererSrc, t);
    out[t] = body === null ? null : keysRead(body);
  });
  return out;
}

// Every card frame in a fixture, as {type, keys}.
function cardFramesOf(fixture, cardTypes) {
  const want = new Set(cardTypes);
  const out = [];
  (fixture.responses || []).forEach((r, i) => {
    (((r.response || {}).transcript) || []).forEach((f) => {
      if (f && want.has(f.type)) out.push({ i, type: f.type, keys: Object.keys(f) });
    });
  });
  return out;
}

function auditKeyParity(fixture, sets, cardTypes) {
  const findings = [];
  cardFramesOf(fixture, cardTypes).forEach((frame) => {
    const read = sets[frame.type];
    if (read === null || read === undefined) {
      findings.push({ rule: "card-type-the-widget-cannot-render",
        detail: `responses[${frame.i}] carries a '${frame.type}' card and the `
          + "renderer has no branch for it -- the analyst sees nothing" });
      return;
    }
    const unread = frame.keys.filter((k) => !STRUCTURAL.has(k) && !read.has(k));
    unread.forEach((k) => {
      findings.push({ rule: "card-key-nothing-reads",
        detail: `responses[${frame.i}] ${frame.type} carries '${k}', which the `
          + "renderer never reads for that card type. Either the widget is "
          + "dropping a field the connector ships (the #78 shape: a live "
          + "producer with no consumer), or the fixture invented a key the "
          + "producer does not send (the #104 shape) -- both render as the "
          + "feature silently not existing." });
    });
  });
  return findings;
}

module.exports = { auditKeyParity, readSets, branchFor, keysRead, cardFramesOf, STRUCTURAL };
