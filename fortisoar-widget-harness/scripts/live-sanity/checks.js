"use strict";
// The live-sanity check registry. One entry per check:
//
//   name     shown in the report
//   lane     checks in the same lane run in order; lanes run in parallel
//            ("api" = connector/LLM via the connector repo's python, "ui" = one
//            headless browser, "designer" = its own jest+browser run)
//   widgets  optional: the check is selected only when one of these widgets is
//            in scope (no WIDGETS given = everything is in scope)
//   run(ctx) -> { status: "PASS"|"FAIL"|"SKIP", detail }
//
// Adding a check later (e.g. the docubot designer Apply spec) is one entry:
//   { name: "designer_apply", lane: "docubot",
//     run: (ctx) => ctx.makeTarget("test-designer-apply-live") }
// No check may depend on another lane's result; `box_login` runs first and
// everything else is skipped if it fails.

const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

const ASSISTANT = "agenticAssistant";
const MONITOR = "agenticAssistantMonitor";
const ASSISTANT_TITLE = "Agentic Assistant";

function sh(cmd, args, { env, cwd, timeoutMs = 240000 } = {}) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { env: { ...process.env, ...env }, cwd });
    let out = "";
    p.stdout.on("data", (b) => (out += b));
    p.stderr.on("data", (b) => (out += b));
    const t = setTimeout(() => { out += `\n[timeout after ${timeoutMs}ms]`; p.kill("SIGKILL"); }, timeoutMs);
    p.on("close", (code) => { clearTimeout(t); resolve({ code, out }); });
    p.on("error", (e) => { clearTimeout(t); resolve({ code: 127, out: String(e) }); });
  });
}

// Run named checks of the connector repo's live_integration.py and map its
// PASS/FAIL/SKIP/BLOCKED row for `name` onto ours.
async function connectorCheck(ctx, name, timeoutMs = 240000) {
  const r = await sh(ctx.connPy, ["live_integration.py", "--only", name], {
    cwd: path.join(ctx.connRepo, "scripts"), env: ctx.connEnv, timeoutMs,
  });
  const row = r.out.split("\n").find((l) => new RegExp(`^\\s+\\S\\s+${name}\\s+(PASS|FAIL|SKIP|BLOCKED)`).test(l));
  if (!row) return { status: "FAIL", detail: `no result row (exit ${r.code}): ${tail(r.out)}` };
  const m = row.match(new RegExp(`${name}\\s+(PASS|FAIL|SKIP|BLOCKED)\\s*(.*)$`));
  const status = m[1] === "PASS" ? "PASS" : m[1] === "FAIL" ? "FAIL" : "SKIP";
  return { status, detail: m[2].trim().slice(0, 240) };
}

function tail(s, n = 300) { const t = String(s || "").trim(); return t.length > n ? "..." + t.slice(-n) : t; }

function infoVersion(widgetsSrc, w) {
  for (const p of [path.join(widgetsSrc, w, "widget", "info.json"), path.join(widgetsSrc, w, "info.json")]) {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8")).version;
  }
  return null;
}

