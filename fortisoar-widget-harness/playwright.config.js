"use strict";
// Load .env at config-time so FSR_BASE_URL/FSR_USERNAME/FSR_PASSWORD/WIDGETS_SRC
// can come from the same .env file the dev server uses. Tests that mock
// /api/3 routes still pass with stub creds; tests that hit real SOAR will
// use the credentials from .env if present.
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { defineConfig, devices } = require("@playwright/test");

// In the monorepo, widgets-src is a SYMLINK to ../widgets-src. Playwright's
// spec walker does not descend symlinked directories, so per-widget specs under
// it (c3charts, widget-action-renderer, …) were silently skipped — discovery
// found only the harness's own tests/e2e and the top-level examples. We resolve
// the symlink to its real path and give it its own project testDir below so the
// walker actually traverses it. In a standalone GitHub clone the symlink is
// absent; realWidgetsSrc() returns null and the project is simply not added.
function realWidgetsSrc() {
  try {
    return fs.realpathSync(path.join(__dirname, "widgets-src"));
  } catch {
    return null;
  }
}

const sharedUse = { ...devices["Desktop Chrome"] };
const projects = [
  {
    name: "chromium",
    testDir: __dirname,
    testMatch: ["tests/e2e/**/*.spec.js", "examples/*/tests/e2e/**/*.spec.js"],
    use: sharedUse,
  },
];
const widgetsSrc = realWidgetsSrc();
if (widgetsSrc) {
  projects.push({
    name: "widgets",
    testDir: widgetsSrc,
    testMatch: ["*/tests/e2e/**/*.spec.js"],
    use: sharedUse,
  });
}

// Discover specs both in the harness's own tests/e2e/ AND in each widget's
// tests/e2e/ folder, so per-widget regression tests live alongside the
// widget source they exercise.
module.exports = defineConfig({
  // testDir is the harness itself (not the monorepo parent) so a standalone
  // GitHub clone discovers specs too. widgets-src is the monorepo's symlink
  // when present; examples/ ships the bundled example spec for a fresh clone.
  testDir: __dirname,
  // Phase 4 hermetic enforcement: after the suite, fail if any per-worker server
  // recorded a 599 HERMETIC-MISS (a leak to the forticloud proxy). No-op on live
  // runs. See tests/e2e/_hermeticTeardown.js.
  globalTeardown: require.resolve("./tests/e2e/_hermeticTeardown.js"),
  // By default the e2e suite runs FULLY LOCALLY against the mocked SOAR proxy —
  // no FortiSOAR login required. Specs whose filename contains "Live"/"live"
  // drive a real box and are excluded unless E2E_LIVE=1 (see `test:e2e:live`).
  testIgnore: process.env.E2E_LIVE ? [] : ["**/*[Ll]ive*.spec.js"],
  timeout: 45000,
  expect: { timeout: 10000 },
  // NO retries — a retry masks a real failure as "flaky" (green-with-asterisk),
  // which we explicitly reject: a test that fails once is a failure. Boot starves
  // under worker contention, so the fix is fewer workers + a longer boot wait,
  // not a retry that hides the symptom. `trace: "retain-on-failure"` captures the
  // failing run directly.
  retries: 0,
  // 2 workers, and crucially each gets its OWN dev server (see webServer below)
  // so they never contend on a single shared Node process. This is what lets us
  // run retries:0 without boot-timeout flakes. Keep workers == webServer count:
  // a worker's parallelIndex selects its server port (14401 + index) via the
  // _isolated.js baseURL fixture. Live runs go serial against the real box.
  workers: process.env.E2E_LIVE ? 1 : 2,
  fullyParallel: true,
  reporter: "list",
  // Tests run against a dedicated harness on port 14401 so they never collide
  // with a developer's `pnpm start` on 14400. Each test invocation boots its
  // own server; reuseExistingServer:true skips the boot only if 14401 is
  // already serving (e.g. a previous test run left it running, or you have
  // another playwright watch running).
  use: {
    baseURL: "http://localhost:14401",
    trace: "retain-on-failure",
  },
  // Two projects: the harness's own tests/e2e + examples (testDir __dirname),
  // and the symlinked monorepo widgets-src resolved to its real path (see
  // realWidgetsSrc above). Both share the Desktop Chrome device. The widgets
  // project is omitted entirely in a standalone clone where the symlink is gone.
  projects,
  // One dev server PER WORKER (ports 14401, 14402) so the two workers never
  // share a Node process. parallelIndex → port mapping lives in _isolated.js.
  webServer: [14401, 14402].map((port) => ({
    command: `node server.js`,
    url: `http://localhost:${port}`,
    reuseExistingServer: true,
    timeout: 60000,
    env: {
      FSR_BASE_URL: process.env.FSR_BASE_URL || process.env.FORTISOAR_HOST || "https://soar.test.invalid",
      FSR_USERNAME: process.env.FSR_USERNAME || process.env.FORTISOAR_USERNAME || "admin",
      FSR_PASSWORD: process.env.FSR_PASSWORD || process.env.FORTISOAR_PASSWORD || "test",
      WIDGETS_SRC: process.env.WIDGETS_SRC || "",
      PORT: String(port),
      // Mock gate runs hermetic by default: the proxy fallthrough to forticloud
      // is disabled and any un-snapshotted asset returns a loud 599 HERMETIC-MISS
      // instead of silently proxying (a real-box 502 could otherwise red a mock
      // test). Live runs (E2E_LIVE) leave it off so they reach the real box.
      // Override with FSR_HERMETIC=0 to debug against the proxy.
      FSR_HERMETIC: process.env.FSR_HERMETIC || (process.env.E2E_LIVE ? "0" : "1"),
    },
  })),
});
