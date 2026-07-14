# Plan: Module-scoped assistant personas (Key Store–defined)

**Status:** Phases 1 + 2 DONE (all tests green). **Phases 0 + 3 connector-side
LIVE-PASSED on 8.0**, and **connector v0.4.49 DEPLOYED + healthy on box 206**
(ztpf modules present; persona authored + resolving live). ONE gap left: the full
agentic turn (→ create_record approval card) needs an LLM endpoint 206 can reach —
its default Frank gateway is unreachable; 206 CAN reach api.anthropic.com /
api.openai.com, so it needs an ANTHROPIC_API_KEY (or real OpenAI key). Code is
UNCOMMITTED. See "Progress" + "Resume checklist" below.
**Owner memory:** `custom_module_agentic_assistant_plan` (auto-memory) — box-specific
domain facts (the `ztpf_*` modules, live schema) live there; this doc is the
implementation plan and is box-detail-free.

## 1. Goal & maintenance model

Let the agentic assistant carry a **per-module persona** — its own system prompt
and its own tool subset — so that, mounted on a given module, it helps **create
records** and author domain-specific playbooks instead of doing alert triage.
First driver: the ZTPF config-authoring modules (`ztpf_templates` et al.).

**Division of labor (the whole point — no connector edits for end users):**
- **We (devs)** ship the full tool catalog once, in the connector.
- **A user/admin** defines a persona by creating **one Key Store record** in the
  FortiSOAR UI: the system prompt goes in a text field, the allowed-tool list in a
  JSON field. No code, no custom module, no deploy.
- **The connector** reads that record at turn time and (a) uses the prompt as the
  base system prompt, (b) narrows the tool surface to the allowlist, (c) gates
  record writes to the declared modules.

Backward compatible: when the mounted module has **no** persona record, triage and
build behave exactly as today.

## 2. Data contract — Key Store (`keys` module)

`keys` schema (verified on a live 8.0 box): `key:text`, `value:textarea`,
`jSONValue:object`, `notes:text`. Key Store values are **not required to be
secret** (user-confirmed) — `value` round-trips as plaintext.

**Convention: one entry per module.**

| field | holds |
|---|---|
| `key` | `fsr_assistant_profile:<module>` (e.g. `fsr_assistant_profile:ztpf_templates`) |
| `value` | the system prompt (plaintext) |
| `jSONValue` | `{ "tools": {"allow": [...]}, "may_write": [...], "bind_modules": [...], "version": 1 }` |
| `notes` | human description |

Semantics:
- `tools.allow` — exact tool names the persona may use. Enforced: `_tools_for_intent`
  intersects the REGISTRY with this list. (Optional `tools.deny` later; `allow`
  is sufficient for v1.)
- `may_write` — modules `create_record`/`update_record` may target. Empty/absent ⇒
  no writes allowed (read-only persona).
- `bind_modules` — extra modules this same persona applies to (so one prompt can
  serve `ztpf_templates` + `ztpf_automation_actions`). Lookup tries
  `fsr_assistant_profile:<module>` first, then any entry whose `bind_modules`
  contains the mounted module.
- `version` — contract version for forward-compat.

## 3. Current selection mechanism (what we hook into)

All connector-side. Paths are absolute for post-`/clear` reference.

Connector `…/connector-fsr-soc-assistant/operations.py`:
- `_resolve_system_prompt(intent, entity, storage, session_id, turn_idx, user_message, quick_action)` — **operations.py:2011**. Picks the base prompt. `entity["module"]` is
  *available here* but unused for selection today.
- `_tools_for_intent(intent)` — **operations.py:1961** → returns `anthropic_tools()`
  filtered by `_BUILD_ONLY_TOOLS` (**1854**) / `TRIAGE_ONLY_TOOLS`.
- `_load_prompt(intent)` + `_PROMPT_CACHE` — **1931 / 1875** (bundled `.md`, cached).
- `_resolve_intent(params)` — **1910** (`intent ∈ {triage,build}`, else `build`).
- `chat_turn(config, params)` — **2346**; resolves intent **2356**, entity module
  **2399**, calls `_resolve_system_prompt` **2458**, passes `tools=_tools_for_intent(intent)`
  into `run_agent_turn` **2522–2526**. (Streaming twin around **3473/3529**.)

