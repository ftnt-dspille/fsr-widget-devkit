"use strict";
// Reusable "mount a widget + ask a visual/DOM question about it" helper.
//
// This is Layer 2 of SOAR_TEST_KIT_DESIGN.md §4.2 — the piece that was designed
// but never built. Before this, every spec (and every ad-hoc agent check)
// re-derived the same harness-driving foot-guns:
//   - the harness `#widget-select` is display:none (a custom dropdown drives it),
//     so Playwright's `selectOption` fails "element is not visible";
//   - picking a widget persists to localStorage and does `location.reload()`,
//     so the next `page.evaluate` dies "Execution context was destroyed" unless
//     you wait for the navigation;
//   - `networkidle` never settles (the harness holds an SSE connection open).
// All three are owned here so callers never see them again.
//
// Two consumers share this module:
//   - committed Playwright specs (import `mountWidget` + the measure helpers);
//   - the one-shot CLI `scripts/widget-inspect.js` (mount → measure → JSON).
//
// Usage (spec):
//   const { mountWidget } = require("./_widgetHarness");
//   const w = await mountWidget(page, "jsonToGrid");
//   expect(await w.rowCount(".ui-grid-row")).toBe(12);
//   expect(await w.clippedBy(".ui-select-choices", ".harness-modal")).toMatchObject({ clipped: false });

/**
 * Mount a widget in the harness by name and resolve once it has finished
 * bootstrapping (or rendered its error panel). Returns a small object whose
 * methods are the measure/interaction helpers bound to `page`.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} name  widget folder name, e.g. "jsonToGrid" (NOT the id with version)
 * @param {{ navigate?: boolean, timeout?: number, config?: object }} [opts]
 *   config: seed the widget's saved config (localStorage `harness:config:<id>`)
 *   before mount, so a widget that would otherwise show the "configure me"
 *   prompt renders its real content deterministically — no live box needed.
 */
async function mountWidget(page, name, opts = {}) {
  const timeout = opts.timeout || 20000;
  if (opts.navigate !== false) {
    // domcontentloaded, NOT networkidle (the harness SSE keeps the page busy).
    await page.goto("/", { waitUntil: "domcontentloaded" });
  }
  // Resolve the versioned widget id (e.g. jsonToGrid-1.3.2) from the harness API
  // so callers pass the stable folder name, not a version that drifts on bump.
  const resp = await page.request.get("/_fsr/widgets");
  const { widgets } = await resp.json();
  const match = widgets.find((w) => w.name === name || w.id === name);
  if (!match) {
    const names = widgets.map((w) => w.name).join(", ");
    throw new Error(`mountWidget: widget "${name}" not found. Available: ${names}`);
  }
  // Seed saved config BEFORE the select-change reload so the fresh load reads it
  // and mounts the configured widget rather than the config prompt. Key format
  // mirrors harnessUtils.configStorageKey: `harness:config:<id>`.
  if (opts.config) {
    await page.evaluate(
      ([id, cfg]) => localStorage.setItem(`harness:config:${id}`, JSON.stringify(cfg)),
      [match.id, opts.config]
    );
  }
  // #widget-select is display:none (custom dropdown is the visible control), so
  // set the value + dispatch `change` directly. The harness change handler
  // persists to localStorage and `location.reload()`s — wait for that nav so the
  // caller sees the mounted widget, not the pre-reload page.
  await Promise.all([
    page.waitForLoadState("domcontentloaded"),
    page.evaluate((id) => {
      const sel = document.getElementById("widget-select");
      sel.value = id;
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    }, match.id),
  ]);
  // Settle on the harness's own mount signal. __HARNESS_MOUNTING flips true→false
  // around angular.bootstrap; we wait for "not mid-mount" (!== true) rather than
  // "=== false" because an unconfigured widget never mounts — it renders a
  // "configure this widget" prompt and the flag stays undefined. The settled
  // states are: a mounted widget root ([ng-controller]), that config prompt
  // (.harness-config-prompt), or a render-error panel. We must explicitly
  // EXCLUDE the transient "loading…" placeholder (.harness-empty) the host shows
  // between the select-change reload and mount — it has child content but isn't
  // settled. Polling this state — not a fixed timeout — is what the design doc
  // mandates.
  await page.waitForFunction(
    () => {
      if (window.__HARNESS_MOUNTING === true) return false;
      const host = document.querySelector("#widget-host");
      if (!host || host.childElementCount === 0) return false;
      if (host.querySelector(".harness-empty")) return false; // still loading
      // Config prompt or render-error panel = settled, no widget to wait on.
      if (host.querySelector(".harness-config-prompt")) return true;
      const ctrl = host.querySelector("[ng-controller]");
      if (!ctrl) return true; // error panel / other terminal content
      // The widget root is loaded via ng-include — until its template renders,
      // the wrapper holds only a placeholder comment (childElementCount 0). Wait
      // for the view's actual element children to appear.
      return ctrl.childElementCount > 0;
    },
    undefined,
    { timeout }
  );
  return makeHandle(page, match);
}

