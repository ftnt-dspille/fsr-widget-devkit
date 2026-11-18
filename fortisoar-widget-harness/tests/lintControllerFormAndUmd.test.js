"use strict";
// Rule-level coverage for the two ship-gate rules added to scripts/lint-angular.js:
//   - controller-form / edit-controller-form: the view/edit controller source must
//     register the DevCtrl form the harness and packager expect. A source carrying
//     the shipped `Ctrl` form (or any other) lint-blocks bootstrap in the dev-preview
//     and, shipped without SOAR's publish step, renders the template uncompiled.
//   - umd-anonymous-define: a bundled widgetAssets library whose UMD preamble still
//     calls define() on its AMD branch collides with the platform AMD loader (monaco)
//     and aborts widget bootstrap.
// Both were invisible to the linter before these rules: the controller-form check
// lived only in the dev-preview runtime, and vendored libs are skipped by every other
// rule. Each rule is proven with a bad fixture (fires) AND a good fixture (silent), so
// removing the rule turns the "fires" assertions red.
//
// Drives the compiled CLI against a throwaway WIDGETS_SRC fixture, same contract as
// lintAngular.test.js.

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

function runLint(widget) {
  try {
    const out = execFileSync("node", [CLI, widget], {
      env: { ...process.env, WIDGETS_SRC: tmpRoot },
      encoding: "utf8",
    });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status, out: (e.stdout || "") + (e.stderr || "") };
  }
}

function writeWidget(name, files) {
  for (const [rel, body] of Object.entries(files)) {
    const p = path.join(tmpRoot, name, "widget", rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
  }
}

// A minimal info.json. name "threatThing" + version "2.0.0" => DevCtrl form
// threatThing200DevCtrl / editThreatThing200DevCtrl.
const INFO = JSON.stringify({ name: "threatThing", version: "2.0.0", title: "Threat Thing" });
const ctl = (controllerName) =>
  `${HEADER}\nangular.module('cybersponse').controller('${controllerName}', ['$scope', function($scope){}]);\n`;
const editCtl = (controllerName) =>
  `${HEADER}\nangular.module('cybersponse').controller('${controllerName}', ['$scope', '$uibModalInstance', function($scope, $uibModalInstance){ $scope.save = function(){ $uibModalInstance.close(); }; $scope.cancel = function(){ $uibModalInstance.dismiss(); }; }]);\n`;

// A UMD preamble with the AMD branch intact (the hazard), and one neutralized.
const UMD_ACTIVE =
  `${HEADER}\n!function(e,t){"object"==typeof exports&&"undefined"!=typeof module?t(exports):"function"==typeof define&&define.amd?define(["exports"],t):t((e=e||self).lib=e.lib||{})}(this,function(e){e.ok=1});\n`;
const UMD_NEUTRALIZED =
  `${HEADER}\n!function(e,t){"object"==typeof exports&&"undefined"!=typeof module?t(exports):t((e=e||self).lib=e.lib||{})}(this,function(e){e.ok=1});\n`;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lint-ctrl-umd-"));
});
afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("controller-form", () => {
  test("flags a view controller registered in the shipped Ctrl form", () => {
    writeWidget("bad", {
      "info.json": INFO,
      "view.html": "<div>x</div>\n",
      "edit.html": "<div>x</div>\n",
      "view.controller.js": ctl("threatThing200Ctrl"),
      "edit.controller.js": editCtl("editThreatThing200DevCtrl"),
    });
    const { out } = runLint("bad");
    expect(out).toMatch(/controller-form/);
    expect(out).toMatch(/expected threatThing200DevCtrl/);
  });

  test("flags an edit controller registered in the shipped Ctrl form", () => {
    writeWidget("badedit", {
      "info.json": INFO,
      "view.html": "<div>x</div>\n",
      "edit.html": "<div>x</div>\n",
      "view.controller.js": ctl("threatThing200DevCtrl"),
      "edit.controller.js": editCtl("editThreatThing200Ctrl"),
    });
    const { out } = runLint("badedit");
    expect(out).toMatch(/edit-controller-form/);
    expect(out).toMatch(/expected editThreatThing200DevCtrl/);
  });

  test("is silent when both controllers use the DevCtrl form", () => {
    writeWidget("good", {
      "info.json": INFO,
      "view.html": "<div>x</div>\n",
      "edit.html": "<div>x</div>\n",
      "view.controller.js": ctl("threatThing200DevCtrl"),
      "edit.controller.js": editCtl("editThreatThing200DevCtrl"),
    });
    const { out } = runLint("good");
    expect(out).not.toMatch(/controller-form/);
  });
});

describe("umd-anonymous-define", () => {
  test("flags a bundled lib that still calls define() on its AMD branch", () => {
    writeWidget("badumd", {
      "info.json": INFO,
      "view.html": "<div>x</div>\n",
      "edit.html": "<div>x</div>\n",
      "view.controller.js": ctl("threatThing200DevCtrl"),
      "edit.controller.js": editCtl("editThreatThing200DevCtrl"),
      "widgetAssets/lib/mylib.min.js": UMD_ACTIVE,
    });
    const { out } = runLint("badumd");
    expect(out).toMatch(/umd-anonymous-define/);
    expect(out).toMatch(/mylib\.min\.js/);
  });

  test("is silent when the AMD branch is neutralized", () => {
    writeWidget("goodumd", {
      "info.json": INFO,
      "view.html": "<div>x</div>\n",
      "edit.html": "<div>x</div>\n",
      "view.controller.js": ctl("threatThing200DevCtrl"),
      "edit.controller.js": editCtl("editThreatThing200DevCtrl"),
      "widgetAssets/lib/mylib.min.js": UMD_NEUTRALIZED,
    });
    const { out } = runLint("goodumd");
    expect(out).not.toMatch(/umd-anonymous-define/);
  });
});
