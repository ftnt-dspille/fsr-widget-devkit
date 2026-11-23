"use strict";
// scripts/door.sh: the two front doors (make check, make ship). Real throwaway git
// repos with a bare remote, a stub `make` that records what the door asked for, and
// the real promote classifier (.github/package-inputs). Nothing here touches a box.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync, execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const DOOR = process.env.DOOR_UNDER_TEST || path.join(ROOT, "scripts", "door.sh");
let T, ENV, LOG, W;

const git = (dir, ...a) => execFileSync("git", ["-C", dir, ...a], { env: ENV, encoding: "utf8" }).trim();
const write = (dir, rel, body) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), body); };
const log = () => (fs.existsSync(LOG) ? fs.readFileSync(LOG, "utf8").split("\n").filter(Boolean) : []);

// A repo named like the real one (the door and promote key on the main checkout's name).
function repo(name, files) {
  const dir = path.join(T, name);
  const bare = path.join(T, `${name}.remote.git`);
  fs.mkdirSync(dir, { recursive: true });
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", bare], { env: ENV });
  git(dir, "init", "-q", "-b", "main");
  for (const [f, b] of Object.entries(files)) write(dir, f, b);
  git(dir, "add", "-A"); git(dir, "commit", "-q", "-m", "base");
  git(dir, "remote", "add", "origin", bare); git(dir, "push", "-q", "-u", "origin", "main");
  return { dir, bare };
}
const branch = (dir, name, files, msg = "change") => {
  git(dir, "switch", "-q", "-c", name);
  for (const [f, b] of Object.entries(files)) write(dir, f, b);
  git(dir, "add", "-A"); git(dir, "commit", "-q", "-m", msg);
};
const remoteHas = (bare, br) => { try { execFileSync("git", ["-C", bare, "rev-parse", "--verify", "-q", `refs/heads/${br}`], { env: ENV }); return true; } catch { return false; } };

function door(mode, env = {}) {
  const r = spawnSync("bash", [DOOR, mode], {
    cwd: T, encoding: "utf8", timeout: 60000,
    env: { ...ENV, FROM_TREE: "1", FSR_TOOL_HOME: ROOT, DOOR_MAKE: W.make, DOOR_LOG: LOG, FSR_LIVE_SANITY_DIR: path.join(T, "stamps"),
           FSR_LAP_LEDGER: path.join(T, "laps.tsv"), CONN_REPO: W.conn.dir, FSR_FRAMEWORK_REPO: W.fw.dir, DOOR_REPO: W.conn.dir, ...env },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

beforeEach(() => {
  T = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "door-")));
  fs.writeFileSync(path.join(T, "gitconfig"), "[user]\n\tname = t\n\temail = t@example.com\n");
  ENV = { ...process.env, GIT_CONFIG_GLOBAL: path.join(T, "gitconfig"), GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "core.hooksPath", GIT_CONFIG_VALUE_0: "/dev/null" };
  for (const k of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "CLAUDECODE", "AGENT_TREE", "DOOR_REPO", "BOX", "DRY_RUN"]) delete ENV[k];
  LOG = path.join(T, "make.log");
  const make = path.join(T, "fakemake");
  fs.writeFileSync(make, `#!/usr/bin/env bash
echo "make $* | FSR_SRC=\${FSR_SRC:-} PROMOTE_DRY_RUN=\${PROMOTE_DRY_RUN:-} CONN_REPO=\${CONN_REPO:-}" >> "$DOOR_LOG"
if [ -n "\${DOOR_FAIL:-}" ] && [[ "$*" == *"$DOOR_FAIL"* ]]; then exit "\${DOOR_FAIL_RC:-1}"; fi
exit 0
`, { mode: 0o755 });
  fs.writeFileSync(path.join(T, "fakepy"), `#!/usr/bin/env bash\necho "python $* | PYTHONPATH=$PYTHONPATH" >> "$DOOR_LOG"\nexit 0\n`, { mode: 0o755 });
  const conn = repo("conn_main", {
    "connector-fsr-agentic-assistant/a.py": "A = 1\n", "scripts/dev_push_deps.sh": "#!/bin/sh\n", "README.md": "r\n",
    "tests/test_a.py": "from a import A\n",
    // the connector's own selection is tested in the connector; here it only has to be called with the changed files on stdin
    "scripts/changed_tests.sh": "#!/usr/bin/env bash\ncat >/dev/null; echo tests/test_a.py\n",
    "scripts/dev_env.sh": `#!/usr/bin/env bash\necho "${path.join(T, "fakepy")}"\n`,
    "scripts/box.sh": "#!/usr/bin/env bash\n[ \"${BOX_RC:-0}\" = 0 ] || { echo 'box is stable' >&2; exit 2; }\nexit 0\n",
  });
  const fw = repo("fsr-playbook-framework", { "fsr_playbooks/llm/loop.py": "x = 1\n", "fsr_playbooks/tests/test_loop.py": "import loop\n", "README.md": "r\n" });
  W = { make, conn, fw };
});
afterEach(() => fs.rmSync(T, { recursive: true, force: true }));

