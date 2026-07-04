"use strict";

// Phase 3: prove the widget type-checker surfaces real SOAR-contract violations.
// These "known broken widget" fixtures plant a specific bug; each test asserts
// the checker brings exactly that issue to light (by TS diagnostic code). This
// runs in the normal `make test-unit` (jest) sweep — no separate step to
// remember — so any regression in the type pipeline fails the build.

const { typecheckWidget, annotateInjectedParams, buildServiceTypeMap } =
  require("../lib/widgetTypecheck");

const codes = (src) => typecheckWidget({ source: src }).map((d) => d.code);

describe("typecheckWidget — known-broken widgets surface the planted issue", () => {
  test("null passed where connectorService.executeConnectorAction wants a string config (the classic config bug)", () => {
    const src = `function ctrl($scope, connectorService) {
      connectorService.executeConnectorAction("conn", "1.0.0", "get_x", null, {});
    }`;
    const diags = typecheckWidget({ source: src });
    expect(diags.map((d) => d.code)).toContain(2345); // null not assignable to string
    expect(diags.some((d) => /not assignable to parameter of type 'string'/.test(d.message))).toBe(true);
  });

  test("calling a method that doesn't exist on a platform service", () => {
    const src = `function ctrl($scope, FormEntityService) { FormEntityService.gett(); }`;
    // 2551 = "does not exist … did you mean"; 2339 = plain "does not exist".
    expect(codes(src).some((c) => c === 2551 || c === 2339)).toBe(true);
  });

  test("too few arguments to a platform-service method", () => {
    const src = `function ctrl($scope, appModulesService) { appModulesService.getState(); }`;
    expect(codes(src)).toContain(2554); // Expected 1 arguments, but got 0
  });

  test("the bug is caught even when the controller is an inline function expression", () => {
    const src = `angular.module("x").controller("c", function ($scope, connectorService) {
      connectorService.executeConnectorAction("c", "1.0", "op", null, {});
    });`;
    expect(codes(src)).toContain(2345);
  });
});

describe("typecheckWidget — clean widgets stay silent (no false positives)", () => {
  test("a correct executeConnectorAction call produces no diagnostics", () => {
    const src = `function ctrl($scope, connectorService) {
      connectorService.executeConnectorAction("conn", "1.0.0", "get_x", "config-id", { ip: "1.2.3.4" });
    }`;
    expect(typecheckWidget({ source: src })).toEqual([]);
  });

  test("untyped locals and AngularJS boilerplate do not error (noImplicitAny off)", () => {
    const src = `function ctrl($scope, $http, $timeout, connectorService) {
      var x = $scope.config || {};
      $http.get("/api/3/alerts").then(function (r) { $scope.rows = r.data; });
      angular.forEach(x, function (v) { return v; });
      connectorService.executeConnectorAction("c", "1.0", "op", "cfg", {});
    }`;
    expect(typecheckWidget({ source: src })).toEqual([]);
  });
});

describe("annotateInjectedParams", () => {
  test("annotates only params matching a known platform service", () => {
    const out = annotateInjectedParams(
      `function ctrl($scope, connectorService, somethingElse) {}`,
      buildServiceTypeMap()
    );
    expect(out).toContain("@param {Soar.ConnectorService} connectorService");
    expect(out).not.toContain("somethingElse}");
    expect(out).not.toContain("$scope}");
  });

  test("a widget injecting no known service is returned unchanged", () => {
    const src = `function ctrl($scope, $http) { return 1; }`;
    expect(annotateInjectedParams(src, buildServiceTypeMap())).toBe(src);
  });
});

// Phase 3 noise-scoping (soarOnly). The gate runs scoped: only diagnostics
// that resolve to a Soar.* contract survive. Noise (3rd-party globals,
// untyped locals, local-helper arity) is dropped; real SOAR-contract misuse
// (null config, bad method, wrong arity on a platform service) is kept.
describe("typecheckWidget — soarOnly noise-scoping", () => {
  // -- noise that must be dropped when scoped ----------------------------------
  test("window.<3rd-party> property access is noise (dropped scoped, kept raw)", () => {
    const src = `function ctrl($scope) { window.monaco.editor.create(); }`;
    const raw = typecheckWidget({ source: src });
    expect(raw.some((d) => d.code === 2339 && /monaco/.test(d.message))).toBe(true);
    const scoped = typecheckWidget({ source: src, soarOnly: true });
    expect(scoped).toEqual([]);
  });

  test("catch-clause 'unknown' locals are noise (dropped scoped)", () => {
    const src = `function ctrl($scope) { try { x(); } catch (e) { return e.stack; } }`;
    const raw = typecheckWidget({ source: src });
    expect(raw.some((d) => d.code === 18046 && /'e' is of type 'unknown'/.test(d.message))).toBe(true);
    expect(typecheckWidget({ source: src, soarOnly: true })).toEqual([]);
  });

  test("local-helper wrong arity is noise — the helper is not a Soar service (dropped scoped)", () => {
    const src = `function ctrl($scope) {
      function helper(a, b) { return a + b; }
      return helper(1, 2, 3);
    }`;
    const raw = typecheckWidget({ source: src });
    expect(raw.some((d) => d.code === 2554)).toBe(true);
    expect(typecheckWidget({ source: src, soarOnly: true })).toEqual([]);
  });

  // -- real SOAR-contract signal that must survive scoped -------------------
  test("null passed to executeConnectorAction's string config survives scoped (the headline catch)", () => {
    const src = `function ctrl($scope, connectorService) {
      connectorService.executeConnectorAction("conn", "1.0.0", "get_x", null, {});
    }`;
    const scoped = typecheckWidget({ source: src, soarOnly: true });
    expect(scoped.map((d) => d.code)).toContain(2345);
    expect(scoped.some((d) => /not assignable to parameter of type 'string'/.test(d.message))).toBe(true);
  });

  test("a non-existent method on a platform service survives scoped", () => {
    const src = `function ctrl($scope, FormEntityService) { FormEntityService.gett(); }`;
    const scoped = typecheckWidget({ source: src, soarOnly: true });
    expect(scoped.some((d) => d.code === 2551 || d.code === 2339)).toBe(true);
  });

  test("too-few args to a platform-service method survives scoped", () => {
    const src = `function ctrl($scope, appModulesService) { appModulesService.getState(); }`;
    const scoped = typecheckWidget({ source: src, soarOnly: true });
    expect(scoped.map((d) => d.code)).toContain(2554);
  });

  // -- regression: a correct widget is silent in both modes ---------------
  test("a correct executeConnectorAction call is silent scoped AND raw", () => {
    const src = `function ctrl($scope, connectorService) {
      connectorService.executeConnectorAction("conn", "1.0.0", "get_x", "config-id", { ip: "1.2.3.4" });
    }`;
    expect(typecheckWidget({ source: src })).toEqual([]);
    expect(typecheckWidget({ source: src, soarOnly: true })).toEqual([]);
  });
});
