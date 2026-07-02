# STATUS — master tracker

Single source of truth for what's open, in progress, and done across the FSR
widgets work. The detailed plans live in their own docs (linked below); this file
is the index. Update it when a thread changes state; move finished items to
**Done / archived** rather than deleting them.

_Last updated: 2026-07-02_

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
    `tests/e2e/actionRenderer.outputRender.spec.js` + `applyOutput()` seam.
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
| **Auto-approve safe / read-only actions** | Make the approval gate policy-configurable so SAFE actions can be set to run automatically instead of always staging an approval card. Today the dispatch tier gate (memory `agent_mutating_op_approval_gate`) already auto-executes tier 1/2 **safe reads** (`get_record`, `search_module_records`, reading a playbook) and only stages tier ≥3 (management/containment/remediation). The ask: (1) an explicit, surfaced policy/config for "auto-run read-only tools" (default on) so it's a first-class setting, not an implicit tier side-effect; (2) the deferred **"allow once / always-allow per tool"** mechanism (per `agent_mutating_op_approval_gate` residual). Ensure read-only playbook inspection (the new build-mode tools — explain/find-issues) never prompts. Verify tier assignment for any new playbook-read tools = safe (1/2). | none — design + wire | memory `agent_mutating_op_approval_gate`; `fsr_core/llm/tools.py::_tier_for_run_op` |
| **Local dev loop — prove full functionality** | P0/P2 DONE (see below — sidecar `fsr_soc_triage` import bug fixed, `chat_resume` approval-card lifecycle live-verified). Remaining: P1 flip harness `.env` to 159; P3 run the PROMPT_FLOW_TEST_PLAN flows; P3 triage-quality (turn hit `max_tool_turns`). | none known | `LOCAL_DEV.md`; memory `local_dev_loop_next_steps`, `sidecar_fsr_soc_triage_import_fix` |
| **Triage & playbook strategic vision** | Make the agent genuinely helpful: hunt/pivot via FortiSIEM/FAZ (already in ref DB — gap is prompt guidance, not data); turn-investigation-into-playbook (Track B4/B5 — **playbook-designer persona now partially built, see below**); pydantic strict-typing pass (connector's `chat_turn`/`chat_poll`/`chat_resume`/`chat_history` boundary + tool-arg models already done, commit `777bf58`); py3.12 modernization. See roadmap section below. | tune-able once local loop P0 lands | memory `triage_and_playbook_vision` |
| **Prompt + flow test matrix (triage & playbook creation)** | Author the live prompt/flow test plan, then execute it against the 8.0 box (proven render + live triage path). See section below + `fortisoar-widget-harness/docs/PROMPT_FLOW_TEST_PLAN.md` (new) | none ��� 8.0 live path proven; needs the plan authored + a run window | this file; memory `deploy_159_fortisoar_8` |
| **Chat Intelligence — Track B** | Live drive vs forticloud + re-capture 2 stale goldens, then start Track B | Phase 0 done offline; needs live | memory `chat_intelligence_plan` |
| **Introspection Phase 2** | Build live-fidelity rig | not started | `fortisoar-widget-harness/docs/INTROSPECTION_OPTIMIZATION_PLAN.md` |
| **Playbook-editor tailoring — verify on real box** | Widget now hard-forces build intent + shows playbook-authoring quick actions when mounted on `main.playbookDetail` (hermetic e2e proven). NOT yet confirmed against a real FortiSOAR box via Chrome — need to open the actual playbook designer, drop the widget in via the drawer, and confirm it mounts + shows the right intent/chips there (vs the harness's synthetic `$state` stub). | none — just needs a live Chrome pass | memory `playbook_editor_tailoring` |
| **`fortisoar-widget-harness/tests/e2e/harness.spec.js` — 35 stale failures** | Whole file asserts `#widget-select` (native `<select>`) is visible; `index.html` intentionally set it `display:none` in favor of a custom dropdown a while back (comment at ~line 599), so the assertions are just out of date, not a real regression. Confirmed unrelated to this session's `$state`-stub change (other widgets' e2e all green). Needs a pass updating the locators to the custom dropdown. | none — mechanical locator fix | this file |

### Prompt + flow test matrix (triage & playbook creation)

Proven so far on 8.0 (2026-07-01): the widget drawer renders and **one** triage
chat turn streams to `done` with frames (9 polls, 7 frames). That proves the
plumbing, not that every prompt/flow behaves. This matrix is the backlog of
"various kinds of testing" to run later. Detail + acceptance signals live in
`fortisoar-widget-harness/docs/PROMPT_FLOW_TEST_PLAN.md`.

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

**Harness gate (do this first, once):** commit the 3 uncommitted 8.0 harness
fixes (`soarBrowser.js` login, `liveUiDriver.js` drawer-icon-by-title, Monaco
`define.amd`) — they're required for *any* live 8.0 Playwright run to work, and
are currently only in the working tree. Land them in the deferred TS-migration
pass (or a scoped commit) before driving the matrix.

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
  misdiagnosed as an RBAC/team-ownership gap (it was NOT — csadmin has create
  rights, confirmed): `push_playbook`/`render_jinja`/`dry_run_playbook`
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

The local loop enables all of this (edit editable source, restart sidecar,
re-drive, watch the transcript). Verified starting points: the **intent/persona
system already exists** (`fsr_playbooks/llm/intents.py` — extend, don't rebuild)
and **FortiSIEM + FortiAnalyzer are in the reference DB** (724 connectors / 6867
ops; `run_op` already proxies to 159 — the gap is prompt guidance, not data).
Suggested order:
1. Local-loop P0 (widget renders + `chat_poll` streams) — can't tune what you
   can't watch.
2. **Triage quality** (Track B1-B3): get a turn to close cleanly (`end_turn` +
   staged card) before adding capability. `system_prompt_triage.md` + TriageDiscipline.
3. **Hunt/pivot**: prompt guidance to reach for FortiSIEM `event_query` /
   FortiAnalyzer log-search on an indicator; verify 159 has them healthy; thin
   wrapper tool if a pattern repeats (NOC FMG wrappers are the precedent).
4. **Pydantic strict-typing pass**: type config, `chat_turn` params/result, tool
   dispatch args first (none used yet; pydantic 2.13 in venv). Catches
   widget/connector/framework shape drift.
5. **Investigate-to-build chain** (B4/B5): live-drive turn-investigation-into-playbook.
6. **Playbook-designer persona**: new intent + scoped tools (no containment/
   run_op; yes playbook CRUD + step inspection) + state-name gating so the widget
   knows it's on the playbooks page. memory `triage_and_playbook_vision`.

## 🟡 Built but uncommitted / unpushed

| Thread | State | Doc |
|---|---|---|
| Widget rename → FortiAI Agentic Assistant + unblocking fixes | Rename + `fsrPbRender.js` `typeof module` guard **committed + pushed** (widget `feat`+`master`/`main` to gitea; connector 0.4.12 bump + triage-rehome to origin/main) + **deployed + live-verified on 8.0** (drawer mounts, one triage turn streamed `done`). Harness Monaco fix + 8.0 login/drawer fixes **uncommitted** (in working tree, deferred to the TS-migration pass). See "8.0 box live verification" in Done. | memory `fsrpb_renamed_to_soc_assistant`, `harness_monaco_toastui_define_conflict`, `deploy_159_fortisoar_8` |
| OpenAI terse-triage guard | Connector **0.4.10** live-verified, **uncommitted**. Residue: widget empty-opener path not re-tested | memory `openai_terse_triage_shallow` |
| B2 hunt_depth gate | Gate + 6 tests (141 green) offline, **uncommitted**; live drive parked (run only on gb200) | memory `b2_hunt_depth_offline` |
| Widget-harness inspect kit | mount+measure primitives built, **uncommitted** | memory `widget_harness_inspect_kit` |
| action-renderer live-test on the 7.x box | Proven live (fix #3); #1/#2/#4 need Application Editor. **Uncommitted** in harness repo | memory `action_renderer_live_205` |
| stop_reason contract fix (framework) | Committed `6c3afa0`, **not pushed, not deployed** (box runs 0.4.7) | memory `session_2026_06_23_handoff` |
| pyfsr 8.0 `status`-shape fix | `f34d78e` committed, **not pushed** (remote ahead + foreign WIP — user reconciles) | memory `pyfsr_8_0_config_fixes` |
| Harness full-TS migration | `b38e2a4`+`27b3e6a` green, **not pushed** | memory `session_2026_06_23_handoff` |
| **Session 2026-07-02: sidecar fix + build-toggle removal + playbook-editor tailoring + harness `$state` stub** | All hermetic e2e/unit green (widget + harness). **Uncommitted, both repos:** fsr_all_widgets (`harness.module.ts/js`, `lib/harnessUtils.ts/js`, `public/index.html`, `scripts/local-connector-sidecar.py`, `tests/harnessUtils.test.js`, e2e specs `fortiaiAgenticAssistant.{rendering,incident}.spec.js`) + the separate `widgets-src/fortiaiAgenticAssistant` git repo (`widget/info.json`, `widget/view.controller.js`, `widget/view.html`). NOT yet verified against a real box (see "Playbook-editor tailoring — verify on real box" above). | memory `sidecar_fsr_soc_triage_import_fix`, `playbook_editor_tailoring`, `harness_state_stub` |

## 🟢 In progress (multi-phase)

| Thread | Where | Doc |
|---|---|---|
| **TypeScript** | Test infra + scripts + harness `lib/` converted (✅). ~33 jest specs still `.js` (deliberate). Widget *source* stays JS (AngularJS). **Phase 3 (checkJs gate) DONE** — noise-scoped + wired into `ship-verify` step 1. Active front = Phase 4 (port KB gotchas onto the unified engine) + the last Phase-2 bundle-arity cross-check, **not** more file conversion. | `TYPESCRIPT_STATIC_ANALYSIS_PLAN.md` |
| NOC FortiManager+FortiAnalyzer tools | Connector live on the 7.x box (0.4.7), committed not pushed | memory `noc_fortimanager_tools_plan` |

---

## ✅ Done / archived

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
- `widgets-src/c3charts/ROADMAP.md`
- `HANDOFF.md` — most recent session snapshot
