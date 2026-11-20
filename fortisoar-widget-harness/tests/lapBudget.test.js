"use strict";
// scripts/lap.sh: every step lands in one ledger, and a step over its budget
// warns on the first run that goes over (warn, never fail).
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const ROOT = path.resolve(__dirname, "../..");
let tmp, ledger;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lap-")); ledger = path.join(tmp, "laps.tsv"); });
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));
const lap = (...a) => spawnSync("bash", [path.join(ROOT, "scripts/lap.sh"), ...a],
  { cwd: tmp, encoding: "utf8", env: { ...process.env, FSR_LAP_LEDGER: ledger } });
const rows = () => fs.readFileSync(ledger, "utf8").trim().split("\n").map((l) => l.split("\t"));

test("a step within budget is recorded and does not warn", () => {
  const r = lap("push", "--budget", "60", "--", "true");
  expect(r.status).toBe(0);
  expect(r.stderr).not.toMatch(/WARNING/);
  const [row] = rows();
  expect(row.slice(1, 5)).toEqual(["push", "0", "0", "60"]);
});

test("a step over budget warns, keeps its exit status and is recorded as over", () => {
  const r = lap("stamp", "--budget", "0", "--", "bash", "-c", "sleep 1.1; exit 3");
  expect(r.status).toBe(3);
  expect(r.stderr).toMatch(/WARNING stamp took [1-9]\d*s, budget 0s/);
  expect(r.stdout).toMatch(/FAILED OVER BUDGET \(0s\)/);
  const [row] = rows();
  expect(row[1]).toBe("stamp"); expect(Number(row[2])).toBeGreaterThan(0); expect(row[3]).toBe("3");
});

test("make laps summarises runs, budget and over-budget count per step", () => {
  lap("stamp", "--budget", "0", "--", "sleep", "1.1");
  lap("stamp", "--budget", "100", "--", "true");
  lap("unit", "--", "true");
  const r = spawnSync("bash", [path.join(ROOT, "scripts/laps.sh")], { encoding: "utf8", env: { ...process.env, FSR_LAP_LEDGER: ledger } });
  const stamp = r.stdout.split("\n").find((l) => l.startsWith("stamp"));
  expect(stamp.trim().split(/\s+/)).toEqual(["stamp", "2", "0s", expect.stringMatching(/s$/), expect.stringMatching(/s$/), "100s", "1"]);
  expect(r.stdout).toMatch(/^unit\s+1\s/m);
});

test("a failed step keeps its last 20 lines in the ledger, whatever the caller filtered", () => {
  const r = lap("promote", "--budget", "60", "--", "bash", "-c",
    "for i in $(seq 1 30); do echo line$i; done; echo 'promote: refusing: the real reason' >&2; exit 1");
  expect(r.status).toBe(1);
  expect(r.stdout).toMatch(/line30/);                     // still streamed to the caller
  const [row] = rows();
  expect(row[3]).toBe("1");
  const log = fs.readFileSync(row[6], "utf8").trim().split("\n");
  expect(log).toHaveLength(20);
  expect(log.join("\n")).toMatch(/refusing: the real reason/);
  expect(log.join("\n")).not.toMatch(/^line1$/m);
  const s = spawnSync("bash", [path.join(ROOT, "scripts/laps.sh")], { encoding: "utf8", env: { ...process.env, FSR_LAP_LEDGER: ledger } });
  expect(s.stdout).toMatch(/recent failures[\s\S]*promote rc=1/);
});

test("a passing step keeps no log", () => {
  lap("unit", "--", "true");
  expect(rows()[0][6]).toBe("-");
});
