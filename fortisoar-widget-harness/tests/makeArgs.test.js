"use strict";
// A misspelt make variable is refused at once with a did-you-mean
// (scripts/make_args.sh), instead of being silently ignored.
const path = require("path");
const { spawnSync } = require("child_process");
const ROOT = path.resolve(__dirname, "../..");
const mk = (...a) => spawnSync("make", ["-n", "-C", ROOT, "help", ...a], { encoding: "utf8", env: { ...process.env, MAKE_ARGS_OFF: "" } });

test("a misspelt variable is refused, naming the variable it was probably meant to be", () => {
  const r = mk("BRNCH=feat/x");
  expect(r.status).not.toBe(0);
  expect(r.stderr).toMatch(/unknown variable BRNCH \(did you mean BRANCH\?\)/);
});

test.each([["BRANCH=x", "REPO=/r"], ["WIDGET=a", "BOX=92", "BUMP=patch"], ["SANITY=1", "STAMP=/a:/b", "LOCAL=1"]])(
  "variables something reads pass: %s", (...args) => {
    expect(mk(...args).stderr).not.toMatch(/unknown variable/);
  });

test("MAKE_ARGS_OFF=1 skips the check", () => {
  const r = spawnSync("make", ["-n", "-C", ROOT, "help", "BRNCH=x"], { encoding: "utf8", env: { ...process.env, MAKE_ARGS_OFF: "1" } });
  expect(r.stderr).not.toMatch(/unknown variable/);
});
