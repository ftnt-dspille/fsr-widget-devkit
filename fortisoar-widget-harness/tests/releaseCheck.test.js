"use strict";
// make release-check (the batch gate) and its record, which make stable requires.
// Trees are tiny git repos; the container runner, python and the CI door are fakes.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");

const SCRIPT = path.join(__dirname, "..", "..", "scripts", "release_check.sh");
const STABLE = fs.readFileSync(path.join(__dirname, "..", "..", "scripts", "stable.sh"), "utf8");
const MAKEFILE = fs.readFileSync(path.join(__dirname, "..", "..", "Makefile"), "utf8");
let T, ENV, trees, REC;

const git = (d, ...a) => execFileSync("git", ["-C", d, ...a], { env: ENV, encoding: "utf8" }).trim();
function tree(name, files = { "a.txt": "a\n" }) {
  const d = path.join(T, name); fs.mkdirSync(d, { recursive: true });
  for (const [f, b] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.writeFileSync(path.join(d, f), b); }
  git(d, "init", "-q", "-b", "main"); git(d, "add", "-A"); git(d, "commit", "-qm", "i");
  return d;
}
function run(args, env = {}) {
  const r = spawnSync("bash", [SCRIPT, ...args], { encoding: "utf8", timeout: 60000, env: { ...ENV, ...env } });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}
const log = () => (fs.existsSync(path.join(T, "calls.log")) ? fs.readFileSync(path.join(T, "calls.log"), "utf8").split("\n").filter(Boolean) : []);

beforeEach(() => {
  T = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "relchk-")));
  fs.writeFileSync(path.join(T, "gitconfig"), "[user]\n\tname = t\n\temail = t@example.com\n");
  REC = path.join(T, "rec");
  const bin = path.join(T, "bin"); fs.mkdirSync(bin);
  ENV = { ...process.env, GIT_CONFIG_GLOBAL: path.join(T, "gitconfig"), GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "core.hooksPath", GIT_CONFIG_VALUE_0: "/dev/null",
          FSR_RELEASE_CHECK_DIR: REC, RC_CI_WAIT: "0", RC_CI_POLL: "0", CALLS: path.join(T, "calls.log") };
  for (const k of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "FSR_TOOL_HOME"]) delete ENV[k];
  fs.writeFileSync(path.join(T, "pydock"), '#!/usr/bin/env bash\necho "container $* | FW=$DEVLOOP_FRAMEWORK_DIR" >> "$CALLS"\n[ "$1" = framework ] && exit "${PYDFW_RC:-0}"\nexit "${PYD_RC:-0}"\n', { mode: 0o755 });
  fs.writeFileSync(path.join(T, "fakepy"), '#!/usr/bin/env bash\necho "python $* | cwd=$PWD" >> "$CALLS"\nexit "${PY_RC:-0}"\n', { mode: 0o755 });
  fs.writeFileSync(path.join(T, "fakedoor"), '#!/usr/bin/env bash\necho "door $* " >> "$CALLS"\ncase "$4" in "${CI_RED:-none}") echo "RED ($4)"; exit 1;; "${CI_PENDING:-none}") echo pending; exit 3;; esac\necho "green"; exit 0\n', { mode: 0o755 });
  trees = { root: tree("root"), fw: tree("fw", { "fsr_playbooks/tests/t.py": "", "tooling/tests/t.py": "" }), conn: tree("conn"), aa: tree("aa"), mon: tree("mon") };
  ENV = { ...ENV, RC_SRC_ROOT: trees.root, RC_SRC_FW: trees.fw, RC_SRC_CONN: trees.conn, RC_SRC_AA: trees.aa, RC_SRC_MON: trees.mon,
          RC_PY_DOCKER: path.join(T, "pydock"), RC_PY: path.join(T, "fakepy"), RC_DOOR: path.join(T, "fakedoor") };
});
afterEach(() => fs.rmSync(T, { recursive: true, force: true }));
const heads = () => [trees.root, trees.fw, trees.conn, trees.aa, trees.mon];