const REGISTRY = [
  {
    name: "connector_health", lane: "api",
    // health_check on the box's DEFAULT config: logged in, config usable, LLM reachable.
    run: (ctx) => connectorCheck(ctx, "health", 120000),
  },
  {
    name: "workers", lane: "api",
    run: async (ctx) => {
      const r = await sh(ctx.connPy, ["verify_workers.py", "--version", ctx.box.connectorVersion,
        "--max-calls", "30", "--settle", "8", "-q"], { cwd: path.join(ctx.connRepo, "scripts"), env: ctx.connEnv, timeoutMs: 180000 });
      return r.code === 0
        ? { status: "PASS", detail: `every worker on ${ctx.box.connectorVersion}` }
        : { status: "FAIL", detail: tail(r.out, 240) };
    },
  },
  {
    name: "chat_turn", lane: "api", widgets: [ASSISTANT],
    // ONE real turn on the default config: a tool call must read a real record
    // and the answer must quote its name (connector check sanity_record_lookup).
    run: (ctx) => connectorCheck(ctx, "sanity_record_lookup", 300000),
  },
  {
    name: "widget_versions", lane: "ui",
    run: async (ctx) => {
      const res = await ctx.soar.get("/api/3/widgets?$limit=500");
      const list = (res && (res["hydra:member"] || res)) || [];
      const bad = [], ok = [];
      for (const w of ctx.widgets) {
        const want = infoVersion(ctx.widgetsSrc, w);
        if (!want) { bad.push(`${w}: no local info.json under ${ctx.widgetsSrc}`); continue; }
        const got = list.filter((x) => x && x.name === w).map((x) => x.version);
        if (got.includes(want)) ok.push(`${w}@${want}`);
        else bad.push(`${w}: box has ${got.join(",") || "none"}, expected ${want}`);
      }
      return bad.length ? { status: "FAIL", detail: bad.join("; ") } : { status: "PASS", detail: ok.join(", ") };
    },
  },
  {
    name: "assistant_mount", lane: "ui", widgets: [ASSISTANT],
    run: async (ctx) => {
      const page = await ctx.browserPage();
      if (page.skip) return page.skip;
      const res = await ctx.soar.get("/api/3/alerts?$limit=1&$orderby=-createDate");
      const iri = res && res["hydra:member"] && res["hydra:member"][0] && res["hydra:member"][0]["@id"];
      if (!iri) return { status: "SKIP", detail: "box: no alert record to mount the drawer on" };
      const errs = ctx.captureErrors(page.page, ASSISTANT);
      await page.page.goto(`${ctx.base}/modules/alerts/${iri.split("/").pop()}`, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.page.waitForFunction(() => document.querySelectorAll("img.logo-sm").length > 0, undefined, { timeout: 45000 }).catch(() => {});
      await page.page.waitForTimeout(1500);
      const icon = await page.page.$(`img.logo-sm[title="${ASSISTANT_TITLE}"]`);
      if (!icon) return { status: "FAIL", detail: `no "${ASSISTANT_TITLE}" drawer icon on the record page` };
      await icon.click();
      const mounted = await page.page.waitForSelector(ctx.COMPOSER, { timeout: 30000 }).then(() => true, () => false);
      await page.page.waitForTimeout(2000);
      const { ours: e, other } = errs.stop();
      if (!mounted) return { status: "FAIL", detail: `drawer opened but the composer never mounted${e.length ? "; errors: " + e.slice(0, 2).join(" | ") : ""}` };
      if (e.length) return { status: "FAIL", detail: `mounted with ${e.length} widget console error(s): ${e.slice(0, 3).join(" | ").slice(0, 300)}` };
      return { status: "PASS", detail: `drawer mounted, composer ready, no widget console errors (${other} page-wide, not the widget's)` };
    },
  },
  {
    name: "monitor_loads", lane: "ui", widgets: [MONITOR],
    // A throwaway dashboard holding only the Monitor, created and deleted per run.
    run: async (ctx) => {
      const page = await ctx.browserPage();
      if (page.skip) return page.skip;
      const res = await ctx.soar.get("/api/3/widgets?$limit=500");
      const w = ((res && res["hydra:member"]) || []).find((x) => x && x.name === MONITOR);
      if (!w) return { status: "FAIL", detail: `${MONITOR} is not installed` };
      const body = {
        displayName: "zz Live Sanity Monitor", type: "rows", templateType: "dashboard",
        config: { rows: [{ columns: [{ widgets: [{ type: `${MONITOR}-${w.version}`, config: { wid: require("crypto").randomUUID() } }] }] }] },
      };
      const made = await ctx.soar.post("/api/3/dashboard", body);
      if (made.status < 200 || made.status >= 300 || !made.json) return { status: "FAIL", detail: `create scratch dashboard: HTTP ${made.status}` };
      try {
        const errs = ctx.captureErrors(page.page, MONITOR);
        await page.page.goto(`${ctx.base}/?qid=${made.json.uuid}`, { waitUntil: "domcontentloaded", timeout: 60000 });
        const ok = await page.page.waitForSelector('[data-testid="soc-monitor-root"]', { timeout: 45000 }).then(() => true, () => false);
        await page.page.waitForTimeout(3000);
        const { ours: e, other } = errs.stop();
        if (!ok) return { status: "FAIL", detail: `Monitor root never rendered${e.length ? "; errors: " + e.slice(0, 2).join(" | ") : ""}` };
        if (e.length) return { status: "FAIL", detail: `Monitor rendered with ${e.length} widget console error(s): ${e.slice(0, 3).join(" | ").slice(0, 300)}` };
        return { status: "PASS", detail: `Monitor ${w.version} rendered, no widget console errors (${other} page-wide, not the widget's)` };
      } finally {
        await ctx.soar.del(`/api/3/dashboard/${made.json.uuid}`).catch(() => {});
      }
    },
  },
  {
    name: "designer_stage", lane: "designer", widgets: [ASSISTANT],
    // No LLM: push a scratch playbook, stage an edit into the real designer,
    // assert the canvas and that nothing was written; the spec deletes it.
    run: async (ctx) => {
      const r = await sh("pnpm", ["test:live", "tests/live/designerStage.live.test.js"], {
        cwd: ctx.harness, env: { E2E_LIVE: "1", VIA_MAKE: "1" }, timeoutMs: 300000,
      });
      if (/SKIPPED/.test(r.out) && !/Tests:.*passed/.test(r.out)) return { status: "SKIP", detail: "designer spec skipped itself" };
      const summary = (r.out.match(/Tests:.*$/m) || [""])[0];
      return r.code === 0
        ? { status: "PASS", detail: `edit staged on the canvas, nothing written (${summary})` }
        : { status: "FAIL", detail: `${summary || "exit " + r.code}: ${tail(r.out, 240)}` };
    },
  },
  {
    name: "designer_apply", lane: "docubot", widgets: [ASSISTANT],
    // No LLM: docubot's live designer Apply spec (real write, self-cleaning).
    // Present only once the target lands in the root Makefile; until then the
    // check is not part of the registry for this checkout (see available()).
    available: () => makeHasTarget("test-designer-apply-live"),
    run: async (ctx) => {
      const r = await sh("make", ["--no-print-directory", "-C", path.resolve(ctx.harness, ".."),
        "test-designer-apply-live", `BOX=${ctx.boxName}`], { timeoutMs: 300000 });
      return r.code === 0
        ? { status: "PASS", detail: "designer Apply wrote the playbook and it read back" }
        : { status: "FAIL", detail: `exit ${r.code}: ${tail(r.out, 240)}` };
    },
  },
];

function makeHasTarget(t) {
  const mk = path.resolve(__dirname, "..", "..", "..", "Makefile");
  try { return new RegExp(`^${t}:`, "m").test(fs.readFileSync(mk, "utf8")); } catch (_) { return false; }
}

// Pure: which registry entries run for this scope. No widgets = everything.
// An entry whose available() is false is not in this checkout yet: not selected.
function selectChecks(registry, widgets) {
  const live = registry.filter((c) => !c.available || c.available());
  if (!widgets || !widgets.length) return live;
  return live.filter((c) => !c.widgets || c.widgets.some((w) => widgets.includes(w)));
}

module.exports = { REGISTRY, selectChecks, ASSISTANT, MONITOR, sh };
