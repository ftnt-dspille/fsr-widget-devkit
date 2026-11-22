"use strict";
// scripts/drift_check.py (run by make doctor): a lap step trending over its budget
// is named, and so is a doc that points at a make target, script path or make
// variable that does not exist. It warns and exits 0.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
let T;
beforeEach(() => { T = fs.mkdtempSync(path.join(os.tmpdir(), "drift-")); });
afterEach(() => fs.rmSync(T, { recursive: true, force: true }));
const w = (rel, body) => { fs.mkdirSync(path.dirname(path.join(T, rel)), { recursive: true }); fs.writeFileSync(path.join(T, rel), body); };
const run = (extra = []) => spawnSync("python3", [path.join(ROOT, "scripts/drift_check.py"), "--root", T, "--ledger", path.join(T, "laps.tsv"), ...extra], { encoding: "utf8" });
const ledger = (rows) => w("laps.tsv", rows.map(([label, secs, budget]) => `2026-01-01T00:00:00Z\t${label}\t${secs}\t0\t${budget}\trepo\t-`).join("\n") + "\n");

test("a step whose recent median is over its budget is named; one within budget is not", () => {
  ledger([["slow", 100, 60], ["slow", 90, 60], ["slow", 120, 60], ["fine", 10, 60], ["fine", 20, 60], ["fine", 30, 60]]);
  const r = run();
  expect(r.status).toBe(0);
  expect(r.stdout).toMatch(/WARN lap step 'slow': median 100s over its last 3 runs, budget 60s/);
  expect(r.stdout).not.toMatch(/'fine'/);
});

test("one slow run among fast ones is not drift (median, and at least 3 runs)", () => {
  ledger([["a", 500, 60], ["a", 5, 60], ["a", 5, 60], ["b", 500, 60], ["b", 500, 60]]);
  expect(run().stdout).not.toMatch(/WARN lap step/);
});

test("a step with no budget is never drift", () => {
  ledger([["nobudget", 900, "-"], ["nobudget", 900, "-"], ["nobudget", 900, "-"]]);
  expect(run().stdout).not.toMatch(/WARN lap step/);
});

test("docs naming a missing make target, script path or make variable are named; real ones are not", () => {
  w("Makefile", "real-target: ## x\n\t@echo $(KNOWN_VAR)\n");
  w("scripts/real.sh", "echo ok\n");
  w("CLAUDE.md", [
    "Run `make real-target KNOWN_VAR=1` and `bash scripts/real.sh`.",
    "Run `make gone-target` first.",
    "See `scripts/vanished.sh` for it.",
    "Use `make real-target MISSING_KNOB=1`.",
    "The old `make old-thing` (retired) is not drift.",
    "Placeholders like `scripts/<name>.sh` and `scripts/*.sh` are skipped.",
  ].join("\n") + "\n");
  const out = run().stdout;
  expect(out).toMatch(/CLAUDE\.md:2: make target 'gone-target' is not defined/);
  expect(out).toMatch(/CLAUDE\.md:3: path 'scripts\/vanished\.sh' does not exist/);
  expect(out).toMatch(/CLAUDE\.md:4: variable MISSING_KNOB is read by nothing/);
  expect(out).not.toMatch(/real-target|real\.sh|KNOWN_VAR|old-thing|<name>|\*/);
});

test("skills and TESTING.md are read too, and a clean tree says so", () => {
  w("Makefile", "real-target: ##\n");
  w("TESTING.md", "Use `make nope`.\n");
  w(".claude/skills/s/SKILL.md", "Use `make nope2`.\n");
  const out = run().stdout;
  expect(out).toMatch(/TESTING\.md:1: make target 'nope'/);
  expect(out).toMatch(/SKILL\.md:1: make target 'nope2'/);
  fs.writeFileSync(path.join(T, "TESTING.md"), "Use `make real-target`.\n");
  fs.rmSync(path.join(T, ".claude"), { recursive: true });
  expect(run().stdout).toMatch(/^drift: no lap step over budget/);
});

test("the connector's Makefile counts as a source of targets", () => {
  w("Makefile", "a: ##\n");
  w("conn/Makefile", "conn-only: ##\n");
  w("CLAUDE.md", "Use `make conn-only`.\n");
  expect(run().stdout).toMatch(/make target 'conn-only'/);
  expect(run(["--connector", path.join(T, "conn")]).stdout).not.toMatch(/conn-only/);
});
