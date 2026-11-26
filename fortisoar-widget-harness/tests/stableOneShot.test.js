"use strict";
// make stable BOX=<alias> [BUMP=patch]: the one-shot path. The bump ship and the stamp re-proof are driven through
// fakes (agent_tree.sh, make, box.sh); nothing touches a box.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const SCRIPTS = path.join(__dirname, "..", "..", "scripts");
const STABLE = fs.readFileSync(path.join(SCRIPTS, "stable.sh"), "utf8");
const MAKEFILE = fs.readFileSync(path.join(__dirname, "..", "..", "Makefile"), "utf8");
let T, LOG;
const log = () => (fs.existsSync(LOG) ? fs.readFileSync(LOG, "utf8").split("\n").filter(Boolean) : []);
const exe = (name, body) => { const f = path.join(T, name); fs.writeFileSync(f, body, { mode: 0o755 }); return f; };
// The scripts read these from the caller; an agent tree or a ship exports them (FSR_SRC from agent-tree.env),
// so the test starts from a clean slate and sets only what it means to.
const LEAKY = ["FSR_SRC", "BOX", "BOX_ENV", "PROVE_BOX", "BUMP", "ARGS", "MAKEFLAGS", "MAKEOVERRIDES", "MFLAGS", "FSR_LEASE_HOLDER"];
const sh = (script, args, env = {}) => {
  const base = { ...process.env };
  for (const k of LEAKY) delete base[k];
  const r = spawnSync("bash", [path.join(SCRIPTS, script), ...args], { encoding: "utf8", timeout: 60000, env: { ...base, LOG, ...env } });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};

beforeEach(() => {
  T = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "stable1-")));
  LOG = path.join(T, "calls.log");
});
afterEach(() => fs.rmSync(T, { recursive: true, force: true }));

describe("stable_bump.sh: one ship for every repo that needs a bump", () => {
  const fakes = () => ({
    STABLE_BUMP_TREE: exe("tree.sh", `#!/usr/bin/env bash
echo "tree $*" >> "$LOG"
[ "$1" = env ] && { echo "export FSR_ALL_WIDGETS='${T}'"; echo "export AGENT_TREE='${T}'"; }
exit 0
`),
    STABLE_BUMP_MAKE: exe("make.sh", `#!/usr/bin/env bash
echo "make $* | BOX=\${BOX-unset} BUMP=\${BUMP-unset} MAKEFLAGS=\${MAKEFLAGS-unset}" >> "$LOG"
exit \${MAKE_RC:-0}
`),
  });
  test("creates ONE tree with a branch per listed repo, runs ONE make ship BUMP=patch without the stable BOX, removes the tree", () => {
    const r = sh("stable_bump.sh", ["patch", "connector", "agenticAssistant", "agenticAssistantMonitor"], { ...fakes(), BOX: "81", ARGS: "--force", MAKEFLAGS: " -- BOX=81 BUMP=patch", MAKEOVERRIDES: "BOX=81" });
    expect(r.code).toBe(0);
    const l = log();
    const create = l.filter((x) => /^tree create /.test(x));
    expect(create).toHaveLength(1);
    expect(create[0]).toMatch(/connector=new:bump\/stable-\d+ agenticAssistant=new:bump\/stable-\d+ agenticAssistantMonitor=new:bump\/stable-\d+/);
    const ships = l.filter((x) => /^make ship/.test(x));
    expect(ships).toHaveLength(1);
    expect(ships[0]).toContain("BUMP=patch");
    expect(ships[0]).toMatch(/\| BOX=unset BUMP=patch MAKEFLAGS=unset/);   // make stable BOX=81 rides in MAKEFLAGS too
    expect(l.filter((x) => /^tree remove /.test(x))).toHaveLength(1);
  });
  test("PROVE_BOX pins the experimental box for the ship", () => {
    sh("stable_bump.sh", ["patch", "connector"], { ...fakes(), BOX: "81", PROVE_BOX: "92" });
    expect(log().find((x) => /^make ship/.test(x))).toMatch(/BOX=92/);
  });
  test("a failing ship fails the run and still removes the tree; bad input is refused before any tree is made", () => {
    expect(sh("stable_bump.sh", ["patch", "connector"], { ...fakes(), MAKE_RC: "1" }).code).not.toBe(0);
    expect(log().filter((x) => /^tree remove /.test(x))).toHaveLength(1);
    fs.writeFileSync(LOG, "");
    expect(sh("stable_bump.sh", ["huge", "connector"], fakes()).code).toBe(2);
    expect(sh("stable_bump.sh", ["patch", "framework"], fakes()).code).toBe(2);
    expect(sh("stable_bump.sh", ["patch"], fakes()).code).toBe(2);
    expect(log()).toEqual([]);
  });
});

