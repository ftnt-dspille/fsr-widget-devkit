"use strict";

const {
  resolvePath,
  deriveControllerName,
  deriveEditControllerName,
  mergeConfig,
  configStorageKey,
  recordFetchPath,
  resolveMapping,
  stateForContext,
  extractInjectedDependencies,
  parseRegisteredServices,
  inertStubFinding,
  selectPlaybookTrigger,
  buildCsGridPaged,
  triggerEndpointMisuse,
  generatedServiceNames,
  SOAR_DEV_GUIDE_INJECTABLES,
  dollarParamObjectKeys,
  queryFilterMissingLogic,
  referencedLocalAssets,
  absoluteHostUrls,
  rootNgControllerError,
  htmlTagBalanceErrors,
  lintWidget,
} = require("../lib/harnessUtils");

describe("resolvePath", () => {
  const rec = {
    name: "alert-1",
    source: { host: "10.0.0.1", ports: [22, 80] },
    nested: { a: { b: { c: "deep" } } },
  };

  test("walks dotted paths", () => {
    expect(resolvePath(rec, "name")).toBe("alert-1");
    expect(resolvePath(rec, "source.host")).toBe("10.0.0.1");
    expect(resolvePath(rec, "nested.a.b.c")).toBe("deep");
  });

  test("returns undefined for missing segments", () => {
    expect(resolvePath(rec, "source.missing")).toBeUndefined();
    expect(resolvePath(rec, "missing.deep.path")).toBeUndefined();
  });

  test("handles array index segments", () => {
    expect(resolvePath(rec, "source.ports.0")).toBe(22);
    expect(resolvePath(rec, "source.ports.1")).toBe(80);
  });

  test("guards null / empty inputs", () => {
    expect(resolvePath(null, "x")).toBeUndefined();
    expect(resolvePath(rec, "")).toBeUndefined();
    expect(resolvePath(rec, undefined)).toBeUndefined();
  });
});

describe("deriveControllerName", () => {
  test("strips dots from version and appends DevCtrl", () => {
    expect(deriveControllerName("jinjaEditorWidget", "1.1.2")).toBe("jinjaEditorWidget112DevCtrl");
    expect(deriveControllerName("foo", "10.0.0")).toBe("foo1000DevCtrl");
  });

  test("missing version yields no digits", () => {
    expect(deriveControllerName("foo", "")).toBe("fooDevCtrl");
    expect(deriveControllerName("foo")).toBe("fooDevCtrl");
  });

  test("missing name throws", () => {
    expect(() => deriveControllerName("")).toThrow(/missing name/);
    expect(() => deriveControllerName(null, "1.0.0")).toThrow(/missing name/);
  });
});

describe("deriveEditControllerName", () => {
  test("capitalizes the widget name and prefixes with 'edit'", () => {
    expect(deriveEditControllerName("jinjaEditorWidget", "1.1.3")).toBe("editJinjaEditorWidget113DevCtrl");
    expect(deriveEditControllerName("foo", "2.0")).toBe("editFoo20DevCtrl");
  });

  test("missing name throws", () => {
    expect(() => deriveEditControllerName("", "1.0.0")).toThrow(/missing name/);
  });
});

describe("mergeConfig", () => {
  test("saved values override defaults", () => {
    const out = mergeConfig({ a: 1, b: 2 }, { b: 99, c: 3 });
    expect(out).toEqual({ a: 1, b: 99, c: 3 });
  });

  test("either side may be null/undefined", () => {
    expect(mergeConfig(null, { a: 1 })).toEqual({ a: 1 });
    expect(mergeConfig({ a: 1 }, null)).toEqual({ a: 1 });
    expect(mergeConfig(null, null)).toEqual({});
  });

  test("returns a fresh object (no aliasing)", () => {
    const defaults = { a: 1 };
    const out = mergeConfig(defaults, { b: 2 });
    out.a = 99;
    expect(defaults.a).toBe(1);
  });
});

describe("configStorageKey", () => {
  test("namespaced and stable per widget id", () => {
    expect(configStorageKey("jinjaEditorWidget-1.1.2")).toBe("harness:config:jinjaEditorWidget-1.1.2");
  });
});

