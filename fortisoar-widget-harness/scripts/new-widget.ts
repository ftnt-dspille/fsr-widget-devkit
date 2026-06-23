#!/usr/bin/env node
// new-widget.ts — spec-driven widget generator (North Star #5).
//
// Emits a CORRECT, harness-wired widget skeleton from a one-line spec so an
// agent never hand-assembles the parts that cause silent breakage: the
// controller-name ↔ version digits convention, the record-context wiring, the
// playbook-trigger endpoint split (KB §19.3 — `action/<route>` vs
// `notrigger/<uuid>`), and jest + Playwright scaffolds bound to the harness
// helpers (waitForRender / the NS1 default fixture layer).
//
// Usage:
//   node scripts/new-widget.js <camelCaseName> ["Display Title"]   # quick form
//   node scripts/new-widget.js --spec spec.json                    # full spec
//   node scripts/new-widget.js incidentSummary --kind record --triggers-playbook
//
// Spec fields (all optional except name):
//   name           camelCase, lowercase-first (required)
//   title          display title         (default: from name)
//   subTitle       picker one-liner
//   description    metadata.description
//   category       metadata.category[0]  (default: "Utilities")
//   publisher      metadata.publisher    (default: "Your Team")
//   compatibility  string[]              (default: ["7.6.0"])
//   kind           "dashboard" | "record"   (default: "dashboard")
//   triggersPlaybook  boolean            (default: false) — emits the NS4
//                  trigger pattern inline + a config form + tests
//
// Result: widgets-src/<name>/ (widget + jest unit test) and an e2e spec
// relocated to the harness tests/e2e/<name>.spec.js (Playwright's testDir does
// not crawl the widgets-src symlink). `make test-unit WIDGET=<name>` is green
// immediately; with the NS1 fixture layer a record widget is green on mock e2e
// with no hand-written platform stubs.

"use strict";

const fs = require("fs");
const path = require("path");

// ─── spec types ─────────────────────────────────────────────────────────────
export type WidgetKind = "dashboard" | "record";

export interface WidgetSpec {
  name: string;
  title: string;
  subTitle: string;
  description: string;
  category: string;
  publisher: string;
  compatibility: string[];
  kind: WidgetKind;
  triggersPlaybook: boolean;
}

export interface GeneratedWidget {
  /** Files keyed by path RELATIVE to the widget dir (widgets-src/<name>/). */
  widgetFiles: Record<string, string>;
  /** The e2e spec — relocated into the harness tests/e2e/ at write time. */
  e2eFileName: string;
  e2eContents: string;
  /** Derived names, exposed for tests + the CLI summary. */
  derived: {
    kebab: string;
    pascal: string;
    digits: string;
    viewCtrl: string;
    editCtrl: string;
  };
}

