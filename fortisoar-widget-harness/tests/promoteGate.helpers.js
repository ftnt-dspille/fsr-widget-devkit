"use strict";
// Shared fixture for promoteGate.test.js (make promote) and promoteGate.hook.test.js
// (the reference-transaction hook): split so jest runs the two halves in parallel
// workers. Not a test file itself. A throwaway git repo plus a fake stamp dir.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync, execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const HOOKS = path.join(ROOT, "scripts", "githooks");

function baseEnv(extra = {}) {
  const e = { ...process.env };
  for (const k of ["CLAUDECODE", "CONFIRM_DEPLOY", "VIA_MAKE", "ALLOW_UNVERIFIED", "GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"]) delete e[k];
  return { ...e, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com", ...extra };
}

const S = {};
function git(args, env = {}) {
  const r = spawnSync("git", ["-C", S.repo, ...args], { env: baseEnv(env), encoding: "utf8" });
  return { code: r.status, out: `${r.stdout || ""}${r.stderr || ""}` };
}
function sha(ref) { return execFileSync("git", ["-C", S.repo, "rev-parse", ref], { encoding: "utf8" }).trim(); }
function commit(file, msg) {
  fs.writeFileSync(path.join(S.repo, file), msg + "\n");
  expect(git(["add", file]).code).toBe(0);
  const r = git(["commit", "-q", "-m", msg]);
  expect(r.code).toBe(0);
}
function stamp(s, fields) {
  const d = path.join(S.stamps, "promote-fixture");
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, `${s}.json`), JSON.stringify({
    repo: "promote-fixture", branch: "feat/x", sha: s, dirty: false, box: "box-a",
    verdict: "VERIFIED", checks: [], timestamp: "2026-01-01T00:00:00Z", ...fields }));
}
function promote(env = {}) {
  const r = spawnSync("make", ["-s", "promote", `REPO=${S.repo}`, "BRANCH=feat/x"],
    { cwd: ROOT, env: baseEnv({ FSR_LIVE_SANITY_DIR: S.stamps, ...env }), encoding: "utf8", timeout: Number(process.env.MAKE_SPAWN_TIMEOUT_MS) || 60000 });
  return { code: r.status, out: `${r.stdout || ""}${r.stderr || ""}` };
}


const beforeEachFixture = () => {

  S.tmp = fs.mkdtempSync(path.join(os.tmpdir(), "promote-"));
  S.repo = path.join(S.tmp, "promote-fixture");
  S.stamps = path.join(S.tmp, "stamps");
  fs.mkdirSync(S.repo);
  expect(git(["init", "-q", "-b", "main"]).code).toBe(0);
  // Setup commits skip all hooks (an empty hooks dir); the slow global content
  // scan would otherwise run per commit. The guard is installed afterwards.
  fs.mkdirSync(path.join(S.tmp, "nohooks"));
  expect(git(["config", "core.hooksPath", path.join(S.tmp, "nohooks")]).code).toBe(0);
  commit("a.txt", "base");
  expect(git(["checkout", "-q", "-b", "feat/x"]).code).toBe(0);
  commit("b.txt", "feature");
  expect(git(["checkout", "-q", "main"]).code).toBe(0);
  expect(git(["config", "core.hooksPath", HOOKS]).code).toBe(0);
  expect(git(["config", "hooks.customerCheck", "false"]).code).toBe(0);
};
const afterEachFixture = () => fs.rmSync(S.tmp, { recursive: true, force: true });

module.exports = { S, HOOKS, ROOT, git, sha, commit, stamp, promote, beforeEachFixture, afterEachFixture };
