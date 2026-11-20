"use strict";
// make promote's CI gate: when the branch head lists .github/required-checks,
// every listed GitHub check-run must have completed with success on that sha.
// A fake `gh` on PATH stands in for the API.
const fs = require("fs");
const path = require("path");
const { S, git, sha, commit, stamp, promote, beforeEachFixture, afterEachFixture } = require("./promoteGate.helpers");

let bin;
beforeEach(() => {
  beforeEachFixture();
  expect(git(["config", "core.hooksPath", path.join(S.tmp, "nohooks")]).code).toBe(0);
  expect(git(["checkout", "-q", "feat/x"]).code).toBe(0);
  fs.mkdirSync(path.join(S.repo, ".github"));
  commit(".github/required-checks", "# required\ntest (bundled framework)");
  expect(git(["checkout", "-q", "main"]).code).toBe(0);
  expect(git(["remote", "add", "origin", "https://github.com/o/r.git"]).code).toBe(0);
  expect(git(["update-ref", "refs/remotes/origin/main", "main"]).code).toBe(0);
  expect(git(["config", "branch.main.remote", "origin"]).code).toBe(0);
  expect(git(["config", "branch.main.merge", "refs/heads/main"]).code).toBe(0);
  bin = path.join(S.tmp, "bin");
  fs.mkdirSync(bin);
});
afterEach(afterEachFixture);

// rows: [name, status, conclusion]; or { fail: "stderr text" }
function gh(rows) {
  const body = rows.fail
    ? `echo '${rows.fail}' >&2; exit 1`
    : `cat <<'X'\n${rows.map((r) => r.join("\t")).join("\n")}\nX`;
  fs.writeFileSync(path.join(bin, "gh"), `#!/bin/sh\necho "$@" >> "${S.tmp}/gh.log"\n${body}\n`, { mode: 0o755 });
  stamp(sha("feat/x"), {});
  return promote({ NO_PUSH: "1", PATH: `${bin}:${process.env.PATH}` });
}

test("green required check: promoted, and the API was asked about the branch head", () => {
  const r = gh([["test (bundled framework)", "completed", "success"], ["test (pinned framework)", "completed", "failure"]]);
  expect(r.out).toMatch(/CI green/);
  expect(r.code).toBe(0);
  expect(sha("main")).toBe(sha("feat/x"));
  expect(fs.readFileSync(path.join(S.tmp, "gh.log"), "utf8")).toContain(`repos/o/r/commits/${sha("feat/x")}/check-runs`);
});

test.each([
  ["failed", [["test (bundled framework)", "completed", "failure"]], /required CI failed.*failure/],
  ["pending", [["test (bundled framework)", "in_progress", ""]], /not finished.*in_progress/],
  ["missing", [["lint", "completed", "success"]], /not finished.*'test \(bundled framework\)'/],
  ["unpushed", { fail: "gh: No commit found for SHA (HTTP 422)" }, /could not push|CI has just started/],
  ["unreadable", { fail: "gh: HTTP 500" }, /could not read CI/],
])("%s required check refuses; main unchanged", (_n, rows, msg) => {
  const before = sha("main");
  const r = gh(rows);
  expect(r.code).not.toBe(0);
  expect(r.out).toMatch(msg);
  expect(sha("main")).toBe(before);
});

test("a branch without required-checks is not gated", () => {
  expect(git(["checkout", "-q", "feat/x"]).code).toBe(0);
  expect(git(["rm", "-q", ".github/required-checks"]).code).toBe(0);
  expect(git(["commit", "-q", "-m", "no ci"]).code).toBe(0);
  expect(git(["checkout", "-q", "main"]).code).toBe(0);
  const r = gh({ fail: "should not be called" });
  expect(r.code).toBe(0);
  expect(fs.existsSync(path.join(S.tmp, "gh.log"))).toBe(false);
});
