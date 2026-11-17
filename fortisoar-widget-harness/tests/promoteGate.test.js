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
    expect(fs.existsSync(path.join(S.repo, "b.txt"))).toBe(true); // checkout moved too
  });

  test("diverged main: merge commit built aside; unrelated WIP in the main checkout survives", () => {
    commit("c.txt", "main moved");
    fs.writeFileSync(path.join(S.repo, "a.txt"), "someone's WIP\n");
    stamp(sha("feat/x"), {});
    const r = promote({ CLAUDECODE: "1" });
    expect(r.out).toMatch(/merge commit/);
    expect(r.code).toBe(0);
    expect(sha("main^2")).toBe(sha("feat/x"));
    expect(fs.readFileSync(path.join(S.repo, "a.txt"), "utf8")).toBe("someone's WIP\n");
    expect(git(["log", "-1", "--format=%B", "main"]).out).not.toMatch(/Co-Authored-By|Claude/);
  });

  test("pushes the promoted main to its upstream; NO_PUSH=1 leaves the remote alone", () => {
    const remote = path.join(path.dirname(S.repo), "remote.git");
    require("child_process").execFileSync("git", ["init", "-q", "--bare", "-b", "main", remote]);
    git(["remote", "add", "up", remote]);
    git(["push", "-q", "up", "main"]);
    git(["branch", "--set-upstream-to=up/main", "main"]);
    const remoteMain = () => require("child_process").execFileSync("git", ["-C", remote, "rev-parse", "main"]).toString().trim();
    const before = remoteMain();
    stamp(sha("feat/x"), {});

    const held = promote({ CLAUDECODE: "1", NO_PUSH: "1" });
    expect(held.code).toBe(0);
    expect(held.out).toMatch(/NO_PUSH=1/);
    expect(remoteMain()).toBe(before);

    const r = promote({ CLAUDECODE: "1" });
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/pushing main to up\/main/);
    expect(remoteMain()).toBe(sha("feat/x"));
  });

  test("no upstream: promotes locally and says it did not push", () => {
    stamp(sha("feat/x"), {});
    const r = promote({ CLAUDECODE: "1" });
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/no upstream, not pushed/);
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

