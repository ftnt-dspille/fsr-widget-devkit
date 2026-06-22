"use strict";
/* Local widget dev server.
   - Auto-discovers widgets in widgets-src/<repo>/widget/  (each must contain info.json)
   - Serves the harness page at /
   - Authenticates to FSR_BASE_URL, caches the JWT, re-auths on 401
   - Exposes /_fsr/widgets and /_fsr/stylesheets for the harness bootstrap
   - Proxies everything else (assets + APIs) to FSR_BASE_URL */

require("dotenv").config();
import fs = require("fs");
import os = require("os");
import path = require("path");
import HU = require("./lib/harnessUtils");
import http = require("http");
import https = require("https");
import crypto = require("crypto");
import express = require("express");
import { WidgetRecord, WidgetCapabilities, InfoJson, StaleVersionRef, LintResult, SseEvent } from "./lib/types";
const { spawn } = require("child_process");
const { URL } = require("url");
const { createProxyMiddleware } = require("http-proxy-middleware");
const {
  packageWidget,
  bumpVersion,
  isValidVersion,
  writeInfoVersion,
  syncSourceToInfoJson,
  validateWidget,
  suggestInfoFix,
  applyInfoFix,
} = require("./packager");

// Default port intentionally non-common so dev sessions don't collide with
// the 3000/4000/4400/8080 buckets that other tools grab. Override with PORT=.
const PORT = Number(process.env.PORT || 14400);
const { resolveSoarEnv, resolveSoarEnvFile, listEnvFiles } = require("./lib/soarEnv") as {
  resolveSoarEnv: () => { host: string; user: string; pass: string };
  resolveSoarEnvFile: (filePath: string) => { host?: string; user: string; pass: string };
  listEnvFiles: (dir: string) => Array<{ file: string; host: string; user: string }>;
};

// SOAR connection is MUTABLE at runtime: the harness UI can re-point the proxy
// at a different .env file (e.g. the forticloud box vs a local box) without a
// restart. The proxy reads HOST per-request via its `router`; authenticate()
// reads USER/PASS per-call. A switch invalidates the cached JWT so the next
// request re-auths against the new box.
let { host: HOST, user: USER, pass: PASS } = resolveSoarEnv();
// Basename of the .env the connection currently reflects. `.env` is the startup
// default (resolved with the normal exported-env > keychain > file precedence).
let ACTIVE_ENV = ".env";

// Persisted selection: a gitignored dotfile holding just the chosen basename so
// a `npm run dev` restart keeps pointing where you left it.
const ACTIVE_ENV_STATE_FILE = path.resolve(__dirname, ".harness-active-env");

// Re-point the connection at a named env file (basename, must be one listed by
// listEnvFiles). Updates HOST/USER/PASS, drops the cached token, and returns the
// new host. Throws if the file isn't a recognized, usable target.
function applySoarEnvFile(file: string): string {
  const match = listEnvFiles(__dirname).find((e) => e.file === file);
  if (!match) throw new Error(`unknown or unusable env file: ${file}`);
  const resolved = resolveSoarEnvFile(path.join(__dirname, file));
  if (!resolved.host) throw new Error(`env file has no FSR_BASE_URL: ${file}`);
  HOST = resolved.host;
  USER = resolved.user;
  PASS = resolved.pass;
  ACTIVE_ENV = file;
  invalidateToken();
  return HOST;
}

let PROXY_VERBOSE = process.env.PROXY_VERBOSE === "1";

// Hermetic mode (HERMETIC_E2E_PLAN.md Phase 1): when on, the proxy fallthrough
// to the real FortiSOAR box is DISABLED. Anything not served locally returns a
// loud `599 HERMETIC-MISS: <path>` instead of silently proxying — converting an
// invisible forticloud dependency into a visible, fixable worklist item. The
// e2e webServer sets FSR_HERMETIC=1 by default (see playwright.config.js) so the
// mock gate can never red on a box outage. Set FSR_HERMETIC=0 to allow proxying.
const HERMETIC = process.env.FSR_HERMETIC === "1";
// Records every distinct hermetic miss so a test run can dump the worklist.
const hermeticMisses = new Set<string>();

const HARNESS_MODULE_PATH = path.resolve(__dirname, "harness.module.js");

// Where the FortiSOAR app shell (app.unmin.js + extracted templates) lives.
// Monorepo: a sibling `../fsr_src`. Standalone clone: `<harness>/fsr_src`,
// populated by `npm run assets` (scripts/fetch-soar-assets.sh). Prefer the
// monorepo sibling when present so we don't duplicate the ~200M reference set.
const FSR_SRC_DIR =
  [path.resolve(__dirname, "..", "fsr_src"), path.resolve(__dirname, "fsr_src")].find(
    (d) => fs.existsSync(d)
  ) || path.resolve(__dirname, "fsr_src");
const FSR_APP_PATH_FOR_LINT = path.join(FSR_SRC_DIR, "app.unmin.js");
// Services registered by the SOAR bundle; parsed once at startup. The bundle
// is large (~2.5MB) so we don't watch/re-parse it. These ship to SOAR for real.
const FSR_BUNDLE_SERVICES = (() => {
  try {
    const svcs = HU.parseRegisteredServices(fs.readFileSync(FSR_APP_PATH_FOR_LINT, "utf8"));
    console.log(`[lint] indexed ${svcs.length} services from fsr_src/app.unmin.js`);
    return svcs;
  } catch (e: unknown) {
    console.warn(`[lint] failed to index app.unmin.js services: ${e instanceof Error ? e.message : String(e)}`);
    return [];
  }
})();
// Vendor modules loaded in index.html. Not in app.unmin.js or harness module.
const VENDOR_PROVIDED_SERVICES = ["$resource"];
// Services SOAR ships outside the parsed app.unmin.js bundle (e.g. widget
// loader code that lives in a separate chunk we don't index). Treat as real.
// widgetBasePath: the per-widget asset root SOAR injects into view widget
// controllers (e.g. jsonToGrid builds widgetAssets/ templateUrls from it).
// Real at install time; the harness.module.js factory only makes it resolve
// for the local mount.
const KNOWN_PLATFORM_EXTRAS = ["widgetUtilityService", "widgetBasePath"];
// Real-in-SOAR set: present at install time without the widget shipping it.
const PLATFORM_SERVICES = Array.from(
  new Set([...FSR_BUNDLE_SERVICES, ...VENDOR_PROVIDED_SERVICES, ...KNOWN_PLATFORM_EXTRAS])
);

// Harness-only stub set: services registered solely by harness.module.js so
// the local mount renders. Publish-time lint flags injection of these as a
// real risk because SOAR will not have them unless the widget ships its own.
function readHarnessStubbedServices(): string[] {
  return HU.parseRegisteredServices(fs.readFileSync(HARNESS_MODULE_PATH, "utf8"));
}
let HARNESS_STUBBED_SERVICES = (() => {
  try { return readHarnessStubbedServices(); } catch { return []; }
})();
// Permissive union retained for diagnostics / SSE broadcasts.
let REGISTERED_SERVICES = Array.from(
  new Set([...PLATFORM_SERVICES, ...HARNESS_STUBBED_SERVICES])
);
// Hot-reload is a dev-DX feature only. Under hermetic (e2e) mode it is actively
// harmful: with 2 concurrent workers a stray file event (lint refresh, macOS
// FSEvents noise, a sibling test that writes a widget asset) broadcasts a
// soft-remount that re-instantiates the widget controller mid-test — wiping its
// in-flight state (e.g. the slow_turn Stop test lost its turn and went green-
// state-empty). Tests never edit source mid-run, so skip every watcher.
if (!HERMETIC) {
  fs.watch(HARNESS_MODULE_PATH, { persistent: false }, () => {
    try {
      HARNESS_STUBBED_SERVICES = readHarnessStubbedServices();
      REGISTERED_SERVICES = Array.from(
        new Set([...PLATFORM_SERVICES, ...HARNESS_STUBBED_SERVICES])
      );
      for (const w of WIDGETS) refreshWidget(w);
      broadcast({ type: "harness-reload", services: REGISTERED_SERVICES });
    } catch (e: unknown) { console.warn(`harness.module.js reload failed: ${e instanceof Error ? e.message : String(e)}`); }
  });
}

// Per-widget: parse <script src="…"> tags from view.html/edit.html, follow
// each to a real file inside the widget tree, and union the .factory/
// .service/etc. names declared there. These are the only widget-local
// services that actually ship to SOAR (the templates load them at runtime).
const WIDGET_LOCAL_SCRIPT_RE = /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;
// Build a map of `serviceName -> "widgetAssets/.../file.js"` by parsing every
// .js file under widgetAssets/. Used by the linter to suggest the exact
// <script> tag to paste when a controller injects a service whose factory
// lives in widgetAssets but isn't <script>-tagged from view.html / edit.html.
function widgetAssetServiceMap(widgetDir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const root = path.join(widgetDir, "widgetAssets");
  if (!fs.existsSync(root)) return out;
  const walk = (dir: string, rel: string) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const sub = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(dir, e.name), sub);
      else if (e.isFile() && e.name.endsWith(".js")) {
        try {
          const js = fs.readFileSync(path.join(dir, e.name), "utf8");
          for (const name of HU.parseRegisteredServices(js)) {
            if (!(name in out)) out[name] = "widgetAssets/" + sub;
          }
        } catch { /* skip unreadable file */ }
      }
    }
  };
  walk(root, "");
  return out;
}

function widgetLocalServicesFor(widgetDir: string): string[] {
  // Mirror runtime behavior: scanAssetScripts (and SOAR's install pipeline)
  // load every .js under widgetAssets/ before the controller boots, so any
  // service registered by any of those files is available at injection time.
  // We don't require a <script> tag in view.html/edit.html — the harness
  // wires them automatically, just like SOAR does on install.
  const out = new Set<string>();
  const root = path.join(widgetDir, "widgetAssets");
  if (!fs.existsSync(root)) return [];
  const walk = (dir: string) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && e.name.endsWith(".js")) {
        try {
          const js = fs.readFileSync(p, "utf8");
          for (const name of HU.parseRegisteredServices(js)) out.add(name);
        } catch { /* skip unreadable file */ }
      }
    }
  };
  walk(root);
  return Array.from(out);
}

// Lint context files we read off disk per widget.
const LINT_FILES = ["view.controller.js", "edit.controller.js", "view.html", "edit.html"];

function readLintFiles(widgetDir: string): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const f of LINT_FILES) {
    const p = path.join(widgetDir, f);
    try { out[f] = fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null; }
    catch { out[f] = null; }
  }
  return out;
}


function lintFor(widget: WidgetRecord): LintResult {
  const infoPath = path.join(widget.dir, "info.json");
  let info: InfoJson | undefined;
  try { info = JSON.parse(fs.readFileSync(infoPath, "utf8")) as InfoJson; } catch { /* surfaced below */ }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- HU.lintWidget returns compatible shape but different module reference
  return HU.lintWidget({
    info,
    files: readLintFiles(widget.dir),
    // Real-in-SOAR services. Anything not in here (and not in widgetLocal)
    // either fails publish-time or only works locally as a harness stub.
    registeredServices: PLATFORM_SERVICES,
    harnessStubbedServices: HARNESS_STUBBED_SERVICES,
    widgetLocalServices: widgetLocalServicesFor(widget.dir),
    widgetAssetServiceMap: widgetAssetServiceMap(widget.dir),
    staleVersionRefs: widget.staleVersionRefs || [],
    viewControllers: widget.viewControllers || [],
    editControllers: widget.editControllers || [],
  }) as unknown as LintResult;
}

