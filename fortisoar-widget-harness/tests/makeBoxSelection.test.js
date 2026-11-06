"use strict";
// BOX=<alias> is the one box knob (the pyfsr registry, resolved by the connector
// repo's scripts/box.sh). These pin the Makefile wiring with a stub box.sh, so no
// registry, network or pyfsr is involved: every box-reaching recipe takes its env
// file from the one resolution, the retired knobs (SHIP_ENV, SWEEP_ENV, ...) are
// handed to box.sh to warn or refuse instead of being read here, and a worktree
// run finds the widget repos without a hand-set WIDGETS_SRC.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const REPO = path.resolve(__dirname, "..", "..");

let stub;
let log;
beforeAll(() => {
  stub = fs.mkdtempSync(path.join(os.tmpdir(), "boxsel-"));
  fs.mkdirSync(path.join(stub, "scripts"));
  log = path.join(stub, "calls.log");
  fs.writeFileSync(path.join(stub, "scripts", "box.sh"), `#!/usr/bin/env bash
echo "BOX=\${BOX:-} SHIP_ENV=\${SHIP_ENV:-} ARGS=$*" >> "${log}"
case "$*" in
  *--main-checkout*) echo "${REPO}" ;;
  *--make*) [ -n "\${BOX:-}\${SHIP_ENV:-}" ] && echo "alpha ${stub}/.env.alpha - -" ;;
esac
exit 0
`);
});
afterAll(() => fs.rmSync(stub, { recursive: true, force: true }));

function make(args) {
  const env = { ...process.env, CONN_REPO: stub };
  for (const k of ["CLAUDECODE", "BOX", "ENV", "SHIP_ENV", "SWEEP_ENV", "MATRIX_ENV", "LIVE_ENV", "SSH_HOST", "WIDGETS_SRC"]) delete env[k];
  fs.writeFileSync(log, "");
  const r = spawnSync("make", ["-n", "--no-print-directory", ...args], { cwd: REPO, env, encoding: "utf8", timeout: 60000 });
  return { code: r.status, out: `${r.stdout || ""}${r.stderr || ""}`, calls: fs.readFileSync(log, "utf8") };
}

test("widget-push deploys and live-sanities the ONE resolved box", () => {
  const r = make(["widget-push", "WIDGET=w", "BOX=alpha"]);
  expect(r.code).toBe(0);
  expect(r.out).toContain(`FSR_ENV_FILE=${stub}/.env.alpha`);
  expect(r.out).toMatch(/BOX="alpha" WIDGETS="w"/);
  expect(r.out).toMatch(/BOX='alpha' +bash ".*\/scripts\/box\.sh" --need env/);
});

test("ship-verify: the deploy and the sweep get the same box", () => {
  const r = make(["ship-verify", "WIDGET=w", "BOX=alpha", "CONFIRM_DEPLOY=1"]);
  expect(r.out).toContain(`FSR_ENV_FILE=${stub}/.env.alpha`);
  expect(r.out).toMatch(/BOX=alpha bash scripts\/ship-verify-sweep\.sh/);
  expect(r.out).not.toMatch(/SWEEP_ENV|SHIP_ENV/);
});

test.each(["test-live-sweep", "test-mcp-surface-live", "test-designer-stage-live", "test-matrix-live"])(
  "%s sources the resolved env file, never a per-area knob", (target) => {
    const r = make([target, "BOX=alpha"]);
    expect(r.out).toContain(`. "${stub}/.env.alpha"`);
  });

test("a retired knob is handed to box.sh (to warn or refuse), not read by make", () => {
  const r = make(["test-live-sweep", "SHIP_ENV=.env.alpha"]);
  expect(r.calls).toMatch(/SHIP_ENV=\.env\.alpha ARGS=--need env,ssh\? --make/);
  expect(r.out).toMatch(/SHIP_ENV='\.env\.alpha' +bash ".*box\.sh" --need env/);
});

test("no BOX: nothing is resolved at parse time and no env file is sourced", () => {
  const r = make(["test-live-sweep"]);
  expect(r.calls).not.toMatch(/--make/);
  expect(r.out).toContain('. ""');
});

test("WIDGETS_SRC defaults to a checkout that actually holds widget repos (worktree-safe)", () => {
  const r = make(["widget-push", "WIDGET=w", "BOX=alpha"]);
  const m = r.out.match(/WIDGETS_SRC=(\S+) node scripts\/lint-angular/);
  expect(m).not.toBeNull();
  const dirs = fs.readdirSync(m[1]).filter((d) => fs.existsSync(path.join(m[1], d, "widget", "info.json")));
  expect(dirs.length).toBeGreaterThan(0);
});
