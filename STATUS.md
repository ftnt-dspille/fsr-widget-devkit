# STATUS — master tracker

Single source of truth for what's open, in progress, and done across the FSR
widgets work. The detailed plans live in their own docs (linked below); this file
is the index. Update it when a thread changes state; move finished items to
**Done / archived** rather than deleting them.

_Last updated: 2026-07-10_

> **2026-07-12 (later) — drawer-widget rig-mount DONE, stub-vs-real map works:**
> `introspect.ts` now reads `introspection-profiles.json` (harness-side, keyed by
> widget id: config + ctx + urlParams + mountProbe) so drawer/standalone widgets
> mount for real instead of hitting the config-prompt gate. `fortiaiAgenticAssistant`
> now mounts in-harness (56→128 resources) and its `runtime.stubHits` populate →
> the fidelity diff reports the exact stubs the harness fakes that are real on the
> box: `$exceptionHandler, localStorageService, $state, toaster, $translate,
> config, $uibModal`. Validated my seeding change is harmless (counter/myWidget
> mount unchanged); the hermetic-sweep tail failures were the non-hermetic
> introspect server's box-proxy hanging on the last widgets (env flake, not a
> regression); `funnelChart`/`fsocFieldsOfInterest` are pre-existing no-mounts.
>
> **2026-07-12 — Introspection Phase 2 rig built + first live fidelity diff:**
> `scripts/introspectSoar.ts` (+ `make introspect-soar ENV=.env.<box>
> [ARGS='--offline']`) renders a deployed widget on a live box via the record
> drawer (WAF-safe headed Chrome), captures a `source:"soar"` RenderReport, and
> diffs it against the harness baseline → `FidelityDiff`. First run
> (`fortiaiAgenticAssistant` on 159/8.0): widget renders **clean** (0 errors
> attributable to it; the 3 captured are shell/other-widget noise). **Key finding:**
> the Phase-1 introspect rig renders drawer/standalone widgets as `no-mount` (config
> gate) — so they have no true harness baseline, and the stub-vs-real service map
> needs a rig-mount follow-up. Details in the introspection plan Phase 2 section.
> **Side note:** a stray tsc clobber of `tests/live/lib/soarClient.js` (a broken
> `.ts` sibling not in the build) was caught + restored; the rig now `require()`s
> that .js at runtime to keep it out of tsc's program.
>
> **2026-07-10 — box connectivity confirmed:** all three lab boxes (159/8.0,
> 168, 205) reachable; box 159 authenticates + serves authenticated reads via the
> harness client (`tests/live/lib/soarClient.js` `makeClient()`, loads `.env.159`)
> — 44 widgets, 67k alerts. So the box-dependent threads below (**Introspection
> Phase 2**, **live prompt/flow matrix run**, **playbook-editor live verify**) are
> unblocked network-wise; they just need a run window. Gotcha captured (raw curl to
> `/auth/authenticate` 405s on a header quirk — auth via `makeClient()`/pyfsr, not
> curl): memory `deploy_159_fortisoar_8`.
>
> **2026-07-10 — harness housekeeping:** (a) Introspection backlog #4 confirmed
> DONE (`module is not defined` render noise eliminated via `harnessUtils.js`
> IIFE wrap, `758cbaa`) — verified by a full `make introspect` sweep: errorCount
> 0 / empty `consoleErrors` on all 15 widget reports; baselines regenerated, 3
> orphaned stale-version reports pruned. Introspection plan now has only Phase 2
> (real-SOAR fidelity baseline) open. (b) Confirmed the 8.0 live-UI driver fixes
> (`soarBrowser` SIGN-IN label, `openWidgetDrawer` by-title, mock-only probe) are
> committed (`5d29ad4`) — the `live_ui_driver_8_0_fixes` memory's "UNCOMMITTED"
> note was stale.

> **2026-07-05 — commit/push sweep + new public repo:** (a) pushed the
> `triage-firewall-noc-investigation` branch (connector 0.4.37, already
> committed, just unpushed) to origin/fndn. (b) `fsr_all_widgets` main repo:
> committed the `fsrSocAssistant`→`fortiaiAgenticAssistant` e2e-fixture rename,
> local-dev sidecar scripts, and matrix-live-infra plumbing; pushed to
> `live-matrix-infra`. (c) `widgets-src/fortiaiAgenticAssistant` (separate repo):
> pushed the pending commit (card attribution + S1–S6/R7 security hardening +
> playbook-editor tailoring, `d2741b0`) to `origin/master`. (d)
> `fsr-playbook-framework` confirmed already clean/pushed — the stale
> `b2_hunt_depth_offline`/`noc_fortimanager_tools_plan` memories (24–26 days
> old) no longer reflect uncommitted state; treat those two memories as
> historical only. (e) **New: `ztpAutomationGraph` widget promoted to its own
> public repo** — `https://github.com/ftnt-dspille/widget-ztp-automation-graph`,
> scaffolded to match `widget-action-renderer` (package.json, packager
   scripts, version-triggered `.github/workflows/release.yml`, README), added
   to `widgets.manifest`. See memory `ztpautomation-graph-widget`.