Framework `…/fsr-playbook-framework/fsr_playbooks/llm/`:
- `class ToolSpec` — tools.py:526; `REGISTRY = build_registry()` — tools.py:809;
  `anthropic_tools()` — tools.py:825; `dispatch(...)` — tools.py:851;
  `TOOL_TIERS` + `_resolve_tier(name,args)` — tools.py:95 / ~294 (tier ≥ threshold ⇒
  `pending_approval` envelope → widget approval card → resume re-calls with token).
- `TRIAGE_ONLY_TOOLS` — intents.py:56 (mutable set; connector extends it).

Tool registration pattern — connector `fsr_soc_triage/registry.py`:
- `register_triage_tools()` — registry.py:58; tool-name list `_TRIAGE_TOOL_NAMES`
  — registry.py:37; each becomes `REGISTRY[name] = ToolSpec(..., tier=_TIER, ...)`
  with `input_schema = TOOL_SCHEMA_OVERRIDES.get(name) or _build_schema(fn)` and
  `fn = _validating(name, fn)` — registry.py:95–102. `_TIER = 1` (registry.py:30).

On-box transport — connector `fsr_soc_triage/_live_crudhub.py`:
- `get_client()` — _live_crudhub.py:183 → `CrudhubLiveClient` with `base_url=""`,
  `client.session.get/post(path,…)` and `client.post(path, body)` →
  `integrations.crudhub.make_request(path, METHOD, body=…)` (the authenticated
  in-process loopback). This is how reads AND writes reach `/api/3/...` on-box.
  Dev/CLI path resolves a `.env` pyfsr client via `probes._env.get_client`
  (operations.py ~160–253 wires sim vs `_live_crudhub` vs real probes).
- Read helper `_get_with_reauth(client, url)` — tools_triage.py:669–697; `get_record`
  (tools_triage.py:738) and `search_module_records` (~547) show the exact GET idiom.

## 4. New components

### 4.1 `ProfileRegistry` + Key Store loader (connector)
New module `fsr_soc_triage/profiles.py`:
- `load_profile(client, module) -> Profile | None` — `GET /api/3/keys?key=fsr_assistant_profile:<module>&$limit=1` via `_get_with_reauth`; if none, query
  entries and match `jSONValue.bind_modules`. Parse into a typed `Profile`
  (pydantic — per `feedback_typing_pydantic_solidify_structure`): `prompt: str`,
  `tools_allow: list[str]`, `may_write: list[str]`, `bind_modules: list[str]`,
  `version: int`.
- Per-session cache keyed by `(session_id, module)` in `storage` (mirror the
  case_state grounding cache used at operations.py:2051), so we hit the Key Store
  once per session, not per turn.
- Defensive: any parse/read error ⇒ return `None` ⇒ fall back to triage/build
  (never break a turn on a malformed persona record; surface a one-line activity note).

### 4.2 Wire the two seams (connector `operations.py`)
- In `_resolve_system_prompt`: before the intent branch (2035), if `entity.module`
  resolves a `Profile`, use `profile.prompt` as the base. Decide whether persona
  prompts also run the triage grounding preflight (default: **no** — persona prompt
  is authoritative; a persona can opt in via `jSONValue.grounding:true` later).
- In `_tools_for_intent` (or a new `_tools_for_turn(intent, profile)`): when a
  profile is active, return `[t for t in anthropic_tools() if t["name"] in profile.tools_allow]`.
  Thread the resolved profile from `chat_turn` (2458/2526) so both calls see it
  (avoid a second lookup).

### 4.3 `create_record` / `update_record` tools (connector)
New `fsr_soc_triage/tools_records.py`, registered via `_TRIAGE_TOOL_NAMES`
(registry.py:37) but tier-gated for approval:
- `create_record(module, fields: dict) -> dict` → `client.post(f"/api/3/{module}", fields)`.
- `update_record(module, uuid, fields: dict) -> dict` → PUT `/api/3/{module}/{uuid}`.
- **Enforcement:** the tool checks the active profile's `may_write` before executing
  (module not listed ⇒ `{ok:false, code:"write_not_permitted"}`). Thread the profile
  via the same session context the dispatch uses, or via a per-turn contextvar set
  in `chat_turn`.
- **Approval:** set `TOOL_TIERS["create_record"]=TOOL_TIERS["update_record"]=3`
  (or ToolSpec `tier=3`) so `dispatch` emits the `pending_approval` envelope and the
  widget renders an approval card — reuses the existing resume path, no new UI.
- Schema: add `TOOL_SCHEMA_OVERRIDES` entries (nested `fields` object) so the LLM
  gets a precise shape rather than the auto-built one.

No widget change for v1: the widget already sends `entity.module`, and the approval
card path already exists.

