/* Pure utilities used by the harness page. Kept dependency-free so they can
   run in both the browser (loaded via <script>) and Node (jest tests). */

type StateContext = 'viewpanel' | 'drawer' | 'dashboard';

interface SuggestedScriptTag {
  src: string;
  tag: string;
  target: string;
}

interface LintIssue {
  code: string;
  message: string;
  file?: string;
  fixable?: boolean;
  // controller-mismatch fields
  expected?: string;
  registered?: string[];
  // harness-only-stub fields
  masked?: string[];
  suggestedScriptTags?: SuggestedScriptTag[];
  // unknown-dependency fields
  unknown?: string[];
}

interface LintResult {
  errors: LintIssue[];
  warnings: LintIssue[];
}

interface LintOpts {
  info?: Record<string, unknown>;
  files?: Record<string, string | null>;
  requiredFiles?: string[];
  registeredServices?: string[];
  harnessStubbedServices?: string[];
  widgetLocalServices?: string[];
  widgetAssetServiceMap?: Record<string, string>;
  staleVersionRefs?: Array<{ file: string; staleVersions: string[] }>;
  viewControllers?: string[];
  editControllers?: string[];
}

/* Resolve a dotted path against an object: resolvePath(rec, "source.host") -> rec.source.host.
   Returns undefined if any segment is missing. Supports numeric segments for arrays. */
function resolvePath(obj: unknown, path: string): unknown {
  if (obj == null || typeof path !== "string" || path === "") return undefined;
  const parts = path.split(".");
  let cur: any = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

/* Derive the dev controller name SOAR widgets register under. Mirrors the
   convention enforced by the packager: <name><digitsOfVersion>DevCtrl. */
function deriveControllerName(name: string, version: unknown): string {
  if (!name) throw new Error("deriveControllerName: missing name");
  const digits = String(version || "").split(".").join("");
  return `${name}${digits}DevCtrl`;
}

/* Edit controllers follow SOAR's `edit<CapitalizedName><digits>DevCtrl`
   convention — see e.g. editJinjaEditorWidget113DevCtrl. */
function deriveEditControllerName(name: string, version: unknown): string {
  if (!name) throw new Error("deriveEditControllerName: missing name");
  const digits = String(version || "").split(".").join("");
  const cap = name.charAt(0).toUpperCase() + name.slice(1);
  return `edit${cap}${digits}DevCtrl`;
}

/* Merge a saved config over the widget's declared defaults. Saved values
   win; both inputs may be null/undefined. Always returns an object. */
function mergeConfig(defaults: Record<string, unknown> | null | undefined, saved: Record<string, unknown> | null | undefined): Record<string, unknown> {
  return Object.assign({}, defaults || {}, saved || {});
}

/* localStorage key for a widget's saved config. Stable per widget id so
   bumping a widget's version starts fresh — matches SOAR's "config attached
   to widget instance" semantics closely enough for dev. */
function configStorageKey(widgetId: string): string {
  return `harness:config:${widgetId}`;
}

/* Build the SOAR record-fetch path used by View Panel / Drawer contexts.
   `withRelationships` mirrors the `$relationships=true` query SOAR widgets
   typically rely on for nested-field rendering. */
function recordFetchPath(module: string, id: string, withRelationships?: boolean): string {
  if (!module || !id) throw new Error("recordFetchPath: module and id required");
  const qs = withRelationships ? "?$relationships=true" : "";
  return `/api/3/${module}/${encodeURIComponent(id)}${qs}`;
}

/* Resolve a `config.mapping`-style object against a record. Each value may be:
   - a plain string ("source.host")  -> resolved by path
   - a non-string (number, bool, etc) -> returned as-is
   The result is a plain object the widget can read without re-implementing
   the path walk. Unknown paths yield `undefined`, not an error. */
function resolveMapping(mapping: Record<string, unknown> | null | undefined, record: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!mapping || typeof mapping !== "object") return out;
  for (const [key, val] of Object.entries(mapping)) {
    if (typeof val === "string") {
      const stripped = val.replace(/^record\./, "");
      out[key] = resolvePath(record, stripped);
    } else {
      out[key] = val;
    }
  }
  return out;
}