describe("stable_prove.sh: re-prove stale stamps on an experimental box", () => {
  const fakes = (extra = {}) => ({
    STABLE_PROVE_MAKE: exe("make.sh", `#!/usr/bin/env bash
echo "make $* | FSR_SRC=\${FSR_SRC-unset}" >> "$LOG"
exit \${MAKE_RC:-0}
`),
    STABLE_PROVE_BOXSH: exe("box.sh", `#!/usr/bin/env bash
case "$1" in --lease) echo "lease $2" >> "$LOG"; exit \${LEASE_RC:-0} ;; --list) echo "81 92"; exit 0 ;; --role) [ "$2" = 92 ] && echo experimental || echo stable; exit 0 ;; esac
exit 0
`),
    PROVE_BOX: "92", ...extra,
  });
  const prove = (names, env) => sh("stable_prove.sh", ["/r", "/fw", "/conn", ...names], fakes(env));
  test("dev-push once for connector+framework, widget-push per widget, doctor SANITY for the root; lease released", () => {
    const r = prove(["conn_main", "fsr-playbook-framework", "agenticAssistant", "fsr_all_widgets"]);
    expect(r.code).toBe(0);
    const l = log();
    expect(l.filter((x) => /dev-push/.test(x))).toEqual(["make -C /conn dev-push BOX=92 | FSR_SRC=/fw"]);
    expect(l.filter((x) => /widget-push/.test(x))).toEqual(["make -C /r widget-push WIDGET=agenticAssistant WIDGETS_SRC=/r/widgets-src BOX=92 | FSR_SRC=unset"]);
    expect(l.filter((x) => /doctor/.test(x))[0]).toMatch(/doctor BOX=92 SANITY=1 STAMP=\/r CONN_REPO=\/conn/);
    expect(l.some((x) => /box-release BOX=92/.test(x))).toBe(true);
  });
  test("a box it cannot lease is exit 3 (the caller prints the commands), not a silent pass", () => {
    const r = prove(["conn_main"], { LEASE_RC: "2" });
    expect(r.code).toBe(3);
    expect(log().some((x) => /dev-push/.test(x))).toBe(false);
  });
  test("a failed push fails the proof", () => {
    expect(prove(["conn_main"], { MAKE_RC: "1" }).code).toBe(1);
  });
});

describe("stable.sh wiring", () => {
  test("the Makefile hands BUMP to make stable", () => {
    expect(MAKEFILE).toMatch(/BUMP='\$\(BUMP\)' \$\(RFM\) stable\.sh/);
  });
  test("ONE pass gathers release-check, the preflight and the guard before anything is built, and refuses with the complete list", () => {
    const g = STABLE.slice(STABLE.indexOf("gather() {"), STABLE.indexOf("blocked() {"));
    expect(g).toContain('"$RC_SH" verify');
    expect(g).toContain("stable_install.py\" --preflight");
    expect(g).toContain("stable_guard.py");
    expect(g).toContain("--json");
    expect(STABLE.indexOf("stable_pass\n")).toBeLessThan(STABLE.indexOf('stable_install.py" ${ARGS'));
    expect(STABLE).toMatch(/Everything that blocks BOX=\$BOX, with the one command for each/);
    expect(STABLE).toMatch(/make stable BOX=\$BOX BUMP=patch/);
  });
  test("BUMP runs stable_bump.sh for the same-version conflicts only, carries the release-check record, and re-proves stale stamps", () => {
    expect(STABLE).toMatch(/select\(\.reason=="same-version"\)/);
    expect(STABLE).toContain('stable_bump.sh" "$level"');
    expect(STABLE).toContain('"$RC_SH" carry');
    expect(STABLE).toContain("stable_prove.sh");
    expect(STABLE.indexOf("stable_bump.sh")).toBeLessThan(STABLE.indexOf("stable_prove.sh"));
  });
  test("the installer is not given BUMP (versions are bumped in the repos, never on the box)", () => {
    expect(STABLE).not.toMatch(/stable_install\.py[^\n]*BUMP/);
  });
});
