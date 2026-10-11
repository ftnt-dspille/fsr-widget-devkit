"use strict";

// lib/widgetAssets.js builds a widget repo's own TypeScript (its tsconfig.json)
// so the gitignored compiled .js exists before jest, playwright, the server or
// the packager load it. These tests run the real harness tsc on throwaway widget
// dirs under the OS temp dir.

const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  buildWidgetAssets,
  buildAllWidgetAssets,
  widgetRoots,
} = require("../lib/widgetAssets");

const TSCONFIG = {
  compilerOptions: {
    target: "ES2017",
    module: "CommonJS",
    strict: true,
    skipLibCheck: true,
    ignoreDeprecations: "5.0",
  },
  include: ["widgetAssets/js/*.ts"],
};

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "widget-assets-"));
}

function makeWidget(root, name, { tsSource, withTsconfig = true } = {}) {
  const dir = path.join(root, name);
  fs.mkdirSync(path.join(dir, "widgetAssets", "js"), { recursive: true });
  if (withTsconfig) {
    fs.writeFileSync(path.join(dir, "tsconfig.json"), JSON.stringify(TSCONFIG));
  }
  if (tsSource !== undefined) {
    fs.writeFileSync(path.join(dir, "widgetAssets", "js", "helper.ts"), tsSource);
  }
  return dir;
}

const GOOD_TS = "const answer: number = 42;\nfunction add(a: number, b: number): number { return a + b; }\n";

describe("buildWidgetAssets", () => {
  test("compiles the widget's .ts to a .js beside it", () => {
    const dir = makeWidget(tmpRoot(), "w1", { tsSource: GOOD_TS });
    expect(buildWidgetAssets(dir)).toBe(true);
    const out = path.join(dir, "widgetAssets", "js", "helper.js");
    expect(fs.existsSync(out)).toBe(true);
    const js = fs.readFileSync(out, "utf8");
    expect(js).toMatch(/const answer = 42;/);
    expect(js).not.toMatch(/: number/);
  });

  test("a dir with no tsconfig.json is skipped and nothing is written", () => {
    const dir = makeWidget(tmpRoot(), "plain", { tsSource: GOOD_TS, withTsconfig: false });
    expect(buildWidgetAssets(dir)).toBe(false);
    expect(fs.existsSync(path.join(dir, "widgetAssets", "js", "helper.js"))).toBe(false);
  });

  test("a type error throws (the widget must not package or serve stale assets)", () => {
    const dir = makeWidget(tmpRoot(), "broken", { tsSource: 'const n: number = "x";\n' });
    expect(() => buildWidgetAssets(dir)).toThrow(/widget TypeScript build failed[\s\S]*TS2322/);
  });
});

describe("buildAllWidgetAssets", () => {
  test("builds every widget dir under the root that has a tsconfig.json", () => {
    const root = tmpRoot();
    const a = makeWidget(root, "withConfig", { tsSource: GOOD_TS });
    makeWidget(root, "noConfig", { tsSource: GOOD_TS, withTsconfig: false });
    fs.mkdirSync(path.join(root, ".hidden"));
    const built = buildAllWidgetAssets([root]);
    expect(built).toEqual([a]);
    expect(fs.existsSync(path.join(a, "widgetAssets", "js", "helper.js"))).toBe(true);
    expect(fs.existsSync(path.join(root, "noConfig", "widgetAssets", "js", "helper.js"))).toBe(false);
  });
});

describe("widgetRoots", () => {
  const saved = process.env.WIDGETS_SRC;
  afterEach(() => {
    if (saved === undefined) delete process.env.WIDGETS_SRC;
    else process.env.WIDGETS_SRC = saved;
  });

  test("WIDGETS_SRC is the first root, and the bundled examples/ stay mounted", () => {
    const root = tmpRoot();
    process.env.WIDGETS_SRC = root;
    const roots = widgetRoots();
    expect(roots[0]).toBe(path.resolve(root));
    expect(roots.some((r) => path.basename(r) === "examples")).toBe(true);
  });
});
