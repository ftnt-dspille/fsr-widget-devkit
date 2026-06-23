"use strict";
// Shared Playwright fixture for harness e2e specs. Use this `test`/`expect`
// instead of `@playwright/test` so every test inherits:
//   1. Console-error capture on the active page (and any page opened during
//      the test from the same context).
//   2. An `afterEach` that fails the test if any unexpected console error
//      was logged. Add intentional benign noise to BENIGN_CONSOLE_PATTERNS
//      with a comment explaining *why* it's benign.
//
// Usage:
//   const { test, expect } = require("../../../../fortisoar-widget-harness/tests/e2e/_fixtures");
//   test("does the thing", async ({ page, consoleErrors }) => { ... });
//
// `consoleErrors` is the live array if a test wants to assert on a subset
// (e.g. "no $parse errors after opening the multiselect"). Don't mutate it;
// the afterEach reads + resets it for you.

// Build on the per-worker isolation fixture (not raw @playwright/test) so every
// spec using these shared fixtures also inherits the worker-specific baseURL
// (14401 + parallelIndex). _isolated re-exports an extended `test` + `expect`.
import * as base from "./_isolated";
import { Page, TestInfo } from "@playwright/test";
import { waitForWidgetIdle } from "./_waitForWidgetIdle";

interface ConsoleErrorEntry {
  text: string;
  location?: {
    url?: string;
    lineNumber?: number;
    columnNumber?: number;
  };
  stack?: string;
}

const BENIGN_CONSOLE_PATTERNS = [
  // SOAR test host CSP (`default-src self` missing quotes) blocks Monaco
  // worker importScripts; the editor still works. See memory: soar_csp_bug.md.
  /Refused to (load|connect|execute).*Content Security Policy/i,
  /importScripts/i,
  // SOAR vendor app.unmin.js's modelMetadatasService.m() reads
  // `e["hydra:member"].forEach` without guarding against transient
  // proxy failures — when /api/3/model_metadatas times out, returns 502,
  // or auth lags, the response body is missing hydra:member and forEach
  // throws. AngularJS catches it as "Possibly unhandled rejection: {}".
  // Pre-existing vendor bug, no functional impact (later module use
  // re-fetches metadata). Don't suppress similar errors from our own code.
  /Cannot read properties of undefined \(reading 'forEach'\).*app\.unmin\.js/s,
  // Browser auto-logs "Failed to load resource" for any 4xx/5xx response.
  // Tests that intentionally route an endpoint to 500/404 to exercise an
  // error path will trip this; the in-code error handling is what's being
  // verified, not the browser's network-log noise.
  /Failed to load resource.*status of [45]\d{2}/i,
  // SOAR vendor pulls in a few CDN assets (toast-ui editor css/js, mathjax,
  // etc.) that we don't proxy in the dev harness. They're irrelevant to
  // widget functionality and DNS-fail in CI environments without internet.
  /ERR_NAME_NOT_RESOLVED/,
  // Contract drift tests intentionally load a fixture whose contract_version
  // is a MAJOR bump ahead of the widget's WIDGET_CONTRACT_VERSION. The widget
  // correctly logs console.error("[fsrSocAssistant] Connector contract …
  // MAJOR mismatch") — that IS the behavior under test. The tests verify the
  // banner/error-state via DOM assertions, not console output.
  /\[fsrSocAssistant\].*contract.*mismatch/i,
];

function attachConsoleCapture(page: Page, sink: ConsoleErrorEntry[]): void {
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      sink.push({
        text: msg.text(),
        location: msg.location(),
      });
    }
  });
  page.on("pageerror", (exception) => {
    sink.push({
      text: `Uncaught: ${exception.message}`,
      stack: exception.stack,
    });
  });
}

export const test = base.test.extend({
  // Auto-applies to every test that uses this `test`. The fixture replaces
  // the default `page` so it ships with console capture wired up before the
  // test body runs.
  consoleErrors: async ({}, use) => {
    const errs: ConsoleErrorEntry[] = [];
    await use(errs);
  },

  page: async ({ page, context, consoleErrors }, use) => {
    attachConsoleCapture(page, consoleErrors);
    // Catch console output from any *additional* pages the test opens
    // (popups, modals that spawn frames, etc.).
    context.on("page", (p) => attachConsoleCapture(p, consoleErrors));
    await use(page);
  },
});

test.afterEach(async ({ consoleErrors, page }, testInfo: TestInfo) => {
  const offenders = consoleErrors.filter(
    (e) => !BENIGN_CONSOLE_PATTERNS.some((re) => re.test(e.text))
  );
  if (offenders.length > 0) {
    throw new Error(
      `[${testInfo.title}] ${offenders.length} unexpected console error(s):\n` +
        JSON.stringify(offenders, null, 2)
    );
  }

  // Catch the "[object Object]" stringification bug class. AngularJS bindings
  // that target an input/textarea/contenteditable but receive an object stringify
  // to the literal "[object Object]" — visible to users but easy to miss in tests.
  // Scan the live DOM after every test; if it shows up anywhere we treat it as
  // a regression in field-type coercion / value binding.
  let stringifiedObjects: object[] = [];
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- page.evaluate result is dynamic
    stringifiedObjects = await page.evaluate(() => {
      const hits: Array<{
        kind: string;
        where: string;
        name?: string;
        snippet?: string;
      }> = [];
      const NEEDLE = "[object Object]";
      // Inputs/textareas: check .value
      document.querySelectorAll("input, textarea").forEach((el) => {
        const input = el as HTMLInputElement | HTMLTextAreaElement;
        if (input.value === NEEDLE) {
          hits.push({
            kind: input.tagName.toLowerCase(),
            where: "value",
            name: input.name || input.id || "(unnamed)",
          });
        }
      });
      // Visible text nodes: anything rendering the literal string
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        null
      );
      let node = walker.nextNode();
      while (node) {
        if (node.nodeValue && node.nodeValue.includes(NEEDLE)) {
          const parent = node.parentElement;
          if (parent) {
            const tag = parent.tagName.toLowerCase();
            // Skip <script>/<style> noise
            if (tag !== "script" && tag !== "style") {
              hits.push({
                kind: "text",
                where: tag,
                snippet: node.nodeValue.trim().slice(0, 80),
              });
            }
          }
        }
        node = walker.nextNode();
      }
      return hits;
    });
  } catch (_) {
    // page may be closed (e.g. test failed earlier); ignore.
  }
  if (stringifiedObjects.length > 0) {
    throw new Error(
      `[${testInfo.title}] DOM contains "[object Object]" — likely an Angular binding ` +
        `received an object where a string was expected:\n` +
        JSON.stringify(stringifiedObjects, null, 2)
    );
  }
});

export const expect = base.expect;
export { waitForWidgetIdle };
export { BENIGN_CONSOLE_PATTERNS };