// ─── name derivation (mirrors widget.ts / new-widget.sh) ──────────────────────
function toKebab(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}
function toPascal(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}
function toTitle(name: string): string {
  const spaced = name.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
/** "1.0.0" → "100" — the controller-name suffix the harness/SOAR resolves. */
function versionDigits(version: string): string {
  return version.replace(/\./g, "");
}

function normalizeSpec(raw: Partial<WidgetSpec> & { name: string }): WidgetSpec {
  const name = raw.name;
  return {
    name,
    title: raw.title || toTitle(name),
    subTitle: raw.subTitle || "One-line description shown in the widget picker.",
    description:
      raw.description || "What this widget renders and how it's configured.",
    category: raw.category || "Utilities",
    publisher: raw.publisher || "Your Team",
    compatibility:
      Array.isArray(raw.compatibility) && raw.compatibility.length
        ? raw.compatibility
        : ["7.6.0"],
    kind: raw.kind === "record" ? "record" : "dashboard",
    triggersPlaybook: !!raw.triggersPlaybook,
  };
}

export function validateName(name: unknown): string | null {
  if (typeof name !== "string" || !name) return "name is required";
  if (!/^[a-z][A-Za-z0-9]*$/.test(name))
    return "name must be camelCase starting with a lowercase letter (e.g. incidentSummary)";
  return null;
}

// ─── file builders ────────────────────────────────────────────────────────────
const VERSION = "1.0.0";
const COPYRIGHT = `/* Copyright start
   MIT License
   Copyright (c) 2026 PUBLISHER
   Copyright end */`;

function buildInfoJson(spec: WidgetSpec): string {
  const pages =
    spec.kind === "record" ? ["View Panel"] : ["Dashboard", "View Panel"];
  const info = {
    name: spec.name,
    title: spec.title,
    subTitle: spec.subTitle,
    version: VERSION,
    published_date: 1748908800,
    releaseNotes: "Initial scaffold.",
    development: true,
    metadata: {
      description: spec.description,
      publisher: spec.publisher,
      certified: "No",
      compatibility: spec.compatibility,
      snapshots: [],
      category: [spec.category],
      pages,
      standalone: false,
      windowClass: "Full Width",
      size: "lg",
    },
  };
  return JSON.stringify(info, null, 2) + "\n";
}

function buildViewController(spec: WidgetSpec): string {
  const digits = versionDigits(VERSION);
  const ctrl = `${spec.name}${digits}DevCtrl`;
  const copyright = COPYRIGHT.replace("PUBLISHER", spec.publisher);

  // Dashboard, no playbook: the minimal greeting controller (pure view-model).
  if (spec.kind === "dashboard" && !spec.triggersPlaybook) {
    return `${copyright}
"use strict";
// VIEW controller. The harness/SOAR resolves the controller name as
// \`<name><numericVersion>DevCtrl\` — ${ctrl} for ${spec.name} v${VERSION}.
// \`widget bump\` rewrites this suffix on a version change; never hand-edit it.
(function () {
  angular
    .module("cybersponse")
    .controller("${ctrl}", ${ctrl});

  // List every service in BOTH $inject and the function args, same order
  // (AngularJS 1.x minification-safe DI). \`config\` is the persisted widget
  // config set in edit.html.
  ${ctrl}.$inject = ["$scope", "config"];

  function ${ctrl}($scope, config) {
    var defaults = { title: "Hello" };
    // Guard config — a drawer cold-mount can pass nothing.
    $scope.config = angular.extend({}, defaults, config || {});

    // Keep view logic pure + small so the jest test can exercise it headless.
    $scope.greeting = "Hello, " + ($scope.config.title || "world");
  }
})();
`;
  }

  // Record and/or playbook-triggering controllers share the entity-reading
  // preamble. Build the injection list + body progressively.
  const inject: string[] = ['"$scope"', '"config"'];
  const args: string[] = ["$scope", "config"];
  if (spec.kind === "record") {
    inject.push('"FormEntityService"');
    args.push("FormEntityService");
  }
  if (spec.triggersPlaybook) {
    inject.push('"$resource"', '"$q"', '"API"');
    args.push("$resource", "$q", "API");
  }

  let body = `    var defaults = { title: "${spec.title}" };
    $scope.config = angular.extend({}, defaults, config || {});
`;

  if (spec.kind === "record") {
    body += `
    // Record context. SOAR injects the open record via FormEntityService on a
    // View-Panel mount; the NS1 default fixture layer serves it locally so this
    // renders on the mock e2e tier with no per-spec stub. \`originalData\` is the
    // raw record (includes "@id" and the entity \`module\`).
    function getEntity() {
      try { return FormEntityService.get(); } catch (e) { return null; }
    }
    var entity = getEntity();
    $scope.record = (entity && entity.originalData) ? entity.originalData : null;
    $scope.hasRecord = !!$scope.record;
    // Surface a believable summary field; widgets typically read named fields.
    $scope.recordName =
      $scope.record && ($scope.record.name || $scope.record["@id"]) || null;
`;
  }

  if (spec.triggersPlaybook) {
    body += `
    // ── Playbook trigger (KB §19.3 — the endpoint split). The classic silent
    // 404 is firing the ACTION endpoint by uuid; it keys off the registered
    // ROUTE. A manual / no-record / no-route playbook runs by uuid via the
    // notrigger endpoint. selectUrl is the ONE place that decision lives — the
    // harness \`trigger-endpoint-misuse\` lint enforces it. Configure the chosen
    // playbook in edit.html (config.playbook = {uuid, route, triggerType}).
    $scope.triggerStatus = null;
    function selectUrl(pb) {
      var MANUAL = (API && API.MANUAL_TRIGGER) || "api/triggers/1/notrigger/";
      var ACTION = (API && API.ACTION_TRIGGER) || "api/triggers/1/action/";
      var isManual =
        pb.triggerType === "manual" || !pb.route || pb.noRecordExecution === true;
      return isManual
        ? { url: MANUAL + (pb.uuid || ""), isManual: true }
        : { url: ACTION + pb.route, isManual: false };
    }
    $scope.selectUrl = selectUrl; // exported for the jest endpoint test
    $scope.runPlaybook = function () {
      var pb = ($scope.config && $scope.config.playbook) || {};
      if (!pb.uuid && !pb.route) {
        $scope.triggerStatus = "No playbook configured.";
        return $q.reject(new Error("no playbook configured"));
      }
      var sel = selectUrl(pb);
      var body = {};
`;
    if (spec.kind === "record") {
      body += `      // Record-context body: the action endpoint wants the record IRI + the
      // entity module (\`__resource\`); the manual endpoint just needs records.
      var rec = $scope.record;
      var iri = rec && rec["@id"];
      if (iri) body.records = [iri];
      if (!sel.isManual) {
        if (pb.uuid) body.__uuid = pb.uuid;
        if (rec && rec.module) body.__resource = rec.module;
      }
`;
    } else {
      body += `      if (!sel.isManual && pb.uuid) body.__uuid = pb.uuid;
`;
    }
    body += `      $scope.triggerStatus = "Running…";
      return $resource(sel.url).save(body).$promise.then(
        function (res) {
          $scope.triggerStatus = "Triggered.";
          return res;
        },
        function (err) {
          $scope.triggerStatus = "Trigger failed.";
          return $q.reject(err);
        }
      );
    };
`;
  }

  return `${copyright}
"use strict";
// VIEW controller. The harness/SOAR resolves the controller name as
// \`<name><numericVersion>DevCtrl\` — ${ctrl} for ${spec.name} v${VERSION}.
// \`widget bump\` rewrites this suffix on a version change; never hand-edit it.
(function () {
  angular
    .module("cybersponse")
    .controller("${ctrl}", ${ctrl});

  ${ctrl}.$inject = [${inject.join(", ")}];

  function ${ctrl}(${args.join(", ")}) {
${body}  }
})();
`;
}

function buildViewHtml(spec: WidgetSpec): string {
  const kebab = toKebab(spec.name);
  let inner = `  <h3 data-testid="${kebab}-greeting">{{ greeting }}</h3>`;
  if (spec.kind === "record") {
    inner = `  <div data-ng-if="hasRecord" data-testid="${kebab}-record">
    <h3 data-testid="${kebab}-record-name">{{ recordName }}</h3>
  </div>
  <div data-ng-if="!hasRecord" class="err" data-testid="${kebab}-no-record">
    No record loaded.
  </div>`;
  }
  if (spec.triggersPlaybook) {
    inner += `
  <button type="button" class="btn btn-primary" data-testid="${kebab}-run"
          data-ng-click="runPlaybook()">Run playbook</button>
  <div data-ng-if="triggerStatus" data-testid="${kebab}-status">{{ triggerStatus }}</div>`;
  }
  return `<!-- VIEW template. Do NOT put data-ng-controller on the root here — the harness
     (and SOAR after publish) wraps the widget with its own ng-controller; a
     second one creates a dead parallel scope. See KNOWLEDGEBASE.md §widget gotchas. -->
<div class="${kebab}" data-testid="${kebab}-root">
${inner}
</div>
`;
}

function buildEditController(spec: WidgetSpec): string {
  const digits = versionDigits(VERSION);
  const ctrl = `edit${toPascal(spec.name)}${digits}DevCtrl`;
  const copyright = COPYRIGHT.replace("PUBLISHER", spec.publisher);
  let init = `    $scope.config = $scope.config || {};
    if ($scope.config.title === undefined) $scope.config.title = "Hello";`;
  if (spec.triggersPlaybook) {
    init += `
    // The view runs config.playbook via the correct endpoint for its
    // triggerType. In a real widget, populate these by listing playbooks
    // (playbookService) and letting the user pick; the scaffold takes raw input.
    if ($scope.config.playbook === undefined) {
      $scope.config.playbook = { uuid: "", route: "", triggerType: "manual" };
    }`;
  }
  return `${copyright}
"use strict";
// EDIT controller — the config editor. It loads only when the host opens
// "Edit Config". The SOAR shell opens it as a $uibModal, so wire the modal
// close/dismiss contract: save() must close with the config; cancel() dismisses.
(function () {
  angular
    .module("cybersponse")
    .controller("${ctrl}", ${ctrl});

  ${ctrl}.$inject = ["$scope", "$uibModalInstance"];

  function ${ctrl}($scope, $uibModalInstance) {
    // \`$scope.config\` is bound to the widget config the view will receive.
${init}

    // Modal contract — without these, Save/Cancel won't close the SOAR modal.
    $scope.save = function () {
      if ($uibModalInstance) $uibModalInstance.close($scope.config);
    };
    $scope.cancel = function () {
      if ($uibModalInstance) $uibModalInstance.dismiss("cancel");
    };
  }
})();
`;
}

function buildEditHtml(spec: WidgetSpec): string {
  const kebab = toKebab(spec.name);
  let fields = `  <div class="form-group">
    <label for="${kebab}-title">Title</label>
    <input id="${kebab}-title" type="text" class="form-control"
           data-testid="${kebab}-cfg-title"
           data-ng-model="config.title" />
  </div>`;
  if (spec.triggersPlaybook) {
    fields += `
  <div class="form-group">
    <label for="${kebab}-pb-uuid">Playbook UUID</label>
    <input id="${kebab}-pb-uuid" type="text" class="form-control"
           data-testid="${kebab}-cfg-pb-uuid"
           data-ng-model="config.playbook.uuid" />
  </div>
  <div class="form-group">
    <label for="${kebab}-pb-route">Action route (blank ⇒ manual/notrigger)</label>
    <input id="${kebab}-pb-route" type="text" class="form-control"
           data-testid="${kebab}-cfg-pb-route"
           data-ng-model="config.playbook.route" />
  </div>
  <div class="form-group">
    <label for="${kebab}-pb-type">Trigger type</label>
    <select id="${kebab}-pb-type" class="form-control"
            data-testid="${kebab}-cfg-pb-type"
            data-ng-model="config.playbook.triggerType">
      <option value="manual">manual (run by uuid)</option>
      <option value="action">action (run by route)</option>
    </select>
  </div>`;
  }
  return `<!-- EDIT template — the config form. Bind to object properties (config.X), never
     bare words: ng-include/ng-if/ng-repeat create child scopes and a bare
     ng-model writes shadow the parent. See KNOWLEDGEBASE.md. -->
<div class="${kebab}-edit">
${fields}
</div>
`;
}

function buildUnitTest(spec: WidgetSpec): string {
  const digits = versionDigits(VERSION);
  const ctrl = `${spec.name}${digits}DevCtrl`;

  let imports = `global.jasmine = global.jasmine || {};

require("angular");
require("angular-mocks");

angular.module("cybersponse", []); // eslint-disable-line no-undef
require("../widget/view.controller.js");

const CTRL_NAME = "${ctrl}";
const ngModule = window.angular.mock.module; // eslint-disable-line no-undef
const ngInject = window.angular.mock.inject; // eslint-disable-line no-undef
`;

  // makeController wires the injectables each kind needs.
  let locals = "{ $scope, config: config || {} }";
  let provide = "";
  let extraInject = "";
  if (spec.kind === "record") {
    provide += `    $provide.value("FormEntityService", {\n      get: () => ({ originalData: record || null }),\n    });\n`;
    locals = "{ $scope, config: config || {}, FormEntityService }";
    extraInject = ", FormEntityService";
  }
  if (spec.triggersPlaybook) {
    provide += `    $provide.value("$resource", () => ({ save: () => ({ $promise: Promise.resolve({}) }) }));\n    $provide.value("API", { MANUAL_TRIGGER: "api/triggers/1/notrigger/", ACTION_TRIGGER: "api/triggers/1/action/" });\n`;
  }

  const makeCtor =
    spec.kind === "record"
      ? `function makeController(config, record) {`
      : `function makeController(config) {`;

  let make = `${makeCtor}
  let $scope${spec.kind === "record" ? ", FormEntityService" : ""};
  ngModule("cybersponse", ($provide) => {
    $provide.value("config", config || {});
${provide}  });
  ngInject((_$rootScope_, _$controller_${spec.kind === "record" || spec.triggersPlaybook ? ", _$injector_" : ""}) => {
    $scope = _$rootScope_.$new();
${spec.kind === "record" ? "    FormEntityService = _$injector_.get(\"FormEntityService\");\n" : ""}${
    spec.triggersPlaybook
      ? "    const $resource = _$injector_.get(\"$resource\");\n    const API = _$injector_.get(\"API\");\n    const $q = _$injector_.get(\"$q\");\n"
      : ""
  }    _$controller_(CTRL_NAME, ${
    spec.triggersPlaybook
      ? "{ $scope, config: config || {}" +
        (spec.kind === "record" ? ", FormEntityService" : "") +
        ", $resource, API, $q }"
      : locals
  });
  });
  return { $scope${extraInject} };
}
`;

  // Per-kind assertions.
  let tests = "";
  if (spec.kind === "dashboard" && !spec.triggersPlaybook) {
    tests = `  test("greets using the configured title", () => {
    const { $scope } = makeController({ title: "Alice" });
    expect($scope.greeting).toBe("Hello, Alice");
  });

  test("falls back to a default when unconfigured", () => {
    const { $scope } = makeController({});
    expect($scope.greeting).toBe("Hello, ${spec.title}");
  });
`;
  } else if (spec.kind === "record") {
    tests = `  test("reads the open record from FormEntityService", () => {
    const { $scope } = makeController({}, { name: "ACME-42", "@id": "/api/3/alerts/abc", module: "alerts" });
    expect($scope.hasRecord).toBe(true);
    expect($scope.recordName).toBe("ACME-42");
  });

  test("degrades loudly when no record is loaded", () => {
    const { $scope } = makeController({}, null);
    expect($scope.hasRecord).toBe(false);
    expect($scope.recordName).toBeNull();
  });
`;
  } else {
    tests = `  test("mounts with the configured title", () => {
    const { $scope } = makeController({ title: "X" });
    expect($scope.config.title).toBe("X");
  });
`;
  }
  if (spec.triggersPlaybook) {
    tests += `
  // KB §19.3 — the endpoint split. An action playbook runs by ROUTE; a manual /
  // no-route playbook runs by UUID. Using the action endpoint by uuid is the
  // classic silent 404 — assert the controller never does that.
  test("action playbook → action endpoint by route", () => {
    const { $scope } = makeController({});
    const sel = $scope.selectUrl({ triggerType: "action", route: "my_route", uuid: "PB-1" });
    expect(sel.isManual).toBe(false);
    expect(sel.url).toBe("api/triggers/1/action/my_route");
    expect(sel.url).not.toContain("PB-1");
  });

  test("manual playbook → notrigger endpoint by uuid", () => {
    const { $scope } = makeController({});
    const sel = $scope.selectUrl({ triggerType: "manual", uuid: "PB-1" });
    expect(sel.isManual).toBe(true);
    expect(sel.url).toBe("api/triggers/1/notrigger/PB-1");
  });
`;
  }

  return `"use strict";
// Unit test for the view controller. Boots a bare \`cybersponse\` module, loads
// the controller IIFE (which self-registers), then $controller-instantiates it
// with mocked injectables and asserts the view-model. Run with:
//
//   make test-unit WIDGET=${spec.name}        # from the dev-kit root
//   WIDGET=${spec.name} npm test              # in a standalone clone

${imports}
${make}
describe("${spec.name} view controller", () => {
${tests}});
`;
}

function buildE2eSpec(spec: WidgetSpec): string {
  const kebab = toKebab(spec.name);
  const ctxSetup =
    spec.kind === "record"
      ? `      localStorage.setItem('harness.ctx', 'viewpanel');
      // NS1 default fixture layer serves /api/3/<module>/<id> hermetically — no
      // per-spec record stub needed. Seed the module/id the fixture is keyed to.
      localStorage.setItem('harness.module', 'alerts');
      localStorage.setItem('harness.id', 'seed-1');`
      : `      localStorage.setItem('harness.ctx', 'dashboard');`;

  let assertion =
    spec.kind === "record"
      ? `    // The default fixture serves a believable record, so the record branch
    // renders without any hand-written platform stub (the NS1/NS2 guarantee).
    await expect(page.getByTestId('${kebab}-root')).toBeVisible();`
      : `    await expect(page.getByTestId('${kebab}-greeting')).toHaveText('Hello, Alice');`;

  const config =
    spec.kind === "record"
      ? "{}"
      : "{ title: 'Alice' }";

  let triggerTest = "";
  if (spec.triggersPlaybook) {
    triggerTest = `

  test('exposes a run-playbook control', async ({ page }) => {
    await page.addInitScript((widgetId) => {
${ctxSetup.replace(/\n/g, "\n  ")}
      localStorage.setItem('harness.widget', widgetId);
      localStorage.setItem('harness:config:' + widgetId, JSON.stringify({ playbook: { uuid: 'PB-1', triggerType: 'manual' } }));
    }, id);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await waitForRender(page);
    await expect(page.getByTestId('${kebab}-run')).toBeVisible();
  });`;
  }

  return `'use strict';
// End-to-end test — boots the widget in the harness (headless Chromium) and
// exercises the real DOM. The complement to the jest unit test. Run with:
//
//   make test-e2e-widget WIDGET=${spec.name}   # from the dev-kit root

const { test, expect } = require('@playwright/test');
const { waitForRender } = require('./_render');

const HARNESS = 'http://localhost:14401';

// Resolve the mounted widget id (name-version) so the spec survives version
// bumps instead of hard-coding ${spec.name}-${VERSION}.
async function resolveId(request) {
  const resp = await request.get(\`\${HARNESS}/_fsr/widgets\`);
  const data = await resp.json();
  const w = (data.widgets || []).find((x) => x.name === '${spec.name}');
  if (!w) throw new Error('${spec.name} not discovered by the harness');
  return w.id;
}

test.describe('${spec.name}', () => {
  let id;
  test.beforeAll(async ({ request }) => { id = await resolveId(request); });

  test('renders without errors and is non-empty', async ({ page }) => {
    await page.addInitScript((widgetId) => {
      localStorage.setItem('harness.widget', widgetId);
${ctxSetup}
      localStorage.setItem('harness:config:' + widgetId, JSON.stringify(${config}));
    }, id);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    // waitForRender awaits the render state machine (NS-P0/P1) and THROWS on a
    // swallowed controller/digest error — no magic timeouts, no silent pass.
    await waitForRender(page);

${assertion}
  });${triggerTest}
});
`;
}

// ─── orchestration ────────────────────────────────────────────────────────────
export function generateWidget(rawSpec: Partial<WidgetSpec> & { name: string }): GeneratedWidget {
  const spec = normalizeSpec(rawSpec);
  const digits = versionDigits(VERSION);
  const widgetFiles: Record<string, string> = {
    "widget/info.json": buildInfoJson(spec),
    "widget/view.controller.js": buildViewController(spec),
    "widget/view.html": buildViewHtml(spec),
    "widget/edit.controller.js": buildEditController(spec),
    "widget/edit.html": buildEditHtml(spec),
    "tests/view.controller.test.js": buildUnitTest(spec),
    "jest.config.js": `"use strict";

module.exports = {
  testEnvironment: "jsdom",
  testEnvironmentOptions: {
    url: "http://localhost/${spec.name}-dev/",
  },
  testMatch: ["<rootDir>/tests/**/*.test.js"],
};
`,
  };
  return {
    widgetFiles,
    e2eFileName: `${spec.name}.spec.js`,
    e2eContents: buildE2eSpec(spec),
    derived: {
      kebab: toKebab(spec.name),
      pascal: toPascal(spec.name),
      digits,
      viewCtrl: `${spec.name}${digits}DevCtrl`,
      editCtrl: `edit${toPascal(spec.name)}${digits}DevCtrl`,
    },
  };
}

/** Write a generated widget to disk. Throws if the dest exists. */
export function writeWidget(
  gen: GeneratedWidget,
  opts: { widgetsDir: string; harnessE2eDir: string; name: string }
): { dest: string; e2ePath: string | null } {
  const dest = path.join(opts.widgetsDir, opts.name);
  if (fs.existsSync(dest)) throw new Error(`${dest} already exists`);
  for (const [rel, contents] of Object.entries(gen.widgetFiles)) {
    const full = path.join(dest, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents);
  }
  // Relocate the e2e spec into the harness tests/e2e/ (Playwright's testDir does
  // not crawl the widgets-src symlink — a spec left in the widget folder is
  // never discovered).
  let e2ePath: string | null = null;
  if (fs.existsSync(opts.harnessE2eDir)) {
    e2ePath = path.join(opts.harnessE2eDir, gen.e2eFileName);
    fs.writeFileSync(e2ePath, gen.e2eContents);
  } else {
    // No harness e2e dir (standalone clone) — keep it with the widget.
    e2ePath = path.join(dest, "tests", "e2e", gen.e2eFileName);
    fs.mkdirSync(path.dirname(e2ePath), { recursive: true });
    fs.writeFileSync(e2ePath, gen.e2eContents);
  }
  return { dest, e2ePath };
}

// ─── CLI ──────────────────────────────────────────────────────────────────────
function parseCli(argv: string[]): Partial<WidgetSpec> & { name: string } {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else flags[key] = true;
    } else positional.push(a);
  }

  let spec: Partial<WidgetSpec> & { name: string } = { name: "" };
  if (flags.spec) {
    const raw = JSON.parse(fs.readFileSync(String(flags.spec), "utf8"));
    spec = { ...raw };
  }
  // Positional <name> ["Title"] (back-compat with new-widget.sh).
  if (positional[0]) spec.name = positional[0];
  if (positional[1]) spec.title = positional[1];
  // Inline flags override the spec file.
  if (flags.name) spec.name = String(flags.name);
  if (flags.title) spec.title = String(flags.title);
  if (flags.subtitle) spec.subTitle = String(flags.subtitle);
  if (flags.description) spec.description = String(flags.description);
  if (flags.category) spec.category = String(flags.category);
  if (flags.publisher) spec.publisher = String(flags.publisher);
  if (flags.compat)
    spec.compatibility = String(flags.compat).split(",").map((s) => s.trim());
  if (flags.kind) spec.kind = flags.kind === "record" ? "record" : "dashboard";
  if (flags["triggers-playbook"] || flags.triggersPlaybook)
    spec.triggersPlaybook = true;
  return spec;
}