function makeHandle(page, match) {
  return {
    id: match.id,
    name: match.name,
    page,
    renderError: () => renderError(page),
    box: (sel) => box(page, sel),
    count: (sel) => count(page, sel),
    rowCount: (sel) => count(page, sel),
    style: (sel, prop) => style(page, sel, prop),
    text: (sel) => text(page, sel),
    visible: (sel) => visible(page, sel),
    clippedBy: (childSel, ancestorSel) => clippedBy(page, childSel, ancestorSel),
    click: (sel) => page.locator(sel).first().click(),
    clickText: (t) => clickText(page, t),
    settle: () => settle(page),
    openEditModal: () => openEditModal(page),
  };
}

// ----- measurement primitives (one-shot reads; pure functions of a page) -----

/** Bounding box of the first match, rounded, or null if absent. */
async function box(page, sel) {
  return page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const round = (n) => Math.round(n);
    return {
      x: round(r.x), y: round(r.y),
      width: round(r.width), height: round(r.height),
      top: round(r.top), right: round(r.right),
      bottom: round(r.bottom), left: round(r.left),
    };
  }, sel);
}

/** Number of elements matching the selector. */
async function count(page, sel) {
  return page.evaluate((s) => document.querySelectorAll(s).length, sel);
}

/** Computed style value of a property on the first match (null if absent). */
async function style(page, sel, prop) {
  return page.evaluate(
    ([s, p]) => {
      const el = document.querySelector(s);
      return el ? getComputedStyle(el).getPropertyValue(p) || getComputedStyle(el)[p] : null;
    },
    [sel, prop]
  );
}

/** Trimmed textContent of the first match (null if absent). */
async function text(page, sel) {
  return page.evaluate((s) => {
    const el = document.querySelector(s);
    return el ? (el.textContent || "").trim() : null;
  }, sel);
}

/** Whether the first match is rendered and has non-zero size. */
async function visible(page, sel) {
  return page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
  }, sel);
}

/** The harness render-error panel text, or null if the widget mounted cleanly. */
async function renderError(page) {
  return page.evaluate(() => {
    const e = window.__HARNESS_RENDER_ERROR;
    if (!e) return null;
    return typeof e === "string" ? e : e.message || JSON.stringify(e);
  });
}

/**
 * Is `childSel` visually clipped by `ancestorSel`? "Clipped" = the ancestor has
 * a clipping overflow (anything but `visible`) AND the child's box extends past
 * the ancestor's box on some edge. This is the dropdown-past-the-modal check.
 * Returns the geometry + which edges overflow so callers can assert precisely.
 */
async function clippedBy(page, childSel, ancestorSel) {
  return page.evaluate(
    ([cs, as]) => {
      const child = document.querySelector(cs);
      const anc = document.querySelector(as);
      if (!child || !anc) return { clipped: null, reason: "selector-not-found", child: !!child, ancestor: !!anc };
      const c = child.getBoundingClientRect();
      const a = anc.getBoundingClientRect();
      const overflow = getComputedStyle(anc).overflow;
      const round = (n) => Math.round(n);
      const edges = {
        below: c.bottom > a.bottom + 1,
        above: c.top < a.top - 1,
        right: c.right > a.right + 1,
        left: c.left < a.left - 1,
      };
      const overflows = edges.below || edges.above || edges.right || edges.left;
      // Only an overflow that CLIPS (auto/hidden/scroll/clip) actually hides the
      // child. overflow:visible lets it spill, so it's not clipped.
      const clips = overflow !== "visible";
      return {
        clipped: clips && overflows,
        ancestorOverflow: overflow,
        edges,
        childBox: { top: round(c.top), bottom: round(c.bottom), left: round(c.left), right: round(c.right) },
        ancestorBox: { top: round(a.top), bottom: round(a.bottom), left: round(a.left), right: round(a.right) },
      };
    },
    [childSel, ancestorSel]
  );
}

// ----- thin interaction helpers (the bespoke part stays the caller's job) -----

/** Click the first visible element whose trimmed text contains `t`. */
async function clickText(page, t) {
  const loc = page.locator(`text=${t}`).first();
  await loc.click();
}

/** Open the harness Edit-config modal and wait for it to render. */
async function openEditModal(page) {
  // The harness wires its toolbar button listeners slightly AFTER a widget
  // finishes mounting (the boot continuation that calls addEventListener for
  // #edit-config runs just after our mount signal). So a single click can land
  // before the handler exists. Poll-click instead: a click before the handler
  // attaches is a harmless no-op; once attached, the handler adds `.open` and we
  // stop. State-based, no fixed delay.
  await page.waitForFunction(
    () => {
      const backdrop = document.getElementById("edit-modal-backdrop");
      if (backdrop && backdrop.classList.contains("open")) return true;
      const btn = document.getElementById("edit-config");
      if (btn) btn.click();
      return false;
    },
    undefined,
    { timeout: 15000, polling: 250 }
  );
  // The edit form renders async after the modal opens; settle so it's present
  // before the caller clicks into it.
  await settle(page);
}

/**
 * Wait two animation frames so an Angular digest / CSS layout triggered by a
 * click has flushed before a one-shot measure. This is state-ish (rAF), not a
 * fixed `waitForTimeout`, so it doesn't trip the no-timeout determinism guard.
 */
async function settle(page) {
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  );
}

module.exports = {
  mountWidget,
  box,
  count,
  rowCount: count,
  style,
  text,
  visible,
  renderError,
  clippedBy,
  clickText,
  openEditModal,
  settle,
};
