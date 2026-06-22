#!/usr/bin/env node
/* Headless probe of the harness bootstrap flow. Starts a chromium page at
   http://localhost:4400, waits for either successful widget mount or the
   first console error / page error, then prints a JSON report and exits.
   Used to drive the harness boot-up iteration loop. */
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const URL = process.env.HARNESS_URL || "http://localhost:4400";
const TIMEOUT_MS = Number(process.env.PROBE_TIMEOUT_MS || 15000);
(async () => {
    const browser = await test_1.chromium.launch({ headless: true });
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push({ kind: "pageerror", message: e.message, stack: e.stack }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Playwright console message type
    page.on("console", (msg) => {
        if (msg.type() === "error")
            errors.push({ kind: "console.error", message: msg.text() });
    });
    try {
        await page.goto(URL, { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS });
        // Wait briefly for bootstrap. If errors appear, surface them; otherwise
        // assume mount succeeded.
        await page.waitForTimeout(4000);
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push({ kind: "navigation", message: msg });
    }
    await browser.close();
    const result = { url: URL, errorCount: errors.length, errors };
    console.log(JSON.stringify(result, null, 2));
    process.exit(errors.length ? 1 : 0);
})();
