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
  return promote({ NO_PUSH: "1", PATH: `${bin}:${process.env.PATH}`, PROMOTE_CI_WAIT: "0", PROMOTE_CI_POLL: "0" });
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

test("pending CI is waited for, then the promote goes through on its own", () => {
  // gh reports in_progress twice, then success: promote polls instead of refusing.
  const n = path.join(S.tmp, "polls");
  fs.writeFileSync(path.join(bin, "gh"), `#!/bin/sh
c=$(cat "${n}" 2>/dev/null || echo 0); c=$((c+1)); echo $c > "${n}"
if [ $c -lt 3 ]; then printf 'test (bundled framework)\tin_progress\t\n'; else printf 'test (bundled framework)\tcompleted\tsuccess\n'; fi
`, { mode: 0o755 });
  stamp(sha("feat/x"), {});
  const r = promote({ NO_PUSH: "1", PATH: `${bin}:${process.env.PATH}`, PROMOTE_CI_WAIT: "60", PROMOTE_CI_POLL: "0" });
  expect(r.out).toMatch(/waiting for CI on/);
  expect(r.out).toMatch(/CI green/);
  expect(r.code).toBe(0);
  expect(sha("main")).toBe(sha("feat/x"));
  expect(Number(fs.readFileSync(n, "utf8"))).toBe(3);
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

test("the CI wait is its own ledger line, not promote's time", () => {
  const n = path.join(S.tmp, "polls2"); const led = path.join(S.tmp, "laps.tsv");
  fs.writeFileSync(path.join(bin, "gh"), `#!/bin/sh
c=$(cat "${n}" 2>/dev/null || echo 0); c=$((c+1)); echo $c > "${n}"
if [ $c -lt 2 ]; then printf 'test (bundled framework)\\tin_progress\\t\\n'; else printf 'test (bundled framework)\\tcompleted\\tsuccess\\n'; fi
`, { mode: 0o755 });
  stamp(sha("feat/x"), {});
  const r = promote({ NO_PUSH: "1", PATH: `${bin}:${process.env.PATH}`, PROMOTE_CI_WAIT: "60", PROMOTE_CI_POLL: "1", FSR_LAP_LEDGER: led });
  expect(r.code).toBe(0);
  const row = fs.readFileSync(led, "utf8").trim().split("\n").map((l) => l.split("\t")).find((x) => x[1] === "promote ci-wait");
  expect(row).toBeDefined();
  expect(row[4]).toBe("300");
});

test("CI is checked first, and said so: a red check on an unstamped head is reported as CI, not as a missing stamp", () => {
  fs.writeFileSync(path.join(bin, "gh"), `#!/bin/sh\nprintf 'test (bundled framework)\\tcompleted\\tfailure\\n'\n`, { mode: 0o755 });
  const r = promote({ NO_PUSH: "1", PATH: `${bin}:${process.env.PATH}`, PROMOTE_CI_WAIT: "0", PROMOTE_CI_POLL: "0" });
  expect(r.code).not.toBe(0);
  expect(r.out).toMatch(/checking required CI first/);
  expect(r.out).toMatch(/required CI failed/);
  expect(r.out).not.toMatch(/no stamp/);
  expect(r.out.indexOf("checking required CI first")).toBeLessThan(r.out.indexOf("required CI failed"));
});

test("CI green but no stamp: still refused for the stamp, after CI was checked", () => {
  fs.writeFileSync(path.join(bin, "gh"), `#!/bin/sh\nprintf 'test (bundled framework)\\tcompleted\\tsuccess\\n'\n`, { mode: 0o755 });
  const r = promote({ NO_PUSH: "1", PATH: `${bin}:${process.env.PATH}`, PROMOTE_CI_WAIT: "0", PROMOTE_CI_POLL: "0" });
  expect(r.code).not.toBe(0);
  expect(r.out).toMatch(/CI green/);
  expect(r.out).toMatch(/no stamp/);
});

test("no CI run at all: a pull request is opened for the branch (CI that runs only on PRs), once", () => {
  fs.writeFileSync(path.join(bin, "gh"), `#!/bin/sh
echo "$@" >> "${S.tmp}/gh.log"
case "$1 $2" in "pr list") echo 0;; "pr create") :;; esac
`, { mode: 0o755 });
  stamp(sha("feat/x"), {});
  const r = promote({ NO_PUSH: "1", PATH: `${bin}:${process.env.PATH}`, PROMOTE_CI_WAIT: "0", PROMOTE_CI_POLL: "0" });
  expect(r.code).not.toBe(0);
  expect(r.out).toMatch(/opening a pull request for feat\/x/);
  const log = fs.readFileSync(path.join(S.tmp, "gh.log"), "utf8");
  // Never --fill: it diffs against a local main, which an agent tree does not have.
  expect(log).toMatch(/^pr create -R o\/r --base main --head feat\/x --title \S/m);
  expect(log).not.toMatch(/--fill/);
  expect(log.match(/^pr create/gm)).toHaveLength(1);
});

test("no CI run but the branch already has an open pull request: none is opened", () => {
  fs.writeFileSync(path.join(bin, "gh"), `#!/bin/sh
echo "$@" >> "${S.tmp}/gh.log"
case "$1 $2" in "pr list") echo 1;; esac
`, { mode: 0o755 });
  stamp(sha("feat/x"), {});
  const r = promote({ NO_PUSH: "1", PATH: `${bin}:${process.env.PATH}`, PROMOTE_CI_WAIT: "0", PROMOTE_CI_POLL: "0" });
  expect(r.code).not.toBe(0);
  expect(fs.readFileSync(path.join(S.tmp, "gh.log"), "utf8")).not.toMatch(/^pr create/m);
});
