"use strict";
// make agent-tree (and status/stamp/promote-tree) run agent_tree.sh from the root
// repo's remote main, not the checkout's branch (scripts/run_from_main.sh).
// Live: the shared checkout sat on a feature branch, so an old agent_tree.sh
// without the self-check ran.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync, execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.com", GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "core.hooksPath",
  GIT_CONFIG_VALUE_0: "/dev/null" };
delete ENV.FROM_TREE;
let T, repo;
const g = (...a) => execFileSync("git", ["-C", repo, ...a], { env: ENV, encoding: "utf8" });
const put = (body) => fs.writeFileSync(path.join(repo, "scripts", "agent_tree.sh"), `echo ${body} home=$FSR_TOOL_HOME args=$*\n`);

beforeEach(() => {
  T = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "run-main-")));
  repo = path.join(T, "r");
  fs.mkdirSync(path.join(repo, "scripts"), { recursive: true });
  fs.copyFileSync(path.join(ROOT, "scripts", "run_from_main.sh"), path.join(repo, "scripts", "run_from_main.sh"));
  g("init", "-q", "-b", "main");
  put("FROM-MAIN"); g("add", "-A"); g("commit", "-q", "-m", "main");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", path.join(T, "remote.git")], { env: ENV });
  g("remote", "add", "origin", path.join(T, "remote.git")); g("push", "-q", "-u", "origin", "main");
  g("checkout", "-q", "-b", "someone/else"); put("FROM-THEIR-BRANCH"); g("commit", "-qam", "theirs");
  put("FROM-WIP");
});
afterEach(() => fs.rmSync(T, { recursive: true, force: true }));

const run = (env = {}) => spawnSync("bash", [path.join(repo, "scripts", "run_from_main.sh"), "agent_tree.sh", "create", "x"],
  { env: { ...ENV, ...env }, encoding: "utf8" });

test("runs the remote main's copy, with FSR_TOOL_HOME and args, whatever branch and WIP the checkout has", () => {
  const r = run();
  expect(r.status).toBe(0);
  expect(r.stdout).toContain("FROM-MAIN");
  expect(r.stdout).toContain(`home=${repo}`);
  expect(r.stdout).toContain("args=create x");
  expect(r.stdout).not.toMatch(/FROM-THEIR-BRANCH|FROM-WIP/);
});

test("FROM_TREE=1 runs the working-tree copy", () => {
  expect(run({ FROM_TREE: "1" }).stdout).toMatch(/FROM-WIP/);
});

test("every agent-tree make target goes through the wrapper", () => {
  const mk = fs.readFileSync(path.join(ROOT, "Makefile"), "utf8");
  for (const sub of ["create", "status", "stamp", "promote"])
    expect(mk).toMatch(new RegExp(`bash scripts/run_from_main\\.sh agent_tree\\.sh ${sub} `));
  expect(mk).not.toMatch(/bash scripts\/agent_tree\.sh (create|status|stamp|promote)/);
});

test("agent_tree.sh takes its home from FSR_TOOL_HOME", () => {
  expect(fs.readFileSync(path.join(ROOT, "scripts", "agent_tree.sh"), "utf8")).toMatch(/^HERE="\$\{FSR_TOOL_HOME:-/m);
});