describe("recordFetchPath", () => {
  test("builds module/id path with relationships", () => {
    expect(recordFetchPath("alerts", "abc-123", true)).toBe("/api/3/alerts/abc-123?$relationships=true");
  });

  test("omits query when relationships are false", () => {
    expect(recordFetchPath("alerts", "abc", false)).toBe("/api/3/alerts/abc");
  });

  test("encodes ids that contain special characters", () => {
    expect(recordFetchPath("alerts", "a/b", false)).toBe("/api/3/alerts/a%2Fb");
  });

  test("throws when module or id missing", () => {
    expect(() => recordFetchPath("", "x")).toThrow();
    expect(() => recordFetchPath("alerts", "")).toThrow();
  });
});

describe("resolveMapping", () => {
  const record = { name: "alert", source: { host: "h1" } };

  test("walks string values as paths", () => {
    expect(resolveMapping({ title: "name", host: "source.host" }, record)).toEqual({
      title: "alert",
      host: "h1",
    });
  });

  test("strips leading 'record.' to match SOAR mapping syntax", () => {
    expect(resolveMapping({ host: "record.source.host" }, record)).toEqual({ host: "h1" });
  });

  test("non-string values pass through unchanged", () => {
    expect(resolveMapping({ enabled: true, n: 5, fallback: null }, record)).toEqual({
      enabled: true,
      n: 5,
      fallback: null,
    });
  });

  test("missing paths produce undefined", () => {
    expect(resolveMapping({ x: "missing.thing" }, record)).toEqual({ x: undefined });
  });

  test("non-object mapping returns empty object", () => {
    expect(resolveMapping(null, record)).toEqual({});
    expect(resolveMapping("oops", record)).toEqual({});
  });
});

describe("stateForContext", () => {
  // Implementation always seeds `params.page` with the context name so
  // widgets that read `$state.params.page` (the `page === 'dashboard'`
  // branches in c3charts and elsewhere) work uniformly across contexts.
  test("dashboard yields main.dashboard with page=dashboard", () => {
    expect(stateForContext("dashboard")).toEqual({
      current: { name: "main.dashboard" },
      params: { page: "dashboard" },
    });
  });

  test("viewpanel passes params through with page=viewPanel", () => {
    expect(stateForContext("viewpanel", { module: "alerts", id: "x" })).toEqual({
      current: { name: "viewPanel.modulesDetail" },
      params: { page: "viewPanel", module: "alerts", id: "x" },
    });
  });

  test("drawer adds drawer flag to params with page=viewPanel", () => {
    expect(stateForContext("drawer", { id: "x" })).toEqual({
      current: { name: "viewPanel.modulesDetail" },
      params: { page: "viewPanel", drawer: true, id: "x" },
    });
  });

  test("unknown context falls back to dashboard", () => {
    expect(stateForContext("garbage")).toEqual({
      current: { name: "main.dashboard" },
      params: { page: "dashboard" },
    });
  });
});

describe("extractInjectedDependencies", () => {
  test("picks up the $inject array form", () => {
    const src = `
      function Ctrl(){}
      Ctrl.$inject = ["$scope", "Modules", "toaster"];
      angular.module("x").controller("Ctrl", Ctrl);
    `;
    expect(extractInjectedDependencies(src).sort()).toEqual(["$scope", "Modules", "toaster"].sort());
  });

  test("picks up the inline-array .controller form", () => {
    const src = `angular.module("x").controller("C", ["$scope", "Foo", function ($scope, Foo) {}]);`;
    expect(extractInjectedDependencies(src).sort()).toEqual(["$scope", "Foo"].sort());
  });

  test("picks up the implicit function-arg form", () => {
    const src = `
      function MyCtrl($scope, Bar, $http) {}
      angular.module("x").controller("MyCtrl", MyCtrl);
    `;
    expect(extractInjectedDependencies(src).sort()).toEqual(["$scope", "Bar", "$http"].sort());
  });

  test("returns [] for empty / non-string input", () => {
    expect(extractInjectedDependencies("")).toEqual([]);
    expect(extractInjectedDependencies(null)).toEqual([]);
  });
});

describe("parseRegisteredServices", () => {
  test("collects factory/value/directive registrations", () => {
    const src = `
      angular.module("cybersponse", [])
        .factory("Foo", function () {})
        .value("config", {})
        .directive("csSpinner", function () {});
    `;
    expect(parseRegisteredServices(src).sort()).toEqual(["Foo", "config", "csSpinner"].sort());
  });
});