## 5. Phases

**Phase 0 — spike (de-risk, ~½ day).** Through the local-dev sidecar / on-box creds,
create one `keys` record by hand and confirm the connector's client reads it back:
`value` plaintext + `jSONValue` as a real object over crudhub. Confirms §2. (In-browser
`/api/3` is 403 — see `fortisoar-ui-localstorage-schema-cache` memory; use the
connector client, not the browser.)

**Phase 1 — persona selection (prompt + tool narrowing), read-only.**
`profiles.py` + wire both seams. Ship with an author persona whose `tools.allow` is
read/validate tools only (no writes yet). Verifies the machinery with zero write risk.

**Phase 2 — record writes.** `tools_records.py` + `may_write` gate + tier-3 approval.
Now "help create records" works end-to-end.

**Phase 3 — first real ZTPF persona + live drive.** Author the `ztpf_templates`
persona record on the box; drive create/validate/test of a template through the
widget drawer against the live connector.

**Phase 4 (later) — persona-specific widget UX.** Author chips + a template
test/preview pane. Out of scope for the first cut.

## 6. Testing (per project rules)
- Connector Python: pytest via **uv/editable** per `connector_test_env_uv` /
  `connector_fsr_playbooks_stale_wheel_shadows_editable` memories (never `uv run`
  that re-syncs the wheel). Unit-test `profiles.load_profile` (parse, bind_modules
  fallback, malformed → None), the tool-narrowing filter, and `create_record`
  `may_write` enforcement with a fake client.
- Selection regression: with NO persona record, `_resolve_system_prompt` /
  `_tools_for_intent` outputs must be byte-identical to today (guard backward-compat).
- Live: Phase 3 drives the real box (mirrors the live-sweep discipline).

## 7. Risks / open items
- **Profile write context threading.** `create_record` must see the active profile's
  `may_write` at dispatch time. Cleanest: a per-turn contextvar set in `chat_turn`
  and read by the tool fn. Confirm dispatch runs in the same context (it does —
  `asyncio.run` in-thread at operations.py:2522).
