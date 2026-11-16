"use strict";
// Structure test: a ship runs only the tests of the thing shipped. The repo's own
// tooling suites (TOOLING_SUITES in jest.config.js, the ONE list) run only in the
// repo's own gate (`make test-full` / `make test`), never from test-unit, which
// widget-push and ship-verify call.
const path = require("path");
const { spawnSync } = require("child_process");

const REPO = path.resolve(__dirname, "..", "..");
const plan = (args) => {
  const r = spawnSync("make", ["-n", "--no-print-directory", "-o", "harness-build", ...args],
    { cwd: REPO, env: { PATH: process.env.PATH, HOME: process.env.HOME }, encoding: "utf8", timeout: 60000 });
  return `${r.stdout || ""}${r.stderr || ""}`;
};

test("test-unit (what every ship path calls) skips the tooling suites", () => {
  expect(plan(["test-unit", "WIDGET=x"])).toMatch(/SKIP_TOOLING_TESTS=1 pnpm test/);
});

test("test-full and test run them, across every widget", () => {
  for (const t of ["test-full", "test"]) {
    const out = plan([t]);
    expect(out).toMatch(/SKIP_TOOLING_TESTS=0 pnpm test/);
    expect(out).toMatch(/WIDGET="all"/);
  }
});

test("ship targets reach unit tests only through test-unit, with no per-target skip flag", () => {
  const mk = require("fs").readFileSync(path.join(REPO, "Makefile"), "utf8");
  expect(mk.match(/SKIP_TOOLING_TESTS/g)).toHaveLength(1); // only test-unit's recipe sets it: one place
});

test("jest.config.js skips every listed tooling suite when SKIP_TOOLING_TESTS=1 and none otherwise", () => {
  const load = (flag) => {
    const r = spawnSync(process.execPath, ["-e",
      "const c=require('./jest.config.js');console.log(JSON.stringify(c.projects[0].testPathIgnorePatterns))"],
      { cwd: path.join(REPO, "fortisoar-widget-harness"), env: { PATH: process.env.PATH, SKIP_TOOLING_TESTS: flag }, encoding: "utf8" });
    return JSON.parse(r.stdout);
  };
  const named = ["promoteGate", "promoteGate.hook", "makeBoxRoles", "guardOtherReposInstall", "guardOtherReposInstall.connector"];
  const on = load("1");
  for (const n of named) expect(on.some((p) => p.includes(`tests/${n}`))).toBe(true);
  const off = load("0");
  for (const n of named) expect(off.some((p) => p.includes(`tests/${n}`))).toBe(false);
});
