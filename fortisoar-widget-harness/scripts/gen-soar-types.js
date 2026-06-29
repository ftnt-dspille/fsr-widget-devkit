"use strict";
/* gen-soar-types.ts — generate `lib/soar-platform.d.ts` (+ a machine-readable
   `lib/soar-services.generated.json`) from the FortiSOAR widget Service API docs.

   PRIMARY SOURCE: the public contenthub ngdoc site, which is authoritative for
   *which services exist and what their methods are* (typed params + returns):
     https://fortisoar.contenthub.fortinet.com/widgetServiceAPI
   It serves a static manifest (js/docs-setup.js) + one partial per service
   (partials/api/fortisoar.<svc>.html). We parse those, not the SPA.

   CROSS-CHECK: the local SOAR bundle (fsr_src/app.unmin.js) is ground truth for
   what actually registers at runtime. We diff the documented service names
   against the bundle's registrations and log drift (doc-only = possibly stale;
   bundle-only = undocumented-but-real). The bundle is Fortinet-proprietary and
   NOT redistributed, so only the contenthub-derived output is committed.

   Run: pnpm gen-types   (or: node scripts/gen-soar-types.js)
   See TYPESCRIPT_STATIC_ANALYSIS_PLAN.md Phase 2. */
const fs = require("fs");
const path = require("path");
const HU = require("../lib/harnessUtils");
const VERSION = "8.0.0"; // FortiSOAR doc version these types were pulled from.
const BASE = "https://fortisoar.contenthub.fortinet.com/widgetServiceAPI";
async function fetchText(url) {
    const res = await fetch(url);
    if (!res.ok)
        throw new Error(`${res.status} ${res.statusText} for ${url}`);
    return res.text();
}
/* docs-setup.js is `NG_DOCS={...};` — slice the JSON object out and parse it. */
function parseManifest(js) {
    const start = js.indexOf("{");
    const end = js.lastIndexOf("}");
    if (start < 0 || end < 0)
        throw new Error("docs-setup.js: no JSON object found");
    const obj = JSON.parse(js.slice(start, end + 1));
    return (obj.pages || [])
        .filter((p) => p.type === "service" && !p.isDeprecated)
        .map((p) => ({ id: p.id, shortDescription: p.shortDescription }));
}
/* "fortisoar.services:PagedCollection" -> inject "PagedCollection".
   "fortisoar.appModulesService"        -> inject "appModulesService". */
function injectName(id) {
    const tail = id.replace(/^fortisoar\./, "");
    const afterColon = tail.includes(":") ? tail.slice(tail.lastIndexOf(":") + 1) : tail;
    return afterColon;
}
function ifaceName(inject) {
    return inject.charAt(0).toUpperCase() + inject.slice(1);
}
/* Map a SOAR ngdoc type (from the `type-hint-<x>` class) to a TS type. */
function tsType(hint) {
    switch ((hint || "").toLowerCase()) {
        case "string": return "string";
        case "boolean": return "boolean";
        case "number": return "number";
        case "array": return "unknown[]";
        case "object": return "object";
        case "promise": return "Promise<unknown>";
        case "function": return "(...args: unknown[]) => unknown";
        case "date": return "Date";
        default: return "unknown";
    }
}
function stripTags(s) {
    return s.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").trim();
}
/* Parse one service partial into typed methods. The markup is regular:
   <h3 id="methods_NAME">SIG</h3> ... [<h5 id="methods_NAME_parameters">...table...</h5>]
   [<h5 id="methods_NAME_returns">...table...</h5>]. Param rows carry a
   `type-hint-<x>` class and an optional `(optional)` marker. */
