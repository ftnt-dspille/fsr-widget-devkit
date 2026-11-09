"use strict";
// `make test-e2e-spec`: SPEC must win when WIDGET is also set (it used to be
// silently ignored). Checked with `make -n`, which prints the recipe, runs nothing.

const path = require("path");
const { spawnSync } = require("child_process");

const REPO = path.resolve(__dirname, "..", "..");

function plan(args) {
  const base = { ...process.env };
  for (const k of ["CLAUDECODE", "CONFIRM_DEPLOY", "VIA_MAKE"]) delete base[k];
  const r = spawnSync("make", ["-n", "test-e2e-spec", ...args], { cwd: REPO, env: base, encoding: "utf8", timeout: 60000 });
  expect(r.status).toBe(0);
  return r.stdout.split("\n").find((l) => l.includes("pnpm test:e2e")) || "";
}

describe("make test-e2e-spec argument selection", () => {
  test("SPEC alone passes each spec", () => {
    const l = plan(["SPEC=tests/e2e/a.spec.js,tests/e2e/b.spec.js"]);
    expect(l).toContain("'tests/e2e/a.spec.js' 'tests/e2e/b.spec.js'");
  });
  test("WIDGET alone passes the widget name", () => {
    expect(plan(["WIDGET=someWidget"])).toMatch(/pnpm test:e2e someWidget --reporter/);
  });
  test("SPEC wins when WIDGET is also set", () => {
    const l = plan(["WIDGET=someWidget", "SPEC=tests/e2e/a.spec.js"]);
    expect(l).toContain("'tests/e2e/a.spec.js'");
    expect(l).not.toContain("someWidget");
  });
});