describe("release-check run", () => {
  test("runs the full connector suite against the framework tree, both framework suites, CI on all five mains, and records the heads", () => {
    const r = run(["run"]);
    expect(r.code).toBe(0);
    const l = log();
    expect(l.find((x) => /^container connector /.test(x))).toContain(`connector ${trees.conn} | FW=${trees.fw}`);
    // the framework suites run in the container too, one process per suite, with the marker filter
    const fwRuns = l.filter((x) => /^container framework /.test(x));
    expect(fwRuns.length).toBe(2);
    expect(fwRuns[0]).toContain(`framework ${trees.fw} -m not live and not slow fsr_playbooks/tests`);
    expect(fwRuns[1]).toContain("tooling/tests");
    expect(l.filter((x) => /^python -m pytest/.test(x)).length).toBe(0);
    expect(l.filter((x) => /^door ci status/.test(x)).length).toBe(5);
    expect(fs.readdirSync(REC).length).toBe(1);
    expect(run(["verify", ...heads()]).code).toBe(0);
  });
  test("a red connector suite fails and records nothing", () => {
    const r = run(["run"], { PYD_RC: "1" });
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/full connector suite is red/);
    expect(fs.existsSync(REC)).toBe(false);
  });
  test("a red framework suite fails and records nothing (container, and host when no engine)", () => {
    const r = run(["run"], { PYDFW_RC: "1" });
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/framework fsr_playbooks\/tests is red/);
    expect(log().some((x) => /^python -m pytest/.test(x))).toBe(false);
    expect(run(["run"], { PYDFW_RC: "75", PY_RC: "1" }).code).not.toBe(0);
    expect(fs.existsSync(REC)).toBe(false);
  });
  test("no container engine for the framework suites (exit 75): both run on the host instead", () => {
    const r = run(["run"], { PYDFW_RC: "75" });
    expect(r.code).toBe(0);
    expect(log().filter((x) => /^python -m pytest/.test(x)).length).toBe(2);
  });
  test("red CI on any main fails; a CI run that never finishes fails after the wait", () => {
    expect(run(["run"], { CI_RED: "conn" }).out).toMatch(/CI on conn main is not green/);
    expect(run(["run"], { CI_PENDING: "aa" }).code).not.toBe(0);
    expect(fs.existsSync(REC)).toBe(false);
  });
});

describe("release-check verify (what make stable asks)", () => {
  test("refuses heads nobody checked, and refuses once any main moved", () => {
    expect(run(["verify", ...heads()]).code).toBe(1);
    expect(run(["run"]).code).toBe(0);
    expect(run(["verify", ...heads()]).code).toBe(0);
    fs.writeFileSync(path.join(trees.conn, "b.txt"), "b\n"); git(trees.conn, "add", "-A"); git(trees.conn, "commit", "-qm", "moved");
    const r = run(["verify", ...heads()]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/NOT passed on these exact mains/);
  });
});

describe("wiring", () => {
  test("make stable verifies the record before it guards or installs, except for --build-only", () => {
    const v = STABLE.indexOf("release_check.sh\" verify");
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThan(STABLE.indexOf("SRC_CONN/scripts/stable_guard.py"));
    expect(v).toBeLessThan(STABLE.indexOf("SRC_CONN/scripts/stable_install.py"));
    expect(STABLE.slice(STABLE.lastIndexOf("case", v), v)).toMatch(/--build-only/);
  });
  test("only --build-only skips the check: the case has no catch-all arm", () => {
    const v = STABLE.indexOf("release_check.sh\" verify");
    const c = STABLE.slice(STABLE.lastIndexOf("case", v), v);
    expect(c).not.toMatch(/\|\s*\*\)/);
  });
  test("make release-check exists", () => {
    expect(MAKEFILE).toMatch(/^release-check:.*\n\t@\$\(RFM\) release_check\.sh run/m);
  });
});
