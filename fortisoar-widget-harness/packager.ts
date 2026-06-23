"use strict";
import fs = require("fs");
import os = require("os");
import path = require("path");
import { InfoJson } from "./lib/types";
const { spawn } = require("child_process");

const REQUIRED_FILES = [
  "info.json",
  "view.html",
  "edit.html",
  "view.controller.js",
  "edit.controller.js",
];

function versionToNumeric(v: unknown): string {
  return String(v).replace(/\./g, "");
}

function bumpVersion(current: unknown, part: string): string {
  const parts = String(current).split(".").map((n) => parseInt(n, 10));
  while (parts.length < 3) parts.push(0);
  for (let i = 0; i < parts.length; i++) if (!Number.isFinite(parts[i])) parts[i] = 0;
  if (part === "major") {
    parts[0] += 1;
    parts[1] = 0;
    parts[2] = 0;
  } else if (part === "minor") {
    parts[1] += 1;
    parts[2] = 0;
  } else if (part === "patch") {
    parts[2] += 1;
  } else {
    throw new Error(`unknown bump part: ${part}`);
  }
  return parts.slice(0, 3).join(".");
}

function isValidVersion(v: unknown): boolean {
  return typeof v === "string" && /^\d+(\.\d+){0,2}$/.test(v);
}