describe("rootNgControllerError", () => {
  test("flags ng-controller on root", () => {
    expect(rootNgControllerError(`<div ng-controller="X">x</div>`)).toMatch(/collides/);
    expect(rootNgControllerError(`<div data-ng-controller="X">x</div>`)).toMatch(/collides/);
  });
  test("clean root returns null", () => {
    expect(rootNgControllerError(`<div class="x">y</div>`)).toBeNull();
  });
  test("ignores leading comment", () => {
    expect(rootNgControllerError(`<!-- top --><div class="x"></div>`)).toBeNull();
  });
});

describe("lintWidget", () => {
  const baseFiles = {
    "view.controller.js": `function foo112DevCtrl($scope){} foo112DevCtrl.$inject=["$scope"]; angular.module("x").controller("foo112DevCtrl", foo112DevCtrl);`,
    "edit.controller.js": `function editFoo112DevCtrl($scope){} editFoo112DevCtrl.$inject=["$scope"]; angular.module("x").controller("editFoo112DevCtrl", editFoo112DevCtrl);`,
    "view.html": `<div><span>{{x}}</span></div>`,
    "edit.html": `<div></div>`,
  };
  const baseInfo = { name: "foo", version: "1.1.2", title: "Foo" };

  test("clean widget yields no errors", () => {
    const r = lintWidget({
      info: baseInfo,
      files: baseFiles,
      registeredServices: [],
      viewControllers: ["foo112DevCtrl"],
      editControllers: ["editFoo112DevCtrl"],
    });
    expect(r.errors).toEqual([]);
  });

  test("missing required file is an error", () => {
    const files = Object.assign({}, baseFiles); delete files["edit.html"];
    const r = lintWidget({ info: baseInfo, files });
    expect(r.errors.some((e) => e.code === "file-missing" && e.file === "edit.html")).toBe(true);
  });

  test("controller mismatch is fixable", () => {
    const r = lintWidget({
      info: baseInfo,
      files: baseFiles,
      viewControllers: ["foo111DevCtrl"],
    });
    const e = r.errors.find((x) => x.code === "controller-mismatch");
    expect(e).toBeTruthy();
    expect(e.fixable).toBe(true);
  });

  test("unknown injected service is reported", () => {
    const files = Object.assign({}, baseFiles, {
      "view.controller.js": `function f(){} f.$inject=["$scope","NotRegistered"]; angular.module("x").controller("foo112DevCtrl", f);`,
    });
    const r = lintWidget({
      info: baseInfo,
      files,
      registeredServices: ["Modules"],
      viewControllers: ["foo112DevCtrl"],
    });
    const e = r.errors.find((x) => x.code === "unknown-dependency");
    expect(e).toBeTruthy();
    expect(e.unknown).toContain("NotRegistered");
  });

  test("ng-controller on root is an error", () => {
    const files = Object.assign({}, baseFiles, { "view.html": `<div ng-controller="x">y</div>` });
    const r = lintWidget({ info: baseInfo, files });
    expect(r.errors.some((e) => e.code === "root-ng-controller")).toBe(true);
  });

  test("missing info.json yields a single error", () => {
    const r = lintWidget({ info: null, files: {} });
    expect(r.errors[0].code).toBe("info-missing");
  });

  test("unbalanced <div> in edit.html is an html-tag-imbalance error", () => {
    // The action-renderer regression: a stray </div> closed .modal-body before
    // the Back/Next nav, reparenting it. lint must catch the count mismatch.
    const files = Object.assign({}, baseFiles, { "edit.html": `<div class="modal-body"><div></div></div></div>` });
    const r = lintWidget({
      info: baseInfo, files,
      viewControllers: ["foo112DevCtrl"], editControllers: ["editFoo112DevCtrl"],
    });
    const e = r.errors.find((x) => x.code === "html-tag-imbalance" && x.file === "edit.html");
    expect(e).toBeTruthy();
    expect(e.message).toMatch(/<div>/);
  });

  test("balanced ui-select markup does not false-positive", () => {
    const files = Object.assign({}, baseFiles, {
      "edit.html": `<div><ui-select><ui-select-match>x</ui-select-match><ui-select-choices></ui-select-choices></ui-select><select></select></div>`,
    });
    const r = lintWidget({
      info: baseInfo, files,
      viewControllers: ["foo112DevCtrl"], editControllers: ["editFoo112DevCtrl"],
    });
    expect(r.errors.some((e) => e.code === "html-tag-imbalance")).toBe(false);
  });
});

