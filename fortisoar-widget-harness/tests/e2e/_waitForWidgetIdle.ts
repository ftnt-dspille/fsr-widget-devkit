"use strict";
// Side-effect-free e2e helper (safe to require from any spec, regardless of
// whether it uses the vanilla `@playwright/test` `test` or the extended one in
// `_fixtures.js` — requiring this file registers NO hooks).
//
// Wait for a widget to reach `idle`, but fast-fail the moment the harness
// reports a bootstrap-blocking lint error (e.g. a version↔controller-name
// mismatch from a hand-edited info.json). Without this, a lint-blocked mount
// never sets the widget's probe global, so a plain
// `waitForFunction(state==='idle')` just burns its full timeout and the
// failure reads like "the SOAR box is down" rather than "you desynced the
// controller name". `probeGlobal` is the widget's window probe key
// (e.g. "__fsrSocAssistant__"); pass the same `state` it exposes.
import { Page } from "@playwright/test";

interface WaitOptions {
  timeout?: number;
  state?: string;
}

interface LintIssue {
  code: string;
  message: string;
}

export async function waitForWidgetIdle(
  page: Page,
  probeGlobal: string,
  opts?: WaitOptions
): Promise<void> {
  const { timeout = 15000, state = "idle" } = opts || {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- page.evaluate result is dynamic
  const handle = await page.waitForFunction(
    ([probe, wantState]: [string, string]) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- window globals are dynamic
      if ((window as any).__HARNESS_LINT_BLOCKED__) {
        return { blocked: (window as any).__HARNESS_LINT_BLOCKED__ };
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- window globals are dynamic
      const p = (window as any)[probe];
      if (p && p.state === wantState) return { idle: true };
      return false;
    },
    [probeGlobal, state],
    { timeout }
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- jsonValue result is dynamic
  const result = (await handle.jsonValue()) as any;
  if (result && result.blocked) {
    const lines = result.blocked
      .map((e: LintIssue) => `  • [${e.code}] ${e.message}`)
      .join("\n");
    throw new Error(
      "Widget bootstrap was LINT-BLOCKED (not a box/network failure). " +
        "This is almost always a hand-edited info.json version that desynced " +
        "the controller registration names — let the bump process " +
        "(`widget.js push --bump`) rewrite them instead of editing info.json " +
        "by hand:\n" +
        lines
    );
  }
}
