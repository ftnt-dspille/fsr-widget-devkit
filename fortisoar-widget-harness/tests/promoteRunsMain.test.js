"use strict";
// make promote runs promote.sh from the repo's remote main, not the checkout's
// branch (scripts/promote_main.sh). Live: a promote from the shared checkout,
// which was on another session's branch, skipped the CI gate main already had.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync, execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.com", GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "core.hooksPath",
  GIT_CONFIG_VALUE_0: "/dev/null" };
delete ENV.PROMOTE_FROM_TREE;
let T, repo;
const g = (...a) => execFileSync("git", ["-C", repo, ...a], { env: ENV, encoding: "utf8" });
const put = (body) => fs.writeFileSync(path.join(repo, "scripts", "promote.sh"), `echo ${body}\n`);

beforeEach(() => {
  T = fs.mkdtempSync(path.join(os.tmpdir(), "promote-main-"));
  repo = path.join(T, "r");
  fs.mkdirSync(path.join(repo, "scripts"), { recursive: true });
  fs.copyFileSync(path.join(ROOT, "scripts", "promote_main.sh"), path.join(repo, "scripts", "promote_main.sh"));
  g("init", "-q", "-b", "main");
  put("FROM-MAIN"); g("add", "-A"); g("commit", "-q", "-m", "main");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", path.join(T, "remote.git")], { env: ENV });
  g("remote", "add", "origin", path.join(T, "remote.git")); g("push", "-q", "-u", "origin", "main");
  g("checkout", "-q", "-b", "someone/else"); put("FROM-THEIR-BRANCH"); g("commit", "-qam", "theirs");
  put("FROM-WIP");
});
afterEach(() => fs.rmSync(T, { recursive: true, force: true }));

const run = (env = {}) => spawnSync("bash", [path.join(repo, "scripts", "promote_main.sh")],
  { env: { ...ENV, ...env }, encoding: "utf8" });

test("runs the remote main's promote.sh, whatever branch and WIP the checkout has", () => {
  const r = run();
  expect(r.status).toBe(0);
  expect(r.stdout).toMatch(/FROM-MAIN/);
  expect(r.stdout).not.toMatch(/FROM-THEIR-BRANCH|FROM-WIP/);
});

test("PROMOTE_FROM_TREE=1 runs the working-tree copy (for developing promote.sh)", () => {
  expect(run({ PROMOTE_FROM_TREE: "1" }).stdout).toMatch(/FROM-WIP/);
});

test("the make target goes through the wrapper", () => {
  expect(fs.readFileSync(path.join(ROOT, "Makefile"), "utf8")).toMatch(/^promote:.*\n\t@bash scripts\/lap\.sh promote --budget \d+ -- bash scripts\/promote_main\.sh$/m);
});
