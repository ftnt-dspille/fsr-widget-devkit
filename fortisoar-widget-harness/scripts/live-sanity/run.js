#!/usr/bin/env node
"use strict";
// `make live-sanity BOX=<name> [WIDGETS=a,b]`: a short live pass (~1-2 min) run
// after every dev push. Not the full sweep: enough to catch "the push broke the
// box". The env file of the resolved box is already sourced by make.
//
//   box_login first (login + connector + default config); then three lanes in
//   parallel: api (health, workers, one real chat turn), ui (installed versions,
//   assistant mount, Monitor), designer (no-LLM designer staging, self-cleaning).
//
// Verdict rules: verdict.js. Headless only: a box whose WAF refuses a headless
// login reports the UI checks as NOT RUN (PARTIAL), it never opens a window.

const path = require("path");
const { REGISTRY, selectChecks, ASSISTANT, MONITOR } = require("./checks");
const { computeVerdict, formatReport } = require("./verdict");
const { writeStamps, stampDir } = require("./stamp");

const HARNESS = path.resolve(__dirname, "..", "..");

// KEY=VALUE lines, values taken literally (one pair of outer quotes stripped).
function loadEnvFile(file) {
  if (!file) return;
  for (const line of require("fs").readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (v.length >= 2 && (v[0] === '"' || v[0] === "'") && v[v.length - 1] === v[0]) v = v.slice(1, -1);
    process.env[m[1]] = v;
  }
}