describe("htmlTagBalanceErrors", () => {
  test("flags an extra closing div", () => {
    expect(htmlTagBalanceErrors("<div></div></div>")).toEqual([{ tag: "div", opens: 1, closes: 2 }]);
  });
  test("ignores tags inside HTML comments", () => {
    expect(htmlTagBalanceErrors("<div><!-- </div> --></div>")).toEqual([]);
  });
  test("does not cross-count <select> and <ui-select>", () => {
    expect(htmlTagBalanceErrors("<ui-select></ui-select><select></select>")).toEqual([]);
  });
});

describe("inertStubFinding (NS2 faithful-or-loud)", () => {
  test("null/empty inputs produce no finding", () => {
    expect(inertStubFinding(null)).toBeNull();
    expect(inertStubFinding(undefined)).toBeNull();
    expect(inertStubFinding({})).toBeNull();
    expect(inertStubFinding("nope")).toBeNull();
  });

  test("zero-count entries are ignored (registered but never invoked)", () => {
    expect(inertStubFinding({ "$uibModalInstance.close": 0 })).toBeNull();
  });

  test("an invoked inert method yields a loud, located finding", () => {
    const f = inertStubFinding({ "$uibModalInstance.close": 2 });
    expect(f).toMatch(/inert stub/i);
    expect(f).toContain("$uibModalInstance.close ×2");
    expect(f).toMatch(/silently dropped/i);
  });

  test("multiple methods are listed, most-invoked first", () => {
    const f = inertStubFinding({
      "localStorageService.clearAll": 1,
      "$uibModalInstance.close": 5,
    });
    expect(f.indexOf("$uibModalInstance.close ×5")).toBeLessThan(
      f.indexOf("localStorageService.clearAll ×1")
    );
  });
});

describe("selectPlaybookTrigger (NS4 contract helper)", () => {
  test("record-context action trigger uses the action endpoint by route", () => {
    expect(selectPlaybookTrigger({ route: "blockIp", uuid: "u1" })).toEqual({
      url: "api/triggers/1/action/blockIp",
      isManual: false,
    });
  });

  test("manual trigger type runs by uuid via notrigger", () => {
    expect(selectPlaybookTrigger({ triggerType: "manual", route: "r", uuid: "u1" })).toEqual({
      url: "api/triggers/1/notrigger/u1",
      isManual: true,
    });
  });

  test("no route OR noRecordExecution falls back to notrigger by uuid", () => {
    expect(selectPlaybookTrigger({ uuid: "u1" }).isManual).toBe(true);
    expect(selectPlaybookTrigger({ noRecordExecution: true, route: "r", uuid: "u1" }).isManual).toBe(true);
  });

  test("honors injected API constants", () => {
    const API = { MANUAL_TRIGGER: "m/", ACTION_TRIGGER: "a/" };
    expect(selectPlaybookTrigger({ route: "x", uuid: "u", API }).url).toBe("a/x");
    expect(selectPlaybookTrigger({ uuid: "u", API }).url).toBe("m/u");
  });
});

describe("buildCsGridPaged (NS4 contract helper)", () => {
  test("sets list + keyPairs + visited so csGrid paints rows", () => {
    const out = buildCsGridPaged([{ a: 1 }, { a: 2 }]);
    expect(out.visited).toBe(true);
    expect(out.list).toHaveLength(2);
    expect(out.keyPairs).toHaveLength(2);
    // synthesized IRI/uuid for selection tracking
    expect(out.keyPairs[0]["@id"]).toContain("dummy_module/");
    expect(out.keyPairs[0].uuid).toBeDefined();
  });

  test("preserves an existing @id / uuid", () => {
    const out = buildCsGridPaged([{ "@id": "/api/3/alerts/x", a: 1 }]);
    expect(out.keyPairs[0]["@id"]).toBe("/api/3/alerts/x");
  });

  test("empty / non-array yields empty list (zero rows, not a crash)", () => {
    expect(buildCsGridPaged(null).list).toEqual([]);
    expect(buildCsGridPaged(undefined).keyPairs).toEqual([]);
  });
});