> **2026-07-02 ship + live-verify DONE:** widget `fortiaiAgenticAssistant-1.2.8`
> + connector `0.4.13` (both version-bumped to dodge FortiSOAR same-version
> cache) deployed to 159. Live jest verified on 159: `chat.live.test.js` (real
> `chat_turn`→`end_turn` on v0.4.13 + mock parity) and `widgetUi.live.test.js`
> (drawer renders, `chat_poll` streams live frames) both PASS. Required two
> live-UI-driver fixes (run headed + drawer-icon-by-title) — see memory
> `live_ui_driver_8_0_fixes` + KB §18.7. Driver fixes UNCOMMITTED in harness `lib/`.
>
> **2026-07-02 also DONE (offline, UNCOMMITTED):** (a) **Pydantic Stage 3** —
> params+response models for the 14 remaining connector ops + 7 storage-row
> models in `pydantic_models.py`, `tests/test_pydantic_stage3.py` (32 tests),
> full connector suite **176 passed**. run_op/emit_* left ungated (deliberate).
> (b) **entityContext seeding** — the widget seeds the open playbook as its entity
> on `main.playbookDetail` (no misfit seed card), `playbook.editor.entity.test.js`
> (5 tests), widget suite **492 passed**. **SHIPPED 1.2.9 + LIVE-VERIFIED on 159's
> designer:** "Explain this playbook" fires a chat_turn carrying the full playbook
> in `entity` (iri+fields). Both in resume `resume_2026_07_02_contract_parity`.
>
> **2026-07-02 (later) — agentic workflow hardening, ALL offline-green, UNCOMMITTED,
> one vendor bump ships it:** (a) coherence-review **decisions LOCKED** (spine first /
> one build path / router deferred) — `AGENTIC_WORKFLOW_COHERENCE_REVIEW.md`;
> (b) **§G jinja catalog** (Ansible namespace + advisory wording + `find_jinja_filter`
> never-`[]`) and **§A build Deploy button** (`emit_playbook_offer(yaml=…)` + connector
> accept prefers card `final_yaml`) built + tested; (c) **case-state spine P1+P2 BUILT**
> per `CASE_STATE_SPINE_DESIGN.md` (framework `case_state.py`, seeded TriageDiscipline +
> `guard_redirect`, connector `session_case_state` + grounding cache + resume parity) —
> framework 624 / connector 169 passed (4 pre-existing fails unrelated).
> **SHIPPED + LIVE-VERIFIED (same day):** fsr-playbooks **v0.4.14 on PyPI**, connector
> **0.4.22 live** (0.4.20 briefly broke chat via a hard case_state import vs the old
> pinned wheel — fail-open hotfix 0.4.21). Live drive PASSED all 4: §G clean validate,
> §4.6 gap-resume = 0 tool calls, §4.7 block-ip = card only (zero re-hunt), §A build →
> `awaiting_playbook_offer` → accept → pushed. Next: spine P3/P4. Memory:
> `hardening_g_a_built`.
>
> **2026-07-02 (latest) — spine P3+P4 BUILT offline, UNCOMMITTED:** P3 capability
> facts (capability guard + `note_result` learning + `forget_connector_availability`
> cache-bust; framework 632 passed) and the **capability-gap "Re-check & continue"
> made deterministic** (clears learned facts + availability caches + explicit
> re-check instruction — closes the user-reported dead-button gap). P4 phase
> transitions at the persist chokepoint + §A build-terminal eval + re-triage
> transcript-scan eval. Connector 184 passed (+15 new tests), same 4 pre-existing
> fails (now fixed — 188 passed, fully green). **SHIPPED + LIVE-VERIFIED same
> day:** fsr-playbooks **v0.4.15 on PyPI** (framework 7c0a895), connector
> **0.4.23 live** on all 8 workers (6892f3d). Live drive: servicenow gap card →
> "Re-check & continue" → live re-probe, zero re-hunt, guard doesn't block the
> retry. Memory: `hardening_g_a_built`.

> **2026-07-02 (session: §F/§B + matrix run 5 + case_state tag) — COMMITTED offline,
> NOT shipped:** (a) **§F build-authoring efficiency** (framework `0721e14`):
> `validate_yaml` returns `corrected_yaml`+`auto_fixes` (source_fixer wired into
> the tool via new `apply_fixes`); parameters shape error carries examples + the
> mapping equivalent of a list-of-dicts; **§B** verify_playbook slimmed (no
> duplicated compile evidence, lean typed_walk = counts, warnings/fixes deduped
> by (code,message) with count). (b) **Matrix run 5 executed** (`make matrix`,
> T1): FAIL, but diagnosis says the blocker is a **stale framework gate model**
> — `tool_models.GetRecordArgs` required module+record_id(str) and bounced
> iri-only / module+uuid / int-record_id (3 of 4 "errors"); fixed (framework
> `2ad99de`) + eval false-positive fixed (`ok:true` payloads with nested
> "status":"error" no longer count as tool errors, matrixDriver.js) + connector
> Makefile→widgets Makefile MATRIX_ENV abs-path handoff fixed. **Matrix re-run
> gated on shipping framework fix: tag v0.4.16 → PyPI → pin bump → `make ship`
> → `make matrix`.** (c) **case_state envelope tag built** (connector `94be9f1`):
> chat_turn/chat_resume tags carry `{phase, record_key, scenario, searched,
> enriched, unavailable_connectors}` for a widget status strip (widget-side strip
> NOT built yet — needs the connector shipped first). Suites: framework 1757,
> connector 192, matrixEval 15 — all green.
>
> **2026-07-02 (SHIPPED + matrix run 6):** framework **v0.4.16 on PyPI**,
> connector **0.4.24 live on all 6 workers** (pin bump `fe9d30c`), provider
> anthropic. `make matrix` run 6: **infra fully healthy** — get_record errors
> gone, guard redirects now excluded from the eval (`da2ee3f`). T1's remaining
> FAIL is one precise gap: **`fortinet-fortiguard-ioc` missing from the
> reference catalog** → discovery's tier≤2 filter drops it AND the dispatch
> tier gate stages an approval card for its read-only `ip_reputation`, so the
> turn ends `awaiting_approval` with no info_card. Fix next: ingest
> live-configured connectors into a warmed per-install DB, or tier-gate
> fallback to live op metadata (see memory `matrix_run1_findings` RUN 6).
>
> **2026-07-02 (latest) — run 6 T1 gap DIAGNOSED + FIXED + SHIPPED (0.4.25):**
> NOT a DB-location bug — the site-packages slim DB is writable + persists. Real
> root cause: **stale catalog**. `_warmup_needed` only re-warmed when
> `connectors`/`modules` are *empty*, so after the first partial warmup (12
> connectors, `op_safety=0` from an older connector version preserved across the
> `$replace` upgrade) it **always skipped** → the 20 connectors configured since
> (incl. `fortinet-fortiguard-ioc`) were never ingested. A forced warmup ingests
> all 32 + `op_safety` (357 rows) in ~7s. Fix: (a) `_warmup_needed` now also
> re-warms when `op_safety` is empty with `operations>0` (version-skew
> staleness); (b) `make ship` force-warms after `verify` (operational guarantee).
> `fortinet-fortiguard-ioc` 1.1.0 has NO `ip_reputation` op (the agent
> hallucinated it) — its real ops (`ioc_search` etc.) are investigation/safe/
> tier-2, so discovery surfaces them `requires_approval:false`. **SHIPPED +
> LIVE-VERIFIED on 8.0:** connector `0.4.25` on all 6 workers (commit `efb545f`,
> unpushed). `make matrix` T1 now **DEGRADED** (was FAIL): `info_card` delivered,
> `find_enrichment_actions` returns fortiguard-ioc tier-2, agent runs real
> `ioc_search` via `run_op` (auto-allowed, no approval card). Suite: connector
> **195 passed** (run with `FSRPB_DEV=1`; +3 staleness tests in
> `test_warmup_hooks.py`). Known gap: a connector configured via UI between
> ships isn't auto-detected — run `make warmup` after adding connectors.
>
> **2026-07-02 — emit_action_card gate drift FIXED + SHIPPED (framework v0.4.17 /
> connector 0.4.26):** the `emit_action_card`/`emit_choice_card` pydantic gate
> models required `title` (a field neither registered tool accepts) while
> omitting the real required params — every staged card bounced "title: Field
> required". Same drift class as GetRecordArgs (run 5). Fix: gate models now
> mirror the real signatures + a signature-sync guard test keeps them aligned.
> Released framework **v0.4.17 on PyPI** (tag `v0.4.17`, bundled 2
> conditional_refetch probe commits), connector pin bumped 0.4.16→0.4.17,
> shipped 0.4.26. `make matrix` T1: **PASS** (toolErrors 0, info_card delivered).
> Framework commit `afdfea0` (unpushed past the tag); connector `80b287e`+`0591322`.
>
> **2026-07-02 — triage flow FIXED + SHIPPED (connector 0.4.27):** the agent
> opened triage turns with a full structured "Triage Summary" (indicator/
> confidence/action table, MITRE, prioritized next-actions) from the raw record
> BEFORE any lookup — presenting a plan as a conclusion, then a second summary
> once findings landed. Root cause: the prompt's Quick-action intents section
> licensed record-only structured answers and the agent over-generalized it to
> the default opening; no ordering rule existed. Fix: new "Order of operations"
> section in `system_prompt_triage.md` (lookups before verdict; one summary at
> the end; one-line plan orientation allowed, structured verdict not) +
> Quick-action intents marked opt-in. `make matrix` T1: **PASS** — opens with a
> plan, runs 10 tools, then surfaces the verdict (no premature summary). The 1
> minor error is the pre-existing whois-rdap-not-configured env gap, handled
> gracefully (wider enrichment fan-out is better, not a regression). Connector
> `d26cd35`+`5cda516` (unpushed). Quick-action path not matrix-covered (T1 is
> default triage). See memory `matrix_run1_findings` RUN 8.

