#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Live widget-render introspection rig (Phase 1 of the introspection plan).
 *
 * Boots each discovered widget in headless Chromium against the running dev
 * harness and emits a structured RenderReport per widget: resource profile
 * (sizes/timing/duplicates/eager-editor bundles), boot timeline, correctness
 * signals (console errors/warnings via the in-page __harness drawer buffers),
 * and whether the widget actually mounted.
 *
 *   node scripts/introspect.js                 # all widgets
 *   node scripts/introspect.js helloCounter    # one (matched by id or name)
 *   HARNESS_URL=http://localhost:4401 node scripts/introspect.js
 *
 * Writes JSON reports to introspection-reports/<id>.json and prints a summary +
 * a cross-cutting findings list. Diffs against introspection-baseline/<id>.json
 * when a baseline exists.
 *
 * Methodology notes baked in (see docs/INTROSPECTION_OPTIMIZATION_PLAN.md):
 *  - NEVER wait on networkidle: the harness holds an SSE channel open for the
 *    debug drawer, so network idle is unreachable. We use a DOM mount sentinel.
 *  - Boot-timeline marks beyond DCL and runtime stub-hit counts are populated
 *    once index.html / harness.module are instrumented (later sub-phase); until
 *    then those fields stay undefined rather than guessed.
 */