describe("triggerEndpointMisuse (NS4 lint detector)", () => {
  test("flags ACTION_TRIGGER concatenated with a uuid", () => {
    expect(triggerEndpointMisuse("url = API.ACTION_TRIGGER + playbook.uuid;")).toMatch(/ACTION_TRIGGER/);
    expect(triggerEndpointMisuse("url = API.ACTION_TRIGGER + inputData.__uuid;")).toMatch(/__uuid/);
  });

  test("flags ACTION_TRIGGER + getEndPathName(...)", () => {
    expect(
      triggerEndpointMisuse('url = API.ACTION_TRIGGER + $filter("getEndPathName")(pb["@id"]);')
    ).toMatch(/getEndPathName/);
  });

  test("does NOT flag the correct ACTION_TRIGGER + route", () => {
    expect(triggerEndpointMisuse("url = API.ACTION_TRIGGER + route;")).toBeNull();
    expect(triggerEndpointMisuse("url = API.ACTION_TRIGGER + src.route + '?force_debug=true';")).toBeNull();
  });

  test("ignores the pattern inside a // comment", () => {
    expect(triggerEndpointMisuse("// using ACTION_TRIGGER + uuid here would 404\nurl = API.ACTION_TRIGGER + route;")).toBeNull();
  });

  test("null / non-string is safe", () => {
    expect(triggerEndpointMisuse(null)).toBeNull();
    expect(triggerEndpointMisuse(123)).toBeNull();
  });
});

describe("lintWidget trigger-endpoint-misuse integration", () => {
  const baseInfo = { name: "foo", version: "1.1.2", title: "Foo" };
  test("a controller that appends uuid to the action endpoint is an error", () => {
    const files = {
      "view.html": "<div>x</div>",
      "edit.html": "<div>y</div>",
      "view.controller.js": "var url = API.ACTION_TRIGGER + playbook.uuid;",
      "edit.controller.js": "",
    };
    const r = lintWidget({ info: baseInfo, files });
    const e = r.errors.find((x) => x.code === "trigger-endpoint-misuse");
    expect(e).toBeTruthy();
    expect(e.file).toBe("view.controller.js");
  });

  test("the correct route-based endpoint produces no such error", () => {
    const files = {
      "view.html": "<div>x</div>",
      "edit.html": "<div>y</div>",
      "view.controller.js": "var url = API.ACTION_TRIGGER + route;",
      "edit.controller.js": "",
    };
    const r = lintWidget({ info: baseInfo, files });
    expect(r.errors.some((x) => x.code === "trigger-endpoint-misuse")).toBe(false);
  });
});

describe("generatedServiceNames (platform-service floor)", () => {
  test("extracts inject names from the generated catalog model", () => {
    const model = { version: "8.0.0", services: [
      { inject: "connectorService", iface: "ConnectorService" },
      { inject: "FormEntityService" },
    ] };
    expect(generatedServiceNames(model)).toEqual(["connectorService", "FormEntityService"]);
  });
  test("defensive: returns [] for malformed / empty input", () => {
    expect(generatedServiceNames(null)).toEqual([]);
    expect(generatedServiceNames({})).toEqual([]);
    expect(generatedServiceNames({ services: "nope" })).toEqual([]);
    expect(generatedServiceNames({ services: [{}, { inject: 5 }, { inject: "" }] })).toEqual([]);
  });
  test("the committed generated catalog parses to the real 26 services", () => {
    const model = require("../lib/soar-services.generated.json");
    const names = generatedServiceNames(model);
    expect(names).toContain("connectorService");
    expect(names).toContain("appModulesService");
    expect(names.length).toBe(26);
  });
  test("dev-guide injectables include the non-catalog platform names", () => {
    expect(SOAR_DEV_GUIDE_INJECTABLES).toEqual(expect.arrayContaining(["WizardHandler", "Config", "_"]));
  });
});

describe("dollarParamObjectKeys (footgun: $-param serializer drop)", () => {
  test("flags $-prefixed SOAR params used as object keys", () => {
    const keys = dollarParamObjectKeys('$resource(url, { $limit: 30, $relationships: true });');
    expect(keys).toContain("$limit");
    expect(keys).toContain("$relationships");
  });
  test("flags quoted keys too (quoting does not save them)", () => {
    expect(dollarParamObjectKeys('{ "$triggerOnly": true }')).toContain("$triggerOnly");
  });
  test("URL-string form (?$limit=30) is fine — no object key", () => {
    expect(dollarParamObjectKeys("var u = '/api/3/x?$limit=30&$relationships=true';")).toEqual([]);
  });
  test("ignores commented-out code", () => {
    expect(dollarParamObjectKeys("// params: { $limit: 30 }")).toEqual([]);
  });
});

