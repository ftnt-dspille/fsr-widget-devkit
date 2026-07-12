"use strict";
/**
 * DOM structural-skeleton + applied-style capture for the Phase 2 fidelity rig.
 *
 * Node-only (NOT browser-loaded — uses Playwright `Page` + Node `crypto`). The
 * two introspection rigs (scripts/introspect.ts harness side, scripts/introspectSoar.ts
 * SOAR side) each call `captureDom` after a widget mounts, attach the result to
 * their `RenderReport.dom`, and the SOAR rig's `fidelity()` calls
 * `summarizeDomDiff` to populate the real `FidelityDiff.domMismatch` /
 * `styleMismatches`. The hermetic regression gate (scripts/introspect-gate.ts)
 * pins `dom.skeletonHash` against the committed baseline so a widget edit that
 * changes the rendered DOM trips the gate (re-baseline if intended, same as the
 * payload/boot budgets).
 *
 * Design notes (see docs/INTROSPECTION_OPTIMIZATION_PLAN.md §Phase 2):
 *  - The browser-side `page.evaluate` walker stays DUMB (reads tags/classes/
 *    computed styles only); ALL normalization + hashing is Node-side so it is
 *    jest-testable without a browser.
 *  - Two hashes per capture: `skeletonHash` (tag + static classes, ng-* stripped)
 *    and `tagHash` (tag only). Together they distinguish a real branch divergence
 *    (tagHash differs — a different ng-if path, likely mock-vs-real data) from a
 *    class-level divergence (tagHash same, skeletonHash differs — a data-driven
 *    ng-class toggle). Both are informational; neither auto-fails (live tier).
 *  - The applied-style whitelist is INTRINSIC visual properties (which CSS rules
 *    applied), NOT layout-resolved geometry (width/height/margins/position would
 *    mismatch for non-fidelity reasons: harness mounts in #widget-host, SOAR in a
 *    drawer modal of different width).
 *  - Style comparison by path runs only when the tag tree matches (tagHash equal),
 *    because only then does path N on the harness ↔ path N on SOAR refer to the
 *    same element. A divergent tag tree makes path↔element correspondence invalid.
 */

import crypto = require("crypto");
import { Page } from "@playwright/test";
import { DomCapture, DomCaptureNode } from "./types";

/** Intrinsic visual style properties captured per node — reflect which CSS rules
 *  applied, NOT the resulting layout (which is container-dependent and would
 *  mismatch between #widget-host and the SOAR drawer for non-fidelity reasons).
 *  Excluded by design: width/height, top/left/right/bottom, margin and padding,
 *  max/min sizes, transform, position, z-index, overflow, border-width. */
const STYLE_PROPS = [
  "color",
  "background-color",
  "font-size",
  "font-weight",
  "font-family",
  "display",
  "visibility",
  "opacity",
  "text-align",
  "line-height",
  "border-color",
  "border-style",
  "border-radius",
  "box-shadow",
  "cursor",
];

/** Max walk depth (root = depth 0) and per-node child cap. Bounds the capture
 *  cost; a hit is recorded as `capsHit` on the DomCapture and surfaced as a note
 *  (the diff may then be incomplete). */
const MAX_DEPTH = 4;
const MAX_CHILDREN = 32;
/** Cap on emitted style-mismatch strings to bound noise; the full count is
 *  reported in a note regardless. */
const STYLE_MISMATCH_CAP = 24;
const STYLE_VAL_TRUNC = 40;

/** Walk the subtree rooted at the element matching `rootSelector` and capture a
 *  DomCapture (nodes + skeleton/tag hashes). Returns `undefined` when the
 *  selector doesn't resolve (defensive — the widget root may be absent in some
 *  render states; the caller treats that as "no DOM capture"). */
