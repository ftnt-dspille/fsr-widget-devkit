"use strict";
/* widgetTypecheck.ts — Phase 3: type-check a widget controller's JS against the
   generated SOAR platform types (lib/soar-platform.d.ts).

   AngularJS widgets are plain JS with name-based DI: `function ctrl($scope,
   connectorService) {…}`. The injected params are untyped, so nothing checks
   that `connectorService.executeConnectorAction(...)` is called correctly. This
   module bridges that gap WITHOUT touching widget source: it parses the
   controller, and for every function param whose name matches a known platform
   service it splices a JSDoc `@param {Soar.<Iface>}` annotation into an in-memory
   copy, then runs `tsc --checkJs` over it. The result: misused platform services
   (bad method name, wrong arg count, null where a string is required — e.g. the
   classic `executeConnectorAction(..., null, ...)` config bug) become hard type
   errors. Untyped locals stay `any` (noImplicitAny is off) so only SOAR-contract
   violations surface, not AngularJS boilerplate noise.

   See TYPESCRIPT_STATIC_ANALYSIS_PLAN.md Phase 3. */
const ts = require("typescript");
const fs = require("fs");
const path = require("path");
const DTS_PATH = path.join(__dirname, "soar-platform.d.ts");
const MODEL_PATH = path.join(__dirname, "soar-services.generated.json");
/* inject-name -> interface name, from the generated catalog (e.g.
   connectorService -> ConnectorService). */
function buildServiceTypeMap() {
    try {
        const model = JSON.parse(fs.readFileSync(MODEL_PATH, "utf8"));
        const out = {};
        for (const s of model.services || []) {
            if (typeof s.inject === "string" && typeof s.iface === "string")
                out[s.inject] = s.iface;
        }
        return out;
    }
    catch (_a) {
        return {};
    }
}
/* Splice JSDoc `@param {Soar.X} name` before every function whose params include
   a known platform-service name. Non-destructive: operates on a copy. Insertions
   are applied back-to-front so earlier offsets stay valid. */
function annotateInjectedParams(source, serviceTypeMap) {
    const sf = ts.createSourceFile("w.js", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const inserts = [];
    const visit = (node) => {
        if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)) {
            const typed = [];
            for (const p of node.parameters) {
                const name = ts.isIdentifier(p.name) ? p.name.text : "";
                if (name && serviceTypeMap[name])
                    typed.push(name);
            }
            if (typed.length) {
                const body = typed.map((n) => ` * @param {Soar.${serviceTypeMap[n]}} ${n}`).join("\n");
                inserts.push({ pos: node.getStart(sf), text: `/**\n${body}\n */\n` });
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(sf);
    inserts.sort((a, b) => b.pos - a.pos);
    let out = source;
    for (const i of inserts)
        out = out.slice(0, i.pos) + i.text + out.slice(i.pos);
    return out;
}
// Browser/AngularJS ambient globals so a controller referencing them isn't a
// "cannot find name" false positive. Intentionally `any` — we only want to check
// the SOAR service contract, not re-type the whole platform.
const GLOBALS_DTS = "declare var angular: any; declare var _: any; declare var moment: any; " +
    "declare var $: any; declare var jQuery: any; declare var CyberSponse: any;";
/* Type-check one widget controller against the SOAR platform types. Returns
   diagnostics located in the widget file only (lib/dts diagnostics are dropped). */
function typecheckWidget(opts) {
    const fileName = opts.fileName || "widget.js";
    const map = opts.serviceTypeMap || buildServiceTypeMap();
    const annotated = annotateInjectedParams(opts.source, map);
    const options = {
        allowJs: true, checkJs: true, noEmit: true,
        strict: true, noImplicitAny: false, // keep strictNullChecks; silence untyped-any noise
        target: ts.ScriptTarget.ES2017, lib: ["lib.es2020.d.ts", "lib.dom.d.ts"],
        types: [], skipLibCheck: true,
    };
    const virtual = {
        [fileName]: annotated,
        "soar-platform.d.ts": fs.readFileSync(DTS_PATH, "utf8"),
        "soar-globals.d.ts": GLOBALS_DTS,
    };
    const host = ts.createCompilerHost(options);
    const origGetSource = host.getSourceFile.bind(host);
    host.getSourceFile = (name, langVersion, onErr) => {
        const v = virtual[name];
        if (v != null)
            return ts.createSourceFile(name, v, langVersion, true, name.endsWith(".js") ? ts.ScriptKind.JS : ts.ScriptKind.TS);
        return origGetSource(name, langVersion, onErr);
    };
    const origReadFile = host.readFile.bind(host);
    host.readFile = (n) => (virtual[n] != null ? virtual[n] : origReadFile(n));
    const origFileExists = host.fileExists.bind(host);
    host.fileExists = (n) => virtual[n] != null || origFileExists(n);
    const program = ts.createProgram(Object.keys(virtual), options, host);
    return ts.getPreEmitDiagnostics(program)
        .filter((d) => d.file && d.file.fileName === fileName)
        .map((d) => ({
        code: d.code,
        message: ts.flattenDiagnosticMessageText(d.messageText, "\n"),
        line: d.file && d.start != null ? d.file.getLineAndCharacterOfPosition(d.start).line + 1 : undefined,
    }));
}
const api = { buildServiceTypeMap, annotateInjectedParams, typecheckWidget };
module.exports = api;
