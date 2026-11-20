"use strict";
// scripts/agent_tree.sh against throwaway repos: every repo a worktree at its
// remote's main (the framework's remote is not origin), the shared sources
// untouched, and a failed fetch refused by name before anything is built.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync, execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
let T, ENV;
const g = (cwd, ...a) => execFileSync("git", ["-C", cwd, ...a], { env: ENV, encoding: "utf8" }).trim();

function src(dir, remote = "origin") {
  fs.mkdirSync(dir, { recursive: true });
  const bare = `${dir}.git-remote`;
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", bare], { env: ENV });
  g(dir, "init", "-q", "-b", "main");
  fs.writeFileSync(path.join(dir, "v"), "1\n"); g(dir, "add", "-A"); g(dir, "commit", "-q", "-m", "1");
  g(dir, "remote", "add", remote, bare); g(dir, "push", "-q", "-u", remote, "main");
  fs.writeFileSync(path.join(dir, "v"), "2\n"); g(dir, "commit", "-qam", "2"); g(dir, "push", "-q", remote, "main");
  g(dir, "reset", "-q", "--hard", "HEAD~1"); g(dir, "checkout", "-q", "-b", "someone/else");
  return { dir, main: execFileSync("git", ["-C", bare, "rev-parse", "main"], { encoding: "utf8" }).trim() };
}

beforeEach(() => {
  T = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "agent-tree-")));
  fs.writeFileSync(path.join(T, "gitconfig"), "[user]\n\tname = t\n\temail = t@example.com\n");
  ENV = { ...process.env, GIT_CONFIG_GLOBAL: path.join(T, "gitconfig"), GIT_CONFIG_COUNT: "1",
          GIT_CONFIG_KEY_0: "core.hooksPath", GIT_CONFIG_VALUE_0: "/dev/null" };
  for (const k of ["GIT_DIR", "GIT_WORK_TREE", "CLAUDECODE"]) delete ENV[k];
});
afterEach(() => fs.rmSync(T, { recursive: true, force: true }));

function world() {
  const w = { root: src(path.join(T, "root")), fw: src(path.join(T, "fw"), "github"), conn: src(path.join(T, "conn")),
              a: src(path.join(T, "widgets", "agenticAssistant")), m: src(path.join(T, "widgets", "agenticAssistantMonitor")) };
  w.env = { ...ENV, AT_ROOT_REPO: w.root.dir, AT_FRAMEWORK_REPO: w.fw.dir, AT_CONN_REPO: w.conn.dir,
            AT_WIDGETS_DIR: path.join(T, "widgets"), AGENT_TREES: path.join(T, "trees"), AT_NO_BUILD: "1" };
  return w;
}
const at = (env, ...a) => spawnSync("bash", [path.join(ROOT, "scripts", "agent_tree.sh"), ...a], { env, encoding: "utf8" });

test("create: all 5 repos as worktrees at their remote's main; the sources keep their branch", () => {
  const w = world();
  const r = at(w.env, "create", "t1");
  const tree = path.join(T, "trees", "t1");
  const got = JSON.parse(fs.readFileSync(path.join(tree, "agent-tree.json"), "utf8"));
  expect(got.root.sha).toBe(w.root.main);
  expect(got.framework.sha).toBe(w.fw.main);            // fetched from "github", not origin
  expect(got.connector.sha).toBe(w.conn.main);
  expect(got.agenticAssistant.sha).toBe(w.a.main);
  expect(got.agenticAssistantMonitor.sha).toBe(w.m.main);
  expect(fs.existsSync(path.join(tree, "root", "widgets-src", "agenticAssistant", "v"))).toBe(true);
  for (const s of [w.root, w.fw, w.conn, w.a, w.m]) expect(g(s.dir, "branch", "--show-current")).toBe("someone/else");
  expect(r.stderr).not.toMatch(/fetch failed/);
});

test("a failed fetch is refused by repo name and nothing is built", () => {
  const w = world();
  g(w.conn.dir, "remote", "set-url", "origin", path.join(T, "gone.git"));
  const r = at(w.env, "create", "t2");
  expect(r.status).not.toBe(0);
  expect(r.stderr).toMatch(/fetch failed for connector/);
  expect(r.stderr).toMatch(/nothing was built/);
  expect(fs.existsSync(path.join(T, "trees", "t2"))).toBe(false);
  for (const s of [w.root, w.fw, w.conn, w.a, w.m]) expect(g(s.dir, "worktree", "list").split("\n")).toHaveLength(1);
});