function writeInfoVersion(infoPath: string, newVersion: string): InfoJson {
  const raw = fs.readFileSync(infoPath, "utf8");
  const info: InfoJson = JSON.parse(raw);
  info.version = newVersion;
  // Preserve trailing newline if present
  const trailingNewline = /\n$/.test(raw) ? "\n" : "";
  fs.writeFileSync(infoPath, JSON.stringify(info, null, 2) + trailingNewline);
  return info;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function decapitalize(s: string): string {
  return s ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

interface RewriteOpts {
  rewritePaths?: boolean;
}

// Rewrites controller references to `<name><numericVersion>DevCtrl` — the
// shape SOAR resolves at install time when `development: true`. Mirrors
// the four regex passes in ~/.local/bin/package-widget-simp. Extends the
// reference by also rewriting view.html (ng-controller + versioned
// `<widgetName>-X.Y.Z/` path refs), since source view.html must match the
// registered controller name for the harness and the packaged tgz alike.
//
// NOTE on suffix: Source / harness / dev-preview uses `DevCtrl`; SOAR's
// publish pipeline strips `Dev` on install so the registered controller
// matches `widgetTemplateService.generateWidgetDefinition`'s expected
// `<name><ver>Ctrl`. Keep `DevCtrl` here.
function rewriteForVersion(dir: string, widgetName: string, version: string): void {
  const numver = versionToNumeric(version);
  const newver = `${numver}Dev`;
  const variations = uniq([
    widgetName,
    capitalize(widgetName),
    decapitalize(widgetName),
  ]);
  // Match `<name>-<version>` followed by either `/` (path ref like
  // `fsrPlaybookBuilder-1.0.1/widgetAssets/...`) or a non-version boundary
  // (bare widget ID used as a string, e.g. `'fsrPlaybookBuilder-1.0.1'`).
  // Without the bare-ID arm, hardcoded version IDs survive a bump and trip
  // the stale-version-ref lint at install time.
  const versionPathRe = new RegExp(
    `\\b${escapeRegex(widgetName)}-\\d+(?:\\.\\d+)*(?:[-.][A-Za-z0-9.]+)?(/|(?![\\w.-]))`,
    "g"
  );
  const versionPathReplacement = (_m: string, tail: string): string => `${widgetName}-${version}${tail || ""}`;

  function rewrite(absPath: string, opts?: RewriteOpts): void {
    if (!fs.existsSync(absPath)) return;
    let contents = fs.readFileSync(absPath, "utf8");
    if (opts && opts.rewritePaths) {
      contents = contents.replace(versionPathRe, versionPathReplacement);
    }
    for (const w of variations) {
      const esc = escapeRegex(w);
      // `\d+(?:Dev)?Ctrl` catches both the reference-script source form
      // (`<name>100Ctrl`) and our already-synced form (`<name>102DevCtrl`),
      // so a bump rewrites either into the new `<newver>DevCtrl`.
      contents = contents
        .replace(new RegExp(`edit${esc}\\d+(?:Dev)?Ctrl`, "g"), `edit${w}${newver}Ctrl`)
        .replace(new RegExp(`(?<!edit)${esc}\\d+(?:Dev)?Ctrl`, "g"), `${w}${newver}Ctrl`)
        .replace(new RegExp(`\\bedit${esc}Ctrl\\b`, "g"), `edit${w}${newver}Ctrl`)
        .replace(new RegExp(`(?<!edit)\\b${esc}Ctrl\\b`, "g"), `${w}${newver}Ctrl`);
    }
    fs.writeFileSync(absPath, contents);
  }

  // `rewritePaths: true` everywhere — controllers can also carry versioned
  // refs (e.g. `'fsrPlaybookBuilder-1.0.1'` as a localStorage key fallback,
  // or `<script>`-loaded asset paths). Restricting path rewrites to HTML
  // files left bare-ID strings in controllers stale and tripped the
  // stale-version-ref lint after every bump.
  rewrite(path.join(dir, "edit.controller.js"), { rewritePaths: true });
  rewrite(path.join(dir, "view.controller.js"), { rewritePaths: true });
  rewrite(path.join(dir, "view.html"), { rewritePaths: true });
  rewrite(path.join(dir, "edit.html"), { rewritePaths: true });

  // A bump renames the controllers (<name><digits>DevCtrl) and rewrites
  // versioned IDs in widget/. The widget's own tests hardcode those same
  // names (e.g. `const CTRL_NAME = "jsonToGrid130DevCtrl"`) and versioned IDs,
  // so without sweeping them too every bump silently reds the unit/e2e suite
  // until someone fixes them by hand. Sweep the sibling tests/ tree with the
  // identical idempotent rewrite. (During packaging `dir` is a tmp copy with
  // no tests sibling — the walk simply finds nothing.)
  const testsDir = path.join(dir, "..", "tests");
  if (fs.existsSync(testsDir)) {
    const walk = (d: string): void => {
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(d, { withFileTypes: true }); }
      catch { return; }
      for (const e of entries) {
        if (e.name === "node_modules") continue;
        const abs = path.join(d, e.name);
        if (e.isDirectory()) walk(abs);
        else if (/\.(js|ts)$/.test(e.name)) rewrite(abs, { rewritePaths: true });
      }
    };
    walk(testsDir);
  }
}

// Convenience alias — same function is used by packageWidget (against a
// tmp copy) and by the bump endpoint (against the source dir).
const syncSourceToInfoJson = rewriteForVersion;

// A widget's `name` is its identity everywhere that matters: SOAR keys the
// installed widget by it, the controller registrations derive from it
// (`<name><ver>DevCtrl` / `edit<Name><ver>DevCtrl`), and the packaged asset
// paths are prefixed by it (`<name>-X.Y.Z/...`). It must be an identifier:
// starts with a letter, alphanumeric, no spaces and no version suffix.
function isValidWidgetName(name: unknown): boolean {
  return typeof name === "string" && /^[a-zA-Z][a-zA-Z0-9]*$/.test(name);
}

// Derive a camelCase identifier `name` from a human-facing title. Splits on any
// run of non-alphanumerics, lowercases the first token and TitleCases the rest,
// then joins: "FSR Playbook Composer" -> "fsrPlaybookComposer", "C2 Hunter" ->
// "c2Hunter". Throws if the result isn't a valid widget name (e.g. a title that
// starts with a digit, or is all punctuation).
function widgetNameFromTitle(title: unknown): string {
  const tokens = String(title || "").split(/[^A-Za-z0-9]+/).filter(Boolean);
  const name = tokens
    .map((t, i) => (i === 0 ? t.toLowerCase() : t.charAt(0).toUpperCase() + t.slice(1).toLowerCase()))
    .join("");
  if (!isValidWidgetName(name)) {
    throw new Error(`cannot derive a valid widget name from title ${JSON.stringify(title)} (got ${JSON.stringify(name)})`);
  }
  return name;
}

// Case-form variations of a widget name paired with their new counterparts.
// Deduped by the source form so we never emit two rules for the same token.
// `fsrPlaybookBuilder` yields the bare form plus `FsrPlaybookBuilder` (used by
// the `edit<Name>` controller); both map to the equivalent new-name form.
function nameVariationPairs(oldName: string, newName: string): Array<[string, string]> {
  const map = new Map<string, string>();
  for (const fn of [capitalize, decapitalize, (s: string) => s]) {
    const from = fn(oldName);
    if (!map.has(from)) map.set(from, fn(newName));
  }
  return [...map.entries()];
}

// One-shot base-name substitution across a widget's source files. Unlike
// rewriteForVersion (which is keyed off the CURRENT name and only updates the
// numeric version suffix), this swaps the widget identity old -> new wherever
// it appears: info.json `name`, controller registrations + `$inject` + function
// names, ng-controller refs, and versioned asset path prefixes. Each variation
// is a plain global replace — the two case forms are not substrings of one
// another, and a distinctive camelCase widget name is not a substring of the
// internal abbreviation prefixes (e.g. `fsrPb*`), so those are left untouched.
// Returns the list of files actually changed (for reporting/tests).
function rewriteNameInDir(dir: string, oldName: string, newName: string): string[] {
  const pairs = nameVariationPairs(oldName, newName);
  const changed: string[] = [];
  (function walk(cur: string): void {
    for (const e of fs.readdirSync(cur, { withFileTypes: true })) {
      if (e.name === ".DS_Store" || e.name.startsWith("._") || e.name === "node_modules") continue;
      const p = path.join(cur, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!/\.(js|html|json)$/.test(e.name)) continue;
      const before = fs.readFileSync(p, "utf8");
      let after = before;
      for (const [from, to] of pairs) {
        after = after.split(from).join(to);
      }
      if (after !== before) {
        fs.writeFileSync(p, after);
        changed.push(p);
      }
    }
  })(dir);
  return changed;
}

// Replace every literal occurrence of `from` with `to` across a widget's source
// files. Used to swap the human-readable title string (e.g. an aria-label or a
// comment) that the camelCase name substitution in rewriteNameInDir cannot
// reach. No-op when `from` is empty/identical so callers can pass it
// unconditionally. Returns the files actually changed.
function replaceTextInDir(dir: string, from: string, to: string): string[] {
  const changed: string[] = [];
  if (!from || from === to) return changed;
  (function walk(cur: string): void {
    for (const e of fs.readdirSync(cur, { withFileTypes: true })) {
      if (e.name === ".DS_Store" || e.name.startsWith("._") || e.name === "node_modules") continue;
      const p = path.join(cur, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!/\.(js|html|json)$/.test(e.name)) continue;
      const before = fs.readFileSync(p, "utf8");
      const after = before.split(from).join(to);
      if (after !== before) { fs.writeFileSync(p, after); changed.push(p); }
    }
  })(dir);
  return changed;
}

interface RenameWidgetOpts {
  title?: string;
  subtitle?: string;
  description?: string;
  releaseNotes?: string;
}

interface RenameWidgetResult {
  oldName: string;
  newName: string;
  oldFolder: string;
  newFolder: string;
  changedFiles: string[];
}

// Rename a widget on disk: rewrite the identity name across its source files,
// update the display/identity fields in info.json, replace the old human title
// string wherever it appears, then move the folder so the directory name
// matches the new identity. `srcRoot` is the widgets-src dir; the widget lives
// at `<srcRoot>/<oldName>/widget`. Optional `opts`: `title`, `subtitle`,
// `description` (→ metadata.description), `releaseNotes` — each applied only
// when provided. Throws (without moving) if the new name is invalid, unchanged,
// or its target folder already exists, so a failed rename never leaves a
// half-moved tree. Returns a report; `changedFiles` paths point at the moved
// (new) folder.
function renameWidget(srcRoot: string, oldName: string, newName: string, opts: RenameWidgetOpts = {}): RenameWidgetResult {
  if (!isValidWidgetName(newName)) {
    throw new Error(`invalid widget name: ${JSON.stringify(newName)} (must be a letter-led identifier, no spaces/version)`);
  }
  if (newName === oldName) throw new Error("new name is identical to the current name");
  const oldFolder = path.join(srcRoot, oldName);
  const newFolder = path.join(srcRoot, newName);
  const widgetDir = path.join(oldFolder, "widget");
  const infoPath = path.join(widgetDir, "info.json");
  if (!fs.existsSync(infoPath)) {
    throw new Error(`widget not found: ${infoPath} missing`);
  }
  if (fs.existsSync(newFolder)) throw new Error(`target folder already exists: ${newFolder}`);

  // Snapshot the old human title before any rewrite so we can swap the display
  // string (aria-labels, comments) that the camelCase substitution can't see.
  const oldTitle = JSON.parse(fs.readFileSync(infoPath, "utf8")).title;

  const changed = new Set(rewriteNameInDir(widgetDir, oldName, newName));

  if (opts.title) {
    for (const f of replaceTextInDir(widgetDir, oldTitle, opts.title)) changed.add(f);
  }

  // Apply info.json display/identity fields. `name` is handled by the name
  // substitution above; everything here is free-text that callers opt into.
  const raw = fs.readFileSync(infoPath, "utf8");
  const info: InfoJson = JSON.parse(raw);
  if (opts.title != null) info.title = opts.title;
  if (opts.subtitle != null) info.subTitle = opts.subtitle;
  if (opts.releaseNotes != null) info.releaseNotes = opts.releaseNotes;
  if (opts.description != null) {
    info.metadata = info.metadata || {};
    info.metadata.description = opts.description;
  }
  const trailingNewline = /\n$/.test(raw) ? "\n" : "";
  fs.writeFileSync(infoPath, JSON.stringify(info, null, 2) + trailingNewline);
  changed.add(infoPath);

  fs.renameSync(oldFolder, newFolder);

  // Re-point changed paths at the moved folder so the report is accurate.
  const newWidgetDir = path.join(newFolder, "widget");
  const changedFiles = [...changed].map((p) =>
    p.startsWith(widgetDir) ? newWidgetDir + p.slice(widgetDir.length) : p
  );
  return { oldName, newName, oldFolder, newFolder, changedFiles };
}

function uniq<T>(arr: T[]): T[] {
  const seen = new Set<T>();
  return arr.filter((v) => (seen.has(v) ? false : (seen.add(v), true)));
}

function shouldSkipName(name: string): boolean {
  return (
    name === ".DS_Store" ||
    name === "__MACOSX" ||
    name.startsWith("._") ||
    name.startsWith(".") ||
    name.startsWith("_") ||
    // Dev-only artifacts that must NOT ship to SOAR: remote probes run by
    // `widget verify-remote`, and any *.test.js / *.spec.js that snuck into
    // the widget source. SOAR loads every .js under widgetAssets/ at install
    // time, so shipping a probe would crash the host on load.
    name === "remote.probe.js" ||
    /\.(test|spec)\.js$/.test(name)
  );
}

function copyCleanRecursive(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (shouldSkipName(entry.name)) continue;
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyCleanRecursive(s, d);
    } else if (entry.isFile()) {
      fs.copyFileSync(s, d);
    }
  }
}

