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
const path = require("path");
const { S, git, sha, commit, stamp, promote, beforeEachFixture, afterEachFixture } = require("./promoteGate.helpers");

beforeEach(beforeEachFixture);
afterEach(afterEachFixture);

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
    fs.writeFileSync(path.join(S.repo, "d.txt"), "x\n");
    git(["add", "d.txt"]);
    const r = git(["commit", "-q", "-m", "on main"], { CLAUDECODE: "1" });
    expect(r.code).not.toBe(0);
    expect(sha("main")).toBe(before);
  });

  test("allows branch work under CLAUDECODE and main updates for a human", () => {
    expect(git(["checkout", "-q", "feat/x"], { CLAUDECODE: "1" }).code).toBe(0);
    fs.writeFileSync(path.join(S.repo, "e.txt"), "x\n");
    git(["add", "e.txt"]);
    expect(git(["commit", "-q", "-m", "branch work"], { CLAUDECODE: "1" }).code).toBe(0);
    expect(git(["checkout", "-q", "main"]).code).toBe(0);
    expect(git(["merge", "-q", "--ff-only", "feat/x"]).code).toBe(0);
    expect(sha("main")).toBe(sha("feat/x"));
  });
});