async function captureDom(
  page: Page,
  rootSelector: string,
  styleProps: string[] = STYLE_PROPS,
  timeout = 5000,
): Promise<DomCapture | undefined> {
  // Wait briefly for the root to be ATTACHED before walking. A drawer/modal
  // widget's controller global (the rig's mountProbe) can resolve BEFORE ng-include
  // finishes linking the view template into the DOM — so a capture fired right
  // after the probe would miss the root. `state: "attached"` (NOT "visible"):
  // drawer widgets render in a `#widget-host` that is `display:none` while
  // `drawer-hidden` (public/index.html), and the skeleton/style capture is about
  // STRUCTURE, not on-screen visibility — a hidden-but-attached subtree is exactly
  // what we want to diff. Up to 5s for ng-include to complete; if it never
  // attaches, treat as "no DOM capture".
  try {
    await page.waitForSelector(rootSelector, { state: "attached", timeout });
  } catch (_) {
    return undefined;
  }
  // Browser-side: a dumb DFS walker. No Node types, no crypto — just reads.
  // Returns { nodes, capsHit } or null when the selector doesn't resolve.
  const raw = await page.evaluate(
    (args: { rootSelector: string; styleProps: string[]; maxDepth: number; maxChildren: number }) => {
      const root = document.querySelector(args.rootSelector);
      if (!root) return null;
      const nodes: { path: string; tag: string; classes: string[]; styles: Record<string, string> }[] = [];
      let capsHit = false;
      const walk = (el: Element, path: string, depth: number) => {
        const tag = el.tagName.toLowerCase();
        const classes = Array.from(el.classList);
        const styles: Record<string, string> = {};
        const cs = window.getComputedStyle(el);
        for (const p of args.styleProps) styles[p] = cs.getPropertyValue(p);
        nodes.push({ path, tag, classes, styles });
        if (depth + 1 >= args.maxDepth) {
          if (el.children.length > 0) capsHit = true;
          return;
        }
        const kids = el.children;
        if (kids.length > args.maxChildren) capsHit = true;
        const n = Math.min(kids.length, args.maxChildren);
        for (let i = 0; i < n; i++) walk(kids[i], path + "/" + i, depth + 1);
      };
      walk(root, "0", 0);
      return { nodes, capsHit };
    },
    { rootSelector, styleProps, maxDepth: MAX_DEPTH, maxChildren: MAX_CHILDREN },
  );
  if (!raw) return undefined;
  const { skeletonHash, tagHash } = normalizeSkeleton(raw.nodes);
  return {
    rootSelector,
    nodes: raw.nodes,
    skeletonHash,
    tagHash,
    capsHit: raw.capsHit,
  };
}

/** Strip AngularJS runtime classes (`ng-scope`, `ng-binding`, `ng-isolate-scope`,
 *  `ng-hide`, `ng-pristine`, `ng-dirty`, `ng-valid`, `ng-invalid`, `ng-touched`,
 *  `ng-enter`, `ng-leave`, `ng-animate`, …) — Angular adds these at runtime for
 *  state/validation/animation, and they are not part of the widget's authored
 *  structure. Data-driven `ng-class` toggles (non-ng-* classes) are intentionally
 *  KEPT so they surface as a class-level divergence rather than being normalized
 *  away. */
function staticClasses(classes: string[]): string[] {
  return classes.filter((c) => !/^ng-/.test(c)).sort();
}

/** Numeric component-wise path comparator so "0/2" < "0/10" (lexicographic would
 *  reverse them). Makes the hash robust to input order. */
function cmpPath(a: string, b: string): number {
  const pa = a.split("/");
  const pb = b.split("/");
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const da = pa[i] !== undefined ? Number(pa[i]) : -1;
    const db = pb[i] !== undefined ? Number(pb[i]) : -1;
    if (da !== db) return da - db;
  }
  return 0;
}

function sha256(s: string): string {
  return crypto.createHash("sha256").update(s, "utf8").digest("hex");
}

/** Compute the two structural hashes for a captured node set. Pure + deterministic
 *  (sorts by numeric path first, so input order doesn't matter).
 *    skeletonHash — tag + static (non-ng-*) classes per node, in path order.
 *    tagHash      — tag only per node, in path order. */
function normalizeSkeleton(nodes: DomCaptureNode[]): { skeletonHash: string; tagHash: string } {
  const sorted = [...nodes].sort((a, b) => cmpPath(a.path, b.path));
  const skel = sorted.map((n) => [n.tag, staticClasses(n.classes)]);
  const tagOnly = sorted.map((n) => [n.tag]);
  return { skeletonHash: sha256(JSON.stringify(skel)), tagHash: sha256(JSON.stringify(tagOnly)) };
}

function trimVal(v: string): string {
  return v.length > STYLE_VAL_TRUNC ? v.slice(0, STYLE_VAL_TRUNC) + "…" : v;
}

/** Pure diff of two DomCaptures → the fields `fidelity()` folds into FidelityDiff.
 *  - domMismatch: skeletonHash differs (structure OR a static class changed).
 *  - divergence kind is distinguished via tagHash (branch vs class-level).
 *  - style comparison runs only when the tag tree matches (path↔element valid).
 *  Handles the "no DOM on one side" cases with explicit notes so a weak/absent
 *  baseline never reads as a mismatch. */