function listPackagedFiles(dir: string): string[] {
  const out: string[] = [];
  (function walk(cur: string): void {
    for (const e of fs.readdirSync(cur, { withFileTypes: true })) {
      if (shouldSkipName(e.name)) continue;
      const p = path.join(cur, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) out.push(p);
    }
  })(dir);
  return out;
}

function validateStructure(dir: string): void {
  const missing = REQUIRED_FILES.filter((f) => !fs.existsSync(path.join(dir, f)));
  if (missing.length > 0) {
    throw new Error(`missing required file(s): ${missing.join(", ")}`);
  }
}

interface ValidationReport {
  errors: string[];
  warnings: string[];
}

// Hard-required info.json metadata. windowClass and size are load-bearing for
// $uibModal — without them the edit modal launches with no CSS class/size and
// renders invisibly in real SOAR (the harness wraps the controller itself, so
// dev preview hides the bug). standalone + pages are required by SOAR's widget
// registry.
function validateInfoMetadata(info: unknown): ValidationReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!info || typeof info !== "object") {
    errors.push("info.json: not an object");
    return { errors, warnings };
  }
  const obj = info as Record<string, unknown>;
  if (!obj.name) errors.push("info.json: missing 'name'");
  if (!obj.version) {
    errors.push("info.json: missing 'version'");
  } else if (!isValidVersion(obj.version)) {
    errors.push(`info.json: invalid version '${obj.version}'`);
  }

  const meta = obj.metadata;
  if (!meta || typeof meta !== "object") {
    errors.push("info.json: missing 'metadata' block");
    return { errors, warnings };
  }
  const metaObj = meta as Record<string, unknown>;
  // These are common on widgets that launch large config modals (action
  // renderer, jinja editor) but Fortinet's stock widgets ship without them
  // and still work. Surface as warnings so the user knows to consider them
  // for big modals, but don't block install.
  for (const k of ["windowClass", "size"]) {
    const val = metaObj[k];
    if (typeof val !== "string" || !(val as string).trim()) {
      warnings.push(
        `info.json: metadata.${k} not set — fine for most widgets; set "Full Width" + "lg" if your edit modal looks cramped or invisible`
      );
    }
  }
  if (typeof metaObj.standalone !== "boolean") {
    warnings.push("info.json: metadata.standalone not set (boolean) — defaults vary by SOAR version");
  }
  const hasPages = Array.isArray(metaObj.pages) && (metaObj.pages as unknown[]).length > 0;
  const hasContexts = Array.isArray(metaObj.contexts) && (metaObj.contexts as unknown[]).length > 0;
  const metaView = metaObj.view && typeof metaObj.view === "object" ? metaObj.view as Record<string, unknown> : null;
  const hasEnableFor = metaView && Array.isArray(metaView.enableFor) && (metaView.enableFor as unknown[]).length > 0;
  if (!hasPages && !hasContexts && !hasEnableFor) {
    errors.push("info.json: metadata.pages must be a non-empty array (or set metadata.contexts / metadata.view.enableFor) — SOAR needs at least one placement hint");
  }

  if (!Array.isArray(metaObj.compatibility) || (metaObj.compatibility as unknown[]).length === 0) {
    warnings.push("info.json: metadata.compatibility empty — widget may not surface on any SOAR version");
  }
  if (!metaObj.category) warnings.push("info.json: metadata.category missing");
  if (metaObj.publisher == null || metaObj.publisher === "") {
    warnings.push("info.json: metadata.publisher missing");
  }
  return { errors, warnings };
}

