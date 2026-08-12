"use strict";
// The gate behind docs/CARD_KEY_PARITY.md.
//
// It closes the seam neither repo could see: the connector tested what it
// emitted, the widget tested what it rendered, and nothing compared the two. A
// key on the wire that no renderer branch reads is either a live producer with
// no consumer (#78: `target`/`changes`/`context_match` dropped for months) or a
// fixture inventing a key the producer never sends (#104: an `enhancement_offer`
// carrying an Apply button over an empty payload, with a green e2e spec).
//
// Findings are not tolerated by count. Each unread key is listed in the doc with
// a reason -- including `UNTRIAGED`, which is a visible state rather than
// silence -- and an unlisted key fails. A listed key that stops being unread
// fails too, so a row cannot outlive what it explains.

const fs = require("fs");
const path = require("path");
const {
  auditKeyParity, auditCaptureParity, readSets, branchFor, keysRead,
} = require("./live/lib/cardKeyParity");

const HARNESS = path.join(__dirname, "..");
const WIDGET = path.join(HARNESS, "..", "widgets-src", "fortiaiAgenticAssistant");
const RENDERER = path.join(WIDGET, "widget", "widgetAssets", "js", "fsrPbRender.ts");
const FIXTURES = path.join(WIDGET, "widget", "widgetAssets", "fixtures");
const DOC = path.join(HARNESS, "docs", "CARD_KEY_PARITY.md");
const CAPTURES = path.join(HARNESS, "tests", "live", "captures");

// The analyst-actionable cards. Display-only frames (text, tool_use, info_card)
// are not gated here -- see docs/CARD_DOM_COVERAGE.md for that boundary.
const CARD_TYPES = ["action_card", "approval_request", "manual_input", "choice_card",
  "capability_gap", "playbook_offer", "enhancement_offer", "patch_proposal"];

function docRows() {
  const rows = [];
  const re = /^\|\s*`([a-z_]+)`\s*\|\s*`([a-z_]+)`\s*\|\s*([A-Za-z-]+)\s*\|([^|]*)\|/gm;
  let m;
  const md = fs.readFileSync(DOC, "utf8");
  while ((m = re.exec(md))) {
    rows.push({ card: m[1], key: m[2], status: m[3].trim(), reason: m[4].trim() });
  }
  return rows;
}

function realFindings() {
  const sets = readSets(fs.readFileSync(RENDERER, "utf8"), CARD_TYPES);
  const out = [];
  fs.readdirSync(FIXTURES).filter((f) => f.endsWith(".json")).sort().forEach((f) => {
    const fixture = JSON.parse(fs.readFileSync(path.join(FIXTURES, f), "utf8"));
    auditKeyParity(fixture, sets, CARD_TYPES).forEach((x) => out.push({ fixture: f, ...x }));
  });
  // CAPTURES TOO, and this is the half that matters most. A fixture is its
  // author's belief about the wire (#104), so auditing only fixtures makes the
  // audit inherit their blind spots -- which is exactly what happened:
  // `requires_step_up`, `tier`, `cursor`, a run-history `context` block and the
  // manual-input deadline are on every recorded card and were in NO fixture, so
  // nothing could report them as unread.
  if (fs.existsSync(CAPTURES)) {
    fs.readdirSync(CAPTURES).filter((f) => f.endsWith(".payloads.json")).sort()
      .forEach((f) => {
        let cap;
        try {
          cap = JSON.parse(fs.readFileSync(path.join(CAPTURES, f), "utf8"));
        } catch (e) {
          // A recorder writing into this directory while the suite runs is
          // normal -- a capture can appear in readdir and be gone, or half
          // written, a millisecond later. That is not a finding about the
          // widget, and crashing the whole gate over it turns a race into a
          // red build nobody can reproduce.
          //
          // Announced, never silent: an unreadable capture is evidence we did
          // NOT read, and a directory that is unreadable every run has to be
          // visible rather than quietly skipped.
          if (e.code === "ENOENT") {
            console.warn(`  ! ${f}: vanished mid-run (a recorder is writing here) -- skipped`);
          } else {
            out.push({ fixture: `capture:${f}`, rule: "capture-unreadable",
              detail: `capture on disk could not be parsed (${e.message}) -- `
                + "it verifies nothing until it is re-recorded" });
          }
          return;
        }
        auditCaptureParity(cap, sets, CARD_TYPES)
          .forEach((x) => out.push({ fixture: `capture:${f}`, ...x }));
      });
  }
  return out;
}

// (card, key) pairs, deduped -- the doc classifies a key once, not once per
// fixture that happens to carry it.
function unreadPairs(findings) {
  const seen = new Set();
  findings.forEach((f) => {
    const m = /(\w+) carries '([a-z_]+)'/.exec(f.detail);
    if (m) seen.add(`${m[1]}|${m[2]}`);
  });
  return seen;
}

