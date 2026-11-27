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
  fs.writeFileSync(path.join(bin, "node"), '#!/bin/sh\necho "SCOPE=[$WIDGETS] LEASE=[$LIVE_SANITY_LEASE]"\necho "WSRC=[$WIDGETS_SRC] V=[$(cat "$WIDGETS_SRC/agenticAssistant/widget/info.json" 2>/dev/null)]"\n', { mode: 0o755 });
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

// A shared checkout whose widget is on another session's branch: remote main has
// 1.0.0, the checked-out branch 0.9.0.
function sharedOnOtherBranch() {
  const { execFileSync } = require("child_process");
  const main = path.join(tmp, "shared"); const w = path.join(main, "widgets-src", "agenticAssistant");
  fs.mkdirSync(path.join(w, "widget"), { recursive: true });
  const g = (...a) => execFileSync("git", ["-C", w, ...a], { encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" } }).trim();
  g("init", "-q", "-b", "main");
  fs.writeFileSync(path.join(w, "widget", "info.json"), '{"version":"1.0.0"}');
  g("add", "-A"); g("commit", "-q", "-m", "main"); g("update-ref", "refs/remotes/origin/main", "HEAD");
  return { main, w, g, otherBranch() {
    g("checkout", "-q", "-b", "someone/else"); fs.writeFileSync(path.join(w, "widget", "info.json"), '{"version":"0.9.0"}'); g("commit", "-qam", "old");
  } };
}
const runNoSrc = (env) => {
  const e = { ...process.env, PATH: `${bin}:${process.env.PATH}`, CONN_REPO: conn, BOX: "x", WIDGETS: "", ...env };
  delete e.WIDGETS_SRC;
  return spawnSync("bash", [path.join(ROOT, "scripts/live-sanity.sh")], { encoding: "utf8", env: e });
};

test("no WIDGETS_SRC and a shared checkout widget off its remote main: checked at its remote main, not that branch", () => {
  const sh = sharedOnOtherBranch(); sh.otherBranch();
  const r = runNoSrc({ FAKE_MAIN: sh.main, LIVE_SANITY_STAMP_REPOS: "" });
  expect(r.status).toBe(0);
  expect(r.stdout).toMatch(/"version":"1\.0\.0"/);
  expect(r.stdout).not.toMatch(/0\.9\.0/);
  const wsrc = r.stdout.match(/WSRC=\[([^\]]+)\]/)[1];
  expect(wsrc).not.toContain(sh.main);
  expect(fs.existsSync(wsrc)).toBe(false);                 // the temporary checkout is removed again
  expect(sh.g("worktree", "list").split("\n")).toHaveLength(1);
});

test("a stamp with no widget or root repo (a connector) never reads the shared checkout's branch, even when WIDGETS_SRC names it", () => {
  const sh = sharedOnOtherBranch(); sh.otherBranch();
  // make exports the shared checkout's widgets-src as a default; a connector stamp must not trust it.
  const r = run({ FAKE_MAIN: sh.main, LIVE_SANITY_STAMP_REPOS: conn, WIDGETS_SRC: "" });
  expect(r.stdout).toMatch(/"version":"1\.0\.0"/);
});

test("a stamped widget repo in an agent tree is its own widget source, whatever WIDGETS_SRC says", () => {
  const tree = path.join(tmp, "tree", "root", "widgets-src");
  const w = path.join(tree, "agenticAssistant", "widget"); fs.mkdirSync(w, { recursive: true });
  fs.writeFileSync(path.join(w, "info.json"), '{"version":"1.4.6"}');
  const sh = sharedOnOtherBranch(); sh.otherBranch();
  const r = run({ LIVE_SANITY_STAMP_REPOS: path.join(tree, "agenticAssistant"), WIDGETS_SRC: path.join(sh.main, "widgets-src") });
  expect(r.stdout).toMatch(/"version":"1\.4\.6"/);
  expect(r.stdout).toMatch(/WSRC=\[[^\]]*\/tree\/root\/widgets-src\]/);
});

