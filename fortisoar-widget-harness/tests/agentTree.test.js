"use strict";
// scripts/agent_tree.sh against throwaway repos: every repo a worktree at its
// remote's main (the framework's remote is not origin), the shared sources
// untouched, and a failed fetch refused by name before anything is built.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync, execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
let T, ENV;
const g = (cwd, ...a) => execFileSync("git", ["-C", cwd, ...a], { env: ENV, encoding: "utf8" }).trim();

function src(dir, remote = "origin") {
  fs.mkdirSync(dir, { recursive: true });
  const bare = `${dir}.git-remote`;
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", bare], { env: ENV });
  g(dir, "init", "-q", "-b", "main");
  fs.writeFileSync(path.join(dir, "v"), "1\n"); g(dir, "add", "-A"); g(dir, "commit", "-q", "-m", "1");
  g(dir, "remote", "add", remote, bare); g(dir, "push", "-q", "-u", remote, "main");
  fs.writeFileSync(path.join(dir, "v"), "2\n"); g(dir, "commit", "-qam", "2"); g(dir, "push", "-q", remote, "main");
  g(dir, "reset", "-q", "--hard", "HEAD~1"); g(dir, "checkout", "-q", "-b", "someone/else");
  return { dir, main: execFileSync("git", ["-C", bare, "rev-parse", "main"], { encoding: "utf8" }).trim() };
}

beforeEach(() => {
  T = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "agent-tree-")));
  fs.writeFileSync(path.join(T, "gitconfig"), "[user]\n\tname = t\n\temail = t@example.com\n");
  ENV = { ...process.env, GIT_CONFIG_GLOBAL: path.join(T, "gitconfig"), GIT_CONFIG_COUNT: "1",
          GIT_CONFIG_KEY_0: "core.hooksPath", GIT_CONFIG_VALUE_0: "/dev/null" };
  for (const k of ["GIT_DIR", "GIT_WORK_TREE", "CLAUDECODE"]) delete ENV[k];
});
afterEach(() => fs.rmSync(T, { recursive: true, force: true }));

function world() {
  const w = { root: src(path.join(T, "root")), fw: src(path.join(T, "fw"), "github"), conn: src(path.join(T, "conn")),
              a: src(path.join(T, "widgets", "agenticAssistant")), m: src(path.join(T, "widgets", "agenticAssistantMonitor")) };
  w.env = { ...ENV, AT_ROOT_REPO: w.root.dir, AT_FRAMEWORK_REPO: w.fw.dir, AT_CONN_REPO: w.conn.dir,
            AT_WIDGETS_DIR: path.join(T, "widgets"), AGENT_TREES: path.join(T, "trees"), AT_NO_BUILD: "1", AT_NO_HOOKS_CHECK: "1", AT_NO_SELFCHECK: "1" };
  return w;
}
const at = (env, ...a) => spawnSync("bash", [path.join(ROOT, "scripts", "agent_tree.sh"), ...a], { env, encoding: "utf8" });

test("create: all 5 repos as worktrees at their remote's main; the sources keep their branch", () => {
  const w = world();
  const r = at(w.env, "create", "t1");
  const tree = path.join(T, "trees", "t1");
  const got = JSON.parse(fs.readFileSync(path.join(tree, "agent-tree.json"), "utf8"));
  expect(got.root.sha).toBe(w.root.main);
  expect(got.framework.sha).toBe(w.fw.main);            // fetched from "github", not origin
  expect(got.connector.sha).toBe(w.conn.main);
  expect(got.agenticAssistant.sha).toBe(w.a.main);
  expect(got.agenticAssistantMonitor.sha).toBe(w.m.main);
  expect(fs.existsSync(path.join(tree, "root", "widgets-src", "agenticAssistant", "v"))).toBe(true);
  for (const s of [w.root, w.fw, w.conn, w.a, w.m]) expect(g(s.dir, "branch", "--show-current")).toBe("someone/else");
  expect(r.stderr).not.toMatch(/fetch failed/);
});

