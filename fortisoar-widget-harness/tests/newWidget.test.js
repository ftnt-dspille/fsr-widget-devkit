/**
 * @jest-environment jsdom
 */
"use strict";
// Regressions for the spec-driven widget generator (North Star #5). Asserts each
// variant emits a CORRECT skeleton: the controller-name ↔ version-digits
// convention, the playbook-trigger endpoint split (no `ACTION + uuid` — the
// classic silent 404, enforced by the harness lint), info.json pages/category
// per kind, and harness-wired tests. The controller variants are also
// instantiated through real angular + angular-mocks to prove they run, not just
// that they parse.

global.jasmine = global.jasmine || {};
require("angular");
require("angular-mocks");

const path = require("path");
const fs = require("fs");
const os = require("os");

const { generateWidget, writeWidget, validateName } = require("../scripts/new-widget.js");
const { triggerEndpointMisuse } = require("../lib/harnessUtils.js");

const KINDS = [
  { label: "dashboard", spec: { name: "fooBar" } },
  { label: "dashboard+trigger", spec: { name: "fooBar", triggersPlaybook: true } },
  { label: "record", spec: { name: "fooBar", kind: "record" } },
  { label: "record+trigger", spec: { name: "fooBar", kind: "record", triggersPlaybook: true } },
];

describe("generator name derivation", () => {
  test("controller name uses version digits, not dots", () => {
    const gen = generateWidget({ name: "incidentSummary" });
    expect(gen.derived.viewCtrl).toBe("incidentSummary100DevCtrl");
    expect(gen.derived.editCtrl).toBe("editIncidentSummary100DevCtrl");
    expect(gen.widgetFiles["widget/view.controller.js"]).toContain(
      '.controller("incidentSummary100DevCtrl"'
    );
  });

  test("validateName rejects non-camelCase", () => {
    expect(validateName("incidentSummary")).toBeNull();
    expect(validateName("Incident")).toMatch(/camelCase/);
    expect(validateName("incident-summary")).toMatch(/camelCase/);
    expect(validateName("")).toMatch(/required/);
  });
});

describe("info.json per kind", () => {
  test("record widget declares View Panel; dashboard declares Dashboard", () => {
    const rec = JSON.parse(generateWidget({ name: "x", kind: "record" }).widgetFiles["widget/info.json"]);
    expect(rec.metadata.pages).toEqual(["View Panel"]);
    const dash = JSON.parse(generateWidget({ name: "x" }).widgetFiles["widget/info.json"]);
    expect(dash.metadata.pages).toContain("Dashboard");
  });

  test("spec category + compatibility flow into metadata", () => {
    const info = JSON.parse(
      generateWidget({ name: "x", category: "Investigation", compatibility: ["7.5.0", "7.6.0"] })
        .widgetFiles["widget/info.json"]
    );
    expect(info.metadata.category).toEqual(["Investigation"]);
    expect(info.metadata.compatibility).toEqual(["7.5.0", "7.6.0"]);
    expect(info.version).toBe("1.0.0");
  });
});

describe("playbook-trigger endpoint contract (KB §19.3)", () => {
  test.each(KINDS)("$label controller never trips trigger-endpoint-misuse lint", ({ spec }) => {
    const ctrl = generateWidget(spec).widgetFiles["widget/view.controller.js"];
    expect(triggerEndpointMisuse(ctrl)).toBeNull();
  });

  test("trigger variants encode BOTH endpoints (route + notrigger)", () => {
    const ctrl = generateWidget({ name: "x", triggersPlaybook: true }).widgetFiles["widget/view.controller.js"];
    expect(ctrl).toContain("ACTION + pb.route");
    expect(ctrl).toContain("MANUAL + (pb.uuid");
    // The action endpoint must NOT be concatenated with a uuid.
    expect(ctrl).not.toMatch(/ACTION\s*\+\s*[^.]*uuid/);
  });

  test("non-trigger variants emit no trigger machinery", () => {
    const ctrl = generateWidget({ name: "x" }).widgetFiles["widget/view.controller.js"];
    expect(ctrl).not.toContain("runPlaybook");
  });
});

describe("harness-wired tests", () => {
  test("e2e spec awaits the render state machine and resolves the widget id", () => {
    const gen = generateWidget({ name: "x" });
    expect(gen.e2eContents).toContain("waitForRender(page)");
    expect(gen.e2eContents).toContain("/_fsr/widgets");
    expect(gen.e2eContents).toContain("require('./_render')");
  });

  test("record e2e seeds module/id for the NS1 fixture layer, no per-spec stub", () => {
    const gen = generateWidget({ name: "x", kind: "record" });
    expect(gen.e2eContents).toContain("harness.ctx', 'viewpanel'");
    expect(gen.e2eContents).toContain("harness.module");
    expect(gen.e2eContents).toContain("harness.id");
  });
});