> **2026-07-02 (matrix run 9 — EXPANDED to 7 rows; ONE real defect found):**
> Wired T2/T3/T4/T7/P1 + a new T11 quick-action row into gitignored
> `tests/live/scenarios.local.json` (recorded UUIDs). `make matrix`: **T1 PASS,
> T11 PASS** (opt-in IOC table confirms the 0.4.27 investigate-first/opt-in
> split); **T3 DEGRADED** (FMG/FAZ `unknown_connector` — env gap, RFC1918
> acceptance met); **T2/T4/T7 FAIL** are box-159 env / scenario-design limits
> where the agent behaved correctly (T2: alert's indicator is reserved
> `203.0.113.66` + `expectedCards:["ioc_card"]` typo — connector emits
> `info_card` variant `ioc_enrichment`, widget normalizes ioc_card→info_card;
> T4: no containment connector → agent correctly emits `capability_gap`; T7:
> "delete alert" isn't a tier-gatable op). **P1 FAIL is the ONE real defect:**
> on a "save as playbook" ask the agent over-reaches into `find_containment_actions`
> → `capability_gap` truncates the turn before `emit_playbook_offer` fires (HARD
> RULE violation). **P1 prompt fix APPLIED (UNCOMMITTED)** in
> `system_prompt_triage.md` (save-as-playbook → enrichment + offer, no
> containment hunt). **NEXT (needs user call):** ship the P1 fix + re-run
> matrix; AND re-scope T2/T4/T7 to box-159 reality (or stand up FMG/FAZ/FortiGate
> /whois-rdap). Artifacts in `tests/live/_artifacts/`. See memory
> `matrix_run1_findings` RUN 9.
>
> **2026-07-04 — SECOND real defect FIXED + SHIPPED (framework v0.4.18 / connector
> 0.4.35):** `list_configured_connectors` advertised inactive-config connectors as
> `Available` (whois-rdap on 159 had a config record but no active config → listed
> `Available`, then `run_op` rejected it `connector_not_configured` — agent wasted a
> turn, run 9 P1). Root cause: the listing used pyfsr's `list_configured()` (any
> config record) while `run_op`'s preflight uses `_configured_rows` (active-only);
> the two disagreed. Fix (framework `d2ff950`): `list_configured_connectors` now
> filters through `_configured_rows` (fail-open if unreachable). Also cleans
> `find_enrichment_actions`/`find_containment_actions`. +3 regression tests. Released
> **framework v0.4.18 on PyPI** (tag → `publish.yml` → Trusted Publishing). Connector
> pin 0.4.17→0.4.18, shipped **0.4.35** on all 7 workers (anthropic). Both repos
> pushed to main (framework `github/main`, connector `origin/main`). Matrix run 10
> validating the fix in flight. Note: the P1 prompt fix from run 9 was already
> shipped by the user as connector 0.4.32; this 0.4.35 is the framework-side
> discovery fix on top.

---

## 🎯 Widget live-validation pass (action-renderer + json-to-grid)

Goal: validate **all configurable options** for both widgets — live against the
box where the box adds signal, hermetic (mountWidget kit / stubbed grid) for
config-driven render options.

**✅ Done & pushed**
- **action-renderer — complete.**
  - Live (vs box): playbook listing (show-all/search/pick/classify), JSON-to-Grid
    flow (notrigger→grid_data→table), **connector flow** (connector→op→config→run→table,
    env-aware `[[AR-ENV-SKIP]]`). Targets: `make test-ar-playbook-live`,
    `test-ar-jtg-flow-live`, `test-ar-connector-live`.
  - Hermetic output matrix: raw, table styles ×5, sticky, auto+explicit alignment,
    custom columns, empty message, sandboxed-iframe jinja (11 assertions).
    `widgets-src/widget-action-renderer/tests/e2e/actionRenderer.outputRender.spec.js` + `applyOutput()` seam.
- **json-to-grid — filter matrix complete.** boolean/enum/date (pre-existing) +
  **number, string, column sort** (new). All 10 e2e green.
- **Harness fixes** (both unblocked the above): app-shell path now probes
  `fsr_src/app_min/`; `dollar-param-drop` lint downgraded error→advisory warning
  (was darking the whole JTG hermetic tier; single-`$` query params verified safe —
  KB updated).

