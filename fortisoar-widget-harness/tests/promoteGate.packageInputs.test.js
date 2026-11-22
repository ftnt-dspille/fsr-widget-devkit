"use strict";
// make promote: "shipped" means "changes what is installed on a box". For a repo
// with a package-input table (in the promote script), only paths under those inputs
// are shipped; dev scripts, tests, the Makefile and docs are tooling (CI is the
// proof). REPO may also be a name, resolved by scripts/repo_paths.sh.
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { S, git, promote, ROOT, beforeEachFixture, afterEachFixture } = require("./promoteGate.helpers");

let bin;
const put = (f, body) => { fs.mkdirSync(path.dirname(path.join(S.repo, f)), { recursive: true }); fs.writeFileSync(path.join(S.repo, f), body); };
const ok = (r) => expect(r.code).toBe(0);
const commitAll = (msg) => { ok(git(["add", "-A"])); ok(git(["commit", "-q", "-m", msg])); };

beforeEach(() => {
  beforeEachFixture();
  // The table is keyed by the repo's name: make the fixture the connector's.
  const dest = path.join(S.tmp, "conn_main");
  fs.renameSync(S.repo, dest); S.repo = dest;
  ok(git(["config", "core.hooksPath", path.join(S.tmp, "nohooks")]));
  put(".github/required-checks", "tooling\n");
  put("connector-fsr-agentic-assistant/connector.py", "c\n");
  put("connector-fsr-agentic-assistant/requirements.txt", "r==1\n");
  put("scripts/live_autonomy.py", "l\n"); put("tests/t.py", "t\n"); put("Makefile", "m\n"); put("docs/a.md", "d\n");
  commitAll("base");
  ok(git(["remote", "add", "origin", "https://github.com/o/r.git"]));
  ok(git(["update-ref", "refs/remotes/origin/main", "main"]));
  ok(git(["config", "branch.main.remote", "origin"]));
  ok(git(["config", "branch.main.merge", "refs/heads/main"]));
  ok(git(["branch", "-f", "feat/x", "main"]));
  ok(git(["checkout", "-q", "feat/x"]));
  bin = path.join(S.tmp, "bin"); fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "gh"), `#!/bin/sh\nprintf 'tooling\\tcompleted\\tsuccess\\n'\n`, { mode: 0o755 });
});
afterEach(afterEachFixture);

const run = () => { ok(git(["checkout", "-q", "main"])); return promote({ NO_PUSH: "1", CLASSIFY_ONLY: "1", PATH: `${bin}:${process.env.PATH}` }); };

test("scripts, tests, Makefile and docs only: tooling", () => {
  put("scripts/live_autonomy.py", "l2\n"); put("tests/t.py", "t2\n"); put("Makefile", "m2\n"); put("docs/a.md", "d2\n");
  commitAll("tooling");
  const r = run();
  expect(r.out).toMatch(/classified tooling \(all 4 path\(s\) are outside conn_main's package inputs/);
  expect(r.code).toBe(0);
});

test("a path in the package dir is shipped, naming it", () => {
  put("scripts/live_autonomy.py", "l2\n"); put("connector-fsr-agentic-assistant/connector.py", "c2\n"); commitAll("mixed");
  const r = run();
  expect(r.out).toMatch(/classified shipped \(package input path\(s\): connector-fsr-agentic-assistant\/connector\.py\)/);
});

test("build.sh and the deploy scripts are shipped (they decide what lands on a box); dev scripts stay tooling", () => {
  const reset = () => { ok(git(["checkout", "-q", "feat/x"])); ok(git(["reset", "-q", "--hard", "main"])); };
  put("scripts/build.sh", "b\n"); commitAll("build");
  expect(run().out).toMatch(/classified shipped \(package input path\(s\): scripts\/build\.sh\)/);
  reset(); put("scripts/deploy.sh", "d\n"); commitAll("deploy");
  expect(run().out).toMatch(/classified shipped \(package input path\(s\): scripts\/deploy\.sh\)/);
  reset(); put("connector-fsr-agentic-assistant/requirements.txt", "r==2\n"); commitAll("req");
  expect(run().out).toMatch(/classified shipped/);
  reset(); put("scripts/live_autonomy.py", "l3\n"); commitAll("dev script");
  expect(run().out).toMatch(/classified tooling/);
});

test("the inputs come from the shared .github/package-inputs file, the one stable_guard.py also reads", () => {
  const f = path.join(ROOT, ".github", "package-inputs");
  const rows = fs.readFileSync(f, "utf8").split("\n").map((l) => l.replace(/#.*/, "").trim().split(/\s+/)).filter((r) => r.length === 3);
  expect(rows.filter((r) => r[0] === "conn_main" && r[1] === "ship").map((r) => r[2])).toEqual(
    expect.arrayContaining(["connector-fsr-agentic-assistant", "scripts/build.sh", "scripts/deploy.sh"]));
  expect(rows.some((r) => r[0] === "conn_main" && r[1] === "extra" && r[2] === "scripts")).toBe(true);
  // the promote script carries no table of its own
  expect(fs.readFileSync(path.join(ROOT, "scripts", "promote.sh"), "utf8")).not.toMatch(/connector-fsr-agentic-assistant/);
});

test("a rename out of the package dir is shipped", () => {
  ok(git(["mv", "connector-fsr-agentic-assistant/requirements.txt", "docs/req.txt"])); commitAll("move");
  expect(run().out).toMatch(/classified shipped/);
});

test("a change to .github (the policy) is shipped", () => {
  put(".github/required-checks", "x\n"); commitAll("policy");
  expect(run().out).toMatch(/classified shipped \(package input path\(s\): \.github\/required-checks\)/);
});

test("an empty diff is not tooling", () => {
  ok(git(["commit", "-q", "--allow-empty", "-m", "empty"]));
  expect(run().out).toMatch(/classified shipped \(package input path\(s\): \(empty diff\)\)/);
});

// --- REPO as a name ---------------------------------------------------------
const rp = (args, env = {}, cwd = ROOT) => {
  const e = { ...process.env }; delete e.AGENT_TREE; Object.assign(e, env);
  const r = spawnSync("bash", [path.join(ROOT, "scripts", "repo_paths.sh"), ...args], { cwd, env: e, encoding: "utf8" });
  return { code: r.status, out: (r.stdout || "").trim(), err: r.stderr || "" };
};

test("an agent tree resolves every name to the tree's own copy", () => {
  const env = { AGENT_TREE: "/t/x", CONN_REPO: "/t/x/connector", FSR_FRAMEWORK_REPO: "/t/x/framework" };
  expect(rp(["resolve", "connector"], env).out).toBe("/t/x/connector");
  expect(rp(["resolve", "framework"], env).out).toBe("/t/x/framework");
  expect(rp(["resolve", "root"], env).out).toBe("/t/x/root");
  expect(rp(["resolve", "agenticAssistant"], env).out).toBe("/t/x/root/widgets-src/agenticAssistant");
});

test("inside a worktree of another repo, a name is ambiguous and asks for a path", () => {
  const wt = path.join(S.tmp, "wt_other");
  ok(git(["worktree", "add", "-q", "--detach", wt, "main"]));
  const r = rp(["resolve", "framework"], { CONN_REPO: "", FSR_FRAMEWORK_REPO: "", FSR_MONOREPO: "" }, wt);
  expect(r.code).toBe(3);
  expect(r.err).toMatch(/Pass the path: REPO=<path>/);
});

test("an unknown name is refused", () => {
  expect(rp(["resolve", "nope"]).code).toBe(2);
});
