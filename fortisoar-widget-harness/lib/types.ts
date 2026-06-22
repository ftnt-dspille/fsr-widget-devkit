"use strict";
/**
 * Shared domain types for the harness (typing Phase 0).
 *
 * Pure type declarations — no runtime code. Node-only importers (server.ts,
 * packager.ts, scripts/*, the introspection rig) pull these in so the same
 * shapes aren't re-declared per file. NOT imported by the browser-loaded files
 * (harness.module.ts, lib/harnessDrawer.ts), which must stay non-module scripts.
 *
 * As each file's typing phase lands it should replace its local `any`/duplicate
 * interface with an import from here. See docs/TYPING_ELIMINATE_ANY_PLAN.md.
 */

// ---------------------------------------------------------------------------
// Widget shapes
// ---------------------------------------------------------------------------

/** A widget's info.json. Open-ended (index signature) because SOAR widgets
 *  carry many optional metadata keys; the named fields are the ones the harness
 *  actually reads. */
export interface InfoJson {
  [key: string]: unknown;
  name?: string;
  version?: string;
  title?: string;
  subTitle?: string;
  metadata?: WidgetMetadata;
}

export interface WidgetMetadata {
  [key: string]: unknown;
  /** Host pages the widget declares it renders on, e.g. "Dashboard", "View Panel". */
  pages?: string[];
}

/** A versioned reference (e.g. `widgets/installed/<name>-<ver>/`) found in a
 *  widget source file that points at a version other than the current one. */
export interface StaleVersionRef {
  file: string;
  staleVersions: string[];
}

/** Internal, fully-resolved widget record built by the server from a
 *  widgets-src/<folder>/widget directory. (Canonical home for server.ts's
 *  local WidgetRecord — server Phase 2 imports this.) */
export interface WidgetRecord {
  folder: string;
  dir: string;
  id: string;
  name: string;
  version: string;
  title: string;
  subTitle: string;
  pages: string[];
  viewControllers: string[];
  editControllers: string[];
  assetScripts: string[];
  staleVersionRefs: StaleVersionRef[];
  caps: WidgetCapabilities;
  lint?: LintResult;
}

/** Per-widget heavy-editor capability flags, derived by statically scanning the
 *  widget's templates/controllers. The harness uses these to lazy-load the
 *  ~4 MB Monaco bundle and the rich-text editor CDN scripts ONLY for widgets
 *  that actually reference them — most widgets need neither, so the boot chain
 *  skips both the payload and the ~150 ms serial preload latency. (Real SOAR
 *  eager-loads Monaco during app bootstrap; this is a harness-only render
 *  optimization that stays faithful for editor widgets, which still preload.) */
export interface WidgetCapabilities {
  /** References Monaco / a code editor (cs-code-editor, window.monaco). */
  monaco: boolean;
  /** References rich-text/markdown editors backed by tinymce + toastui
   *  (cs-conditional value cells, cs-html-editor, cs-markdown-editor). */
  editors: boolean;
}

// Re-export the lint types so there's one import site for consumers.
// (Defined canonically in lib/harnessUtils.ts; mirrored here to avoid a
//  browser/node dual-export tangle when importing from that file.)
export interface LintIssue {
  rule: string;
  severity: "error" | "warning";
  message: string;
  masked?: boolean;
  suggestedScriptTags?: string[];
  unknown?: string[];
  expected?: string;
  registered?: string[];
}

export interface LintResult {
  errors: LintIssue[];
  warnings: LintIssue[];
}

// ---------------------------------------------------------------------------
// SSE channel (server -> dev page debug drawer)
// ---------------------------------------------------------------------------

export type SseEvent =
  | { type: "hello"; verbose: boolean }
  | { type: "harness-reload"; services: string[] }
  | { type: "proxy"; entry: ProxyLogEntry }
  | { type: "proxy-clear" }
  | { type: "verbose"; verbose: boolean }
  | { type: "widget-change"; id: string; oldId: string; file: string; lint?: LintResult };

/** One proxied request/response captured for the Network tab of the drawer. */
export interface ProxyLogEntry {
  ts: number;
  method: string;
  url: string;
  status: number;
  ms: number;
  resBodyLength?: number;
  error?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Introspection rig (scripts/introspect.ts) — render report
// ---------------------------------------------------------------------------

/** One network resource the browser fetched during a render. */
export interface ResourceEntry {
  name: string;
  /** transferSize in bytes (0 if served from cache / opaque). */
  size: number;
  /** ms from navigation start to when the resource started. */
  start: number;
  /** ms the resource took to load. */
  dur: number;
  type: "script" | "css" | "font" | "image" | "fetch" | "other";
}

/** Ordered boot milestones, ms from navigation start. Populated from
 *  performance marks injected into index.html's loadScript chain. */
export interface BootTimeline {
  domContentLoaded: number;
  appUnmin?: number;
  templates?: number;
  harnessModule?: number;
  widgetServices?: number;
  controller?: number;
  firstPaint?: number;
  mountComplete?: number;
}

/** Angular-runtime observations for one render. */
export interface RuntimeStats {
  digestCount: number;
  slowestDigestMs: number;
  /** harness.module stub name -> times its factory/decorator was invoked. */
  stubHits: Record<string, number>;
  templateCacheHits: number;
  templateCacheMisses: number;
  unresolvedProviders: string[];
}

/** Correctness signals pulled from window.__harness.dump(). */
export interface RenderCorrectness {
  errorCount: number;
  warningCount: number;
  consoleErrors: string[];
  sceFallbacks: number;
}

/** The full structured report for one widget render — the unit the rig emits,
 *  diffs against a baseline, and (in fidelity mode) compares harness vs real SOAR. */
export interface RenderReport {
  widgetId: string;
  /** "harness" | "soar" — which environment produced this report. */
  source: "harness" | "soar";
  /** Server-derived editor capability flags for this widget. The rig uses
   *  these to decide whether eager editor bytes are expected (the widget uses
   *  the editor) or a leak (a non-editor widget still pulled the bundle). */
  caps?: WidgetCapabilities;
  wallMs: number;
  totalBytes: number;
  resourceCount: number;
  resources: ResourceEntry[];
  boot: BootTimeline;
  runtime?: RuntimeStats;
  correctness: RenderCorrectness;
  mounted: boolean;
  /** Distinguishes a true mount from the harness's "configure to preview"
   *  gate (many widgets only mount once a config/record is supplied) from a
   *  genuine no-render. "config-prompt" is NOT a widget failure. */
  mountState?: "mounted" | "config-prompt" | "no-mount";
}

/** Result of comparing a harness RenderReport against the real-SOAR baseline. */
export interface FidelityDiff {
  widgetId: string;
  domMismatch: boolean;
  styleMismatches: string[];
  /** services that resolved to a real impl in SOAR but a stub in the harness. */
  stubbedInHarness: string[];
  notes: string[];
}