**🔄 Continuing layer — remaining**
| Widget | Item | Type | Notes |
|---|---|---|---|
| JTG | Column discovery (runs provider playbook) | live | edit-flow `discoverColumns()` |
| JTG | Action buttons (with / without record) | live | execute selected playbooks |
| JTG | Execution wizard launch | live | `showExecutionProgress` |
| JTG | ✅ Card view, expandable rows | hermetic | **done** — 2 new e2e tests (see below) |
| JTG | Column width + order persistence | hermetic→live | `settingsService` keys; restore path needs box-seeded user_settings, defer to live |
| AR | Module-scoped playbook picker | ⛔ blocked | Application-Editor only, not harness-testable |

**Card view / expandable rows (done 2026-06-28).** Two hermetic e2e tests added
to `widget-json-to-grid/tests/e2e/jsonToGrid.spec.js` (12 green):
- **Expandable rows** — per-row `ui-grid-icon-plus-squared` toggle renders (one
  per row); clicking flips to `minus-squared` and mounts the `.expandableRow`
  sub-row container. Two non-obvious findings recorded in KNOWLEDGEBASE.md:
  (1) the detail body (`rowExpandable.html`) uses `cs-markdown-editor`, which the
  harness only vendors when editor markers appear in `view.html`/`edit.html` —
  **not** in `widgetAssets/` sub-templates — so the detail TEXT + row height are
  **live-only** (deferred to box); (2) the platform binds expanded height to
  `row.expandedRowHeight`, not `gridOptions.expandableRowHeight`.
- **Card view** — the `#grid-card-view-btn`/`#grid-list-view-btn` toggle is
  ng-show-gated on `allowGlobalFilter && allowCardView`; the widget disables
  `allowGlobalFilter`, so the toggle is intentionally unreachable and the grid
  always renders list view. Test pins that contract (a future `allowGlobalFilter`
  flip would expose a half-wired card view — `cardView.html` binds
  `record.name/image`, a collection shape, not arbitrary `grid_data`).

