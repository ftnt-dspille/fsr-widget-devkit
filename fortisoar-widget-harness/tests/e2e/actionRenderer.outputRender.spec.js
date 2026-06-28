"use strict";
/**
 * HERMETIC render-option matrix for the action-renderer VIEW output.
 *
 * The connector/playbook edit + execute flows are covered live
 * (actionRenderer.connectorFlowLive / .jsonToGridFlowLive). This spec validates
 * the *render layer* — every output mode/style/option — deterministically,
 * without the box: mount with autoExecute:false, hold a fixture result, drive
 * $scope.applyOutput(), and assert the produced DOM.
 *
 * Run: make test-e2e-spec SPEC="actionRenderer.outputRender.spec.js"
 */

const { test, expect } = require("@playwright/test");
const { mountWidget } = require("./_widgetHarness");

const WIDGET = "actionRendererWidget";
const ROOT = "#widget-host [ng-controller]";

// Mount once per test with a held result, then re-render under a given output
// config. Returns the controller's derived render state for cross-checking DOM.
async function renderWith(page, output, result) {
  return page.evaluate(
    ({ rootSel, output, result }) => {
      const el = document.querySelector(rootSel);
      const sc = window.angular.element(el).scope();
      sc.result = result;
      sc.config.output = output;
      // jinja's real path is an async SOAR service; for the render-layer check we
      // inject the resolved html so the assertion stays hermetic + deterministic.
      if (output && output.mode === "jinja") {
        sc.outputMode = "jinja";
        sc.renderedHtml = "<b class='jinja-probe'>OK</b>";
        sc.$apply();
        return { outputMode: sc.outputMode };
      }
      sc.applyOutput();
      sc.$apply();
      return { outputMode: sc.outputMode, headers: sc.tableHeaders, rows: (sc.tableRows || []).length };
    },
    { rootSel: ROOT, output, result }
  );
}

const SAMPLE = [
  { name: "alpha", count: 3, active: true },
  { name: "bravo", count: 17, active: false },
  { name: "charlie", count: 42, active: true },
];

test.describe.configure({ mode: "serial" });

test.describe("action-renderer output render matrix (hermetic)", () => {
  let w;
  test.beforeEach(async ({ page }) => {
    w = await mountWidget(page, WIDGET, {
      config: { title: "AR render", autoExecute: false, source: { kind: "connector" }, output: { mode: "raw" } },
    });
    expect(await w.renderError(), "widget should mount without a render error").toBeFalsy();
  });

  test("raw mode pretty-prints the JSON result", async ({ page }) => {
    await renderWith(page, { mode: "raw" }, SAMPLE);
    expect(await w.count(".action-renderer-result-raw")).toBe(1);
    const txt = await w.text(".action-renderer-result-raw");
    expect(txt).toContain("alpha");
    expect(txt).toContain("\"count\": 17");
  });

  test("table mode: default striped style + one row per item", async ({ page }) => {
    const r = await renderWith(page, { mode: "table", table: {} }, SAMPLE);
    expect(r.rows).toBe(3);
    expect(await w.count(".action-renderer-table-wrap.action-renderer-table-style-striped")).toBe(1);
    expect(await w.count(".action-renderer-table tbody tr")).toBe(3);
    // auto headers = union of object keys
    expect(r.headers).toEqual(expect.arrayContaining(["name", "count", "active"]));
  });

  for (const style of ["plain", "bordered", "compact", "card"]) {
    test(`table style preset: ${style}`, async ({ page }) => {
      await renderWith(page, { mode: "table", table: { style } }, SAMPLE);
      expect(await w.count(`.action-renderer-table-wrap.action-renderer-table-style-${style}`)).toBe(1);
    });
  }

  test("sticky header toggles the sticky class", async ({ page }) => {
    await renderWith(page, { mode: "table", table: { stickyHeader: true } }, SAMPLE);
    expect(await w.count(".action-renderer-table-wrap.action-renderer-table-sticky")).toBe(1);
    await renderWith(page, { mode: "table", table: { stickyHeader: false } }, SAMPLE);
    expect(await w.count(".action-renderer-table-wrap.action-renderer-table-sticky")).toBe(0);
  });

  test("auto alignment: numeric columns align right, text left", async ({ page }) => {
    await renderWith(page, { mode: "table", table: { mode: "auto" } }, SAMPLE);
    // header order is [name, count, active]; count is numeric -> right
    const nameAlign = await w.style(".action-renderer-table tbody tr:first-child td:nth-child(1)", "text-align");
    const countAlign = await w.style(".action-renderer-table tbody tr:first-child td:nth-child(2)", "text-align");
    expect(nameAlign).toBe("left");
    expect(countAlign).toBe("right");
  });

  test("explicit columns: custom headers, order, and alignment", async ({ page }) => {
    const r = await renderWith(
      page,
      {
        mode: "table",
        table: {
          mode: "columns",
          columns: [
            { path: "count", header: "Count", align: "center" },
            { path: "name", header: "Name", align: "left" },
          ],
        },
      },
      SAMPLE
    );
    expect(r.headers).toEqual(["Count", "Name"]);
    expect(await w.count(".action-renderer-table thead th")).toBe(2);
    const firstHeader = await w.text(".action-renderer-table thead th:nth-child(1)");
    expect(firstHeader).toBe("Count");
    const align = await w.style(".action-renderer-table tbody tr:first-child td:nth-child(1)", "text-align");
    expect(align).toBe("center");
  });

  test("empty result shows the configured empty message", async ({ page }) => {
    // Empty message renders when columns are known but no rows resolve — use
    // explicit columns so headers exist (auto-mode on [] yields no headers and
    // shows the 'path did not resolve' warning instead, by design).
    const r = await renderWith(
      page,
      { mode: "table", table: { mode: "columns", columns: [{ path: "name", header: "Name" }], emptyMessage: "Nothing here" } },
      []
    );
    expect(r.rows).toBe(0);
    const txt = await w.text(".action-renderer-table tbody tr td");
    expect(txt).toContain("Nothing here");
  });

  test("jinja mode renders the resolved template html in a sandboxed iframe", async ({ page }) => {
    await renderWith(page, { mode: "jinja", jinjaTemplate: "{{ x }}" }, SAMPLE);
    expect(await w.count(".action-renderer-jinja-rendered")).toBe(1);
    // Rendered html is isolated in a sandboxed iframe (security) — assert the
    // frame exists and its srcdoc carries the resolved markup.
    expect(await w.count(".action-renderer-jinja-rendered iframe.action-renderer-html-frame")).toBe(1);
    const srcdoc = await page.evaluate(() => {
      const f = document.querySelector(".action-renderer-jinja-rendered iframe.action-renderer-html-frame");
      return f ? f.getAttribute("srcdoc") : null;
    });
    expect(srcdoc).toContain("jinja-probe");
    expect(srcdoc).toContain("OK");
    // Sandbox stays locked down.
    const sandbox = await page.evaluate(() => {
      const f = document.querySelector(".action-renderer-jinja-rendered iframe.action-renderer-html-frame");
      return f ? f.getAttribute("sandbox") : null;
    });
    expect(sandbox).toBe("");
  });
});
