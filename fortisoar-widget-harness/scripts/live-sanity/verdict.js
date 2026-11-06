"use strict";
// Verdict for `make live-sanity`: pure, so the rules are unit-tested without a box.
//
//   FAIL     any check failed, or no check passed (an empty or all-skipped
//            run proves nothing)
//   PARTIAL  no failure, but at least one selected check was SKIPPED: what it
//            covers is NOT verified, and the report lists it with the reason
//   VERIFIED every selected check passed
//
// Exit code: 1 on FAIL, 0 otherwise. A PARTIAL exits 0 so a box that lacks one
// integration does not block a dev push, but it is never printed as verified.

const PASS = "PASS";
const FAIL = "FAIL";
const SKIP = "SKIP";

function computeVerdict(results) {
  const list = Array.isArray(results) ? results : [];
  const failed = list.filter((r) => r.status === FAIL);
  // Anything that is not an explicit PASS or FAIL is treated as not run: an
  // unknown status must never count toward VERIFIED.
  const notRun = list.filter((r) => r.status !== PASS && r.status !== FAIL);
  const passed = list.filter((r) => r.status === PASS);
  let verdict;
  // No check passed (empty run, or everything skipped) proves nothing: FAIL.
  if (failed.length || !passed.length) verdict = "FAIL";
  else if (notRun.length) verdict = "PARTIAL";
  else verdict = "VERIFIED";
  return {
    verdict,
    exitCode: verdict === "FAIL" ? 1 : 0,
    passed: passed.map((r) => r.name),
    failed: failed.map((r) => ({ name: r.name, detail: r.detail || "" })),
    notRun: notRun.map((r) => ({ name: r.name, reason: r.detail || "no reason given" })),
  };
}

function formatReport(results, v, { box, seconds } = {}) {
  const mark = { PASS: "ok  ", FAIL: "FAIL", SKIP: "skip" };
  const lines = [];
  for (const r of results) {
    const t = r.ms != null ? ` (${(r.ms / 1000).toFixed(1)}s)` : "";
    lines.push(`  ${mark[r.status] || "skip"} ${r.name.padEnd(22)} ${r.detail || ""}${t}`);
  }
  if (v.notRun.length) {
    lines.push("  NOT RUN (not verified):");
    for (const n of v.notRun) lines.push(`    - ${n.name}: ${n.reason}`);
  }
  const where = box ? ` on ${box}` : "";
  const dur = seconds != null ? ` in ${seconds}s` : "";
  lines.push(`[[LIVE-SANITY-${v.verdict}]] ${v.passed.length} passed, ${v.failed.length} failed, ` +
    `${v.notRun.length} not run${where}${dur}`);
  return lines.join("\n");
}

module.exports = { computeVerdict, formatReport, PASS, FAIL, SKIP };
