#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Real-SOAR fidelity introspection (Phase 2 of the introspection plan).
 *
 * Renders a DEPLOYED widget on a live FortiSOAR box (WAF-safe desktop Chrome via
 * lib/soarBrowser) and captures the same RenderReport shape the harness rig
 * emits (scripts/introspect.ts), then diffs the two into a FidelityDiff. SOAR is
 * ground truth; the diff tells us where the harness render diverges — which
 * services the harness stubs that SOAR resolves for real, whether the widget
 * mounts and errors the same way, and how the resource profile compares.
 *
 *   set -a; . ./.env.159; set +a
 *   node scripts/introspectSoar.js                       # default deployed widget
 *   node scripts/introspectSoar.js fortiaiAgenticAssistant
 *
 * Writes:
 *   introspection-reports/soar/<id>.json       (source:"soar" RenderReport)
 *   introspection-reports/fidelity/<id>.json   (FidelityDiff harness↔soar)
 *
 * Scope: only widgets rendered via the record drawer are supported today — that
 * is what is actually deployed + reachable on the box. A widget with no live
 * placement is logged as skipped (no silent coverage claims). Whole-app resource
 * diffing is deliberately excluded as noise: SOAR loads its entire shell (~250
 * resources) around any widget, so the diff focuses on the widget's own assets,
 * mount/error parity, and the stub-vs-real service map.
 */
const fs = require("fs");
const path = require("path");
const soarBrowser = require("../lib/soarBrowser");
const soarEnv = require("../lib/soarEnv");
const REPORT_DIR = path.resolve(__dirname, "..", "introspection-reports");
const SOAR_DIR = path.join(REPORT_DIR, "soar");
const FIDELITY_DIR = path.join(REPORT_DIR, "fidelity");
const SETTLE_MS = Number(process.env.INTROSPECT_SETTLE_MS || 2000);
const RENDER_WAIT_MS = Number(process.env.INTROSPECT_SOAR_RENDER_MS || 10000);
// The drawer composer — same selector liveUiDriver uses as its mount sentinel.
const COMPOSER = '#custom-modal .composer textarea, #custom-modal .composer [contenteditable="true"], ' +
    '.composer textarea, .composer [contenteditable="true"], .composer input[type="text"]';
