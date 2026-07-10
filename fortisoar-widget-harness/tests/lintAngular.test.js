"use strict";
// Rule-level coverage for scripts/lint-angular.js. Drives the compiled CLI
// against a throwaway WIDGETS_SRC fixture (the linter honours that env, same as
// the parent Makefile) and asserts on its stdout — so a rule can be proven
// without a real widget checkout. Focused on `copyright-header-missing`
// (Phase 4 of TYPESCRIPT_STATIC_ANALYSIS_PLAN.md), plus the env-override and
// warning-severity (non-blocking) contract it relies on.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const CLI = path.resolve(__dirname, "..", "scripts", "lint-angular.js");
const HEADER = [
  "/* Copyright start",
  "   MIT License",
  "   Copyright (c) 2025 Fortinet Inc",
  "   Copyright end */",
].join("\n");

let tmpRoot;

// Run the linter over `<tmpRoot>/<widget>` and return { code, out }.
function runLint(widget) {
  try {
    const out = execFileSync("node", [CLI, widget], {
      env: { ...process.env, WIDGETS_SRC: tmpRoot },
      encoding: "utf8",
    });
    return { code: 0, out };
  } catch (e) {
    // execFileSync throws on non-zero exit; the CLI's stdout is on e.stdout.
    return { code: e.status, out: (e.stdout || "") + (e.stderr || "") };
  }
}

// Write a minimal widget under the fixture root. `files` maps
// widget-relative paths to contents.
function writeWidget(name, files) {
  for (const [rel, body] of Object.entries(files)) {
    const p = path.join(tmpRoot, name, "widget", rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
  }
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lint-fixture-"));
});
afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("copyright-header-missing", () => {
  test("flags a .html file with no MIT header", () => {
    writeWidget("noHeader", {
      "view.html": "<div>hello</div>\n",
      // A headered controller so the finding is unambiguously about view.html.
      "view.controller.js": `${HEADER}\nangular.module('cybersponse').controller('x', function(){});\n`,
    });
    const { code, out } = runLint("noHeader");
    expect(out).toMatch(/view\.html:1\s+copyright-header-missing/);
    // Warning severity → must NOT fail the run (exit 0).
    expect(code).toBe(0);
  });

  test("does NOT flag a file that carries the header", () => {
    writeWidget("hasHeader", {
      "view.controller.js": `${HEADER}\nangular.module('cybersponse').controller('x', function(){});\n`,
    });
    const { out } = runLint("hasHeader");
    expect(out).not.toMatch(/view\.controller\.js:\d+\s+copyright-header-missing/);
  });

  test("scans .css assets too, and ignores a stray 'Copyright' below the header window", () => {
    writeWidget("cssWidget", {
      "view.html": `${HEADER.replace("/*", "<!--").replace("*/", "-->")}\n<div>ok</div>\n`,
      // Header markers appear, but only past line 15 — must still be flagged.
      "widgetAssets/css/app.css": `${"\n".repeat(20)}/* Copyright start ... Copyright end */\n.x{color:red}\n`,
    });
    const { out } = runLint("cssWidget");
    expect(out).toMatch(/app\.css:1\s+copyright-header-missing/);
    // The HTML file's real header (in-window) must be accepted.
    expect(out).not.toMatch(/view\.html:\d+\s+copyright-header-missing/);
  });
});

describe("WIDGETS_SRC override + severity contract", () => {
  test("a clean, fully-headered widget lints ok with exit 0", () => {
    writeWidget("clean", {
      "view.html": `${HEADER.replace("/*", "<!--").replace("*/", "-->")}\n<div>ok</div>\n`,
      "view.controller.js": `${HEADER}\nangular.module('cybersponse').controller('x', function(){});\n`,
    });
    const { code, out } = runLint("clean");
    expect(code).toBe(0);
    expect(out).not.toMatch(/copyright-header-missing/);
  });
});