- **Persona vs. grounding.** Default: persona prompt skips triage preflight. Revisit
  if authoring benefits from record-context blocks (it likely wants the
  `_entity_context_block` at operations.py:752 folded into the first user message —
  keep that; it's independent of prompt selection).
- **Tool-name drift.** `tools.allow` lists names that must exist in REGISTRY. Add a
  load-time validation that logs unknown names (don't hard-fail the turn).
- **Scope discipline.** Connector repo is on `dynamic-tool-surface-connector` with
  unrelated WIP — touch only new files (`profiles.py`, `tools_records.py`) and the
  two named seams; don't disturb that WIP (`feedback_dont_stash_others_wip`).

## Progress log

**Phase 1 — DONE (2026-07-14), read-only persona selection.** All connector-side,
box-independent, no writes.
- New `fsr_soc_triage/profiles.py`: `Profile` (pydantic v2, `extra="forbid"`,
  `may_write_module()` gate helper already present for Phase 2), `parse_profile_record`
  (client-free, fail-open), `load_profile(client, module)` — direct
  `key=fsr_assistant_profile:<module>` equality lookup + bounded `bind_modules`
  scan fallback. Any read/parse error ⇒ `None` (built-in behavior).
- Seams wired in `operations.py`: `_resolve_profile(module, session_id)`
  (per-(session,module) process cache, `_shared._live_client()` → `load_profile`,
  fail-open) + `_tools_for_turn(intent, profile)` (narrows the FULL registry to
  `tools.allow`, unknown names dropped). `_resolve_system_prompt` gained a
  `profile` kwarg — persona prompt is authoritative and skips triage grounding.
  Threaded through `chat_turn` (resolve once) **and** the resume path
  (`_resume_conversation` re-resolves via a new `session_module` persistence so the
  persona survives the HITL gap; grounding override guarded to not clobber a persona).
- `storage.py`: additive `session_module` table + `set/get_session_module`
  (mirrors `session_intent`).
- Tests: `fsr_soc_triage/tests/test_profiles.py` (14 — parse/bind/fail-open) +
  `tests/test_persona_wiring.py` (9 — backward-compat byte-identical slice,
  persona narrowing, `_resolve_profile` fail-open + caching). Full builder suite
  212 passed (the lone `test_warmup_hooks` fail is pre-existing + order-dependent,
  identical on the clean tree). Not committed (connector on `dynamic-tool-surface-connector`
  WIP branch — touched only new files + the named seams + additive storage).

**Phase 2 — DONE (2026-07-14), record writes.** Persona-gated, approval-carded.
- New `fsr_soc_triage/tools_records.py`: `create_record(module, fields)` (POST
  `/api/3/<module>`) + `update_record(module, uuid, fields)` (PUT
  `/api/3/<module>/<uuid>`). Both check `_write_gate` (reads the per-turn active
  persona; refuses `write_not_permitted` when no persona or module ∉ `may_write`)
  *before* touching the client. Transport via `_shared.live_request_with_reauth`
  (self-healing 401/403), works on crudhub (on-box) + pyfsr (dev).
- `registry.register_record_tools()` — registers both at **tier 3** with
  `confirm_mode="approve"` + precise nested-`fields` schema overrides, adds them
  to `TRIAGE_ONLY_TOOLS`, called from `fsr_soc_triage/__init__.py`. Tier 3 ⇒
  `dispatch` returns the `pending_approval` envelope ⇒ existing widget approval
  card + resume path (no new UI).
- Excluded from BOTH default slices (`_BUILD_ONLY_TOOLS` in operations.py +
  `TRIAGE_ONLY_TOOLS`), so they surface ONLY via a persona's `tools.allow`.
- Per-turn persona binding: `profiles.set/get/reset_active_profile` (ContextVar)
  bound in `chat_turn._run_turn`, `_resume_conversation`, AND `_resume_suspended`
  (the tier-3 approval actually executes the write there — the gate must see the
  persona). operations wrappers `_set_active_profile`/`_reset_active_profile`.
- Strict arg models `CreateRecordArgs`/`UpdateRecordArgs` (extra="forbid") in
  `pydantic_models.py`, wired into `arg_validation.TOOL_ARG_MODELS`.
- Tests: `fsr_soc_triage/tests/test_tools_records.py` (9 — gate/happy/http/reg) +
  2 more in `tests/test_persona_wiring.py` (writes excluded from default slices;
  surface only via allowlist). Suites: builder 214 passed, fsr_soc_triage 148
  passed, connector/tests 86 passed. Same lone pre-existing `test_warmup_*` issue.
  Still UNCOMMITTED.

**Phase 0 — LIVE PASS (2026-07-14) on an 8.0 GA box.** Created a `keys` record via
the box client: `value` plaintext + `jSONValue` object both round-trip; the
connector's `parse_profile_record` accepts the live record. ALSO ran the real
`load_profile` against the box — direct lookup, `bind_modules` fallback, and
unmatched→None all confirmed live. §2 is proven on-box.
- Live gotchas: the test account had CREATE/READ but not DELETE on the Key Store
  (DELETE → 403), and the ztpf_* modules were absent on that particular box.

**Phase 3 — connector-side LIVE PASS (2026-07-14) on the ZTPF 8.0 box.** Authored
the real `fsr_assistant_profile:ztpf_templates` persona (Key Store) grounded in the
box's actual `ztpf_templates` schema (name/description/script[Jinja]/inputParameters
[newline-separated]/exampleJinjaVars[data.*+input.*]/outputType[picklist IRI]). Then
drove the connector's OWN tools against real `ztpf_templates`, persona-bound:
`load_profile` resolves the persona ✓; `create_record` on `alerts` (out of scope) →
`write_not_permitted` ✓; `create_record` on `ztpf_templates` → real record ✓;
`update_record` → applied + persisted ✓; delete cleanup 204 (no residue). Persona
`prompt`/`tools.allow`/`may_write` all correct live.

**Phase 3 — DEPLOYED to box 206 (2026-07-14).** Connector v0.4.49 live, all 10
workers, health green (fsr_playbooks imports, crudhub bridge live, contract 2.8.0),
warmup catalog populated. `chat_turn` mounted on a real `ztpf_templates` entity runs
in-worker up to the LLM call (persona resolution + tool narrowing execute in the
worker context). Deploy hurdles solved: the 8.0 pip lockdown (offline wheel install
into the conn venv + a pip.conf PyPI extra-index), then `make ship BUMP=none` to
recycle workers. Details in the owner memory `custom_module_agentic_assistant_plan`.

**Remaining (ONE gap): a reachable LLM.** The turn currently fails at the model call
— 206 can't reach the default Frank/OpenAI gateway. 206 CAN reach api.anthropic.com
+ api.openai.com, so supply an `ANTHROPIC_API_KEY` (or real OpenAI key), install the
matching connector config, and re-run `chat_turn` to see the persona drive
`create_record` → `pending_approval` (approval card) → approve → record written.
That closes the widget-drawer/approval-card round-trip (the drawer just wraps this
same chat_turn/chat_resume flow).

## Resume checklist (post-/clear)
1. **Get an LLM key** reachable from 206 (ANTHROPIC preferred). Set it and
   `make ship ENV=<harness>/.env.206 BUMP=none` (installs `fsrpb-anthropic` config
   when `ANTHROPIC_API_KEY` is set), OR add the config directly.
2. **Drive the live turn:** `scripts/run.py op chat_turn --config <id> --params
   @scratchpad/chat_params.json` after `set -a; . .env.206; set +a` (run.py auto-config
   detect has a `fsr.headers` bug → pass `--config` explicitly). Expect a
   `pending_approval` create_record envelope; then chat_resume to approve.
3. **Commit + land the code** (still UNCOMMITTED on connector branch
   `dynamic-tool-surface-connector`, bumped to 0.4.49): new `profiles.py`,
   `tools_records.py`, + seams in operations.py/registry.py/storage.py/__init__.py/
   arg_validation.py/pydantic_models.py + tests. Suites: builder 214, fsr_soc_triage
   148, connector/tests 86 (lone pre-existing warmup order-dep fail).
4. **Cleanup:** delete inert spike key `fsr_assistant_profile:__phase0_spike__` on
   box 159 (that account lacks keys-DELETE → UI).
5. **Phase 4 — persona-aware widget framing: DONE (2026-07-14), widget-side.**
   The `fortiaiAgenticAssistant` drawer now drops SOC-triage framing over a
   persona module. New `fsrPbAgentService.resolvePersona(cfg, module)` (direct
   `/api/3/keys?key=fsr_assistant_profile:<module>` read → connector
   `resolve_persona` fallback on 403/miss → null=triage default) feeds a
   `$scope.personaUi` signal kept SEPARATE from `uiIntent` (which is wire-bound
   as `intent`). Persona's optional `jSONValue.ui` block ({label, greeting,
   placeholder, quickActions, footer}) reframes the greeting card, composer
   placeholder, and quick-action deck; SOC deck + build handoff suppressed; a
   persona with no `ui` gets neutral "Working on …" framing. Tests: service
   `persona.resolve.service.test.js`, controller `persona.framing.controller.test.js`,
   e2e `personaFraming.spec.js` (fixture `persona_ztpf_author.json`); full widget
   unit suite 608 green + SOC e2e 21 green (no regression); lint+typecheck clean.
   Gotcha captured in `docs/kb/drawer-widgets.md`.
   - **Connector `resolve_persona` action — DONE (2026-07-14), committed
     `39cec27` on `dynamic-tool-surface-connector` (NOT yet shipped).** `Profile`
     gains optional `label`/`ui` (parsed from `jSONValue`); `resolve_persona(config,
     {module})` reuses `_resolve_profile` and returns `{found, module, label, ui}`,
     fail-open to `{found:false}`. Registered + declared in info.json. Tests:
     fsr_soc_triage 150 green, root tests 219 green. No version bump — reship with
     the next `make ship` so the deployed 0.4.49 gains the op.
   - **Persona `ui` provisioning — ready.** Offline idempotent upsert script
     `scripts/_upsert_ztpf_persona.py` (gitignored) authors/updates the
     `fsr_assistant_profile:ztpf_templates` Key Store record WITH the `ui` block
     (greeting/deck/placeholder + tool allowlist + `may_write`). Run it against the
     box (source its env first; `--dry-run` to preview) before the joint live test.
   - **JOINT LIVE TEST (needs a box window):** reship the connector (gains
     `resolve_persona`) + reship the widget, run `_upsert_ztpf_persona.py` on the
     box, then mount the drawer on a `ztpf_templates` record and confirm the
     authoring framing (greeting "Authoring …", persona deck, template placeholder,
     no SOC deck/handoff) renders live.

Local-only artifacts: `fsr-playbook-framework/.env.ztpf-8.0` + harness `.env.206`
(box 206 creds), scratchpad `ztpf_templates_persona.json`, `chat_params.json`,
`phase0_keystore_spike.py`.

## 8. Definition of done (v1 = Phases 0–3)
Mounting the assistant on a module with a `fsr_assistant_profile:<module>` Key Store
entry: the drawer uses that prompt, exposes only the allowlisted tools, and can
create/update records in the `may_write` modules via an approval card — with no
connector code change required to add or edit a persona, and no behavior change for
modules without a persona record.
