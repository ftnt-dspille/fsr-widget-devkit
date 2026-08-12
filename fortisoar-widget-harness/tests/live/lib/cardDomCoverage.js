"use strict";
// Which analyst-facing cards have ever been proven ON A BOX, in the DOM?
//
// WHY. The matrix grades the WIRE -- it digests transcript frames, so a row can
// verdict PASS while the analyst's screen says the opposite. That is exactly how
// #90 survived: the frames were perfect while the approval card told the analyst
// their live, parked run had not run. Hermetic e2e specs close the render half
// against a FIXTURE, and #104 is the standing reminder that a fixture is its
// author's belief about the wire.
//
// So the honest claim per card type is one of three things, and #105's real
// deliverable is that the claim is WRITTEN DOWN rather than implied:
//
//   live-dom      a live spec drives this card on a real box and asserts the DOM
//   hermetic-only the render is pinned against a fixture only -- say so, and say
//                 what that does NOT cover
//   not-a-card    a display-only frame with nothing for the analyst to act on
//
// The registry (docs/CARD_DOM_COVERAGE.md) holds that classification. This file
// is what stops the registry from becoming a stale hand-maintained list: the
// card types are DISCOVERED from the renderer's own dispatch, so a card type
// added tomorrow is a finding until someone classifies it. A hand-listed set of
// things to check has the same failure mode as the thing it is checking.

// The renderer's dispatch chain is the authority on what card types exist:
// `ev.type === 'x'` (and the one `(ev as any).type === 'x'` -- enhancement_offer
// is not in the RenderEvent union, so a checker that read only the union would
// miss a card the analyst can click).
function dispatchTypes(src) {
  const out = [];
  const re = /\(?ev(?:\s+as\s+any)?\)?\.type\s*===\s*'([a-z_]+)'/g;
  let m;
  while ((m = re.exec(src))) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

// A live spec declares what it proves, in a marker a grep can find:
//
//   // @covers-card-live: approval_request, manual_input
//
// Declared rather than inferred on purpose. Inferring from selectors would
// credit a spec that merely MENTIONS a card id in a comment, and the thing being
// claimed here -- "an analyst drove this card on a box" -- is a judgment the
// spec's author has to make and sign.
function claimsFromSpec(src) {
  const out = [];
  const re = /@covers-card-live:\s*([a-z_,\s]+)/g;
  let m;
  while ((m = re.exec(src))) {
    m[1].split(",").map((s) => s.trim()).filter(Boolean)
      .forEach((t) => { if (!out.includes(t)) out.push(t); });
  }
  return out;
}

// The registry table:
//   | `approval_request` | live-dom | evidence... |
const TIERS = new Set(["live-dom", "hermetic-only", "not-a-card"]);

function parseRegistry(md) {
  const rows = [];
  const re = /^\|\s*`([a-z_]+)`\s*\|\s*([a-z-]+)\s*\|([^|]*)\|/gm;
  let m;
  while ((m = re.exec(md))) {
    rows.push({ type: m[1], tier: m[2].trim(), note: m[3].trim() });
  }
  return rows;
}

// Reconcile the three sources. Every finding here is a way the registry could
// quietly stop describing reality.
function reconcile({ types, claims, registry }) {
  const findings = [];
  const byType = new Map();
  for (const r of registry) {
    if (byType.has(r.type)) {
      findings.push({ rule: "duplicate-registry-row",
        detail: `${r.type} is classified twice -- one of the rows is dead and `
          + "nobody can tell which" });
    }
    byType.set(r.type, r);
  }

  for (const t of types) {
    const row = byType.get(t);
    if (!row) {
      // The point of the whole file: a new card type ships unclassified, and
      // the gate says so instead of implying the old coverage still describes
      // the product.
      findings.push({ rule: "unclassified-card-type",
        detail: `the renderer dispatches '${t}' and the registry does not `
          + "classify it. Add a row: live-dom (name the spec), hermetic-only "
          + "(say what is NOT covered), or not-a-card." });
      continue;
    }
    if (!TIERS.has(row.tier)) {
      findings.push({ rule: "unknown-tier",
        detail: `${t} is classified '${row.tier}', which is not one of `
          + `${[...TIERS].join(" / ")}` });
      continue;
    }
    if (row.tier === "live-dom" && !claims.includes(t)) {
      // A registry that can promote itself is a registry that says whatever its
      // author last hoped. live-dom has to be backed by a spec that CLAIMS the
      // card in its own header.
      findings.push({ rule: "live-dom-without-a-spec",
        detail: `${t} is registered live-dom, but no live spec carries `
          + `'@covers-card-live: ${t}'. Either the spec was deleted or the row `
          + "is aspirational." });
    }
    if (row.tier !== "live-dom" && claims.includes(t)) {
      findings.push({ rule: "spec-covers-more-than-the-registry-admits",
        detail: `a live spec claims ${t} but the registry still calls it `
          + `'${row.tier}' -- the written gap is understating the coverage, `
          + "which is how a stale doc survives" });
    }
    if (!row.note) {
      findings.push({ rule: "classification-without-a-reason",
        detail: `${t} is classified '${row.tier}' with an empty note. The note `
          + "is the deliverable -- the evidence, or what we are NOT claiming." });
    }
  }

  for (const t of byType.keys()) {
    if (!types.includes(t)) {
      findings.push({ rule: "registry-row-for-a-dead-type",
        detail: `the registry classifies '${t}', which the renderer no longer `
          + "dispatches -- the row is describing a card that does not exist" });
    }
  }

  for (const c of claims) {
    if (!types.includes(c)) {
      findings.push({ rule: "spec-claims-a-nonexistent-card",
        detail: `a live spec claims '${c}', which the renderer does not `
          + "dispatch. A typo'd claim is a coverage line nobody is owed." });
    }
  }

  return findings;
}

module.exports = { dispatchTypes, claimsFromSpec, parseRegistry, reconcile, TIERS };
