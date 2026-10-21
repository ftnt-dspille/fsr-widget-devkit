#!/usr/bin/env node
"use strict";
/**
 * Introspection regression gate (Phase 5).
 *
 * Compares current render reports (introspection-reports/) against committed
 * baselines (tests/introspect/baseline/) and fails if any widget regresses past
 * sane thresholds:
 *   - Payload: +10% (e.g., baseline 10 MB → gate allows up to 11 MB)
 *   - Boot (DCL): +100% RELATIVE to the run. Each widget's boot time is
 *     divided by the median boot of every current, mounted widget in the same
 *     run (and its baseline by the baselines' median), so a slow machine or a
 *     busy CPU moves every widget alike and cancels out. Absolute wall-clock
 *     against a baseline from another day failed every widget 3-13x at once
 *     (a test suite was running beside it), which is a gate nobody can pass.
 *   - Console errors: increased (new errors are failures; old errors are baseline)
 *   - Editor-byte leaks: a widget whose caps don't declare monaco/editors but
 *     still pulled editor bytes is a lazy-load gate regression.
 *
 * No no-mounts are documented today. A widget that stops mounting fails the
 * gate; add an entry to KNOWN_NO_MOUNTS only with a documented reason.
 *
 * Usage:
 *   node scripts/introspect-gate.js            # gate every widget
 *   node scripts/introspect-gate.js <widget>   # gate only reports for <widget>
 *
 * The optional <widget> filter (the widget dir/name, unversioned) scopes the
 * PASS/FAIL to that widget's report(s) only -- used by `make ship-verify` so a
 * single-widget ship isn't blocked by an unrelated widget's stale baseline.
 * It does NOT change what `make introspect` renders (that's still the fleet).
 *
 * Exit code: 0 if all checks pass, 1 if any (in-scope) widget regresses.
 */

import fs = require("fs");
import path = require("path");
import { RenderReport } from "../lib/types";

const REPORT_DIR = path.resolve(__dirname, "..", "introspection-reports");
const BASELINE_DIR = path.resolve(__dirname, "..", "tests", "introspect", "baseline");

// Documented pre-existing no-mounts. The gate must NOT fail these. Empty today:
// the widgets that used to be listed were archived out of widgets-src.
const KNOWN_NO_MOUNTS = new Set<string>([]);

// Thresholds (with headroom).
const THRESHOLDS = {
  payloadDeltaPercent: 10,   // +10% allowed
  bootDeltaPercent: 15,       // absolute fallback, when a run has too few widgets to normalize
  bootRelativeDeltaPercent: 100, // widget/run-median vs baseline/baseline-median
};
// Fewer paired widgets than this and a median says nothing; fall back to absolute.
const MIN_PAIRS_FOR_MEDIAN = 3;

