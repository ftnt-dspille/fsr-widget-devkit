#!/usr/bin/env node
"use strict";
// npm run fixtures:audit -- structural audit of the hand-written widget fixtures.
//
// The rules live in tests/live/lib/fixtureAudit.js (unit-tested offline); this
// file is only the walk + the report. Two things it deliberately does NOT do:
//
//  - pass quietly when no live capture exists. A fixture with nothing to diff
//    against is UNVERIFIED, and the summary says so on its own line. "0 failures"
//    over an empty comparison set is the exact shape of a gate that cannot fail.
//  - treat a declared divergence as a pass. A fixture that disagrees with its
//    recording on purpose (see capture_divergence) is reported every run with
//    its reason, and is NOT counted among the capture-verified.
//
// --strict makes findings fatal. The backlog is worked off (45 -> 0), so the
// gate is live: tests/fixtureAudit.test.js runs this script with --strict over
// the shipped fixtures, and carries a mutation proving it goes red.
//
// Usage:
//   node scripts/fixtures-audit.js [--strict] [--json] [--fixtures <dir>]
//                                  [--captures <dir>]

const fs = require("fs");
const path = require("path");
const { auditFixture, compareToCapture } = require("../tests/live/lib/fixtureAudit");

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const opt = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};

const REPO = path.join(__dirname, "..", "..");
const FIXTURES = path.resolve(opt("--fixtures",
  path.join(REPO, "widgets-src", "fortiaiAgenticAssistant", "widget", "widgetAssets", "fixtures")));
// Durable capture home. It used to be test-results/live, which Playwright wipes
// at the start of every run -- so evidence recorded off a box was routinely
// deleted by the next unrelated `npx playwright test`, and the audit reported
// the fixtures as UNVERIFIED with no sign they ever had a recording.
const CAPTURES = path.resolve(opt("--captures",
  path.join(__dirname, "..", "tests", "live", "captures")));
// Anything still sitting in the old location is read too, so a capture recorded
// before the move is not silently ignored -- but it is named as stranded,
// because the next Playwright run will delete it.
const LEGACY_CAPTURES = path.resolve(path.join(__dirname, "..", "test-results", "live"));

// A capture is matched to a fixture by scenario name: <scenario>.payloads.json.
function captureFor(scenario) {
  for (const dir of [CAPTURES, LEGACY_CAPTURES]) {
    const p = path.join(dir, `${scenario}.payloads.json`);
    if (!fs.existsSync(p)) continue;
    if (dir === LEGACY_CAPTURES) {
      console.warn(`  ! ${scenario}: capture is in test-results/live, which Playwright `
        + "deletes at the start of the next run -- re-record, or move it to "
        + "tests/live/captures/.");
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(p, "utf8"));
      return Array.isArray(parsed) ? parsed : null;
    } catch (e) {
      console.warn(`  ! ${scenario}: capture on disk is unreadable (${e.message})`);
      return null;
    }
  }
  return null;
}