interface ControllerMatch {
  name: string;
  digits: string;
}

// Validates that .controller(...) registrations match the name+version derived
// from info.json. Catches the "version drift" case where someone bumps
// info.json but forgets to re-run the rewrite, leaving SOAR unable to find
// the controller it expects (`<name><digits>(Dev)?Ctrl`).
function validateControllers(dir: string, info: unknown): ValidationReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!info || typeof info !== "object") {
    return { errors, warnings };
  }
  const obj = info as Record<string, unknown>;
  if (!obj.name || !obj.version || !isValidVersion(obj.version)) {
    return { errors, warnings };
  }
  const expectedDigits = versionToNumeric(obj.version);
  const variants = uniq([obj.name as string, capitalize(obj.name as string), decapitalize(obj.name as string)]);
  const variantAlt = variants.map(escapeRegex).join("|");
  const editPat = new RegExp(`^edit(?:${variantAlt})(\\d+)(Dev)?Ctrl$`);
  const viewPat = new RegExp(`^(?:${variantAlt})(\\d+)(Dev)?Ctrl$`);

  function controllersIn(file: string): string[] | null {
    const p = path.join(dir, file);
    if (!fs.existsSync(p)) return null;
    const content = fs.readFileSync(p, "utf8");
    const out: string[] = [];
    const re = /\.controller\(\s*['"]([^'"]+)['"]/g;
    let m;
    while ((m = re.exec(content)) !== null) out.push(m[1]);
    return out;
  }

  function check(file: string, pat: RegExp, expectedShape: string): void {
    const names = controllersIn(file);
    if (names === null) return;
    if (names.length === 0) {
      errors.push(`${file}: no .controller(...) registration found`);
      return;
    }
    const matched: ControllerMatch[] = [];
    const stray: string[] = [];
    for (const n of names) {
      const m = n.match(pat);
      if (m) matched.push({ name: n, digits: m[1] });
      else stray.push(n);
    }
    if (matched.length === 0) {
      errors.push(
        `${file}: no controller matches expected shape '${expectedShape}' (found: ${names.join(", ")})`
      );
      return;
    }
    for (const { name, digits } of matched) {
      if (digits !== expectedDigits) {
        errors.push(
          `${file}: controller '${name}' has version digits '${digits}' but info.json version '${obj.version}' -> '${expectedDigits}' (re-package to sync, or bump via /_fsr/package)`
        );
      }
    }
    for (const n of stray) {
      warnings.push(`${file}: stray controller registration '${n}' won't be auto-rewritten`);
    }
  }

  check("edit.controller.js", editPat, `edit${capitalize(obj.name as string)}${expectedDigits}(Dev)?Ctrl`);
  check("view.controller.js", viewPat, `${capitalize(obj.name as string)}${expectedDigits}(Dev)?Ctrl`);
  return { errors, warnings };
}

