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
//  - fail the build on the intrinsic findings by default while the fixtures are
//    still being re-captured. --strict makes them fatal; wire that into CI once
//    the backlog is worked off.
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
const CAPTURES = path.resolve(opt("--captures",
  path.join(__dirname, "..", "test-results", "live")));

// A capture is matched to a fixture by scenario name: <scenario>.payloads.json.
function captureFor(scenario) {
  const p = path.join(CAPTURES, `${scenario}.payloads.json`);
  if (!fs.existsSync(p)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(p, "utf8"));
    return Array.isArray(parsed) ? parsed : null;
  } catch (e) {
    console.warn(`  ! ${scenario}: capture on disk is unreadable (${e.message})`);
    return null;
  }
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

  const report = { fixtures: files.length, findings: [], verified: 0, unverified: [], orphanCaptures: [] };
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
    if (cmp.verified) usedCaptures.add(`${scenario}.payloads.json`);
    if (cmp.verified) {
      report.verified += 1;
      cmp.findings.forEach((f) => report.findings.push({ fixture: file, ...f }));
    } else {
      report.unverified.push(file);
    }
  }

  // A capture whose name matches no fixture is read by nothing. Silence there
  // is the worst outcome available: someone recorded the wire, the fixture it
  // was meant to verify stayed UNVERIFIED, and the audit reported success. Name
  // the orphans so a mislabelled capture is a visible mistake, not a no-op.
  if (fs.existsSync(CAPTURES)) {
    fs.readdirSync(CAPTURES)
      .filter((f) => f.endsWith(".payloads.json") && !usedCaptures.has(f))
      .sort()
      .forEach((f) => report.orphanCaptures.push(f));
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
    if (report.orphanCaptures.length) {
      console.log(`\n${report.orphanCaptures.length} capture(s) match NO fixture and were `
        + "read by nothing -- rename the capture to the fixture's scenario name "
        + `(session.saveCapture(label)):\n   ${report.orphanCaptures.join("\n   ")}`);
    }
  }

  if (flag("--strict") && report.findings.length) process.exit(1);
}

main();
