"use strict";
/**
 * Reusable "real SOAR browser session" service.
 *
 * This is the ONE consistent, WAF-safe entry point for driving the deployed
 * FortiSOAR 7.x SPA from Playwright (the real app — NOT the local harness). Every
 * widget's live-UI test should build on top of this instead of re-deriving the
 * UA / login / deep-link quirks. The hard-won invariants it owns:
 *
 *  - **FortiGuard inline IPS blocks the default headless UA.** A bare
 *    Playwright/HeadlessChrome request returns a "Web Page Blocked!" interstitial
 *    (FortiGuard Attack ID 20000051) even though authenticated API POSTs pass.
 *    Presenting a real desktop Chrome User-Agent (+ Accept-Language) clears it.
 *    This is why the UI was historically "un-driveable" on forticloud — the WAF,
 *    not SSO.
 *  - **csadmin is a LOCAL login, not SSO.** Login form is `#username` +
 *    `#login_password`; submit via `button[type=submit]` / "Login".
 *  - **Record deep-links use `/modules/<module>/<uuid>`** (ui-router state
 *    `main.modulesDetail`). A bare `/<module>/<uuid>` silently redirects to login.
 *  - **TLS**: dev appliances present certs the headless browser distrusts; we set
 *    ignoreHTTPSErrors + --ignore-certificate-errors (same allowance the live API
 *    client makes).
 *
 * Credentials come from the shared soarEnv resolver (env > keychain > .env).
 *
 * Usage:
 *   const { launchSoarSession, openRecord } = require("../lib/soarBrowser");
 *   const s = await launchSoarSession();              // launched + authenticated
 *   await openRecord(s.page, s.base, "alerts", uuid);
 *   // ... assert .action-renderer-widget ...
 *   await s.close();
 */

const { chromium } = require("@playwright/test");
const { resolveSoarEnv } = require("./soarEnv");

// A real desktop Chrome UA — REQUIRED to get past the FortiGuard IPS. Single
// source of truth: liveUiDriver re-exports THIS constant (do not fork it).
const DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const LOGIN = {
  user: "#username",
  pass: "#login_password",
  submit: 'button[type="submit"], button:has-text("Login"), button:has-text("Log In")',
};

/** Resolve the box origin (scheme-qualified) from soarEnv. Throws if unset. */
function baseUrl(soar) {
  const h = (soar.host || "").replace(/\/+$/, "");
  if (!h) throw new Error("soarBrowser: no FSR_BASE_URL resolved (set it in .env)");
  return /^https?:\/\//i.test(h) ? h : "https://" + h;
}

/** Launch a Chrome context the box's WAF will accept (desktop UA + TLS allow). */
async function launchContext({ headless = true } = {}) {
  const browser = await chromium.launch({
    headless,
    args: ["--ignore-certificate-errors", "--disable-blink-features=AutomationControlled"],
  });
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1500, height: 1100 },
    userAgent: DESKTOP_UA,
    extraHTTPHeaders: { "Accept-Language": "en-US,en;q=0.9" },
  });
  return { browser, context };
}

/** Log in with resolved creds (local csadmin). Throws if the form never appears. */
async function login(page, base, soar) {
  await page.goto(base + "/login", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector(LOGIN.pass, { timeout: 30000 });
  await page.fill(LOGIN.user, soar.user);
  await page.fill(LOGIN.pass, soar.pass);
  await page.click(LOGIN.submit);
  await page.waitForTimeout(8000); // SPA app-shell boot
}

/**
 * Reusable ≥400 /api response + console-error + pageerror collector. Returns an
 * object whose arrays fill as the page runs; call before navigating.
 *   const errs = captureApiErrors(page);
 *   // ... drive ...
 *   expect(errs.meaningful()).toEqual([]);
 */
function captureApiErrors(page) {
  const apiErrors = [];
  const consoleErrors = [];
  const pageErrors = [];
  page.on("response", (r) => {
    try {
      if (r.status() >= 400 && /\/api\//.test(r.url())) {
        apiErrors.push({ status: r.status(), url: r.url() });
      }
    } catch (_) { /* response went away */ }
  });
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => pageErrors.push(String(e && e.message ? e.message : e)));
  return {
    apiErrors, consoleErrors, pageErrors,
    /** Errors worth failing on — drops known-benign noise (favicon, ResizeObserver,
     *  and the box's pre-existing malformed-CSP referrer-policy warning). */
    meaningful() {
      const benign =
        /favicon|ResizeObserver|Non-Error promise rejection|referrer policy|about:srcdoc|frame is sandboxed/i;
      return [
        ...apiErrors.map((e) => `HTTP ${e.status} ${e.url}`),
        ...consoleErrors.filter((t) => !benign.test(t)),
        ...pageErrors.filter((t) => !benign.test(t)),
      ];
    },
  };
}

/**
 * Deep-link to a record's detail page and wait for it to settle. Uses the
 * `/modules/<module>/<uuid>` form (bare `/<module>/<uuid>` redirects to login).
 */
async function openRecord(page, base, module, uuid, { settleMs = 10000 } = {}) {
  if (!uuid) throw new Error("openRecord: uuid is required");
  await page.goto(`${base}/modules/${module}/${uuid}`, {
    waitUntil: "domcontentloaded", timeout: 60000,
  });
  await page.waitForTimeout(settleMs); // record + widgets render
}

/**
 * Full flow: launch desktop-UA Chrome → log in → return a ready, authenticated
 * session. opts: { headless=true, env }. Returns
 *   { browser, context, page, base, soar, errors, close }
 * where `errors` is the captureApiErrors handle attached before login.
 */
async function launchSoarSession(opts = {}) {
  const soar = resolveSoarEnv(opts.env);
  const base = baseUrl(soar);
  const { browser, context } = await launchContext({ headless: opts.headless !== false });
  const page = await context.newPage();
  const errors = captureApiErrors(page);
  await login(page, base, soar);
  return {
    browser, context, page, base, soar, errors,
    async close() { await browser.close().catch(() => {}); },
  };
}

module.exports = {
  DESKTOP_UA,
  baseUrl,
  launchContext,
  login,
  captureApiErrors,
  openRecord,
  launchSoarSession,
};
