// The introspection gate must not be permanently red on a report nobody can
// regenerate.
//
// `make introspect` renders the CURRENT source of each widget, so it only ever
// writes a report for the version in widgets-src/<name>/widget/info.json. A
// report for any older version is a leftover. One of those leftovers
// (fortiaiAgenticAssistant-1.2.52, written by a run whose auth failed -- a 502
// and a gzip body parsed as JSON) recorded a no-mount against a baseline that
// said mounted, and failed `make ship-verify` at step 4/6 on every subsequent
// run. Nothing a person could do would clear it: the source had already moved
// to 1.2.53, so the report could never be rewritten.
//
// A gate that cannot be satisfied is worse than no gate -- it is the reason
// SKIP_INTROSPECT gets typed, after which the gate stops covering the versions
// it CAN check. So stale-version reports are listed and skipped.

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const HARNESS = path.resolve(__dirname, "..");
const GATE = path.join(HARNESS, "scripts", "introspect-gate.js");
const REPORTS = path.join(HARNESS, "introspection-reports");
const SRC = path.resolve(HARNESS, "..", "widgets-src");

function runGate(filter) {
  try {
    return { code: 0, out: execFileSync("node", [GATE, filter], { encoding: "utf8" }) };
  } catch (e) {
    return { code: e.status, out: (e.stdout || "") + (e.stderr || "") };
  }
}

const currentVersion = (name) =>
  JSON.parse(fs.readFileSync(path.join(SRC, name, "widget", "info.json"), "utf8")).version;

describe("introspect-gate skips reports the current source cannot regenerate", () => {
  const WIDGET = "fortiaiAgenticAssistant";

  test("the fixture this exists for is still on disk", () => {
    // If someone deletes the stale reports, this test would pass vacuously.
    const stale = fs.readdirSync(REPORTS)
      .filter((f) => f.startsWith(`${WIDGET}-`) && f.endsWith(".json"))
      .map((f) => f.slice(WIDGET.length + 1, -".json".length))
      .filter((v) => v !== currentVersion(WIDGET));
    expect(stale.length).toBeGreaterThan(0);
  });

  test("it names the reports it skipped", () => {
    const { out } = runGate(WIDGET);
    expect(out).toMatch(/cannot be regenerated and are not gated/);
  });

  test("the CURRENT version is never in the skipped list", () => {
    const cur = currentVersion(WIDGET);
    const skipLine = (runGate(WIDGET).out.match(/\(\d+ report\(s\) are for a version.*/s)
      || [""])[0].split("\n")[0];
    expect(skipLine).not.toContain(`${WIDGET}-${cur}`);
  });

  // The hole the first draft of this file opened. Skipping stale reports is
  // right; skipping ALL of them and then reporting success is the 0.2 failure
  // -- a gate that graded nothing printing what a gate that graded everything
  // prints. It happens for real straight after a version bump, before
  // `make introspect` has rendered the new version.
  test("skipping EVERY report is a failure, not a quiet pass", () => {
    const cur = currentVersion(WIDGET);
    const hasCurrentReport = fs.existsSync(
      path.join(REPORTS, `${WIDGET}-${cur}.json`));
    const { code, out } = runGate(WIDGET);
    if (hasCurrentReport) {
      expect(code).toBe(0);
      expect(out).toContain(`${WIDGET}-${cur}`);
    } else {
      expect(code).toBe(1);
      expect(out).toMatch(/NOTHING was gated/);
    }
  });
});
