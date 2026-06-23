#!/usr/bin/env node
"use strict";
/**
 * Introspection regression gate (Phase 5).
 *
 * Compares current render reports (introspection-reports/) against committed
 * baselines (tests/introspect/baseline/) and fails if any widget regresses past
 * sane thresholds:
 *   - Payload: +10% (e.g., baseline 10 MB → gate allows up to 11 MB)
 *   - Boot (DCL): +15% (e.g., baseline 500 ms → gate allows up to 575 ms)
 *   - Console errors: increased (new errors are failures; old errors are baseline)
 *   - Editor-byte leaks: a widget whose caps don't declare monaco/editors but
 *     still pulled editor bytes is a lazy-load gate regression.
 *
 * Pre-existing no-mounts (fsocFieldsOfInterest, funnelChart, jsonToGrid) and
 * fortiaiInsight's flaky-under-parallel no-mount are baseline-documented; the
 * gate doesn't fail on them.
 *
 * Usage:
 *   node scripts/introspect-gate.js
 *
 * Exit code: 0 if all checks pass, 1 if any widget regresses.
 */

const fs = require("fs");
const path = require("path");

const REPORT_DIR = path.resolve(__dirname, "..", "introspection-reports");
const BASELINE_DIR = path.resolve(__dirname, "..", "tests", "introspect", "baseline");

// Pre-existing no-mounts documented in the plan (Phase 1 findings).
// The gate must NOT fail these.
// jsonToGrid was here until its view controller was hardened (it crashed on
// actionButtons[0]/resources[0] for an unconfigured or generic provider
// playbook); it now mounts, so the baseline is a real mounted render and the
// gate holds it to mount.
const KNOWN_NO_MOUNTS = new Set([
  "fsocFieldsOfInterest-1.0.0",
  "funnelChart-1.0.2",
  "fortiaiInsight-1.0.1", // flaky under parallel
]);

// Thresholds (with headroom).
const THRESHOLDS = {
  payloadDeltaPercent: 10,   // +10% allowed
  bootDeltaPercent: 15,       // +15% allowed
};

function loadReport(path_) {
  try {
    return JSON.parse(fs.readFileSync(path_, "utf8"));
  } catch {
    return null;
  }
}

function runGate() {
  if (!fs.existsSync(REPORT_DIR)) {
    console.error(`Error: no introspection-reports/ found. Run 'make introspect' first.`);
    process.exit(1);
  }

  const reports = fs.readdirSync(REPORT_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const widgetId = f.replace(".json", "");
      const report = loadReport(path.join(REPORT_DIR, f));
      const baseline = loadReport(path.join(BASELINE_DIR, f));
      return { widgetId, report, baseline };
    });

  let failures = 0;
  const results = [];

  for (const { widgetId, report, baseline } of reports) {
    if (!report) {
      results.push(`✗ ${widgetId}: failed to load current report`);
      failures++;
      continue;
    }

    if (!baseline) {
      // No baseline for this widget — it's new. Allow it without gate.
      results.push(`- ${widgetId}: new widget (no baseline yet)`);
      continue;
    }

    const checks = [];

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

    // Check 3: Boot time (DCL).
    const bootDelta = report.boot.domContentLoaded - baseline.boot.domContentLoaded;
    const bootDeltaPct = (bootDelta / baseline.boot.domContentLoaded) * 100;
    if (bootDeltaPct > THRESHOLDS.bootDeltaPercent) {
      checks.push(
        `boot DCL ${(bootDeltaPct > 0 ? "+" : "") + bootDeltaPct.toFixed(1)}% ` +
        `(${baseline.boot.domContentLoaded} ms → ${report.boot.domContentLoaded} ms, threshold +${THRESHOLDS.bootDeltaPercent}%)`
      );
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
    const EDITOR_BUNDLES = [
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

runGate();
