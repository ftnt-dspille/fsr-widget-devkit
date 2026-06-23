"use strict";

const { parseManifest, parsePartial, injectName, ifaceName, tsType } =
  require("../scripts/gen-soar-types");

describe("parseManifest", () => {
  test("extracts service pages, skips non-service and deprecated", () => {
    const js =
      'NG_DOCS={"pages":[' +
      '{"id":"fortisoar.connectorService","type":"service","isDeprecated":false},' +
      '{"id":"fortisoar.oldThing","type":"service","isDeprecated":true},' +
      '{"id":"fortisoar.someDirective","type":"directive"}' +
      "]};";
    const out = parseManifest(js).map((s) => s.id);
    expect(out).toEqual(["fortisoar.connectorService"]);
  });
});

describe("injectName / ifaceName", () => {
  test("strips fortisoar. prefix and the services: segment", () => {
    expect(injectName("fortisoar.appModulesService")).toBe("appModulesService");
    expect(injectName("fortisoar.services:PagedCollection")).toBe("PagedCollection");
  });
  test("ifaceName PascalCases the injected name", () => {
    expect(ifaceName("connectorService")).toBe("ConnectorService");
    expect(ifaceName("PagedCollection")).toBe("PagedCollection");
  });
});

describe("tsType maps ngdoc type-hints", () => {
  test.each([
    ["string", "string"], ["Boolean", "boolean"], ["Promise", "Promise<unknown>"],
    ["Array", "unknown[]"], ["Object", "object"], ["weirdtype", "unknown"],
  ])("%s -> %s", (hint, expected) => {
    expect(tsType(hint)).toBe(expected);
  });
});

describe("parsePartial", () => {
  // Real markup captured from the FormEntityService partial.
  const FORM_ENTITY = `
<h1><code>FormEntityService</code></h1>
<div><h2 id="description">Description</h2>
<div class="description"><div><p>The <code>FormEntityService</code> handles entity related operation.</p></div></div>
<div class="member method"><h2 id="methods">Methods</h2>
<ul class="methods"><li><h3 id="methods_get">get()</h3>
<div><p>get entity.</p></div><h5 id="methods_get_returns">Returns</h5><table class="variables-matrix"><tr><td><a class="label type-hint type-hint-object">Object</a></td><td><p>Entity object.</p></td></tr></table></div>
</li>
<li><h3 id="methods_set">set(newEntity)</h3>
<div><p>saves entity.</p></div><h5 id="methods_set_parameters">Parameters</h5><table class="variables-matrix table"><thead><tr><th>Param</th><th>Type</th><th>Details</th></tr></thead><tbody><tr><td>newEntity</td><td><a class="label type-hint type-hint-object">Object</a></td><td><p>Entity object.</p></td></tr></tbody></table></div>
</li></ul></div></div>`;

  // appModulesService.load — real markup with optional params + a Promise return.
  const APP_LOAD = `
<h3 id="methods_load">load(excludeSystemModule, forceReload)</h3>
<div><p>load modules</p></div><h5 id="methods_load_parameters">Parameters</h5><table class="variables-matrix table"><thead><tr><th>Param</th><th>Type</th><th>Details</th></tr></thead><tbody><tr><td>excludeSystemModule <div><em>(optional)</em></div></td><td><a class="label type-hint type-hint-boolean">Boolean</a></td><td><p>x</p></td></tr><tr><td>forceReload <div><em>(optional)</em></div></td><td><a class="label type-hint type-hint-boolean">Boolean</a></td><td><p>y</p></td></tr></tbody></table><h5 id="methods_load_returns">Returns</h5><table class="variables-matrix"><tr><td><a class="label type-hint type-hint-promise">Promise</a></td><td><p>a promise</p></td></tr></table>`;

  test("parses methods, params, types, and description", () => {
    const { description, methods } = parsePartial(FORM_ENTITY);
    expect(description).toMatch(/FormEntityService handles entity/);
    const byName = Object.fromEntries(methods.map((m) => [m.name, m]));
    expect(byName.get.params).toEqual([]);
    expect(byName.get.returns).toBe("object");
    expect(byName.set.params).toEqual([{ name: "newEntity", type: "object", optional: false }]);
    expect(byName.set.returns).toBe("void");
  });

  test("preserves method-name casing from the signature, not the lowercased id", () => {
    const html = '<h3 id="methods_executeconnectoraction">executeConnectorAction(name)</h3>';
    expect(parsePartial(html).methods[0].name).toBe("executeConnectorAction");
  });

  test("marks optional params and maps Promise return", () => {
    const { methods } = parsePartial(APP_LOAD);
    const load = methods.find((m) => m.name === "load");
    expect(load.params).toEqual([
      { name: "excludeSystemModule", type: "boolean", optional: true },
      { name: "forceReload", type: "boolean", optional: true },
    ]);
    expect(load.returns).toBe("Promise<unknown>");
  });

  test("forces a required param to optional if it follows an optional one (TS rule)", () => {
    const html =
      '<h3 id="methods_f">f(a, b)</h3>' +
      '<h5 id="methods_f_parameters">P</h5><table><tbody>' +
      '<tr><td>a <div><em>(optional)</em></div></td><td><a class="type-hint-string">String</a></td><td>x</td></tr>' +
      '<tr><td>b</td><td><a class="type-hint-string">String</a></td><td>y</td></tr>' +
      "</tbody></table>";
    const f = parsePartial(html).methods[0];
    expect(f.params.map((p) => p.optional)).toEqual([true, true]);
  });
});