describe("make check", () => {
  test("runs the connector's mapped tests (shell-heavy left to CI), the tool sweep, and local-chat when the agent loop changed", () => {
    branch(W.conn.dir, "feat/x", { "connector-fsr-agentic-assistant/a.py": "A = 2\n" });
    const r = door("check");
    expect(r.code).toBe(0);
    const l = log();
    expect(l.some((x) => /^make -C \S+ test PYTEST_ARGS=-m 'not shell' --disable-warnings tests\/test_a\.py/.test(x.split(" | ")[0]))).toBe(true);
    expect(l.some((x) => /^make -C \S+ tool-sweep/.test(x))).toBe(true);
    expect(l.some((x) => /local-chat BUNDLE=ka_c2_beacon/.test(x))).toBe(true);
  });

  test("a diff outside the agent loop runs no local-chat, and a diff no test maps to is reported NOT RUN, not passed", () => {
    branch(W.conn.dir, "feat/x", { "README.md": "changed\n" });
    fs.writeFileSync(path.join(W.conn.dir, "scripts/changed_tests.sh"), "#!/usr/bin/env bash\ncat >/dev/null\n");
    git(W.conn.dir, "commit", "-qam", "no tests map");
    const r = door("check");
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/NOT RUN: conn_main: no pytest file maps to this diff/);
    expect(r.out).toMatch(/1 part\(s\) NOT RUN|part\(s\) NOT RUN/);
    expect(log().some((x) => /local-chat/.test(x))).toBe(false);
  });

  test("a failing test makes the door fail and names it", () => {
    branch(W.conn.dir, "feat/x", { "connector-fsr-agentic-assistant/a.py": "A = 2\n" });
    const r = door("check", { DOOR_FAIL: "PYTEST_ARGS" });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/check FAILED: conn_main pytest/);
  });

  test("a framework diff in the agent loop runs local-chat; a sweep spec in the diff picks its bundle", () => {
    branch(W.fw.dir, "feat/x", { "fsr_playbooks/llm/loop.py": "x = 2\n" });
    const r = door("check", { DOOR_REPO: W.fw.dir });
    expect(r.code).toBe(0);
    expect(log().some((x) => /local-chat BUNDLE=ka_c2_beacon/.test(x))).toBe(true);
    expect(log().some((x) => /^python -m pytest .*fsr_playbooks\/tests\/test_loop\.py/.test(x))).toBe(true);
    git(W.conn.dir, "switch", "-q", "-c", "feat/y");
    write(W.conn.dir, "scripts/conversations/sweep/my_row.json", "{}\n"); write(W.conn.dir, "connector-fsr-agentic-assistant/a.py", "A = 3\n");
    git(W.conn.dir, "add", "-A"); git(W.conn.dir, "commit", "-qm", "row");
    fs.writeFileSync(LOG, "");
    door("check");
    expect(log().some((x) => /local-chat BUNDLE=my_row/.test(x))).toBe(true);
  });

  test("a connector checked out under another name (its real main checkout is fsr-playbook-builder) is still the connector", () => {
    const moved = path.join(T, "fsr-playbook-builder");
    fs.renameSync(W.conn.dir, moved); W.conn.dir = moved;
    branch(moved, "feat/x", { "connector-fsr-agentic-assistant/a.py": "A = 2\n" });
    const r = door("check", { CONN_REPO: moved, DOOR_REPO: moved });
    expect(r.code).toBe(0);
    expect(r.out).not.toMatch(/no check is defined/);
    expect(log().some((x) => /tool-sweep/.test(x))).toBe(true);
  });

  test("uncommitted and untracked work is checked too, not only commits", () => {
    git(W.conn.dir, "switch", "-q", "-c", "feat/x");
    write(W.conn.dir, "connector-fsr-agentic-assistant/new_mod.py", "Z = 1\n");   // untracked, uncommitted
    const r = door("check");
    expect(r.out).toMatch(/1 file\(s\) changed/);
    expect(log().some((x) => /tool-sweep/.test(x))).toBe(true);
  });
});