// Prove each generated view controller actually instantiates under angular.
describe("generated controllers run", () => {
  function instantiate(ctrlSource, ctrlName, locals) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nw-"));
    const file = path.join(tmp, "view.controller.js");
    fs.writeFileSync(file, ctrlSource);
    // Fresh module each time so re-registration doesn't collide.
    const ngMod = "cybersponse";
    window.angular.module(ngMod, []);
    require(file);
    let $scope;
    window.angular.mock.module(ngMod, ($provide) => {
      Object.entries(locals.provide || {}).forEach(([k, v]) => $provide.value(k, v));
    });
    window.angular.mock.inject((_$rootScope_, _$controller_, _$injector_) => {
      $scope = _$rootScope_.$new();
      const resolved = { $scope, config: locals.config || {} };
      (locals.inject || []).forEach((name) => {
        try { resolved[name] = _$injector_.get(name); } catch (e) { /* provided below */ }
      });
      Object.entries(locals.provide || {}).forEach(([k, v]) => { resolved[k] = v; });
      _$controller_(ctrlName, resolved);
    });
    fs.rmSync(tmp, { recursive: true, force: true });
    return $scope;
  }

  test("dashboard controller computes a greeting", () => {
    const gen = generateWidget({ name: "fooBar" });
    const $scope = instantiate(gen.widgetFiles["widget/view.controller.js"], gen.derived.viewCtrl, {
      config: { title: "Alice" },
    });
    expect($scope.greeting).toBe("Hello, Alice");
  });

  test("record controller reads the entity and selects the right endpoint", () => {
    const gen = generateWidget({ name: "fooBar", kind: "record", triggersPlaybook: true });
    const record = { name: "ACME-42", "@id": "/api/3/alerts/abc", module: "alerts" };
    const $scope = instantiate(gen.widgetFiles["widget/view.controller.js"], gen.derived.viewCtrl, {
      config: {},
      provide: {
        FormEntityService: { get: () => ({ originalData: record }) },
        $resource: () => ({ save: () => ({ $promise: Promise.resolve({}) }) }),
        API: { MANUAL_TRIGGER: "api/triggers/1/notrigger/", ACTION_TRIGGER: "api/triggers/1/action/" },
      },
      inject: ["$q"],
    });
    expect($scope.hasRecord).toBe(true);
    expect($scope.recordName).toBe("ACME-42");
    // action playbook → route endpoint, uuid NOT in the URL
    const a = $scope.selectUrl({ triggerType: "action", route: "my_route", uuid: "PB-1" });
    expect(a.url).toBe("api/triggers/1/action/my_route");
    expect(a.url).not.toContain("PB-1");
    // manual playbook → notrigger by uuid
    const m = $scope.selectUrl({ triggerType: "manual", uuid: "PB-1" });
    expect(m.url).toBe("api/triggers/1/notrigger/PB-1");
  });
});

// Integration: a freshly-generated widget passes the harness angular lint with
// no config-defaults warning (the angular.extend({},defaults,config||{}) guard
// must be recognized) and no trigger-endpoint error. Generates into the real
// widgets-src (lint-angular's ROOT is fixed there), then cleans up.
describe("generated widget passes lint-angular", () => {
  const { execFileSync } = require("child_process");
  const NAME = "tmpLintCheck";
  const dest = path.resolve(__dirname, "..", "..", "widgets-src", NAME);
  const e2e = path.join(__dirname, "e2e", `${NAME}.spec.js`);
  afterEach(() => {
    fs.rmSync(dest, { recursive: true, force: true });
    fs.rmSync(e2e, { force: true });
  });

  test("record+trigger variant lints clean (0 errors, no config-defaults)", () => {
    writeWidget(generateWidget({ name: NAME, kind: "record", triggersPlaybook: true }), {
      widgetsDir: path.resolve(__dirname, "..", "..", "widgets-src"),
      harnessE2eDir: path.join(__dirname, "e2e"),
      name: NAME,
    });
    const out = execFileSync("node", [path.join(__dirname, "..", "scripts", "lint-angular.js"), NAME], {
      cwd: path.join(__dirname, ".."),
      encoding: "utf8",
    });
    expect(out).not.toContain("config-defaults-missing");
    expect(out).not.toContain("[error]");
  });
});

describe("writeWidget", () => {
  test("writes widget files and relocates the e2e spec into the harness dir", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nw-write-"));
    const widgetsDir = path.join(tmp, "widgets-src");
    const e2eDir = path.join(tmp, "e2e");
    fs.mkdirSync(widgetsDir, { recursive: true });
    fs.mkdirSync(e2eDir, { recursive: true });
    const gen = generateWidget({ name: "fooBar", kind: "record" });
    const res = writeWidget(gen, { widgetsDir, harnessE2eDir: e2eDir, name: "fooBar" });
    expect(fs.existsSync(path.join(res.dest, "widget/view.controller.js"))).toBe(true);
    expect(res.e2ePath).toBe(path.join(e2eDir, "fooBar.spec.js"));
    expect(fs.existsSync(res.e2ePath)).toBe(true);
    // refuses to overwrite
    expect(() => writeWidget(gen, { widgetsDir, harnessE2eDir: e2eDir, name: "fooBar" })).toThrow(/already exists/);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