// Credential check is deferred to startup so the module can be imported
// by tests without exiting. See the require.main block at the bottom.

// Token cache
let cachedToken: string | null = null;
let tokenExpiry = 0;
let tokenPromise: Promise<string> | null = null;
const REFRESH_SKEW_MS = 60 * 1000;
const FALLBACK_TTL_MS = 50 * 60 * 1000;

// Restore the last UI-selected SOAR target. `.env` is already the startup
// default, so only a non-default persisted choice needs re-applying. A stale
// pointer (file deleted/renamed) silently falls back to the default.
(function restoreActiveSoarEnv() {
  try {
    if (!fs.existsSync(ACTIVE_ENV_STATE_FILE)) return;
    const want = fs.readFileSync(ACTIVE_ENV_STATE_FILE, "utf8").trim();
    if (want && want !== ".env") applySoarEnvFile(want);
  } catch (e: unknown) {
    console.warn(`[soar-env] could not restore persisted target: ${e instanceof Error ? e.message : String(e)}`);
  }
})();

function decodeJwtExpiryMs(token: string): number | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const payload = JSON.parse(
      Buffer.from(
        parts[1].replace(/-/g, "+").replace(/_/g, "/"),
        "base64"
      ).toString("utf8")
    );
    return payload.exp ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

interface UpstreamRequestOpts {
  method: string;
  pathAndQuery: string;
  body?: string;
  headers?: Record<string, string>;
}

interface UpstreamResponse {
  status: number;
  body: string;
}

function upstreamRequest(opts: UpstreamRequestOpts): Promise<UpstreamResponse> {
  return new Promise((resolve, reject) => {
    const url = new URL(HOST.replace(/\/$/, "") + opts.pathAndQuery);
    const mod = url.protocol === "https:" ? https : http;
    const req = mod.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: url.pathname + url.search,
        method: opts.method,
        rejectUnauthorized: false,
        headers: Object.assign(
          { Accept: "*/*" },
          opts.body ? { "Content-Length": Buffer.byteLength(opts.body) } : {},
          opts.headers || {}
        ),
      },
      (res: http.IncomingMessage) => {
        let data = "";
        res.on("data", (c: string) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode || 0, body: data }));
      }
    );
    req.on("error", reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

interface UpstreamMultipartOpts {
  pathAndQuery: string;
  fields?: Record<string, string>;
  file?: {
    name: string;
    filename: string;
    contentType?: string;
    content: Buffer;
  };
  headers?: Record<string, string>;
}

interface UpstreamMultipartResponse {
  status: number;
  body: string;
  headers?: http.IncomingHttpHeaders;
}

// Posts a multipart/form-data body upstream. Used for solutionpacks/install
// which expects fields plus a .tgz file. Built on top of https.request so it
// shares the same `rejectUnauthorized: false` posture as upstreamRequest.
function upstreamMultipart(opts: UpstreamMultipartOpts): Promise<UpstreamMultipartResponse> {
  return new Promise((resolve, reject) => {
    const boundary = "----fsr" + crypto.randomBytes(8).toString("hex");
    const chunks: Buffer[] = [];
    for (const [name, value] of Object.entries(opts.fields || {})) {
      chunks.push(
        Buffer.from(
          `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="${name}"\r\n\r\n` +
            `${value}\r\n`
        )
      );
    }
    if (opts.file) {
      chunks.push(
        Buffer.from(
          `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="${opts.file.name}"; filename="${opts.file.filename}"\r\n` +
            `Content-Type: ${opts.file.contentType || "application/octet-stream"}\r\n\r\n`
        )
      );
      chunks.push(opts.file.content);
      chunks.push(Buffer.from("\r\n"));
    }
    chunks.push(Buffer.from(`--${boundary}--\r\n`));
    const body = Buffer.concat(chunks);

    const url = new URL(HOST.replace(/\/$/, "") + opts.pathAndQuery);
    const mod = url.protocol === "https:" ? https : http;
    const req = mod.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: url.pathname + url.search,
        method: "POST",
        rejectUnauthorized: false,
        headers: Object.assign(
          {
            Accept: "*/*",
            "Content-Type": `multipart/form-data; boundary=${boundary}`,
            "Content-Length": body.length,
          },
          opts.headers || {}
        ),
      },
      (res: http.IncomingMessage) => {
        let data = "";
        res.on("data", (c: string) => (data += c));
        res.on("end", () => {
          if ((res.statusCode || 0) < 200 || (res.statusCode || 0) >= 300) {
            console.warn(`upstreamMultipart ${res.statusCode} ${opts.pathAndQuery} | headers: ${JSON.stringify(res.headers)} | body: ${data.slice(0, 500) || "(empty)"}`);
          }
          resolve({ status: res.statusCode || 0, headers: res.headers, body: data });
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

interface UpstreamRequestBinaryOpts {
  method: string;
  pathAndQuery: string;
  body?: string;
  headers?: Record<string, string>;
}

interface UpstreamBinaryResponse {
  status: number;
  body: Buffer;
  headers?: http.IncomingHttpHeaders;
}

// Binary-safe upstream request. upstreamRequest concatenates response chunks
// as utf8 strings, which corrupts gzip/tar bytes — so the widget-export flow
// (which returns a .tgz) goes through this variant instead.
function upstreamRequestBinary(opts: UpstreamRequestBinaryOpts): Promise<UpstreamBinaryResponse> {
  return new Promise((resolve, reject) => {
    const url = new URL(HOST.replace(/\/$/, "") + opts.pathAndQuery);
    const mod = url.protocol === "https:" ? https : http;
    const req = mod.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: url.pathname + url.search,
        method: opts.method,
        rejectUnauthorized: false,
        headers: Object.assign(
          { Accept: "*/*" },
          opts.body ? { "Content-Length": Buffer.byteLength(opts.body) } : {},
          opts.headers || {}
        ),
      },
      (res: http.IncomingMessage) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () =>
          resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks), headers: res.headers })
        );
      }
    );
    req.on("error", reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

async function authenticate(): Promise<string> {
  const body = JSON.stringify({
    credentials: { loginid: USER, password: PASS },
  });
  const res = await upstreamRequest({
    method: "POST",
    pathAndQuery: "/auth/authenticate",
    body,
    headers: { "Content-Type": "application/json" },
  });
  if (res.status < 200 || res.status >= 300)
    throw new Error(`auth ${res.status}: ${res.body.slice(0, 300)}`);
  const parsed = JSON.parse(res.body);
  if (!parsed.token) throw new Error("auth response missing token");
  return parsed.token;
}

async function ensureToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiry - REFRESH_SKEW_MS) {
    return cachedToken;
  }
  if (!tokenPromise) {
    console.log(
      cachedToken
        ? "auth: token expired, re-authenticating…"
        : `auth: fetching token as ${USER}…`
    );
    tokenPromise = authenticate()
      .then((token) => {
        cachedToken = token;
        tokenExpiry = decodeJwtExpiryMs(token) || Date.now() + FALLBACK_TTL_MS;
        console.log(
          `auth: ok, token expires ${new Date(tokenExpiry).toISOString()}`
        );
        return token;
      })
      .finally(() => {
        tokenPromise = null;
      });
  }
  return tokenPromise;
}

function invalidateToken(): void {
  cachedToken = null;
  tokenExpiry = 0;
}

// Widget discovery
// Discovery roots — the harness MOUNTS widgets from every root that exists, so
// the bundled examples/ widgets are renderable in the monorepo (next to
// widgets-src) AND in a fresh clone (where widgets-src is absent). When a folder
// name appears in more than one root, the earlier root wins (widgets-src over
// examples). An explicit WIDGETS_SRC env replaces the defaults entirely.
function resolveWidgetRoots(): string[] {
  const roots: string[] = [];
  if (process.env.WIDGETS_SRC) {
    roots.push(path.resolve(process.env.WIDGETS_SRC));
  } else {
    const local = path.resolve(__dirname, "widgets-src"); // false for a dangling symlink
    if (fs.existsSync(local)) roots.push(local);
  }
  // The harness's own bundled examples/ are ALWAYS mounted (for self-test and as
  // a reference widget), regardless of where the user points WIDGETS_SRC — so
  // `npm test` / `npm run test:e2e` work fully locally even when .env pins a root.
  const examples = path.resolve(__dirname, "examples");
  if (fs.existsSync(examples)) roots.push(examples);
  // De-dupe (e.g. WIDGETS_SRC explicitly set to examples) and drop missing.
  return [...new Set(roots)].filter((p) => fs.existsSync(p));
}
const WIDGET_ROOTS = resolveWidgetRoots();

// Single WRITABLE root for imports/uploads (where `pull` drops new widgets).
// Prefer a real widgets-src; fall back to examples only if that's all we have.
const WIDGETS_SRC =
  WIDGET_ROOTS.find((p) => path.basename(p) === "widgets-src") ||
  WIDGET_ROOTS[0] ||
  path.resolve(__dirname, "widgets-src");

// Files we scan for stale `<name>-<version>` references. The widget templates
// frequently embed versioned paths (e.g. <link href="<name>-1.1.3/...">) that
// must follow info.json's version, but get forgotten on a version bump.
const VERSIONED_REF_FILES = ["view.html", "edit.html", "view.controller.js", "edit.controller.js"];

function staleRefRegex(name: string): RegExp {
  // Match `<name>-X.Y[.Z...]` -- capture the version portion so we can compare
  // it against the current one. We don't include trailing slash so it picks
  // up paths and bare identifiers alike.
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp("\\b" + escaped + "-(\\d+(?:\\.\\d+)+)", "g");
}

function scanStaleVersionRefs(widgetDir: string, name: string, version: string): StaleVersionRef[] {
  const out: StaleVersionRef[] = [];
  const re = staleRefRegex(name);
  for (const file of VERSIONED_REF_FILES) {
    const p = path.join(widgetDir, file);
    if (!fs.existsSync(p)) continue;
    let src;
    try { src = fs.readFileSync(p, "utf8"); } catch (_) { continue; }
    const seen = new Set<string>();
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(src)) !== null) {
      if (m[1] !== version) seen.add(m[1]);
    }
    if (seen.size > 0) out.push({ file, staleVersions: Array.from(seen) });
  }
  return out;
}

