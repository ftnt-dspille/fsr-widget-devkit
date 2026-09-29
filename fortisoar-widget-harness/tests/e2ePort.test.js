/**
 * @jest-environment node
 */
"use strict";
// Concurrent e2e runs must never share harness ports (tests/e2e/_port.js).
//
// Live: a `c3charts` run from the IDE booted on 14401/14402 while a widget
// ship was mid-e2e; with reuseExistingServer the ship had adopted servers that
// then went away -- 61 "failures", every one net::ERR_CONNECTION_REFUSED.

const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");

let tmp;
function load() {
  jest.resetModules();
  return require("./e2e/_port.js");
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "e2eport-"));
  process.env.TMPDIR = tmp;                 // os.tmpdir() -> an isolated lock dir
  delete process.env.E2E_BASE_PORT;
  delete process.env.E2E_REUSE;
});

afterEach(() => {
  delete process.env.E2E_BASE_PORT;
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("an explicit E2E_BASE_PORT wins", () => {
  process.env.E2E_BASE_PORT = "15555";
  expect(load().resolveBasePort()).toBe(15555);
});

test("the choice is exported so workers and fixtures agree", () => {
  const base = load().resolveBasePort();
  expect(process.env.E2E_BASE_PORT).toBe(String(base));
});

test("a pair locked by a live run is skipped", () => {
  const P = load();
  fs.mkdirSync(path.join(P.LOCK_DIR, String(P.FIRST)), { recursive: true });
  fs.writeFileSync(path.join(P.LOCK_DIR, String(P.FIRST), "pid"), String(process.ppid));
  const base = P.resolveBasePort();
  expect(base).not.toBe(P.FIRST);
});

test("a lock whose owner is dead is reclaimed", () => {
  const P = load();
  const lock = path.join(P.LOCK_DIR, String(P.FIRST));
  fs.mkdirSync(lock, { recursive: true });
  fs.writeFileSync(path.join(lock, "pid"), "999999");       // no such process
  // Only reclaimable if the ports themselves are free on this machine.
  const base = P.resolveBasePort();
  expect(fs.readFileSync(path.join(P.LOCK_DIR, String(base), "pid"), "utf8"))
    .toBe(String(process.pid));
});

test("a pair whose port is already bound (an orphan server) is skipped", async () => {
  const P = load();
  // Bind whatever pair the picker would choose first, then ask again.
  const first = P.resolveBasePort();
  fs.rmSync(path.join(P.LOCK_DIR, String(first)), { recursive: true, force: true });
  delete process.env.E2E_BASE_PORT;
  const srv = net.createServer();
  await new Promise((r) => srv.listen(first, r));
  try {
    expect(load().resolveBasePort()).not.toBe(first);
  } finally {
    await new Promise((r) => srv.close(r));
  }
});