function summarizeDomDiff(
  harnessDom: DomCapture | undefined,
  soarDom: DomCapture | undefined,
): { domMismatch: boolean; styleMismatches: string[]; notes: string[] } {
  const notes: string[] = [];
  const styleMismatches: string[] = [];

  if (!harnessDom || !soarDom) {
    if (!harnessDom && !soarDom) {
      notes.push("no DOM capture for this widget (profile has no domRoot) — DOM/style diff N/A");
    } else if (!harnessDom) {
      notes.push("DOM/style diff unavailable: no harness DOM capture (rig didn't mount this widget or profile has no domRoot)");
    } else {
      notes.push("DOM/style diff unavailable: no SOAR DOM capture (widget didn't mount on the box)");
    }
    return { domMismatch: false, styleMismatches, notes };
  }

  const structMismatch = harnessDom.skeletonHash !== soarDom.skeletonHash;
  const tagMismatch = harnessDom.tagHash !== soarDom.tagHash;

  if (tagMismatch) {
    notes.push("structural divergence — different element branches (likely viewState/mock-vs-real data, not a harness bug; inspect ng-if branches)");
  } else if (structMismatch) {
    notes.push("class-level divergence — likely a data-driven ng-class toggle (mock vs real data)");
  } else {
    notes.push("DOM structure parity ok (skeleton + tag hashes match)");
  }

  if (harnessDom.capsHit || soarDom.capsHit) {
    notes.push(`DOM capture caps applied — diff may be incomplete (depth ${MAX_DEPTH} / child ${MAX_CHILDREN} truncation)`);
  }

  // Style comparison by path is only valid when the tag tree matches — otherwise
  // path N on the harness and path N on SOAR refer to different elements.
  if (!tagMismatch) {
    const hByPath = new Map(harnessDom.nodes.map((n) => [n.path, n]));
    let count = 0;
    const identityDivergences: string[] = [];
    for (const sn of soarDom.nodes) {
      const hn = hByPath.get(sn.path);
      if (!hn) continue;
      // Element-identity gate: if the STATIC (non-ng-*) classes differ at this
      // path, harness and SOAR rendered DIFFERENT elements into the same slot
      // (e.g. a build-hint panel vs a quick-actions panel driven by mock-vs-real
      // data). Their styles will differ trivially because they ARE different
      // elements — that is NOT a fidelity mismatch. Collect those paths apart
      // and skip their style comparison so the real style-signal isn't muddied.
      const hStatic = staticClasses(hn.classes);
      const sStatic = staticClasses(sn.classes);
      if (hStatic.join(" ") !== sStatic.join(" ")) {
        identityDivergences.push(
          `${sn.path}: harness=${hn.tag}.${hStatic.join(".") || "(none)"} soar=${sn.tag}.${sStatic.join(".") || "(none)"}`,
        );
        continue;
      }
      for (const prop of STYLE_PROPS) {
        const hv = hn.styles[prop] || "";
        const sv = sn.styles[prop] || "";
        if (hv !== sv) {
          if (styleMismatches.length < STYLE_MISMATCH_CAP) {
            styleMismatches.push(`${sn.path}: ${prop} harness="${trimVal(hv)}" soar="${trimVal(sv)}"`);
          }
          count++;
        }
      }
    }
    if (identityDivergences.length) {
      const shown = identityDivergences.slice(0, STYLE_MISMATCH_CAP);
      notes.push(
        `${identityDivergences.length} element-identity divergence(s) (different elements at same path — ` +
        `data-driven branch, style diffs expected, not a harness bug): ${shown.join("; ")}` +
        (identityDivergences.length > shown.length ? ` (+${identityDivergences.length - shown.length} more)` : ""),
      );
    }
    if (count > 0) {
      const shown = Math.min(count, STYLE_MISMATCH_CAP);
      notes.push(`${count} applied-style mismatch(es) on same-identity paths${shown < count ? ` (showing first ${shown})` : ""}`);
    } else if (!identityDivergences.length) {
      notes.push("applied-style parity ok (no whitelisted-property differences on shared paths)");
    } else {
      notes.push("applied-style parity ok on same-identity paths (mismatches were only on element-identity-divergent paths)");
    }
  } else {
    notes.push("applied-style comparison skipped (tag tree diverges — path↔element correspondence invalid)");
  }

  return { domMismatch: structMismatch, styleMismatches, notes };
}

export = { STYLE_PROPS, MAX_DEPTH, MAX_CHILDREN, captureDom, staticClasses, normalizeSkeleton, summarizeDomDiff };
