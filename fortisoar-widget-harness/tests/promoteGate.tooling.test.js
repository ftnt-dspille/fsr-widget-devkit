"use strict";
// Tooling-only promotes (scripts/promote.sh): a diff whose every path is on
// MAIN's .github/tooling-paths needs no box stamp; main's required CI is the
// proof. One shipped path anywhere, a branch widening the list for itself, or
// a rename out of a shipped path keeps the box stamp.
const fs = require("fs");
const path = require("path");
const { S, git, sha, promote, beforeEachFixture, afterEachFixture } = require("./promoteGate.helpers");

let bin;
const put = (f, body) => { fs.mkdirSync(path.dirname(path.join(S.repo, f)), { recursive: true }); fs.writeFileSync(path.join(S.repo, f), body); };
const ok = (r) => expect(r.code).toBe(0);
const commitAll = (msg) => { ok(git(["add", "-A"])); ok(git(["commit", "-q", "-m", msg])); };

beforeEach(() => {
  beforeEachFixture();
  ok(git(["config", "core.hooksPath", path.join(S.tmp, "nohooks")]));
  // main: the policy files and one tooling and one shipped file.
  put(".github/tooling-paths", "# tooling\ntools/*\n");
  put(".github/required-checks", "tooling\n");
  put("tools/a.sh", "a\n"); put("src/app.js", "app\n");
  commitAll("policy");
  ok(git(["remote", "add", "origin", "https://github.com/o/r.git"]));
  ok(git(["update-ref", "refs/remotes/origin/main", "main"]));
  ok(git(["config", "branch.main.remote", "origin"]));
  ok(git(["config", "branch.main.merge", "refs/heads/main"]));
  ok(git(["branch", "-f", "feat/x", "main"]));
  ok(git(["checkout", "-q", "feat/x"]));
  bin = path.join(S.tmp, "bin"); fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "gh"), `#!/bin/sh\necho "$@" >> "${S.tmp}/gh.log"\nprintf 'tooling\\tcompleted\\tsuccess\\n'\n`, { mode: 0o755 });
});
afterEach(afterEachFixture);

const run = () => { ok(git(["checkout", "-q", "main"])); return promote({ NO_PUSH: "1", PATH: `${bin}:${process.env.PATH}` }); };

test("only allowed paths: promotes with no box stamp, on main's CI", () => {
  put("tools/a.sh", "a2\n"); put("tools/b.sh", "b\n"); commitAll("tooling");
  const r = run();
  expect(r.out).toMatch(/classified tooling \(all 2 path\(s\)/);
  expect(r.out).toMatch(/CI green/);
  expect(r.code).toBe(0);
  expect(sha("main")).toBe(sha("feat/x"));
});

test("one shipped path anywhere refuses, naming it", () => {
  put("tools/a.sh", "a2\n"); put("src/app.js", "app2\n"); commitAll("mixed");
  const before = sha("main");
  const r = run();
  expect(r.out).toMatch(/classified shipped \(shipped path\(s\): src\/app\.js\)/);
  expect(r.out).toMatch(/refusing: no stamp/);
  expect(r.code).not.toBe(0);
  expect(sha("main")).toBe(before);
});

test("a branch that widens tooling-paths is still classified by main's list", () => {
  put(".github/tooling-paths", "tools/*\nsrc/*\n.github/*\n"); put("src/app.js", "app2\n"); commitAll("widen");
  const r = run();
  expect(r.out).toMatch(/classified shipped/);
  expect(r.out).toMatch(/src\/app\.js/);
  expect(r.code).not.toBe(0);
});

test("a rename from a shipped path to a tooling path counts as shipped", () => {
  ok(git(["mv", "src/app.js", "tools/app.js"])); commitAll("move");
  const r = run();
  expect(r.out).toMatch(/classified shipped \(shipped path\(s\): src\/app\.js\)/);
  expect(r.code).not.toBe(0);
});

test("a deleted shipped path counts as shipped", () => {
  ok(git(["rm", "-q", "src/app.js"])); put("tools/a.sh", "a2\n"); commitAll("delete");
  const r = run();
  expect(r.out).toMatch(/shipped path\(s\): src\/app\.js/);
  expect(r.code).not.toBe(0);
});

test("a tooling branch that deletes required-checks still needs main's CI", () => {
  // required-checks is not on the list, so deleting it is itself shipped; and
  // the CI list for a tooling promote is read from main anyway.
  fs.writeFileSync(path.join(bin, "gh"), `#!/bin/sh\nprintf 'tooling\\tcompleted\\tfailure\\n'\n`, { mode: 0o755 });
  put("tools/a.sh", "a2\n"); commitAll("tooling");
  const r = run();
  expect(r.out).toMatch(/classified tooling/);
  expect(r.out).toMatch(/required CI failed/);
  expect(r.code).not.toBe(0);
});
