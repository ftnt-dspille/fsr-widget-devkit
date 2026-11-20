"use strict";
// .claude/hooks/bash_guard.py: the Claude Code PreToolUse backstop. Every
// blocked pattern below was typed by an agent; every allowed one is a command
// agents run all the time and must keep working.
const path = require("path");
const { spawnSync } = require("child_process");
const HOOK = path.resolve(__dirname, "../../.claude/hooks/bash_guard.py");
const run = (command, tool = "Bash") => spawnSync("python3", [HOOK],
  { input: JSON.stringify({ tool_name: tool, tool_input: { command } }), encoding: "utf8" });

test.each([
  ["bash scripts/promote.sh", /make promote/],
  ["cd x && ./scripts/deploy.sh --box 92", /make front door/],
  ["python3 scripts/stable_install.py --box 159", /make stable/],
  ["git push origin main", /make promote/],
  ["git push -q origin HEAD:main", /make promote/],
  ["git push origin feat/x:refs/heads/main", /make promote/],
  ["git push --no-verify origin feat/x", /hooks/],
  ["SKIP_TESTS=1 git push origin feat/x", /bypass a gate/],
  ["ALLOW_UNVERIFIED=1 make promote REPO=r BRANCH=b", /bypass a gate/],
  ['for p in "a b" "c d"; do set -- $p; make promote REPO=$1 BRANCH=$2; done', /promote-tree/],
  ["set -- $x; make stable BOX=$1", /promote-tree/],
])("blocks: %s", (cmd, why) => {
  const r = run(cmd);
  expect(r.status).toBe(2);
  expect(r.stderr).toMatch(why);
});

test.each([
  "make promote REPO=/r BRANCH=feat/x",
  "make promote-tree NAME=t1",
  "git push -u origin feat/main-fix",
  "git push origin feat/x",
  "cat scripts/deploy.sh",
  "grep -n promote.sh scripts/promote_main.sh",
  "bash scripts/agent_tree.sh status t1",
  "git fetch -q origin main && git log origin/main",
  "for f in a b; do echo $f; done",
])("allows: %s", (cmd) => {
  expect(run(cmd).status).toBe(0);
});

test("other tools and bad input pass through", () => {
  expect(run("git push origin main", "Read").status).toBe(0);
  expect(spawnSync("python3", [HOOK], { input: "not json", encoding: "utf8" }).status).toBe(0);
});