function main() {
  if (!fs.existsSync(FIXTURES)) {
    console.error(`fixtures dir not found: ${FIXTURES}`);
    process.exit(2);
  }
  const files = fs.readdirSync(FIXTURES).filter((f) => f.endsWith(".json")).sort();
  if (!files.length) {
    // An empty subject set is not a pass. This is the 0.2 lesson: a gate that
    // graded nothing printed the same thing as one that graded everything.
    console.error(`no fixtures found in ${FIXTURES} -- the audit had no subject.`);
    process.exit(2);
  }

  const report = { fixtures: files.length, findings: [], verified: 0, unverified: [],
    pins: [], orphanCaptures: [], diverged: [] };
  const usedCaptures = new Set();

  for (const file of files) {
    const full = path.join(FIXTURES, file);
    let fixture;
    try {
      fixture = JSON.parse(fs.readFileSync(full, "utf8"));
    } catch (e) {
      report.findings.push({ fixture: file, rule: "unparseable", detail: e.message });
      continue;
    }
    const scenario = fixture.scenario || path.basename(file, ".json");
    auditFixture(fixture).forEach((f) => report.findings.push({ fixture: file, ...f }));

    const cmp = compareToCapture(fixture, captureFor(scenario));
    // A capture counts as READ whenever it was compared -- including when the
    // comparison diverged. Gating this on `verified` would report a capture
    // that did its job as an orphan nothing reads.
    if (cmp.hadCapture) usedCaptures.add(`${scenario}.payloads.json`);
    cmp.findings.forEach((f) => report.findings.push({ fixture: file, ...f }));
    if (cmp.declared && cmp.declared.length) {
      // Declared-divergent: the capture backs this fixture everywhere EXCEPT
      // the places the fixture says it does not. Deliberately not counted in
      // `verified` -- see the note on compareToCapture.
      report.diverged.push({ file, declared: cmp.declared });
    } else if (cmp.verified) {
      report.verified += 1;
    } else if (cmp.hadCapture) {
      // Findings already recorded above; nothing further to count.
    } else if (fixture.regression_pin) {
      // A fixture that pins a shape a HEALTHY box can no longer emit -- the
      // superseded wire shape, or a bug that has been fixed. Re-capturing it is
      // not available, so counting it as "owed a recording" is a category error
      // that makes the backlog look permanently incomplete. It is still audited
      // structurally; it just is not chased for evidence it cannot have.
      report.pins.push({ file, reason: String(fixture.regression_pin) });
    } else {
      report.unverified.push(file);
    }
  }

  // A capture whose name matches no fixture is read by nothing. Silence there
  // is the worst outcome available: someone recorded the wire, the fixture it
  // was meant to verify stayed UNVERIFIED, and the audit reported success. Name
  // the orphans so a mislabelled capture is a visible mistake, not a no-op.
  for (const dir of [CAPTURES, LEGACY_CAPTURES]) {
    if (!fs.existsSync(dir)) continue;
    fs.readdirSync(dir)
      .filter((f) => f.endsWith(".payloads.json") && !usedCaptures.has(f))
      .sort()
      .forEach((f) => report.orphanCaptures.push(path.join(path.basename(dir), f)));
  }

  if (flag("--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    const byFixture = {};
    report.findings.forEach((f) => (byFixture[f.fixture] = byFixture[f.fixture] || []).push(f));
    for (const [fixture, list] of Object.entries(byFixture)) {
      console.log(`\n## ${fixture}`);
      list.forEach((f) => console.log(`   [${f.rule}] ${f.detail}`));
    }
    console.log(`\n${report.fixtures} fixture(s), ${report.findings.length} finding(s).`);
    console.log(`${report.verified} checked against a live capture; `
      + `${report.unverified.length} UNVERIFIED (no capture on disk) -- those are `
      + "still one author's belief about the wire, not evidence.");
    if (report.diverged.length) {
      // Printed every run, never folded into the verified count. A declared
      // divergence is a fixture admitting its capture does not back it here --
      // the reason has to stay in front of whoever reads the summary, or the
      // audit quietly turns back into "N green" over an unexamined waiver list.
      console.log(`\n${report.diverged.length} fixture(s) diverge from their capture `
        + "BY DECLARATION -- the capture is not evidence for the diverging part:");
      for (const d of report.diverged) {
        console.log(`   ${d.file}`);
        d.declared.forEach((x) => console.log(`      [${x.rule}] ${x.why}`));
      }
    }
    if (report.pins.length) {
      // Named, never silent: a pin that stops being a pin (the shape becomes
      // reproducible again, or someone adds the flag to dodge a recording) has
      // to be visible to be caught.
      console.log(`\n${report.pins.length} regression pin(s) -- not re-recordable `
        + "on a healthy box, so not counted as owed a capture:\n   "
        + report.pins.map((p) => `${p.file} -- ${p.reason}`).join("\n   "));
    }
    if (report.orphanCaptures.length) {
      console.log(`\n${report.orphanCaptures.length} capture(s) match NO fixture and were `
        + "read by nothing -- rename the capture to the fixture's scenario name "
        + `(session.saveCapture(label)):\n   ${report.orphanCaptures.join("\n   ")}`);
    }
  }

  if (flag("--strict") && report.findings.length) process.exit(1);
}

main();
