"use strict";

// Builds a widget repo's own TypeScript assets (its tsconfig.json, e.g.
// fortiaiAgenticAssistant's widget/widgetAssets/js/fsrPbRender.ts) with the
// harness's pinned tsc. The compiled .js sits next to its .ts and is a gitignored
// build output: FortiSOAR and the harness load the .js, so every consumer that
// loads or packages widget code runs this first (jest and playwright configs,
// the dev/test server at boot, the packager). Plain JS on purpose: it is source,
// not compiled output, so it is never itself generated.

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const HARNESS_DIR = path.resolve(__dirname, "..");
const TSC = path.join(HARNESS_DIR, "node_modules", "typescript", "bin", "tsc");

// Same discovery as server.ts resolveWidgetRoots(): WIDGETS_SRC (or the local
// widgets-src/), plus the harness's bundled examples/. Existing dirs only.
function widgetRoots() {
  const roots = [];
  if (process.env.WIDGETS_SRC) roots.push(path.resolve(process.env.WIDGETS_SRC));
  else roots.push(path.resolve(HARNESS_DIR, "widgets-src"));
  roots.push(path.resolve(HARNESS_DIR, "examples"));
  return [...new Set(roots)].filter((p) => fs.existsSync(p));
}

// Compile one widget dir. Returns false when the dir has no tsconfig.json
// (nothing to build). A compile error throws: a widget that does not type-check
// must not package, serve or test as if its assets were current.
function buildWidgetAssets(widgetDir) {
  const cfg = path.join(widgetDir, "tsconfig.json");
  if (!fs.existsSync(cfg)) return false;
  const r = spawnSync(process.execPath, [TSC, "-p", cfg], {
    cwd: widgetDir,
    encoding: "utf8",
  });
  if (r.status !== 0) {
    const out = `${r.stdout || ""}${r.stderr || ""}`.trim();
    throw new Error(`widget TypeScript build failed (${cfg}, tsc exit ${r.status})\n${out}`);
  }
  return true;
}

// Compile every widget dir under each root that carries a tsconfig.json.
// Returns the widget dirs that were built.
function buildAllWidgetAssets(roots) {
  const built = [];
  for (const root of roots) {
    for (const e of fs.readdirSync(root, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name.startsWith(".")) continue;
      const dir = path.join(root, e.name);
      if (buildWidgetAssets(dir)) built.push(dir);
    }
  }
  return built;
}

// The harness packs <repo>/widget/ (info.json, view.html, widgetAssets/), but the
// repo root above it holds the tsconfig.json. Map a widget/ payload dir to its
// repo root; any other dir is its own repo root.
function widgetRepoDir(widgetDir) {
  const abs = path.resolve(widgetDir);
  return path.basename(abs) === "widget" ? path.dirname(abs) : abs;
}

module.exports = { widgetRoots, widgetRepoDir, buildWidgetAssets, buildAllWidgetAssets, TSC };
