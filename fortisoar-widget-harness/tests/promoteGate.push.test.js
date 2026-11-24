"use strict";
// make promote pushes main from a detached worktree AT THE PUSHED COMMIT, so the
// repo's own pre-push (the connector's full-suite gate) is that commit's code.
// Live: pushed from the shared checkout, the pre-push that ran was whatever
// branch another session had out there.
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { S, git, sha, commit, stamp, promote, beforeEachFixture, afterEachFixture } = require("./promoteGate.helpers");

const ok = (r) => expect(r.code).toBe(0);
beforeEach(() => {
  beforeEachFixture();
  // The repo's own hooks: a pre-push that records the commit and dir it runs in,
  // and whose BODY differs between main and the shared checkout's branch.
  const hooks = path.join(S.repo, "hooks");
  fs.mkdirSync(hooks);
  ok(git(["config", "core.hooksPath", "hooks"]));
  ok(git(["checkout", "-q", "feat/x"]));
  fs.writeFileSync(path.join(hooks, "pre-push"),
    `#!/bin/sh\necho "promoted-code $(git rev-parse HEAD) $(pwd -P)" >> "${S.tmp}/pre-push.log"\n`, { mode: 0o755 });
  ok(git(["add", "-A"])); ok(git(["commit", "-q", "-m", "hook"]));
  // A remote to push to.
  const bare = path.join(S.tmp, "remote.git");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", bare]);
  ok(git(["remote", "add", "origin", bare]));
  ok(git(["push", "-q", "--no-verify", "origin", "main"]));
  ok(git(["branch", "-q", "--set-upstream-to=origin/main", "main"]));
  // The shared checkout sits on someone's branch with a different pre-push.
  ok(git(["checkout", "-q", "-b", "someone/else", "main"]));
  fs.mkdirSync(hooks, { recursive: true });
  fs.writeFileSync(path.join(hooks, "pre-push"), `#!/bin/sh\necho "OTHER-BRANCH-HOOK" >> "${S.tmp}/pre-push.log"\n`, { mode: 0o755 });
});
afterEach(afterEachFixture);

test("the pre-push that runs on promote's main push is the pushed commit's, not the checkout's", () => {
  stamp(sha("feat/x"), {});
  const r = promote({});
  expect(r.out).toMatch(/-> main$/m);
  ok(r);
  const log = fs.readFileSync(path.join(S.tmp, "pre-push.log"), "utf8");
  expect(log).not.toMatch(/OTHER-BRANCH-HOOK/);
  const [, head, dir] = log.trim().split("\n").pop().split(" ");
  expect(head).toBe(sha("feat/x"));
  expect(dir).not.toBe(fs.realpathSync(S.repo));
  // The push worktree is gone again.
  expect(git(["worktree", "list"]).out.trim().split("\n")).toHaveLength(1);
});

test("the push worktree can run the repo's .venv/bin/python (a pre-push that needs it, from an agent worktree without one)", () => {
  // The main clone has a .venv; the promoting checkout is a linked worktree without one.
  fs.mkdirSync(path.join(S.repo, ".venv", "bin"), { recursive: true });
  fs.writeFileSync(path.join(S.repo, ".venv", "bin", "python"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  ok(git(["checkout", "-q", "-f", "feat/x"]));
  fs.writeFileSync(path.join(S.repo, "hooks", "pre-push"), "#!/bin/sh\n.venv/bin/python || exit 127\n", { mode: 0o755 });
  ok(git(["add", "hooks"])); ok(git(["commit", "-q", "-m", "venv hook"]));
  ok(git(["checkout", "-q", "-f", "someone/else"]));
  stamp(sha("feat/x"), {});
  const r = promote({});
  expect(r.out).toMatch(/-> main$/m);
  ok(r);
});
