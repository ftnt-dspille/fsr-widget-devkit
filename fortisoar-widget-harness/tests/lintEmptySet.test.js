"use strict";
// The widget linters must FAIL on an empty set. Before this, a missing widget
// name, an absent widgets-src checkout or a tree with zero matching files made
// lint-testids and lint-angular print "ok" and exit 0, so `pnpm lint` could go
// green while scanning nothing. Each case drives the compiled CLI against a
// throwaway WIDGETS_SRC fixture (the same override the Makefile passes).

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const SCRIPTS = path.resolve(__dirname, "..", "scripts");

let tmpRoot;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lint-empty-set-"));
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function runCli(script, args) {
  try {
    const out = execFileSync("node", [path.join(SCRIPTS, script), ...args], {
      env: { ...process.env, WIDGETS_SRC: tmpRoot },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status, out: (e.stdout || "") + (e.stderr || "") };
  }
}

function writeFile(rel, body) {
  const p = path.join(tmpRoot, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
}

describe("lint-testids refuses an empty set", () => {
  test("no widgets under WIDGETS_SRC fails", () => {
    const r = runCli("lint-testids.js", []);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/no widgets found/);
    expect(r.out).not.toMatch(/ok \(/);
  });

  test("a scope name with no widget dir fails", () => {
    writeFile("realWidget/widget/view.html", "<div>ok</div>");
    const r = runCli("lint-testids.js", ["noSuchWidget"]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/no widget dir .* noSuchWidget/);
  });

  test("a scope with zero .html files fails", () => {
    writeFile("jsOnly/widget/view.controller.js", "// no templates here");
    const r = runCli("lint-testids.js", ["jsOnly"]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/0 \.html files/);
  });

  test("a clean scoped widget passes and reports what it scanned", () => {
    writeFile("cleanW/widget/view.html", '<button ng-click="go()" data-testid="go">go</button>');
    const r = runCli("lint-testids.js", ["cleanW"]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/ok \(1 html files scanned across 1 widget\(s\)\)/);
  });

  test("a violation is still reported (the gate has teeth)", () => {
    writeFile("badW/widget/view.html", '<button ng-click="go()">go</button>');
    const r = runCli("lint-testids.js", ["badW"]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/missing data-testid/);
  });

  test("multiple scopes are all scanned", () => {
    writeFile("aW/widget/view.html", '<div data-testid="a"></div>');
    writeFile("bW/widget/view.html", '<div data-testid="b"></div>');
    const r = runCli("lint-testids.js", ["aW", "bW"]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/across 2 widget\(s\)/);
  });
});

describe("lint-angular refuses an empty set", () => {
  test("no widgets under WIDGETS_SRC fails", () => {
    const r = runCli("lint-angular.js", []);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/no widget to lint/);
    expect(r.out).not.toMatch(/lint-angular: ok/);
  });

  test("a scope name with no widget dir fails", () => {
    writeFile("realWidget/widget/info.json", "{}");
    const r = runCli("lint-angular.js", ["noSuchWidget"]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/missing: noSuchWidget/);
  });

  test("an existing scoped widget passes", () => {
    writeFile("okW/widget/info.json", "{}");
    const r = runCli("lint-angular.js", ["okW"]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/lint-angular: .*0 error\(s\)/);
    expect(r.out).not.toMatch(/no widget to lint/);
  });

  test("several named widgets are all scanned", () => {
    writeFile("aW/widget/info.json", "{}");
    writeFile("bW/widget/info.json", "{}");
    const r = runCli("lint-angular.js", ["aW", "bW"]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/aW.widget.info\.json/);
    expect(r.out).toMatch(/bW.widget.info\.json/);
  });
});
