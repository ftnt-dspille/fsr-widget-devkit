"use strict";
// scripts/live-sanity.sh fetches and checks out widget repos at their remote main only for the widgets
// this run checks (WIDGETS, else the default pair widget_versions reads), not every widget under the
// shared widgets-src: a ship that proves one widget must not pay a fetch per sibling repo.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync, execFileSync } = require("child_process");
const ROOT = path.resolve(__dirname, "../..");
const SCRIPT = path.join(ROOT, "scripts/live-sanity.sh");
const G = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" };
const git = (...a) => execFileSync("git", a, { encoding: "utf8", env: G }).trim();

let tmp, bin, conn, root, shared;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lsf-"));
  // node stands in for run.js: report the scope and which widget sources were checked out for it.
  bin = path.join(tmp, "bin"); fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "node"),
    '#!/bin/sh\necho "WIDGETS=[$WIDGETS]"\necho "SRC=[$(ls "$WIDGETS_SRC" 2>/dev/null | sort | paste -sd, -)]"\n', { mode: 0o755 });
  fs.writeFileSync(path.join(bin, "pnpm"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  conn = path.join(tmp, "conn"); fs.mkdirSync(path.join(conn, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(conn, "scripts", "box.sh"),
    'resolve_box() { BOX_ENV=/dev/null; BOX_LEASE="tree:t#1"; }\nbx_main_checkout() { echo "${FAKE_MAIN:-$1}"; }\n');
  // A checkout whose tree has no widgets of its own, so the script falls back to the shared main checkout.
  root = path.join(tmp, "root"); fs.mkdirSync(path.join(root, "fortisoar-widget-harness"), { recursive: true });
  fs.mkdirSync(path.join(root, "widgets-src"));
  // The shared checkout: three widget repos, each with its remote main.
  shared = path.join(tmp, "shared");
  for (const name of ["agenticAssistant", "agenticAssistantMonitor", "someOtherWidget"]) makeWidget(name);
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

function makeWidget(name) {
  const bare = path.join(tmp, "remotes", `${name}.git`);
  git("init", "-q", "--bare", bare);
  const w = path.join(shared, "widgets-src", name);
  fs.mkdirSync(path.join(w, "widget"), { recursive: true });
  fs.writeFileSync(path.join(w, "widget", "info.json"), '{"version":"1.0.0"}');
  git("-C", w, "init", "-q", "-b", "main");
  git("-C", w, "add", "-A");
  git("-C", w, "commit", "-q", "-m", "main");
  git("-C", w, "remote", "add", "origin", bare);
  git("-C", w, "push", "-q", "-u", "origin", "main");
}

function run(env) {
  const r = spawnSync("bash", [SCRIPT], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, CONN_REPO: conn, BOX: "x", FSR_TOOL_HOME: root,
      AGENT_TREE: "", WIDGETS: "", WIDGETS_SRC: "", SKIP_LIVE_SANITY: "", LIVE_SANITY_STAMP_REPOS: conn,
      FAKE_MAIN: shared, ...env },
  });
  const checkedOut = (r.stdout.match(/SRC=\[(.*)\]/) || [])[1];
  return { ...r, checkedOut: checkedOut === undefined ? null : checkedOut.split(",").filter(Boolean) };
}

test("with WIDGETS set, only those widgets are fetched and checked out at their remote main", () => {
  const r = run({ WIDGETS: "agenticAssistant" });
  expect(r.status).toBe(0);
  expect(r.checkedOut).toEqual(["agenticAssistant"]);
});

test("with WIDGETS set to two, exactly those two are checked out", () => {
  const r = run({ WIDGETS: "agenticAssistant,agenticAssistantMonitor" });
  expect(r.status).toBe(0);
  expect(r.checkedOut).toEqual(["agenticAssistant", "agenticAssistantMonitor"]);
});

test("with no WIDGETS (a connector stamp), only the default pair widget_versions reads is checked out", () => {
  const r = run({ WIDGETS: "" });
  expect(r.status).toBe(0);
  expect(r.checkedOut).toEqual(["agenticAssistant", "agenticAssistantMonitor"]);
});