async function main() {
  loadEnvFile(process.env.LIVE_SANITY_ENV_FILE);
  const t0 = Date.now();
  const box = process.env.LIVE_SANITY_BOX || "(unnamed box)";
  const widgets = (process.env.WIDGETS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const selected = selectChecks(REGISTRY, widgets);
  console.log(`▶ live sanity on ${box}: ${selected.map((c) => c.name).join(", ")}`);

  const results = [];
  const record = (name, r, ms) => {
    results.push({ name, status: r.status, detail: r.detail, ms });
    console.log(`  ${r.status.padEnd(4)} ${name} ${r.detail || ""}`);
  };

  // --- box_login: everything else needs it --------------------------------
  let soar;
  const tl = Date.now();
  try {
    const { makeClient } = require(path.join(HARNESS, "tests/live/lib/soarClient"));
    soar = await makeClient();
    const m = soar.meta;
    record("box_login", { status: "PASS", detail: `connector ${m.version}, config "${m.configName}"` }, Date.now() - tl);
  } catch (e) {
    record("box_login", { status: "FAIL", detail: String(e && e.message || e).slice(0, 240) }, Date.now() - tl);
    for (const c of selected) record(c.name, { status: "SKIP", detail: "box_login failed" });
    return finish(results, box, t0);
  }
  // Every analyst turn runs on the DEFAULT config; a box with none runs on
  // whichever config happens to be first, which is not what was configured.
  const { CONNECTOR_LIST_PATH } = require(path.join(HARNESS, "tests/live/lib/soarClient"));
  const conn = await soar.get(CONNECTOR_LIST_PATH)
    .then((j) => ((j && j.data) || []).find((c) => c.name === soar.meta.connector), () => null);
  const cfgs = (conn && conn.configuration) || [];
  const def = cfgs.find((c) => c.default);
  if (!conn) {
    results[0] = { ...results[0], status: "FAIL", detail: `${results[0].detail}; connector not in the box's connector list` };
  } else if (!def) {
    results[0] = { ...results[0], status: "FAIL", detail: `${results[0].detail}; but NO config is marked default (${cfgs.map((c) => c.name).join(", ")})` };
  } else {
    results[0] = { ...results[0], detail: `connector ${soar.meta.version}, default config "${def.name}"` };
  }

  // --- shared context --------------------------------------------------------
  const soarBrowser = require(path.join(HARNESS, "lib/soarBrowser"));
  const soarEnv = require(path.join(HARNESS, "lib/soarEnv"));
  const { COMPOSER } = require(path.join(HARNESS, "lib/chatSession"));
  const env = soarEnv.resolveSoarEnv();
  const base = soarBrowser.baseUrl(env);
  let browserP = null, browser = null;
  const ctx = {
    soar, base, COMPOSER, harness: HARNESS,
    widgets: widgets.length ? widgets : [ASSISTANT, MONITOR],
    widgetsSrc: process.env.WIDGETS_SRC || path.resolve(HARNESS, "..", "widgets-src"),
    connRepo: process.env.CONN_REPO,
    connPy: path.join(process.env.CONN_REPO || "", ".venv", "bin", "python"),
    connEnv: { FSR_BUILDER_VERSION: soar.meta.version, FSR_BUILDER_CONFIG_NAME: soar.meta.configName },
    box: { connectorVersion: soar.meta.version },
    boxName: box,
    // One headless browser for the ui lane, logged in once.
    browserPage() {
      if (!browserP) {
        browserP = (async () => {
          const lc = await soarBrowser.launchContext({ headless: true });
          browser = lc.browser;
          const page = await lc.context.newPage();
          try {
            await soarBrowser.login(page, base, env);
          } catch (e) {
            return { skip: { status: "SKIP", detail: `headless login failed (WAF on this box refuses headless?): ${String(e.message || e).slice(0, 120)}` } };
          }
          // The SPA leaves /login on its own schedule; proof of a session is the
          // app shell's drawer icons rendering on a real page.
          await page.goto(`${base}/dashboard`, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
          const inApp = await page.waitForFunction(() => !/\/login/.test(location.pathname) && document.querySelectorAll("img.logo-sm, .sub-block").length > 0,
            undefined, { timeout: 45000 }).then(() => true, () => false);
          if (!inApp) return { skip: { status: "SKIP", detail: "headless session never reached the app shell (WAF or bad creds); UI not checked" } };
          return { page };
        })();
      }
      return browserP;
    },
    // Console errors attributable to ONE widget: its name in the message or in
    // the stack/source URL. Page-wide noise from the platform or other widgets
    // (requirejs "anonymous define", another widget's CSS 404) is counted and
    // shown, but does not fail the widget.
    captureErrors(page, widget) {
      const benign = /favicon|ResizeObserver|Non-Error promise rejection|referrer policy|about:srcdoc|frame is sandboxed/i;
      const ours = [], other = [];
      const add = (text, where) => {
        if (benign.test(text)) return;
        (`${text} ${where || ""}`.includes(widget) ? ours : other).push(text.slice(0, 200));
      };
      const onC = (m) => { if (m.type() === "error") add(m.text(), (m.location() || {}).url); };
      const onE = (e) => add("[pageerror] " + String(e && e.message || e), e && e.stack);
      page.on("console", onC); page.on("pageerror", onE);
      return { stop: () => { page.off("console", onC); page.off("pageerror", onE); return { ours: ours.slice(), other: other.length }; } };
    },
  };
  if (!ctx.connRepo) {
    for (const c of selected.filter((x) => x.lane === "api")) record(c.name, { status: "SKIP", detail: "CONN_REPO not set" });
  }

  // --- lanes ----------------------------------------------------------------
  const lanes = {};
  for (const c of selected) {
    if (c.lane === "api" && !ctx.connRepo) continue;
    (lanes[c.lane] = lanes[c.lane] || []).push(c);
  }
  await Promise.all(Object.values(lanes).map(async (checks) => {
    for (const c of checks) {
      const t = Date.now();
      let r;
      try { r = await c.run(ctx); } catch (e) { r = { status: "FAIL", detail: `${e && e.name || "Error"}: ${String(e && e.message || e).slice(0, 240)}` }; }
      record(c.name, r, Date.now() - t);
    }
  }));
  if (browser) await browser.close().catch(() => {});
  return finish(results, box, t0);
}

// The repos whose code the CALLING PUSH put on the box, ':'-separated in
// LIVE_SANITY_STAMP_REPOS (widget-push: the widget; deploy: the connector;
// loop/dev-push: connector + framework + the assistant widget; ship-dev: the
// framework). Empty (a doctor re-check) writes no stamp: a re-check did not put
// any local commit on the box, so it cannot prove one.
function stampRepos() {
  return (process.env.LIVE_SANITY_STAMP_REPOS || "").split(":").filter(Boolean);
}

function finish(results, box, t0) {
  const v = computeVerdict(results);
  console.log("\n" + formatReport(results, v, { box, seconds: Math.round((Date.now() - t0) / 1000) }));
  try {
    const files = writeStamps(stampRepos(), { box, verdict: v.verdict, results });
    console.log(files.length
      ? `  stamps (${v.verdict}): ${files.map((f) => path.relative(stampDir(), f)).join(", ")}`
      : "  no stamps: nothing was pushed by this run's caller (re-check only)");
  } catch (e) {
    console.log(`  WARNING: could not write live-sanity stamps: ${e.message}`);
  }
  return v.exitCode;
}

main().then((code) => process.exit(code), (e) => {
  console.error(`[[LIVE-SANITY-FAIL]] runner crashed: ${e && e.stack || e}`);
  process.exit(1);
});
