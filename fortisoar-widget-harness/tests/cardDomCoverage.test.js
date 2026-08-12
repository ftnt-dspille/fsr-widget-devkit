"use strict";
// The gate behind docs/CARD_DOM_COVERAGE.md (#105, Phase 4).
//
// #105 offers two outcomes: five new live DOM specs, or "write down explicitly,
// per card, that 'the frame was emitted' is all we will ever claim." The written
// admission is the cheap one and it is legitimate -- but a hand-maintained
// coverage doc rots exactly like the hand-maintained testpaths list that hid a
// whole 527-test suite. So the doc is checked against two things it cannot
// influence: the renderer's own dispatch chain, and the claims live specs make
// in their own headers.
//
// Every rule below is paired with the case that must silence it.

const fs = require("fs");
const path = require("path");
const {
  dispatchTypes, claimsFromSpec, parseRegistry, reconcile,
} = require("./live/lib/cardDomCoverage");

const HARNESS = path.join(__dirname, "..");
const WIDGET = path.join(HARNESS, "..", "widgets-src", "fortiaiAgenticAssistant");
const RENDERER = path.join(WIDGET, "widget", "widgetAssets", "js", "fsrPbRender.ts");
const REGISTRY = path.join(HARNESS, "docs", "CARD_DOM_COVERAGE.md");

// Live specs live in two places: the harness's own tests/live/*.live.test.js and
// the widget's playwright specs matching *[Ll]ive*.spec.js (the same pattern
// playwright's testIgnore uses to hide them without E2E_LIVE).
function liveSpecFiles() {
  const out = [];
  const liveDir = path.join(HARNESS, "tests", "live");
  if (fs.existsSync(liveDir)) {
    fs.readdirSync(liveDir).filter((f) => f.endsWith(".live.test.js"))
      .forEach((f) => out.push(path.join(liveDir, f)));
  }
  const e2e = path.join(WIDGET, "tests", "e2e");
  if (fs.existsSync(e2e)) {
    fs.readdirSync(e2e).filter((f) => /[Ll]ive.*\.spec\.js$/.test(f))
      .forEach((f) => out.push(path.join(e2e, f)));
  }
  return out;
}

describe("dispatchTypes reads the renderer, not a list someone maintains", () => {
  test("finds a card type from the ordinary branch", () => {
    expect(dispatchTypes("if (ev.type === 'choice_card') {")).toEqual(["choice_card"]);
  });

  test("finds the (ev as any) branch too -- enhancement_offer hides there", () => {
    // enhancement_offer is not in the RenderEvent union, so a checker reading
    // the union would miss a card the analyst can click.
    expect(dispatchTypes("} else if ((ev as any).type === 'enhancement_offer') {"))
      .toEqual(["enhancement_offer"]);
  });

  test("a chained branch yields every type in it", () => {
    expect(dispatchTypes(
      "if (ev.type === 'status_card' || ev.type === 'info_card') {"))
      .toEqual(["status_card", "info_card"]);
  });

  test("the real renderer yields the cards #105 names", () => {
    const types = dispatchTypes(fs.readFileSync(RENDERER, "utf8"));
    for (const t of ["approval_request", "manual_input", "action_card",
      "choice_card", "playbook_offer", "patch_proposal", "enhancement_offer",
      "capability_gap"]) {
      expect(types).toContain(t);
    }
  });
});

describe("claimsFromSpec", () => {
  test("reads a declared claim", () => {
    expect(claimsFromSpec("// @covers-card-live: approval_request, manual_input"))
      .toEqual(["approval_request", "manual_input"]);
  });

  test("a spec that merely mentions a card id claims nothing", () => {
    // Inferring coverage from selectors would credit a spec for a card it only
    // names in a comment. The claim is a judgment its author has to sign.
    expect(claimsFromSpec("page.locator('[data-testid=\"choice_card-1\"]')")).toEqual([]);
  });
});