const fs = require("fs");
const path = require("path");
const test_1 = require("@playwright/test");
const HARNESS_URL = process.env.HARNESS_URL || "http://localhost:4401";
const MOUNT_TIMEOUT_MS = Number(process.env.INTROSPECT_MOUNT_TIMEOUT_MS || 20000);
const SETTLE_MS = Number(process.env.INTROSPECT_SETTLE_MS || 1500);
const REPORT_DIR = path.resolve(__dirname, "..", "introspection-reports");
const BASELINE_DIR = path.resolve(__dirname, "..", "introspection-baseline");
// Each bundle names the cap that legitimizes it: if the widget declares that
// capability, eager bytes are expected; otherwise they're a lazy-load leak.
const EDITOR_BUNDLES = [
    { key: "monaco", match: /monaco-editor/i, cap: "monaco" },
    { key: "tinymce", match: /tinymce|toastui|dompurify/i, cap: "editors" },
];
function classifyResource(name, initiatorType) {
    if (/\.js(\?|$)/.test(name) || initiatorType === "script")
        return "script";
    if (/\.css(\?|$)/.test(name) || initiatorType === "link")
        return "css";
    if (/\.(woff2?|ttf|otf|eot)(\?|$)/.test(name))
        return "font";
    if (/\.(png|jpe?g|gif|svg|webp|ico)(\?|$)/.test(name))
        return "image";
    if (initiatorType === "fetch" || initiatorType === "xmlhttprequest")
        return "fetch";
    return "other";
}
async function fetchWidgets(browser) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const resp = await page.goto(`${HARNESS_URL}/_fsr/widgets`, { waitUntil: "domcontentloaded" });
    const body = (await resp.json());
    await ctx.close();
    return body.widgets || [];
}
async function introspectWidget(browser, widget) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    // Drive selection + bypass the config gate deterministically, before any
    // page script runs:
    //  - localStorage["harness.widget"] selects the widget at boot.
    //  - localStorage["harness:config:<id>"] (configStorageKey) must be non-null
    //    or the harness shows "configure to preview" and never mounts. mergeConfig
    //    supplies module/title/wid defaults, so a minimal saved config is enough
    //    to reach a real mounted render (a widget that still throws inside its
    //    controller is a genuine finding, not a rig artifact).
    await page.addInitScript((id) => {
        try {
            window.localStorage.setItem("harness.widget", id);
            const cfgKey = `harness:config:${id}`;
            if (!window.localStorage.getItem(cfgKey)) {
                window.localStorage.setItem(cfgKey, JSON.stringify({ module: "alerts" }));
            }
        }
        catch (_) { }
    }, widget.id);
    const consoleErrors = [];
    let warningCount = 0;
    page.on("console", (msg) => {
        const t = msg.type();
        if (t === "error")
            consoleErrors.push(msg.text().slice(0, 240));
        else if (t === "warning")
            warningCount++;
    });
    page.on("pageerror", (e) => consoleErrors.push(`[pageerror] ${e.message}`.slice(0, 240)));
    const t0 = Date.now();
    // domcontentloaded only — never networkidle (SSE channel stays open).
    await page.goto(`${HARNESS_URL}/`, { waitUntil: "domcontentloaded", timeout: MOUNT_TIMEOUT_MS }).catch(() => { });
    // Mount sentinel: the widget bootstraps into #widget-host. Settle until the
    // host either renders an Angular subtree (mounted) or the harness's
    // "configure to preview" gate (config-prompt) — both are terminal states.
    try {
        await page.waitForFunction(() => {
            const host = document.getElementById("widget-host");
            if (!host)
                return false;
            if (host.querySelector(".harness-config-prompt"))
                return true;
            return !!host.querySelector(".ng-scope") && host.innerHTML.length > 200;
        }, { timeout: MOUNT_TIMEOUT_MS });
    }
    catch (_) { /* capture anyway */ }
    await page.waitForTimeout(SETTLE_MS);
    const mountState = await page.evaluate(() => {
        const host = document.getElementById("widget-host");
        if (!host)
            return "no-mount";
        if (host.querySelector(".harness-config-prompt"))
            return "config-prompt";
        if (host.querySelector(".ng-scope") && host.innerHTML.length > 200)
            return "mounted";
        return "no-mount";
    });
    const mounted = mountState === "mounted";
    const wallMs = Date.now() - t0;
    const resources = await page.evaluate(() => {
        return performance.getEntriesByType("resource").map((r) => ({
            name: r.name.replace(location.origin, ""),
            size: r.transferSize || 0,
            start: Math.round(r.startTime),
            dur: Math.round(r.duration),
            // initiatorType is refined host-side; pass it through under `type` slot.
            type: r.initiatorType || "other",
        }));
    });
    // Refine type host-side (browser eval can't see our classifier helper).
    for (const r of resources)
        r.type = classifyResource(r.name, r.type);
    const boot = await page.evaluate(() => {
        const n = performance.getEntriesByType("navigation")[0];
        const markAt = (name) => {
            const m = performance.getEntriesByName("harness:" + name, "mark")[0];
            return m ? Math.round(m.startTime) : undefined;
        };
        return {
            domContentLoaded: Math.round((n === null || n === void 0 ? void 0 : n.domContentLoadedEventEnd) || 0),
            appUnmin: markAt("appUnmin"),
            templates: markAt("templates"),
            harnessModule: markAt("harnessModule"),
            widgetServices: markAt("widgetServices"),
            controller: markAt("controller"),
            mountComplete: markAt("mountComplete"),
        };
    });
    const dump = await page.evaluate(() => {
        try {
            const w = window;
            const h = w.__harness;
            const stubHits = w.__HARNESS_STUB_HITS || {};
            const stubNames = w.__HARNESS_STUB_NAMES || [];
            return {
                errors: h ? h.errors().length : 0,
                stubHits,
                stubNames,
            };
        }
        catch (_) {
            return { errors: 0, stubHits: {}, stubNames: [] };
        }
    });
    const correctness = {
        errorCount: Math.max(dump.errors, consoleErrors.length),
        warningCount,
        consoleErrors: consoleErrors.slice(0, 12),
        sceFallbacks: 0,
    };
    // Build runtime stats with stub-hit instrumentation
    const runtime = {
        digestCount: 0,
        slowestDigestMs: 0,
        stubHits: dump.stubHits,
        templateCacheHits: 0,
        templateCacheMisses: 0,
        unresolvedProviders: [],
    };
    await ctx.close();
    const totalBytes = resources.reduce((s, r) => s + r.size, 0);
    return {
        widgetId: widget.id,
        source: "harness",
        caps: widget.caps,
        wallMs,
        totalBytes,
        resourceCount: resources.length,
        resources,
        boot,
        runtime,
        correctness,
        mounted,
        mountState,
    };
}
/** Cross-cutting findings derived from one report (the "is this optimal?" lens). */
function findings(rep) {
    const out = [];
    // Eager editor bundles — report total weight of all matching files (a bundle
    // is many requests), not just the first.
    for (const ed of EDITOR_BUNDLES) {
        const hits = rep.resources.filter((r) => ed.match.test(r.name));
        if (!hits.length)
            continue;
        const bytes = hits.reduce((s, r) => s + r.size, 0);
        const expected = rep.caps ? rep.caps[ed.cap] : true; // no caps → can't judge, don't flag as leak
        if (expected) {
            out.push(`eager ${ed.key} loaded (${kb(bytes)} across ${hits.length} files) — expected, widget declares ${ed.cap}`);
        }
        else {
            // A non-editor widget still pulled editor bytes — the lazy-load gate
            // leaked (e.g. a stylesheet manifest pulling editor.main.css). Flag loud.
            out.push(`LEAK: ${ed.key} loaded (${kb(bytes)} across ${hits.length} files) but widget does NOT declare ${ed.cap} — lazy-load gate leaked`);
        }
    }
    // Duplicate resources (same basename + same size from different paths)
    const bySig = new Map();
    for (const r of rep.resources) {
        if (r.size < 10000)
            continue;
        const sig = `${path.basename(r.name)}:${r.size}`;
        (bySig.get(sig) || bySig.set(sig, []).get(sig)).push(r);
    }
    for (const [sig, group] of bySig) {
        if (group.length > 1)
            out.push(`duplicate fetch ${sig.split(":")[0]} ×${group.length} (${kb(group[0].size)} each) from ${group.length} paths`);
    }
    // Heavy total
    if (rep.totalBytes > 6000000)
        out.push(`heavy render: ${kb(rep.totalBytes)} total across ${rep.resourceCount} resources`);
    // Font weight count
    const fonts = rep.resources.filter((r) => r.type === "font");
    if (fonts.length > 3)
        out.push(`${fonts.length} font files eagerly loaded (${kb(fonts.reduce((s, f) => s + f.size, 0))})`);
    if (rep.mountState === "config-prompt")
        out.push(`config-gated: shows "configure to preview" (rig supplied no config — not a failure)`);
    else if (rep.mountState === "no-mount")
        out.push(`NO RENDER within ${MOUNT_TIMEOUT_MS}ms — real boot/fidelity issue to investigate`);
    if (rep.correctness.errorCount > 0)
        out.push(`${rep.correctness.errorCount} console error(s) during render`);
    // Stub-hit instrumentation: report which harness stubs are exercised vs dead
    if (rep.runtime && rep.runtime.stubHits && Object.keys(rep.runtime.stubHits).length > 0) {
        const hitCount = Object.keys(rep.runtime.stubHits).length;
        // Estimate total registered stubs — we track all registered names at init
        // For now report based on what hit; a more precise count would require
        // exporting __HARNESS_STUB_NAMES length, which we can add later if needed.
        const stubHits = rep.runtime.stubHits;
        const deadStubs = ["$stomp", "websocketService", "tokenService"].filter((s) => !stubHits[s]);
        const deadList = deadStubs.length > 0 ? ` (dead: ${deadStubs.join(", ")})` : "";
        out.push(`stubs: ${hitCount} exercised${deadList}`);
    }
    return out;
}
function kb(b) {
    return b >= 1000000 ? `${(b / 1000000).toFixed(2)} MB` : `${Math.round(b / 1000)} KB`;
}
function diffBaseline(rep) {
    const bpath = path.join(BASELINE_DIR, `${rep.widgetId}.json`);
    if (!fs.existsSync(bpath))
        return null;
    try {
        const base = JSON.parse(fs.readFileSync(bpath, "utf8"));
        const dBytes = rep.totalBytes - base.totalBytes;
        const dBoot = rep.boot.domContentLoaded - base.boot.domContentLoaded;
        const sign = (n) => (n > 0 ? `+${n}` : `${n}`);
        return `vs baseline: bytes ${sign(dBytes)} (${kb(Math.abs(dBytes))}), DCL ${sign(dBoot)}ms`;
    }
    catch (_) {
        return null;
    }
}
async function main() {
    const filter = process.argv.slice(2);
    if (!fs.existsSync(REPORT_DIR))
        fs.mkdirSync(REPORT_DIR, { recursive: true });
    const browser = await test_1.chromium.launch({ headless: true });
    try {
        let widgets = await fetchWidgets(browser);
        if (filter.length) {
            widgets = widgets.filter((w) => filter.some((f) => w.id === f || w.name === f));
        }
        if (!widgets.length) {
            console.error("no widgets matched", filter.length ? filter : "(all)");
            process.exit(2);
        }
        console.log(`introspecting ${widgets.length} widget(s) against ${HARNESS_URL}\n`);
        for (const w of widgets) {
            const rep = await introspectWidget(browser, w);
            fs.writeFileSync(path.join(REPORT_DIR, `${w.id}.json`), JSON.stringify(rep, null, 2));
            const mark = rep.mounted ? "✓" : "✗";
            console.log(`${mark} ${w.id}  —  ${kb(rep.totalBytes)} / ${rep.resourceCount} res / ${rep.wallMs}ms wall / DCL ${rep.boot.domContentLoaded}ms`);
            const b = rep.boot;
            if (b.mountComplete != null) {
                console.log(`    boot: appUnmin ${b.appUnmin}ms → templates ${b.templates}ms → harnessModule ${b.harnessModule}ms → svc ${b.widgetServices}ms → ctrl ${b.controller}ms → mount ${b.mountComplete}ms`);
            }
            const diff = diffBaseline(rep);
            if (diff)
                console.log(`    ${diff}`);
            for (const f of findings(rep))
                console.log(`    • ${f}`);
            console.log("");
        }
        console.log(`reports written to ${path.relative(process.cwd(), REPORT_DIR)}/`);
    }
    finally {
        await browser.close();
    }
}
main().catch((e) => { console.error(e); process.exit(1); });