describe("make check: suites and worktrees", () => {
  test("the framework's tooling tests and fsr_playbooks tests run in separate pytest processes, never one", () => {
    git(W.fw.dir, "switch", "-q", "-c", "feat/x");
    write(W.fw.dir, "tooling/tests/test_t.py", "import loop\n");
    write(W.fw.dir, "fsr_playbooks/llm/loop.py", "x = 2\n");   // both suites import `loop`
    git(W.fw.dir, "add", "-A"); git(W.fw.dir, "commit", "-qm", "both suites");
    const r = door("check", { DOOR_REPO: W.fw.dir });
    expect(r.code).toBe(0);
    const runs = log().filter((x) => /^python -m pytest /.test(x));
    expect(runs).toHaveLength(2);
    expect(runs.filter((x) => /tooling\/tests\/test_t\.py/.test(x))).toHaveLength(1);
    expect(runs.filter((x) => /fsr_playbooks\/tests\/test_loop\.py/.test(x))).toHaveLength(1);
    for (const x of runs) expect(/tooling\/tests/.test(x) && /fsr_playbooks\/tests/.test(x)).toBe(false);
  });

  // A root worktree of a checkout whose harness is set up (node_modules, local-chat python).
  function rootWorktree({ shared = true, sameLock = true } = {}) {
    const main = path.join(T, "fsr_all_widgets"), wt = path.join(T, "root_wt");
    fs.mkdirSync(main, { recursive: true });
    git(main, "init", "-q", "-b", "main");
    write(main, "fortisoar-widget-harness/pnpm-lock.yaml", "lock: 1\n");
    write(main, "README.md", "r\n");
    git(main, "add", "-A"); git(main, "commit", "-qm", "base");
    git(main, "worktree", "add", "-q", wt, "-b", "wt");
    if (!sameLock) write(wt, "fortisoar-widget-harness/pnpm-lock.yaml", "lock: 2\n");
    if (shared) {
      fs.mkdirSync(path.join(main, "fortisoar-widget-harness/node_modules"), { recursive: true });
      fs.mkdirSync(path.join(main, "fortisoar-widget-harness/.venv-localdev"), { recursive: true });
    }
    fs.symlinkSync(path.join(ROOT, "scripts"), path.join(wt, "scripts"));
    return { main, wt };
  }
  const agentLoopBranch = () => branch(W.conn.dir, "feat/x", { "connector-fsr-agentic-assistant/a.py": "A = 2\n" });

  test("local-chat from a root worktree reuses the shared checkout's node_modules and local-chat python", () => {
    const { wt } = rootWorktree();
    agentLoopBranch();
    const r = door("check", { FSR_TOOL_HOME: wt });
    expect(r.code).toBe(0);
    expect(log().some((x) => /local-chat BUNDLE=/.test(x))).toBe(true);
    expect(fs.lstatSync(path.join(wt, "fortisoar-widget-harness/node_modules")).isSymbolicLink()).toBe(true);
    expect(fs.lstatSync(path.join(wt, "fortisoar-widget-harness/.venv-localdev")).isSymbolicLink()).toBe(true);
  });

  test.each([["the shared checkout has no node_modules", { shared: false }], ["the lockfile differs", { sameLock: false }]])(
    "a worktree that cannot be set up reports local-chat NOT RUN with the reason, and does not fail (%s)", (_n, opts) => {
      rootWorktree(opts);
      agentLoopBranch();
      const r = door("check", { FSR_TOOL_HOME: path.join(T, "root_wt") });
      expect(r.code).toBe(0);
      expect(r.out).toMatch(/NOT RUN: conn_main: local-chat ka_c2_beacon: the harness is not set up/);
      expect(log().some((x) => /local-chat/.test(x))).toBe(false);
    });
});

