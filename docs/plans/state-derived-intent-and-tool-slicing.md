# State-derived intent & tool slicing -- plan

**Status:** in progress -- Phase 0 ✅, **Phase 1 ✅ SHIPPED + LIVE-VERIFIED .206
2026-07-28 (conn 0.5.47 / widget 1.2.46; interleave triage->author in ONE session
reached emit_playbook_offer)**, Phase 2 ✅ (live-proven 159, conn 0.5.23),
M1 ✅, M2 ✅ built + connector-tier live-verified (conn 0.5.28; widget tier open),
M3 ✅ (external MCP proven live). **Open: the Phase 1 live-sweep + ship, Phase 3,
the M2 widget-tier proof.**

> **Phase 1 + persona-substrate P0 landed offline 2026-07-28** (branches:
> connector `feat/persona-module-and-pageclass` c5e9b1f+296ead0; widget
> `feat/page-facts-one-thread` 99cc356). **P0** gives personas a first-class,
> grid-editable `assistant_personas` module mirroring skills -- `resolve_profile_status`
> reads module-first, Key Store fallback (existing personas unchanged);
> `setup_assistant_skills.py` gains the module create + `--migrate-keystore-personas`.
> **Phase 1** collapses the three notions of "what page am I on" into ONE
> `classify_page` affordance taxonomy (prior + MCP surface + default persona all
> key off it), `intent` demoted to a soft override that derives the page prior
> when absent, and the widget sends page facts + keys the session on the mounted
> record/page (ONE thread, intent-agnostic; the per-turn frontier gates tools, so
> the old per-intent thread split is retired). Connector offline suites green (M2
> oracle 20/20 preserved); widget 80 suites / 892 green.
> **SHIPPED + LIVE-VERIFIED 2026-07-28:** connector to .159 (0.5.46) + .206 (0.5.47);
> `assistant_personas` module created + Key Store personas migrated on BOTH boxes
> (4 on .159, 5 on .206); widget shipped to .206 (1.2.46, ship-verify all gates).
> P0 live: `list_agent_tools` resolves both migrated personas from the module
> (`persona_applied=True`). P1 live: an interleave on the GA beaconing alert drove
> triage (hunt tools -> trace) then, in the SAME session, an authoring ask reached
> `emit_playbook_offer` -- one thread, no page flip. **Remaining (optional):** ship
> widget to .159; a headed-matrix interleave row for the gitignored scenario set.
**Created:** 2026-07-25 · **Last updated:** 2026-07-27
**Scope:** `fortiaiAgenticAssistant` widget + `connector-fsr-soc-assistant` + `fsr-playbook-framework`
**Supersedes / absorbs:** STATUS 4f follow-up #2 ("the two-intent split is too coarse"),
the `enhance_tools_leak_into_create_slice` memory thread.

## Purpose

Decide how the SOC assistant should carry **multiple kinds of work in one chat**
(triage an alert, hunt, author a playbook, enhance an existing playbook, edit the
record) without the one-way latch and coarse two-slice model that produced the
4f interleave failure (`sess-v6uv6x15` died exactly where triage hands to
authoring).

The governing question the user posed: *how do enterprise / OSS agentic chat apps
handle different kinds of prompts + tool surfaces in a single conversation?* This
plan captures that survey and sequences the migration from **latched intent** to
**state-derived slicing over one continuous agent**.

## North-star goals (user, 2026-07-25)

1. **Demo-ready across ALL page types**, adapting natively to wherever the widget
   is mounted: **Alert/incident drawer, Playbook page, ZTPF device/metadata,
   Generic record/dashboard.** The page-prior model (below) is the mechanism.
2. **MCP consumption proven** -- the assistant uses **native SOAR 8.0 MCP gateways
   (soc / utility / modules)** *and* can be pointed at **external MCP servers**,
   with the relevant tools surfaced per page. "Proven" = live, in the widget, on a
   box -- not just built. (Bridge + materializer + `soar_api_key` auth are already
   built and live-proven consuming native `soc` tools on 159; see
   `enable_native_mcp_in_soc_chat`. The gaps: external-server support + per-page
   surfacing + a demo-grade proof.) Tracked as its own workstream below.

---

## How the industry solves this (survey)

Three patterns exist in the wild; we already sit closest to #2, in its worst form
(sticky latch). The target is #1's *identity continuity* with #2's *per-turn
state-derived gating*.