function parsePartial(html) {
    var _a, _b;
    const descM = html.match(/<h2 id="description">[\s\S]*?<div class="description">([\s\S]*?)<\/div>\s*<\/div>/);
    const description = descM ? stripTags(descM[1]).replace(/\s+/g, " ").slice(0, 200) : "";
    const methods = [];
    // Split into per-method chunks at each method h3.
    const parts = html.split(/<h3 id="methods_/).slice(1);
    for (const chunk of parts) {
        const head = chunk.match(/^([A-Za-z0-9_$]+)">\s*([^<]*)<\/h3>/);
        if (!head)
            continue;
        const sig = head[2];
        // Take the method name from the SIGNATURE (real casing) — the `id`
        // attribute (head[1]) is lowercased by ngdoc.
        const name = (sig.match(/^([A-Za-z0-9_$]+)/) || [])[1] || head[1];
        const iParams = chunk.indexOf('_parameters"');
        const iReturns = chunk.indexOf('_returns"');
        const paramsHtml = iParams >= 0 ? chunk.slice(iParams, iReturns >= 0 ? iReturns : undefined) : "";
        const returnsHtml = iReturns >= 0 ? chunk.slice(iReturns) : "";
        const params = [];
        if (paramsHtml) {
            const rows = paramsHtml.match(/<tr>[\s\S]*?<\/tr>/g) || [];
            for (const row of rows) {
                if (row.includes("<th>"))
                    continue; // header row
                const cells = row.match(/<td>([\s\S]*?)<\/td>/g) || [];
                if (cells.length < 2)
                    continue;
                const nameCell = (_a = cells[0]) !== null && _a !== void 0 ? _a : "";
                const pName = (stripTags(nameCell).match(/^([A-Za-z0-9_$]+)/) || [])[1];
                if (!pName)
                    continue;
                const optional = /\(optional\)/i.test(nameCell);
                const hint = (((_b = cells[1]) !== null && _b !== void 0 ? _b : "").match(/type-hint-([a-z]+)/i) || [])[1] || "";
                params.push({ name: pName, type: tsType(hint), optional });
            }
        }
        else if (/\(.+\)/.test(sig)) {
            // No param table but the signature lists names — emit them untyped.
            const inner = sig.slice(sig.indexOf("(") + 1, sig.lastIndexOf(")"));
            for (const raw of inner.split(",").map((s) => s.trim()).filter(Boolean)) {
                const pName = (raw.match(/^([A-Za-z0-9_$]+)/) || [])[1];
                if (pName)
                    params.push({ name: pName, type: "unknown", optional: false });
            }
        }
        // TS forbids a required param after an optional one — normalize trailing.
        let seenOpt = false;
        for (const p of params) {
            if (p.optional)
                seenOpt = true;
            else if (seenOpt)
                p.optional = true;
        }
        const retHint = (returnsHtml.match(/type-hint-([a-z]+)/i) || [])[1] || "";
        methods.push({ name, params, returns: returnsHtml ? tsType(retHint) : "void" });
    }
    return { description, methods };
}
// ── Curated overlay ──────────────────────────────────────────────────────
// The contenthub ngdoc corpus does not document every real method, and never
// records which injected services are CONSTRUCTORS. Without this, Phase 3's
// checkJs pass emits false positives on real platform usage:
//   - `new Entity(...)`/`new Query(...)` → TS2351 "no construct signatures"
//   - `playbookService.getTriggerStep(...)`, `settingsService.set(...)`,
//     `Modules.get(...)` → TS2339 "property does not exist"
// All verified against fsr_src/app.unmin.js. Kept here (not hand-edited into the
// generated .d.ts) so it survives `pnpm gen-types`. Add to it when a NEW
// undocumented-but-real SOAR API trips a widget type-check; do NOT add an index
// signature (it would suppress genuine bad-method-name catches — the headline win).
// Services injected as a constructor function: the injected token itself is
// `new`-able. The instance is `any` on purpose — Entity/Query/PagedCollection
// instances are richly dynamic (`entity.fields.name.value`,
// `pc.list/keyPairs/visited`, runtime-shaped records) and modelling them
// half-way turns every legitimate field access into a TS2339/TS18046 false
// positive. Returning `any` stops that cascade; the documented instance methods
// stay in the interface as reference. (Re-tighten if/when instance shapes get
// modelled — Phase 4.)
const CONSTRUCTABLE = new Set(["Entity", "Query", "PagedCollection", "Field"]);
// iface -> extra method declarations (real, undocumented). Permissive where the
// shape is an escape hatch ($resource wrappers return objects carrying $promise,
// hence `any`); typed where the doc-style shape is known.
const EXTRA_METHODS = {
    // playbookService — execution helpers used by grid/action widgets.
    PlaybookService: [
        "getTriggerStep(playbook: object): any;",
        "getExecutedPlaybookLogData(...args: unknown[]): Promise<unknown>;",
        "checkPlaybookExecutionCompletion(...args: unknown[]): Promise<unknown>;",
    ],
    // settingsService — `get` is documented; `set` (PUT user_settings/current/<key>) is not.
    SettingsService: ["set(key: string, value: unknown): Promise<unknown>;"],
    // Modules — "wrapper for ng.$resource"; only `save` is documented. The
    // $resource verbs return resource objects carrying `$promise`.
    Modules: [
        "get(...args: unknown[]): any;",
        "query(...args: unknown[]): any;",
        "update(...args: unknown[]): any;",
        "remove(...args: unknown[]): any;",
        "delete(...args: unknown[]): any;",
    ],
    FormEntityService: ["submitField(field: unknown): Promise<unknown>;"],
};
function emitDts(services) {
    const L = [];
    L.push("// AUTO-GENERATED by scripts/gen-soar-types.ts — DO NOT EDIT BY HAND.");
    L.push(`// Source: FortiSOAR widgetServiceAPI contenthub docs (v${VERSION}).`);
    L.push("// Regenerate: pnpm gen-types   (cross-checked against fsr_src/app.unmin.js)");
    L.push("//");
    L.push("// These ambient declarations type the SOAR platform services a widget may");
    L.push("// inject. Used by the harness's own TS and (Phase 3) by an opt-in checkJs");
    L.push("// pass over widget source. Param NAMES come from the docs; types are the");
    L.push("// documented ngdoc types mapped to TS (unknown where undocumented).");
    L.push("// A curated overlay (CONSTRUCTABLE / EXTRA_METHODS in the generator) adds");
    L.push("// real construct signatures + undocumented methods — marked `// [overlay]`.");
    L.push("");
    L.push("declare namespace Soar {");
    for (const s of services) {
        const extras = EXTRA_METHODS[s.iface] || [];
        const constructable = CONSTRUCTABLE.has(s.iface);
        const isEmpty = s.methods.length === 0 && extras.length === 0 && !constructable;
        if (s.description)
            L.push(`  /** ${s.description} */`);
        L.push(`  interface ${s.iface} {`);
        if (isEmpty) {
            L.push("    // No methods documented for this service.");
            L.push("    [key: string]: unknown;");
        }
        if (constructable) {
            L.push(`    new (...args: unknown[]): any; // [overlay] injected as a constructor; instance is dynamic`);
        }
        for (const m of s.methods) {
            const ps = m.params
                .map((p) => `${p.name}${p.optional ? "?" : ""}: ${p.type}`)
                .join(", ");
            L.push(`    ${m.name}(${ps}): ${m.returns};`);
        }
        for (const decl of extras) {
            L.push(`    ${decl} // [overlay] real, undocumented`);
        }
        L.push("  }");
    }
    L.push("");
    L.push("  /** Maps the name a widget injects -> that service's interface. */");
    L.push("  interface ServiceMap {");
    for (const s of services)
        L.push(`    ${/^[A-Za-z_$][\w$]*$/.test(s.inject) ? s.inject : JSON.stringify(s.inject)}: ${s.iface};`);
    L.push("  }");
    L.push("}");
    L.push("");
    return L.join("\n");
}
function bundlePath() {
    for (const d of [path.resolve(__dirname, "..", "..", "fsr_src"), path.resolve(__dirname, "..", "fsr_src")]) {
        const p = path.join(d, "app.unmin.js");
        if (fs.existsSync(p))
            return p;
    }
    return null;
}
async function main() {
    console.log(`▸ fetching service manifest from contenthub (v${VERSION})…`);
    const manifest = parseManifest(await fetchText(`${BASE}/js/docs-setup.js`));
    console.log(`  ${manifest.length} services documented`);
    const services = [];
    await Promise.all(manifest.map(async (entry) => {
        const inject = injectName(entry.id);
        try {
            // The partial filename replaces the ngdoc `:` segment separator with `.`
            // (e.g. fortisoar.services:PagedCollection -> …services.PagedCollection.html).
            const partialId = entry.id.replace(/:/g, ".");
            const html = await fetchText(`${BASE}/partials/api/${partialId}.html`);
            const { description, methods } = parsePartial(html);
            services.push({ id: entry.id, inject, iface: ifaceName(inject), description, methods });
        }
        catch (e) {
            console.warn(`  ! ${entry.id}: ${e.message} — emitting empty interface`);
            services.push({ id: entry.id, inject, iface: ifaceName(inject), description: entry.shortDescription || "", methods: [] });
        }
    }));
    services.sort((a, b) => a.inject.localeCompare(b.inject));
    const methodCount = services.reduce((n, s) => n + s.methods.length, 0);
    console.log(`  parsed ${services.length} services, ${methodCount} methods`);
    // Cross-check against the runtime bundle (logged only; not committed).
    const bp = bundlePath();
    if (bp) {
        const bundleNames = new Set(HU.parseRegisteredServices(fs.readFileSync(bp, "utf8")));
        const docOnly = services.map((s) => s.inject).filter((n) => !bundleNames.has(n));
        console.log(`▸ bundle cross-check (${bp}):`);
        console.log(`  ${services.filter((s) => bundleNames.has(s.inject)).length}/${services.length} documented services found in app.unmin.js`);
        if (docOnly.length)
            console.log(`  doc-only (not matched in bundle — verify naming/staleness): ${docOnly.join(", ")}`);
    }
    else {
        console.log("▸ no fsr_src/app.unmin.js on disk — skipping bundle cross-check");
    }
    const libDir = path.resolve(__dirname, "..", "lib");
    const dtsPath = path.join(libDir, "soar-platform.d.ts");
    const jsonPath = path.join(libDir, "soar-services.generated.json");
    fs.writeFileSync(dtsPath, emitDts(services), "utf8");
    fs.writeFileSync(jsonPath, JSON.stringify({ version: VERSION, services }, null, 2) + "\n", "utf8");
    console.log(`✓ wrote ${path.relative(process.cwd(), dtsPath)}`);
    console.log(`✓ wrote ${path.relative(process.cwd(), jsonPath)} (machine model for lint rules)`);
}
if (require.main === module) {
    main().catch((e) => { console.error("✗", e); process.exit(1); });
}
module.exports = { parseManifest, parsePartial, injectName, ifaceName, tsType, emitDts };