// Build a widget record for a single widgets-src/<folder>/widget directory.
// Returns null if info.json is missing/invalid; caller decides whether to skip
// or surface an error.
function buildWidgetRecord(folder: string, root?: string): WidgetRecord | null {
  const widgetDir = path.join(root || WIDGETS_SRC, folder, "widget");
  const infoPath = path.join(widgetDir, "info.json");
  if (!fs.existsSync(infoPath)) return null;
  let info: InfoJson | undefined;
  try {
    info = JSON.parse(fs.readFileSync(infoPath, "utf8")) as InfoJson;
  } catch (err: unknown) {
    console.warn(`skipping ${folder}: bad info.json (${err instanceof Error ? err.message : String(err)})`);
    return null;
  }
  if (!info || !info.name || !info.version) {
    console.warn(`skipping ${folder}: info.json missing name or version`);
    return null;
  }
  const readControllers = (file: string): string[] => {
    const p = path.join(widgetDir, file);
    if (!fs.existsSync(p)) return [];
    try {
      return HU.extractRegisteredControllers(fs.readFileSync(p, "utf8"));
    } catch (_) {
      return [];
    }
  };
  return {
    folder,
    dir: widgetDir,
    id: `${info.name}-${info.version}`,
    name: info.name,
    version: info.version,
    title: info.title || info.name,
    subTitle: info.subTitle || "",
    pages: (info.metadata && info.metadata.pages) || [],
    viewControllers: readControllers("view.controller.js"),
    editControllers: readControllers("edit.controller.js"),
    assetScripts: scanAssetScripts(widgetDir),
    staleVersionRefs: scanStaleVersionRefs(widgetDir, info.name, info.version),
    caps: scanCapabilities(widgetDir),
  };
}

// Statically scan a widget's templates/controllers/asset scripts for markers
// of the two heavy editor stacks, so the harness boot chain can skip loading
// them for widgets that don't use them (see WidgetCapabilities). Conservative
// by design: a generous marker set + scanning every .html/.js means we err
// toward loading an editor when in doubt rather than starving a widget that
// needs one. (Non-recursive directory scan misses nothing meaningful — these
// directives live in the widget's own templates/controllers/widgetAssets.)
const MONACO_MARKERS = /\bmonaco\b|cs-code-editor|csCodeEditor/i;
const EDITOR_MARKERS = /cs-conditional|cs-html-editor|csHtmlEditor|cs-markdown-editor|csMarkdownEditor|tinymce|toastui|\brichtext\b/i;
function scanCapabilities(widgetDir: string): WidgetCapabilities {
  let monaco = false;
  let editors = false;
  const files: string[] = [];
  const walk = (dir: string) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile() && (e.name.endsWith(".html") || e.name.endsWith(".js")) && !e.name.endsWith(".min.js")) {
        files.push(full);
      }
    }
  };
  walk(widgetDir);
  for (const f of files) {
    if (monaco && editors) break;
    let src: string;
    try { src = fs.readFileSync(f, "utf8"); } catch { continue; }
    if (!monaco && MONACO_MARKERS.test(src)) monaco = true;
    if (!editors && EDITOR_MARKERS.test(src)) editors = true;
  }
  return { monaco, editors };
}

// Recursively list .js files under widgetAssets/ (relative paths). The
// harness loads these before bootstrap so widget-local services like
// chartService are registered alongside view/edit controllers.
function scanAssetScripts(widgetDir: string): string[] {
  const root = path.join(widgetDir, "widgetAssets");
  if (!fs.existsSync(root)) return [];
  const out: string[] = [];
  const walk = (dir: string, rel: string) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      const sub = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(dir, e.name), sub);
      else if (e.isFile() && e.name.endsWith(".js")) out.push("widgetAssets/" + sub);
    }
  };
  walk(root, "");
  return out;
}

function discoverWidgets(): WidgetRecord[] {
  if (WIDGET_ROOTS.length === 0) {
    console.warn(`no widget roots found (looked for widgets-src/ and examples/)`);
    return [];
  }
  const out: WidgetRecord[] = [];
  const seenFolders = new Set<string>(); // first root wins on a folder-name collision
  for (const root of WIDGET_ROOTS) {
    for (const e of fs.readdirSync(root, { withFileTypes: true })) {
      if (!e.isDirectory() || seenFolders.has(e.name)) continue;
      const rec = buildWidgetRecord(e.name, root);
      if (rec) { out.push(rec); seenFolders.add(e.name); }
    }
  }
  return out;
}

const app = express();
const WIDGETS = discoverWidgets();

// SSE clients receive widget-change, harness-reload, and proxy-log events.
// Each client is a Response with an open keep-alive stream. We push JSON
// objects with a `type` field so the browser can route them to the right
// handler (hot-reload, network panel, etc.).
const sseClients = new Set<express.Response>();
function broadcast(obj: SseEvent): void {
  const line = `data: ${JSON.stringify(obj)}\n\n`;
  for (const res of sseClients) {
    try { res.write(line); } catch { /* client gone */ }
  }
}

// Refresh cached metadata + lint for a widget. Called on file-watcher events
// and after the harness module changes (which can change `unknown-dependency`
// outcomes for every widget at once).
function refreshWidget(w: WidgetRecord): void {
  const reread = (file: string): string[] => {
    const p = path.join(w.dir, file);
    if (!fs.existsSync(p)) return [];
    try { return HU.extractRegisteredControllers(fs.readFileSync(p, "utf8")); }
    catch { return []; }
  };
  try {
    const info = JSON.parse(fs.readFileSync(path.join(w.dir, "info.json"), "utf8"));
    const newId = `${info.name}-${info.version}`;
    if (newId !== w.id) {
      widgetsById.delete(w.id);
      w.id = newId;
      w.version = info.version;
      w.title = info.title || info.name;
      widgetsById.set(newId, w);
      mountWidget(w);
    }
  } catch { /* lint will report */ }
  w.viewControllers = reread("view.controller.js");
  w.editControllers = reread("edit.controller.js");
  w.staleVersionRefs = scanStaleVersionRefs(w.dir, w.name, w.version);
  w.lint = lintFor(w);
}

// Proxy log ring buffer for the in-page Network tab.
const PROXY_LOG_MAX = 200;
interface ProxyLogEntry extends Record<string, unknown> {
  id?: number;
  ts: number;
  ms: number;
  method: string;
  url: string;
  status: number;
  error?: string;
  resBodyLength?: number;
  reqHeaders?: Record<string, unknown>;
  resHeaders?: Record<string, unknown>;
  resBody?: { text: string; truncated: boolean; binary: boolean };
}
const PROXY_LOG: ProxyLogEntry[] = [];
let proxyLogSeq = 0;
const REDACT_HEADERS = new Set(["authorization", "cookie", "set-cookie", "x-csrf-token"]);
function redactHeaders(h: Record<string, string | string[] | undefined>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(h || {})) {
    out[k] = REDACT_HEADERS.has(k.toLowerCase()) ? "<redacted>" : v;
  }
  return out;
}
function recordProxy(entry: ProxyLogEntry): void {
  entry.id = ++proxyLogSeq;
  PROXY_LOG.push(entry);
  if (PROXY_LOG.length > PROXY_LOG_MAX) PROXY_LOG.shift();
  broadcast({ type: "proxy", entry });
}

// Force every harness response to be uncacheable. Setting cacheControl:false
// on express.static only suppresses *its* Cache-Control header — browsers
// still apply heuristic caching, so an edited controller can keep running
// the previous build until "Clear site data". no-store kills heuristics too.
app.use((_req: express.Request, res: express.Response, next: express.NextFunction) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  next();
});

function mountWidget(w: WidgetRecord): void {
  // Short-circuit the optional locales file so widgets without it don't
  // emit a noisy 404 on every preview boot. index.html fetches this path
  // unconditionally and merges the result; an empty object is a no-op.
  app.get(`/${w.id}/widgetAssets/locales/en.json`, (_req: express.Request, res: express.Response, next: express.NextFunction) => {
    const p = path.join(w.dir, "widgetAssets", "locales", "en.json");
    fs.access(p, fs.constants.F_OK, (err: NodeJS.ErrnoException | null) => {
      if (err) return res.type("application/json").send("{}");
      next();
    });
  });
  app.use(`/${w.id}`, express.static(w.dir, { etag: false, cacheControl: false }));
  // Also serve under the SOAR canonical path that widgetBasePath resolves to
  // ("/widgets/installed/<id>/"), so CSS/template assets loaded via ng-href
  // {{widgetBasePath}}... resolve correctly in both the harness and in SOAR.
  app.use(`/widgets/installed/${w.id}`, express.static(w.dir, { etag: false, cacheControl: false }));
  // Hard 404 for anything under /<widget-id>/ that wasn't found in the widget
  // folder. Without this, the trailing SOAR-proxy middleware would forward
  // the request and return the SPA index.html, which silently breaks widget
  // code that expects JSON (e.g. fsrPbMockConnector loading fixtures).
  app.use(`/${w.id}`, (_req: express.Request, res: express.Response) => res.status(404).type("text/plain").send("widget asset not found"));
  app.use(`/widgets/installed/${w.id}`, (_req: express.Request, res: express.Response) => res.status(404).type("text/plain").send("widget asset not found"));
  console.log(`mount  /${w.id}  ->  ${w.dir}`);
}

for (const w of WIDGETS) mountWidget(w);
if (WIDGETS.length === 0) {
  console.warn("no widgets discovered; drop a folder with info.json into widgets-src/");
}

app.use(
  "/",
  express.static(path.resolve(__dirname, "public"), {
    etag: false,
    cacheControl: false,
    index: ["index.html"],
  })
);
app.use(
  "/harness.module.js",
  express.static(path.resolve(__dirname, "harness.module.js"), { etag: false, cacheControl: false })
);
app.use(
  "/lib",
  express.static(path.resolve(__dirname, "lib"), { etag: false, cacheControl: false })
);

// Serve Monaco locally so the harness never proxies the editor bundle to the
// SOAR box (HERMETIC_E2E_PLAN.md Phase 1). The widget's boot path
// `await preloadMonaco()` (public/index.html) hard-fetches
// /node_modules/monaco-editor/min/vs/loader.js + editor.main — under hermetic
// mode a proxied 599 there would brick boot, not just the YAML pane. We pin the
// same monaco version the box ships (0.47.0) as a devDependency so build-mode
// specs run against the real editor with zero forticloud dependency.
app.use(
  "/node_modules/monaco-editor",
  express.static(path.resolve(__dirname, "node_modules", "monaco-editor"), {
    etag: false,
    cacheControl: false,
  })
);

// Font dedup (introspection backlog #2). SOAR's steel.css ships TWO parallel
// Lato @font-face roots — `/fonts/Lato/Lato-*.woff2` (the SOAR-hosted family)
// AND `/node_modules/lato-font/fonts/lato-*/*.woff2` (the npm lato-font package)
// — so any render whose text uses a weight declared in both downloads the same
// glyphs twice (~183 KB each for the normal weight, ~1 MB across weights). All
// six npm weights are byte-IDENTICAL to their /fonts/Lato counterparts (verified
// by md5), so redirecting the npm URLs onto the SOAR-hosted ones collapses the
// duplicate to a single cached download with ZERO change to rendered glyphs.
// This is the one place the harness intentionally diverges from SOAR's exact
// wire (identical bytes, fewer requests) — a Phase 2 fidelity diff should
// allowlist these redirected font URLs.
const LATO_NPM_TO_SOAR: Record<string, string> = {
  "lato-normal": "Lato-Regular",
  "lato-bold": "Lato-Bold",
  "lato-light": "Lato-Light",
  "lato-normal-italic": "Lato-Italic",
  "lato-bold-italic": "Lato-BoldItalic",
  "lato-light-italic": "Lato-LightItalic",
};
app.get(/^\/node_modules\/lato-font\/fonts\/([^/]+)\/[^/]+\.woff2$/, (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const weight = (req.params as unknown as string[])[0];
  const soar = LATO_NPM_TO_SOAR[weight];
  // Unknown weight (a variant we haven't proven identical) — fall through to
  // the proxy untouched rather than risk a wrong-glyph map.
  if (!soar) return next();
  res.redirect(302, `/fonts/Lato/${soar}.woff2`);
});