test("a stamped root worktree that carries widgets is its own widget source", () => {
  const rootDir = path.join(tmp, "wtroot"); fs.mkdirSync(path.join(rootDir, "fortisoar-widget-harness"), { recursive: true });
  const w = path.join(rootDir, "widgets-src", "agenticAssistant", "widget"); fs.mkdirSync(w, { recursive: true });
  fs.writeFileSync(path.join(w, "info.json"), '{"version":"2.0.0"}');
  const sh = sharedOnOtherBranch(); sh.otherBranch();
  const r = run({ LIVE_SANITY_STAMP_REPOS: rootDir, WIDGETS_SRC: path.join(sh.main, "widgets-src") });
  expect(r.stdout).toMatch(/"version":"2\.0\.0"/);
});

test("make doctor hands live sanity only a WIDGETS_SRC the caller gave", () => {
  const mk = (env) => {
    const e = { ...process.env, ...env }; delete e.MAKEFLAGS; delete e.MAKELEVEL;
    if (!env.WIDGETS_SRC) delete e.WIDGETS_SRC;
    const extra = path.join(tmp, "p.mk");
    fs.writeFileSync(extra, "zz-print:\n\t@echo GIVEN=[$(WIDGETS_SRC_GIVEN)]\n");
    return spawnSync("make", ["-s", "-C", ROOT, "-f", "Makefile", "-f", extra, "zz-print"], { env: e, encoding: "utf8" }).stdout;
  };
  expect(mk({})).toMatch(/GIVEN=\[\]/);
  expect(mk({ WIDGETS_SRC: "/some/where" })).toMatch(/GIVEN=\[\/some\/where\]/);
});

test("a shared widget repo with no remote main is left out of the main-widgets checkout, not fatal", () => {
  const sh = sharedOnOtherBranch(); sh.otherBranch();
  const { execFileSync } = require("child_process");
  // In scope (the default pair widget_versions reads): a widget with no remote main there is noted, not fatal.
  const odd = path.join(sh.main, "widgets-src", "agenticAssistantMonitor"); fs.mkdirSync(path.join(odd, "widget"), { recursive: true });
  fs.writeFileSync(path.join(odd, "widget", "info.json"), "{}");
  execFileSync("git", ["-C", odd, "init", "-q", "-b", "feature"], { env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" } });
  const r = run({ FAKE_MAIN: sh.main, LIVE_SANITY_STAMP_REPOS: conn, WIDGETS_SRC: "" });
  expect(r.status).toBe(0);
  expect(r.stdout).toMatch(/"version":"1\.0\.0"/);
  expect(r.stderr).toMatch(/agenticAssistantMonitor has no origin\/main/);
});

describe("a connector stamp inside an agent tree compares the box with the tree's widgets, not the remote main", () => {
  // The stable bump ships a widget bump and the connector in ONE tree: the box holds the bumped widget while the remote
  // main still has the old version until promote, so widget_versions expected the pre-bump version and failed.
  const treeRoot = () => {
    const root = path.join(tmp, "tree", "root"); fs.mkdirSync(path.join(root, "fortisoar-widget-harness"), { recursive: true });
    const w = path.join(root, "widgets-src", "agenticAssistant", "widget"); fs.mkdirSync(w, { recursive: true });
    fs.writeFileSync(path.join(w, "info.json"), '{"version":"1.4.9"}');   // the bumped branch
    return root;
  };
  test("AGENT_TREE set and the invoking root inside it: the tree's widgets-src (bumped) is the source", () => {
    const root = treeRoot(); const sh = sharedOnOtherBranch();
    const r = run({ FSR_TOOL_HOME: root, AGENT_TREE: path.join(tmp, "tree"), LIVE_SANITY_STAMP_REPOS: conn, WIDGETS_SRC: "", FAKE_MAIN: sh.main });
    expect(r.stdout).toMatch(/"version":"1\.4\.9"/);
    expect(r.stdout).toMatch(/WSRC=\[[^\]]*\/tree\/root\/widgets-src\]/);
  });
  test("outside an agent tree the stamp still reads the widgets at their remote main", () => {
    const root = treeRoot(); const sh = sharedOnOtherBranch();
    const r = run({ FSR_TOOL_HOME: root, AGENT_TREE: "", LIVE_SANITY_STAMP_REPOS: conn, WIDGETS_SRC: "", FAKE_MAIN: sh.main });
    expect(r.stdout).not.toMatch(/1\.4\.9/);
  });
});
