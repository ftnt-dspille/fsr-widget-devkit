"use strict";
// scripts/install-git-hooks.sh --chain: the main-only-via-promote guard in a connector-style bare repo (relative repo-local
// core.hooksPath, main in a separate worktree); every pre-existing hook must keep running,
// and make promote must still get through.
// (fixture shared with the sibling layout suite: guardOtherReposInstall.helpers.js)
const fs = require("fs");
const path = require("path");
const { S, ROOT, INSTALL, git, run, sha, hook, guardBehaviour, seed, setup, teardown } = require("./guardOtherReposInstall.helpers");

beforeEach(setup);
afterEach(teardown);

test("connector layout: bare repo, relative scripts/hooks, main in a separate worktree", () => {
  const seedRepo = path.join(S.tmp, "seed");
  seed(seedRepo);
  const marker = path.join(S.tmp, "ran.txt");
  hook(path.join(seedRepo, "scripts", "hooks"), "pre-commit", marker);
  hook(path.join(seedRepo, "scripts", "hooks"), "pre-push", marker);
  git(seedRepo, ["checkout", "-q", "main"]);
  git(seedRepo, ["add", "-f", "scripts"]); git(seedRepo, ["commit", "-q", "-m", "hooks"]);
  git(seedRepo, ["checkout", "-q", "-B", "feat/x", "main"]);
  fs.writeFileSync(path.join(seedRepo, "b.txt"), "b\n");
  git(seedRepo, ["add", "."]); git(seedRepo, ["commit", "-q", "-m", "feat"]);
  git(seedRepo, ["checkout", "-q", "main"]);
  const bare = path.join(S.tmp, "bare.git");
  expect(run("git", ["clone", "-q", "--bare", seedRepo, bare], S.tmp).code).toBe(0);
  const wt = path.join(S.tmp, "conn_main");
  expect(git(bare, ["worktree", "add", "-q", wt, "main"]).code).toBe(0);
  git(bare, ["config", "core.hooksPath", "scripts/hooks"]);
  const i = run("bash", [INSTALL, "--chain", bare], ROOT);
  expect(i.code).toBe(0);
  expect(git(bare, ["config", "--local", "--get", "fsr.guardOriginalHooksPath"]).out.trim()).toBe("scripts/hooks");
  guardBehaviour(wt, marker, "bare.git");
  // the repo's own pre-commit runs (and the global one does NOT: it was not active before)
  fs.writeFileSync(marker, "");
  hook(S.globalHooks, "pre-commit", path.join(S.tmp, "global-ran.txt"));
  git(wt, ["checkout", "-q", "-b", "feat/z"], { CLAUDECODE: "1" });
  fs.writeFileSync(path.join(wt, "z.txt"), "z\n");
  git(wt, ["add", "z.txt"]);
  expect(git(wt, ["commit", "-q", "-m", "z"], { CLAUDECODE: "1" }).code).toBe(0);
  expect(fs.readFileSync(marker, "utf8").trim()).toBe("pre-commit");
  expect(fs.existsSync(path.join(S.tmp, "global-ran.txt"))).toBe(false);
});
