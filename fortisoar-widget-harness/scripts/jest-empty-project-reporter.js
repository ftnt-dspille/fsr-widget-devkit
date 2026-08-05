"use strict";

/**
 * Fail the run when a configured Jest project contributed ZERO test files.
 *
 * PLAN_testing_that_can_fail 0.2: *a gate that runs over an empty set is
 * indistinguishable from a gate that passes*. Jest's own `passWithNoTests`
 * only guards the run as a WHOLE -- with `projects`, one project can match
 * nothing (a moved `tests/` dir, a testMatch typo, a `testPathIgnorePatterns`
 * that grew to swallow everything) while the others keep the run green. The
 * output for "this widget's suite ran and passed" and "this widget's suite does
 * not exist" is the same output. That is exactly how two pre-commit hooks in
 * the framework repo stayed scoped to a directory deleted months earlier.
 *
 * The expected project names must be passed in as reporter options:
 *
 *     reporters: ["default", ["<rootDir>/scripts/jest-empty-project-reporter.js",
 *                             { expectProjects: ["harness", ...] }]]
 *
 * They cannot be discovered from the reporter's own arguments: Jest builds
 * `testContexts` from the projects that produced tests, so a project matching
 * zero files is already gone by the time any reporter runs -- the very thing
 * this exists to catch would be invisible to it. Verified against jest 29.7.
 */
class EmptyProjectReporter {
  constructor(globalConfig, options) {
    this._globalConfig = globalConfig || {};
    this._expected = (options && options.expectProjects) || [];
  }

  onRunComplete(testContexts, results) {
    if (!this._expected.length) {
      console.error(
        "\n✗ jest-empty-project-reporter got no `expectProjects` option, so it " +
          "cannot tell an empty project from a missing one -- it would pass " +
          "vacuously, which is the bug it exists to catch.\n"
      );
      process.exitCode = 1;
      return;
    }

    // A filtered run is *supposed* to narrow; don't cry empty when the caller
    // asked for a subset (`-t`, a path pattern, or an explicit file argument).
    const g = this._globalConfig;
    const patterns = g.testPathPatterns;
    const hasPathFilter = Array.isArray(patterns)
      ? patterns.length > 0
      : Boolean(patterns && String(patterns.length ? patterns : "").length);
    if (g.testNamePattern || hasPathFilter) return;

    const ran = new Set();
    for (const tr of results.testResults || []) {
      const d = tr.displayName;
      const name = d && (d.name || d);
      if (name) ran.add(String(name));
    }
    // Single-project configs may not stamp a displayName on results at all.
    if (ran.size === 0 && (results.testResults || []).length &&
        this._expected.length === 1) {
      ran.add(this._expected[0]);
    }

    const empty = this._expected.filter((n) => !ran.has(String(n)));
    if (empty.length) {
      console.error(
        `\n✗ jest project(s) that ran ZERO test files: ${empty.join(", ")}\n` +
          "  A suite that collects nothing looks exactly like a suite that passes.\n" +
          "  Fix its testMatch/rootDir, or remove the project.\n"
      );
      process.exitCode = 1;
    }
  }
}

module.exports = EmptyProjectReporter;
