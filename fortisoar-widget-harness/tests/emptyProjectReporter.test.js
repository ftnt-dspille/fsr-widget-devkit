"use strict";

/**
 * The empty-project gate's own gate (PLAN_testing_that_can_fail 0.2).
 *
 * `scripts/jest-empty-project-reporter.js` fails a run in which a configured
 * Jest project contributed zero test files -- the "a gate that selects nothing
 * is indistinguishable from a gate that passes" class. These tests are its
 * mutation proof: each one describes a way the reporter could go quietly dead
 * and asserts it doesn't.
 *
 * Live proof recorded alongside these (2026-08-05): a two-project config whose
 * second project pointed at an empty directory exits 1 with
 * "jest project(s) that ran ZERO test files: dead", while the same config with
 * both projects populated exits 0.
 */
const Reporter = require("../scripts/jest-empty-project-reporter.js");

function run(expectProjects, ranNames, globalConfig = {}) {
  const saved = process.exitCode;
  process.exitCode = undefined;
  const errs = [];
  const origErr = console.error;
  console.error = (...a) => errs.push(a.join(" "));
  try {
    const r = new Reporter(globalConfig, { expectProjects });
    r.onRunComplete(
      new Set(),
      { testResults: ranNames.map((n) => ({ displayName: { name: n } })) }
    );
    return { code: process.exitCode, out: errs.join("\n") };
  } finally {
    console.error = origErr;
    process.exitCode = saved;
  }
}

test("every configured project ran → green", () => {
  const { code } = run(["harness", "fsrPlaybookBuilder"],
                       ["harness", "fsrPlaybookBuilder"]);
  expect(code).toBeUndefined();
});

test("a project that ran zero files → red, and names it", () => {
  const { code, out } = run(["harness", "fsrPlaybookBuilder"], ["harness"]);
  expect(code).toBe(1);
  expect(out).toMatch(/fsrPlaybookBuilder/);
  expect(out).toMatch(/ZERO test files/);
});

test("no expectProjects → red, never a vacuous pass", () => {
  // The reporter cannot discover the project list itself (Jest drops a
  // zero-file project before reporters run), so a missing option would make it
  // silently approve of everything -- the exact bug it exists to catch.
  const { code, out } = run([], ["harness"]);
  expect(code).toBe(1);
  expect(out).toMatch(/expectProjects/);
});

test("a name-filtered run does not cry empty", () => {
  const { code } = run(["harness", "fsrPlaybookBuilder"], ["harness"],
                       { testNamePattern: "something" });
  expect(code).toBeUndefined();
});

test("a path-filtered run does not cry empty", () => {
  const { code } = run(["harness", "fsrPlaybookBuilder"], ["harness"],
                       { testPathPatterns: ["tests/foo"] });
  expect(code).toBeUndefined();
});

test("the real jest.config wires the reporter with its own project list", () => {
  // Guards the copy: the reporter is only as good as the names handed to it,
  // and those are hand-passed in the config. If someone adds a project to
  // `projects` without updating `expectProjects`, this drifts silently -- so
  // assert they come from the same array.
  const cfg = require("../jest.config.js");
  const entry = (cfg.reporters || []).find(
    (r) => Array.isArray(r) && String(r[0]).includes("jest-empty-project-reporter"));
  expect(entry).toBeDefined();
  const expected = entry[1].expectProjects;
  expect(expected).toEqual(cfg.projects.map((p) => p.displayName));
  expect(expected.length).toBeGreaterThan(0);
  expect(cfg.passWithNoTests).toBe(false);
});
