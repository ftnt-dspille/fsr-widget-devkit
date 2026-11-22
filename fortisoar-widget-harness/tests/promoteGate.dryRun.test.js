"use strict";
// PROMOTE_DRY_RUN=1 (what `make ship DRY_RUN=1` and `make bench` use): promote runs
// every check (the proof, the classification) and stops before the merge.
const { S, git, sha, stamp, promote, beforeEachFixture, afterEachFixture } = require("./promoteGate.helpers");

beforeEach(beforeEachFixture);
afterEach(afterEachFixture);

test("with a VERIFIED stamp the dry run says it is ready and merges nothing", () => {
  const before = sha("main");
  stamp(sha("feat/x"), {});
  const r = promote({ CLAUDECODE: "1", PROMOTE_DRY_RUN: "1" });
  expect(r.code).toBe(0);
  expect(r.out).toMatch(/DRY RUN: feat\/x .* is ready to merge into main/);
  expect(sha("main")).toBe(before);
  expect(git(["branch", "--contains", sha("feat/x"), "main"]).out).toBe("");   // feat/x is still not in main
});

test("the dry run still refuses without a stamp: it is not a way around the proof", () => {
  const r = promote({ CLAUDECODE: "1", PROMOTE_DRY_RUN: "1" });
  expect(r.code).not.toBe(0);
  expect(r.out).toMatch(/refusing: no stamp/);
});

test("without the switch the same stamped branch merges", () => {
  const before = sha("main");
  stamp(sha("feat/x"), {});
  const r = promote({ CLAUDECODE: "1", NO_PUSH: "1" });
  expect(r.code).toBe(0);
  expect(sha("main")).not.toBe(before);
});
