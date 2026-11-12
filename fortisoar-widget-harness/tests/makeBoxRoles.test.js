"use strict";
// Box roles (roadmap L1): a registry box with role = "stable" is for customer
// demos, released builds only. Every root target that sends UNRELEASED code to a
// box passes the `push` need token to the connector's scripts/box.sh, which refuses
// a stable box before anything is sent; read-only targets must still reach it.
//
// Uses the REAL box.sh with a temp registry (no real registry, no network). It
// needs a connector repo whose box.sh knows roles: set BOX_ROLES_CONN_REPO, else
// CONN_REPO, else the Makefile default. When that box.sh (or pyfsr) cannot answer
// `--role`, the suite is SKIPPED and reported as not run, never counted as a pass.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const REPO = path.resolve(__dirname, "..", "..");
const CONN = process.env.BOX_ROLES_CONN_REPO || process.env.CONN_REPO || path.join(os.homedir(), "PycharmProjects/ConnectorsV2/conn_main");
const BOXSH = path.join(CONN, "scripts", "box.sh");

let tmp;
let baseEnv;
function sh(cmd, args, env, extra = {}) {
  return spawnSync(cmd, args, { cwd: REPO, env: { ...baseEnv, ...env }, encoding: "utf8", timeout: 120000, ...extra });
}

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "boxroles-"));
  for (const n of ["stab", "expe", "unst"]) fs.writeFileSync(path.join(tmp, `.env.${n}`), `FSR_BASE_URL=https://${n}.example.com\nFSR_API_KEY=k\n`);
  const inst = (n, role) => `[instances.${n}]\nenv_file = "${tmp}/.env.${n}"\n${role ? `role = "${role}"\n` : ""}[instances.${n}.appliance]\nhost = "ssh-${n}.example.com"\nuser = "admin"\nport = 22\nkey_path = "/keys/${n}"\n`;
  fs.writeFileSync(path.join(tmp, "instances.toml"), [inst("stab", "stable"), inst("expe", "experimental"), inst("unst", "")].join("\n"));
  baseEnv = { PATH: process.env.PATH, HOME: process.env.HOME, PYFSR_INSTANCES: path.join(tmp, "instances.toml"),
    FSR_BOX_ALLOW: "stab expe unst", FSR_BOX_CACHE: path.join(tmp, "cache"), CONN_REPO: CONN };
  if (process.env.PYFSR_PY) baseEnv.PYFSR_PY = process.env.PYFSR_PY;
  if (process.env.PYTHONPATH) baseEnv.PYTHONPATH = process.env.PYTHONPATH;
});
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

function roleSupported() {
  if (!fs.existsSync(BOXSH)) return false;
  const r = sh("bash", [BOXSH, "--role", "stab"], {});
  return r.status === 0 && r.stdout.trim() === "stable";
}
let supported;
const t = (name, fn) => test(name, () => {
  supported = supported === undefined ? roleSupported() : supported;
  if (!supported) { console.warn(`SKIPPED (not run): ${BOXSH} has no role support or pyfsr is unavailable`); return; }
  fn();
});

// -o harness-build: the TypeScript build is not under test and is not needed to
// reach the box resolution, which is the first recipe line of each target.
const make = (args, env = {}) => {
  const r = sh("make", ["-o", "harness-build", "--no-print-directory", ...args], env);
  return { code: r.status, out: `${r.stdout || ""}${r.stderr || ""}` };
};

describe("unreleased-code pushes refuse a stable box before anything is sent", () => {
  t("make push BOX=stable: refused, exit non-zero, push.sh never starts", () => {
    const r = make(["push", "BOX=stab", "DRY_RUN=1"]);
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/STABLE/);
    expect(r.out).not.toMatch(/push\.sh|>> /);
  });
  t("make widget-push BOX=stable: refused before lint/unit/deploy", () => {
    const r = make(["widget-push", "WIDGET=nope", "BOX=stab"]);
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/STABLE/);
    expect(r.out).not.toMatch(/lint|deployed|ship\.sh/i);
  });
  t("make ship-verify BOX=stable: refused before the first gate", () => {
    const r = make(["ship-verify", "WIDGET=nope", "BOX=stab", "CONFIRM_DEPLOY=1"]);
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/STABLE/);
    expect(r.out).not.toMatch(/1\/6/);
  });
  t("make loop BOX=stable: refused before forwarding to the connector", () => {
    const r = make(["loop", "BOX=stab"]);
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/STABLE/);
  });
  t("scripts/push.sh itself refuses a stable box (direct call, DRY_RUN)", () => {
    const r = sh("bash", ["scripts/push.sh"], { BOX: "stab", DRY_RUN: "1" });
    expect(r.status).not.toBe(0);
    expect(`${r.stderr}`).toMatch(/STABLE/);
    expect(`${r.stdout}`).not.toMatch(/^>> (plan|connector|widget)/im);
  });
  t("ALLOW_STABLE_PUSH=1 is the owner's override: not refused for a human, refused under Claude Code", () => {
    const human = sh("bash", ["scripts/push.sh"], { BOX: "stab", DRY_RUN: "1", ALLOW_STABLE_PUSH: "1" });
    expect(`${human.stderr}`).not.toMatch(/is a STABLE box/);
    const agent = sh("bash", ["scripts/push.sh"], { BOX: "stab", DRY_RUN: "1", ALLOW_STABLE_PUSH: "1", CLAUDECODE: "1", CONFIRM_DEPLOY: "1" });
    expect(agent.status).not.toBe(0);
    expect(`${agent.stderr}`).toMatch(/refused under Claude Code/);
  });
});

describe("experimental and unset-role boxes proceed", () => {
  for (const box of ["expe", "unst"]) {
    t(`push.sh BOX=${box} DRY_RUN=1 reaches the plan`, () => {
      const r = sh("bash", ["scripts/push.sh"], { BOX: box, DRY_RUN: "1" });
      expect(`${r.stderr}`).not.toMatch(/STABLE/);
      expect(`${r.stdout}${r.stderr}`).toMatch(/target box: |>> /);
    });
    t(`make widget-push BOX=${box} passes the box gate and reaches the lint step`, () => {
      const r = make(["widget-push", "WIDGET=nope", "BOX=" + box]);
      expect(r.out).not.toMatch(/STABLE/);
      expect(r.out).toMatch(/target box: /);
      expect(r.out).toMatch(/lint|nope/i);
    });
  }
});

describe("read-only targets still reach a stable box", () => {
  t("the read-only box gate (require_box: --need env) passes for a stable box", () => {
    const r = sh("bash", [BOXSH, "--need", "env"], { BOX: "stab" });
    expect(r.status).toBe(0);
    expect(`${r.stderr}`).toMatch(/role: stable/);
  });
  for (const target of ["test-live-sweep", "doctor", "session-health"]) {
    t(`make ${target} BOX=stable is not refused (plan only)`, () => {
      const r = sh("make", ["-n", "-o", "harness-build", "--no-print-directory", target, "BOX=stab"], {});
      expect(r.status).toBe(0);
      expect(`${r.stdout}`).not.toMatch(/--need env,push/);
      expect(`${r.stdout}`).toMatch(/--need env\b/);
    });
  }
  t("the push targets, by contrast, request the push need", () => {
    for (const target of ["push", "widget-push", "ship-verify", "loop"]) {
      const r = sh("make", ["-n", "-o", "harness-build", "--no-print-directory", target, "WIDGET=w", "BOX=stab", "CONFIRM_DEPLOY=1"], {});
      expect(r.stdout).toMatch(/--need env,push/);
    }
  });
});
