# Harness widget-rendering: introspection-first optimization plan

**Status:** in progress — Phase 1 rig DONE incl. stub-hit counters; **backlog #1 (lazy Monaco/editors), #2 (font dedup), #3 (editor.main.css) all shipped 2026-06-22**; Phases 2 (real-SOAR fidelity baseline), 5 (Makefile `make introspect` + regression gate) pending
**Created:** 2026-06-22
**Goal:** Find and fix where the harness renders widgets suboptimally, driven by *live introspection* of the running harness — not assumptions that the current behavior is optimal.

---

## Evidence — initial live probe (one render, default page, :4401)

A headless Playwright pass against the running harness surfaced concrete waste:

- **~10.9 MB transferred / 25 scripts / 51 resources** to render a single widget.
- **Three eager megabundles dominate** and load unconditionally:
  - `node_modules/monaco-editor/.../editor.main.js` — **3.57 MB**
  - `/_fsr/templates.min.js` — **2.65 MB**
  - `/_fsr/app.unmin.js` — **2.32 MB**
  - Monaco + TinyMCE (CDN, 155 KB) load even for widgets with no code/rich-text editor.
- **Fonts loaded twice from two roots:** `/node_modules/lato-font/...` **and** `/fonts/Lato/...` — identical bytes (lato-bold 185 KB ×2, etc.). Six Lato weights eagerly fetched (~1 MB).
- **`networkidle` never fires** — the harness holds an SSE channel open for the debug drawer, so any introspection/automation waiting on network idle will hang (probe hit its 30 s ceiling). Use a mount sentinel instead.
- **`hasNgScope: false` on default load** — no widget auto-mounted without an explicit selection; must confirm whether that's expected or a fidelity gap.

Low-risk wins implied: conditional/lazy bundle loading + font dedup could cut payload 60–80% for non-editor widgets.

> Caveats: single run, default page, no widget mounted. Phase 1 must drive an explicit widget + record to measure a true render.

---

## Findings — Phase 1 rig run across all 14 widgets (2026-06-22, validated)

The rig (`scripts/introspect.ts`) ran against every discovered widget. Numbers are consistent across all of them (the cost is platform-wide, not per-widget):

| Signal | Value | Verdict |
|---|---|---|
| Total transfer / render | **~10.5–11.1 MB** | heavy; dominated by platform bundles |
| Monaco editor | **3.95 MB across 5 files**, eager | loaded for **every** widget incl. non-editor ones |
| TinyMCE (CDN) | **155 KB**, eager | same — unconditional |
| `templates.min.js` | 2.65 MB | candidate to slice |
| `app.unmin.js` | 2.32 MB | the platform bundle (largely unavoidable) |
| `editor.main.css` | **loaded ×2 from 2 paths** (124 KB each) | duplicate |
| Lato fonts | **4–6 weights, 0.74–1.08 MB**, some duplicated across `/node_modules/lato-font` and `/fonts/Lato` | over-eager + duplicate roots |
| Console errors / render | **1** (`module is not defined`) | benign but dirties the drawer error tab every load |

**Validated correction:** the first run reported "DID NOT MOUNT" for all 14 — that was the **rig supplying no config**, not broken widgets. `#widget-host` renders the harness's *"configure to preview"* gate; `angular` + `HarnessUtils` load fine. The rig now distinguishes `mounted` / `config-prompt` / `no-mount` (a `config-prompt` is **not** a failure). Measuring a *true mounted* render requires the rig to inject per-widget config/record — the next rig sub-phase.