**Env note:** lab **FortiGate connector config is down** ("invalid endpoint or
credentials") — env, not a widget bug; connector test env-skips it cleanly.

---

## 🔴 Open / next up

| Thread | Next action | Blocker | Doc |
|---|---|---|---|
| **Auto-approve safe / read-only actions** | **Mostly DONE.** (1) explicit policy is already built: `FSR_AUTO_APPROVE_READONLY` env var + `_readonly_auto_approve()`/`_approval_floor()` in `fsr_playbooks/llm/tools.py` (default on, tier 1–2 auto-run, tier ≥3 gated) — memory `readonly_auto_approve_flag`. (2) **"allow once / always-allow per tool" BUILT 2026-07-05** (offline, committed, not pushed): `grant_tool_approval()`/`_consume_grant()`/`clear_session_grants()` in framework `tools.py` (commit `4356e2b`), `dispatch()` takes an optional `session_id` and checks/consumes a per-(session,tool,op_key) grant before staging the approval envelope (audited `auto_allow_grant`); connector `_resume_action_card_execute` threads an optional `grant: "once"\|"always"` resume param + `session_id` into dispatch (commit `413a1c3`). In-memory only, backward compatible (no session_id/grant = unchanged behavior). Framework 655 passed/2 skipped, connector 77 passed, 10 new grant tests. Playbook-read tools (`analyze_playbook` tier 0, `verify_playbook`/`verify_enhancement`/`diagnose_yaml_against_pb_execution` tier 1) confirmed already safe/never-prompt. **Widget UI also BUILT 2026-07-05** (`widgets-src/fortiaiAgenticAssistant` commit `cdb4788`): action card gained an "Always allow this action" checkbox that sends `grant: "always"` on `chat_resume` when checked (unchecked = today's one-shot behavior, unchanged). 3 new tests, full widget suite 521 passed/3 skipped/524 total. **Remaining (2026-07-06 update): all 3 commits are now pushed** — widget `cdb4788` (origin/master, pushed 07-06 under the e2e-migration push), framework `4356e2b` (on framework `github/main`), connector `413a1c3` (on `origin/triage-firewall-noc-investigation`). Only the **live-box verify** of the "Always allow this action" checkbox end-to-end remains (needs a box window + `make ship`; note the connector repo is currently mid-flight on `dynamic-tool-surface-connector` with unrelated WIP). | live verify only | memory `agent_mutating_op_approval_gate`, `readonly_auto_approve_flag`, `approval_grants_built`; `fsr_playbooks/llm/tools.py::dispatch`, `_consume_grant` |
| **Local dev loop — prove full functionality** | P0/P2 DONE. **P1 DONE 2026-07-05** (harness was proxying to `.env.box`=205; flipped to `.env.159` via `POST /_fsr/soar-envs`, confirmed a real `/api/3/alerts` fetch from 159). **P3 triage-quality: re-checked, no longer reproduces** — a real triage turn against a live 159 alert ran 13 well-directed tool calls (record → connector discovery → enrichment/containment → IOC lookups on both IPs + host) and closed clean (`end_turn` + a real `ioc_enrichment` info_card); the old `max_tool_turns` complaint looks fixed by since-shipped prompt work (0.4.27 "investigate first, summarize once", etc.). **Real bug found + fixed along the way:** `_shared._live_client()` memoises the FSR session for the process lifetime with no re-auth on token expiry — a sidecar idle since 2026-07-01 failed every `get_record` call `http_401` (15 tool calls, every arg permutation, never succeeded) even though the record existed; fixed via `_invalidate_live_client()` (framework `295b2fc`) + a `_get_with_reauth()` retry wired into `get_record`'s two request sites (connector `7e6ac6c`). Other `client.session.get/post` call sites in `tools_triage.py` (search_module_records, tags, etc.) have the same latent bug — follow-up, not yet fixed. Remaining: P3 run the full PROMPT_FLOW_TEST_PLAN matrix locally. | none known | `LOCAL_DEV.md`; memory `local_dev_loop_next_steps`, `sidecar_fsr_soc_triage_import_fix` |
| **Triage & playbook strategic vision** | Make the agent genuinely helpful: hunt/pivot via FortiSIEM/FAZ (already in ref DB — gap is prompt guidance, not data); turn-investigation-into-playbook (Track B4/B5 — **playbook-designer persona now partially built, see below**); pydantic strict-typing pass (connector's `chat_turn`/`chat_poll`/`chat_resume`/`chat_history` boundary + tool-arg models already done, commit `777bf58`); py3.12 modernization. See roadmap section below. | tune-able once local loop P0 lands | memory `triage_and_playbook_vision` |
| **Prompt + flow test matrix (triage & playbook creation)** | Author the live prompt/flow test plan, then execute it against the 8.0 box (proven render + live triage path). See section below + `fortisoar-widget-harness/docs/PROMPT_FLOW_TEST_PLAN.md` (new) | none ��� 8.0 live path proven; needs the plan authored + a run window | this file; memory `deploy_159_fortisoar_8` |
| **Chat Intelligence — Track B** | Live drive vs forticloud + re-capture 2 stale goldens, then start Track B | Phase 0 done offline; needs live | memory `chat_intelligence_plan` |
| **Introspection Phase 2** | Live-fidelity rig (real-SOAR baseline diff vs harness) | **rig BUILT + live diff on 8.0 + drawer-mount DONE (2026-07-12)** — `scripts/introspectSoar.ts` + `make introspect-soar` render the deployed widget on the box and diff vs the harness report; `introspection-profiles.json` teaches the Phase-1 rig to mount drawer/standalone widgets (config + context + mount probe), so fortiai now mounts in-harness and the **stub-vs-real service map works** (harness fakes $state/$uibModal/toaster/$translate/localStorageService/$exceptionHandler/config; all real on box). Widget renders clean live. Remaining: DOM/applied-style diffing. | `fortisoar-widget-harness/docs/INTROSPECTION_OPTIMIZATION_PLAN.md` |
| ~~Introspection backlog #4 (`module is not defined` render noise)~~ | **DONE + verified 2026-07-10** — `harnessUtils.js` IIFE-wrapped when browser-served (`758cbaa`); `make introspect` sweep = errorCount 0 across all 15 widgets. Baselines refreshed, 3 orphan reports removed. Only Phase 2 remains open in the introspection plan. | `fortisoar-widget-harness/docs/INTROSPECTION_OPTIMIZATION_PLAN.md` |
| **Playbook-editor tailoring — verify on real box** | Widget now hard-forces build intent + shows playbook-authoring quick actions when mounted on `main.playbookDetail` (hermetic e2e proven). NOT yet confirmed against a real FortiSOAR box via Chrome — need to open the actual playbook designer, drop the widget in via the drawer, and confirm it mounts + shows the right intent/chips there (vs the harness's synthetic `$state` stub). | none — just needs a live Chrome pass | memory `playbook_editor_tailoring` |

### Prompt + flow test matrix (triage & playbook creation)

Proven so far on 8.0 (2026-07-01): the widget drawer renders and **one** triage
chat turn streams to `done` with frames (9 polls, 7 frames). That proves the
plumbing, not that every prompt/flow behaves. This matrix is the backlog of
"various kinds of testing" to run later. Detail + acceptance signals live in
`fortisoar-widget-harness/docs/PROMPT_FLOW_TEST_PLAN.md`.

**Runner (built, branch `live-matrix-infra`):** `make test-matrix-live` drives
the whole matrix through the deployed widget and prints per-scenario digests +
a summary table (`tests/live/matrix.live.test.js` + `tests/live/lib/matrixDriver.js`;
eval engine unit-tested offline in `tests/matrixEval.test.js`). Scenario rows
(box-specific record UUIDs) go in the gitignored `tests/live/scenarios.local.json`
(template: `scenarios.local.example.json`). Only hard-FAIL verdicts red the run.
**Current state (2026-07-02): the probes/crudhub bridge BLOCKER is RESOLVED.**
Root cause was NOT a code bug — the box's connector *workers were stale in
memory* (they only recycle on a version-bumped publish; dropping 0.4.13 on disk
didn't reload them, so they kept returning `no_fsr_configured: No module named
'probes'` while on-disk `lc.available()` was `True`). Fixed by shipping a bump
(0.4.13 → 0.4.14) which recycled all 7 workers; `make bridge-check` confirms the
live crudhub bridge (30k+ alerts, `available: True`). See memory
`ship_via_connector_makefile` + KNOWLEDGEBASE §20.4.

**STANDARDIZATION (enforced):** ship + diagnose ONLY through the connector-repo
Makefile (`/Users/dylanspille/PycharmProjects/ConnectorsV2/fsr-playbook-builder/Makefile`):
`make ship` (connector, bump→build→install→verify workers recycled),
`make ship-widget` (widget ship-verify), `make verify`, `make bridge-check`,
`make matrix`. Never hand-run `deploy.sh` / `ssh` / ad-hoc `pyfsr`.

**Pick up here: re-run `make matrix` (T1 should now pass) → extend
scenarios.local.json with the T2/T4/T7/T9/P1 rows.**

**Triage flows**
- Single-alert triage → `info_card` summary (severity, indicators, next steps).
- Hunt chain: multi-pivot across indicators (`get_record` → `search_module_records`
  → enrich) → consolidated `ioc_card`. (The `c2_hunt.json` fixture is the mock
  golden; need a live equivalent vs a real 8.0 alert.)
- Negative cases: RFC1918 IP deliberately NOT enriched; unlinked records
  (pivot-by-search, not relationship-traversal).
- Direct-containment ask → `action_card` (not a silent `run_op`).
- Approval lifecycle: approve → `execute_action` → `end_turn` summary; reject →
  logged, no action, `end_turn`.
- Tier gating: mutating ops need human approval at the dispatch tier (≥3 →
  `pending_approval` unless `_approved`).
- Empty-opener / late-entity / bad-fetch races (render path, not prompt — but
  drive them live too).
- Triage prompt steering: fetch-by-IRI goes to `get_record`; never invents a
  connector/op (connector 0.4.11 steering).
- Provider parity: anthropic (8.0 default) vs openai/gpt-4o-mini terse-triage
  hunt-depth guard (connector 0.4.10 guard) — run both if both configs reachable.

**Playbook-creation flows**
- "Build a playbook from this investigation" → `playbook_offer` → Create
  Playbook → verify the compiled playbook on the box → delete (the
  `liveSweep.spec.js` test-4 pattern).
- Playbook draft branching; offer decline path.
- `manual_input` stage handling (framework 0.4.10 hoist).
- Rehydrate-build (resume a saved draft).

**Harness gate — DONE (verified 2026-07-05):** the 3 8.0 harness fixes
(`soarBrowser.js` login, `liveUiDriver.js` drawer-icon-by-title, Monaco
`define.amd`) are committed + pushed (`5d29ad4`, `live-matrix-infra`), not just
working-tree. Clear to drive the matrix.

**Env notes:** 8.0 box has 25k+ real alerts (soc-simulator `create_simulated_alert`
available for clean known records); FortiGate lab config is down (env, not a bug
— containment `action_card` can still be offered/approved, but `execute_action`
will env-skip). Run live turns on the gb200 box only for openai parity (per user).

### Local dev loop — connector + LLM on laptop (BUILT + curl-verified 2026-07-01)

Run the connector + LLM on the laptop; a FortiSOAR box (159) supplies SOAR data
only (records + other connectors' ops via `run_op` to pyfsr). No redeploy, no
credits, no sim/mock. **Full how-to + no-cache discipline: `LOCAL_DEV.md`.**

- **Built:** sidecar (`scripts/local-connector-sidecar.py`), venv setup
  (`scripts/setup-localdev-venv.sh` — editable fsr-playbooks+pyfsr + connectors
  engine wheel + openai/httpx), harness `POST /api/integration/execute/` handler
  gated by `FSR_LOCAL_CONNECTOR=1` (top-level, NOT in the HERMETIC block),
  `connectors.json` fixture (advertises `fsrpb-live`), `operations.py`
  `FSRPB_DEV=1` version-assert bypass.
- **Verified via curl:** `list_models` to LLM models, `health_check` ok, full
  `chat_turn` (231 events, 17 tool calls, `run_op` reached 159). Tests: connector
  125 / framework 1010 / widget 481 green.
- **P0 DONE (2026-07-01):** widget drives a real `chat_turn` in the browser
  against the sidecar, both blocking and detached/`chat_poll`-streamed paths
  proven, tool-call cards render live. Found + fixed a real bug along the way:
  `local-connector-sidecar.py` wrapped every response as
  `{"status": 200 (number), "data": ...}`; the widget's `_unwrapEnvelope` only
  peels `.data` when `typeof status === 'string'` (the real SOAR envelope is
  `{"status": "Success"|"Failed", "data": ...}`), so numeric status silently
  broke every real-mode call with a false "connector too old" error. Fixed.
- **push_playbook DONE (2026-07-01), live-verified end-to-end on 159 —
  playbook actually created, confirmed via GET, then cleaned up.** Three real
  bugs found + fixed chasing this down: (1) widget `pushPlaybook` did
  `'Create failed: ' + (res.error || JSON.stringify(res))` — `res.error` is
  an object `{code,message}`, truthy, so it never reached `JSON.stringify`
  and coerced to `[object Object]`; now prefers `error.message`/`error.code`.
  (2) connector `push_playbook`'s retry loop conflated "all 6 attempts
  raised" with "the first attempt succeeded at the transport layer but
  returned an empty body" — both left `resp is None`, producing a bogus
  "could not create after 6 attempts: None" instead of the honest
  `push_no_record` diagnosis one branch below; fixed by tracking
  `call_succeeded` explicitly. (3) **the actual root cause**, initially
  misdiagnosed as an RBAC/team-ownership gap (it was NOT — the admin user has
  create rights, confirmed): `push_playbook`/`render_jinja`/`dry_run_playbook`
  imported `integrations.crudhub.make_request` directly, which IS importable
  off-platform (the connectors SDK dev package ships it) but is a **stub that
  unconditionally `return None`** — meant to be shadowed by the real
  implementation only at deploy time. A raw `pyfsr` POST to the identical
  `/api/3/workflow_collections` endpoint succeeded immediately, proving the
  box/creds/RBAC were fine all along. Fixed `_make_request()` (the shared
  helper all three ops call) to resolve through `probes._env.get_client()` —
  the same bridge `run_op`/`get_record`/every other live tool already uses —
  instead of the dead crudhub stub. Live-verified: the widget now shows
  "Created playbook in FortiSOAR: 00 - FSR Studio", confirmed via a direct
  `GET /api/3/workflows/<uuid>` against 159, then deleted (hard-delete,
  no orphan left).
- **NOT yet proven:** `chat_resume` approval-card lifecycle, the PROMPT_FLOW
  flows, triage quality (turn hit `max_tool_turns`). No known blocker on any
  of these now — the crudhub/transport gap that blocked push is fixed.
- The internal LLM gateway name is **never in tracked files** — public text
  says "the LLM gateway"; real creds only in gitignored `scripts/localdev.env`.
- **Full-chain inspection is built in:** `chat_history` (full transcript incl.
  tool_use args + tool_result content per turn), `list_sessions`, and
  `get_session_trace` (recorded skill trace + compiled playbook) — any agent can
  pull a session's whole I/O chain to find optimizations. memory
  `chat_history_full_chain_inspection`.

### Triage & playbook roadmap (strategic vision)

**Superseded by `widgets-src/fortiaiAgenticAssistant/ROADMAP.md`** (2026-07-03)
— that file is now the single home for the two-sided (Investigate/Build)
vision, current-state snapshot, and ordered next-actions. This section stays
as a pointer; update the roadmap doc, not here, when the plan changes.
memory `triage_and_playbook_vision` holds the pre-2026-07-03 version of this
same vision for historical detail.

## 🟡 Built but uncommitted / unpushed

_2026-07-05 sweep: verified all 5 working repos (fsr_all_widgets, the real
in-repo `fortisoar-widget-harness`, `widgets-src/fortiaiAgenticAssistant`,
`fsr-playbook-framework`, `ConnectorsV2/fsr-playbook-builder`) are clean —
no uncommitted source changes anywhere except stray untracked build
artifacts (`.bak` images, gitignored scratchpad/fixture dirs). Follow-up audit
(same day) resolved the 4 flagged rows via git history: openai-terse-triage
and widget-harness-inspect-kit were confirmed **already shipped** (moved to
Done below); B2 hunt_depth is **confirmed genuinely still pending** (stuck on
a stray branch, never merged to main); action-renderer is **partially
stale** (infra shipped, AR-specific live test never built). See updated rows.
Note: `~/WebstormProjects/fortisoar-widget-harness` (standalone, remote
`fsr-widget-devkit`) is an **unrelated separate project** — do not confuse
with this repo's nested `fortisoar-widget-harness/`._

| Thread | State | Doc |
|---|---|---|
| Widget rename → FortiAI Agentic Assistant + unblocking fixes | Rename + `fsrPbRender.js` `typeof module` guard **committed + pushed** (widget `feat`+`master`/`main` to gitea; connector 0.4.12 bump + triage-rehome to origin/main) + **deployed + live-verified on 8.0** (drawer mounts, one triage turn streamed `done`). Harness Monaco fix + 8.0 login/drawer fixes **uncommitted** (in working tree, deferred to the TS-migration pass). See "8.0 box live verification" in Done. | memory `fsrpb_renamed_to_soc_assistant`, `harness_monaco_toastui_define_conflict`, `deploy_159_fortisoar_8` |
| B2 hunt_depth gate | **Confirmed genuinely still pending (2026-07-05 audit).** Commit `1911252` ("hunt-depth breadth floor") exists but only on stray branches `archive/full-history-pre-sanitize` / `fix/trigger-operator-autocorrect` in the connector repo, NOT on `main` — `test_hunt_depth.py` is absent from the current tree. The 26-day-old "live drive parked, gb200-only" memory looks like the work stalled, not shipped. **Next action: decide whether to revive `1911252` onto main + re-test, or drop it** — don't assume it's done. | memory `b2_hunt_depth_offline` |
| action-renderer live-test on the 7.x box | **Confirmed DONE, not uncommitted (re-audited 2026-07-05 — a first pass missed the file path).** `soarBrowser.js`, `tests/live/lib/viewTemplate.js`, and the AR-specific `widgets-src/widget-action-renderer/tests/e2e/actionRenderer.liveTemplate.spec.js` are all committed+pushed under `5d29ad4`. Remaining is unchanged: fix #3 proven live on 205; #1/#2/#4 still blocked on real Application Editor access (not a commit gap). | memory `action_renderer_live_205` |
| stop_reason contract fix (framework) | Committed `6c3afa0`, **not pushed, not deployed** (box runs 0.4.7) | memory `session_2026_06_23_handoff` |
| pyfsr 8.0 `status`-shape fix | `f34d78e` committed, **not pushed** (remote ahead + foreign WIP — user reconciles) | memory `pyfsr_8_0_config_fixes` |
| Harness full-TS migration | `b38e2a4`+`27b3e6a` green, **not pushed** | memory `session_2026_06_23_handoff` |
| ~~Session 2026-07-02: sidecar fix + build-toggle removal + playbook-editor tailoring + harness `$state` stub~~ | **COMMITTED + PUSHED 2026-07-05**, both repos (fsr_all_widgets → `live-matrix-infra`; `widgets-src/fortiaiAgenticAssistant` → `origin/master` `d2741b0`). Still NOT yet verified against a real box (see "Playbook-editor tailoring — verify on real box" above). | memory `sidecar_fsr_soc_triage_import_fix`, `playbook_editor_tailoring`, `harness_state_stub` |
| Dynamic tool-surface materializer — `configure()` merge fix (framework) | **LIVE-VERIFIED 2026-07-06.** Framework `fsr_playbooks` 0.4.19 (materializer) released to PyPI (commit `991d374`, tag `v0.4.19`); connector 0.4.42 deployed on 159 with the on-box CS-HMAC adapter (`_live_mcp.py`) + `mcp_allowlist` config field. Matrix T3/T7 confirmed the agent calls a materialized `mcp_soc__get_indicators` tool via the config-field path (real data returned) — the materializer is no longer dormant on-box. **One framework fix pending merge:** `materializer.configure()` clobbered `_client_factory` on the per-turn allowlist call (root cause of the earlier "0 mcp_soc__" runs) — fixed locally (merge semantics, +regression test, 17 green) on PR [#2](https://github.com/ftnt-dspille/fsr-playbook-framework/pull/2) (branch `fix/materializer-configure-merge`, commit `241cf73`, NOT yet merged/tagged v0.4.21). Connector 0.4.42 ships a workaround re-passing `client_factory` every turn; once the PR merges + 0.4.21 is pinned, drop the redundant kwarg. **OPEN — Phase 4:** the curated `faz_*`/`fmg_*`/`siem_*` wrappers (in `_TRIAGE_TOOL_NAMES`) still coexist with materialized `mcp_soc__*` tools, so the agent still calls them when FAZ/FMG are unconfigured → `unknown_connector` errors (DEGRADED verdicts, not hard-FAIL). Retire or config-gate the curated wrappers to make the structural-impossibility property cover them too. | memory `dynamic_tool_surface_materializer`; plan `continue-users-dylanspille-claude-plans-stateless-cupcake.md` |

## 🟢 In progress (multi-phase)

| Thread | Where | Doc |
|---|---|---|
| **TypeScript** | Test infra + scripts + harness `lib/` converted (✅). ~33 jest specs still `.js` (deliberate). Widget *source* stays JS (AngularJS). **Phase 3 (checkJs gate) DONE** — noise-scoped + wired into `ship-verify` step 1. **Phase 4 (KB-gotcha rules) mostly DONE (2026-07-10):** audit found most rules already in `lint-angular.ts`; added `copyright-header-missing` (KB §25.8, warning-sev, 20 real gaps surfaced) + made `ROOT` honour `WIDGETS_SRC` for fixture testing + first jest coverage for the linter (`tests/lintAngular.test.js`, 4 cases). Remaining: `drawer`/`enableFor` state-match + config-defaults AST-accuracy (Effort S). Active front also has the last Phase-2 bundle-arity cross-check, **not** more file conversion. | `TYPESCRIPT_STATIC_ANALYSIS_PLAN.md` |
| NOC FortiManager+FortiAnalyzer tools | Connector live on the 7.x box (0.4.7), committed not pushed | memory `noc_fortimanager_tools_plan` |

---

## ✅ Done / archived

- **ztpAutomationGraph — 4 fixes shipped as 1.0.32, LIVE on box 168 (2026-07-10).** (a) inline-SVG node icons squashed on zoom → gave them explicit `width/height` (viewBox-only rasterizes 300×150=2:1); (b) added `blinkCurrent` edit-config flag (default on) AND fixed the pulse — cytoscape `animation()` ignores `loop`/`alternate` so the ring grew once and froze; now a real grow↔shrink loop chained on `.play().promise("complete")`; (c) added `nodeStyle` edit-config option (`chip`|`card`; card = wide rect, icon left, title inside); (d) live poll wasn't repainting status — in-place refresh updated node DATA only, leaving `status-*`/`current` classes + mapped `border-color` frozen at first render → now re-applies `node.classes()` + an explicit `border-color` bypass. 365 unit (incl. a stateful-cytoscape regression driving two polls) + 6 e2e green. Poll pipeline live-verified via API (created run group + 3 steps on FG1, advanced statuses, confirmed current-highlight moves + rings recolor; test records cleaned up). Committed `ztpAutomationGraph@main bbdaed9` + KB §32.4.1/2/3 (`fsr_all_widgets@main e3316b3`) — **NOT pushed**. Canvas pixels not yet human-eyeballed (agent can't do box login). memory `ztpautomation-graph-widget`.
- **Widget e2e specs co-located with their widget repos (2026-07-06).** The 21 widget-specific e2e specs parked in the shared harness `tests/e2e/` moved into each widget's own repo under `tests/e2e/` (matching the c3charts / widget-action-renderer convention + the `widgets` Playwright project glob): 19 → `fortiaiAgenticAssistant@master` (`1a08b87`), `ztpAutomationGraph.spec.js` → `ztpAutomationGraph@main` (`7341135`, also fixed its `__dirname` fixture path), `actionRenderer.outputRender.spec.js` → `widget-action-renderer@develop` (`b588036`). Parent (`fsr-widget-devkit@main` `6ae56ac`) recorded the harness deletions + 2 doc SPEC= path fixups. `counter.spec.js` stayed (counter has no separate repo); `harness.spec.js`/`widgetHarness.spec.js` stayed (harness-generic). All 4 repos pushed. Verified: `make test-e2e-widget WIDGET=fortiaiAgenticAssistant` = 87 passed; ztp+action-renderer+smoke spot-run = 29 passed. Note discovered mid-task: `widgets-src/*/` is gitignored by the parent — each widget is its own repo (via `widgets.manifest`), so this was a multi-repo migration, not a parent-repo move.
- **OpenAI terse-triage guard — confirmed SHIPPED (audited 2026-07-05, was mistakenly listed as uncommitted).** Hunt-floor + forbidden-pivot + call-once discipline (`TriageDiscipline` in `fsr_playbooks/llm/_loop_helpers.py`) landed on framework `main` via `7c0a895`, live-verified per `f547709`; pushed to `github/main`. No residual uncommitted diff anywhere. memory `openai_terse_triage_shallow`.
- **Widget-harness inspect kit — confirmed SHIPPED (audited 2026-07-05, was mistakenly listed as uncommitted).** `_widgetHarness.js` mount+measure primitives + `widget-inspect.js` + `widgetHarness.spec.js` + the dropdown-clip fix landed on `main` via `a7e8931`. memory `widget_harness_inspect_kit`.

- **`fortisoar-widget-harness/tests/e2e/harness.spec.js` — all 37 tests green (2026-07-05).** Turned out to be more than the suspected stale `#widget-select` locator: `selectWidget()` picked the widget but never saved a config, so it hit the "no saved configuration yet" prompt instead of mounting — that was the real cause of most of the 35 failures. Fixed by seeding `harness:config:<id>` in localStorage before the select-change reload (same key format `_widgetHarness.js`'s `mountWidget` uses). Also: the one true locator issue (`loads and shows the widget selector`) now asserts the visible `#widget-dd-btn` custom dropdown instead of the intentionally-hidden native `#widget-select`; the config-count assertion in "Cancel closes the modal" compares before/after instead of a literal 0; allowlisted the sandboxed HTML-preview iframe's expected "Blocked script execution ... sandboxed" console message in `_fixtures.js` (proof the sandbox works, not a bug). Committed+pushed `c669fe4`.

- **TS static analysis Phase 3 (checkJs gate) — DONE.** AST noise-scoper in `lib/widgetTypecheck.ts` (`soarOnly`) keeps only diagnostics resolving to a `Soar.*` contract (TS2339/2551/2554/2345); 169 raw → 168 raw noise, **0 Soar-scoped** across 26 controllers. One real signal triaged to doc-lag (`ViewTemplateService.changeStructure` 4-param; bundle-verified) and closed via the `EXTRA_METHODS` overlay. CLI scoped by default (`--raw` for triage); **wired into `make ship-verify` step 1/5** — blocks the ship on a Soar-contract violation (planted null-config → exit 1). 7 jest cases. (`fortisoar-widget-harness/TYPESCRIPT_STATIC_ANALYSIS_PLAN.md`)
- **Hermetic mock-e2e tier** — `FSR_HERMETIC` gate + local Monaco + boot stubs. (`fortisoar-widget-harness/HERMETIC_E2E_PLAN.md`)
- **North Stars NS1–NS6** — fixture layer, atomic bump, `HARNESS_RENDERING.md`, spec-driven `make new-widget` generator. (NS7 introspect Phase 2 = open, see above)
- **Harness rendering / render-error surfacing** — visible panel for swallowed controller throws.
- **8.0 box live verification — DONE.** `fortiaiAgenticAssistant-1.2.7` (old `fsrSocAssistant` deleted) + connector `0.4.12` (anthropic, `health_check ok=true`) on FortiSOAR 8.0.0-6034. Widget drawer **renders + a live triage turn streams to `done`** (9 polls, 7 frames) via WAF-safe Playwright. Three 8.0 fixes landed in the harness working tree (uncommitted, deferred to the TS pass): (1) `soarBrowser.js` login selector adds "SIGN IN"/"Sign In" (8.0 button label); (2) `liveUiDriver.js` `openWidgetDrawer` targets the drawer icon by widget title (8.0 renders multiple drawer icons incl. the native AI Assistant — the blind `.sub-block` click-loop opened the wrong one); (3) the `__fortiaiAgenticAssistant__` probe is **mock/harness-only by design** (`if (_mockActive || _isHarness)`), so its absence in live mode is expected — the chat stream is the real proof of life. Box has 25k+ real alerts (soc-simulator active); no seeding needed. memory `deploy_159_fortisoar_8`.
- **TS Phase 2** — SOAR platform `.d.ts` generator built + emitted.
- Resolved defects: chat_poll turn-counter desync (`0.3.134`), live-sweep chat_poll classify, connector name-drift (widget 1.2.2), live triage failure sess-uq31go5p.

---

## Plan docs (canonical detail)

- `LOCAL_DEV.md` — run the connector + LLM on the laptop (LLM gateway + 159 for SOAR data); the fast local-dev loop + no-cache discipline
- `SHIP.md` — upload the widget (`scripts/ship.sh`/`make ship-verify`) + connector (`scripts/deploy.sh`) to a FortiSOAR box; point both at the same box
- `fortisoar-widget-harness/TYPESCRIPT_STATIC_ANALYSIS_PLAN.md`
- `fortisoar-widget-harness/HERMETIC_E2E_PLAN.md` (done)
- `fortisoar-widget-harness/docs/HARNESS_RENDERING_PLAN.md`
- `fortisoar-widget-harness/docs/INTROSPECTION_OPTIMIZATION_PLAN.md`
- `fortisoar-widget-harness/docs/PROMPT_FLOW_TEST_PLAN.md` (new — triage & playbook-creation prompt/flow test matrix)
- `widgets-src/fortiaiAgenticAssistant/PLAN_live_updates_and_error_hardening.md`
- `widgets-src/fortiaiAgenticAssistant/PLAN_improvement_areas.md` (new 2026-07-02 — ranked widget+connector code-review findings: security → correctness → robustness → refactor)
- `widgets-src/c3charts/ROADMAP.md`
- `HANDOFF.md` — most recent session snapshot