// Suggests a minimal JSON merge patch (RFC 7396 shape) that, when deep-merged
// into the widget's info.json, would clear every error from validateInfoMetadata.
// Conservative defaults — caller is expected to surface them in the harness UI
// so the user knows what's about to be written. Returns null when no fixable
// errors are present (warnings are intentionally left alone — they're judgment
// calls, not silent rewrites).
function suggestInfoFix(info: unknown): Record<string, unknown> | null {
  const safe = info && typeof info === "object" ? (info as Record<string, unknown>) : ({} as Record<string, unknown>);
  const meta = safe.metadata && typeof safe.metadata === "object" ? (safe.metadata as Record<string, unknown>) : ({} as Record<string, unknown>);
  const patch: Record<string, unknown> = {};
  const metaPatch: Record<string, unknown> = {};
  const hasContexts = Array.isArray(meta.contexts) && (meta.contexts as unknown[]).length > 0;
  const metaView = meta.view && typeof meta.view === "object" ? (meta.view as Record<string, unknown>) : null;
  const hasEnableFor = metaView && Array.isArray(metaView.enableFor) && (metaView.enableFor as unknown[]).length > 0;
  if ((!Array.isArray(meta.pages) || (meta.pages as unknown[]).length === 0) && !hasContexts && !hasEnableFor) {
    metaPatch.pages = ["Dashboard", "View Panel"];
  }
  if (Object.keys(metaPatch).length === 0) return null;
  patch.metadata = metaPatch;
  return patch;
}

