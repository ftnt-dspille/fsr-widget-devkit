"use strict";
// scripts/live-sanity.sh picks its scope from what it is stamping: only widget
// repos -> those widgets' checks (as widget-push does); anything else -> all.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const ROOT = path.resolve(__dirname, "../..");
let tmp, bin, conn;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lss-"));
  bin = path.join(tmp, "bin"); fs.mkdirSync(bin);
  // node stands in for run.js: report the scope it was handed.
  fs.writeFileSync(path.join(bin, "node"), '#!/bin/sh\necho "SCOPE=[$WIDGETS]"\n', { mode: 0o755 });
  fs.writeFileSync(path.join(bin, "pnpm"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  conn = path.join(tmp, "conn"); fs.mkdirSync(path.join(conn, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(conn, "scripts", "box.sh"),
    'resolve_box() { BOX_ENV=/dev/null; }\nbx_main_checkout() { echo "$1"; }\n');
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));
const widgetRepo = (name) => {
  const d = path.join(tmp, "widgets-src", name, "widget"); fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, "info.json"), "{}"); return path.dirname(d);
};
const run = (env) => spawnSync("bash", [path.join(ROOT, "scripts/live-sanity.sh")], {
  encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, CONN_REPO: conn, BOX: "x",
    WIDGETS_SRC: path.join(tmp, "widgets-src"), WIDGETS: "", SKIP_LIVE_SANITY: "", ...env } });

test("stamping only widget repos scopes to those widgets", () => {
  const r = run({ LIVE_SANITY_STAMP_REPOS: `${widgetRepo("agenticAssistant")}:${widgetRepo("agenticAssistantMonitor")}` });
  expect(r.stdout).toMatch(/SCOPE=\[agenticAssistant,agenticAssistantMonitor\]/);
});

test("a connector (or any non-widget) repo in the stamp list keeps every check", () => {
  const r = run({ LIVE_SANITY_STAMP_REPOS: `${widgetRepo("agenticAssistant")}:${conn}` });
  expect(r.stdout).toMatch(/SCOPE=\[\]/);
});

test("no stamp list, and an explicit WIDGETS, are left alone", () => {
  expect(run({ LIVE_SANITY_STAMP_REPOS: "" }).stdout).toMatch(/SCOPE=\[\]/);
  expect(run({ LIVE_SANITY_STAMP_REPOS: widgetRepo("a"), WIDGETS: "b" }).stdout).toMatch(/SCOPE=\[b\]/);
});