test("create links the shared local-chat venv into the tree, and remove takes only the link away", () => {
  const w = world();
  const venv = path.join(w.root.dir, "fortisoar-widget-harness", ".venv-localdev");
  fs.mkdirSync(path.join(venv, "bin"), { recursive: true }); fs.writeFileSync(path.join(venv, "bin", "python"), "");
  const r = at(w.env, "create", "tv");
  expect(r.status).toBe(0);
  const link = path.join(T, "trees", "tv", "root", "fortisoar-widget-harness", ".venv-localdev");
  expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
  expect(fs.existsSync(path.join(link, "bin", "python"))).toBe(true);
  expect(at(w.env, "remove", "tv").status).toBe(0);
  expect(fs.existsSync(path.join(venv, "bin", "python"))).toBe(true);   // the shared venv is untouched
});

test("a failed fetch is refused by repo name and nothing is built", () => {
  const w = world();
  g(w.conn.dir, "remote", "set-url", "origin", path.join(T, "gone.git"));
  const r = at(w.env, "create", "t2");
  expect(r.status).not.toBe(0);
  expect(r.stderr).toMatch(/fetch failed for connector/);
  expect(r.stderr).toMatch(/nothing was built/);
  expect(fs.existsSync(path.join(T, "trees", "t2"))).toBe(false);
  for (const s of [w.root, w.fw, w.conn, w.a, w.m]) expect(g(s.dir, "worktree", "list").split("\n")).toHaveLength(1);
});

describe("whole-tree operations", () => {
  function changedTree() {
    const w = world();
    const c = at(w.env, "create", "t3"); if (c.status !== 0) throw new Error("create: " + c.stderr + c.stdout);
    const tree = path.join(T, "trees", "t3");
    // The root and connector worktrees get a branch with a commit; the rest stay at main.
    for (const [repo, br] of [["root", "feat/r"], ["connector", "feat/c"]]) {
      const d = path.join(tree, repo);
      g(d, "checkout", "-q", "-b", br); fs.writeFileSync(path.join(d, "x"), "1\n"); g(d, "add", "x"); g(d, "commit", "-qm", "x");
    }
    const bin = path.join(T, "bin"); fs.mkdirSync(bin, { recursive: true });
    const log = path.join(T, "make.log");
    // make stands in for the real promote: record the call; refuse REPO=$FAIL_REPO.
    fs.writeFileSync(path.join(bin, "make"), `#!/bin/sh
echo "$*" >> "${log}"
case "$*" in *"REPO=$FAIL_REPO "*) exit 1 ;; esac
exit 0
`, { mode: 0o755 });
    return { w, tree, log, env: { ...w.env, PATH: `${bin}:${process.env.PATH}`, FAIL_REPO: "/none" } };
  }

  test("status lists every repo with its branch and how far ahead of main it is", () => {
    const { w } = changedTree();
    const r = at(w.env, "status", "t3");
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^connector\s+feat\/c\s+\S+\s+1\s+no\s+none$/m);
    expect(r.stdout).toMatch(/^root\s+feat\/r\s+\S+\s+1\s/m);
    expect(r.stdout).toMatch(/^framework\s+\(detached\)\s+\S+\s+0\s/m);
  });

  test("promote promotes only the changed repos, connector before root", () => {
    const { w, log, env } = changedTree();
    const r = at(env, "promote", "t3");
    expect(r.status).toBe(0);
    const calls = fs.readFileSync(log, "utf8").trim().split("\n");
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatch(new RegExp(`promote REPO=${w.conn.dir} BRANCH=feat/c`));
    expect(calls[1]).toMatch(new RegExp(`promote REPO=${w.root.dir} BRANCH=feat/r`));
  });

  test("promote stops at the first refusal, naming the repo, and promotes nothing after it", () => {
    const { w, log, env } = changedTree();
    const r = at({ ...env, FAIL_REPO: w.conn.dir }, "promote", "t3");
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/promote-tree stopped at connector \(feat\/c\)/);
    expect(fs.readFileSync(log, "utf8").trim().split("\n")).toHaveLength(1);
  });

  test("stamp refuses without a BOX and stamps only the changed repos in one run", () => {
    const { tree, log, env } = changedTree();
    expect(at(env, "stamp", "t3").stderr).toMatch(/stamp-tree needs BOX=/);
    const r = at({ ...env, BOX: "92" }, "stamp", "t3");
    expect(r.status).toBe(0);
    const [call] = fs.readFileSync(log, "utf8").trim().split("\n");
    expect(call).toMatch(/doctor BOX=92 SANITY=1/);
    expect(call).toContain(`STAMP=${path.join(tree, "connector")}:${path.join(tree, "root")}`);
  });
});