/* Build the `$state` shape expected for a given context. Used by the harness
   to replace `__HARNESS_STATE` on context switch. */
function stateForContext(ctx: StateContext, params?: Record<string, unknown>): Record<string, unknown> {
  switch (ctx) {
    case "viewpanel":
      return { current: { name: "viewPanel.modulesDetail" }, params: Object.assign({ page: "viewPanel" }, params || {}) };
    case "drawer":
      return { current: { name: "viewPanel.modulesDetail" }, params: Object.assign({ page: "viewPanel", drawer: true }, params || {}) };
    case "dashboard":
    default:
      return { current: { name: "main.dashboard" }, params: { page: "dashboard" } };
  }
}

/* Statically extract names registered with `.controller("name", ...)` from
   a controller source file. Used to detect version/controller-name drift
   before bootstrapping Angular. Dynamic names (concatenations, variables)
   are not resolved -- callers should treat an empty result as "unknown"
   rather than "missing". */
function extractRegisteredControllers(source: string): string[] {
  if (typeof source !== "string" || !source) return [];
  const out: string[] = [];
  const re = /\.controller\s*\(\s*["']([A-Za-z_$][\w$]*)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) out.push(m[1]);
  return out;
}

/* Statically extract injected service names from a controller source. Handles
   the three Angular DI forms widget code commonly uses:
     1. Ctrl.$inject = ["a", "b"];
     2. .controller("name", ["a", "b", function(a,b){}])
     3. function Ctrl(a, b) {}  + .controller("name", Ctrl)
   Returns a deduped list. Best-effort only — dynamic constructions are skipped. */
function extractInjectedDependencies(source: string): string[] {
  if (typeof source !== "string" || !source) return [];
  const seen = new Set<string>();
  const injectRe = /\.\s*\$inject\s*=\s*\[([^\]]*)\]/g;
  let m: RegExpExecArray | null;
  while ((m = injectRe.exec(source)) !== null) {
    for (const s of m[1].matchAll(/["']([^"']+)["']/g)) seen.add(s[1]);
  }
  const inlineRe = /\.controller\s*\(\s*["'][^"']+["']\s*,\s*\[([^\]]*?function)/g;
  while ((m = inlineRe.exec(source)) !== null) {
    for (const s of m[1].matchAll(/["']([^"']+)["']/g)) seen.add(s[1]);
  }
  const refRe = /\.controller\s*\(\s*["'][^"']+["']\s*,\s*([A-Za-z_$][\w$]*)\s*\)/g;
  const refs = new Set<string>();
  while ((m = refRe.exec(source)) !== null) refs.add(m[1]);
  for (const ident of refs) {
    const fnRe = new RegExp(
      "function\\s+" + ident.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&") + "\\s*\\(([^)]*)\\)",
      "g"
    );
    let fm: RegExpExecArray | null;
    while ((fm = fnRe.exec(source)) !== null) {
      for (const arg of fm[1].split(",")) {
        const a = arg.trim();
        if (a && /^[A-Za-z_$][\w$]*$/.test(a)) seen.add(a);
      }
    }
  }
  return Array.from(seen);
}

/* Parse the harness module to collect every service registered on cybersponse. */
function parseRegisteredServices(harnessSource: string): string[] {
  if (typeof harnessSource !== "string" || !harnessSource) return [];
  const out = new Set<string>();
  const re = /\.\s*(?:factory|service|value|constant|directive|provider)\s*\(\s*["']([A-Za-z_$][\w$]*)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(harnessSource)) !== null) out.add(m[1]);
  return Array.from(out);
}

const ANGULAR_BUILTINS = new Set<string>([
  "$scope", "$rootScope", "$element", "$attrs", "$transclude",
  "$http", "$q", "$timeout", "$interval", "$window", "$document", "$location",
  "$compile", "$injector", "$log", "$filter", "$parse", "$sce", "$controller",
  "$exceptionHandler", "$animate", "$cacheFactory", "$templateCache",
  "$templateRequest", "$rootElement", "$anchorScroll", "$interpolate", "$stateParams",
  // Vendor-provided but always present in SOAR's bundle (ui.router, ui.bootstrap):
  "$state", "$uibModal", "$uibModalStack",
  // SOAR injects these as $controller `locals` (not as registered services)
  // when it instantiates a widget controller / opens an edit modal. The
  // harness also registers them as factories so its own bootstrap works,
  // which makes them look harness-only — they're not, they're real locals.
  "config", "$uibModalInstance",
  // Third-party vendor modules that ship with SOAR but live outside
  // app.unmin.js (loaded via separate <script> tags on the SOAR page).
  "toaster",
]);

/* Detect data-ng-controller / ng-controller on the view.html root element.
   See soar_widget_text_interpolation_stripped.md — SOAR's publish step strips
   `Dev` from the attribute value and we end up with two parallel scopes. */
function rootNgControllerError(viewHtmlSource: string): string | null {
  if (typeof viewHtmlSource !== "string" || !viewHtmlSource) return null;
  const stripped = viewHtmlSource.replace(/<!--[\s\S]*?-->/g, "");
  const m = stripped.match(/<\s*([a-zA-Z][\w-]*)\b([^>]*)>/);
  if (!m) return null;
  if (/\b(data-)?ng-controller\b/.test(m[2] || "")) {
    return `view.html root <${m[1]}> has ng-controller — collides with the controller injected by the harness/SOAR`;
  }
  return null;
}

/* Pure lint pass over a widget's in-memory state. Inputs: parsed info.json,
   a map of filename->source, and pre-computed metadata. Returns
   { errors, warnings } where each issue is { code, message, file?, fixable? }. */
function lintWidget(opts?: LintOpts): LintResult {
  const {
    info,
    files = {},
    requiredFiles = ["info.json", "view.html", "edit.html", "view.controller.js", "edit.controller.js"],
    registeredServices = [],
    harnessStubbedServices = [],
    widgetLocalServices = [],
    widgetAssetServiceMap = {},
    staleVersionRefs = [],
    viewControllers = [],
    editControllers = [],
  } = opts || {};

  const errors: LintIssue[] = [];
  const warnings: LintIssue[] = [];

  if (!info || typeof info !== "object") {
    errors.push({ code: "info-missing", message: "info.json missing or unparseable" });
    return { errors, warnings };
  }
  if (!info.name) errors.push({ code: "info-name", message: "info.json missing 'name'" });
  if (!info.version) errors.push({ code: "info-version", message: "info.json missing 'version'" });
  else if (!/^\d+(\.\d+){0,2}$/.test(String(info.version)))
    errors.push({ code: "info-version-format", message: `info.json version '${info.version}' is not numeric` });
  if (!info.title) warnings.push({ code: "info-title", message: "info.json missing 'title'" });

  for (const f of requiredFiles) {
    if (f === "info.json") continue;
    if (!(f in files) || files[f] == null) {
      errors.push({ code: "file-missing", message: `required file missing: ${f}`, file: f });
    }
  }

  if (info.name && info.version) {
    const expectedView = deriveControllerName(String(info.name), info.version);
    const expectedEdit = deriveEditControllerName(String(info.name), info.version);
    if (viewControllers.length > 0 && !viewControllers.includes(expectedView)) {
      errors.push({
        code: "controller-mismatch",
        file: "view.controller.js",
        message: `view.controller.js registers ${viewControllers.join(", ")}, expected ${expectedView}`,
        expected: expectedView, registered: viewControllers, fixable: true,
      });
    }
    if (editControllers.length > 0 && !editControllers.includes(expectedEdit)) {
      errors.push({
        code: "edit-controller-mismatch",
        file: "edit.controller.js",
        message: `edit.controller.js registers ${editControllers.join(", ")}, expected ${expectedEdit}`,
        expected: expectedEdit, registered: editControllers, fixable: true,
      });
    }
  }

  for (const r of staleVersionRefs) {
    errors.push({
      code: "stale-version-ref",
      file: r.file,
      message: `${r.file} references stale version(s): ${r.staleVersions.join(", ")} (info.json is ${info.version})`,
      fixable: true,
    });
  }

  if (files["view.html"]) {
    const rootErr = rootNgControllerError(files["view.html"] || "");
    if (rootErr) errors.push({ code: "root-ng-controller", file: "view.html", message: rootErr });
  }

  const realProviders = new Set<string>([
    ...ANGULAR_BUILTINS,
    ...registeredServices,
    ...widgetLocalServices,
  ]);
  const harnessOnly = new Set(
    harnessStubbedServices.filter((n) => !realProviders.has(n))
  );
  const checkDeps = (file: string) => {
    const src = files[file];
    if (!src) return;
    const deps = extractInjectedDependencies(src);
    const masked = deps.filter((d) => harnessOnly.has(d));
    const unknown = deps.filter(
      (d) => !realProviders.has(d) && !harnessOnly.has(d)
    );
    if (masked.length > 0) {
      const targetTpl = file === "edit.controller.js" ? "edit.html" : "view.html";
      const tags: Array<{ dep: string; src: string; tag: string }> = [];
      const noFix: string[] = [];
      const seenSrc = new Set<string>();
      for (const dep of masked) {
        const depSrc = widgetAssetServiceMap[dep];
        if (depSrc) {
          const tag = `<script src="${depSrc}"></script>`;
          if (!seenSrc.has(depSrc)) { seenSrc.add(depSrc); tags.push({ dep, src: depSrc, tag }); }
        } else {
          noFix.push(dep);
        }
      }
      let message =
        `${file} injects ${masked.join(", ")}, which only exists as a stub in harness.module.js. ` +
        `In SOAR these resolve to nothing — the controller will fail with "Unknown provider" and the modal/widget will not render.`;
      if (tags.length > 0) {
        message +=
          `\n\nFix: paste the following into ${targetTpl} ` +
          `(near the bottom of the file, before EOF) so SOAR loads the factory before the controller boots:\n` +
          tags.map((t) => "  " + t.tag).join("\n");
      }
      if (noFix.length > 0) {
        message +=
          `\n\nNo widgetAssets file registers ${noFix.join(", ")} — ship the real implementation ` +
          `as a <script>-tagged widgetAssets/*.js file, or remove the dependency.`;
      }
      errors.push({
        code: "harness-only-stub",
        file,
        message,
        masked,
        suggestedScriptTags: tags.map((t) => ({ src: t.src, tag: t.tag, target: targetTpl })),
      });
    }
    if (unknown.length > 0) {
      errors.push({
        code: "unknown-dependency",
        file,
        message: `${file} injects services not registered anywhere: ${unknown.join(", ")}. Add a stub to harness.module.js, or ship a widgetAssets file that registers it (the harness auto-loads everything under widgetAssets/).`,
        unknown,
      });
    }
  };
  checkDeps("view.controller.js");
  checkDeps("edit.controller.js");

  return { errors, warnings };
}

const api = {
  resolvePath,
  deriveControllerName,
  deriveEditControllerName,
  extractRegisteredControllers,
  extractInjectedDependencies,
  parseRegisteredServices,
  rootNgControllerError,
  lintWidget,
  ANGULAR_BUILTINS,
  mergeConfig,
  configStorageKey,
  recordFetchPath,
  resolveMapping,
  stateForContext,
};

if (typeof window !== "undefined") {
  (window as any).HarnessUtils = api;
}

export = api;
