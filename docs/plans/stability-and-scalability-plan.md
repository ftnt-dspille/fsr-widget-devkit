# Stability & Scalability Plan — fortiaiAgenticAssistant (widget + connector)

_Created 2026-07-19. Directive: "focus on stability and scalability of the widget
and connector." Scope clarified with the user:_

- **Stability** = state/session correctness **+** the basic functionality isn't
  fully vetted.
- **Scalability** = feature breadth toward the end-stage product (the current
  feature set is too small). End-stage = **co-equal SOC copilot + playbook
  authoring IDE**. Breadth axes, in priority: **deeper tools**, **richer chat
  cards/UX**, **more autonomy**.
- **Method** = audit first (done — three parallel audits), then this plan.

This doc is the durable "what we're doing about stability & scalability." It sits
alongside `ROADMAP.md` (where the widget is going) and `STATUS.md` (live state).

---

## ▶ RESUME HERE (2026-07-20)

**Phase 0/1/2 COMPLETE + SHIPPED. Phase 3 STARTED — axis 3A (deeper tools),
sub-item #1 (MCP bridge). User chose "verify plumbing, defer breadth choice."**

**3A.1 status — MCP bridge is now LIVE-PROVEN on 159; two box-found bugs fixed
(framework `48485c4`), NOT yet released/shipped.**

Live-prove (159 up again 2026-07-20): `supports_native_mcp()`→True; `soc` server
advertises **9 cross-product tools** (`get_alert`, `get_indicators`,
`block_indicator`, `enrich_indicator`, `hunt_ioc_siem`,
`update_alert_ai_analysis`, …), `modules`/`playbooks`/`utility` also live. After
the fixes, `soc` materialized all 9 into `anthropic_tools()` (38→47, tier 1) and a
read-only `mcp_utility__get_current_datetime` **round-tripped through the box
gateway** (`/mcp/utility/`, returned real datetime).

**Two defects that had kept the bridge dormant-when-configured (framework
`48485c4`, 28 materializer tests, 758 green):**
1. pyfsr's `client.mcp.list_tools` returns **`MCPTool` pydantic models**, but the
   loop gated on `isinstance(tool, dict)` → silently skipped every live tool
   (materialized ZERO). Fixed with `_tool_field` (dict-or-model read;
   `input_schema` is a property `_Lenient.get` doesn't surface → getattr
   fallback). **This is why the bridge never lit up live before.**
2. A natural hand-written allowlist value (`{"soc": true}` / `"*"` /
   `"read_only"` / a tool-name list) raised `'bool' object has no attribute
   'get'` and aborted ALL materialization (swallowed). `_normalize_rule` coerces
   the shorthands; one bad rule no longer aborts the rest.

**NEXT: release + ship + breadth choice** — (a) release framework (>0.4.34) via
`make release` + `make bump-framework` + `make ship` so 159's connector picks up
the fix; (b) set `mcp_allowlist` in the 159 connector config (start read-only:
`{"soc": "read_only", "utility": "read_only"}`) + publish; (c) box-prove a
materialized `soc` tool **inside a real agent triage turn** (not just in-process);
(d) then widen to `connector:<name>` / the .60 cross-product bridge.

--- earlier findings (still valid) ---

- The dynamic-tool-surface **materializer is already in the released framework
  v0.4.34** (framework commits `991d374` + `241cf73` are ancestors of tag
  `v0.4.34`) → **live on box 159** in connector 0.4.85. It ships **dormant**:
  materializes zero tools unless `mcp_allowlist` is a non-empty dict.
- The connector **already wires it**: `_apply_mcp_allowlist(config)`
  (`operations.py:348`, called at `:2902`) reads `config["mcp_allowlist"]` and
  calls `materializer.configure(mcp_allowlist=…, client_factory=build_client)`.
  The `build_client` closure builds a pyfsr client from connector config →
  **resolves the old "on-box worker has no creds → client.mcp dormant" blocker**
  (memory `dynamic_tool_surface_materializer.md`, option A).
- pyfsr **native MCP client is present** in the editable install the connector
  uses: `client.mcp.list_tools(server)` / `call_tool(server, name, arguments=)` /
  `supports_native_mcp()` (`pyfsr/api/native_mcp.py`). (Still uncommitted in the
  pyfsr repo per memory.)
