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
  fs.writeFileSync(path.join(bin, "node"), '#!/bin/sh\necho "SCOPE=[$WIDGETS] LEASE=[$LIVE_SANITY_LEASE]"\n', { mode: 0o755 });
  fs.writeFileSync(path.join(bin, "pnpm"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  conn = path.join(tmp, "conn"); fs.mkdirSync(path.join(conn, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(conn, "scripts", "box.sh"),
    'resolve_box() { echo "NEED=$1"; BOX_ENV=/dev/null; BOX_LEASE="tree:t#7"; }\nbx_main_checkout() { echo "${FAKE_MAIN:-$1}"; }\n');
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

test("a stamp takes the box lease and hands it to the stamp writer", () => {
  const r = run({ LIVE_SANITY_STAMP_REPOS: "" });
  expect(r.stdout).toMatch(/NEED=env,lease/);
  expect(r.stdout).toMatch(/LEASE=\[tree:t#7\]/);
});

test("with no WIDGETS_SRC, a shared checkout widget off its remote main is refused, not checked", () => {
  const { execFileSync } = require("child_process");
  const main = path.join(tmp, "shared"); const w = path.join(main, "widgets-src", "agenticAssistant");
  fs.mkdirSync(path.join(w, "widget"), { recursive: true });
  const g = (...a) => execFileSync("git", ["-C", w, ...a], { encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" } }).trim();
  g("init", "-q", "-b", "main");
  fs.writeFileSync(path.join(w, "widget", "info.json"), '{"version":"1.0.0"}');
  g("add", "-A"); g("commit", "-q", "-m", "main"); g("update-ref", "refs/remotes/origin/main", "HEAD");
  const env = { WIDGETS_SRC: "", FAKE_MAIN: main, LIVE_SANITY_STAMP_REPOS: "" };
  delete env.WIDGETS_SRC;
  // At remote main: fine.
  let r = spawnSync("bash", [path.join(ROOT, "scripts/live-sanity.sh")], { encoding: "utf8",
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, CONN_REPO: conn, BOX: "x", WIDGETS: "", FAKE_MAIN: main, WIDGETS_SRC: "" } });
  // WIDGETS_SRC="" means unset for the script ([[ -z ]]).
  expect(r.stderr).not.toMatch(/refusing/);
  // Another session's branch: refused, naming the repo and the fix.
  g("checkout", "-q", "-b", "someone/else"); fs.writeFileSync(path.join(w, "widget", "info.json"), '{"version":"0.9.0"}'); g("commit", "-qam", "old");
  r = spawnSync("bash", [path.join(ROOT, "scripts/live-sanity.sh")], { encoding: "utf8",
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, CONN_REPO: conn, BOX: "x", WIDGETS: "", FAKE_MAIN: main, WIDGETS_SRC: "" } });
  expect(r.status).toBe(2);
  expect(r.stderr).toMatch(/agenticAssistant is at someone\/else, not its remote main/);
  expect(r.stdout).not.toMatch(/SCOPE=/);
});
