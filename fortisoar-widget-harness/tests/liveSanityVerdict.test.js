"use strict";
// `make live-sanity` verdict + scoping rules. Box-free.
const { computeVerdict, formatReport } = require("../scripts/live-sanity/verdict");
const { REGISTRY, selectChecks } = require("../scripts/live-sanity/checks");

const P = (name) => ({ name, status: "PASS", detail: "ok" });
const F = (name, detail = "broke") => ({ name, status: "FAIL", detail });
const S = (name, detail) => ({ name, status: "SKIP", detail });

describe("live-sanity verdict", () => {
  test("all pass is VERIFIED and exits 0", () => {
    const v = computeVerdict([P("a"), P("b")]);
    expect(v.verdict).toBe("VERIFIED");
    expect(v.exitCode).toBe(0);
    expect(v.notRun).toEqual([]);
  });

  test("one skip demotes to PARTIAL and lists it as not run with its reason", () => {
    const v = computeVerdict([P("a"), S("ui", "WAF refuses headless")]);
    expect(v.verdict).toBe("PARTIAL");
    expect(v.exitCode).toBe(0);
    expect(v.notRun).toEqual([{ name: "ui", reason: "WAF refuses headless" }]);
    const text = formatReport([P("a"), S("ui", "WAF refuses headless")], v, { box: "x" });
    expect(text).toContain("NOT RUN (not verified):");
    expect(text).toContain("- ui: WAF refuses headless");
    expect(text).toContain("[[LIVE-SANITY-PARTIAL]]");
    expect(text).not.toContain("VERIFIED");
  });

  test("an unknown status counts as not run, never as a pass", () => {
    const v = computeVerdict([P("a"), { name: "b", status: "BLOCKED", detail: "upstream" }]);
    expect(v.verdict).toBe("PARTIAL");
    expect(v.notRun.map((n) => n.name)).toEqual(["b"]);
  });

  test("any fail is FAIL and exits non-zero, even beside skips", () => {
    const v = computeVerdict([P("a"), S("b", "x"), F("c", "no tool call")]);
    expect(v.verdict).toBe("FAIL");
    expect(v.exitCode).toBe(1);
    expect(v.failed).toEqual([{ name: "c", detail: "no tool call" }]);
  });

  test("an empty or all-skipped run proves nothing: FAIL", () => {
    expect(computeVerdict([]).verdict).toBe("FAIL");
    expect(computeVerdict([]).exitCode).toBe(1);
    expect(computeVerdict([S("a", "x")]).exitCode).toBe(1);
  });
});

describe("live-sanity scoping", () => {
  const names = (l) => l.map((c) => c.name);
  test("no widgets selects every available check", () => {
    expect(names(selectChecks(REGISTRY, []))).toEqual(names(REGISTRY.filter((c) => !c.available || c.available())));
  });
  test("a check whose target is not in this checkout is not selected (not a skip)", () => {
    const reg = [{ name: "a", lane: "x" }, { name: "later", lane: "y", available: () => false }];
    expect(names(selectChecks(reg, []))).toEqual(["a"]);
  });
  test("an unrelated widget keeps the box checks and its version check only", () => {
    expect(names(selectChecks(REGISTRY, ["fortiedrCommandTimeline"])))
      .toEqual(["connector_health", "workers", "widget_versions"]);
  });
  test("the Monitor scope adds the Monitor load, not the chat turn", () => {
    const n = names(selectChecks(REGISTRY, ["agenticAssistantMonitor"]));
    expect(n).toContain("monitor_loads");
    expect(n).not.toContain("chat_turn");
  });
  test("the assistant scope runs the chat turn, mount and designer stage", () => {
    const n = names(selectChecks(REGISTRY, ["fortiaiAgenticAssistant"]));
    expect(n).toEqual(expect.arrayContaining(["chat_turn", "assistant_mount", "designer_stage"]));
  });
});

