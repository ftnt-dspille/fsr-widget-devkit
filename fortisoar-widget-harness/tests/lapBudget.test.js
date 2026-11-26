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
  expect([row[1], row[3], row[4]]).toEqual(["push", "0", "60"]);
  expect(Number(row[2])).toBeLessThan(60);
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
  expect(stamp.trim().split(/\s+/)).toEqual(["stamp", "2", expect.stringMatching(/^\ds$/), expect.stringMatching(/s$/), expect.stringMatching(/s$/), "100s", "1"]);
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
  // stdout's last 10, then stderr: the reason is the log's last line, whatever
  // order the two streams arrived in.
  expect(log[log.length - 1]).toBe("promote: refusing: the real reason");
  expect(log).toContain("line30");
  expect(log).not.toContain("line20");
  const s = spawnSync("bash", [path.join(ROOT, "scripts/laps.sh")], { encoding: "utf8", env: { ...process.env, FSR_LAP_LEDGER: ledger } });
  expect(s.stdout).toMatch(/recent failures[\s\S]*promote rc=1/);
});

test("a passing step keeps no log", () => {
  lap("unit", "--", "true");
  expect(rows()[0][6]).toBe("-");
});

test("time a step reports as not its own (promote's CI wait) comes off the lap", () => {
  // 4s of the step is reported as not its own; without the exclusion it is over
  // a 3s budget, with it ~0s (3s of slack for a loaded machine).
  const r = lap("promote", "--budget", "3", "--", "bash", "-c", 'sleep 4.1; echo 4 >> "$LAP_EXCLUDE_FILE"');
  expect(r.stderr).not.toMatch(/WARNING/);
  expect(Number(rows()[0][2])).toBeLessThanOrEqual(3);
});

test("make laps counts a target called wrong separately from a failing gate", () => {
  lap("promote", "--", "bash", "-c", "echo 'promote: usage: make promote REPO=<path> BRANCH=<branch>' >&2; exit 2");
  lap("promote", "--", "bash", "-c", "echo 'promote: refusing: CI failed' >&2; exit 1");
  const s = spawnSync("bash", [path.join(ROOT, "scripts/laps.sh")], { encoding: "utf8", env: { ...process.env, FSR_LAP_LEDGER: ledger } });
  expect(s.stdout).toMatch(/called wrong \(usage \/ unknown variable\), per step: promote 1/);
});

// A step that leaves a child behind (ssh control master, a server) must not keep the caller's pipe open: lap used to
// feed its output through two process-substitution tees that the leftover child kept alive, so `lap.sh ... | cat` hung.
test("a step that leaves a sleeping background child does not keep `lap.sh | cat` from returning", () => {
  const t0 = Date.now();
  const r = spawnSync("bash", ["-c", 'bash "$0" leftover -- bash -c "echo out-line; echo err-line >&2; sleep 30 & exit 4" 2>&1 | cat', path.join(ROOT, "scripts/lap.sh")],
    { cwd: tmp, encoding: "utf8", timeout: 20000, env: { ...process.env, FSR_LAP_LEDGER: ledger } });
  expect(Date.now() - t0).toBeLessThan(15000);
  expect(r.signal).toBeNull();
  expect(r.stdout).toMatch(/out-line/);
  expect(r.stdout).toMatch(/err-line/);
  expect(r.stdout).toMatch(/\[\ds\] leftover FAILED/);
  expect(rows()[0][3]).toBe("4");
  spawnSync("pkill", ["-f", "^sleep 30$"]);
});

test("stdout and stderr of a long step reach the caller while it runs, and the exit status is kept", () => {
  const r = lap("two", "--", "bash", "-c", "echo a; echo b >&2; sleep 0.5; echo c; exit 2");
  expect(r.status).toBe(2);
  expect(r.stdout).toMatch(/a\nc\n/);
  expect(r.stderr).toMatch(/b/);
});