### Ranked optimization backlog (Phase 3 triage)
1. ✅ **Lazy-load Monaco + TinyMCE per widget capability** — **DONE (2026-06-22)**. Server `scanCapabilities()` statically scans each widget's `.html`/`.js` for editor markers → `caps:{monaco,editors}` on `/_fsr/widgets`. Boot chain gates `preloadMonaco()` on `caps.monaco` and lazy-loads the rich-text CDN stack (`loadRichTextEditors()` — toastui+dompurify+tinymce, formerly static `<head>` tags) on `caps.editors` (awaited, to preserve the pre-bootstrap-ready guarantee). `injectFsrStylesheets()` also drops Monaco's `editor.main.css` for non-Monaco widgets — the only byte that leaked past the JS gate. **Measured:** non-editor widgets (helloCounter, counter, myWidget, byoAppFrame, fortiai, fortisocChat) **14 MB → ~9.9 MB** mounted, **0 Monaco/editor resources**, and the ~150 ms serial `preloadMonaco` boot gap is gone (harnessModule→svc now contiguous). Editor widgets (jinja, actionRenderer, fsrSocAssistant, c3Charts, dataVisualization) **unchanged & faithful** — still load Monaco/editors and mount. No new no-mounts (the 3 pre-existing no-mounts — fsoc/funnel/jsonToGrid — fail identically on HEAD). Rig now caps-aware: flags eager editor bytes as **expected** (widget declares the cap) vs **LEAK** (it doesn't) — a built-in regression gate for this optimization. 164 jest green.
2. ✅ **Dedup the double Lato font roots** — **DONE (2026-06-22)**. Root cause: SOAR's `steel.css` ships TWO parallel Lato `@font-face` roots — `/fonts/Lato/Lato-*.woff2` (SOAR-hosted) AND `/node_modules/lato-font/fonts/lato-*/*.woff2` (npm package) — so a render whose text uses a weight declared in both downloads the same glyphs twice. All six npm weights are **byte-IDENTICAL** to their `/fonts/Lato` counterparts (verified by md5), so `server.ts` (a) 302-redirects the npm Lato URLs onto the SOAR-hosted ones (collapses two URLs → one) and (b) rewrites proxied **font** responses from SOAR's `no-store` to `Cache-Control: public, max-age=300` (fonts are immutable) so the unified URL is reused instead of re-fetched. **Measured:** the duplicate weight is now a ~300 B cache-hit instead of a 183 KB re-download — every widget shows ≥1 font cache-hit. Zero glyph/fidelity change (identical bytes). The **"trim eager weights" sub-item was a non-issue** — browsers fetch `@font-face` lazily, so only *used* weights download (helloCounter pulls 3 of 12 declared, not all). **This is the one place the harness intentionally diverges from SOAR's exact wire (same bytes, fewer requests) — a Phase 2 fidelity diff must allowlist the redirected/cached font URLs.**
3. ✅ **Dedup `editor.main.css` double-load** — folded into #1 (Monaco CSS now gated by `caps.monaco`).
4. **Fix the benign `module is not defined`** browser dual-export throw (guard `typeof module`) — cleans the per-render error signal so the rig's correctness metric isn't permanently dirty.
5. **Evaluate slicing `templates.min.js`** — larger effort, needs care.

### Rig follow-ups before optimizing
- ✅ **Inject per-widget config so true mounted renders are measured.** Done — the rig seeds `localStorage["harness:config:<id>"]` (the config-gate is just `savedConfig == null`), so widgets now actually mount. True mounted render = **~14 MB / ~120 resources** (vs ~10.5 MB / 49 at the gate); `dataVisualization` throws **2 console errors when mounted** — a real finding the gate was hiding. Rig reports `mounted` / `config-prompt` / `no-mount`.
- ✅ **Boot-timeline marks** in `index.html` `loadScript` chain (`performance.mark("harness:<milestone>")`, read into `BootTimeline`). New finding: `preloadMonaco()` adds **~150–160ms of serial boot latency on every widget** (gap from `harnessModule` → `widgetServices`) — so eager Monaco costs both ~4 MB payload **and** ~150ms boot. Strengthens the lazy-load case (backlog #1).
- ✅ **Instrument `harness.module` factories with hit-counters (fills `RuntimeStats.stubHits`).** Done (2026-06-22). `harness.module.ts` wraps stub registrations in `regFactory`/`regService` helpers that push to `window.__HARNESS_STUB_NAMES` and increment `window.__HARNESS_STUB_HITS[name]` on injector instantiation; the rig reads both and populates `RenderReport.runtime.stubHits` + a finding (`stubs: N exercised (dead: …)`). Browser-safe emit preserved (0 CommonJS markers). E.g. helloCounter exercises 6 stubs, jinja 10; `$stomp`/`websocketService`/`tokenService` are dead for simple widgets. Other `RuntimeStats` fields (digestCount etc.) default to 0 with a comment rather than guessed.

## Plan

The spine is a **repeatable introspection rig** that measures the live render, compares it to real SOAR for fidelity, and gates regressions. No change ships on assumption — each is justified by a captured delta.

### Phase 1 — Build the introspection rig (the instrument) ✅ DONE (resource/correctness/mount; boot+stub instrumentation pending)
A typed Playwright tool (`scripts/introspect.ts`) that boots a given widget and emits a structured **render report**:
- **Resource profile:** every script/font/css with size, start, duration; flag eager-vs-used, duplicates, CDN deps.
- **Boot timeline:** mark each `loadScript` step (DCL, app.unmin, templates, harness.module, widget services, controller, first paint, mount-complete) via `performance.mark`/`measure` injected into `index.html`.
- **Angular runtime:** digest count + slowest `$digest`, injector resolutions, **which harness stubs actually fire** (hit-counter on `harness.module` factories), template-cache hits/misses.
- **Correctness signals:** console errors/warnings, `$sce`/binding fallbacks, unresolved providers — from existing `window.__harness.dump()`.
- Runs headless over **all discovered widgets**, emits JSON + diff vs saved baseline. Must **not** wait on `networkidle` (use a mount sentinel).

### Phase 2 — Real-SOAR fidelity baseline (don't assume the harness is "right") ⬜ PENDING
Use `lib/soarBrowser.ts` to render the same widgets in the **real** FortiSOAR box and capture the same report. SOAR is ground truth; the harness's job is to match its render. Output a **fidelity diff**: DOM, applied styles, services resolved real-vs-stubbed, digest behavior. Tells us which stubs are faithful and which paper over real behavior.

### Phase 3 — Triage findings into a backlog 🟡 PARTIAL (backlog produced from Phase 1 run; see Findings above)
Score each finding by **impact × confidence × fidelity-risk**. Already on the board:
- (a) lazy-load Monaco / TinyMCE per widget capability
- (b) dedup the double Lato font roots
- (c) trim eagerly-loaded font weights
- (d) evaluate whether `templates.min.js` can be sliced
Each entry carries its measured before-number.

### Phase 4 — Optimize behind the rig, one lever at a time ⬜ PENDING
Apply each change, re-run Phase 1 + Phase 2 diff. Accept only if payload/boot improves **and** fidelity doesn't regress. Conditional bundles = headline (likely the 60–80% cut); fonts = quick win.

### Phase 5 — Lock it in ✅ DONE (2026-06-22)
- ✅ **Committed baseline reports** in `tests/introspect/baseline/*.json` (14 widgets, all mounted except 3 known no-mounts).
- ✅ **`make introspect` + `make introspect-gate` wired through parent Makefile** per testing discipline:
  - `make introspect` boots dedicated port (14403), runs rig, tears down server (hermetic, FSR_HERMETIC=1 by default)
  - `make introspect-gate` runs gate after introspect (or standalone) and fails if regressions detected
  - See parent Makefile lines ~109-124 for implementation
- ✅ **Regression gate thresholds (per-widget budgets):**
  - Payload: +10% (e.g., 10 MB → 11 MB allowed)
  - Boot (DCL): +15% (e.g., 500 ms → 575 ms allowed)
  - Console errors: must not increase (baseline becomes the cap)
  - Editor-byte leaks: widget without monaco/editors cap must not pull editor bytes
  - Known no-mounts (fsocFieldsOfInterest, funnelChart, jsonToGrid, fortiaiInsight-flaky) treated as baseline-documented, gate doesn't fail them
- ✅ **Rig fully typed:** 1 justified `// eslint-disable-next-line @typescript-eslint/no-explicit-any` remains on line 166-167 (page.evaluate() returns unknown, cast to any required by Playwright API)
  - `scripts/introspect.ts` + `lib/types.ts` both pass `pnpm typecheck`, `pnpm lint:eslint:ts`
  - No new `any` types introduced; introspection structs use RenderReport/ResourceEntry/BootTimeline/RuntimeStats/WidgetCapabilities from lib/types.ts
- ⬜ **Phase 2 live-fidelity remains pending** — the hermetic gate in Phase 5 is complete, but Phase 2's soarBrowser.ts fidelity diff is out-of-scope for this phase. A TODO marks the seam in the plan (Phase 2 "not yet wired") and in the rig code (introspect.ts line ~18 comment).

**Baseline location:** `/Users/dylanspille/WebstormProjects/fsr_all_widgets/fortisoar-widget-harness/tests/introspect/baseline/`  
**Gate location:** `/Users/dylanspille/WebstormProjects/fsr_all_widgets/fortisoar-widget-harness/scripts/introspect-gate.js`  
**Thresholds:** payload +10%, boot +15%, console-error-count cap, editor-byte leak detection (see introspect-gate.js checks).

---

## Decisions (resolved 2026-06-22)
1. **First cut scope:** ✅ **Build the Phase 1 rig + triage and report findings first** — measure before optimizing (consistent with the introspect-first principle). No optimization ships until its before-number is captured.
2. **Fidelity baseline (Phase 2):** ✅ **Include the real-SOAR comparison** — drive the live box via `lib/soarBrowser.ts`. (Live sweep tier only.)

**Run order (as executed):** introspection led; typing ran in parallel on disjoint files. `harness.module.ts` is serialized to avoid concurrent edits — order was **reversed** from the original plan: typing **Phase 4 runs first** (agent retyping the DI), then the `harness.module` stub-hit counters get added on the settled, typed file. `lib/types.ts` was created by typing Phase 0 and is shared by both tracks.

## Impact on the widget testing framework

The rig is not a side tool — it maps onto the existing two-tier test model and *adds* capability the framework lacks today. It must wire through the parent Makefile (the single enforced pipeline), not become a parallel hand-run path.

- **Phase 1 render-report → a new hermetic regression gate.** Per-widget payload / boot / console-error budgets become a `make`-wired check alongside the mock e2e tier. Catches regressions the current tier can't see (a widget silently pulling in Monaco, doubling boot time, or starting to throw digest warnings). Subsumes/extends `scripts/probe-bootstrap.ts`. **Belongs in the hermetic tier** (`FSR_HERMETIC=1`, box-independent).
- **Phase 2 fidelity diff → strengthens the live sweep.** Upgrades the live tier from "does it render / does the connector answer" to **"does it render the *same* as SOAR"** — DOM, applied styles, and *which services resolved real vs stubbed*. That last signal is new: it surfaces when a widget leans on a `harness.module` stub that diverges from the real platform — a bug the hermetic mock tier is blind to by construction. **Live sweep only** (needs the real box); must never leak into the mock tier or a box outage would red a hermetic test.
- **Stub-hit instrumentation → coverage on the harness's own fakes.** Learn which of the 60+ stubs are actually exercised vs dead.

**Tier discipline (non-negotiable):** budget gate = hermetic; fidelity diff = live sweep. Wire in as `make introspect` (+ a live-fidelity variant), never as a standalone script. See `../TESTING.md` "Two tiers".

## Related
- Typing migration (just completed): all harness JS → TS. Remaining `any` reduction plan folds into Phase 5 (typed introspection rig). See `tsconfig.json` include list.
- Existing tooling to build on: `scripts/probe-bootstrap.ts` (headless boot probe), `window.__harness.dump()` (live buffers), `lib/soarBrowser.ts` / `lib/liveUiDriver.ts` (real-SOAR drivers), the in-page debug drawer (`lib/harnessDrawer.ts`).
