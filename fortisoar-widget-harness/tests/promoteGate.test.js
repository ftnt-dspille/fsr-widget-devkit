"use strict";
// R1: a feature branch reaches main only after live confirmation (TESTING.md,
// "Guardrails"). Two layers, both exercised here against a throwaway git repo
// and a fake stamp dir (FSR_LIVE_SANITY_DIR):
//   - make promote (scripts/promote.sh): the one front door; needs a VERIFIED,
//     clean stamp for the branch head.
//   - scripts/githooks/reference-transaction: refuses every other update of main
//     under CLAUDECODE, fast-forwards included. (`git update-ref` plumbing does
//     not run the hook; a permission deny rule covers the usual spelling.)

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

let tmp, repo, stamps;
function git(args, env = {}) {
  const r = spawnSync("git", ["-C", repo, ...args], { env: baseEnv(env), encoding: "utf8" });
  return { code: r.status, out: `${r.stdout || ""}${r.stderr || ""}` };
}
function sha(ref) { return execFileSync("git", ["-C", repo, "rev-parse", ref], { encoding: "utf8" }).trim(); }
function commit(file, msg) {
  fs.writeFileSync(path.join(repo, file), msg + "\n");
  expect(git(["add", file]).code).toBe(0);
  const r = git(["commit", "-q", "-m", msg]);
  expect(r.code).toBe(0);
}
function stamp(s, fields) {
  const d = path.join(stamps, "promote-fixture");
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, `${s}.json`), JSON.stringify({
    repo: "promote-fixture", branch: "feat/x", sha: s, dirty: false, box: "box-a",
    verdict: "VERIFIED", checks: [], timestamp: "2026-01-01T00:00:00Z", ...fields }));
}
function promote(env = {}) {
  const r = spawnSync("make", ["-s", "promote", `REPO=${repo}`, "BRANCH=feat/x"],
    { cwd: ROOT, env: baseEnv({ FSR_LIVE_SANITY_DIR: stamps, ...env }), encoding: "utf8", timeout: 60000 });
  return { code: r.status, out: `${r.stdout || ""}${r.stderr || ""}` };
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "promote-"));
  repo = path.join(tmp, "promote-fixture");
  stamps = path.join(tmp, "stamps");
  fs.mkdirSync(repo);
  expect(git(["init", "-q", "-b", "main"]).code).toBe(0);
  // Setup commits skip all hooks (an empty hooks dir); the slow global content
  // scan would otherwise run per commit. The guard is installed afterwards.
  fs.mkdirSync(path.join(tmp, "nohooks"));
  expect(git(["config", "core.hooksPath", path.join(tmp, "nohooks")]).code).toBe(0);
  commit("a.txt", "base");
  expect(git(["checkout", "-q", "-b", "feat/x"]).code).toBe(0);
  commit("b.txt", "feature");
  expect(git(["checkout", "-q", "main"]).code).toBe(0);
  expect(git(["config", "core.hooksPath", HOOKS]).code).toBe(0);
  expect(git(["config", "hooks.customerCheck", "false"]).code).toBe(0);
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("make promote", () => {
  test("refuses without a stamp; main unchanged", () => {
    const before = sha("main");
    const r = promote({ CLAUDECODE: "1" });
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/refusing: no stamp/);
    expect(sha("main")).toBe(before);
  });

  test.each([
    ["PARTIAL", { verdict: "PARTIAL" }, /verdict is 'PARTIAL'/],
    ["FAIL", { verdict: "FAIL" }, /verdict is 'FAIL'/],
    ["dirty VERIFIED", { dirty: true }, /dirty tree/],
  ])("refuses a %s stamp; main unchanged", (_n, fields, msg) => {
    const before = sha("main");
    stamp(sha("feat/x"), fields);
    const r = promote({ CLAUDECODE: "1" });
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(msg);
    expect(sha("main")).toBe(before);
  });

  test("a stamp for some other commit does not count", () => {
    stamp(sha("main"), {});
    const r = promote({ CLAUDECODE: "1" });
    expect(r.code).not.toBe(0);
    expect(sha("main")).not.toBe(sha("feat/x"));
  });

  test("fast-forwards main with a VERIFIED clean stamp, under CLAUDECODE, through the hook", () => {
    stamp(sha("feat/x"), {});
    const r = promote({ CLAUDECODE: "1" });
    expect(r.out).toMatch(/fast-forward/);
    expect(r.out).toMatch(/box=box-a verdict=VERIFIED ts=2026-01-01T00:00:00Z/);
    expect(r.code).toBe(0);
    expect(sha("main")).toBe(sha("feat/x"));
    expect(fs.existsSync(path.join(repo, "b.txt"))).toBe(true); // checkout moved too
  });

  test("diverged main: merge commit built aside; unrelated WIP in the main checkout survives", () => {
    commit("c.txt", "main moved");
    fs.writeFileSync(path.join(repo, "a.txt"), "someone's WIP\n");
    stamp(sha("feat/x"), {});
    const r = promote({ CLAUDECODE: "1" });
    expect(r.out).toMatch(/merge commit/);
    expect(r.code).toBe(0);
    expect(sha("main^2")).toBe(sha("feat/x"));
    expect(fs.readFileSync(path.join(repo, "a.txt"), "utf8")).toBe("someone's WIP\n");
    expect(git(["log", "-1", "--format=%B", "main"]).out).not.toMatch(/Co-Authored-By|Claude/);
  });

  test("ALLOW_UNVERIFIED=1 is refused under Claude Code, honored for a human", () => {
    const before = sha("main");
    const a = promote({ CLAUDECODE: "1", ALLOW_UNVERIFIED: "1" });
    expect(a.code).not.toBe(0);
    expect(a.out).toMatch(/human-only override/);
    expect(sha("main")).toBe(before);
    const h = promote({ ALLOW_UNVERIFIED: "1" });
    expect(h.code).toBe(0);
    expect(sha("main")).toBe(sha("feat/x"));
  });
});

describe("reference-transaction hook", () => {
  test.each([
    ["fast-forward merge", ["merge", "-q", "--ff-only", "feat/x"]],
    ["merge commit", ["merge", "-q", "--no-ff", "-m", "m", "feat/x"]],
    ["reset", ["reset", "-q", "--hard", "feat/x"]],
  ])("refuses %s into main under CLAUDECODE", (_n, args) => {
    const before = sha("main");
    const r = git(args, { CLAUDECODE: "1" });
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/make promote/);
    expect(sha("main")).toBe(before);
  });

  test("refuses a commit on main under CLAUDECODE", () => {
    const before = sha("main");
    fs.writeFileSync(path.join(repo, "d.txt"), "x\n");
    git(["add", "d.txt"]);
    const r = git(["commit", "-q", "-m", "on main"], { CLAUDECODE: "1" });
    expect(r.code).not.toBe(0);
    expect(sha("main")).toBe(before);
  });

  test("allows branch work under CLAUDECODE and main updates for a human", () => {
    expect(git(["checkout", "-q", "feat/x"], { CLAUDECODE: "1" }).code).toBe(0);
    fs.writeFileSync(path.join(repo, "e.txt"), "x\n");
    git(["add", "e.txt"]);
    expect(git(["commit", "-q", "-m", "branch work"], { CLAUDECODE: "1" }).code).toBe(0);
    expect(git(["checkout", "-q", "main"]).code).toBe(0);
    expect(git(["merge", "-q", "--ff-only", "feat/x"]).code).toBe(0);
    expect(sha("main")).toBe(sha("feat/x"));
  });
});