export function median(xs: number[]): number | null {
  const v = xs.filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/** The boot-regression line for one widget, or null when it is within budget.
 * With both medians, compare each side's share of its own run; without, the
 * absolute delta. */
export function bootRegression(reportMs: number, baselineMs: number,
                               runMedian: number | null, baselineMedian: number | null): string | null {
  if (runMedian && baselineMedian) {
    const ratio = (reportMs / runMedian) / (baselineMs / baselineMedian);
    const pct = (ratio - 1) * 100;
    if (pct <= THRESHOLDS.bootRelativeDeltaPercent) return null;
    return `boot DCL +${pct.toFixed(1)}% relative to its run ` +
      `(${reportMs} ms of run median ${Math.round(runMedian)} ms, baseline ${baselineMs} ms of ` +
      `${Math.round(baselineMedian)} ms, threshold +${THRESHOLDS.bootRelativeDeltaPercent}%)`;
  }
  const pct = ((reportMs - baselineMs) / baselineMs) * 100;
  if (pct <= THRESHOLDS.bootDeltaPercent) return null;
  return `boot DCL ${(pct > 0 ? "+" : "") + pct.toFixed(1)}% ` +
    `(${baselineMs} ms → ${reportMs} ms, threshold +${THRESHOLDS.bootDeltaPercent}%)`;
}

function loadReport(path_: string): RenderReport | null {
  try {
    return JSON.parse(fs.readFileSync(path_, "utf8"));
  } catch {
    return null;
  }
}

function runGate(): void {
  if (!fs.existsSync(REPORT_DIR)) {
    console.error(`Error: no introspection-reports/ found. Run 'make introspect' first.`);
    process.exit(1);
  }

  // Optional unversioned widget-name filter (e.g. "fortiaiAgenticAssistant").
  // Report ids are versioned ("fortiaiAgenticAssistant-1.2.13"); match the
  // exact name or the "<name>-" version prefix so a filter can't partial-match
  // a sibling ("counter" must not catch "counterPlus").
  const filter = (process.argv[2] || "").trim();
  const inScope = (widgetId: string): boolean =>
    !filter || widgetId === filter || widgetId.startsWith(filter + "-");

  // `make introspect` renders the CURRENT source of each widget, so it only
  // ever writes a report for the version in widgets-src/<name>/widget/info.json.
  // A report for any other version is a leftover from a past run and can never
  // be regenerated -- if it happens to be red, the gate is red forever and no
  // amount of correct work clears it. That is a gate nobody can satisfy, which
  // is a gate everyone learns to pass with SKIP_INTROSPECT.
  //
  // (Hit for real: a fortiaiAgenticAssistant-1.2.52 report from a run whose
  // auth failed -- a 502 and a gzip body parsed as JSON -- recorded a no-mount
  // and then outlived the source version that produced it.)
  //
  // So stale-version reports are LISTED, loudly, and not gated.
  const currentVersion = (name: string): string | null => {
    for (const dir of [name, name.toLowerCase()]) {
      const info = path.resolve(__dirname, "..", "..", "widgets-src", dir, "widget", "info.json");
      try {
        return String(JSON.parse(fs.readFileSync(info, "utf8")).version);
      } catch (_e) { /* try the next casing */ }
    }
    return null;
  };
  const staleReports: string[] = [];
  const isStale = (widgetId: string): boolean => {
    const m = /^(.*)-(\d+\.\d+\.\d+)$/.exec(widgetId);
    if (!m) return false;
    const cur = currentVersion(m[1]);
    // No source dir (a widget not checked out here) -- gate it as before rather
    // than silently dropping it.
    if (!cur) return false;
    return cur !== m[2];
  };

  const reports = fs.readdirSync(REPORT_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const widgetId = f.replace(".json", "");
      const report = loadReport(path.join(REPORT_DIR, f));
      const baseline = loadReport(path.join(BASELINE_DIR, f));
      return { widgetId, report, baseline };
    })
    .filter((r) => inScope(r.widgetId))
    .filter((r) => {
      if (!isStale(r.widgetId)) return true;
      staleReports.push(r.widgetId);
      return false;
    });

  // Medians for the boot check, over EVERY current mounted widget with a
  // mounted baseline -- not just the filtered one, or a one-widget gate would
  // divide a widget by itself.
  const paired = fs.readdirSync(REPORT_DIR)
    .filter((f) => f.endsWith(".json") && !isStale(f.replace(".json", "")))
    .map((f) => ({ r: loadReport(path.join(REPORT_DIR, f)), b: loadReport(path.join(BASELINE_DIR, f)) }))
    .filter((p) => p.r && p.b && p.r.mounted && p.b.mounted) as Array<{ r: RenderReport; b: RenderReport }>;
  const enough = paired.length >= MIN_PAIRS_FOR_MEDIAN;
  const runMedian = enough ? median(paired.map((p) => p.r.boot.domContentLoaded)) : null;
  const baselineMedian = enough ? median(paired.map((p) => p.b.boot.domContentLoaded)) : null;

  if (staleReports.length) {
    console.log(`  (${staleReports.length} report(s) are for a version the current source `
      + `no longer builds, so they cannot be regenerated and are not gated: `
      + `${staleReports.join(", ")})`);
  }

  // Every report in scope was stale => the CURRENT version was never rendered,
  // so the gate has nothing to say about the build being shipped. Passing there
  // would print the same thing as a real pass over a real report -- the failure
  // mode this whole plan is about. `make introspect-gate` depends on
  // `introspect`, so this should be unreachable via make; it is here because the
  // script is also run directly.
  if (filter && reports.length === 0 && staleReports.length > 0) {
    console.error(`Introspection gate: every report for "${filter}" is for a version `
      + `the current source no longer builds, so NOTHING was gated. Run `
      + `'make introspect' to render the current version first.`);
    process.exit(1);
  }

  if (filter && reports.length === 0) {
    console.log(`Introspection gate: no reports match "${filter}" -- nothing to gate.`);
    process.exit(0);
  }

  let failures = 0;
  const results: string[] = [];

  for (const { widgetId, report, baseline } of reports) {
    if (!report) {
      results.push(`✗ ${widgetId}: failed to load current report`);
      failures++;
      continue;
    }

    if (!baseline) {
      // No baseline for this widget -- it's new. Allow it without gate.
      results.push(`- ${widgetId}: new widget (no baseline yet)`);
      continue;
    }

    const checks: string[] = [];

    // Check 1: Mount state. Known no-mounts are baseline-documented; if the mount
    // state regresses (was mounted, now not), that's a failure. If it was already
    // a no-mount and stays a no-mount, that's OK.
    if (baseline.mounted && !report.mounted) {
      checks.push(`mount state regressed: was mounted, now ${report.mountState}`);
    }

    // Check 2: Payload (totalBytes).
    const payloadDelta = report.totalBytes - baseline.totalBytes;
    const payloadDeltaPct = (payloadDelta / baseline.totalBytes) * 100;
    if (payloadDeltaPct > THRESHOLDS.payloadDeltaPercent) {
      checks.push(
        `payload ${(payloadDeltaPct > 0 ? "+" : "") + payloadDeltaPct.toFixed(1)}% ` +
        `(${baseline.totalBytes} B → ${report.totalBytes} B, threshold +${THRESHOLDS.payloadDeltaPercent}%)`
      );
    }

    // Check 3: Boot time (DCL), relative to the run (see the header). Only when
    // both sides mounted: a no-mount's timings come from a page that never
    // finished, and check 1 already reports the mount itself.
    if (baseline.mounted && report.mounted) {
      const boot = bootRegression(report.boot.domContentLoaded, baseline.boot.domContentLoaded,
        runMedian, baselineMedian);
      if (boot) checks.push(boot);
    }

    // Check 4: Console errors (increased).
    const baselineErrors = baseline.correctness.errorCount || 0;
    const reportErrors = report.correctness.errorCount || 0;
    if (reportErrors > baselineErrors) {
      checks.push(
        `console errors increased from ${baselineErrors} to ${reportErrors}`
      );
    }

    // Check 5: Editor-byte leaks (lazy-load gate regression).
    const EDITOR_BUNDLES: Array<{match: RegExp, cap: "monaco" | "editors"}> = [
      { match: /monaco-editor/i, cap: "monaco" },
      { match: /tinymce|toastui|dompurify/i, cap: "editors" },
    ];
    for (const ed of EDITOR_BUNDLES) {
      const baselineEditorBytes = baseline.resources
        .filter((r) => ed.match.test(r.name))
        .reduce((s, r) => s + r.size, 0);
      const reportEditorBytes = report.resources
        .filter((r) => ed.match.test(r.name))
        .reduce((s, r) => s + r.size, 0);

      const baseCap = baseline.caps ? baseline.caps[ed.cap] : true;
      const reportCap = report.caps ? report.caps[ed.cap] : true;

      // If baseline was clean (no editor bytes despite not declaring the cap) and
      // current report now has editor bytes without declaring it, that's a leak.
      if (!baseCap && baselineEditorBytes === 0 && reportEditorBytes > 0) {
        checks.push(
          `LEAK: ${ed.cap} bytes now present (${reportEditorBytes} B) but widget does NOT declare ${ed.cap} cap`
        );
      }
    }

    // Check 6: DOM skeleton-hash (Phase 2 fidelity -- catches a widget edit or
    // harness optimization that changed the rendered DOM). Only applies when the
    // baseline carries a `dom` capture (the widget's profile declares a domRoot);
    // widgets without one skip this check with no behavior change. A legit DOM
    // change (new feature) is a re-baseline event -- `make introspect` re-snapshots
    // -- identical to how the payload/boot budgets already work.
    if (baseline.dom && report.dom) {
      const baseHash = baseline.dom.skeletonHash || "";
      const reportHash = report.dom.skeletonHash || "";
      if (baseHash && reportHash && baseHash !== reportHash) {
        checks.push(
          `DOM skeleton changed: ${baseHash.slice(0, 8)} → ${reportHash.slice(0, 8)} ` +
          `(re-baseline if this DOM change was intended)`
        );
      }
    } else if (report.dom && !baseline.dom) {
      // New widget gained a domRoot profile (or a capture that previously didn't
      // resolve now does) -- informational, not a failure; re-baseline to pin it.
      results.push(`- ${widgetId}: DOM capture new (no baseline.dom yet) -- re-baseline to pin skeletonHash`);
    }

    if (checks.length === 0) {
      results.push(`✓ ${widgetId}: OK`);
    } else {
      results.push(`✗ ${widgetId}: ${checks.join("; ")}`);
      failures++;
    }
  }

  // Print results
  console.log("Introspection gate results:\n");
  for (const r of results) console.log(r);
  console.log("");

  if (failures === 0) {
    console.log("✅ All widgets within thresholds.");
    process.exit(0);
  } else {
    console.log(`❌ ${failures} widget(s) regressed.`);
    process.exit(1);
  }
}

if (require.main === module) runGate();
