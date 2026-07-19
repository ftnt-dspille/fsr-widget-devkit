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
- **0.3 Shared mock/cassette layer** — one URL-pattern→response rule format feeding
  both `local_turn` and Playwright.
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
  widget timeline, zero box. _(Follow-up: script tool-using fake turns to exercise cards;
  today the fake turn is a single end_turn text — enough to gate the contract.)_
- **0.5 Session-lifecycle integration tests** (connector, the audit's untested
  corners): open → turn → card emit → resume → execute → next; **cross-worker resume**
  (cold worker + persisted profile); **corrupt/diverged state** (malformed JSON in
  `session_conversation`); **concurrent `chat_turn`** minting (assert `BEGIN IMMEDIATE`).
- **0.6 "App works" acceptance checklist**, run live once and recorded.

**Build order within Phase 0:** spine first — 0.2 (verdict registry) + 0.1 (schema)
on the `local_turn.py` hub, then 0.5 (lifecycle tests, immediate stability value on
the spine), then 0.4 (Seam C, the widget-facing payoff), then 0.3/0.6.
_Status: 0.2 + 0.1 + 0.5 ✅ (connector `03a08a0`); 0.4 ✅ (this repo — sidecar hermetic
mode + `make turn-hermetic`). Remaining: 0.3 (shared cassette format) + 0.6 (live
acceptance checklist)._

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
  case-state, so grounding stops re-running every turn and guards stop resetting.
- **2.2 Make intent per-turn-aware** rather than page-pinned (a capability-gap
  click shouldn't re-trigger full triage).
- **2.3 Tool-output budgeting** — cap/sample large tool outputs (`verify_playbook`
  ~47KB, duplicate enrichment ~40KB) so long chains don't blow the context window.
  Prerequisite for both deeper tools and autonomy.
- **2.4 Unify the build-completion path** — free-form "design a playbook" currently
  dead-ends in prose with no deploy button; always route through
  `emit_playbook_offer` so every build turn can land.

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