describe("branchFor / keysRead", () => {
  const SRC = `
    } else if (ev.type === 'alpha_card') {
      pushCard(normalizeAlpha(ev, opts));
    } else if (ev.type === 'beta_card') {
      pushCard({ type: 'beta_card', b: ev.beta_key });
    }
function normalizeAlpha(ev) { return { a: ev.alpha_key, c: ev['bracket_key'] }; }
  `;   // the helper sits at top level, as it does in the real renderer -- that
       // is the boundary branchFor stops the LAST branch at, so it cannot
       // swallow every helper below it and read as covering keys it never
       // touches.

  test("a delegating branch counts the normalizer's reads as its own", () => {
    // Without this, every card that delegates would look like it reads nothing
    // and the audit would report the whole widget as broken -- a check that is
    // wrong the same way every time is one nobody reads.
    expect(keysRead(branchFor(SRC, "alpha_card")).has("alpha_key")).toBe(true);
  });

  test("bracket access counts as a read", () => {
    expect(keysRead(branchFor(SRC, "alpha_card")).has("bracket_key")).toBe(true);
  });

  test("branches do not bleed into each other -- that is the whole point", () => {
    // `after_yaml` is read by patch_proposal, which is exactly why the
    // enhancement_offer bug survived a file-wide read set.
    expect(keysRead(branchFor(SRC, "beta_card")).has("alpha_key")).toBe(false);
  });

  test("a card type with no branch at all is null, not an empty pass", () => {
    expect(branchFor(SRC, "gamma_card")).toBeNull();
  });
});

describe("auditKeyParity", () => {
  const sets = { demo_card: new Set(["known"]) };
  const fixture = (frame) => ({ responses: [{ action: "chat_turn",
    response: { transcript: [Object.assign({ type: "demo_card" }, frame)] } }] });

  test("a key nothing reads fires", () => {
    const f = auditKeyParity(fixture({ known: 1, ghost: 2 }), sets, ["demo_card"]);
    expect(f.map((x) => x.rule)).toEqual(["card-key-nothing-reads"]);
    expect(f[0].detail).toContain("'ghost'");
  });

  test("a card whose keys are all read is silent", () => {
    expect(auditKeyParity(fixture({ known: 1 }), sets, ["demo_card"])).toEqual([]);
  });

  test("threading keys are not display keys and do not fire", () => {
    expect(auditKeyParity(fixture({ known: 1, preceding_tool_use_id: "tu-1" }),
      sets, ["demo_card"])).toEqual([]);
  });

  test("a card type the renderer cannot render at all fires distinctly", () => {
    const f = auditKeyParity(fixture({ known: 1 }), { demo_card: null }, ["demo_card"]);
    expect(f.map((x) => x.rule)).toEqual(["card-type-the-widget-cannot-render"]);
  });
});

describe("the real fixtures against the real renderer", () => {
  const findings = realFindings();
  const rows = docRows();

  test("the subject sets are non-empty -- nothing graded is not a pass", () => {
    expect(rows.length).toBeGreaterThan(0);
    expect(fs.readdirSync(FIXTURES).filter((f) => f.endsWith(".json")).length)
      .toBeGreaterThan(30);
  });

  test("every unread key is classified in CARD_KEY_PARITY.md", () => {
    const listed = new Set(rows.map((r) => `${r.card}|${r.key}`));
    const unlisted = [...unreadPairs(findings)].filter((p) => !listed.has(p)).sort();
    expect(unlisted).toEqual([]);
  });

  test("no row outlives what it explains", () => {
    // A key that is read again, or a fixture that stopped sending it, leaves a
    // row describing a state that no longer exists -- the dead-waiver shape.
    const unread = unreadPairs(findings);
    const stale = rows.map((r) => `${r.card}|${r.key}`)
      .filter((p) => !unread.has(p)).sort();
    expect(stale).toEqual([]);
  });

  test("every row carries a reason", () => {
    expect(rows.filter((r) => !r.reason).map((r) => r.key)).toEqual([]);
  });

  test("no card type is unrenderable", () => {
    expect(findings.filter((f) => f.rule === "card-type-the-widget-cannot-render"))
      .toEqual([]);
  });

  test("the enhancement offer carries the keys the producer actually sends", () => {
    // The specific regression: `after_yaml` + `diff` (a fixture invention)
    // against `final_yaml` + `steps_*` (what emit_enhancement_offer emits). The
    // card's purpose is carrying the verified bytes.
    const uc = JSON.parse(fs.readFileSync(
      path.join(FIXTURES, "unrequested_change.json"), "utf8"));
    const card = uc.responses.flatMap((r) => ((r.response || {}).transcript) || [])
      .find((f) => f.type === "enhancement_offer");
    expect(Object.keys(card)).toEqual(expect.arrayContaining(
      ["final_yaml", "steps_modified", "verified_id"]));
    expect(card.after_yaml).toBeUndefined();
  });
});
