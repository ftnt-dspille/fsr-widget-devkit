"use strict";
// Reusable widget probe: drive a widget through a named scenario, then dump
// every console.error / unhandled rejection / Angular exception the harness
// captured (with creation-site stacks for $q rejections, thanks to the
// harness's $q decorator). Companion to _fixtures.js — use this when you
// want a single self-contained "open widget X, do thing Y, tell me what
// went wrong" run instead of writing a full spec.
//
// Usage:
//   const { probeWidget } = require("./_probe");
//   const report = await probeWidget(page, "c3Charts", async (page) => {
//     await page.locator("#edit-config").click();
//     await page.waitForSelector("#edit-modal-body");
//   });
//   expect(report.errors).toEqual([]);
//
// `report` is the snapshot from window.__harness.dump() merged with the
// Playwright-side console capture, so it covers both: drawer-buffer state
// (Angular exceptions, network) AND raw Playwright console events (which
// catch errors fired before the harness drawer mounts).

import fs = require("fs");
import path = require("path");
import { Page, ConsoleMessage } from "@playwright/test";

interface WidgetInfo {
  id: string;
  name: string;
}

interface DrawerDump {
  errors: Array<{message?: string; stack?: string}>;
  [key: string]: unknown;
}

interface ProbeReport {
  widget: string;
  ts: number;
  scenarioError: {message: string; stack?: string} | null;
  drawer: DrawerDump | null;
  playwrightConsoleErrors: Array<{type: string; text: string; loc?: unknown}>;
  playwrightPageErrors: Array<{message: string; stack?: string}>;
}

interface ProbeOptions {
  path?: string;
  settleMs?: number;
  outFile?: string;
  screenshotPath?: string;
}

async function selectWidget(page: Page, widgetName: string): Promise<void> {
  const select = page.locator("#widget-select");
  // The harness chrome now drives widget choice through a custom picker button,
  // leaving the native #widget-select present-but-hidden. Playwright's
  // selectOption requires visibility, so set the value + dispatch `change`
  // directly (the harness listens for change to remount) — robust to the hidden
  // native control.
  await select.waitFor({ state: "attached", timeout: 10000 });
  const resp = await page.request.get("/_fsr/widgets");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- response json is dynamic
  const { widgets } = (await resp.json()) as {widgets: WidgetInfo[]};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- search result is dynamic
  const w = widgets.find((x: any) => x.name === widgetName);
  if (!w) throw new Error("probeWidget: widget not found: " + widgetName);
  await page.evaluate((id) => {
    const sel = document.getElementById("widget-select") as HTMLSelectElement | null;
    if (!sel) return;
    sel.value = id;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  }, w.id);
}

export async function probeWidget(
  page: Page,
  widgetName: string,
  scenario: (page: Page) => Promise<void>,
  opts?: ProbeOptions
): Promise<ProbeReport> {
  opts = opts || {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- console message is dynamic
  const playwrightConsole: Array<{type: string; text: string; loc?: any}> = [];
  const playwrightErrors: Array<{message: string; stack?: string}> = [];
  page.on("console", (msg: ConsoleMessage) => {
    playwrightConsole.push({ type: msg.type(), text: msg.text(), loc: msg.location() });
  });
  page.on("pageerror", (e) => {
    playwrightErrors.push({ message: e.message, stack: e.stack });
  });

  await page.goto(opts.path || "/", { waitUntil: "domcontentloaded" });
  await selectWidget(page, widgetName);
  // Selecting a widget re-bootstraps Angular which destroys the JS execution
  // context. Wait for the widget container to settle, then poll until
  // window.__harness is available again before clearing buffers.
  await page.locator("#widget-container [data-ng-controller], #widget-container [ng-controller]")
    .first().waitFor({ state: "attached", timeout: 15000 }).catch(() => {});
  await page.waitForFunction(() => !!(window as any).__harness, null, { timeout: 5000 }).catch(() => {});
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- window globals are dynamic
  await page.evaluate(() => { try { (window as any).__harness && (window as any).__harness.clear(); } catch (_) {} });

  let scenarioError: {message: string; stack?: string} | null = null;
  try {
    await scenario(page);
  } catch (e) {
    const err = e as Error;
    scenarioError = { message: err.message, stack: err.stack };
  }

  // Let any trailing $digest / unhandledrejection settle.
  await page.waitForTimeout(opts.settleMs != null ? opts.settleMs : 1500);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- window globals are dynamic
  const dump = await page.evaluate(() => {
    if (!(window as any).__harness) return null;
    return (window as any).__harness.dump();
  });

  const report: ProbeReport = {
    widget: widgetName,
    ts: Date.now(),
    scenarioError: scenarioError,
    drawer: dump,
    playwrightConsoleErrors: playwrightConsole.filter((m) => m.type === "error"),
    playwrightPageErrors: playwrightErrors,
  };

  if (opts.outFile) {
    fs.mkdirSync(path.dirname(opts.outFile), { recursive: true });
    fs.writeFileSync(opts.outFile, JSON.stringify(report, null, 2));
  }
  if (opts.screenshotPath) {
    await page.screenshot({ path: opts.screenshotPath, fullPage: true }).catch(() => {});
  }
  return report;
}

// Convenience: filter benign known-noisy errors out of a report so callers
// can `expect(meaningfulErrors(report)).toEqual([])`.
const BENIGN_PATTERNS = [
  /Refused to (load|connect|execute).*Content Security Policy/i,
  /importScripts/i,
  /Cannot read properties of undefined \(reading 'forEach'\).*app\.unmin\.js/s,
];

export function meaningfulErrors(report: ProbeReport): Array<{
  from: string;
  message?: string;
  text?: string;
  stack?: string;
  [key: string]: unknown;
}> {
  const all: Array<{
    from: string;
    message?: string;
    text?: string;
    stack?: string;
    [key: string]: unknown;
  }> = [];
  (report.drawer && report.drawer.errors || []).forEach((e) =>
    all.push({ from: "drawer", ...e })
  );
  (report.playwrightConsoleErrors || []).forEach((e) =>
    all.push({ from: "playwright-console", text: e.text })
  );
  (report.playwrightPageErrors || []).forEach((e) =>
    all.push({ from: "playwright-pageerror", message: e.message, stack: e.stack })
  );
  return all.filter((e) => {
    const text = (e.message || e.text || "") as string;
    return !BENIGN_PATTERNS.some((re) => re.test(text));
  });
}
