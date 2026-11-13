"use strict";
// scripts/install-git-hooks.sh --chain: the main-only-via-promote guard in repos
// that already have their own hooks (a framework-style repo whose active hooks are
// the GLOBAL dir plus .git/hooks, and a connector-style bare repo with a relative
// repo-local core.hooksPath and main checked out in a separate worktree). Every
// pre-existing hook must keep running, and make promote must still get through.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const INSTALL = path.join(ROOT, "scripts", "install-git-hooks.sh");

let tmp, stamps, globalCfg, globalHooks;
function env(extra = {}) {
  const e = { ...process.env };
  for (const k of ["CLAUDECODE", "FSR_HOOK_SHIM", "GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "ALLOW_UNVERIFIED"]) delete e[k];
  return { ...e, GIT_CONFIG_GLOBAL: globalCfg, GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com", ...extra };
}
function run(cmd, args, cwd, extra = {}, input) {
  const r = spawnSync(cmd, args, { cwd, env: env(extra), encoding: "utf8", input, timeout: 60000 });
  return { code: r.status, out: `${r.stdout || ""}${r.stderr || ""}` };
}
const git = (cwd, args, extra) => run("git", args, cwd, extra);
const sha = (cwd, ref) => git(cwd, ["rev-parse", ref]).out.trim();
function hook(dir, name, marker) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), `#!/usr/bin/env bash\necho ${name} >> "${marker}"\nexit 0\n`, { mode: 0o755 });
}
function stamp(repoName, s) {
  const d = path.join(stamps, repoName);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, `${s}.json`), JSON.stringify({ repo: repoName, branch: "feat/x", sha: s, dirty: false, box: "b", verdict: "VERIFIED", checks: [], timestamp: "t" }));
}
function promote(repo, extra = {}) {
  return run("make", ["-s", "promote", `REPO=${repo}`, "BRANCH=feat/x"], ROOT, { FSR_LIVE_SANITY_DIR: stamps, CLAUDECODE: "1", ...extra });
}

// Shared assertions once the guard is installed; `wt` is a checkout with main checked out.
function guardBehaviour(wt, marker, repoName) {
  const before = sha(wt, "main");
  const cc = { CLAUDECODE: "1" };
  expect(git(wt, ["merge", "-q", "--ff-only", "feat/x"], cc).code).not.toBe(0);
  const ur = git(wt, ["update-ref", "refs/heads/main", sha(wt, "feat/x")], cc);   // no <old> given
  expect(ur.code).not.toBe(0);
  expect(ur.out).toMatch(/make promote/);
  expect(git(wt, ["branch", "-f", "main", "feat/x"], cc).code).not.toBe(0);
  expect(sha(wt, "main")).toBe(before);
  // a refused merge has already written feat/x's files into the checkout (ref update is last)
  git(wt, ["checkout", "-q", "-f", "HEAD"]); git(wt, ["clean", "-fdq"]);

  // branch commit and a merge into an integ branch are allowed, and the pre-existing hooks run
  fs.writeFileSync(marker, "");
  expect(git(wt, ["checkout", "-q", "-b", "integ/y", "main"], cc).code).toBe(0);
  expect(git(wt, ["merge", "-q", "--no-ff", "-m", "m", "feat/x"], cc).code).toBe(0);
  expect(git(wt, ["checkout", "-q", "main"], cc).code).toBe(0);

  // a human is never refused (checked last: it moves main)
  const h = git(wt, ["merge", "-q", "--ff-only", "integ/y"]);
  expect(h.code).toBe(0);
  git(wt, ["reset", "-q", "--hard", before]);
  expect(sha(wt, "main")).toBe(before);

  // make promote still gets through under Claude Code
  stamp(repoName, sha(wt, "feat/x"));
  const p = promote(wt);
  expect(p.out).toMatch(/merged feat\/x/);
  expect(sha(wt, "main")).toBe(sha(wt, "feat/x"));
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "guard-other-"));
  stamps = path.join(tmp, "stamps");
  globalHooks = path.join(tmp, "globalhooks");
  globalCfg = path.join(tmp, "gitconfig");
  fs.writeFileSync(globalCfg, `[core]\n\thooksPath = ${globalHooks}\n`);
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

function seed(repo) {   // main with one commit, feat/x one commit ahead; no hooks yet
  fs.mkdirSync(repo, { recursive: true });
  git(repo, ["init", "-q", "-b", "main"]);
  fs.mkdirSync(path.join(tmp, "empty"), { recursive: true });
  git(repo, ["config", "core.hooksPath", path.join(tmp, "empty")]);
  fs.writeFileSync(path.join(repo, "a.txt"), "a\n");
  git(repo, ["add", "."]); git(repo, ["commit", "-q", "-m", "base"]);
  git(repo, ["checkout", "-q", "-b", "feat/x"]);
  fs.writeFileSync(path.join(repo, "b.txt"), "b\n");
  git(repo, ["add", "."]); git(repo, ["commit", "-q", "-m", "feat"]);
  git(repo, ["checkout", "-q", "main"]);
  git(repo, ["config", "--unset", "core.hooksPath"]);
}

