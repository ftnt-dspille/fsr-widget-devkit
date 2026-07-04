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

import ts = require("typescript");
import fs = require("fs");
import path = require("path");

const DTS_PATH = path.join(__dirname, "soar-platform.d.ts");
const MODEL_PATH = path.join(__dirname, "soar-services.generated.json");

interface TypeDiag { code: number; message: string; line?: number; }

/* inject-name -> interface name, from the generated catalog (e.g.
   connectorService -> ConnectorService). */
function buildServiceTypeMap(): Record<string, string> {
  try {
    const model = JSON.parse(fs.readFileSync(MODEL_PATH, "utf8")) as {
      services?: Array<{ inject?: string; iface?: string }>;
    };
    const out: Record<string, string> = {};
    for (const s of model.services || []) {
      if (typeof s.inject === "string" && typeof s.iface === "string") out[s.inject] = s.iface;
    }
    return out;
  } catch { return {}; }
}

/* Splice JSDoc `@param {Soar.X} name` before every function whose params include
   a known platform-service name. Non-destructive: operates on a copy. Insertions
   are applied back-to-front so earlier offsets stay valid. */
function annotateInjectedParams(source: string, serviceTypeMap: Record<string, string>): string {
  const sf = ts.createSourceFile("w.js", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const inserts: Array<{ pos: number; text: string }> = [];
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)) {
      const typed: string[] = [];
      for (const p of node.parameters) {
        const name = ts.isIdentifier(p.name) ? p.name.text : "";
        if (name && serviceTypeMap[name]) typed.push(name);
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
  for (const i of inserts) out = out.slice(0, i.pos) + i.text + out.slice(i.pos);
  return out;
}

// Browser/AngularJS ambient globals so a controller referencing them isn't a
// "cannot find name" false positive. Intentionally `any` — we only want to check
// the SOAR service contract, not re-type the whole platform.
const GLOBALS_DTS =
  "declare var angular: any; declare var _: any; declare var moment: any; " +
  "declare var $: any; declare var jQuery: any; declare var CyberSponse: any;";

/* --- Phase 3 noise-scoping -------------------------------------------------
   checkJs over hand-written AngularJS is noisy: unknown locals (TS18046),
   3rd-party globals like window.monaco (TS2339 on Window), untyped
   object-literal access (TS2339 on {}), and local-helper arity (TS2554). We
   only want diagnostics that pertain to a SOAR platform-service contract. For
   each diagnostic we walk to its AST node and keep it ONLY if the expression's
   type — or the enclosing call's resolved signature — resolves to a declaration
   inside the `Soar` namespace (equivalently, inside soar-platform.d.ts).

   Three diagnostic shapes are covered:
     • TS2339/TS2551 property-doesn't-exist → the accessed object is a Soar.* svc
     • TS2554 wrong arity               → the call's resolved signature is Soar.*
     • TS2345 wrong arg type            → the enclosing call's signature is Soar.*
   The classic executeConnectorAction(..., null, ...) null-config bug is a
   TS2345 whose enclosing call resolves to Soar.ConnectorService, so it survives. */

function findAncestor<T extends ts.Node>(node: ts.Node, test: (n: ts.Node) => n is T): T | undefined {
  let n: ts.Node | undefined = node;
  while (n) { if (test(n)) return n; n = n.parent; }
  return undefined;
}

// Smallest node whose span contains `pos` (token-accurate, public API only —
// ts.getTouchingToken is internal). Deepest match along the single containing
// branch wins.
function nodeAtPosition(sf: ts.SourceFile, pos: number): ts.Node | undefined {
  let best: ts.Node | undefined;
  const visit = (n: ts.Node): void => {
    if (pos < n.getStart(sf) || pos > n.getEnd()) return;
    best = n;
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return best;
}

// True if `decl` lives inside the `Soar` namespace — by namespace name or by
// source file (every Soar declaration is in the virtual soar-platform.d.ts).
function isSoarDeclaration(decl: ts.Node): boolean {
  let n: ts.Node | undefined = decl;
  while (n) {
    const sf = n.getSourceFile();
    if (sf && sf.fileName === "soar-platform.d.ts") return true;
    if (ts.isModuleDeclaration(n) && n.name.text === "Soar") return true;
    n = n.parent;
  }
  return false;
}

// True if `type` (or any union/intersection constituent) is a Soar.* interface.
function isSoarType(type: ts.Type): boolean {
  const parts = type.isUnionOrIntersection() ? type.types : [type];
  for (const t of parts) {
    const sym = t.symbol || t.aliasSymbol;
    if (sym && sym.declarations && sym.declarations.some(isSoarDeclaration)) return true;
  }
  return false;
}

// The heart of the noise filter: does this diagnostic pertain to a Soar contract?
function diagnosticResolvesToSoar(checker: ts.TypeChecker, d: ts.Diagnostic): boolean {
  if (!d.file || d.start == null) return false;
  const node = nodeAtPosition(d.file, d.start);
  if (!node) return false;

  // 1. Enclosing call — arity (TS2554) + argument-type (TS2345) errors. The
  //    call's resolved signature points back at the declaring service method;
  //    failing that, the callee's owner object may itself be a Soar service.
  const call = findAncestor(node, ts.isCallExpression);
  if (call) {
    const sig = checker.getResolvedSignature(call);
    const decl = sig && sig.getDeclaration();
    if (decl && isSoarDeclaration(decl)) return true;
    const tgt = call.expression;
    const owner = ts.isPropertyAccessExpression(tgt) ? tgt.expression : tgt;
    if (isSoarType(checker.getTypeAtLocation(owner))) return true;
  }

  // 2. Property access — property-doesn't-exist (TS2339/TS2551). The object
  //    being accessed is the Soar service; the bad property hangs off it.
  const pa = findAncestor(node, ts.isPropertyAccessExpression);
  if (pa && isSoarType(checker.getTypeAtLocation(pa.expression))) return true;

  // 3. Fallback — the expression itself is a Soar-typed identifier.
  if (isSoarType(checker.getTypeAtLocation(node))) return true;

  return false;
}

function scopeDiagnosticsToSoar(checker: ts.TypeChecker, diags: ts.Diagnostic[]): ts.Diagnostic[] {
  return diags.filter((d) => diagnosticResolvesToSoar(checker, d));
}

/* Type-check one widget controller against the SOAR platform types. Returns
   diagnostics located in the widget file only (lib/dts diagnostics are dropped).
   With `soarOnly`, only diagnostics resolving to a Soar.* contract survive —
   the noise-scoped set that the ship-verify gate runs on. */
function typecheckWidget(opts: {
  source: string;
  fileName?: string;
  serviceTypeMap?: Record<string, string>;
  soarOnly?: boolean;
}): TypeDiag[] {
  const fileName = opts.fileName || "widget.js";
  const map = opts.serviceTypeMap || buildServiceTypeMap();
  const annotated = annotateInjectedParams(opts.source, map);

  const options: ts.CompilerOptions = {
    allowJs: true, checkJs: true, noEmit: true,
    strict: true, noImplicitAny: false, // keep strictNullChecks; silence untyped-any noise
    target: ts.ScriptTarget.ES2017, lib: ["lib.es2020.d.ts", "lib.dom.d.ts"],
    types: [], skipLibCheck: true,
  };
  const virtual: Record<string, string> = {
    [fileName]: annotated,
    "soar-platform.d.ts": fs.readFileSync(DTS_PATH, "utf8"),
    "soar-globals.d.ts": GLOBALS_DTS,
  };
  const host = ts.createCompilerHost(options);
  const origGetSource = host.getSourceFile.bind(host);
  host.getSourceFile = (name, langVersion, onErr) => {
    const v = virtual[name];
    if (v != null) return ts.createSourceFile(name, v, langVersion, true, name.endsWith(".js") ? ts.ScriptKind.JS : ts.ScriptKind.TS);
    return origGetSource(name, langVersion, onErr);
  };
  const origReadFile = host.readFile.bind(host);
  host.readFile = (n) => (virtual[n] != null ? virtual[n] : origReadFile(n));
  const origFileExists = host.fileExists.bind(host);
  host.fileExists = (n) => virtual[n] != null || origFileExists(n);

  const program = ts.createProgram(Object.keys(virtual), options, host);
  const checker = program.getTypeChecker();
  let diags = ts.getPreEmitDiagnostics(program)
    .filter((d) => d.file && d.file.fileName === fileName);
  if (opts.soarOnly) diags = scopeDiagnosticsToSoar(checker, diags);
  return diags.map((d) => ({
    code: d.code,
    message: ts.flattenDiagnosticMessageText(d.messageText, "\n"),
    line: d.file && d.start != null ? d.file.getLineAndCharacterOfPosition(d.start).line + 1 : undefined,
  }));
}

const api = {
  buildServiceTypeMap,
  annotateInjectedParams,
  typecheckWidget,
  // Exported for targeted testing of the noise filter itself.
  isSoarType,
  isSoarDeclaration,
  diagnosticResolvesToSoar,
  scopeDiagnosticsToSoar,
};
export = api;
