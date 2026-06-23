"use strict";
// Ad-hoc diagnostic (NOT the playwright test runner): load the harness page,
// report console errors + whether external CDN scripts are reachable from the
// browser, then exit. Run: node tests/_diag_boot.js
import { chromium } from "@playwright/test";

interface BootDiagReport {
  probeState: string | null;
  bootBanner: string | null;
  cdnFetchFromBrowser: {ok: boolean; status?: number; error?: string};
  consoleErrs: string[];
  requestFailed: string[];
}

(async (): Promise<void> => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const consoleErrs: string[] = [];
  const failed: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrs.push(m.text());
  });
  page.on("requestfailed", (r) => {
    const failure = r.failure();
    failed.push(`${r.url()} :: ${failure && failure.errorText}`);
  });

  // Direct fetch test from inside the browser context.
  await page.goto(
    "http://localhost:14401/?widget=fsrPlaybookBuilder-1.0.30&context=Dashboard&mock=happy_path",
    { waitUntil: "domcontentloaded" }
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- window globals are dynamic
  const cdnProbe = await page.evaluate(async (): Promise<{ok: boolean; status?: number; error?: string}> => {
    const url = "https://cdnjs.cloudflare.com/ajax/libs/lodash.js/4.17.21/lodash.min.js";
    try {
      const r = await fetch(url, { method: "GET" });
      return { ok: r.ok, status: r.status };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  });

  // Give boot a moment.
  await page.waitForTimeout(4000);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- window globals are dynamic
  const probeState = await page.evaluate(
    (): string | null =>
      ((window as any).__fsrPlaybookBuilder__ && (window as any).__fsrPlaybookBuilder__.state) || null
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- DOM search is dynamic
  const bootBanner = await page.evaluate((): string | null => {
    const el = [...document.querySelectorAll("*")].find((e) =>
      e.children.length === 0 && /harness boot failed/i.test(e.textContent || "")
    );
    return el ? (el.textContent || "").trim() : null;
  });

  const report: BootDiagReport = {
    probeState,
    bootBanner,
    cdnFetchFromBrowser: cdnProbe,
    consoleErrs: consoleErrs.slice(0, 10),
    requestFailed: failed.filter((u) => /cdnjs|cloudflare|jsdelivr|lodash/i.test(u)).slice(0, 10),
  };

  console.log(JSON.stringify(report, null, 2));

  await browser.close();
})().catch((e) => {
  console.error("DIAG ERROR", e);
  process.exit(1);
});
