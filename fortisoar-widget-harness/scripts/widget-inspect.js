#!/usr/bin/env node
"use strict";
// One-shot widget inspector — mount a widget in the running dev harness, run a
// sequence of clicks, then answer visual/DOM questions about it as JSON.
//
// This is the ad-hoc form of tests/e2e/_widgetHarness.js: no spec file, no test
// runner — for the "just check the dropdown isn't clipped / count the grid rows
// / is this element the right size" investigations agents do constantly.
//
// The dev harness must already be running (pnpm dev on :4401). It does NOT boot
// one (that's the Makefile's job for the e2e tier).
//
// Examples:
//   # Reproduce today's check: is the connector dropdown clipped by the modal?
//   node scripts/widget-inspect.js --widget actionRendererWidget \
//     --edit --click-text "Connector action" --click ".ui-select-match" \
//     --clipped ".ui-select-choices::.harness-modal"
//
//   # Count grid rows
//   node scripts/widget-inspect.js --widget jsonToGrid --rows ".ui-grid-row"
//
//   # Element size + a computed style
//   node scripts/widget-inspect.js --widget c3Charts --box "svg" --style "svg::height"
//
// Output: a JSON object. `mount` reports success + any render error; each query
// flag adds a keyed result. Exit 2 if the widget fails to mount.

const path = require("path");

// Resolve @playwright/test from the harness node_modules regardless of cwd.
const HARNESS_ROOT = path.resolve(__dirname, "..");
const { chromium } = require(path.join(HARNESS_ROOT, "node_modules", "@playwright", "test"));
const wh = require(path.join(HARNESS_ROOT, "tests", "e2e", "_widgetHarness.js"));

// ----- tiny ordered-args parser. Click flags are collected in order; query
// flags are collected separately and run after all clicks. -----
function parseArgs(argv) {
  const o = {
    widget: null,
    base: process.env.HARNESS_BASE || "http://localhost:4401",
    headed: false,
    screenshot: null,
    edit: false,
    actions: [], // {type:'click'|'clickText', value}
    queries: [], // {kind, ...}
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case "--widget": o.widget = next(); break;
      case "--config": o.config = JSON.parse(next()); break;
      case "--base": o.base = next(); break;
      case "--headed": o.headed = true; break;
      case "--screenshot": o.screenshot = next(); break;
      case "--edit": o.edit = true; break;
      case "--click": o.actions.push({ type: "click", value: next() }); break;
      case "--click-text": o.actions.push({ type: "clickText", value: next() }); break;
      case "--box": o.queries.push({ kind: "box", sel: next() }); break;
      case "--count": o.queries.push({ kind: "count", sel: next() }); break;
      case "--rows": o.queries.push({ kind: "rows", sel: next() }); break;
      case "--visible": o.queries.push({ kind: "visible", sel: next() }); break;
      case "--text": o.queries.push({ kind: "text", sel: next() }); break;
      case "--style": { const v = next(); const [sel, prop] = v.split("::"); o.queries.push({ kind: "style", sel, prop }); break; }
      case "--clipped": { const v = next(); const [child, anc] = v.split("::"); o.queries.push({ kind: "clipped", child, anc }); break; }
      case "--eval": o.queries.push({ kind: "eval", expr: next() }); break;
      case "-h": case "--help": o.help = true; break;
      default: throw new Error(`unknown arg: ${a}`);
    }
  }
  return o;
}

const HELP = `widget-inspect — mount a widget in the running harness and measure it.

  --widget <name>            widget folder name (required), e.g. jsonToGrid
  --config <json>            seed saved config so the widget renders content
                             (else it shows the "configure me" prompt)
  --base <url>               harness base (default http://localhost:4401)
  --edit                     open the Edit-config modal after mount
  --click <sel>              click a CSS selector (repeatable, run in order)
  --click-text <text>        click an element by visible text (repeatable)
  --box <sel>                report bounding box
  --rows <sel> / --count <sel>  count matching elements
  --visible <sel>            report visibility
  --text <sel>               report trimmed text
  --style <sel::prop>        report a computed style property
  --clipped <child::ancestor>  is child visually clipped by ancestor?
  --eval <expr>              evaluate arbitrary JS in the page, return its value
  --screenshot <path>        save a PNG
  --headed                   show the browser

All --click/--click-text run (in order) before any query. Output is JSON.`;

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || !opts.widget) {
    console.log(HELP);
    process.exit(opts.widget ? 0 : 2);
  }
  const browser = await chromium.launch({ headless: !opts.headed });
  const context = await browser.newContext({ baseURL: opts.base, ignoreHTTPSErrors: true });
  const page = await context.newPage();
  const out = {};
  try {
    const w = await wh.mountWidget(page, opts.widget, opts.config ? { config: opts.config } : {});
    out.mount = { ok: true, id: w.id, name: w.name };
    const err = await w.renderError();
    if (err) out.mount.renderError = err;

    if (opts.edit) await w.openEditModal();
    for (const act of opts.actions) {
      if (act.type === "click") await w.click(act.value);
      else await w.clickText(act.value);
      await w.settle();
    }
    await w.settle();

    for (const q of opts.queries) {
      const key = q.kind === "clipped" ? `clipped:${q.child}` : `${q.kind}:${q.sel || q.expr || ""}`;
      switch (q.kind) {
        case "box": out[key] = await w.box(q.sel); break;
        case "count": case "rows": out[key] = await w.count(q.sel); break;
        case "visible": out[key] = await w.visible(q.sel); break;
        case "text": out[key] = await w.text(q.sel); break;
        case "style": out[`style:${q.sel}::${q.prop}`] = await w.style(q.sel, q.prop); break;
        case "clipped": out[key] = await w.clippedBy(q.child, q.anc); break;
        // --eval is an explicit dev escape hatch: it runs the operator's OWN
        // expression in the browser page (same trust level as page.evaluate and
        // the rest of this local-only inspector). No untrusted input flows here;
        // the string comes from the command line the developer typed.
        case "eval": out[`eval`] = await page.evaluate((e) => eval(e), q.expr); break;
      }
    }
    if (opts.screenshot) { await page.screenshot({ path: opts.screenshot, fullPage: false }); out.screenshot = opts.screenshot; }
  } catch (e) {
    out.mount = out.mount || { ok: false };
    out.error = e.message;
    console.log(JSON.stringify(out, null, 2));
    await browser.close();
    process.exit(2);
  }
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
}

main();