describe("selfcheck: the tree proves itself usable before anyone is sent into it", () => {
  // A fake make answers framework-path (FAKE_FW) and doctor (FAKE_DOCTOR_RC); a
  // package dir without __init__.py (the pluggy/pyyaml symptom) sits on the probe's path.
  function checkedWorld({ fw, doctorRc = 0, broken = true } = {}) {
    const w = world();
    delete w.env.AT_NO_SELFCHECK;
    const site = path.join(T, "site"); fs.mkdirSync(path.join(site, "brokenpkg"), { recursive: true });
    if (!broken) fs.writeFileSync(path.join(site, "brokenpkg", "__init__.py"), "");
    fs.mkdirSync(path.join(site, "brokenpkg-1.0.dist-info"), { recursive: true });
    fs.writeFileSync(path.join(site, "brokenpkg-1.0.dist-info", "METADATA"), "Metadata-Version: 2.1\nName: brokenpkg\nVersion: 1.0\n");
    const bin = path.join(T, "bin"); fs.mkdirSync(bin, { recursive: true });
    const installs = path.join(T, "installs.log");
    fs.writeFileSync(path.join(bin, "make"), `#!/bin/sh
case "$*" in
  *framework-path*) echo "\${FAKE_FW:-$AGENT_TREE/framework}" ;;
  *doctor*) echo "doctor ran"; echo "doctor said: stale thing"; exit \${FAKE_DOCTOR_RC:-0} ;;
esac
`, { mode: 0o755 });
    // The installer repairs by writing the missing __init__.py, and records the call.
    fs.writeFileSync(path.join(bin, "fake-install"), `#!/bin/sh
echo "$@" >> "${installs}"
touch "${site}/brokenpkg/__init__.py"
`, { mode: 0o755 });
    w.env = { ...w.env, AT_SELFCHECK_PY: execFileSync("which", ["python3"], { encoding: "utf8" }).trim(),
      AT_SELFCHECK_IMPORTS: "json brokenpkg", AT_SELFCHECK_PYPATH: site,
      AT_SELFCHECK_INSTALL: path.join(bin, "fake-install"), AT_SELFCHECK_MAKE: path.join(bin, "make"),
      FAKE_DOCTOR_RC: String(doctorRc), ...(fw ? { FAKE_FW: fw } : {}) };
    return { w, installs };
  }

  test("create ends with the self-check: a broken package is reinstalled, and the line says READY", () => {
    const { w, installs } = checkedWorld();
    const r = at(w.env, "create", "s1");
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/agent_tree: READY \(/);
    expect(r.stderr).toMatch(/brokenpkg imports empty or fails/);
    expect(fs.readFileSync(installs, "utf8")).toMatch(/brokenpkg==/);
  });

  test("a framework-path that is not the tree's framework is NOT READY, with the path in the reason", () => {
    const { w } = checkedWorld({ fw: "/somewhere/shared/framework", broken: false });
    const r = at(w.env, "create", "s2");
    expect(r.status).not.toBe(0);
    expect(r.stdout).toMatch(/agent_tree: NOT READY: make framework-path is '\/somewhere\/shared\/framework'/);
    expect(r.stdout).not.toMatch(/agent_tree: READY/);
  });

  test("a failing doctor LOCAL=1 is NOT READY and quotes its last line", () => {
    const { w } = checkedWorld({ doctorRc: 1, broken: false });
    const r = at(w.env, "create", "s3");
    expect(r.status).not.toBe(0);
    expect(r.stdout).toMatch(/NOT READY: make doctor LOCAL=1 failed: doctor said: stale thing/);
  });

  test("a package the installer cannot fix is NOT READY", () => {
    const { w } = checkedWorld();
    fs.writeFileSync(path.join(T, "bin", "fake-install"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    const r = at(w.env, "create", "s4");
    expect(r.status).not.toBe(0);
    expect(r.stdout).toMatch(/NOT READY: venv imports still broken: brokenpkg/);
  });
});
