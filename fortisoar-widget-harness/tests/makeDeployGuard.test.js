"use strict";
// The Makefile half of the effect-level guards (TESTING.md, "Guardrails").
// Protected deploy targets must run deploy-guard before anything else. That is
// checked with `make -n`, which prints the plan and runs nothing (a $(MAKE) line
// recurses under -n but the sub-make prints too). The refusal itself is checked by
// running deploy-guard alone, which has no other recipe, so no deploy can start.

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const REPO = path.resolve(__dirname, "..", "..");
const PROTECTED = ["release", "push", "widget-push", "ship-verify"];
// Every target that drives a jest or Playwright run. Keep in step with the
// "Effect-level guards" block at the top of the Makefile.
const RUNNERS = [
  "test-unit", "test-e2e-headed", "test-e2e-spec", "turn-hermetic", "test-mcp-surface-live",
  "test-live-sweep", "test-matrix-live", "test-matrix-local", "test-ar-live",
  "test-designer-stage-live", "widget-inspect", "introspect", "introspect-soar",
];
const GUARD_LINE = /^if \[ -n "\$CLAUDECODE" \] && \[ "\$CONFIRM_DEPLOY" != 1 \]/;
const GUARD_MSG = /deploys\/releases are the user's to run; a human can override with CONFIRM_DEPLOY=1/;

function make(args, env = {}) {
  const base = { ...process.env };
  for (const k of ["CLAUDECODE", "CONFIRM_DEPLOY", "VIA_MAKE"]) delete base[k];
  const r = spawnSync("make", args, { cwd: REPO, env: { ...base, ...env }, encoding: "utf8", timeout: 60000 });
  return { code: r.status, out: `${r.stdout || ""}${r.stderr || ""}` };
}

describe.each(PROTECTED)("make %s", (target) => {
  test("runs deploy-guard before any other step under CLAUDECODE", () => {
    const r = make(["-n", target, "WIDGET=x"], { CLAUDECODE: "1" });
    expect(r.code).toBe(0);
    const first = r.out.split("\n").find((l) => l.trim() !== "");
    expect(first).toMatch(GUARD_LINE);
  });

  test("the same plan with CONFIRM_DEPLOY=1 is not refused", () => {
    const r = make(["-n", target, "WIDGET=x", "CONFIRM_DEPLOY=1"], { CLAUDECODE: "1" });
    expect(r.code).toBe(0);
  });
});

describe("deploy-guard (run for real: it has no other recipe)", () => {
  test("refuses under CLAUDECODE without CONFIRM_DEPLOY, exit 2, one-line reason", () => {
    const r = make(["deploy-guard"], { CLAUDECODE: "1" });
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/deploy-guard: deploys\/releases are the user's to run/);
    expect(r.out.trim().split("\n").filter((l) => GUARD_MSG.test(l))).toHaveLength(1);
  });

  test("CONFIRM_DEPLOY=1 lets it through", () => {
    const r = make(["deploy-guard", "CONFIRM_DEPLOY=1"], { CLAUDECODE: "1" });
    expect(r.code).toBe(0);
  });

  test("a human shell (no CLAUDECODE) is never refused", () => {
    const r = make(["deploy-guard"]);
    expect(r.code).toBe(0);
  });
});

describe("runner marks and unguarded targets", () => {
  test("every runner target is marked VIA_MAKE in the Makefile", () => {
    const mk = fs.readFileSync(path.join(REPO, "Makefile"), "utf8");
    const line = mk.split("\n").find((l) => /: export VIA_MAKE := 1$/.test(l));
    expect(line).toBeDefined();
    const marked = line.split(":")[0].trim().split(/\s+/);
    for (const t of RUNNERS) expect(marked).toContain(t);
  });

  test("loop is marked VIA_LOOP (for its ship.sh widget step) and is not deploy-guarded", () => {
    const mk = fs.readFileSync(path.join(REPO, "Makefile"), "utf8");
    expect(mk).toMatch(/^loop: export VIA_LOOP := 1$/m);
    const rule = mk.split("\n").find((l) => /^loop:/.test(l));
    expect(rule).not.toMatch(/deploy-guard/);
  });

  test("test targets are not deploy-guarded under CLAUDECODE", () => {
    const unit = make(["-n", "test-unit"], { CLAUDECODE: "1" });
    expect(unit.code).toBe(0);
    expect(unit.out).not.toMatch(GUARD_MSG);
    const e2e = make(["-n", "test-e2e-spec", "WIDGET=x"], { CLAUDECODE: "1" });
    expect(e2e.code).toBe(0);
    expect(e2e.out).not.toMatch(GUARD_MSG);
  });
});
