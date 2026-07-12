"use strict";
/**
 * Pure-function tests for lib/domCapture.ts (Phase 2 DOM/style fidelity).
 *
 * Mirrors the harnessUtils.test.js pattern: require the module, exercise the
 * pure helpers (staticClasses, normalizeSkeleton, summarizeDomDiff) with
 * synthetic DomCaptureNode arrays — no browser, no Playwright. `captureDom`
 * itself (the page.evaluate wrapper) is validated end-to-end by `make
 * introspect` / `make introspect-soar`, consistent with how the other rig
 * scripts aren't browser-jest-tested.
 *
 * NOTE: the compiled lib/domCapture.js is the test target (ts-jest resolves it
 * ahead of the .ts), so rebuild (`pnpm build`) after editing the .ts before
 * re-running this suite.
 */
const {
  STYLE_PROPS,
  staticClasses,
  normalizeSkeleton,
  summarizeDomDiff,
} = require("../lib/domCapture");

// --- fixtures ----------------------------------------------------------------

/** Build a DomCaptureNode with a default empty style map. */
function node(path, tag, classes, styles) {
  return { path, tag, classes: classes || [], styles: styles || {} };
}

/** Assemble a DomCapture from raw nodes (hashes computed via normalizeSkeleton),
 *  so the diff operates on real hashes. */
function makeDom(nodes, opts) {
  const o = opts || {};
  const { skeletonHash, tagHash } = normalizeSkeleton(nodes);
  return {
    rootSelector: o.rootSelector || "[data-testid=fsr-pb-root]",
    nodes,
    skeletonHash,
    tagHash,
    capsHit: o.capsHit || false,
  };
}

const STYLES_OK = {
  color: "rgb(0, 0, 0)",
  "background-color": "rgba(0, 0, 0, 0)",
  "font-size": "14px",
  "font-weight": "400",
  "font-family": "Lato",
  display: "block",
  visibility: "visible",
  opacity: "1",
  "text-align": "left",
  "line-height": "20px",
  "border-color": "rgb(0, 0, 0)",
  "border-style": "none",
  "border-radius": "0px",
  "box-shadow": "none",
  cursor: "default",
};

// --- staticClasses -----------------------------------------------------------

describe("staticClasses", () => {
  test("strips ng-* runtime classes and sorts the rest", () => {
    expect(staticClasses(["b", "ng-scope", "a", "ng-isolate-scope", "ng-binding"])).toEqual(["a", "b"]);
  });

  test("keeps data-driven (non-ng) classes", () => {
    expect(staticClasses(["active", "ng-dirty", "selected"])).toEqual(["active", "selected"]);
  });

  test("returns empty when every class is ng-*", () => {
    expect(staticClasses(["ng-scope", "ng-pristine"])).toEqual([]);
  });
});

// --- normalizeSkeleton -------------------------------------------------------