describe("queryFilterMissingLogic (footgun: filters dropped without logic)", () => {
  test("flags an /api/query body with filters but no logic", () => {
    const src = '$http.post("/api/query/Alert", { filters: [{field:"x"}] });';
    expect(queryFilterMissingLogic(src)).toBe(true);
  });
  test("clean when logic is present", () => {
    const src = '$http.post("/api/query/Alert", { logic: "AND", filters: [{field:"x"}] });';
    expect(queryFilterMissingLogic(src)).toBe(false);
  });
  test("clean when there is no /api/query at all", () => {
    expect(queryFilterMissingLogic("var x = { filters: [] };")).toBe(false);
  });
});

describe("referencedLocalAssets", () => {
  test("returns widget-local script/link paths, skips absolute/cdn/dynamic", () => {
    const html =
      '<script src="widgetAssets/foo.js"></script>' +
      '<link href="./styles.css">' +
      '<script src="/static/app.js"></script>' +
      '<script src="https://cdn/x.js"></script>' +
      '<script src="//cdn/y.js"></script>' +
      '<script src="{{vm.dynamic}}"></script>';
    expect(referencedLocalAssets(html).sort()).toEqual(["styles.css", "widgetAssets/foo.js"]);
  });
});

describe("absoluteHostUrls", () => {
  test("flags http(s) literals and the test box IP", () => {
    const src = 'var a="https://example.com/x"; var b="http://10.99.249.205/api";';
    const urls = absoluteHostUrls(src);
    expect(urls.some((u) => u.includes("example.com"))).toBe(true);
    expect(urls).toContain("10.99.249.205");
  });
  test("relative paths are clean", () => {
    expect(absoluteHostUrls('$http.get("api/3/playbooks");')).toEqual([]);
  });
});

describe("lintWidget footgun integration", () => {
  const baseInfo = { name: "foo", version: "1.1.2", title: "Foo" };
  const tmpl = { "view.html": "<div>x</div>", "edit.html": "<div>y</div>" };

  test("dollar-param-drop is an error", () => {
    const files = Object.assign({}, tmpl, {
      "view.controller.js": "$resource(u, { $limit: 30 });",
      "edit.controller.js": "",
    });
    const r = lintWidget({ info: baseInfo, files });
    expect(r.errors.some((e) => e.code === "dollar-param-drop")).toBe(true);
  });

  test("query-filter-no-logic is a warning", () => {
    const files = Object.assign({}, tmpl, {
      "view.controller.js": '$http.post("/api/query/Alert", { filters: [{a:1}] });',
      "edit.controller.js": "",
    });
    const r = lintWidget({ info: baseInfo, files });
    expect(r.warnings.some((w) => w.code === "query-filter-no-logic")).toBe(true);
  });

  test("broken-asset-path is an error when the file is absent from the listing", () => {
    const files = Object.assign({}, tmpl, {
      "view.html": '<div></div><script src="widgetAssets/missing.js"></script>',
      "view.controller.js": "",
      "edit.controller.js": "",
    });
    const r = lintWidget({ info: baseInfo, files, existingAssetPaths: ["view.html", "info.json"] });
    const e = r.errors.find((x) => x.code === "broken-asset-path");
    expect(e).toBeTruthy();
    expect(e.message).toMatch(/missing\.js/);
  });

  test("broken-asset-path clean when the referenced file exists", () => {
    const files = Object.assign({}, tmpl, {
      "view.html": '<div></div><script src="widgetAssets/real.js"></script>',
      "view.controller.js": "",
      "edit.controller.js": "",
    });
    const r = lintWidget({ info: baseInfo, files, existingAssetPaths: ["widgetAssets/real.js"] });
    expect(r.errors.some((x) => x.code === "broken-asset-path")).toBe(false);
  });

  test("absolute-host-url is a warning", () => {
    const files = Object.assign({}, tmpl, {
      "view.controller.js": '$http.get("https://10.99.249.205/api/3/x");',
      "edit.controller.js": "",
    });
    const r = lintWidget({ info: baseInfo, files });
    expect(r.warnings.some((w) => w.code === "absolute-host-url")).toBe(true);
  });
});