describe("live-sanity stamps", () => {
  const fs = require("fs");
  const os = require("os");
  const path = require("path");
  const { execFileSync } = require("child_process");
  const { writeStamps, readStamp, proves } = require("../scripts/live-sanity/stamp");
  let tmp, repo;
  const g = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8" }).trim();

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lsst-"));
    process.env.FSR_LIVE_SANITY_DIR = path.join(tmp, "stamps");
    repo = path.join(tmp, "demoRepo");
    fs.mkdirSync(repo);
    g("init", "-q", "-b", "main");
    fs.writeFileSync(path.join(repo, "f.txt"), "1");
    g("add", "f.txt");
    g("-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "core.hooksPath=/dev/null", "commit", "-q", "-m", "x");
  });
  afterEach(() => { delete process.env.FSR_LIVE_SANITY_DIR; fs.rmSync(tmp, { recursive: true, force: true }); });

  test("a VERIFIED run on a clean tree writes a stamp that proves the sha", () => {
    writeStamps([repo], { box: "b", verdict: "VERIFIED", results: [P("a")] });
    const s = readStamp("demoRepo", g("rev-parse", "HEAD"));
    expect(s).toMatchObject({ repo: "demoRepo", branch: "main", dirty: false, box: "b", verdict: "VERIFIED" });
    expect(s.checks).toEqual([{ name: "a", status: "PASS", detail: "ok" }]);
    expect(proves(s)).toBe(true);
  });

  test("a dirty tree is stamped dirty and never proves the commit", () => {
    fs.writeFileSync(path.join(repo, "f.txt"), "2");
    writeStamps([repo], { box: "b", verdict: "VERIFIED", results: [P("a")] });
    const s = readStamp("demoRepo", g("rev-parse", "HEAD").slice(0, 8));
    expect(s.dirty).toBe(true);
    expect(proves(s)).toBe(false);
  });

  test("a deploy's own version bump is clean only when it is version-only", () => {
    fs.writeFileSync(path.join(repo, "info.json"), '{\n  "name": "c",\n  "version": "1.0.0"\n}\n');
    fs.writeFileSync(path.join(repo, "release_notes.md"), "# Notes\n");
    g("add", "info.json", "release_notes.md");
    g("-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "core.hooksPath=/dev/null", "commit", "-q", "-m", "y");
    fs.writeFileSync(path.join(repo, "info.json"), '{\n  "name": "c",\n  "version": "1.0.1"\n}\n');
    fs.writeFileSync(path.join(repo, "release_notes.md"), "# Notes\n\n## 1.0.1\n");
    const sha = g("rev-parse", "HEAD");
    // Without the deploy's declaration the bump is dirty, as before.
    writeStamps([repo], { box: "b", verdict: "VERIFIED", results: [P("a")] });
    expect(readStamp("demoRepo", sha).dirty).toBe(true);
    process.env.LIVE_SANITY_VERSION_BUMP_FILES = "info.json:release_notes.md";
    try {
      writeStamps([repo], { box: "b", verdict: "VERIFIED", results: [P("a")] });
      expect(proves(readStamp("demoRepo", sha))).toBe(true);
      // Anything beyond the version line is still dirty.
      fs.writeFileSync(path.join(repo, "info.json"), '{\n  "name": "d",\n  "version": "1.0.1"\n}\n');
      writeStamps([repo], { box: "b", verdict: "VERIFIED", results: [P("a")] });
      expect(readStamp("demoRepo", sha).dirty).toBe(true);
      fs.writeFileSync(path.join(repo, "info.json"), '{\n  "name": "c",\n  "version": "1.0.1"\n}\n');
      fs.writeFileSync(path.join(repo, "f.txt"), "2");
      writeStamps([repo], { box: "b", verdict: "VERIFIED", results: [P("a")] });
      expect(readStamp("demoRepo", sha).dirty).toBe(true);
    } finally { delete process.env.LIVE_SANITY_VERSION_BUMP_FILES; }
  });

  test("PARTIAL and FAIL are stamped with their verdict and do not prove", () => {
    for (const verdict of ["PARTIAL", "FAIL"]) {
      writeStamps([repo], { box: "b", verdict, results: [P("a")] });
      const s = readStamp("demoRepo", g("rev-parse", "HEAD"));
      expect(s.verdict).toBe(verdict);
      expect(proves(s)).toBe(false);
    }
  });
});