const LIVE_WIDGETS = [
    { id: "fortiaiAgenticAssistant", title: "FortiAI Agentic Assistant", module: "alerts", mode: "drawer" },
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
/** Fetch the newest alert uuid so the drawer has a record to mount on. */
async function firstRecordUuid(module) {
    // Require the compiled .js at runtime rather than importing the .ts: soarClient
    // isn't in this tsconfig's program (and has TS that only the JS build tolerates),
    // so keep it out of tsc's view.
    // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-explicit-any
    const { makeClient } = require("../tests/live/lib/soarClient");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- client shape is dynamic
    const c = await makeClient();
    const page = await c.get(`/api/3/${module}?$limit=1`);
    const rec = page && page["hydra:member"] && page["hydra:member"][0];
    const iri = rec && (rec["@id"] || rec.uuid || "");
    const uuid = String(iri).split("/").pop() || "";
    if (!uuid)
        throw new Error(`no ${module} record on the box to render a widget on`);
    return uuid;
}
/** Render one deployed widget on the box and capture a source:"soar" report. */
async function introspectSoar(lw) {
    const env = soarBrowserEnv();
    const base = soarBrowser.baseUrl(env);
    // Resolve the record FIRST (a cheap API call) so a failure here never leaves an
    // idle headed browser window open.
    const uuid = await firstRecordUuid(lw.module);
    // Force a headed, WAF-safe browser — headless is fingerprinted by the box IPS.
    const { browser, context } = await soarBrowser.launchContext({ headless: false });
    const page = await context.newPage();
    // Attach capture BEFORE any navigation so we see load-time errors, exactly
    // like the harness rig does.
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
    await soarBrowser.login(page, base, env);
    await page.goto(`${base}/modules/${lw.module}/${uuid}`, {
        waitUntil: "domcontentloaded", timeout: 60000,
    });
    await page.waitForTimeout(RENDER_WAIT_MS); // record + widgets render
    // Open the widget's drawer by its icon title (8.0 renders several drawer
    // icons), then fall back to the blind sub-block loop for older layouts.
    const titled = await page.$(`img.logo-sm[title="${lw.title}"]`);
    if (titled) {
        await titled.click().catch(() => { });
        await page.waitForTimeout(3000);
    }
    if (!(await page.$(COMPOSER))) {
        const blocks = await page.$$(".sub-block");
        for (const blk of blocks) {
            await blk.click().catch(() => { });
            await page.waitForTimeout(2500);
            if (await page.$(COMPOSER))
                break;
        }
    }
    await page.waitForTimeout(SETTLE_MS);
    const wallMs = Date.now() - t0;
    const mounted = !!(await page.$(COMPOSER));
    const mountState = mounted ? "mounted" : "no-mount";
    const resources = (await page.evaluate(() => {
        return performance.getEntriesByType("resource").map((r) => ({
            name: r.name,
            size: r.transferSize || 0,
            start: Math.round(r.startTime),
            dur: Math.round(r.duration),
            type: r.initiatorType || "other",
        }));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- evaluate returns unknown
    }));
    // Strip the host so soar/harness resource names are comparable, then classify.
    for (const r of resources) {
        r.name = r.name.replace(/^https?:\/\/[^/]+/, "");
        r.type = classifyResource(r.name, r.type);
    }
    const boot = await page.evaluate(() => {
        const n = performance.getEntriesByType("navigation")[0];
        return { domContentLoaded: Math.round((n === null || n === void 0 ? void 0 : n.domContentLoadedEventEnd) || 0) };
    });
    const correctness = {
        errorCount: consoleErrors.length,
        warningCount,
        consoleErrors: consoleErrors.slice(0, 12),
        sceFallbacks: 0,
    };
    await browser.close().catch(() => { });
    const totalBytes = resources.reduce((s, r) => s + r.size, 0);
    return {
        widgetId: lw.id,
        source: "soar",
        wallMs,
        totalBytes,
        resourceCount: resources.length,
        resources,
        boot,
        correctness,
        mounted,
        mountState,
    };
}
// soarBrowser.login/baseUrl want the resolved SoarEnvResult; resolve it from
// process.env (the caller sources .env.<box> before running).
function soarBrowserEnv() {
    return soarEnv.resolveSoarEnv();
}
/** Compare a harness report against the soar report → FidelityDiff. */
function fidelity(harness, soar) {
    const notes = [];
    const stubbedInHarness = [];
    const styleMismatches = [];
    if (!harness) {
        notes.push("no harness report on disk — run `make introspect` first for a full diff");
        return { widgetId: soar.widgetId, domMismatch: false, styleMismatches, stubbedInHarness, notes };
    }
    // Mount parity. A drawer/standalone widget renders on the box but the standard
    // introspect rig can't mount it (no drawer/entity context) — so a harness
    // "no-mount"/"config-prompt" against a SOAR "mounted" is a RIG-BASELINE GAP,
    // not a widget regression. Only call it a mismatch when the harness DID mount.
    const harnessBaselineWeak = harness.mountState !== "mounted";
    if (harnessBaselineWeak && soar.mounted) {
        notes.push(`harness baseline is "${harness.mountState}" (rig doesn't mount this widget — ` +
            `drawer/standalone needs context the rig omits) while SOAR mounts it; ` +
            `mount + stub-vs-real comparison is therefore unavailable for this widget`);
    }
    else if (harness.mounted !== soar.mounted) {
        notes.push(`MOUNT MISMATCH (both should mount): harness=${harness.mountState} soar=${soar.mountState}`);
    }
    else {
        notes.push(`mount parity ok (both ${soar.mountState})`);
    }
    // Console-error parity — the fidelity payoff. Attribute SOAR errors: only those
    // naming THIS widget's own path are "widget-hidden-by-harness" candidates; the
    // rest are whole-shell noise (other widgets' assets, generic 404s) the rig
    // happens to capture and must NOT be blamed on our widget.
    const widgetPath = new RegExp(`/widgets/installed/${soar.widgetId}\\b|${soar.widgetId}`, "i");
    const soarWidgetErrs = soar.correctness.consoleErrors.filter((e) => widgetPath.test(e));
    const soarShellErrs = soar.correctness.consoleErrors.filter((e) => !widgetPath.test(e));
    if (soarWidgetErrs.length) {
        notes.push(`errors on SOAR naming THIS widget (harness hides these — investigate): ${soarWidgetErrs.length}`);
    }
    else {
        notes.push(`no SOAR errors attributable to this widget (clean live render)`);
    }
    if (soarShellErrs.length) {
        notes.push(`SOAR shell/other-widget errors (not ours, informational): ${soarShellErrs.length}`);
    }
    // Widget-asset presence: did the widget's own bundle/assets load on SOAR?
    const widgetAssets = soar.resources.filter((r) => new RegExp(`/widgets/installed/${soar.widgetId}`, "i").test(r.name));
    notes.push(`widget's own assets loaded on SOAR: ${widgetAssets.length} file(s)`);
    // Stub-vs-real service map: the harness stubs that actually fired during the
    // harness render ARE the platform services SOAR provides for real. Only
    // meaningful when the harness produced a real mounted render.
    const stubHits = (harness.runtime && harness.runtime.stubHits) || {};
    for (const [name, hits] of Object.entries(stubHits)) {
        if (hits > 0)
            stubbedInHarness.push(name);
    }
    if (stubbedInHarness.length) {
        notes.push(`services stubbed in harness but real on SOAR: ${stubbedInHarness.join(", ")}`);
    }
    else if (harnessBaselineWeak) {
        notes.push(`stub-vs-real service map unavailable (needs a mounted harness render)`);
    }
    // Resource profile (informational — NOT a mismatch; SOAR loads the full shell).
    notes.push(`resource profile — harness: ${harness.resourceCount} res / ${kb(harness.totalBytes)}; ` +
        `soar: ${soar.resourceCount} res / ${kb(soar.totalBytes)} (full shell, expected heavier)`);
    return { widgetId: soar.widgetId, domMismatch: harness.mounted !== soar.mounted, styleMismatches, stubbedInHarness, notes };
}
function kb(b) { return (b / 1024 / 1024).toFixed(2) + " MB"; }
function loadHarnessReport(id) {
    // Reports are versioned (<id>-<version>.json); take the newest match for <id>.
    if (!fs.existsSync(REPORT_DIR))
        return null;
    const matches = fs.readdirSync(REPORT_DIR)
        .filter((n) => n.endsWith(".json") && (n === `${id}.json` || n.startsWith(`${id}-`)))
        .map((n) => path.join(REPORT_DIR, n));
    if (!matches.length)
        return null;
    matches.sort();
    try {
        return JSON.parse(fs.readFileSync(matches[matches.length - 1], "utf8"));
    }
    catch (_) {
        return null;
    }
}
async function main() {
    const arg = process.argv.slice(2).find((a) => !a.startsWith("--"));
    const targets = arg ? LIVE_WIDGETS.filter((w) => w.id === arg) : LIVE_WIDGETS;
    if (arg && !targets.length) {
        console.error(`introspectSoar: "${arg}" is not a live-renderable widget. Known: ${LIVE_WIDGETS.map((w) => w.id).join(", ")}`);
        process.exit(2);
    }
    fs.mkdirSync(SOAR_DIR, { recursive: true });
    fs.mkdirSync(FIDELITY_DIR, { recursive: true });
    // --offline recomputes the fidelity diff from the last saved SOAR report
    // (no box drive) — use it to re-diff after refreshing the harness baseline.
    const offline = process.argv.includes("--offline");
    for (const lw of targets) {
        let soar;
        if (offline) {
            const saved = path.join(SOAR_DIR, `${lw.id}.json`);
            if (!fs.existsSync(saved)) {
                console.error(`  ✗ --offline: no saved SOAR report for ${lw.id}`);
                continue;
            }
            soar = JSON.parse(fs.readFileSync(saved, "utf8"));
            console.log(`\n▶ ${lw.id} — re-diffing saved SOAR report (offline)`);
        }
        else {
            console.log(`\n▶ ${lw.id} — rendering live via ${lw.mode} on ${lw.module}…`);
            try {
                soar = await introspectSoar(lw);
            }
            catch (e) {
                console.error(`  ✗ live render failed: ${e instanceof Error ? e.message : String(e)}`);
                continue;
            }
            fs.writeFileSync(path.join(SOAR_DIR, `${lw.id}.json`), JSON.stringify(soar, null, 2));
        }
        console.log(`  ${soar.mounted ? "✓" : "✗"} ${lw.id} — ${soar.mountState} — ${soar.resourceCount} res / ${kb(soar.totalBytes)} / ${soar.wallMs}ms / ${soar.correctness.errorCount} err`);
        const harness = loadHarnessReport(lw.id);
        const diff = fidelity(harness, soar);
        fs.writeFileSync(path.join(FIDELITY_DIR, `${lw.id}.json`), JSON.stringify(diff, null, 2));
        console.log("  fidelity:");
        for (const n of diff.notes)
            console.log(`    • ${n}`);
    }
    console.log(`\nreports → introspection-reports/soar/ + introspection-reports/fidelity/`);
}
main().catch((e) => { console.error(e); process.exit(1); });