- **Box-free proof (this session):** stub-client run through the SHIPPED framework
  verified the full path — `configure({"fsiem": read_only}, client_factory)` →
  `list_tools` → injection into `anthropic_tools()` (38→40 tools:
  `mcp_fsiem__get_alert`, `mcp_fsiem__list_incidents`) → tier registered (1 =
  read-only auto-run) → dispatch routes to `client.mcp.call_tool(server, tool,
  arguments)`. Scratch probes in this session's scratchpad
  (`mcp_stub_probe.py` box-free PASS; `mcp_probe.py` live — needs box).
- **BLOCKER for the live half:** box 159 network is **unreachable right now** —
  REST (13000/443) and SSH (fsr159 :11000) both time out; the lab 10.99.x net is
  VPN/jump-gated and currently down. The live box-prove (allowlist a safe
  read-only native server on 159, confirm `supports_native_mcp` + real
  `list_tools`/`call_tool` inside an agent turn) is deferred until the box is up.

**NEXT when box is up:** run `mcp_probe.py` against 159 (or set `mcp_allowlist` in
the 159 connector config + publish) to confirm the live gateway advertises servers
and a materialized tool round-trips. THEN choose 3A breadth: native 8.0 gateway
servers (soc/modules/playbooks/utility + .60 cross-product bridge) vs
`connector:<name>` materialized tools.

Prior (2026-07-19): Phase 2 FULLY SHIPPED: 2.1+2.2 already built (stale premises);
2.3 built + tested + SHIPPED (framework 0.4.34 → box 159); 2.4 built + tested +
SHIPPED (connector 0.4.85 → box 159, `d5c4325`). Widget SHIPPED to 8.0 box 159
(1.2.28). Live on 159: widget 1.2.28 + connector 0.4.85 (framework 0.4.34).

### 2.4 build-completion salvage — DONE + SHIPPED (2026-07-19)
`_salvage_build_offer` in `operations.py` (`_finalize`): a build turn narrating
its final YAML with no card now gets a deterministic `playbook_offer` (deploy
button) synthesized from `last_assistant_yaml` via the framework's
`_offer_from_yaml`. Open-playbook edits exempt (raw fence + Save updates in
place). `test_salvage_build_offer.py` 7 cases; suite 140 green. Committed
`b5ebc36`; **connector 0.4.85 shipped to box 159** (`d5c4325`, 5 workers recycled +
verified, warmup 36 conn/464 ops).
See §"Phase 2" 2.4 for detail.

