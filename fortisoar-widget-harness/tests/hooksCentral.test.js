"use strict";
// One installed copy of the guard hooks (scripts/hooks_central.sh). Live: repos
// pointed into the shared root checkout, so the guard that ran was another
// session's branch (the slow guard kept running after the fast one was on
// main), and per-repo copies in the framework and connector went stale.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync, execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const LIB = path.join(ROOT, "scripts", "hooks_central.sh");
let T, ENV;
const g = (cwd, ...a) => execFileSync("git", ["-C", cwd, ...a], { env: ENV, encoding: "utf8" }).trim();
const run = (cmd, ...a) => spawnSync("bash", [LIB, cmd, ...a], { env: { ...ENV, FSR_ROOT_DIR: path.join(T, "root") }, encoding: "utf8" });
const guard = (body) => {
  const r = path.join(T, "root");
  fs.writeFileSync(path.join(r, "scripts", "githooks", "reference-transaction"), `#!/usr/bin/env bash\n# ${body}\nexit 0\n`);
  g(r, "add", "-A"); g(r, "commit", "-q", "-m", body); g(r, "push", "-q", "origin", "main");
};
function repo(name, hooksPath) {
  const d = path.join(T, name);
  fs.mkdirSync(d); g(d, "init", "-q", "-b", "main");
  if (hooksPath !== undefined) g(d, "config", "core.hooksPath", hooksPath);
  return d;
}

beforeEach(() => {
  T = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "hooks-central-")));
  fs.writeFileSync(path.join(T, "gitconfig"), "[user]\n\tname = t\n\temail = t@example.com\n");
  ENV = { ...process.env, GIT_CONFIG_GLOBAL: path.join(T, "gitconfig"), HOME: T,
          FSR_HOOKS_DIR: path.join(T, "share", "fsr-hooks") };
  for (const k of ["GIT_DIR", "GIT_WORK_TREE", "CLAUDECODE"]) delete ENV[k];
  const r = path.join(T, "root");
  fs.mkdirSync(path.join(r, "scripts", "githooks"), { recursive: true });
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", path.join(T, "root.git")], { env: ENV });
  g(T, "init", "-q", "-b", "main", r);
  g(r, "remote", "add", "origin", path.join(T, "root.git"));
  fs.writeFileSync(path.join(r, "x"), "x\n"); g(r, "add", "-A"); g(r, "commit", "-q", "-m", "x");
  g(r, "push", "-q", "-u", "origin", "main");
  guard("guard v1");
});
afterEach(() => fs.rmSync(T, { recursive: true, force: true }));

test("install: one dir from root's remote main; every repo points at it; a repo's own hooks stay chained", () => {
  const plain = repo("plain");
  const shared = repo("shared", path.join(T, "root", "scripts", "githooks"));
  const conn = repo("conn", "scripts/hooks");
  fs.mkdirSync(path.join(conn, "scripts", "hooks"), { recursive: true });
  fs.writeFileSync(path.join(conn, "scripts", "hooks", "pre-commit"), `#!/bin/sh\necho ran > "${T}/own-hook"\n`, { mode: 0o755 });
  const r = run("install", plain, shared, conn);
  expect(r.stderr).toBe("");
  expect(r.status).toBe(0);
  const dir = ENV.FSR_HOOKS_DIR;
  for (const d of [plain, shared, conn]) expect(g(d, "config", "core.hooksPath")).toBe(dir);
  expect(g(conn, "config", "fsr.guardOriginalHooksPath")).toBe("scripts/hooks");
  expect(spawnSync("git", ["-C", shared, "config", "fsr.guardOriginalHooksPath"], { env: ENV }).status).not.toBe(0);
  expect(fs.readFileSync(path.join(dir, ".installed-from"), "utf8").trim()).toBe(g(path.join(T, "root"), "rev-parse", "origin/main"));
  expect(fs.readFileSync(path.join(dir, "reference-transaction"), "utf8")).toMatch(/guard v1/);
  expect(run("check", plain, shared, conn).status).toBe(0);
  // The connector's own pre-commit still runs through the shim.
  fs.writeFileSync(path.join(conn, "f"), "f\n"); g(conn, "add", "f"); g(conn, "commit", "-q", "-m", "f");
  expect(fs.readFileSync(path.join(T, "own-hook"), "utf8")).toBe("ran\n");
});

test("check fails when root main's guard moved past the installed copy, and passes after install", () => {
  const a = repo("a");
  expect(run("install", a).status).toBe(0);
  guard("guard v2");
  const c = run("check", a);
  expect(c.status).not.toBe(0);
  expect(c.stderr).toMatch(/guard differs/);
  expect(run("install", a).status).toBe(0);
  expect(run("check", a).status).toBe(0);
  expect(fs.readFileSync(path.join(ENV.FSR_HOOKS_DIR, "reference-transaction"), "utf8")).toMatch(/guard v2/);
});

test("check fails when any repo points into a checkout", () => {
  const a = repo("a"); const b = repo("b");
  expect(run("install", a, b).status).toBe(0);
  g(b, "config", "core.hooksPath", path.join(T, "root", "scripts", "githooks"));
  const c = run("check", a, b);
  expect(c.status).not.toBe(0);
  expect(c.stderr).toMatch(/b core.hooksPath=/);
});

test("promote, doctor and agent-tree verify all go through it", () => {
  const rd = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
  expect(rd("scripts/promote_main.sh")).toMatch(/hooks_central\.sh[\s\S]*install/);
  expect(rd("Makefile")).toMatch(/^doctor:.*\n(?:\t.*\n)*\t@bash scripts\/hooks_central\.sh check/m);
  expect(rd("scripts/agent_tree.sh")).toMatch(/hooks_central\.sh" check/);
});
