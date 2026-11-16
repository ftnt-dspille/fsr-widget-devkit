"use strict";
// Shared fixture for the guardOtherReposInstall.*.test.js suites (one per layout, so
// jest runs the two slow git-spawning scenarios in parallel workers instead of
// back to back). Not a test file itself.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const INSTALL = path.join(ROOT, "scripts", "install-git-hooks.sh");

const S = {};   // S.tmp, S.stamps, S.globalCfg, S.globalHooks of the running test
function env(extra = {}) {
  const e = { ...process.env };
  for (const k of ["CLAUDECODE", "FSR_HOOK_SHIM", "GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "ALLOW_UNVERIFIED"]) delete e[k];
  return { ...e, GIT_CONFIG_GLOBAL: S.globalCfg, GIT_CONFIG_NOSYSTEM: "1",
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
  const d = path.join(S.stamps, repoName);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, `${s}.json`), JSON.stringify({ repo: repoName, branch: "feat/x", sha: s, dirty: false, box: "b", verdict: "VERIFIED", checks: [], timestamp: "t" }));
}
function promote(repo, extra = {}) {
  return run("make", ["-s", "promote", `REPO=${repo}`, "BRANCH=feat/x"], ROOT, { FSR_LIVE_SANITY_DIR: S.stamps, CLAUDECODE: "1", ...extra });
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

function seed(repo) {   // main with one commit, feat/x one commit ahead; no hooks yet
  fs.mkdirSync(repo, { recursive: true });
  git(repo, ["init", "-q", "-b", "main"]);
  fs.mkdirSync(path.join(S.tmp, "empty"), { recursive: true });
  git(repo, ["config", "core.hooksPath", path.join(S.tmp, "empty")]);
  fs.writeFileSync(path.join(repo, "a.txt"), "a\n");
  git(repo, ["add", "."]); git(repo, ["commit", "-q", "-m", "base"]);
  git(repo, ["checkout", "-q", "-b", "feat/x"]);
  fs.writeFileSync(path.join(repo, "b.txt"), "b\n");
  git(repo, ["add", "."]); git(repo, ["commit", "-q", "-m", "feat"]);
  git(repo, ["checkout", "-q", "main"]);
  git(repo, ["config", "--unset", "core.hooksPath"]);
}

function setup() {
  S.tmp = fs.mkdtempSync(path.join(os.tmpdir(), "guard-other-"));
  S.stamps = path.join(S.tmp, "stamps");
  S.globalHooks = path.join(S.tmp, "globalhooks");
  S.globalCfg = path.join(S.tmp, "gitconfig");
  fs.writeFileSync(S.globalCfg, `[core]\n\thooksPath = ${S.globalHooks}\n`);
}
function teardown() { fs.rmSync(S.tmp, { recursive: true, force: true }); }


module.exports = { S, ROOT, INSTALL, git, run, sha, hook, stamp, promote, guardBehaviour, seed, setup, teardown };
