"use strict";
// make bench: scripts/devloop_compare.py reads the lap ledger against the baseline,
// and scripts/devloop_bench.sh drives a throwaway branch through the two doors and
// never promotes it.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync, execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
let T, ENV;
beforeEach(() => {
  T = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "bench-")));
  fs.writeFileSync(path.join(T, "gitconfig"), "[user]\n\tname = t\n\temail = t@example.com\n");
  ENV = { ...process.env, GIT_CONFIG_GLOBAL: path.join(T, "gitconfig"), GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "core.hooksPath", GIT_CONFIG_VALUE_0: "/dev/null" };
  for (const k of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "CLAUDECODE"]) delete ENV[k];
});
afterEach(() => fs.rmSync(T, { recursive: true, force: true }));
const g = (dir, ...a) => execFileSync("git", ["-C", dir, ...a], { env: ENV, encoding: "utf8" }).trim();

describe("devloop_compare.py", () => {
  const rows = (list) => list.map(([ts, label, s]) => `${ts}\t${label}\t${s}\t0\t-\trepo\t-`).join("\n") + "\n";
  const compare = (list) => {
    fs.writeFileSync(path.join(T, "laps.tsv"), rows(list));
    return spawnSync("python3", [path.join(ROOT, "scripts/devloop_compare.py"), "--ledger", path.join(T, "laps.tsv"), "--since", "2026-06-01T00:00:00Z"], { encoding: "utf8" }).stdout;
  };
  const T1 = "2026-06-01T10:00:00Z";

  test("push+stamp is the ship minus promote and CI wait; code and check are summed against code+test plus the full suite", () => {
    const out = compare([[T1, "bench setup", 20], [T1, "bench code", 1], [T1, "bench check", 100], [T1, "bench commit", 2],
      [T1, "bench ship", 400], [T1, "promote", 30], [T1, "promote ci-wait", 200]]);
    expect(out).toMatch(/setup\s+30s\s+20s\s+-10s/);
    expect(out).toMatch(/code \+ check\s+570s\s+101s\s+-469s/);
    expect(out).toMatch(/push\+stamp\s+360s\s+170s\s+-190s/);
    expect(out).toMatch(/promote\s+90s\s+30s\s+-60s/);
    expect(out).toMatch(/CI wait 200s is not in the table/);
    expect(out).toMatch(/FASTER/);
  });

  test("rows from before the run are ignored, a phase that did not run says so, and slower says NOT FASTER", () => {
    const out = compare([["2025-01-01T00:00:00Z", "bench setup", 9999], [T1, "bench setup", 500], [T1, "bench code", 1], [T1, "bench check", 900]]);
    expect(out).toMatch(/setup\s+30s\s+500s/);
    expect(out).toMatch(/commit\s+60s\s+not run/);
    expect(out).toMatch(/NOT FASTER/);
  });
});

describe("devloop_bench.sh", () => {
  function world() {
    const dir = path.join(T, "conn_main"), bare = path.join(T, "conn.remote.git");
    fs.mkdirSync(path.join(dir, "connector-fsr-agentic-assistant"), { recursive: true });
    execFileSync("git", ["init", "-q", "--bare", "-b", "main", bare], { env: ENV });
    g(dir, "init", "-q", "-b", "main");
    fs.writeFileSync(path.join(dir, "connector-fsr-agentic-assistant/tool_labels.py"), "X = 1\n");
    g(dir, "add", "-A"); g(dir, "commit", "-q", "-m", "base");
    g(dir, "remote", "add", "origin", bare); g(dir, "push", "-q", "-u", "origin", "main");
    const make = path.join(T, "fakemake"), log = path.join(T, "make.log");
    fs.writeFileSync(make, `#!/usr/bin/env bash\necho "make $* | FSR_ALL_WIDGETS=\${FSR_ALL_WIDGETS:-}" >> "${log}"\n[ -n "\${BENCH_FAIL:-}" ] && [[ "$*" == *"$BENCH_FAIL"* ]] && exit 1\nexit 0\n`, { mode: 0o755 });
    return { dir, bare, make, log };
  }
  const bench = (w, env = {}) => spawnSync("bash", [path.join(ROOT, "scripts/devloop_bench.sh")], {
    encoding: "utf8", timeout: 60000,
    env: { ...ENV, BOX: "92", CONN_REPO: w.dir, BENCH_MAKE: w.make, FSR_LAP_LEDGER: path.join(T, "laps.tsv"), ...env },
  });

  test("drives check, then a dry-run ship, from a throwaway worktree; records every phase; leaves nothing behind", () => {
    const w = world();
    const r = bench(w);
    expect(r.status).toBe(0);
    const calls = fs.readFileSync(w.log, "utf8").split("\n").filter(Boolean);
    expect(calls.map((c) => c.split(" ")[1] + " " + c.split(" ").slice(2, 4).join(" ")).length).toBe(2);
    expect(calls[0]).toMatch(/ check /);
    expect(calls[1]).toMatch(/ ship BOX=92 DRY_RUN=1/);
    expect(calls[0]).toMatch(new RegExp(`FSR_ALL_WIDGETS=${ROOT}`));
    expect(calls.some((c) => /promote/.test(c))).toBe(false);
    const ledger = fs.readFileSync(path.join(T, "laps.tsv"), "utf8");
    for (const p of ["setup", "code", "check", "commit", "ship"]) expect(ledger).toMatch(new RegExp(`\\tbench ${p}\\t`));
    expect(r.stdout).toMatch(/phase\s+baseline\s+now/);
    // nothing left: no bench branch locally or on the remote, no worktree, main untouched
    expect(g(w.dir, "branch", "--list", "bench/*")).toBe("");
    expect(g(w.dir, "worktree", "list").split("\n").length).toBe(1);
    expect(execFileSync("git", ["-C", w.bare, "branch", "--list", "bench/*"], { env: ENV, encoding: "utf8" }).trim()).toBe("");
    expect(g(w.dir, "rev-parse", "main")).toBe(g(w.dir, "rev-parse", "origin/main"));
  });

  test("the edit is committed on the throwaway branch in the package, so the diff ships", () => {
    const w = world();
    bench(w);
    // the branch is gone after the run; the ship call saw a worktree whose commit touched the package file
    const calls = fs.readFileSync(w.log, "utf8");
    expect(calls).toMatch(/-C \S*conn_main ship/);
  });

  test("a failing door stops the benchmark, says it is not a measurement, and still cleans up", () => {
    const w = world();
    const r = bench(w, { BENCH_FAIL: " check" });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/not a measurement/);
    expect(fs.readFileSync(w.log, "utf8")).not.toMatch(/ ship /);
    expect(g(w.dir, "branch", "--list", "bench/*")).toBe("");
  });

  test("needs a BOX", () => {
    const w = world();
    const r = bench(w, { BOX: "" });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/pass BOX=<alias>/);
  });
});