**Verification gap CLOSED (2026-07-20) + Phase-0 tool-using-fake follow-up done.**
The hermetic fake LLM was a single generic end_turn text — it never drove a build
turn or tool card. Replaced with an **intent-aware `_ScenarioFakeProvider`**
(connector `a333fda`): triage slice → the marker text; build slice → a scripted
turn that calls `verify_playbook` (a real tool card) then narrates a ```yaml
fence WITHOUT offering, exercising the §2.4 salvage. One install serves both
intents (branches on the tool slice like the real provider). §2.4 now verified at
**three layers, all box-free**: unit (7), in-process through the REAL `chat_turn`
(`test_local_turn_harness.py` +2: salvage fires → `awaiting_playbook_offer` w/
`final_yaml`; open-playbook edit exempt), and **widget-level** (`seamHermetic.spec.js`
build test, widget-repo `2f9a3d5`) — designer mount → build turn → salvaged
`playbook-offer` renders. `make turn-hermetic` 2/2 green. Closes the carried
"script tool-using fake turns" follow-up.

### Ship record (2026-07-19)
- **206 down** (still); **159 (`fsr8`, 10.99.249.159, 8.0 GA) up** → shipped there.
- `make ship-verify WIDGET=fortiaiAgenticAssistant BUMP=patch` with `.env`→159:
  **fortiaiAgenticAssistant-1.2.28** installed (uuid `891fd3ae-8e03-4313-93b6-3ebe818ccc40`).
  No live-sweep is defined for this widget (only `fsrSocAssistant`), so ship =
  lint→typecheck→unit→mock-e2e→introspect-gate→**deploy**. Gated + deployed, not swept.
- **Fixed a Phase-0 gate-wiring bug** (widget-repo `d6157f7`): `seamHermetic.spec.js`
  now self-skips when `FSRPB_SEAMC_URL` is unset — it needs the hermetic sidecar that
  only `make turn-hermetic` starts, but the general mock-e2e gate globbed it and red'd
  ship-verify. Runs under `turn-hermetic`, skipped in the mock gate.
- **Framework 2.3 SHIPPED to 159 (2026-07-19).** Released **fsr-playbooks v0.4.34**
  (framework `8daaf43`/`e860ea7`; PyPI publish green) → `make bump-framework 0.4.34`
  (symbol preflight OK, 66 symbols/25 modules) → `make ship` → **connector 0.4.84**
  on 10.99.249.159, all 7 workers recycled + warmup re-synced (36 conn/464 ops).
  Connector deploy record committed `f82ebd0`. **v0.4.34 also carried the user's
  `ApprovalManualInput` feature** (was uncommitted WIP; committed as `8daaf43`,
  authored as user, with the release).
- **Live on 159 now:** widget `1.2.28` + connector `0.4.84` (framework 0.4.34, §2.3).

**Phase 0 COMPLETE. Phase 1 COMPLETE (widget 1.2.27). Phase 2: 2.1 was already
built (stale premise); 2.3 now built + tested. 2.2/2.4 remain.**

### Phase 2 audit correction (2026-07-19, box-free session)

A code map of the connector + framework state layer showed the plan's **2.1
premise is stale** — grounding does NOT re-run every turn and guards do NOT reset:
- Grounding is cached per `record_key` with a continuation directive, skipping
  preflight (`operations.py:2434`).
- Guard counters (`invest_attempts`, sticky `hunt_floor_met`, `called_once_sigs`)
  seed from persisted `Investigation` (`_loop_helpers.py:365`).
- Capabilities (`unavailable`/`confirmed`) persist via `note_result`
  (`_loop_helpers.py:514`), wired with the persisted `case_state.capabilities`
  (`openai_provider.py:382`, `anthropic_provider.py`).
- Phase persists via `_advance_phase`; intent via the `session_intent` table.
- **⇒ 2.1 needs no code.** Its residual value is *vetting* (Phase-0 lifecycle
  tests), not new persistence.

**2.3 tool-output budgeting — DONE (framework, box-free).** `shrink_history` only
deduped identical read-only calls + capped old yaml *arg* bodies; a single large
*result* (verify_playbook ~47KB, dup-enrichment ~40KB) sailed through uncapped.
Added a 3rd pass (`_loop_helpers.py`): oversized `tool_result` bodies over
`_RESULT_CAP_CHARS` (8000) are clipped head+tail, keeping the freshest
`_RESULT_KEEP_LATEST` (1) full; deterministic fixed point (prompt-prefix stable).
Test `test_shrink_history_result_cap.py` (4 cases) + full suite **741 passed, 12
skipped**. UNCOMMITTED in `fsr-playbook-framework`; needs framework release +
`make bump-framework` + connector ship to reach a box.

**Phase 2 reframed:** 2.1 AND 2.2 describe symptoms the connector's session-state
spine (case-state grounding cache + §E/spine-P3 resume path) **already solves** —
the audit that generated this plan predates that work. 2.3 was the one real code
gap (now built + tested). **The only remaining Phase-2 item is 2.4** (build tool
`emit_playbook_offer` exists + is prompt-advertised, but free-form "design a
playbook" can still dead-end in prose — a *reliability*, not capability, gap). The
"session-state depth linchpin" is therefore largely already built; Phase 2's
residual value is **vetting** (Phase-0's thin-testing conclusion) + Phase-3 breadth.

---

**Phase 0 COMPLETE. Phase 1 COMPLETE (widget 1.2.27, committed, unshipped).**

- ✅ **Phase 0 — vet the basics.** All six items done. `make turn-hermetic` gives a
  box-free real-widget↔real-connector turn (hermetic sidecar: fake LLM + cassette,
  reusing the connector's `local_turn` seams). Shared verdict registry / scenario
  schema / lifecycle tests landed in the connector (`03a08a0`). Shared cassette
  format + acceptance checklist (`docs/acceptance-checklist.md`) done.
- ✅ **Phase 1 — the 4 HIGH widget bugs** (1.1 YAML truncation, 1.2 dedup, 1.3
  connector-resolution self-heal, 1.4 message track-by), each with tests. Widget
  **1.2.27**, commit `c1ebb55` in the nested `widget-fsr-soc-assistant` repo. Unit
  66 suites / 756; smoke+rendering e2e 20 passed.

**Next actions, in order:**
1. **Ship 1.2.27** to a box: `make ship-verify WIDGET=fortiaiAgenticAssistant`
   (lint→unit→mock-e2e→deploy→live-sweep) when a box window opens.
2. **Record the 0.6 live acceptance pass** in `docs/acceptance-checklist.md`'s table.
3. **Phase 2 — session-state depth** (the linchpin: correctness fix + autonomy
   substrate). Start at §"Phase 2" below — 2.1 persist grounding/progress/guard
   counters in case-state.

**Carried-forward follow-up — ✅ DONE (2026-07-20).** The hermetic fake now scripts
a tool-using build turn (`verify_playbook` card + narrated YAML) via an
intent-aware `_ScenarioFakeProvider`, so `turn-hermetic` exercises a tool card AND
the §2.4 salvage. Connector `a333fda`; widget-repo build e2e `2f9a3d5`; 2/2 green.

**Nothing is pushed or shipped to a box.** Parent-repo work (Seam C + Phase 0.3/0.6)
committed to `main` (`9d12560`, `904e903`); widget Phase 1 committed to its own repo
(`c1ebb55`). All local, unpushed.

---

## 0. What the audit actually found

Three read-only audits ran: widget stability, connector stability, feature/roadmap
gap. Reconciled against the live `STATUS.md` (several roadmap docs are stale —
`update_playbook`/C2 and build-scoping/C5 are **done and box-verified**, not open).

### The three load-bearing conclusions

1. **The connector's session/state code is solid; it's the _vetting_ that's
   thin.** Every historical bug is fixed and defensively coded (atomic turn
   reservation via `BEGIN IMMEDIATE`, real-`sid` session threading, stale-replay
   `since_turn` fence, fail-closed `update_playbook` snapshot, no phantom
   success). The gap is **no test exercises the full session lifecycle**
   (open → turn → card emit → resume → execute → next turn), and **nothing tests
   cross-worker resume, corrupt/diverged state, or concurrent-turn minting**.
   This is precisely the "basic functionality isn't fully vetted" instinct.

2. **The widget has 4 real HIGH-severity stability bugs** (details in §2).
   The worst silently corrupts data:
   - **YAML fence extractor can truncate a playbook on deploy** — a nested/escaped
     fence inside the YAML clips it, and Save compiles the clipped copy _over_ the
     real record → steps silently deleted. (`view.controller.js:3223`)
   - **No message dedup** — a retry/poll race duplicates timeline entries → export
     & audit double-counts tool calls. (`view.controller.js:3149`)
   - **Connector-resolution cache never invalidates on 404** — connector
     uninstalled/renamed mid-session ⇒ every turn silently fails with no recovery
     but a page reload. (`fsrPbAgent.service.js:35`)
   - **Messages `ng-repeat track by $index`** — array rebuild (history reload)
     bleeds one message's card state onto another. (`view.html:1708`)

3. **Session-state depth is the linchpin for BOTH halves.** Today grounding
   re-runs every turn, guard counters reset per turn, and intent is page-pinned.
   Deepening the persisted per-session case-state is simultaneously a *correctness*
   fix (stability) and the *substrate for autonomy* — long agentic chains (the #1
   scalability axis) need durable state to plan across turns. A `CASE_STATE_SPINE`
   exists (P1–P4 shipped) but is shallow; this is where stability and scalability
   converge.

---

## Phase 0 — Vet the basics (consolidate the existing harnesses)

**Goal:** turn "I don't trust that it fully works" into a repeatable, fast,
box-free proof. **This is NOT greenfield** — five harnesses already exist; Phase 0
consolidates them and closes the one real gap.

### What already exists (inventory, 2026-07-19)
| Harness | Repo | LLM | API | Notes |
|---|---|---|---|---|
| `scripts/local_turn.py` + `test_local_turn_harness.py` | connector | swappable (fake/frank/real) | cassette/live | in-process, drives real `operations.py`; **the natural hub** — 3 swappable seams |
| `scripts/eval_harness.py` + `eval_s{1,2,3,5,6}.py` | connector | real | **live box** | runs the authored playbook, reads the appliance (the truth oracle) |
| `tooling/evals/chat_drive.py` | framework | real | live | JSON tasks + golden traces; shares grading codes |
| Playwright hermetic (`FSR_HERMETIC=1`) + `&real=1` | widget | cassette | mocked | fast; mocks the WHOLE `/api/integration/execute` response |
| live matrix (`make test-matrix-live`) | widget | real | live box, headed | T1–T11/P1–P6 rows; `gate: soft/strict/xfail` |

Partial convergence already present: `eval_s*.py`, `chat_drive.py`, and the
widget's `exportGrader` **share grading codes** — a signature caught offline can
gate the live matrix. That code-sharing is the seed to build the unified vocabulary on.

### The one real gap — Seam C
**Nothing drives the real widget controller against the real `operations.py` with a
mock LLM.** Playwright mocks the entire `/api/integration/execute` response, so the
widget never exercises real connector logic; `local_turn.py` runs real
`operations.py` but has no widget. The widget↔connector contract is only ever tested
fully-mocked (fast/fake) or fully-live (slow/box). That's the vetting blind spot.

### What "full unification" concretely is (connector-first)
- **0.1 Shared scenario schema** (one JSON) subsuming `local_turn` cassette rules +
  `chat_drive` tasks + matrix rows. Python wrapper for the imperative `eval_s*` cases.
- **0.2 Shared verdict/code registry** — promote the existing eval↔chat_drive↔
  exportGrader code-sharing into the single grading vocabulary every harness emits
  (`{code, severity, detail}`).
- **0.3 Shared mock/cassette layer** — ✅ **DONE (2026-07-19).** One cassette JSON
  (`{"reads":[{"match","body"}]}`) in `local_turn`'s rule shape — `[(url_substring,
  body)]` — so the SAME file feeds the Python `local_turn` hub (`extra_reads`) and the
  widget-facing hermetic sidecar (`FSRPB_SIDECAR_CASSETTE`, appended after the persona
  fixture). Example: `fortisoar-widget-harness/scripts/cassettes/example_alerts.json`.
  Verified: the sidecar loads it and a hermetic turn still runs green. _(The behavioral
  payoff — seeded reads surfacing as tool cards — lands with scripted-tool fake turns,
  the 0.4 follow-up; the format + plumbing are in place now.)_
- **0.4 Close Seam C** — ✅ **DONE (2026-07-19).** The plumbing already existed: the
  harness's `local-connector-sidecar.py` runs real `operations.py` in-process and the
  harness forwards `/api/integration/execute` to it under `FSR_LOCAL_CONNECTOR=1` — but
  as the *live* loop (real LLM gateway + live pyfsr reads). The Seam-C gap was only the
  two **hermetic seams** the connector's own `local_turn.py` already implements. Added
  `FSRPB_SIDECAR_HERMETIC=1` to the sidecar: it imports (does not reimplement)
  `local_turn._install_fake_provider` + `_CassetteClient` + `_cassette_rules`, so real
  `operations.py` runs against a **fake LLM + cassette reads** — box-free, no credits.
  Widget-side: `fortiaiAgenticAssistant.seamHermetic.spec.js` boots the real widget with
  `&real=1` and **forwards** the intercepted execute call to the hermetic sidecar (vs the
  usual static fixture), so the real controller drives real connector logic. New target
  **`make turn-hermetic`** boots the sidecar, runs the spec, tears down. Green: real
  `chat_turn` → persona resolution + prompt assembly + envelope shaping → rendered in the
  widget timeline, zero box. _(Follow-up ✅ DONE 2026-07-20: the fake is now
  intent-aware and scripts a tool-using build turn — `verify_playbook` card +
  narrated YAML — so `turn-hermetic` exercises a tool card AND the §2.4 salvage.)_
- **0.5 Session-lifecycle integration tests** (connector, the audit's untested
  corners): open → turn → card emit → resume → execute → next; **cross-worker resume**
  (cold worker + persisted profile); **corrupt/diverged state** (malformed JSON in
  `session_conversation`); **concurrent `chat_turn`** minting (assert `BEGIN IMMEDIATE`).
- **0.6 "App works" acceptance checklist** — ✅ **written** (`docs/acceptance-checklist.md`):
  every row tagged `hermetic` (box-free, `make turn-hermetic`/mock e2e) vs `live` (needs
  an appliance), with a recorded-passes table. The one-time live run is box-gated — record
  it in that table at the next box window.

**Build order within Phase 0:** spine first — 0.2 (verdict registry) + 0.1 (schema)
on the `local_turn.py` hub, then 0.5 (lifecycle tests, immediate stability value on
the spine), then 0.4 (Seam C, the widget-facing payoff), then 0.3/0.6.
_Status: **Phase 0 COMPLETE.** 0.2 + 0.1 + 0.5 ✅ (connector `03a08a0`); 0.4 ✅ (sidecar
hermetic mode + `make turn-hermetic`); 0.3 ✅ (shared cassette format); 0.6 ✅ (acceptance
checklist written — one live run box-gated). Follow-up carried forward: scripted-tool fake
turns so the hermetic tier exercises tool cards (unlocks 0.3's read-cassette payoff)._

_Exit: one scenario schema + one verdict vocabulary; `make turn-hermetic` green
(real widget↔real connector, box-free); the lifecycle suite green; one recorded
live acceptance pass._

## Phase 1 — Widget stability fixes (the HIGH findings)

Each ships with tests (jest for logic, e2e for DOM), per repo rules.

- **1.1 YAML-fence extraction, fail-closed** — robust extractor (handle nested
  fences) + a truncation guard: never deploy a clipped playbook; if extraction is
  ambiguous, surface it, don't silently Save. _(HIGH — data corruption.)_
- **1.2 Message dedup guard** in `_appendAssistantMessage`/`_appendUserMessage`
  keyed on turn id. _(HIGH — audit/export integrity.)_
- **1.3 Connector-resolution cache invalidation** — drop the cached promise on
  404/network-class error; re-resolve + surface a recoverable error. _(HIGH.)_
- **1.4 Stable message key** — track messages by `turn`+message-id, not `$index`.
  _(HIGH — state bleed on reload.)_
- **1.5 Medium follow-ups:** validate required envelope fields before deref
  (`_unwrapEnvelope`); transcript GC / TTL for multi-hour sessions; `info_card`
  block bounds + `track by`; `_mergeUiState` O(n²) poll-churn cache.

## Phase 2 — Session-state depth (the linchpin)

**Goal:** deepen the persisted per-session case-state so it survives turns and
workers — fixing correctness seams *and* laying the substrate for autonomy.

- **2.1 Persist grounding + progress + capabilities + phase + guard counters** in
  case-state. **✅ ALREADY BUILT** (2026-07-19 audit — see RESUME block). No code
  needed; residual value is Phase-0 lifecycle vetting.
- **2.2 Make intent per-turn-aware** rather than page-pinned (a capability-gap
  click shouldn't re-trigger full triage). **✅ SYMPTOM ALREADY HANDLED** (2026-07-19
  audit). The capability-gap "Re-check & continue" resolves through `chat_resume`,
  which (a) reuses cached grounding + a *"resuming an in-progress triage — do NOT
  restart the hunt"* directive (`operations.py:4233`), (b) never re-runs preflight
  ("no preflight re-run on resume, ever", `operations.py:4220`), (c) clears only the
  specific connector's capability guard via `capgap_recheck` + `forget_connector_
  availability` (`operations.py:4148–4190, 4246`). A fresh `chat_turn` follow-up on
  the same `record_key` likewise reuses cached grounding + continuation directive +
  seeded guards. Covered by `test_case_state_wiring.py` (`test_second_turn_same_
  record_skips_preflight`, `test_resume_uses_grounded_prompt_with_resume_directive`).
  The residual "page-pinned intent" (`uiIntent` fixed at mount) is a **deliberate**
  widget constraint — analysts must not jump triage→build from an alert — NOT a bug.
  ⇒ No code needed. Optional follow-up: strengthen the resume-directive test to
  drive the real `chat_resume` op (today it re-simulates the string) + add a
  capgap-recheck-clears-guard regression test.
- **2.3 Tool-output budgeting** — cap/sample large tool outputs (`verify_playbook`
  ~47KB, duplicate enrichment ~40KB) so long chains don't blow the context window.
  Prerequisite for both deeper tools and autonomy. **✅ BUILT + TESTED** (framework
  `shrink_history` 3rd pass; `test_shrink_history_result_cap.py`; suite 741 green).
  Uncommitted; unshipped.
- **2.4 Unify the build-completion path** — free-form "design a playbook" used to
  dead-end in prose with no deploy button. **✅ BUILT + TESTED** (connector
  `b5ebc36`). Added `_salvage_build_offer` (`operations.py`): a deterministic
  backstop in `_finalize` — when a **build**-intent turn would end in prose
  carrying a final `last_assistant_yaml` fence and no gating card, it synthesizes
  the same `playbook_offer` card the tool would emit (via the framework's
  `_offer_from_yaml`, so `final_yaml` + shape are identical) and appends it,
  turning `end_turn` → `awaiting_playbook_offer` so the Deploy button always lands.
  **Exempt:** editing an OPEN playbook (`entity.playbook_yaml` present) — the raw
  fence is correct there and Save updates in place; an offer would compile a
  duplicate (the anti-pattern `system_prompt_build.md` warns against). Also skips
  triage intent, errored turns, and already-carded turns. `test_salvage_build_offer.py`
  (7 cases); connector self-contained suite **140 green**. Committed, unshipped.
  Follow-up: exercise it end-to-end once the hermetic sidecar can script a
  tool-using fake build turn (Phase-0 carried follow-up).

## Phase 3 — Feature expansion (scalability), on the three chosen axes

Sequenced after Phases 0–2 so new surface rides a vetted, stateful foundation.

### 3A. Deeper tools
- Expand the agent's tool surface via the 8.0 MCP bridge: cross-product
  investigation/enrichment/containment (FMG / FAZ / FSIEM / EDR).
- Unify the platform capability catalog (Jinja-filter validation vs discovery vs
  real Ansible superset currently disagree; silent-zero searches) into one
  authoritative connector/operation/tool model. Fixes a whole class of silent
  false-negatives.
- First-class build-mode inspection tools as designer affordances.

### 3B. Richer chat cards / UX
- **Interactive debug UI** — surface the already-built `step_test` /
  `verify_enhancement` / `suggest_fix_for_diagnostic` / `debug_session` tools
  (Verify tab + apply-patch panel + debug drawer), reusing the `fsrPbRender` seam.
- **Advertise `emit_patch_proposal`** in the build prompt (emitter + apply already
  built; just not prompt-advertised) → box-prove the accept applies.
- Per-quick-action prompt tailoring (five chips → five distinct behaviors).
- First-run onboarding/empty-state; approval-card "why" + back-out; persistent
  cross-mount history browser.

### 3C. Autonomy
- Longer multi-turn planning built on the Phase-2 durable case-state.
- Background/scheduled/detached agent runs that survive worker recycles.
- Output budgeting (2.3) is the enabler — without it, long chains self-terminate
  on context pressure.

## Phase 4 — Structural (keeps scaling safe)

Deliberately last: refactors shouldn't carry behavior fixes.

- Split the two monoliths (`view.controller.js` ~3.1k, `operations.py` ~4.7k) into
  services; unify duplicated message-serialization.
- Commit + extend the strict-pydantic Stage-3 pass across the connector boundary.
- Audit trail → platform Postgres (survives connector-SQLite wipe on upgrade),
  exportable. (SOC2/FedRAMP posture; per the best-practices P1 doc.)
- Real SSE streaming transport (retire the 700ms long-poll) on 8.0's `/ai/` route.

---

## Recommended sequence

**Phase 0 → Phase 1 → Phase 2**, then **Phase 3** (breadth) interleaved with
**Phase 4** (structural) as capacity allows. Rationale: Phase 0 gives us the
instrument to prove nothing regresses; Phase 1 closes the bleeding-edge data-
corruption bugs; Phase 2 is the pivot that makes autonomy possible; Phase 3 is the
feature growth the user wants; Phase 4 prevents the growth from re-accreting
monoliths.

## Open decisions for the user
1. Sequence: accept the above, or pull a specific Phase-3 feature forward for a
   demo?
2. Phase 0 scope: full harness unification (0.1) is ~a week; a lighter version is
   "just add the lifecycle tests (0.2)" first. Which depth?
3. One-repo-at-a-time vs. both in parallel this session.
