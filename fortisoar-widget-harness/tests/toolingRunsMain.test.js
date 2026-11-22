"use strict";
// Every root-repo tool that carries policy runs from the repo's remote main
// (scripts/run_from_main.sh), whatever branch the checkout is on, and finds its
// siblings and the repo through FSR_TOOL_HOME. stable.sh guards a stable box, so
// its refusals are proven to come from main even when the tree copy is weakened.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync, execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.com", GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "core.hooksPath",
  GIT_CONFIG_VALUE_0: "/dev/null" };
delete ENV.FROM_TREE; delete ENV.CLAUDECODE; delete ENV.BOX; delete ENV.CONN_REPO; delete ENV.FSR_FRAMEWORK_REPO;
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");

const SCRIPTS = ["live-sanity.sh", "push.sh", "stable.sh", "ship-verify-sweep.sh", "lap.sh", "unit-pass-cache.sh",
  "hooks_central.sh", "fortisoar-widget-harness/scripts/ship.sh", "fortisoar-widget-harness/scripts/release.sh"];

describe("Makefile routing", () => {
  const mk = read("Makefile");
  test("every tool is invoked through run_from_main.sh, never directly from the tree", () => {
    expect(mk).toMatch(/^RFM := bash \$\(CURDIR\)\/scripts\/run_from_main\.sh$/m);
    expect(mk).toMatch(/^LAP := .*\$\(RFM\) lap\.sh$/m);
    for (const s of ["live-sanity.sh", "push.sh", "stable.sh", "ship-verify-sweep.sh", "unit-pass-cache.sh"])
      expect(mk).toMatch(new RegExp(`\\$\\(RFM\\) ${s.replace(".", "\\.")}`));
    expect(mk).toMatch(/\$\(RFM\) hooks_central\.sh check/);
    expect(mk).toMatch(/^SHIP_SH := fortisoar-widget-harness\/scripts\/ship\.sh$/m);
    expect(mk).toMatch(/^RELEASE_SH := fortisoar-widget-harness\/scripts\/release\.sh$/m);
    expect(mk).toMatch(/\$\(RFM\) \$\(SHIP_SH\)/);
    expect(mk).toMatch(/\$\(RFM\) \$\(RELEASE_SH\)/);
    const direct = mk.split("\n").filter((l) => !l.trim().startsWith("#") &&
      /(bash |\s|\/)(scripts\/(lap|live-sanity|push|stable|ship-verify-sweep|unit-pass-cache|hooks_central)\.sh|(scripts|\$\(HARNESS\)\/scripts)\/(ship|release)\.sh)/.test(l) && !/run_from_main|^(SHIP|RELEASE)_SH :=/.test(l));
    expect(direct).toEqual([]);
  });
});

describe("FSR_TOOL_HOME", () => {
  test.each(SCRIPTS)("%s takes its home from FSR_TOOL_HOME", (s) => {
    const rel = s.includes("/") ? s : path.join("scripts", s);
    if (s === "ship-verify-sweep.sh" || s === "lap.sh") return;  // no path dependence: they use cwd only
    expect(read(rel)).toMatch(/FSR_TOOL_HOME/);
  });
});

// A fake root repo: remote main carries the real scripts, the checkout's branch
// carries a different copy of each.
let T, repo, conn;
const g = (...a) => execFileSync("git", ["-C", repo, ...a], { env: ENV, encoding: "utf8" });
const real = (s) => fs.readFileSync(path.join(ROOT, s.includes("/") ? s : path.join("scripts", s)), "utf8");

beforeEach(() => {
  T = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "tooling-main-")));
  repo = path.join(T, "r"); conn = path.join(T, "conn");
  fs.mkdirSync(path.join(repo, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(conn, "scripts"), { recursive: true });
  // The connector's box.sh: a box whose role is experimental, and a marker proving it was found.
  fs.writeFileSync(path.join(conn, "scripts", "box.sh"),
    'resolve_box() { echo "BOX-SH-FOUND-VIA-TOOL-HOME"; BOX_ROLE=experimental; BOX_ENV=/dev/null; return "${FAKE_BOX_RC:-0}"; }\n');
  fs.writeFileSync(path.join(repo, "scripts", "repo_paths.sh"), `case "$1" in conn) echo ${conn};; *) echo ${T}/fw;; esac\n`);
  fs.copyFileSync(path.join(ROOT, "scripts", "run_from_main.sh"), path.join(repo, "scripts", "run_from_main.sh"));
  for (const s of ["live-sanity.sh", "push.sh", "stable.sh"]) fs.writeFileSync(path.join(repo, "scripts", s), real(s));
  g("init", "-q", "-b", "main"); g("add", "-A"); g("commit", "-q", "-m", "main");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", path.join(T, "remote.git")], { env: ENV });
  g("remote", "add", "origin", path.join(T, "remote.git")); g("push", "-q", "-u", "origin", "main");
  g("checkout", "-q", "-b", "feature");
});
afterEach(() => fs.rmSync(T, { recursive: true, force: true }));

const run = (script, env = {}, args = []) => spawnSync("bash", [path.join(repo, "scripts", "run_from_main.sh"), script, ...args],
  { env: { ...ENV, BOX: "x", ...env }, encoding: "utf8", cwd: repo });

test.each(["live-sanity.sh", "push.sh", "stable.sh"])("%s run from main's temp copy finds the connector through FSR_TOOL_HOME", (s) => {
  const r = run(s, { FAKE_BOX_RC: "2" });
  expect(r.stdout).toContain("BOX-SH-FOUND-VIA-TOOL-HOME");
  expect(r.stderr).toContain(`${s}: from origin/main`);
});

describe("stable.sh: main's guard runs even when the tree copy differs", () => {
  const weaken = () => {  // the branch's copy approves everything
    fs.writeFileSync(path.join(repo, "scripts", "stable.sh"), "echo TREE-COPY-RAN; exit 0\n");
    g("commit", "-qam", "weaken the guard");
  };
  test("no BOX: refused with exit 2", () => {
    weaken();
    const r = spawnSync("bash", [path.join(repo, "scripts", "run_from_main.sh"), "stable.sh"], { env: { ...ENV }, encoding: "utf8", cwd: repo });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/BOX=<alias> is required/);
    expect(r.stdout).not.toContain("TREE-COPY-RAN");
  });
  test("a box that is not stable: refused with exit 2", () => {
    weaken();
    const r = run("stable.sh");
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/stable installs only on a stable box/);
    expect(r.stdout).not.toContain("TREE-COPY-RAN");
  });
  test("FROM_TREE=1 is the way to run the tree copy", () => {
    weaken();
    expect(run("stable.sh", { FROM_TREE: "1" }).stdout).toContain("TREE-COPY-RAN");
  });
});