describe("reconcile", () => {
  const base = {
    types: ["approval_request", "action_card", "text"],
    claims: ["approval_request"],
    registry: [
      { type: "approval_request", tier: "live-dom", note: "spec X" },
      { type: "action_card", tier: "hermetic-only", note: "not claimed live" },
      { type: "text", tier: "not-a-card", note: "prose" },
    ],
  };

  test("a fully classified renderer is silent", () => {
    expect(reconcile(base)).toEqual([]);
  });

  test("a NEW card type the registry has never heard of fires", () => {
    // The reason this file exists: coverage docs go stale by addition, not by
    // edit. Nobody deletes a row; a card just shows up.
    const f = reconcile({ ...base, types: [...base.types, "escalation_card"] });
    expect(f.map((x) => x.rule)).toEqual(["unclassified-card-type"]);
  });

  test("live-dom with no spec claiming it fires", () => {
    // A registry that can promote itself says whatever its author last hoped.
    const f = reconcile({ ...base, claims: [] });
    expect(f.map((x) => x.rule)).toEqual(["live-dom-without-a-spec"]);
  });

  test("a spec proving MORE than the doc admits fires too", () => {
    // Understating coverage is how a written gap survives past its truth: the
    // doc keeps saying "we never proved this" long after someone did.
    const f = reconcile({ ...base, claims: ["approval_request", "action_card"] });
    expect(f.map((x) => x.rule)).toEqual(["spec-covers-more-than-the-registry-admits"]);
  });

  test("a row for a card the renderer dropped fires", () => {
    const f = reconcile({ ...base,
      registry: [...base.registry, { type: "old_card", tier: "not-a-card", note: "x" }] });
    expect(f.map((x) => x.rule)).toEqual(["registry-row-for-a-dead-type"]);
  });

  test("a typo'd claim is not silently credited", () => {
    const f = reconcile({ ...base, claims: ["approval_request", "aproval_request"] });
    expect(f.map((x) => x.rule)).toEqual(["spec-claims-a-nonexistent-card"]);
  });

  test("a classification with no reason fires -- the reason IS the deliverable", () => {
    const registry = base.registry.map((r) => (r.type === "action_card"
      ? { ...r, note: "" } : r));
    expect(reconcile({ ...base, registry }).map((x) => x.rule))
      .toEqual(["classification-without-a-reason"]);
  });

  test("a tier outside the three fires rather than passing as unknown", () => {
    const registry = base.registry.map((r) => (r.type === "action_card"
      ? { ...r, tier: "partial" } : r));
    expect(reconcile({ ...base, registry }).map((x) => x.rule)).toEqual(["unknown-tier"]);
  });

  test("the same type classified twice fires -- one row is dead", () => {
    const f = reconcile({ ...base,
      registry: [...base.registry, { type: "text", tier: "not-a-card", note: "again" }] });
    expect(f.map((x) => x.rule)).toEqual(["duplicate-registry-row"]);
  });
});

describe("parseRegistry", () => {
  test("reads the table rows and ignores the prose around them", () => {
    const md = "# heading\n\ntext\n\n| type | tier | note |\n|---|---|---|\n"
      + "| `action_card` | hermetic-only | fixture only |\n";
    expect(parseRegistry(md)).toEqual([
      { type: "action_card", tier: "hermetic-only", note: "fixture only" }]);
  });
});

// ── THE GATE ───────────────────────────────────────────────────────────────
describe("the real registry describes the real widget", () => {
  const types = dispatchTypes(fs.readFileSync(RENDERER, "utf8"));
  const specs = liveSpecFiles();
  const claims = specs.flatMap((f) => claimsFromSpec(fs.readFileSync(f, "utf8")));
  const registry = parseRegistry(fs.readFileSync(REGISTRY, "utf8"));

  test("the subject sets are non-empty -- nothing graded is not a pass", () => {
    // A discovery gate whose discovery breaks reports the same clean run as one
    // with nothing wrong. Renamed renderer, moved live specs, moved doc: each
    // has to be a failure, not a silence.
    expect(types.length).toBeGreaterThan(8);
    expect(specs.length).toBeGreaterThan(0);
    expect(claims.length).toBeGreaterThan(0);
    expect(registry.length).toBeGreaterThan(8);
  });

  test("every card type is classified, and every classification is backed", () => {
    expect(reconcile({ types, claims, registry })
      .map((f) => `[${f.rule}] ${f.detail}`)).toEqual([]);
  });

  test("...and it goes red when the renderer grows a card (the mutation proof)", () => {
    // A gate nobody has broken on purpose is a gate nobody knows works.
    const grown = [...types, "escalation_card"];
    expect(reconcile({ types: grown, claims, registry }).map((f) => f.rule))
      .toEqual(["unclassified-card-type"]);
  });

  test("the live-dom rows are exactly what live specs claim", () => {
    // Stated as an equality so a fourth live spec cannot land without the doc
    // moving -- the coverage story stays in one place.
    const live = registry.filter((r) => r.tier === "live-dom").map((r) => r.type).sort();
    expect(live).toEqual([...claims].sort());
  });
});
