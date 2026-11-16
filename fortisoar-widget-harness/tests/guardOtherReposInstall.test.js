"use strict";
// scripts/install-git-hooks.sh --chain: the main-only-via-promote guard in a framework-style repo (global hooks dir + .git/hooks);
// every pre-existing hook must keep running, and make promote must still get through.
// (fixture shared with the sibling layout suite: guardOtherReposInstall.helpers.js)
const fs = require("fs");
const path = require("path");
const { S, ROOT, INSTALL, git, run, sha, hook, guardBehaviour, seed, setup, teardown } = require("./guardOtherReposInstall.helpers");

beforeEach(setup);
afterEach(teardown);

test("framework layout: global hooks dir + .git/hooks both keep running behind the guard", () => {
  const repo = path.join(S.tmp, "fw");
  seed(repo);
  const marker = path.join(S.tmp, "ran.txt");
  hook(S.globalHooks, "pre-commit", marker); hook(S.globalHooks, "pre-push", marker);
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