test("framework layout: global hooks dir + .git/hooks both keep running behind the guard", () => {
  const repo = path.join(tmp, "fw");
  seed(repo);
  const marker = path.join(tmp, "ran.txt");
  hook(globalHooks, "pre-commit", marker); hook(globalHooks, "pre-push", marker);
  hook(path.join(repo, ".git", "hooks"), "pre-commit", marker);    // stands in for the pre-commit framework hook
  const i = run("bash", [INSTALL, "--chain", repo], ROOT);
  expect(i.code).toBe(0);
  expect(git(repo, ["config", "--local", "--get", "core.hooksPath"]).out.trim()).toBe(path.join(repo, ".git", "fsr-guard-hooks"));
  guardBehaviour(repo, marker, "fw");
  // both the global and the repo's own pre-commit ran for a commit (a plain commit; a merge commit runs neither)
  fs.writeFileSync(marker, "");
  git(repo, ["checkout", "-q", "-b", "feat/z"], { CLAUDECODE: "1" });
  fs.writeFileSync(path.join(repo, "z.txt"), "z\n");
  git(repo, ["add", "z.txt"]);
  expect(git(repo, ["commit", "-q", "-m", "z"], { CLAUDECODE: "1" }).code).toBe(0);
  expect(fs.readFileSync(marker, "utf8").trim().split("\n")).toEqual(["pre-commit", "pre-commit"]);
  // pre-push gets its stdin through the shim
  const pp = run(path.join(repo, ".git", "fsr-guard-hooks", "pre-push"), ["origin", "url"], repo, {}, "refs/heads/a 1 refs/heads/a 0\n");
  expect(pp.code).toBe(0);
  // re-running keeps the recorded original (empty) rather than recording the guard dir
  run("bash", [INSTALL, "--chain", repo], ROOT);
  expect(git(repo, ["config", "--local", "--get", "fsr.guardOriginalHooksPath"]).out.trim()).toBe("");
});

test("connector layout: bare repo, relative scripts/hooks, main in a separate worktree", () => {
  const seedRepo = path.join(tmp, "seed");
  seed(seedRepo);
  const marker = path.join(tmp, "ran.txt");
  hook(path.join(seedRepo, "scripts", "hooks"), "pre-commit", marker);
  hook(path.join(seedRepo, "scripts", "hooks"), "pre-push", marker);
  git(seedRepo, ["checkout", "-q", "main"]);
  git(seedRepo, ["add", "-f", "scripts"]); git(seedRepo, ["commit", "-q", "-m", "hooks"]);
  git(seedRepo, ["checkout", "-q", "-B", "feat/x", "main"]);
  fs.writeFileSync(path.join(seedRepo, "b.txt"), "b\n");
  git(seedRepo, ["add", "."]); git(seedRepo, ["commit", "-q", "-m", "feat"]);
  git(seedRepo, ["checkout", "-q", "main"]);
  const bare = path.join(tmp, "bare.git");
  expect(run("git", ["clone", "-q", "--bare", seedRepo, bare], tmp).code).toBe(0);
  const wt = path.join(tmp, "conn_main");
  expect(git(bare, ["worktree", "add", "-q", wt, "main"]).code).toBe(0);
  git(bare, ["config", "core.hooksPath", "scripts/hooks"]);
  const i = run("bash", [INSTALL, "--chain", bare], ROOT);
  expect(i.code).toBe(0);
  expect(git(bare, ["config", "--local", "--get", "fsr.guardOriginalHooksPath"]).out.trim()).toBe("scripts/hooks");
  guardBehaviour(wt, marker, "bare.git");
  // the repo's own pre-commit runs (and the global one does NOT: it was not active before)
  fs.writeFileSync(marker, "");
  hook(globalHooks, "pre-commit", path.join(tmp, "global-ran.txt"));
  git(wt, ["checkout", "-q", "-b", "feat/z"], { CLAUDECODE: "1" });
  fs.writeFileSync(path.join(wt, "z.txt"), "z\n");
  git(wt, ["add", "z.txt"]);
  expect(git(wt, ["commit", "-q", "-m", "z"], { CLAUDECODE: "1" }).code).toBe(0);
  expect(fs.readFileSync(marker, "utf8").trim()).toBe("pre-commit");
  expect(fs.existsSync(path.join(tmp, "global-ran.txt"))).toBe(false);
});