// Deep-merges a JSON merge patch into the existing info.json on disk and
// rewrites the file. Preserves the trailing newline if present. Returns the
// updated info object.
function applyInfoFix(infoPath: string, patch: Record<string, unknown>): InfoJson {
  const raw = fs.readFileSync(infoPath, "utf8");
  const info: InfoJson = JSON.parse(raw);
  function merge(dst: Record<string, unknown>, src: Record<string, unknown>): void {
    for (const k of Object.keys(src)) {
      const v = src[k];
      if (v && typeof v === "object" && !Array.isArray(v) && dst[k] && typeof dst[k] === "object" && !Array.isArray(dst[k])) {
        merge(dst[k] as Record<string, unknown>, v as Record<string, unknown>);
      } else {
        dst[k] = v;
      }
    }
  }
  merge(info, patch);
  const trailingNewline = /\n$/.test(raw) ? "\n" : "";
  fs.writeFileSync(infoPath, JSON.stringify(info, null, 2) + trailingNewline);
  return info;
}

// Combines info-shape + controller-shape validation. Used by packageWidget
// (defense-in-depth against the tmp tree) and by the route handlers as a
// preflight against the source tree (after any version-bump sync).
function validateWidget(dir: string, info: unknown): ValidationReport {
  const a = validateInfoMetadata(info);
  const b = validateControllers(dir, info);
  return {
    errors: [...a.errors, ...b.errors],
    warnings: [...a.warnings, ...b.warnings],
  };
}