function main(): void {
  const raw = parseCli(process.argv.slice(2));
  const nameErr = validateName(raw.name);
  if (nameErr) {
    process.stderr.write(
      `ERROR: ${nameErr}\n\n` +
        `usage: node scripts/new-widget.js <camelCaseName> ["Title"]\n` +
        `       node scripts/new-widget.js --spec spec.json\n` +
        `       node scripts/new-widget.js <name> --kind record --triggers-playbook\n`
    );
    process.exit(2);
  }

  const repoDir = path.resolve(__dirname, "..");
  const widgetsDir =
    process.env.WIDGETS_SRC || path.join(repoDir, "widgets-src");
  const harnessE2eDir = path.join(repoDir, "tests", "e2e");

  const gen = generateWidget(raw);
  let result;
  try {
    result = writeWidget(gen, { widgetsDir, harnessE2eDir, name: raw.name });
  } catch (e) {
    process.stderr.write(`ERROR: ${(e as Error).message}\n`);
    process.exit(1);
    return;
  }

  const spec = normalizeSpec(raw);
  process.stdout.write(
    `✓ created ${result.dest}\n` +
      `  kind: ${spec.kind}${spec.triggersPlaybook ? " + playbook trigger" : ""}` +
      `  |  controller: ${gen.derived.viewCtrl}\n` +
      `  e2e spec → ${result.e2ePath}\n` +
      `  next:\n` +
      `    make test-unit WIDGET=${spec.name}       # jest unit (green now)\n` +
      `    npm run dev                              # pick "${spec.title}" at http://localhost:4401\n` +
      `    make test-e2e-widget WIDGET=${spec.name} # Playwright (hermetic, NS1 fixtures)\n`
  );
}

if (require.main === module) main();