describe("normalizeSkeleton", () => {
  const tree = [
    node("0", "div", ["fsr-pb-widget", "ng-scope"], STYLES_OK),
    node("0/0", "button", ["ghost", "ng-binding"], STYLES_OK),
    node("0/1", "span", [], STYLES_OK),
  ];

  test("hash is stable for an identical structure", () => {
    const a = normalizeSkeleton(tree);
    const b = normalizeSkeleton(tree.map((n) => ({ ...n })));
    expect(a.skeletonHash).toBe(b.skeletonHash);
    expect(a.tagHash).toBe(b.tagHash);
    expect(a.skeletonHash).not.toBe("");
    expect(a.tagHash).not.toBe("");
  });

  test("robust to input order (same nodes, shuffled → same hashes)", () => {
    const ordered = normalizeSkeleton(tree);
    const shuffled = normalizeSkeleton([tree[2], tree[0], tree[1]]);
    expect(shuffled.skeletonHash).toBe(ordered.skeletonHash);
    expect(shuffled.tagHash).toBe(ordered.tagHash);
  });

  test("skeletonHash changes when a branch is added", () => {
    const base = normalizeSkeleton(tree);
    const withBranch = normalizeSkeleton([...tree, node("0/2", "aside", [], STYLES_OK)]);
    expect(withBranch.skeletonHash).not.toBe(base.skeletonHash);
    expect(withBranch.tagHash).not.toBe(base.tagHash);
  });

  test("skeletonHash changes when a tag changes", () => {
    const base = normalizeSkeleton(tree);
    const swapped = normalizeSkeleton([node("0", "section", ["fsr-pb-widget", "ng-scope"], STYLES_OK), tree[1], tree[2]]);
    expect(swapped.skeletonHash).not.toBe(base.skeletonHash);
    expect(swapped.tagHash).not.toBe(base.tagHash);
  });

  test("skeletonHash is UNCHANGED by an ng-* class toggle (data-driven state)", () => {
    const base = normalizeSkeleton(tree);
    const withNg = normalizeSkeleton([
      node("0", "div", ["fsr-pb-widget", "ng-scope", "ng-dirty", "ng-valid"], STYLES_OK),
      tree[1],
      tree[2],
    ]);
    expect(withNg.skeletonHash).toBe(base.skeletonHash);
    expect(withNg.tagHash).toBe(base.tagHash);
  });

  test("skeletonHash changes when a static (non-ng) class changes", () => {
    const base = normalizeSkeleton(tree);
    const withCls = normalizeSkeleton([
      node("0", "div", ["fsr-pb-widget", "ng-scope", "active"], STYLES_OK),
      tree[1],
      tree[2],
    ]);
    expect(withCls.skeletonHash).not.toBe(base.skeletonHash);
    // tagHash ignores classes entirely → unchanged.
    expect(withCls.tagHash).toBe(base.tagHash);
  });

  test("tagHash ignores all class differences (only tags + tree shape matter)", () => {
    const a = normalizeSkeleton([node("0", "div", ["x", "y"], STYLES_OK)]);
    const b = normalizeSkeleton([node("0", "div", ["p", "q", "r"], STYLES_OK)]);
    expect(a.tagHash).toBe(b.tagHash);
    expect(a.skeletonHash).not.toBe(b.skeletonHash);
  });
});

// --- summarizeDomDiff --------------------------------------------------------