1. **Single agent, one identity, mode nudges disposition + gates tools -- never
   latched.** Coding assistants (Cursor "Ask/Agent", Cline, Aider). One system
   prompt; a mode flag changes disposition (plan/explain vs act) and gates the
   tool surface (Ask can't write files). Crucially you flip modes **freely
   mid-conversation** and history carries over -- no trap.
   Ref: [Cursor agent modes](https://developertoolkit.ai/en/cursor-ide/advanced-techniques/agent-modes-deep-dive/),
   [Cline prompting guide](https://sureprompts.com/blog/cline-prompting-guide).
2. **Intent router → per-state prompt + tool subset.** A classifier tags intent;
   each state owns its prompt/context/tools. `Agento` is the clean OSS example.
   The failure mode is exactly ours: a *sticky* router traps interleaved work.
   Real implementations re-classify **every turn**.
   Ref: [Agento framework](https://github.com/agento-framework/agento).
3. **Handoffs / manager (separate agents).** OpenAI Agents SDK, AutoGen, CrewAI,
   Swarm. Peer handoff (specialist owns the next turn) vs agent-as-tool (manager
   keeps the conversation). Guidance: *route via code, not the LLM, when you want
   determinism*; reserve handoffs for genuinely separate ownership.
   Ref: [OpenAI Agents SDK orchestration](https://openai.github.io/openai-agents-python/multi_agent/).
   **We do not need this** -- our modes share one user, one record, one session.

Research on the tool-slice half (directly validates state-derived gating over a
latch):
- **CMTF -- Causal Minimal Tool Filtering** ([arxiv 2606.06284](https://arxiv.org/html/2606.06284v1)):
  expose only the minimal *next-step* tool frontier, keyed on what the current
  goal needs next -- not a top-level mode. 100→~1 visible tools, ~90% token cut.
- **GeckOpt / intent-based tool selection** ([overview](https://www.emergentmind.com/topics/intent-based-tool-selection)):
  classify → gate to a curated subset (validates the approach).
- **SING** ([arxiv 2606.16591](https://arxiv.org/html/2606.16591v2)) / **MemTool**
  ([arxiv 2507.21428](https://arxiv.org/pdf/2507.21428)): graph/memory-driven
  dynamic tool retrieval -- relevant only if the catalog keeps growing.

**Conclusion:** keep one agent identity (like #1), make the tool slice a pure
function of **conversation state recomputed per turn** (like CMTF), drop the
one-way latch. No sub-agents / handoffs.

---

## Where we are today (grounded in code, 2026-07-25)

Two intents, resolved per turn, but pinned at the widget:

- **Intents:** `INTENTS = ("triage", "build")`, `DEFAULT_INTENT = "build"`
  -- framework `fsr_playbooks/llm/intents.py:22-23`.
  `resolve_intent()` normalizes a hint → known intent (`intents.py:194-200`).
- **Per-turn slice already IS state-derived along two axes** --
  connector `operations.py:2372-2401` `_intent_drop_set(intent, has_trace,
  has_open_playbook)`:
  - triage → drops `_BUILD_ONLY_TOOLS`.
  - build → drops `TRIAGE_ONLY_TOOLS`; also `build_playbook_from_trace` if
    `!has_trace`; also **`ENHANCE_ONLY_TOOLS` if `!has_open_playbook`**.
- **State predicates** (`operations.py`): `_session_has_trace()` (2449-2461, reads
  `storage.get_session_trace()`), `_entity_has_open_playbook()` (2437-2446, reads
  `entity.playbook_yaml`). Both fail-open (return True on error).
- **Slice assembly:** `_tools_for_persona()` (`operations.py:2404-2417`) -- a Key
  Store persona allowlist WINS; otherwise apply the intent drop-set. Called at
  dispatch `operations.py:3487-3490`.
- **Slice constants:** `BUILD_ONLY_TOOLS` (`intents.py:29-44`), `TRIAGE_ONLY_TOOLS`
  (mutable, extended by connector registry, `intents.py:75-78` +
  `fsr_soc_triage/registry.py:116-121`), `ENHANCE_ONLY_TOOLS ⊂ BUILD_ONLY_TOOLS`
  (`intents.py:55-57` = `{verify_enhancement, emit_enhancement_offer}`).
- **Parity guard:** `tests/test_intent_tool_scoping.py:75-123` asserts framework
  `BUILD_ONLY_TOOLS ⊆` connector `_BUILD_ONLY_TOOLS` (drift catcher).

### What's already fixed (do NOT redo)

- ✅ **`emit_enhancement_offer` / `verify_enhancement` leak into the create slice.**
  `ENHANCE_ONLY_TOOLS` is dropped from the build slice when `!has_open_playbook`
  (`operations.py:2399-2400`). **Implemented + locally validated** (framework
  `08503d1` / connector `b065188`) but **NOT yet released/shipped to a box** --
  needs `make release` + `bump-framework` + `make ship`, then confirm on
  gpt-4.1-mini via `eval_s3` create arm. See `enhance_tools_leak_into_create_slice`.
  Two residuals it leaves open, folded into this plan's Phase 2:
  - the **resume** call site (~`operations.py:5051`) still defaults
    `has_open_playbook=True` (drift is at turn-start, not resume -- but a
    state-derived frontier should cover resume uniformly);
  - `emit_patch_proposal` is left **ungated** though it also targets an open
    playbook (candidate for the same frontier gate).
  (Residual beyond that: the *widget* still latches `uiIntent`, and 41mini can
  still narrate its way toward enhance in prose -- see gaps below.)

### The real remaining gaps

1. **The intent is latched at the widget, not derived from state.** `uiIntent` is
   page-pinned (`view.controller.js` `buildPlaybookFromTriage` latches
   `uiIntent='build'`; `newConversation`/`_switchToSession` reset the handoff flag
   but 4f made only the *reset* escapable, not the *model*). A record-action turn
   that interleaves triage↔author still fights the pin.
2. **Two intents can't express the real work.** Analyst flow is
   read→hunt→author→tweak-record→enhance, continuously. `build` vs `triage` is a
   binary over a spectrum. `create` vs `enhance` is already split *only* by
   `has_open_playbook`; record-edit is bolted onto both via
   `_host_record_write_profile`. There is no first-class "the slice = whatever the
   current state affords."
3. **No per-turn re-derivation of disposition.** Prompt disposition (plan/explain
   vs act) is prompt-latched by intent, not recomputed from state each turn like
   Cursor's Ask/Agent.
4. **No test exercises an interleave.** All `scripts/scenarios.json` + T1 arcs are
   single-purpose (STATUS 4f follow-up #3). None cross a triage→author→record-edit
   boundary in one session.

---

## The page IS the intent prior (key asset)

Unlike a generic chat app, we are **embedded** -- the widget always knows the page
it's mounted on, and that is a strong, free, reliable signal of what the user
wants. This beats a per-turn LLM classifier: it's deterministic, zero-latency,
zero-cost, and correct by construction (a user on a playbook page is far more
likely authoring; a user on an alert drawer is triaging).

What the page already tells us (widget → connector, per turn):
- `enableFor` / mount context -- which module/view the widget is embedded in
  (alert drawer, playbook edit page, ZTPF device, generic record).
- `entity.module` + record type -- the module being worked, drives
  `_host_record_write_profile` scoping.
- `entity.playbook_yaml` -- presence ⇒ an open playbook (already the
  `has_open_playbook` signal).
- `uiIntent` -- the widget's current mode (today: latched).

**The design correction is not to stop using the page -- it's to demote the page
from a hard, one-way LATCH to a soft, overridable PRIOR.** The page sets the
*default disposition and starting frontier*; conversation state expands or shifts
it per turn. This is Cursor's Ask/Agent model with a better default source: their
mode is user-selected each time; ours is **inferred from where the user already
is**, then adjustable by what they say next.

Concretely: on a playbook page the default is authoring (compile/verify/push
afforded, disposition = act-on-explicit-change); the user asking "why did alert
X's host trigger this?" mid-session must still reach triage/hunt tools **without a
page flip**. On an alert drawer the default is triage/hunt; "ok, turn this into a
playbook" must reach authoring in the same session. The page picks the prior; it
never fences off the rest.

## Proposed model: one agent, page-primed, state-derived affordances

Replace "pick an intent, latch it, drop the other slice" with "**compute the
afforded tool frontier from session+entity state every turn; the agent identity
never changes.**"

**Affordance inputs (all already exist as predicates or are cheap to add):**

| Signal | Source (today) | Affords |
|--------|----------------|---------|
| **page / mount context** | `enableFor`, `entity.module`, view | **sets the default disposition + starting frontier (the prior)** |
| `has_open_playbook` | `_entity_has_open_playbook` | enhance/verify/patch tools |
| `has_trace` | `_session_has_trace` | `build_playbook_from_trace` |
| `record_mounted` (module) | `entity.module` | record read; record write (its module only) |
| `hunt_evidence_met` | Investigation state (`_loop_helpers`) | containment/action cards |
| `authoring_active` | open YAML doc in session | compile/validate/dry-run/push |

The slice is the **union of afforded frontiers**, minus safety gates (tier-3
approval unchanged). The **page context seeds the frontier + disposition** (the
prior); the other signals expand/shift it per turn. Intent becomes a **disposition
hint** (bias the prompt toward plan vs act), not a hard tool wall -- Cursor
Ask/Agent, but with the page picking the default instead of the user.

**Invariants preserved from prior fixes (must not regress):**
- Safety never comes from tool *absence* -- write tools stay tier 3 /
  `confirm_mode="approve"`, `_write_gate` still refuses with no active persona
  (4f). Broadening reach ≠ loosening the gate.
- Persona allowlist still WINS over the computed frontier (`_tools_for_persona`).
- Framework⊆connector parity guard stays green.
- Every list-drift assertion pattern (containment keywords ⊆ enrichment tokens,
  etc.) -- same discipline for any new frontier set.

---

## Phases

### Phase 0 -- Prove the failure, cheaply (no code) -- ✅ DONE 2026-07-25
- [x] Built the **interleave scenario** the suite lacked: one session, record
  mounted → triage → hunt → "author a playbook for this" → "change the record's
  type" → "now enhance that playbook." Two artifacts:
  - **Deterministic oracle** (zero LLM): `tests/test_interleave_oracle.py`. Models
    the arc's per-turn `needs` × evolving `(has_trace, has_open_playbook)` state,
    resolves the slice through the REAL connector `_tools_for_intent` (with
    `register_triage_tools()` for faithful hunt tools).
  - **Live counterpart**: `interleave_triage_author_enhance` in
    `scripts/scenarios.json`, drivable via `local_turn.py`/`prompt_loop.py`
    `--llm frank` for the real-model demonstration.
- [x] Captured where the latch bites (run the oracle `-s`):
  - **triage latch** (incident mount, page prior) starves the **author** turn
    (`build_playbook_from_trace`, `compile_yaml`, `verify_playbook`) and the
    **enhance** turn (`verify_enhancement`, `emit_enhancement_offer`);
  - **build latch** starves **triage/hunt** (`get_record`, `run_op`,
    `emit_action_card`).
  → `test_no_single_latch_serves_the_interleave_arc` is a STANDING proof no
  single latch suffices; `test_interleave_arc_fully_served` is the **regression
  oracle** -- `xfail(strict=True)` today, flips green when Phase 2 repoints its
  `_session_surface` seam at `afforded_tools(state)` (strict xfail then forces
  removing the marker). Record-edit (turn 4, `update_record`) is `may_write`-
  gated, orthogonal to the slice -- noted in the arc, covered by
  `test_record_write_reach.py`.

### Phase 1 -- Demote the page latch to a page PRIOR (small, high-value)
- [ ] Keep the page as the **default** disposition/frontier source (it's our best
  signal) but stop it from **fencing off** the other slice. `uiIntent` becomes a
  page-derived *prior* passed to the connector, not a hard wall: the widget sends
  the page context; the connector's state-derived frontier decides reachability.
  `_defaultIntent()` already seeds from the page on nav/new/switch (4f) -- the
  change is that an authoring ask inside a triage session (or vice-versa) doesn't
  require a page flip to reach the tools.
- [ ] Widget tests: jest for the intent-hint plumbing; a live-sweep row that
  interleaves (converts unit-proven → proven-through-the-widget -- the recurring
  gap, cf. STATUS 4g #6).

### Phase 2 -- State-derived frontier in the connector (the pivot) -- ✅ DONE 2026-07-25 (oracle-directed)
Scope decision (user): **oracle-directed**, not full symmetric union. The
triage-prior→author/enhance direction (what the oracle tests) is unwalled; the
build-prior→triage direction stays walled (Track C5's containment-in-authoring
guard) until Phase 3's disposition prompt exists to replace tool-absence with
prompt-focus. Both the oracle AND the C5 scoping test stay green.
- [x] Introduced `_afforded_drop_set(prior, *, has_trace, has_open_playbook,
  authoring_active)` -- the plan's `afforded_tools(state)`, expressed as the DROP
  set (drop = registry − afforded frontiers). `_intent_drop_set` is now a thin
  caller (`operations.py`). Intent = a PRIOR that seeds the frontier, no longer a
  one-way latch. Two sub-frontiers of `_BUILD_ONLY_TOOLS`: `_authoring_core_tools`
  (compile/validate/verify/push/… -- un-dropped when `authoring_active`) and
  `_enhance_frontier_tools` (`ENHANCE_ONLY_TOOLS` + `emit_patch_proposal` --
  un-dropped when `has_open_playbook`). `build_playbook_from_trace` un-dropped
  when `has_trace`.
- [x] `authoring_active` predicate (`_authoring_active(has_trace,
  has_open_playbook)` = trace ∨ open-playbook) -- the signals available at
  dispatch WITHOUT a per-turn prior. Additive param defaulting **False**, so every
  bare/introspection call is byte-identical to the pre-Phase-2 slice. Wired at
  both dispatch sites (chat turn + resume) through the `_advertised_tools` seam.
- [x] Tests: `tests/test_afforded_frontier.py` (composition + safety). Safety
  invariant landed as **"broadened reach exposes nothing the build prior didn't
  already trust"** (`newly_reached ⊆ build_slice`) + record writes stay tier-3
  `approve` (may_write-gated, not sliced) + no mutating playbook tool is
  auto-run -- a more honest guard than a raw tier<3 check (the real mutators
  `push_playbook`/`run_playbook` are tier-`-1` dynamic/step-up, and the tier-0
  `emit_*` tools only emit a HITL card). Caught + fixed a real over-reach:
  `run_playbook`/`resume_playbook` are persona-allowlist-only (in BOTH build- and
  triage-only sets), so `_authoring_core_tools` subtracts `TRIAGE_ONLY_TOOLS`.
- [x] **Phase 0 interleave oracle GREEN**: `test_interleave_arc_fully_served` no
  longer xfails; the standing proof (`test_no_single_latch_serves…`) still shows
  the latch bites. Full connector+triage suite: 532 passed, 1 skipped.
- [x] **SHIPPED to 159 + PROVEN LIVE 2026-07-26** -- connector **0.5.23** (all 6
  workers verified on-version). Drove `interleave_triage_author_enhance` through
  a real `chat_turn` on `fsrpb-41mini` (gpt-4.1-mini). Per-turn tool calls
  (`exports/loop-interleave…json`):
  - turn 3 "author a playbook" (session `intent=triage`) reached
    **`emit_playbook_offer`** -- a build-only authoring tool the pre-Phase-2
    triage latch dropped. **The core claim, proven live.**
  - turn 4 "change the record type" reached `update_record` →
    `approval_required` (write reachable AND tier-3 gated).
  - turn 5 "enhance that playbook" correctly got NO enhance tools --
    `has_open_playbook=False` because nothing was saved -- the gating half also
    holds.
  - bonus: turn 1 called `mcp_soc__get_indicators_linked_to_an_alert` (native
    SOC MCP gateway) through the freshly-shipped `_advertised_tools` seam.
  - ⚠️ **Env gap, not a frontier bug:** 159 has no `fortinet-fortisiem`
    connector, so the hunt op failed → no trace → turn 3's offer hit
    `empty_trace` → nothing saved → the save→enhance chain couldn't close. For a
    clean end-to-end demo, use a scenario whose hunt hits a connector installed
    on 159 (FortiEDR/FMG/FAZ). The reachability Phase 2 is about is proven; only
    the content chain was starved by the missing connector.
  - Ship friction fixed: `.env.159` now sets `FSR_BUILDER_CONFIG_NAME=fsrpb-41mini`
    (159 has no `fsrpb-live`, so `make ship`'s worker-verify probe was 400ing).
- [ ] `record_mounted` predicate -- deferred: record writes are already
  may_write-gated via `_host_record_write_profile`, orthogonal to the slice, so
  not needed for the oracle. Fold in with the build→triage direction under Phase 3.

### Phase 3 -- Disposition from state, not just intent
- [ ] Prompt disposition (plan/explain vs act) recomputed per turn from state
  (e.g. "open playbook + user asked to change it" → act; "ambiguous ask" → plan),
  the Cursor Ask/Agent behavior. Guard against over-acting on write paths.

### Phase 4 -- (defer) scale the frontier
- [ ] Only if the catalog outgrows a static union: RAG/graph tool retrieval
  (SING/MemTool). Not needed at current tool count; note and move on.

---

## Workstream M -- MCP consumption, proven (north-star goal #2)

Runs parallel to the phases above; shares the frontier machinery (Phase 2). The
demo needs the assistant to use **native SOAR MCP gateways** and **external MCP
servers**, surfaced **per page**, proven live.

### Current state (grounded 2026-07-25)
- **Materializer** (`fsr_playbooks/mcp_server/materializer.py`) enumerates via
  `client.mcp.list_tools(server)` / `call_tool(server, name, args)`; `configure()`
  takes `mcp_allowlist = {server: {"tools": "*"|[...], "tier": "read_only"|
  "mutating"}}` (also `FSRPB_MCP_ALLOWLIST` env). Tool names =
  `mcp_<server>__<tool>` (`_make_name`, :295-311). Registered into the module-level
  `REGISTRY` at session start via `_ensure_mcp_materialized()`
  (`fsr_playbooks/llm/tools.py:979-989`); dispatch tier-gates (tier-3 → approval
  card, `:1027-1100`).
- **Servers are a hardcoded set** -- `soc`, `modules`, `playbooks`, `utility` +
  `connector:<name>` (materializer :15, `_live_mcp.py:35-40`). **No list-servers
  discovery** -- allowlist keys are hand-entered by the admin.
- **Gateway is on-appliance only** -- pyfsr `_url_for(server)` = `{base_url}/mcp/
  {server}/` (`pyfsr/api/native_mcp.py:300-301`); on-box CS-HMAC wrapper hardcodes
  `http://localhost:8010` (`_live_mcp.py:31`). Auth: CS-HMAC / bearer / api-key
  (`soar_api_key`), already built + live-proven consuming `soc` on 159
  (`enable_native_mcp_in_soc_chat`).
- 🔑 **External support is a MODEST add, not a rebuild:** pyfsr ALREADY exposes
  `list_tools_at(url, headers)` / `call_tool_at(url, headers, ...)`
  (`native_mcp.py:345-380`) -- the materializer just never calls them.
- ⚠️ **MCP tools are ALWAYS-ON when allowlisted -- zero page/intent slicing.** They
  enter the full REGISTRY and are offered to every turn regardless of page. This is
  the direct conflict with goal #1 (per-page native feel).

### M1 -- External MCP server support (small) -- ✅ CODE DONE + LOCALLY LIVE-PROVEN 2026-07-25
- [x] Allowlist rule extended `{server: {url?, auth?, tools, tier, verify?}}`.
  When `url` present the materializer branches to `list_tools_at`/`call_tool_at`
  with per-server headers (`materializer.py` `_auth_headers` + external branch;
  bearer / api_key / custom-header / raw-headers shorthands).
- [x] **No connector config-field change needed** -- `_apply_mcp_allowlist`
  (`operations.py:350`) already `json.loads`es the `mcp_allowlist` textarea and
  passes the whole dict through; an operator just writes richer JSON. (Secrets
  live in that textarea today like the rest of the allowlist; a dedicated
  ciphertext cred field is a future hardening, not required to function.)
- [x] On-box adapter gap CLOSED: `_live_mcp._CrudhubMCP` gained
  `list_tools_at`/`call_tool_at` + a shared `_session_call` core (external path
  bypasses CS-HMAC, uses the rule's own headers, `verify` defaults True). Added
  `follow_redirects=True` -- caught a real bug (external FastMCP servers 307 on
  trailing slash; on-box httpx wasn't following it).
- [x] Tests: framework 37 materializer (10 new external) + connector 6 new
  (`test_live_mcp_external.py`); all green. **LIVE-PROVEN** against a real
  FastMCP streamable-HTTP server, both off-box (pyfsr `NativeMCPApi`) and on-box
  (`_CrudhubMCP`) transports -- `scratchpad/live_ext_mcp.py`,
  `scratchpad/live_onbox_ext_mcp.py`.
- [ ] **Remaining = the box proof (folds into M3):** release framework + ship
  connector, then drive a real turn on a box that lists+calls an external MCP
  server end-to-end. Needs user release intent + an external server reachable
  from the box.

### M2 -- Per-page MCP surfacing (folds into Phase 2 frontier)
> **Live test-bed (2026-07-26):** FortiSIEM (`10.99.248.120`) is now on 159 BOTH
> ways -- the `fortinet-fortisiem` REST connector (v6.0.0, healthcheck Available)
> AND its native MCP server wired into `fsrpb-41mini`'s `mcp_allowlist` (agent
> called `mcp_fortisiem__get_incidents_by_entity` live). Both surfaces are
> advertised at once with no arbitration → the exact overlap M2 must resolve.
> Repeatable scripts: `configure_fortisiem.py` + `wire_fortisiem_mcp.py`. Working
> recommendation: connector = default frontier (typed args, tier-gated writes,
> approval cards); MCP = additive/on-ask breadth; connector wins for mutations.
> See memory `fortisiem_dual_surface_159`.
**Design decision (user, 2026-07-26): optimize for DETERMINISTIC + demo-ready.**
Two pure `state → set` filters over the materialized surface, both computed in
the `_advertised_tools` seam so the per-page tool set is repeatable and testable
offline (a "surfacing oracle", same discipline as `test_interleave_oracle`). No
prompt-hope, no model-dependent arbitration.

#### The model: the per-module persona IS the per-page config

`page` and "which persona is active" are the same signal -- `_resolve_profile(
module, session)` already maps the mounted module → its persona every turn. So
per-page surfacing needs **no new page-tag field**; it falls out of persona
resolution. Two config layers ("both", via existing machinery):

- **Static defaults (connector, versioned)** -- an *affordance-class* map keyed by
  `triage/hunt | author | record | device` → `{curated tools, MCP servers
  surfaced, curated↔MCP capability map}`. Lives next to `SOURCE_TOOLS`
  (`fsr_soc_triage/triage_sources.py`). Covers modules with NO custom persona
  (built-in triage/build still get the right default surface). The affordance
  taxonomy reuses the Phase-1 page-prior classes.
- **Key Store persona override** -- extend the existing per-module persona schema
  (`fsr_assistant_profile:<module>`) with an optional `mcp` / `capabilities`
  block; a custom persona overrides/extends the static default. Same
  `_resolve_profile` read already done per turn, same upsert scripts operators
  already use. **The `mcp_allowlist` connector config keeps holding _what's
  connected + creds_; the Key Store holds _how it surfaces per module_** -- clean
  split, no second secret-bearing config surface.

> **STATUS 2026-07-26 -- M2 (a) + step 4 BUILT, SHIPPED conn 0.5.25 to 159, offline-green.**
> Deterministic core + persona composition all landed and unit-proven (full suite
> 549 passed / 1 skipped). **Live per-page demo is the only open piece and is
> BLOCKED by a 159 box outage** -- the FortiSOAR custom-route frontend is down
> (ports **13000 API + 11000 admin-SSH both refuse**; VM up on stock 22/443), so
> fresh 0.5.25 workers can't materialize external MCP nor reach the LLM. Re-run
> the demo when the box service layer is restarted. See memory
> `resume_2026_07_26_fortisiem_and_m2`.

#### The two deterministic filters (run after materialization)

- [x] **Server surfacing** -- keep only MCP servers in the active surface (from the
  persona/affordance default). Off-surface servers are dropped. *Page-determined
  now; on-ask reach is a fast-follow (Phase-M2.1) -- page tags are generous enough
  (e.g. fortisiem → all triage/hunt contexts) that the long tail lives on-page.*
  DONE: `apply_server_surfacing` in `fsr_soc_triage/triage_sources.py`
  (`AFFORDANCE_SERVERS` + `MODULE_AFFORDANCE`; unmapped module ⇒ unrestricted).
- [x] **Capability-dedup** -- collect capabilities covered by the CURATED tools on
  this surface; drop any MCP tool sharing a capability (**curated wins by
  construction**). MCP tools with no mapped capability = MCP-only → always kept
  (fail-open toward reach). The curated↔MCP capability map is static (base) +
  Key-Store override. DONE: `apply_capability_dedup` + `CAPABILITY_DEDUP` base
  map, persona override merged via `_effective_dedup`.

Worked example (FortiSIEM test-bed):

| Page (module→persona) | Curated | MCP kept | MCP dropped |
|---|---|---|---|
| Alert / incident | `siem_search_host/ip/user`, `faz_*` | `query_fsm_postgres` (no curated peer) | `get_incidents_by_entity` (dedup'd) |
| Playbook | authoring tools | -- | fortisiem not in this surface |
| Generic record | -- | `modules` MCP | fortisiem not in this surface |

#### The one real code fork -- persona allowlist: replace → COMPOSE

Today `_tools_for_persona` returns ONLY the persona's `tools_allow` and skips the
frontier entirely (allowlist WINS). For MCP surfacing to work under a persona, the
persona path must **compose** `tools_allow ∪ afforded-MCP-for-this-surface`
instead of replacing -- so a persona doesn't have to re-list every MCP tool by
name. Decision: **compose.** (Preserve the existing safety: writes stay tier-3/
approve; the compose only widens the READ/afforded MCP surface.)
DONE: `_tools_for_persona` allow-path now returns `tools_allow ∪ all mcp_*`; the
surfacing filters then narrow the MCP set per page. Persona MCP block lives under
`jSONValue.mcp` (`PersonaMcp`: `servers`, `capability_dedup`), NOT under the
existing `capabilities`/grounding field (avoided the name collision).

#### Deliverables
- [x] Affordance-class static map + curated↔MCP capability map (connector,
  beside `SOURCE_TOOLS`). -- `triage_sources.py`.
- [x] Persona schema `mcp`/`capabilities` block + `_resolve_profile` plumbing;
  `_tools_for_persona` compose (not replace). -- `profiles.py` `PersonaMcp` +
  `_parse_persona_mcp` + lint; `ResolvedPersona.mcp_servers/.mcp_capability_dedup`.
- [x] `_advertised_tools` gains the two filters (server-surface + capability-dedup),
  keyed on the resolved persona/affordance -- pure functions of state. Threaded
  `module=` at all 3 turn-like callsites (chat_turn/resume/list_agent_tools).
- [x] **Surfacing oracle** (`test_surfacing_oracle.py`): per-module advertised set
  is pinned; assert no capability appears twice (curated + MCP) on any surface.
  14 tests, grounded in the live inventory (deepwiki 3 / fortisiem 20 / soc 9).
- [ ] Demo: drive one session per page type on 159, show the surface differs.
  **BLOCKED -- 159 box outage (13000/11000 down). Re-run when restored.**
  Also then: verify one unreachable server (deepwiki/internet) doesn't poison
  on-box `soc` + internal `fortisiem` materialization; fill real authoring module
  name in `MODULE_AFFORDANCE` (currently guessed `workflows`).
- [x] Demo: DONE 2026-07-26 on 159 (after box recovered from reimage). Per-page
  surface differs live: module=None→{deepwiki,fortisiem,soc}; alerts→{fortisiem,
  soc}; workflows→{deepwiki}. (Warm fresh workers with a few chat_turns first --
  they show 0 mcp off-turn.) All 3 servers re-wired; soc `soar_api_key` minted
  via pyfsr `api_keys.ensure_usable`.
- [x] **COMMIT** -- M2 (a)+(4) shipped as connector 0.5.26, committed `d8a6e44`.
- [x] *(fast-follow M2.1)* SHIPPED as connector **0.5.27** (`b6adbfb`), offline-green
  (560 passed). **On-ask reach**: `chat_turn`/`list_agent_tools` take `reach_servers`
  -- server keys unioned into the page's default surface for that turn (deterministic,
  keeps the lean default). **`list_mcp_servers` op**: enumerates materialized MCP
  servers + tools annotated on/off a module's surface + configured allowlist keys.
  ⚠️ **On-box verify BLOCKED** -- box 159 in `FSR-Auth-018` duplicate-license lockout
  post-reimage (all API auth 403s); build made the 0.5.27 tarball but install
  couldn't complete. Re-verify + run the list_mcp_servers demo once a unique
  license is deployed. Note: the agent's own on-ask reach still needs a
  widget/model signal to pass `reach_servers`; a framework-level "call any
  materialized tool" escape hatch (M2.2) remains a separate, framework-release item.

### M3 -- The proof (demo-grade, on a box)
- [x] **External path proven end-to-end with editable code through the REAL
  on-box seam** (2026-07-25): a connector CONFIG carrying
  `{"partner": {"url": ..., "auth": {"bearer": ...}}}` → the connector's real
  `_apply_mcp_allowlist` → the real `_CrudhubMcpClient` adapter → a LIVE external
  FastMCP streamable-HTTP server → `mcp_partner__lookup` materialized into the
  LLM tool surface (`anthropic_tools()`) → executed through the connector's real
  `dispatch` → `PARTNER-DB-HIT:foo`. Only the appliance host itself is not
  involved. `scratchpad/proof_ext_mcp_onbox_seam.py` (run with `FSRPB_DEV=1`,
  dev-pyfsr on path). Also confirmed: one unreachable server (soc w/o creds
  here) does NOT abort the rest.
- [x] **PROVEN ON THE ACTUAL APPLIANCE (GA 159), demo-grade, 2026-07-25.**
  framework `0.5.2` (PyPI) + connector `0.5.22` deployed to 159 via
  `deploy.sh --box 159`. Real `chat_turn` on `fsrpb-41mini` (gpt-4.1-mini):
  the LLM autonomously called `mcp_deepwiki__read_wiki_structure` from DeepWiki's
  PUBLIC external MCP server over the internet, got real data, clean
  `{'result':…}` envelope. See `external_mcp_m3_proof` memory.
  ✅ **follow-up CLOSED (2026-07-25):** the three turn-like dispatch sites (chat
  turn, resume, `list_agent_tools` introspection) now route their tool-surface
  computation through ONE seam -- `operations._advertised_tools(config, persona,
  *, has_trace, has_open_playbook, include_mcp)` -- which applies the
  `mcp_allowlist` then slices, so `mcp_*` materialization can't drift between
  paths. The real bug this surfaced: **resume never called `_apply_mcp_allowlist`
  at all** (it relied on a prior same-worker turn having initialized the
  materializer) -- now applied at resume entry, before the pre-model approved-card
  dispatch. Regression pins in `tests/test_list_agent_tools.py`
  (`test_list_agent_tools_surfaces_materialized_mcp_tools` +
  `test_advertised_tools_is_the_only_dispatch_seam`). **SHIPPED to 159 in
  connector 0.5.23 (2026-07-26) and exercised live** -- the interleave arc's
  turn 1 called `mcp_soc__get_indicators_linked_to_an_alert` (a native SOC
  gateway tool) materialized through this seam on the deployed connector. This
  seam is the natural insertion point for Phase 2's `afforded_tools(state)`.
- [ ] **Per-page:** show the offered MCP tool set differs by page (soc on alert,
  modules on a generic record) -- the goal-#1 × goal-#2 intersection (needs M2).
- [ ] **Follow-up (real finding):** external MCP tools returning a BARE STRING
  trip the connector's tool-output contract (`must be a dict envelope`;
  fail-open so it still works). Native `soc` tools return dicts and don't hit it.
  Wrap MCP scalar results in `{"result": ...}` in the materializer's `_make_fn`.

---

## Non-goals / explicitly rejected
- ❌ Separate build/triage **agents** or handoffs -- we share user/record/session;
  adds latency + debugging surface for no ownership benefit (OpenAI SDK's own
  guidance).
- ❌ Per-intent **model routing** -- dropped by the user (see
  `model_agnostic_tool_robustness_direction`); harden the tool, support most
  models, primary loop = Frank local.
- ❌ Loosening tier-3 approval to "make interleave smoother." Reach ≠ gate.

## Open questions
- Does `authoring_active` need a session flag, or is `has_open_playbook ∨
  last_turn_emitted_yaml` sufficient? (Check `case_state` for an existing signal
  before adding one.)
- Should the disposition hint be surfaced in the widget (a soft "planning /
  acting" chip) so the user sees why a tool did/didn't run? (UX, defer to Phase 3.)

## References (code)
- framework `fsr_playbooks/llm/intents.py:22-78`, `:194-200`
- connector `operations.py:2372-2417` (`_intent_drop_set`, `_tools_for_persona`),
  `:2437-2461` (predicates), `:3487-3490` (dispatch)
- connector `fsr_soc_triage/registry.py:116-121` (triage frontier extension)
- connector `tests/test_intent_tool_scoping.py:75-123` (parity guard)
- widget `view.controller.js` (`buildPlaybookFromTriage`, `_defaultIntent`,
  `uiIntent` latch)
