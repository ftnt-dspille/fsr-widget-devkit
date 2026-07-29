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

// R2: $scope.config defaults. Ordering ('config-access-before-defaults') is a
// synchronous-construction hazard judged per function scope via a real AST; the
// missing-guard hazard is nesting-independent. See checkConfigDefaultsBeforeAccess.
describe("config-defaults (AST scope-aware)", () => {
  const ctl = (body) =>
    `${HEADER}\nangular.module('cybersponse').controller('x', function($scope){\n${body}\n});\n`;

  test("flags a synchronous read before the guard in construction flow", () => {
    writeWidget("beforeGuard", {
      "view.controller.js": ctl(
        "  var t = $scope.config.title;\n" +
        "  $scope.config = $scope.config || {};\n"),
    });
    const { code, out } = runLint("beforeGuard");
    expect(out).toMatch(/view\.controller\.js:\d+\s+config-access-before-defaults/);
    expect(code).toBe(0); // warning, non-blocking
  });

  test("does NOT flag a read inside a later-invoked function above the guard (the false positive the AST kills)", () => {
    writeWidget("laterInvoked", {
      "view.controller.js": ctl(
        "  $scope.onClick = function(){ return $scope.config.title; };\n" +
        "  $scope.config = $scope.config || {};\n"),
    });
    const { out } = runLint("laterInvoked");
    expect(out).not.toMatch(/config-access-before-defaults/);
    expect(out).not.toMatch(/config-defaults-missing/);
  });

  test("does NOT flag a read after the guard", () => {
    writeWidget("afterGuard", {
      "view.controller.js": ctl(
        "  $scope.config = $scope.config || {};\n" +
        "  var t = $scope.config.title;\n"),
    });
    const { out } = runLint("afterGuard");
    expect(out).not.toMatch(/config-access-before-defaults/);
  });

  test("flags a missing guard regardless of nesting", () => {
    writeWidget("noGuard", {
      "view.controller.js": ctl(
        "  $scope.render = function(){ return $scope.config.title; };\n"),
    });
    const { out } = runLint("noGuard");
    expect(out).toMatch(/view\.controller\.js:\d+\s+config-defaults-missing/);
  });

  test("ignores a $scope.config.X in a comment (AST sees no such read)", () => {
    writeWidget("commented", {
      "view.controller.js": ctl(
        "  // legacy: $scope.config.title was read here\n" +
        "  $scope.config = $scope.config || {};\n" +
        "  var t = $scope.config.title;\n"),
    });
    const { out } = runLint("commented");
    expect(out).not.toMatch(/config-access-before-defaults/);
    expect(out).not.toMatch(/config-defaults-missing/);
  });
});

// enableFor entries are UI-Router state names; entries that can never match a
// state make the drawer icon appear nowhere. KB §18.4.
describe("enablefor state-match", () => {
  const drawerInfo = (enableFor) => JSON.stringify({
    name: "d", version: "1.0.0",
    metadata: { contexts: ["drawer"], standalone: true, view: { enableFor } },
  });

  test("flags a marketplace page label and a space-containing entry", () => {
    writeWidget("badLabel", { "info.json": drawerInfo(["Dashboard", "View Panel"]) });
    const { code, out } = runLint("badLabel");
    expect(out).toMatch(/info\.json:1\s+enablefor-page-label/);
    expect(code).toBe(1); // page-label is severity 'error' → blocks the run
  });

  test("warns on a bare (dot-less) state and stays non-blocking", () => {
    writeWidget("bareState", { "info.json": drawerInfo(["dashboard"]) });
    const { code, out } = runLint("bareState");
    expect(out).toMatch(/info\.json:1\s+enablefor-bare-state/);
    expect(code).toBe(0);
  });

  test("flags a non-string entry", () => {
    writeWidget("nonString", { "info.json": drawerInfo(["main.dashboard", 42]) });
    const { out } = runLint("nonString");
    expect(out).toMatch(/info\.json:1\s+enablefor-entry-not-string/);
  });

  test("accepts valid namespaced state names", () => {
    writeWidget("goodStates", {
      "info.json": drawerInfo(["main.dashboard", "viewPanel.modulesDetail", "main.playbookDetail"]),
    });
    const { out } = runLint("goodStates");
    expect(out).not.toMatch(/enablefor-/);
  });
});