// Serve SOAR\'s extracted UI templates (templateUrl: "app/components/...").
// Otherwise these resolve via the proxy, which returns SOAR\'s SPA shell on
// any unauthenticated request and breaks Angular\'s template parser
// (Cannot read properties of undefined when csChart\'s template fails to
// produce a real fragment). Falls through to the proxy on miss so we still
// hit the live host for assets we haven\'t extracted.
app.use(
  "/app",
  express.static(path.join(FSR_SRC_DIR, "templates-extracted", "app"), {
    etag: false,
    cacheControl: false,
    fallthrough: true,
  })
);

// Serve fsr_src/app.unmin.js with the cybersponse module's dep array stripped
// so the harness can register an empty cybersponse module without dragging in
// ~50 vendor/fortisoar.* sub-modules. The on-disk file stays pristine.
const FSR_APP_PATH = path.join(FSR_SRC_DIR, "app.unmin.js");
let FSR_APP_PATCHED: string | null = null;
function loadPatchedFsrApp(): string {
  if (FSR_APP_PATCHED) return FSR_APP_PATCHED;
  const src = fs.readFileSync(FSR_APP_PATH, "utf8");
  // Vendor angular modules we DO load (from CDN, before app.unmin.js) and
  // therefore want as cybersponse dep so their providers ($resource, etc.)
  // are visible in the bundle\'s factories. Add new entries as we add the
  // matching <script> tags in index.html. Keep this minimal — the rest of
  // SOAR\'s ~50 dep modules stay stripped and dealt with via stubs/no-ops.
  // All fortisoar.* and cybersponse.authentication sub-modules are actually
  // defined inside app.unmin.js — they were stripped along with vendor deps
  // by the empty-deps patch. Add them back so their factories (translationService,
  // etc.) are visible to cybersponse\'s injector.
  const HARNESS_VENDOR_DEPS = [
    "ngResource",
    "ngMessages",
    "ui.bootstrap",
    "ui.select",
    // angular-ui-grid (loaded from CDN in index.html). csGrid wraps ui-grid and
    // its feature modules; each must be visible to cybersponse's injector or
    // csGrid throws $injector:unpr. Matches the ui.grid.* deps app.unmin.js
    // declares.
    "ui.grid",
    "ui.grid.selection",
    "ui.grid.resizeColumns",
    "ui.grid.pinning",
    "ui.grid.moveColumns",
    "ui.grid.exporter",
    "ui.grid.expandable",
    "ui.grid.cellNav",
    "ui.grid.autoResize",
    "ngSanitize",
    "angularMoment",
    "ngFileUpload",
    "cybersponse.authentication",
    "fortisoar.global",
    "fortisoar.globalization",
    "fortisoar.queues",
    "fortisoar.archival",
    "fortisoar.marketplace",
    "fortisoar.dataIngestion",
    "fortisoar.notification",
    "fortisoar.preProcessing",
    "fortisoar.phishing-email-classifier",
  ];
  const depsLiteral = JSON.stringify(HARNESS_VENDOR_DEPS).replace(/"/g, '"');
  const patched = src.replace(
    /angular\.module\("cybersponse",\s*\[[^\]]*\]\)/,
    `angular.module("cybersponse", ${depsLiteral})`
  );
  if (patched === src) {
    console.warn("[/_fsr/app.unmin.js] WARNING: dep-array patch did not match");
  } else {
    console.log("[/_fsr/app.unmin.js] patched cybersponse module deps -> []");
  }
  // The bundle dereferences a few vendor globals at script-load (outside any
  // angular.config callback), so we have to satisfy them before the bundle
  // body runs or it throws and the cybersponse module never gets created.
  // Each stub here was added in response to a real boot-time TypeError; keep
  // them no-ops unless something actually needs the vendor's behavior.
  const prelude = [
    '// --- harness shim prelude (injected by server.js) ---',
    'window["@uirouter/sticky-states"] = window["@uirouter/sticky-states"] || { StickyStatesPlugin: function () {} };',
    // Neutralize the bundle\'s .config and .run calls on cybersponse: they',
    // inject vendor providers ($urlRouterProvider, $breadcrumbProvider,',
    // localStorageServiceProvider, etc.) and SOAR services',
    // (appInitializeService, stateService) we don\'t have. We restore the',
    // real .config/.run in the epilogue so harness.module.js can still use',
    // them. Wrap angular.module so any reference to "cybersponse" returns',
    // a module whose .config/.run are no-ops during bundle load.',
    '(function(){',
    '  var origModule = angular.module;',
    '  var neutralized = [];',
    '  function shouldNeutralize(name){',
    '    return name === "cybersponse" || name === "cybersponse.authentication" || name.indexOf("fortisoar.") === 0;',
    '  }',
    '  angular.module = function(name, requires, configFn) {',
    '    var mod = origModule.apply(this, arguments);',
    '    if (shouldNeutralize(name) && !mod.__harnessNeutralized) {',
    '      mod.__harnessNeutralized = true;',
    '      mod.__origConfig = mod.config;',
    '      mod.__origRun = mod.run;',
    '      mod.config = function(){ return mod; };',
    '      mod.run = function(){ return mod; };',
    '      neutralized.push(name);',
    '    }',
    '    return mod;',
    '  };',
    '  window.__harnessRestoreCybersponse = function(){',
    '    for (var i = 0; i < neutralized.length; i++) {',
    '      var n = neutralized[i];',
    '      var mod = origModule.call(angular, n);',
    '      if (mod && mod.__harnessNeutralized) {',
    '        mod.config = mod.__origConfig;',
    '        mod.run = mod.__origRun;',
    '        delete mod.__harnessNeutralized;',
    '      }',
    '    }',
    '    console.log("[harness] restored .config/.run on " + neutralized.length + " modules: " + neutralized.join(", "));',
    '    angular.module = origModule;',
    '  };',
    '})();',
    '// --- end shim prelude ---',
    '',
  ].join('\n');
  const epilogue = [
    '',
    '// --- harness shim epilogue (injected by server.js) ---',
    'try { window.__harnessRestoreCybersponse && window.__harnessRestoreCybersponse(); }',
    'catch (e) { console.error("[harness] restore failed", e); }',
    '// --- end shim epilogue ---',
    '',
  ].join('\n');
  FSR_APP_PATCHED = prelude + patched + epilogue;
  return FSR_APP_PATCHED;
}
app.get("/_fsr/app.unmin.js", (_req: express.Request, res: express.Response) => {
  try {
    const body = loadPatchedFsrApp();
    res.set("Content-Type", "application/javascript; charset=utf-8");
    res.set("Cache-Control", "no-store");
    res.send(body);
  } catch (e: unknown) {
    res.status(500).type("text/plain").send(`failed to load app.unmin.js: ${e instanceof Error ? e.message : String(e)}`);
  }
});

// Templates bundle: includes $templateCache.put(...) calls for SOAR templates
// like lookupPopover.html, required by csTypeahead + cs-conditional directives
// when uibPopover needs the template. This must load AFTER app.unmin.js but can
// load before or after harness.module.js (it only registers templates, doesn't
// require real Angular services).
// Resolve the SOAR template-cache bundle by glob, not a hardcoded hash — the
// filename carries a build hash (templates.min.<hash>.js) that differs per SOAR
// version, and `make assets` fetches whatever the connected box serves.
function resolveTemplatesFile(): string | null {
  const dir = FSR_SRC_DIR;
  if (!fs.existsSync(dir)) return null;
  const match = fs
    .readdirSync(dir)
    .filter((f) => /^templates\.min\..+\.js$/.test(f))
    .sort();
  return match.length ? path.join(dir, match[match.length - 1]) : null;
}

app.get("/_fsr/templates.min.js", (_req: express.Request, res: express.Response) => {
  try {
    const file = resolveTemplatesFile();
    if (!file) {
      return res
        .status(404)
        .type("text/plain")
        .send("no fsr_src/templates.min.*.js — run `make assets` to fetch the SOAR app shell");
    }
    const body = fs.readFileSync(file, "utf8");
    // The dangling `||` in SOAR's ui-select-choices ng-show is intentional:
    // ui-select 0.20.0's link step appends `$select.open && $select.items.length > 0`,
    // completing the expression. Stripping the `||` leaves two expressions
    // glued together and trips $parse (syntax error).
    res.set("Content-Type", "application/javascript; charset=utf-8");
    res.set("Cache-Control", "no-store");
    res.send(body);
  } catch (e: unknown) {
    res.status(500).type("text/plain").send(`failed to load templates: ${e instanceof Error ? e.message : String(e)}`);
  }
});

// Paths we serve locally; the proxy skips these.
const LOCAL_PATHS = new Set(["/", "/index.html", "/harness.module.js"]);
function isLocalPath(p: string): boolean {
  if (LOCAL_PATHS.has(p)) return true;
  if (p.startsWith("/lib/")) return true;
  for (const w of WIDGETS) {
    if (p.startsWith(`/${w.id}/`)) return true;
    if (p.startsWith(`/widgets/installed/${w.id}/`)) return true;
  }
  if (p.startsWith("/_fsr/")) return true;
  return false;
}

// Lightweight surface for the in-page status strip — a one-shot read of
// "what is this harness pointed at" without needing to scrape the proxy.
app.get("/_fsr/info", (_req: express.Request, res: express.Response) => {
  let host = "";
  try { host = new URL(HOST || "").host; } catch (_) { host = HOST || "(unset)"; }
  res.json({ proxyHost: host, widgetCount: WIDGETS.length, activeEnv: ACTIVE_ENV });
});

// SOAR target picker: list the selectable .env files and which one is active.
app.get("/_fsr/soar-envs", (_req: express.Request, res: express.Response) => {
  res.json({
    active: ACTIVE_ENV,
    envs: listEnvFiles(__dirname).map((e) => ({
      file: e.file,
      host: (() => { try { return new URL(e.host).host; } catch (_) { return e.host; } })(),
      user: e.user,
      active: e.file === ACTIVE_ENV,
    })),
  });
});

