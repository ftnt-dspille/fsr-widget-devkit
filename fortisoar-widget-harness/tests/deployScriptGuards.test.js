"use strict";
// The deploy-script half of the effect-level guards (TESTING.md, "Guardrails"):
// ship.sh, release.sh, scripts/push.sh, install.sh, soar-add-theme.sh and the
// widget.js push/ship subcommands refuse under CLAUDECODE before doing anything.
//
// These are run for real, so every probe passes arguments that are harmless even
// if a guard were removed: a bogus flag, a widget folder that does not exist, a
// missing env file, or the non-root path. Nothing here may reach a box.

const path = require("path");
const { spawnSync } = require("child_process");

const REPO = path.resolve(__dirname, "..", "..");
const HARNESS = path.join(REPO, "fortisoar-widget-harness");
const GUARD_MSG = /deploys\/releases are the user's to run; a human can override with CONFIRM_DEPLOY=1/;

function run(cmd, args, { env = {}, cwd = REPO } = {}) {
  const base = { ...process.env };
  for (const k of ["CLAUDECODE", "CONFIRM_DEPLOY", "VIA_MAKE", "VIA_LOOP", "DRY_RUN", "ENV"]) delete base[k];
  const r = spawnSync(cmd, args, { cwd, env: { ...base, ...env }, encoding: "utf8", timeout: 30000 });
  return { code: r.status, out: `${r.stdout || ""}${r.stderr || ""}` };
}

// [label, command, args, extra env] -- each is harmless if its guard is absent.
const REFUSED = [
  ["ship.sh", "bash", [path.join(HARNESS, "scripts/ship.sh"), "--bogus-flag"], {}],
  ["release.sh", "bash", [path.join(HARNESS, "scripts/release.sh"), "noSuchWidget"], {}],
  ["scripts/push.sh", "bash", [path.join(REPO, "scripts/push.sh")], { ENV: "/nonexistent/.env", DRY_RUN: "1" }],
  ["install.sh", "bash", [path.join(REPO, "scripts/install.sh")], {}],
  ["soar-add-theme.sh", "bash", [path.join(REPO, "scripts/soar-add-theme.sh")], {}],
  ["widget.js push", "node", [path.join(HARNESS, "scripts/widget.js"), "push", "noSuchWidget"], {}],
  ["widget.js ship", "node", [path.join(HARNESS, "scripts/widget.js"), "ship", "noSuchWidget"], {}],
];

describe.each(REFUSED)("%s refuses under CLAUDECODE before doing anything", (_label, cmd, args, env) => {
  test("exit 2 with the one-line reason", () => {
    const r = run(cmd, args, { env: { CLAUDECODE: "1", ...env } });
    expect(r.code).toBe(2);
    expect(r.out).toMatch(GUARD_MSG);
  });
});

describe("make loop's widget step is not refused", () => {
  // The root `make loop` exports VIA_LOOP=1 and the connector's loop.sh then calls
  // ship.sh. The bogus flag stops the script before any push, so this proves only
  // that the guard let the dev-loop call through.
  test("ship.sh under CLAUDECODE with VIA_LOOP=1 gets past the guard", () => {
    const r = run("bash", [path.join(HARNESS, "scripts/ship.sh"), "--bogus-flag"], {
      env: { CLAUDECODE: "1", VIA_LOOP: "1" },
    });
    expect(r.out).not.toMatch(GUARD_MSG);
    expect(r.out).toMatch(/unknown flag/);
  });
});

describe("the same probes are not refused for a human shell", () => {
  // Without CLAUDECODE the guard must stay silent. The probes still fail on their
  // own terms (usage, unknown flag, missing folder, non-root), which is the point:
  // they prove the guard did not fire, and that nothing was deployed.
  test.each(REFUSED)("%s", (_label, cmd, args, env) => {
    const r = run(cmd, args, { env });
    expect(r.out).not.toMatch(GUARD_MSG);
  });
});