describe("make ship", () => {
  test("a tooling-only branch is pushed and promoted with no box, no dev-push, no BOX needed", () => {
    branch(W.conn.dir, "feat/x", { "tests/test_a.py": "from a import A\n# more\n" });
    const r = door("ship");
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/conn_main \(feat\/x\): tooling/);
    expect(remoteHas(W.conn.bare, "feat/x")).toBe(true);
    const l = log();
    expect(l.some((x) => /dev-push|widget-push|doctor/.test(x))).toBe(false);
    expect(l.some((x) => x.startsWith(`make -C ${ROOT} promote REPO=${W.conn.dir} BRANCH=feat/x`) || /promote REPO=.* BRANCH=feat\/x/.test(x))).toBe(true);
  });

  test("a shipped diff with no BOX is refused before anything is pushed", () => {
    branch(W.conn.dir, "feat/x", { "connector-fsr-agentic-assistant/a.py": "A = 2\n" });
    const r = door("ship");
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/pass BOX=<alias>/);
    expect(remoteHas(W.conn.bare, "feat/x")).toBe(false);
    expect(log()).toEqual([]);
  });

  test("a stable box is refused before anything is pushed", () => {
    branch(W.conn.dir, "feat/x", { "connector-fsr-agentic-assistant/a.py": "A = 2\n" });
    const r = door("ship", { BOX: "demo", BOX_RC: "2" });
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/cannot take code/);
    expect(remoteHas(W.conn.bare, "feat/x")).toBe(false);
  });

  test("a shipped diff pushes the branch, puts the code on the box (which stamps it), then promotes, in that order", () => {
    branch(W.conn.dir, "feat/x", { "connector-fsr-agentic-assistant/a.py": "A = 2\n" });
    const r = door("ship", { BOX: "92" });
    expect(r.code).toBe(0);
    expect(remoteHas(W.conn.bare, "feat/x")).toBe(true);
    const l = log().map((x) => x.split(" | ")[0]);
    const dev = l.findIndex((x) => /dev-push BOX=92/.test(x));
    const pro = l.findIndex((x) => /promote REPO=.* BRANCH=feat\/x/.test(x));
    expect(dev).toBeGreaterThanOrEqual(0);
    expect(pro).toBeGreaterThan(dev);
    expect(l[l.length - 1]).toMatch(/box-release BOX=92/);   // the lease the pushes took is freed at the end
  });

  test("the box lease is freed when the ship stops early, too", () => {
    branch(W.conn.dir, "feat/x", { "connector-fsr-agentic-assistant/a.py": "A = 2\n" });
    door("ship", { BOX: "92", DOOR_FAIL: "dev-push" });
    expect(log().some((x) => /box-release BOX=92/.test(x))).toBe(true);
  });

  test("a head that already has a VERIFIED clean stamp is not put on the box again", () => {
    branch(W.conn.dir, "feat/x", { "connector-fsr-agentic-assistant/a.py": "A = 2\n" });
    const sha = git(W.conn.dir, "rev-parse", "HEAD");
    write(path.join(T, "stamps"), `conn_main/${sha}.json`, JSON.stringify({ sha, verdict: "VERIFIED", dirty: false }));
    const r = door("ship", { BOX: "92" });
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/head already stamped VERIFIED/);
    expect(log().some((x) => /dev-push|doctor/.test(x))).toBe(false);
  });

  test("a stamp for a dirty tree does not count", () => {
    branch(W.conn.dir, "feat/x", { "connector-fsr-agentic-assistant/a.py": "A = 2\n" });
    const sha = git(W.conn.dir, "rev-parse", "HEAD");
    write(path.join(T, "stamps"), `conn_main/${sha}.json`, JSON.stringify({ sha, verdict: "VERIFIED", dirty: true }));
    door("ship", { BOX: "92" });
    expect(log().some((x) => /dev-push/.test(x))).toBe(true);
  });

  test("DRY_RUN=1 hands promote the dry-run switch, so nothing merges", () => {
    branch(W.conn.dir, "feat/x", { "tests/test_a.py": "# x\n" });
    const r = door("ship", { DRY_RUN: "1" });
    expect(r.code).toBe(0);
    expect(log().some((x) => /promote REPO=/.test(x) && /PROMOTE_DRY_RUN=1/.test(x))).toBe(true);
  });

  test("refuses a dirty tree, main, and a detached HEAD", () => {
    branch(W.conn.dir, "feat/x", { "tests/test_a.py": "# x\n" });
    write(W.conn.dir, "README.md", "dirty\n");
    expect(door("ship").out).toMatch(/uncommitted changes to tracked files/);
    git(W.conn.dir, "checkout", "-q", "--", "README.md");
    git(W.conn.dir, "switch", "-q", "main");
    expect(door("ship").out).toMatch(/is on main/);
    git(W.conn.dir, "checkout", "-q", "--detach", "feat/x");
    const r = door("ship");
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/detached HEAD/);
    expect(remoteHas(W.conn.bare, "feat/x")).toBe(false);
  });

  test("a branch with nothing ahead of main ships nothing", () => {
    git(W.conn.dir, "switch", "-q", "-c", "feat/x");
    const r = door("ship");
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/nothing to ship|nothing ahead|nothing in the tree/);
    expect(log()).toEqual([]);
  });

  test("a failing box step stops before promote", () => {
    branch(W.conn.dir, "feat/x", { "connector-fsr-agentic-assistant/a.py": "A = 2\n" });
    const r = door("ship", { BOX: "92", DOOR_FAIL: "dev-push" });
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/stopped before promote/);
    expect(log().some((x) => /promote REPO=/.test(x))).toBe(false);
  });

  test("in an agent tree it ships every changed repo, framework before connector, and only the changed ones", () => {
    const tree = path.join(T, "tree");
    fs.mkdirSync(path.join(tree, "root"), { recursive: true });
    git(W.conn.dir, "worktree", "add", "-q", "-b", "feat/c", path.join(tree, "connector"), "main");
    git(W.fw.dir, "worktree", "add", "-q", "-b", "feat/f", path.join(tree, "framework"), "main");
    fs.writeFileSync(path.join(tree, "agent-tree.json"), "{}");
    write(path.join(tree, "connector"), "tests/test_a.py", "# c\n"); git(path.join(tree, "connector"), "add", "-A"); git(path.join(tree, "connector"), "commit", "-qm", "c");
    write(path.join(tree, "framework"), "README.md", "# f\n"); git(path.join(tree, "framework"), "add", "-A"); git(path.join(tree, "framework"), "commit", "-qm", "f");
    const r = door("ship", { AGENT_TREE: tree, DOOR_REPO: "" });
    expect(r.code).toBe(0);
    const pro = log().map((x) => x.split(" | ")[0]).filter((x) => /promote REPO=/.test(x));
    expect(pro.length).toBe(2);
    expect(pro[0]).toMatch(/fsr-playbook-framework|framework/);
    expect(pro[1]).toMatch(/connector/);
  });
});