// Re-point the proxy at a different .env. Persists the choice so a restart
// keeps it. The page reloads client-side after this so the widget re-fetches
// against the new box with a fresh token.
app.post("/_fsr/soar-env", express.json(), (req: express.Request, res: express.Response) => {
  const file = req.body && req.body.file;
  if (!file) return res.status(400).json({ error: "missing 'file'" });
  try {
    const host = applySoarEnvFile(file);
    try { fs.writeFileSync(ACTIVE_ENV_STATE_FILE, file); } catch (_) {}
    let shown = host;
    try { shown = new URL(host).host; } catch (_) {}
    console.log(`[soar-env] switched proxy target -> ${file} (${shown})`);
    res.json({ active: ACTIVE_ENV, proxyHost: shown });
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.get("/_fsr/widgets", (_req: express.Request, res: express.Response) => {
  res.json({
    widgets: WIDGETS.map((w) => ({
      id: w.id,
      name: w.name,
      version: w.version,
      title: w.title,
      subTitle: w.subTitle,
      pages: w.pages,
      viewControllers: w.viewControllers || [],
      editControllers: w.editControllers || [],
      assetScripts: w.assetScripts || [],
      staleVersionRefs: w.staleVersionRefs || [],
      caps: w.caps || { monaco: false, editors: false },
      lint: w.lint || { errors: [], warnings: [] },
    })),
    registeredServices: REGISTERED_SERVICES,
  });
});

app.get("/_fsr/lint/:id", (req: express.Request, res: express.Response) => {
  const w = widgetsById.get(req.params.id);
  if (!w) return res.status(404).json({ error: "unknown widget id" });
  refreshWidget(w);
  res.json({ id: w.id, lint: w.lint });
});

// SSE: widget-change, harness-reload, proxy-log entries. Sends a hello so
// the client knows the channel is alive even if no event fires for a while.
app.get("/_fsr/events", (req: express.Request, res: express.Response) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  res.write(`data: ${JSON.stringify({ type: "hello", verbose: PROXY_VERBOSE })}\n\n`);
  sseClients.add(res);
  const ka = setInterval(() => {
    try { res.write(`: keepalive\n\n`); } catch { /* ignore */ }
  }, 25000);
  req.on("close", () => {
    clearInterval(ka);
    sseClients.delete(res);
  });
});

app.get("/_fsr/proxy-log", (_req: express.Request, res: express.Response) => {
  res.json({ entries: PROXY_LOG, verbose: PROXY_VERBOSE });
});

// Hermetic worklist: every distinct path that fell through to a HERMETIC-MISS
// during this server's lifetime. A test run can GET this to enumerate exactly
// what still needs snapshotting/stubbing (Phase 1 iteration).
app.get("/_fsr/hermetic-misses", (_req: express.Request, res: express.Response) => {
  res.json({ hermetic: HERMETIC, misses: Array.from(hermeticMisses).sort() });
});

app.post("/_fsr/proxy-log/verbose", express.json(), (req: express.Request, res: express.Response) => {
  const v = !!(req.body && req.body.verbose);
  PROXY_VERBOSE = v;
  broadcast({ type: "verbose", verbose: v });
  res.json({ verbose: v });
});

app.delete("/_fsr/proxy-log", (_req: express.Request, res: express.Response) => {
  PROXY_LOG.length = 0;
  broadcast({ type: "proxy-clear" });
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Disk cache for slow, idempotent preload calls (translations + metadata).
// In `cached` mode the harness serves from dev/cache/ on hit and fetches
// upstream + writes the cache on miss. In `live` mode the middleware no-ops
// and every request goes straight to the proxy. Toggle persists across
// restarts so devs keep their choice.
// ---------------------------------------------------------------------------
const CACHE_DIR = path.resolve(__dirname, "dev", "cache");
const CACHE_MODE_FILE = path.join(CACHE_DIR, "mode.json");
const CACHEABLE_PATTERNS = [
  /^\/locales\/static\/en\.json$/,
  /^\/api\/3\/model_metadatas(?:\?|$)/,
  /^\/api\/locale\/1\/[^/]+\/en\.json$/,
];
function isCacheable(url: string): boolean {
  return CACHEABLE_PATTERNS.some((re) => re.test(url));
}
interface CacheModeFile {
  mode: string;
}

interface CacheEntry {
  url: string;
  status: number;
  contentType: string;
  body: string;
  savedAt: number;
}

function readCacheMode(): string {
  try {
    const j = JSON.parse(fs.readFileSync(CACHE_MODE_FILE, "utf8")) as CacheModeFile;
    return j.mode === "live" ? "live" : "cached";
  } catch { return "cached"; }
}
function writeCacheMode(mode: string): void {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(CACHE_MODE_FILE, JSON.stringify({ mode }));
}
let CACHE_MODE = readCacheMode();
function cacheFileFor(url: string): string {
  const h = crypto.createHash("sha1").update(url).digest("hex");
  return path.join(CACHE_DIR, h + ".json");
}
function readCacheEntry(url: string): CacheEntry | null {
  try { return JSON.parse(fs.readFileSync(cacheFileFor(url), "utf8")) as CacheEntry; }
  catch { return null; }
}
function writeCacheEntry(url: string, entry: CacheEntry): void {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(cacheFileFor(url), JSON.stringify(entry));
}

app.get("/_fsr/cache/mode", (_req: express.Request, res: express.Response) => {
  res.json({ mode: CACHE_MODE });
});
app.post("/_fsr/cache/mode", express.json(), (req: express.Request, res: express.Response) => {
  const mode = req.body && req.body.mode === "live" ? "live" : "cached";
  CACHE_MODE = mode;
  try { writeCacheMode(mode); } catch (e: unknown) {
    return res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
  res.json({ mode });
});
app.delete("/_fsr/cache", (_req: express.Request, res: express.Response) => {
  try {
    if (fs.existsSync(CACHE_DIR)) {
      for (const f of fs.readdirSync(CACHE_DIR)) {
        if (f.endsWith(".json") && f !== "mode.json") {
          fs.unlinkSync(path.join(CACHE_DIR, f));
        }
      }
    }
    res.json({ ok: true });
  } catch (e: unknown) { res.status(500).json({ error: e instanceof Error ? e.message : String(e) }); }
});

app.use(async (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (req.method !== "GET") return next();
  if (CACHE_MODE !== "cached") return next();
  if (!isCacheable(req.originalUrl)) return next();

  const url = req.originalUrl;
  const hit = readCacheEntry(url);
  if (hit) {
    console.log(`<- 200 ${url}  (cache hit)`);
    res.setHeader("X-Harness-Cache", "hit");
    res.setHeader("Content-Type", hit.contentType || "application/json");
    return res.status(hit.status || 200).send(hit.body || "");
  }
  try {
    await ensureToken().catch(() => {});
    const headers: Record<string, string> = { Accept: "application/json" };
    if (cachedToken) headers.Authorization = `Bearer ${cachedToken}`;
    const upstream = await upstreamRequest({ method: "GET", pathAndQuery: url, headers });
    if (upstream.status >= 200 && upstream.status < 300) {
      const entry: CacheEntry = {
        url,
        status: upstream.status,
        contentType: "application/json",
        body: upstream.body,
        savedAt: Date.now(),
      };
      try { writeCacheEntry(url, entry); } catch (_) {}
      console.log(`<- ${upstream.status} ${url}  (cache miss → stored)`);
      res.setHeader("X-Harness-Cache", "miss-stored");
      res.setHeader("Content-Type", "application/json");
      return res.status(upstream.status).send(upstream.body);
    }
    console.warn(`<- ${upstream.status} ${url}  (cache miss, not stored)`);
    res.setHeader("X-Harness-Cache", "miss-bypass");
    res.setHeader("Content-Type", "application/json");
    return res.status(upstream.status).send(upstream.body);
  } catch (e: unknown) {
    console.warn(`xx cache fetch ${url}: ${e instanceof Error ? e.message : String(e)}`);
    return next();
  }
});

const PACKAGE_OUTPUT_DIR = process.env.PACKAGE_OUTPUT_DIR
  ? path.resolve(process.env.PACKAGE_OUTPUT_DIR)
  : path.resolve(__dirname, "widget-packages");
const widgetsById = new Map<string, WidgetRecord>(WIDGETS.map((w) => [w.id, w]));

// Initial lint pass for every discovered widget.
for (const w of WIDGETS) w.lint = lintFor(w);

// Hot-reload: watch each widget's directory for changes to source files. On
// any change we re-extract metadata, re-run lint, and broadcast over SSE so
// connected browsers can soft-remount without a full page reload.
const HOT_RELOAD_FILES = new Set(["info.json", ...LINT_FILES]);
function attachWatcher(w: WidgetRecord): void {
  let debounce: NodeJS.Timeout | null = null;
  try {
    fs.watch(w.dir, { persistent: false }, (_event: string | null, filename: string | null) => {
      if (!filename || !HOT_RELOAD_FILES.has(filename)) return;
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        const oldId = w.id;
        refreshWidget(w);
        if (oldId !== w.id) console.log(`reload ${oldId} -> ${w.id}`);
        broadcast({ type: "widget-change", id: w.id, oldId, file: filename, lint: w.lint });
      }, 80);
    });
  } catch (e: unknown) {
    console.warn(`watch failed for ${w.folder}: ${e instanceof Error ? e.message : String(e)}`);
  }
}
// Skip hot-reload watchers under hermetic (e2e) mode — see HARNESS_MODULE_PATH
// watcher above for why a soft-remount mid-test corrupts deterministic runs.
if (!HERMETIC) for (const w of WIDGETS) attachWatcher(w);

// Register a freshly imported widget: build its record, lint, mount, watch,
// and broadcast a widget-change so the connected browser refreshes its
// dropdown. Throws if the folder isn't a valid widget on disk.
function registerImportedWidget(folder: string): WidgetRecord {
  const w = buildWidgetRecord(folder);
  if (!w) throw new Error(`widgets-src/${folder} is not a valid widget`);
  if (widgetsById.has(w.id)) {
    throw new Error(`widget id ${w.id} already exists; rename folder or bump version`);
  }
  WIDGETS.push(w);
  widgetsById.set(w.id, w);
  w.lint = lintFor(w);
  mountWidget(w);
  attachWatcher(w);
  broadcast({ type: "widget-change", id: w.id, oldId: w.id, file: "imported", lint: w.lint });
  return w;
}

function readCurrentInfo(widget: WidgetRecord): { info: InfoJson; infoPath: string } {
  const infoPath = path.join(widget.dir, "info.json");
  const info = JSON.parse(fs.readFileSync(infoPath, "utf8")) as InfoJson;
  return { info, infoPath };
}

// Auto-fix endpoint: when info.json's version no longer matches the digits
// embedded in the controller identifiers, rewrite each controller file by
// substituting every occurrence of the old name with the expected one. Only
// safe when the registered name matches the SOAR convention exactly.
interface ControllerFix {
  file: string;
  replaced?: string[];
  expected?: string;
  replacedVersions?: string[];
  to?: string;
}
app.post("/_fsr/fix-controllers/:id", (req: express.Request, res: express.Response) => {
  const w = widgetsById.get(req.params.id);
  if (!w) return res.status(404).json({ error: "unknown widget id" });
  const expectedView = HU.deriveControllerName(w.name, w.version);
  const expectedEdit = HU.deriveEditControllerName(w.name, w.version);
  const cap = w.name.charAt(0).toUpperCase() + w.name.slice(1);
  const viewPattern = new RegExp("^" + w.name + "\\d+DevCtrl$");
  const editPattern = new RegExp("^edit" + cap + "\\d+DevCtrl$");

  const fixes: ControllerFix[] = [];
  const tryFix = (file: string, expected: string, pattern: RegExp) => {
    const p = path.join(w.dir, file);
    if (!fs.existsSync(p)) return;
    const src = fs.readFileSync(p, "utf8");
    const registered = HU.extractRegisteredControllers(src);
    const stale = registered.filter((n) => pattern.test(n) && n !== expected);
    if (stale.length === 0) return;
    let next = src;
    for (const old of stale) {
      next = next.split(old).join(expected);
    }
    fs.writeFileSync(p, next, "utf8");
    fixes.push({ file, replaced: stale, expected });
  };

  try {
    tryFix("view.controller.js", expectedView, viewPattern);
    tryFix("edit.controller.js", expectedEdit, editPattern);
  } catch (e: unknown) {
    return res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }

  // Sweep all known files for stale `<name>-X.Y.Z` references and rewrite
  // them to the current version. Same idempotent string-replace approach.
  try {
    const re = staleRefRegex(w.name);
    for (const file of VERSIONED_REF_FILES) {
      const p = path.join(w.dir, file);
      if (!fs.existsSync(p)) continue;
      const src = fs.readFileSync(p, "utf8");
      const stale = new Set<string>();
      let m: RegExpExecArray | null;
      re.lastIndex = 0;
      while ((m = re.exec(src)) !== null) {
        if (m[1] !== w.version) stale.add(m[1]);
      }
      if (stale.size === 0) continue;
      let next = src;
      for (const oldVer of stale) {
        next = next.split(`${w.name}-${oldVer}`).join(`${w.name}-${w.version}`);
      }
      fs.writeFileSync(p, next, "utf8");
      fixes.push({ file, replacedVersions: Array.from(stale), to: w.version });
    }
  } catch (e: unknown) {
    return res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }

  // Refresh the cached registrations so /_fsr/widgets reflects the change.
  const reread = (file: string): string[] => {
    const p = path.join(w.dir, file);
    if (!fs.existsSync(p)) return [];
    try { return HU.extractRegisteredControllers(fs.readFileSync(p, "utf8")); }
    catch (_) { return []; }
  };
  w.viewControllers = reread("view.controller.js");
  w.editControllers = reread("edit.controller.js");
  w.staleVersionRefs = scanStaleVersionRefs(w.dir, w.name, w.version);

  res.json({
    fixes,
    viewControllers: w.viewControllers,
    editControllers: w.editControllers,
    staleVersionRefs: w.staleVersionRefs,
  });
});

app.get("/_fsr/package/:id/info", (req: express.Request, res: express.Response) => {
  const w = widgetsById.get(req.params.id);
  if (!w) return res.status(404).json({ error: "unknown widget id" });
  try {
    const { info } = readCurrentInfo(w);
    res.json({ name: info.name, version: info.version, compatibility: (info.metadata && info.metadata.compatibility) || [] });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

function blockingLintErrors(w: WidgetRecord): LintResult['errors'] {
  refreshWidget(w);
  const errs = (w.lint && w.lint.errors) || [];
  return errs;
}

// Applies a JSON merge patch to the widget's info.json. Intended to be called
// by the harness UI after a 400 from /_fsr/package or /_fsr/install — the
// failure response includes a `suggestedFix` patch the user can review and
// POST back here. Body: { patch: <object> }. Refuses any patch that wouldn't
// clear validation errors so we never silently introduce something invalid.
app.post("/_fsr/fix-info/:id", express.json(), (req: express.Request, res: express.Response) => {
  const w = widgetsById.get(req.params.id);
  if (!w) return res.status(404).json({ error: "unknown widget id" });
  const patch = req.body && req.body.patch;
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    return res.status(400).json({ error: "body.patch must be an object" });
  }
  try {
    const { info, infoPath } = readCurrentInfo(w);
    // Sanity check: the patch must only touch known-safe keys (currently
    // metadata.* fields the validator can suggest defaults for). Block any
    // attempt to rewrite name/version/etc through this endpoint.
    const allowedTopLevel = new Set(["metadata"]);
    const allowedMetaKeys = new Set(["windowClass", "size", "standalone", "pages", "compatibility"]);
    for (const k of Object.keys(patch)) {
      if (!allowedTopLevel.has(k)) {
        return res.status(400).json({ error: `patch key '${k}' not allowed` });
      }
      if (k === "metadata") {
        for (const mk of Object.keys((patch as Record<string, unknown>).metadata || {})) {
          if (!allowedMetaKeys.has(mk)) {
            return res.status(400).json({ error: `patch metadata.${mk} not allowed` });
          }
        }
      }
    }
    const updated = applyInfoFix(infoPath, patch);
    const after = validateWidget(w.dir, updated);
    console.log(`fix-info: ${w.folder} patched ${JSON.stringify(patch)}`);
    res.json({
      ok: true,
      info: updated,
      validation: after,
    });
  } catch (e: unknown) {
    console.error(`fix-info failed for ${w.folder}: ${e instanceof Error ? e.message : String(e)}`);
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.post("/_fsr/package/:id", express.json(), async (req: express.Request, res: express.Response) => {
  const w = widgetsById.get(req.params.id);
  if (!w) return res.status(404).json({ error: "unknown widget id" });

  const body = (req.body || {}) as Record<string, unknown>;
  // Lint runs AFTER the version sync below — running it here against the
  // pre-bump source would block on stale-version-ref every time the user
  // typed a new version into the bump form, even though syncSourceToInfoJson
  // would have rewritten the references a few lines later. Order matters.
  try {
    const { info, infoPath } = readCurrentInfo(w);
    let version = info.version;

    if (body.version != null && body.version !== "") {
      if (!isValidVersion(String(body.version))) {
        return res.status(400).json({ error: `invalid version: ${body.version}` });
      }
      version = String(body.version);
    } else if (body.bump) {
      if (!["patch", "minor", "major"].includes(String(body.bump))) {
        return res.status(400).json({ error: `invalid bump: ${body.bump}` });
      }
      version = bumpVersion(version, String(body.bump) as "patch" | "minor" | "major");
    }

    if (version !== info.version) {
      writeInfoVersion(infoPath, version);
      // Keep source controllers + view.html in lockstep with info.json so
      // the harness-mounted ng-controller matches the registered name and
      // SOAR's derived `<name><digits>DevCtrl` expectation.
      syncSourceToInfoJson(w.dir, info.name, version);
      console.log(`package: ${w.folder} version ${info.version} -> ${version}`);
    }

    if (!body.skipLint) {
      const errs = blockingLintErrors(w);
      if (errs.length > 0) {
        return res.status(400).json({ error: "lint failed", lint: { errors: errs } });
      }
    }

    const freshInfoForValidation = readCurrentInfo(w).info;
    const preflight = validateWidget(w.dir, freshInfoForValidation);
    if (preflight.errors.length > 0) {
      return res.status(400).json({
        error: "widget validation failed",
        validation: preflight,
        suggestedFix: suggestInfoFix(freshInfoForValidation),
        fixEndpoint: `/_fsr/fix-info/${req.params.id}`,
      });
    }

    const result = await packageWidget(w.dir, PACKAGE_OUTPUT_DIR);
    console.log(`package: built ${result.archiveName} (${result.fileCount} files, ${result.size} bytes)`);

    res.setHeader("Content-Type", "application/gzip");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${result.archiveName}"`
    );
    res.setHeader("X-Package-Version", result.version);
    res.setHeader("X-Package-Path", result.archivePath);
    fs.createReadStream(result.archivePath).pipe(res);
  } catch (e: unknown) {
    console.error(`package failed for ${w.folder}: ${e instanceof Error ? e.message : String(e)}`);
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// Full round-trip: package -> POST solutionpacks/install -> PUT publish.
// Mirrors the two-step flow the FortiSOAR UI uses. Accepts the same
// bump/version body shape as /_fsr/package/:id so the harness can reuse
// the package-panel inputs.
app.post("/_fsr/install/:id", express.json(), async (req: express.Request, res: express.Response) => {
  const w = widgetsById.get(req.params.id);
  if (!w) return res.status(404).json({ error: "unknown widget id" });

  const body = (req.body || {}) as Record<string, unknown>;
  // Lint runs AFTER the version sync below, same reasoning as /_fsr/package.
  try {
    const { info, infoPath } = readCurrentInfo(w);
    let version = info.version;
    if (body.version != null && body.version !== "") {
      if (!isValidVersion(String(body.version))) {
        return res.status(400).json({ error: `invalid version: ${body.version}` });
      }
      version = String(body.version);
    } else if (body.bump) {
      if (!["patch", "minor", "major"].includes(String(body.bump))) {
        return res.status(400).json({ error: `invalid bump: ${body.bump}` });
      }
      version = bumpVersion(version, String(body.bump) as "patch" | "minor" | "major");
    }
    if (version !== info.version) {
      writeInfoVersion(infoPath, version);
      syncSourceToInfoJson(w.dir, info.name, version);
      console.log(`install: ${w.folder} version ${info.version} -> ${version}`);
    }

    if (!body.skipLint) {
      const errs = blockingLintErrors(w);
      if (errs.length > 0) {
        return res.status(400).json({ error: "lint failed", lint: { errors: errs } });
      }
    }

    const freshInfoForValidation = readCurrentInfo(w).info;
    const preflight = validateWidget(w.dir, freshInfoForValidation);
    if (preflight.errors.length > 0) {
      console.warn(
        `install: validation failed for ${w.folder}: ${preflight.errors.join("; ")}`
      );
      return res.status(400).json({
        error: "widget validation failed",
        validation: preflight,
        suggestedFix: suggestInfoFix(freshInfoForValidation),
        fixEndpoint: `/_fsr/fix-info/${req.params.id}`,
      });
    }

    const pkg = await packageWidget(w.dir, PACKAGE_OUTPUT_DIR);
    console.log(`install: packaged ${pkg.archiveName} (${pkg.size} bytes)`);

    const token = await ensureToken();
    const uploadRes = await upstreamMultipart({
      pathAndQuery: "/api/3/solutionpacks/install?$type=widget&$replace=true",
      headers: { Authorization: `Bearer ${token}` },
      fields: { $type: "widget", $replace: "true" },
      file: {
        name: "file",
        filename: pkg.archiveName,
        contentType: "application/gzip",
        content: fs.readFileSync(pkg.archivePath),
      },
    });
    if (uploadRes.status < 200 || uploadRes.status >= 300) {
      return res.status(502).json({
        error: `upload ${uploadRes.status}`,
        body: uploadRes.body.slice(0, 1000),
      });
    }

    let uploaded: Record<string, unknown>;
    try {
      uploaded = JSON.parse(uploadRes.body) as Record<string, unknown>;
    } catch (e: unknown) {
      return res.status(502).json({
        error: "upload response was not JSON",
        body: uploadRes.body.slice(0, 500),
      });
    }
    const uuid = uploaded.uuid;
    if (!uuid) {
      return res
        .status(502)
        .json({ error: "upload response missing uuid", response: uploaded });
    }
    console.log(`install: uploaded widget uuid=${uuid}, now publishing…`);

    // Publish via PUT. SOAR needs a beat to finish processing the tgz
    // before it accepts the draft->published transition, so retry a few
    // times on 4xx. 200 on success.
    const freshInfo = readCurrentInfo(w).info;
    const publishPayload: Record<string, unknown> = {
      name: freshInfo.name,
      title: freshInfo.title,
      subTitle: freshInfo.subTitle,
      version: freshInfo.version,
      published_date: freshInfo.published_date,
      releaseNotes: freshInfo.releaseNotes,
      metadata: freshInfo.metadata,
      "@id": `/api/3/widgets/${uuid}`,
      draft: true,
      installed: true,
      enablePublish: false,
      replace: true,
      replaceVersions: [],
      publishedDate: Math.floor(Date.now() / 1000),
    };
    const publishBody = JSON.stringify(publishPayload);

    let publishRes: UpstreamResponse | null = null;
    let lastErr: string | null = null;
    const maxAttempts = 10;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 1000));
      publishRes = await upstreamRequest({
        method: "PUT",
        pathAndQuery: `/api/3/widgets/${uuid}`,
        body: publishBody,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });
      if (publishRes.status >= 200 && publishRes.status < 300) break;
      lastErr = `${publishRes.status} ${publishRes.body.slice(0, 300)}`;
      console.warn(`install: publish attempt ${attempt + 1} failed: ${lastErr}`);
    }
    if (!publishRes || publishRes.status < 200 || publishRes.status >= 300) {
      return res.status(502).json({
        error: `publish failed after ${maxAttempts} attempts: ${lastErr}`,
      });
    }
    console.log(`install: published ${freshInfo.name}-${freshInfo.version}`);
    res.json({
      ok: true,
      uuid: uuid,
      name: freshInfo.name,
      version: freshInfo.version,
      archive: pkg.archiveName,
      size: pkg.size,
    });
  } catch (e: unknown) {
    console.error(`install failed for ${w.folder}: ${e instanceof Error ? e.message : String(e)}`);
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// List widgets installed on the proxied SOAR instance. The harness UI uses
// this to populate the import picker. We pass the response through largely
// unchanged so the picker can sort/filter on whatever fields it wants.
interface RemoteWidget {
  uuid: string;
  name: string;
  version: string;
  title: string;
  subTitle: string;
  section: string;
  inbuilt: boolean;
}
app.get("/_fsr/remote-widgets", async (_req: express.Request, res: express.Response) => {
  try {
    const token = await ensureToken();
    const result = await upstreamRequest({
      method: "GET",
      pathAndQuery: "/api/3/widgets?$limit=500",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    if (result.status < 200 || result.status >= 300) {
      return res.status(502).json({
        error: `upstream ${result.status}`,
        body: result.body.slice(0, 500),
      });
    }
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(result.body) as Record<string, unknown>; }
    catch (e: unknown) { return res.status(502).json({ error: "non-JSON upstream response" }); }
    const members = (parsed["hydra:member"] || parsed.member || parsed.data || []) as Array<Record<string, unknown>>;
    const widgets: RemoteWidget[] = members.map((w) => ({
      uuid: String(w.uuid || ""),
      name: String(w.name || ""),
      version: String(w.version || ""),
      title: String(w.title || w.name || ""),
      subTitle: String(w.subTitle || ""),
      section: String((w.metadata && (w.metadata as Record<string, unknown>).section) || w.section || ""),
      inbuilt: !!(w.inbuilt || w.systemManaged),
    })).filter((w) => w.uuid);
    widgets.sort((a, b) => a.title.localeCompare(b.title));
    res.json({ widgets, total: widgets.length });
  } catch (e: unknown) {
    res.status(502).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// Import a widget from SOAR: POST /api/3/widgets/export/<uuid> -> tgz, then
// extract into widgets-src/<folder>/widget/. The folder argument must be a
// safe slug; if omitted we derive one from the widget's name. Refuses to
// overwrite an existing folder so the user has to consciously pick a new
// slot when forking. After extract, the widget is hot-attached (lint, mount,
// watch) and a widget-change SSE event is broadcast.
const SAFE_FOLDER_RE = /^[a-zA-Z0-9_-]+$/;
function deriveFolderName(name: string): string {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 64);
}
function extractTgz(tgzPath: string, destDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("tar", ["-xzf", tgzPath, "-C", destDir], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    (child.stderr as NodeJS.ReadableStream).on("data", (c: Buffer) => (stderr += c.toString()));
    child.on("error", reject);
    child.on("close", (code: number) =>
      code === 0 ? resolve() : reject(new Error(`tar exit ${code}: ${stderr.trim()}`))
    );
  });
}

// Shared pipeline: take a tgz buffer, extract its single `<name>-<ver>/` root
// into widgets-src/<folder>/widget, rewrite controllers to the dev suffix, and
// hot-attach the widget. Returns the registered widget record or throws an
// Error with .status set for HTTP-mappable failures.
interface TgzInstallError extends Error {
  status?: number;
}
async function installTgzBuffer(tgzBuf: Buffer, folderArg?: string): Promise<{ widget: WidgetRecord; folder: string; info: InfoJson }> {
  if (folderArg && !SAFE_FOLDER_RE.test(folderArg)) {
    const err: TgzInstallError = new Error("folder must match [A-Za-z0-9_-]+");
    err.status = 400; throw err;
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-tgz-"));
  const tgzPath = path.join(tmp, "widget.tgz");
  try {
    fs.writeFileSync(tgzPath, tgzBuf);
    await extractTgz(tgzPath, tmp);
    const entries = fs
      .readdirSync(tmp)
      .filter((n) => n !== "widget.tgz")
      .map((n) => ({ n, full: path.join(tmp, n) }))
      .filter((e) => fs.statSync(e.full).isDirectory());
    if (entries.length !== 1) {
      const err: TgzInstallError = new Error(`unexpected tgz layout: ${entries.map((e) => e.n).join(", ") || "<empty>"}`);
      err.status = 400; throw err;
    }
    const extracted = entries[0].full;
    const infoPath = path.join(extracted, "info.json");
    if (!fs.existsSync(infoPath)) {
      const err: TgzInstallError = new Error("tgz missing info.json"); err.status = 400; throw err;
    }
    const info = JSON.parse(fs.readFileSync(infoPath, "utf8")) as InfoJson;
    const folder = folderArg || deriveFolderName(String(info.name || ""));
    if (!folder) {
      const err: TgzInstallError = new Error("could not derive folder name"); err.status = 400; throw err;
    }
    const dest = path.join(WIDGETS_SRC, folder);
    if (fs.existsSync(dest)) {
      const err: TgzInstallError = new Error(`widgets-src/${folder} already exists`); err.status = 409; throw err;
    }
    fs.mkdirSync(dest, { recursive: true });
    fs.cpSync(extracted, path.join(dest, "widget"), { recursive: true });
    try {
      syncSourceToInfoJson(path.join(dest, "widget"), info.name, info.version);
    } catch (e: unknown) {
      console.warn(`tgz install: controller rewrite failed for ${folder}: ${e instanceof Error ? e.message : String(e)}`);
    }
    return { widget: registerImportedWidget(folder), folder, info };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

app.post("/_fsr/import/:uuid", express.json(), async (req: express.Request, res: express.Response) => {
  const uuid = req.params.uuid;
  if (!/^[a-zA-Z0-9-]+$/.test(uuid)) return res.status(400).json({ error: "bad uuid" });
  const body = (req.body || {}) as Record<string, unknown>;
  const folderArg = body.folder ? String(body.folder).trim() : "";

  try {
    const token = await ensureToken();
    const exportRes = await upstreamRequestBinary({
      method: "POST",
      pathAndQuery: `/api/3/widgets/export/${uuid}`,
      body: JSON.stringify({ development: false }),
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/octet-stream",
      },
    });
    if (exportRes.status < 200 || exportRes.status >= 300) {
      return res.status(502).json({
        error: `export ${exportRes.status}`,
        body: exportRes.body.slice(0, 300).toString("utf8"),
      });
    }
    const { widget: w, folder, info } = await installTgzBuffer(exportRes.body, folderArg);
    const infoName = (info.name || "") as string;
    const infoVersion = (info.version || "") as string;
    console.log(`import: ${infoName}-${infoVersion} -> widgets-src/${folder}`);
    res.json({ ok: true, folder, id: w.id, name: w.name, version: w.version, title: w.title });
  } catch (e: unknown) {
    console.error(`import failed for ${uuid}: ${e instanceof Error ? e.message : String(e)}`);
    res.status((e as TgzInstallError).status || 500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// Manual upload: POST a .tgz body (application/gzip or application/octet-stream)
// with optional `?folder=` query. Same extraction + register pipeline as the
// SOAR-export import, just without the upstream call.
app.post(
  "/_fsr/upload-tgz",
  express.raw({ type: ["application/gzip", "application/x-gzip", "application/octet-stream"], limit: "100mb" }),
  async (req: express.Request, res: express.Response) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ error: "request body must be a .tgz (raw bytes)" });
    }
    const folderArg = req.query.folder ? String(req.query.folder).trim() : "";
    try {
      const { widget: w, folder, info } = await installTgzBuffer(req.body, folderArg);
      console.log(`upload-tgz: ${info.name}-${info.version} -> widgets-src/${folder} (${req.body.length} bytes)`);
      res.json({ ok: true, folder, id: w.id, name: w.name, version: w.version, title: w.title });
    } catch (e: unknown) {
      console.error(`upload-tgz failed: ${e instanceof Error ? e.message : String(e)}`);
      res.status((e as TgzInstallError).status || 500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  }
);

app.get("/_fsr/stylesheets", async (_req: express.Request, res: express.Response) => {
  // Hermetic mode: this endpoint normally scrapes the live SOAR index for its
  // <link> hrefs — an outbound forticloud call, and the hrefs it returns
  // (/css/style.min.<hash>.css, /css/themes/<theme>.css) then 599 since we don't
  // snapshot platform CSS. Both break hermeticity for purely cosmetic styling.
  // Return none: widgets render with harness chrome only, which is all the mock
  // gate asserts (platform-theme fidelity is covered by the live sweep).
  if (HERMETIC) return res.json({ stylesheets: [] });
  try {
    await ensureToken().catch(() => {});
    const result = await upstreamRequest({
      method: "GET",
      pathAndQuery: "/",
      headers: cachedToken ? { Authorization: `Bearer ${cachedToken}` } : {},
    });
    if (result.status < 200 || result.status >= 400) {
      return res.status(502).json({
        error: `upstream ${result.status}`,
        body: result.body.slice(0, 500),
      });
    }
    const hrefs: string[] = [];
    const linkRe = /<link\b[^>]*>/gi;
    const relRe = /rel\s*=\s*["']?([^"'>\s]+)/i;
    const hrefRe = /href\s*=\s*["']([^"']+)["']/i;
    let m: RegExpExecArray | null;
    while ((m = linkRe.exec(result.body)) !== null) {
      const tag = m[0];
      const rel = (tag.match(relRe) || [])[1] || "";
      if (!/stylesheet/i.test(rel)) continue;
      const href = (tag.match(hrefRe) || [])[1];
      if (href) hrefs.push(href);
    }
    res.json({ stylesheets: hrefs });
  } catch (e: unknown) {
    res.status(502).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

async function ensureAuthMiddleware(req: express.Request, res: express.Response, next: express.NextFunction): Promise<void> {
  // Fast path: if a non-expired token is cached, call next() synchronously.
  // Awaiting an already-resolved promise still defers to a microtask, which
  // is enough to break http-proxy-middleware v3 POST body streaming on some
  // Node versions (browser sees ERR_EMPTY_RESPONSE after proxyTimeout).
  if (cachedToken && Date.now() < tokenExpiry - REFRESH_SKEW_MS) {
    return next();
  }
  try {
    await ensureToken();
    next();
  } catch (e: unknown) {
    console.error(
      `auth failed for ${req.method} ${req.originalUrl}: ${e instanceof Error ? e.message : String(e)}`
    );
    res.status(502).json({ error: `FortiSOAR auth failed: ${e instanceof Error ? e.message : String(e)}` });
  }
}

// Body capture for the in-page Network tab. We only buffer when verbose mode
// is on (or the request is non-asset /api/*) to keep the ring buffer useful.
// Bodies are truncated to BODY_CAP bytes; binary payloads are flagged.
const BODY_CAP = 4096;
interface TruncatedBody {
  text: string;
  truncated: boolean;
  binary: boolean;
}
function shouldCapture(req: express.Request): boolean {
  if (!PROXY_VERBOSE && !req.originalUrl.startsWith("/api/")) return false;
  return true;
}
function truncate(buf: Buffer | null): TruncatedBody {
  if (!buf) return { text: "", truncated: false, binary: false };
  const ascii = buf.slice(0, BODY_CAP).toString("utf8");
  const binary = /[\x00-\x08\x0E-\x1F]/.test(ascii.slice(0, 256));
  return { text: ascii, truncated: buf.length > BODY_CAP, binary };
}

interface ProxyRequest extends express.Request {
  __startMs?: number;
  __capture?: boolean;
}
interface ProxyRes extends http.IncomingMessage {
  statusCode: number;
}

const proxy = createProxyMiddleware({
  pathFilter: (p: string) => !isLocalPath(p),
  target: HOST,
  // HOST is mutable (the UI can re-point the proxy at another .env at runtime),
  // and `target` is captured once at setup — so resolve the live target per
  // request via `router`. Returns the current HOST every call.
  router: () => HOST,
  changeOrigin: true,
  secure: false,
  ws: true,
  selfHandleResponse: false,
  // Cap proxy waits so an unreachable SOAR host (e.g. /node_modules/...)
  // fails the browser request in seconds, not TCP-retry minutes.
  timeout: 10000,
  proxyTimeout: 10000,
  on: {
    proxyReq(proxyReq: http.ClientRequest, req: ProxyRequest) {
      if (cachedToken) {
        proxyReq.setHeader("Authorization", `Bearer ${cachedToken}`);
      }
      req.__startMs = Date.now();
      req.__capture = shouldCapture(req);
      console.log(`-> ${req.method} ${req.originalUrl}`);
    },
    proxyRes(proxyRes: ProxyRes, req: ProxyRequest) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- http-proxy-middleware has imprecise types
      delete (proxyRes.headers as any)["content-security-policy"];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- http-proxy-middleware has imprecise types
      delete (proxyRes.headers as any)["content-security-policy-report-only"];
      // Make proxied font files cacheable within the dev session. SOAR serves
      // them `no-store`, which (a) re-downloads every font on every render and
      // (b) defeats the Lato dedup redirect above — the redirect unifies the
      // npm + SOAR Lato URLs onto one path, but no-store forces the browser to
      // re-fetch it anyway. Fonts are immutable content, so a short max-age is
      // safe and lets the second reference hit cache. (Introspection backlog #2.)
      if (/\.(woff2?|ttf|otf|eot)(\?|$)/i.test(req.url || "")) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- http-proxy-middleware has imprecise types
        const h = proxyRes.headers as any;
        h["cache-control"] = "public, max-age=300";
        delete h["pragma"];
        delete h["expires"];
      }
      if (proxyRes.statusCode === 401) {
        console.warn(`<- 401 ${req.originalUrl}  (invalidating cached token)`);
        invalidateToken();
      } else if (proxyRes.statusCode >= 400) {
        console.warn(`<- ${proxyRes.statusCode} ${req.originalUrl}`);
      } else {
        console.log(`<- ${proxyRes.statusCode} ${req.originalUrl}`);
      }

      if (req.__capture) {
        const chunks: Buffer[] = [];
        let total = 0;
        proxyRes.on("data", (c: Buffer) => {
          if (total < BODY_CAP) chunks.push(c);
          total += c.length;
        });
        proxyRes.on("end", () => {
          const buf = Buffer.concat(chunks);
          recordProxy({
            ts: Date.now(),
            ms: Date.now() - (req.__startMs || Date.now()),
            method: req.method,
            url: req.originalUrl,
            status: proxyRes.statusCode,
            reqHeaders: redactHeaders(req.headers as Record<string, string | string[] | undefined>),
            resHeaders: redactHeaders(proxyRes.headers as Record<string, string | string[] | undefined>),
            resBody: truncate(buf),
            resBodyLength: total,
          });
        });
      }
    },
    error(err: Error, req: ProxyRequest, res: express.Response) {
      console.error(`xx ${req.originalUrl}  ${err.message}`);
      recordProxy({
        ts: Date.now(),
        ms: Date.now() - (req.__startMs || Date.now()),
        method: req.method,
        url: req.originalUrl,
        status: 0,
        error: err.message,
      });
      if (res && !res.headersSent)
        res.status(502).json({ error: err.message });
    },
  },
});

// Hermetic platform-boot stubs (HERMETIC_E2E_PLAN.md Phase 2). The SOAR
// app.unmin.js bundle fires a couple of global boot reads (current actor +
// system fixtures) as it initializes usersService. Un-stubbed they 599 under
// hermetic mode and surface as AngularJS "Possibly unhandled rejection" console
// errors that red specs asserting a clean console. These are platform-global
// (not widget-specific), so they live here rather than in widgetAssets/fixtures.
if (HERMETIC) {
  // Current user — a minimal but valid SOAR actor so usersService resolves
  // instead of throwing "Unable to retrieve user".
  app.get("/api/3/actors/current", (_req: express.Request, res: express.Response) => {
    res.json({
      "@id": "/api/3/people/00000000-0000-0000-0000-000000000001",
      "@type": "People",
      uuid: "00000000-0000-0000-0000-000000000001",
      id: 1,
      name: "Harness User",
      loginid: "harness",
      email: "harness@localhost",
      roles: [],
    });
  });
  // System fixtures — the SYSTEM_MODULES list modelMetadatasService.getSystemModules
  // iterates to set `metadata.<type>` for every system module (picklists,
  // workflows, …). An empty list leaves `metadata.picklists` unset, so
  // Entity.loadFields("picklists") rejects with "picklists module metadata not
  // found" — which stalls every grid widget's execution chain (loadProcessing
  // never clears). Serve the real snapshot fetched per-dev into fsr_src/ (same
  // licensed-asset home as app.unmin.js, gitignored, refreshed by
  // scripts/fetch-soar-assets.sh). Fall back to [] when it hasn't been fetched
  // yet — non-grid widgets don't need it.
  const SYSTEM_FIXTURES_PATH = path.join(FSR_SRC_DIR, "system_fixtures.json");
  app.get("/api/system/fixtures", (_req: express.Request, res: express.Response) => {
    try {
      res.type("application/json").send(fs.readFileSync(SYSTEM_FIXTURES_PATH, "utf8"));
    } catch {
      res.json([]);
    }
  });
  // Picklist option values. Once metadata.picklists is seeded (above),
  // Entity.loadFields() resolves the picklist-typed fields and the platform
  // fetches their option lists (one GET per listName: Severity, AlertStatus, …).
  // Widgets that render their own data (jsonToGrid renders grid_data/grid_columns,
  // not picklist options) don't need real values — an empty collection lets the
  // field-load chain resolve so loadProcessing clears. Keeps the grid e2e tier
  // hermetic without snapshotting every picklist.
  app.get("/api/3/picklists", (_req: express.Request, res: express.Response) =>
    res.json({ "hydra:member": [], "hydra:totalItems": 0 })
  );
  // System settings — once the grid fully renders, csGrid/platform services read
  // /api/3/system_settings (timezone, date format, pagination defaults, …).
  // Served from the per-dev snapshot fetched into fsr_src/ alongside the
  // fixtures (gitignored; refreshed by scripts/fetch-soar-assets.sh). Fall back
  // to a minimal empty collection so non-grid widgets still boot if it's absent.
  const SYSTEM_SETTINGS_PATH = path.join(FSR_SRC_DIR, "system_settings.json");
  app.get("/api/3/system_settings", (_req: express.Request, res: express.Response) => {
    try {
      res.type("application/json").send(fs.readFileSync(SYSTEM_SETTINGS_PATH, "utf8"));
    } catch {
      res.json({
        "@id": "/api/3/system_settings",
        "@type": "hydra:Collection",
        "hydra:member": [],
        "hydra:totalItems": 0,
      });
    }
  });
}

// Hermetic gate: in hermetic mode nothing reaches the proxy. A request that
// got this far was NOT served by any local static/stub middleware, so it would
// have fallen through to forticloud — fail it loudly instead. The 599 status +
// `HERMETIC-MISS:` body make the leak grep-able in test output and via
// /_fsr/hermetic-misses. Whitelist auth handshake paths only if needed; today
// the auth middleware short-circuits because no /api call should miss locally.
if (HERMETIC) {
  app.use((req: express.Request, res: express.Response) => {
    hermeticMisses.add(req.path);
    console.warn(`599 HERMETIC-MISS: ${req.method} ${req.originalUrl}`);
    res
      .status(599)
      .type("text/plain")
      .send(`HERMETIC-MISS: ${req.method} ${req.path}\n` +
        `This path was not served locally and hermetic mode blocks the ` +
        `forticloud proxy. Snapshot it (scripts/fetch-soar-assets.sh) or add ` +
        `a stub (Phase 2) so the mock e2e tier stays box-independent.`);
  });
} else {
  app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (req.path.startsWith("/api/")) return ensureAuthMiddleware(req, res, next);
    next();
  });
  app.use(proxy);
}

if (require.main === module) {
  if (!HOST || !USER || !PASS) {
    console.error(
      "Missing FSR_BASE_URL / FSR_USERNAME / FSR_PASSWORD. " +
        "Copy .env.example to .env and fill it in."
    );
    process.exit(1);
  }
  app.listen(PORT, async () => {
    console.log(`\nharness  http://localhost:${PORT}`);
    console.log(`proxy    ${HOST}\n`);
    try {
      await ensureToken();
    } catch (e: unknown) {
      console.error(`warning: initial auth failed: ${e instanceof Error ? e.message : String(e)}`);
      console.error("server is up; it will retry on the first proxied request.");
    }
  });
} else {
  module.exports = { app, isLocalPath, discoverWidgets, decodeJwtExpiryMs };
}