function runTar(cwd: string, archivePath: string, relFiles: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      "--owner=0",
      "--group=0",
      "--numeric-owner",
      "--exclude=.*",
      "--exclude=_*",
      "--exclude=*/.*",
      "--exclude=*/_*",
      "-czf",
      archivePath,
      ...relFiles,
    ];
    const child = spawn("tar", args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        COPYFILE_DISABLE: "1",
        COPY_EXTENDED_ATTRIBUTES_DISABLE: "1",
      },
    });
    let stderr = "";
    child.stderr.on("data", (c: Buffer) => (stderr += c.toString()));
    child.on("error", reject);
    child.on("close", (code: number) => {
      if (code === 0) resolve();
      else reject(new Error(`tar exited ${code}: ${stderr.trim()}`));
    });
  });
}

interface PackageWidgetResult {
  archivePath: string;
  archiveName: string;
  widgetName: string;
  version: string;
  size: number;
  fileCount: number;
  warnings: string[];
}

async function packageWidget(widgetDir: string, outputDir: string): Promise<PackageWidgetResult> {
  const infoPath = path.join(widgetDir, "info.json");
  if (!fs.existsSync(infoPath)) throw new Error("info.json not found");
  const info: InfoJson = JSON.parse(fs.readFileSync(infoPath, "utf8"));
  if (!info.name) throw new Error("info.json missing 'name'");
  if (!info.version) throw new Error("info.json missing 'version'");

  const widgetName = info.name;
  const version = info.version;
  const packageRoot = `${widgetName}-${version}`;
  const archiveName = `${packageRoot}.tgz`;

  const tmpParent = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-pkg-"));
  const tmpDir = path.join(tmpParent, packageRoot);

  try {
    copyCleanRecursive(widgetDir, tmpDir);
    rewriteForVersion(tmpDir, widgetName, version);
    validateStructure(tmpDir);

    const report = validateWidget(tmpDir, info);
    if (report.errors.length > 0) {
      const err = new Error(
        `widget validation failed:\n  - ${report.errors.join("\n  - ")}`
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- attach validation result for caller
      (err as any).validation = report;
      throw err;
    }

    const absOutputDir = path.resolve(outputDir);
    fs.mkdirSync(absOutputDir, { recursive: true });
    const archivePath = path.join(absOutputDir, archiveName);

    const absFiles = listPackagedFiles(tmpDir);
    if (absFiles.length === 0) throw new Error("no valid files to package");
    const relFiles = absFiles.map((p) => path.relative(tmpParent, p));

    await runTar(tmpParent, archivePath, relFiles);

    const size = fs.statSync(archivePath).size;
    return {
      archivePath,
      archiveName,
      widgetName,
      version,
      size,
      fileCount: absFiles.length,
      warnings: report.warnings,
    };
  } finally {
    fs.rmSync(tmpParent, { recursive: true, force: true });
  }
}

export = {
  packageWidget,
  versionToNumeric,
  bumpVersion,
  isValidVersion,
  writeInfoVersion,
  rewriteForVersion,
  syncSourceToInfoJson,
  isValidWidgetName,
  widgetNameFromTitle,
  nameVariationPairs,
  rewriteNameInDir,
  replaceTextInDir,
  renameWidget,
  validateInfoMetadata,
  validateControllers,
  validateWidget,
  suggestInfoFix,
  applyInfoFix,
};