describe("summarizeDomDiff", () => {
  test("identical DOM → no mismatch, parity notes, no style mismatches", () => {
    const dom = makeDom([
      node("0", "div", ["fsr-pb-widget"], STYLES_OK),
      node("0/0", "button", ["ghost"], STYLES_OK),
    ]);
    const d = summarizeDomDiff(dom, makeDom(dom.nodes.map((n) => ({ ...n, classes: [...n.classes], styles: { ...n.styles } }))));
    expect(d.domMismatch).toBe(false);
    expect(d.styleMismatches).toEqual([]);
    expect(d.notes.join(" ")).toMatch(/structure parity ok/);
    expect(d.notes.join(" ")).toMatch(/applied-style parity ok/);
  });

  test("class-only divergence (same tags, different static class) → domMismatch true, class-level note", () => {
    const harness = makeDom([node("0", "div", ["fsr-pb-widget"], STYLES_OK)]);
    const soar = makeDom([node("0", "div", ["fsr-pb-widget", "active"], STYLES_OK)]);
    const d = summarizeDomDiff(harness, soar);
    expect(d.domMismatch).toBe(true);
    expect(d.notes.join(" ")).toMatch(/class-level divergence/);
  });

  test("branch divergence (different tags) → domMismatch true, structural note, style comparison skipped", () => {
    const harness = makeDom([node("0", "div", ["fsr-pb-widget"], STYLES_OK), node("0/0", "button", [], STYLES_OK)]);
    const soar = makeDom([node("0", "div", ["fsr-pb-widget"], STYLES_OK), node("0/0", "a", [], STYLES_OK)]);
    const d = summarizeDomDiff(harness, soar);
    expect(d.domMismatch).toBe(true);
    expect(d.notes.join(" ")).toMatch(/structural divergence/);
    expect(d.notes.join(" ")).toMatch(/applied-style comparison skipped/);
    // No path↔element correspondence → no style mismatches emitted.
    expect(d.styleMismatches).toEqual([]);
  });

  test("style divergence reported ONLY for whitelisted props; excluded props ignored", () => {
    const harness = makeDom([node("0", "div", ["w"], STYLES_OK)]);
    // Same structure (same skeleton + tag hashes) but color differs (whitelisted).
    const soarStyles = { ...STYLES_OK, color: "rgb(255, 0, 0)" };
    const soar = makeDom([node("0", "div", ["w"], soarStyles)]);
    const d = summarizeDomDiff(harness, soar);
    expect(d.domMismatch).toBe(false); // structure matches
    expect(d.styleMismatches.length).toBe(1);
    expect(d.styleMismatches[0]).toMatch(/color/);

    // An EXCLUDED prop stuffed into the styles map is ignored (summarize iterates
    // STYLE_PROPS, not the styles keys).
    const harnessW = makeDom([node("0", "div", ["w"], { ...STYLES_OK, width: "100px" })]);
    const soarW = makeDom([node("0", "div", ["w"], { ...STYLES_OK, width: "999px" })]);
    const dW = summarizeDomDiff(harnessW, soarW);
    expect(dW.styleMismatches).toEqual([]); // width is not whitelisted → ignored
  });

  test("capsHit on either side surfaces a truncation note", () => {
    const dom = makeDom([node("0", "div", [], STYLES_OK)], { capsHit: true });
    const dom2 = makeDom([node("0", "div", [], STYLES_OK)]);
    expect(summarizeDomDiff(dom, dom2).notes.join(" ")).toMatch(/capture caps applied/);
    expect(summarizeDomDiff(dom2, dom).notes.join(" ")).toMatch(/capture caps applied/);
  });

  test("element-identity divergence (different static class at same path) is NOT a style mismatch", () => {
    // Same tag tree (tagHash matches) but path 0/0 is build-hint on harness vs
    // quick-actions on soar — two DIFFERENT elements in the same slot. Their
    // styles differ trivially because they are different elements; that must
    // surface as an element-identity divergence, NOT count as a style mismatch.
    const redStyles = { ...STYLES_OK, color: "rgb(255, 0, 0)", "border-radius": "10px" };
    const harness = makeDom([
      node("0", "div", ["fsr-pb-widget"], STYLES_OK),
      node("0/0", "div", ["build-hint"], redStyles),
    ]);
    const soar = makeDom([
      node("0", "div", ["fsr-pb-widget"], STYLES_OK),
      node("0/0", "div", ["quick-actions"], { ...STYLES_OK, color: "rgb(0,0,0)", "border-radius": "0px" }),
    ]);
    const d = summarizeDomDiff(harness, soar);
    expect(d.domMismatch).toBe(true); // skeletonHash differs (build-hint vs quick-actions)
    expect(d.styleMismatches).toEqual([]); // different elements → no style mismatch
    const noteText = d.notes.join(" ");
    expect(noteText).toMatch(/element-identity divergence/);
    expect(noteText).toMatch(/build-hint/);
    expect(noteText).toMatch(/quick-actions/);
  });

  test("no DOM on either side → no mismatch, explicit N/A note", () => {
    const dom = makeDom([node("0", "div", [], STYLES_OK)]);
    const neither = summarizeDomDiff(undefined, undefined);
    expect(neither.domMismatch).toBe(false);
    expect(neither.notes.join(" ")).toMatch(/no DOM capture for this widget/);

    const noHarness = summarizeDomDiff(undefined, dom);
    expect(noHarness.domMismatch).toBe(false);
    expect(noHarness.notes.join(" ")).toMatch(/no harness DOM capture/);

    const noSoar = summarizeDomDiff(dom, undefined);
    expect(noSoar.domMismatch).toBe(false);
    expect(noSoar.notes.join(" ")).toMatch(/no SOAR DOM capture/);
  });

  test("style mismatches are bounded (cap) but the full count is reported", () => {
    const harnessNodes = [node("0", "div", ["w"], STYLES_OK)];
    // Build a soar tree where every whitelisted prop differs on the root, and
    // add many sibling nodes that also differ — to exceed the mismatch cap.
    const soarNodes = [node("0", "div", ["w"], diffAll(STYLES_OK))];
    for (let i = 0; i < 30; i++) {
      harnessNodes.push(node("0/" + i, "span", [], STYLES_OK));
      soarNodes.push(node("0/" + i, "span", [], diffAll(STYLES_OK)));
    }
    const d = summarizeDomDiff(makeDom(harnessNodes), makeDom(soarNodes));
    // At least one mismatch, and a count note present.
    expect(d.styleMismatches.length).toBeGreaterThan(0);
    expect(d.styleMismatches.length).toBeLessThanOrEqual(24);
    expect(d.notes.join(" ")).toMatch(/applied-style mismatch/);
    expect(d.notes.join(" ")).toMatch(/showing first/);
  });
});

/** Return a copy of styles with every whitelisted prop changed (so each differs). */
function diffAll(styles) {
  const out = { ...styles };
  for (const p of STYLE_PROPS) out[p] = "DIFFERENT-" + p;
  return out;
}
