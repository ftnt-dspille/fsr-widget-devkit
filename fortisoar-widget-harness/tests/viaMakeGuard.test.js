"use strict";
// The runner refusal shared by jest and Playwright (scripts/via-make-guard.js),
// and the two jest globalSetup modules that call it. Under Claude Code (CLAUDECODE
// set) a run starts only from a make target, which exports VIA_MAKE=1. This suite
// cannot start jest directly to prove the refusal (the agent is refused), so both
// branches are driven here as units, plus a check that the configs wire them in.

const fs = require("fs");
const path = require("path");
const { assertViaMake } = require("../scripts/via-make-guard");
const jestGlobalSetup = require("../scripts/jest-via-make");
const jestLiveGlobalSetup = require("../scripts/jest-live-via-make");

const HARNESS = path.resolve(__dirname, "..");
const KEYS = ["CLAUDECODE", "VIA_MAKE"];

// Run fn with CLAUDECODE/VIA_MAKE set exactly as given, then restore the caller's.
async function withEnv(vars, fn) {
  const saved = {};
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  Object.assign(process.env, vars);
  try {
    return await fn();
  } finally {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

describe("assertViaMake", () => {
  test("refuses under CLAUDECODE when no make target set VIA_MAKE", () => {
    expect(() => assertViaMake("make test-e2e-spec", { CLAUDECODE: "1" })).toThrow(
      /run via make test-e2e-spec: jest and Playwright refuse to start under Claude Code/
    );
  });

  test("lets a run through when VIA_MAKE=1 is set by the make target", () => {
    expect(() => assertViaMake("make test-e2e-spec", { CLAUDECODE: "1", VIA_MAKE: "1" })).not.toThrow();
  });

  test("never refuses a human shell (CLAUDECODE unset)", () => {
    expect(() => assertViaMake("make test-unit WIDGET=<name>", {})).not.toThrow();
  });
});

describe("jest globalSetup (harness suite)", () => {
  test("refuses under CLAUDECODE without VIA_MAKE, naming the make target", async () => {
    await withEnv({ CLAUDECODE: "1" }, () =>
      expect(jestGlobalSetup()).rejects.toThrow("run via make test-unit WIDGET=<name>")
    );
  });

  test("passes under CLAUDECODE when VIA_MAKE=1", async () => {
    await withEnv({ CLAUDECODE: "1", VIA_MAKE: "1" }, () => expect(jestGlobalSetup()).resolves.toBeUndefined());
  });

  test("passes for a human shell", async () => {
    await withEnv({}, () => expect(jestGlobalSetup()).resolves.toBeUndefined());
  });
});

describe("jest globalSetup (live suite)", () => {
  test("refuses under CLAUDECODE without VIA_MAKE, naming the live make targets", async () => {
    await withEnv({ CLAUDECODE: "1" }, () =>
      expect(jestLiveGlobalSetup()).rejects.toThrow("make test-matrix-live")
    );
  });

  test("passes under CLAUDECODE when VIA_MAKE=1", async () => {
    await withEnv({ CLAUDECODE: "1", VIA_MAKE: "1" }, () =>
      expect(jestLiveGlobalSetup()).resolves.toBeUndefined()
    );
  });
});

describe("the configs wire the refusal in", () => {
  test("jest.config.js runs the harness globalSetup", () => {
    const text = fs.readFileSync(path.join(HARNESS, "jest.config.js"), "utf8");
    expect(text).toMatch(/globalSetup:\s*"<rootDir>\/scripts\/jest-via-make\.js"/);
  });

  test("jest.live.config.js runs the live globalSetup", () => {
    const text = fs.readFileSync(path.join(HARNESS, "jest.live.config.js"), "utf8");
    expect(text).toMatch(/globalSetup:\s*"<rootDir>\/scripts\/jest-live-via-make\.js"/);
  });

  test("playwright.config.ts refuses before the port claim runs", () => {
    const text = fs.readFileSync(path.join(HARNESS, "playwright.config.ts"), "utf8");
    expect(text).toMatch(/require\("\.\/scripts\/via-make-guard"\)\.assertViaMake\("make test-e2e-spec"\)/);
    expect(text.indexOf("assertViaMake(")).toBeLessThan(text.indexOf("resolveBasePort()"));
  });
});
