# PLAN -- Phase 1: demote the page latch to a soft page *prior* over ONE shared affordance taxonomy

**Plan doc:** `docs/plans/state-derived-intent-and-tool-slicing.md` (§Phase 1, lines 238-248)
**Scope:** `fortiaiAgenticAssistant` widget + `connector-fsr-soc-assistant`. No framework change required.
**Nature:** small, high-value, box-independent to build (jest + connector offline suite); one live-sweep row to prove through the widget.

---

## 1. Goal -- what "done" means

Today the widget computes a **binary intent** from the mounted page (`_defaultIntent()` = `inPlaybookEditor ? 'build' : 'triage'`), pins it once at mount, and sends it as `payload.intent`. That value acts as a **hard prior**: the connector's frontier (`_afforded_drop_set(prior, …)`) opens the *other* slice only once `authoring_active` (has_trace ∨ has_open_playbook) is true, and the widget further splits chat into per-intent sessions (`fsrPbSession:<intent>`). Net effect: an authoring ask inside a triage chat, or a triage ask inside an authoring chat, is reachable only by flipping pages/threads.

**Done =**
1. The page is expressed as a **`PageClass`** (one enum) that is the *single* mapping from "where the widget is mounted" to (a) the frontier **prior**, (b) the **default persona** when no custom persona exists, and (c) the **M2 MCP surface class**. No more three independent notions of "what page am I on" (`_defaultIntent`'s binary, `_resolve_intent`'s `{triage,build}`, and `surface_page_tools`'s per-`module` logic).
2. The prior is **soft**: an authoring ask in a triage-prior session (and, where the plan allows, the reverse) reaches the right tools **without a page flip**, per the Phase-2 frontier already shipped. Phase 1 does not widen the *connector* frontier semantics (that's Phase 2, done) -- it stops the *widget* from fencing the user out before the frontier ever runs.
3. **Persona + skills key off the same `PageClass`/`module` signal** the prior does, so a page resolves *one* affordance context that seeds prior, persona default, MCP surface, and (via persona) which skills fire -- proven by a test that asserts the three consumers agree for each PageClass.
4. Coverage: jest for the widget plumbing; a connector offline test asserting the taxonomy is the single source; **one live-sweep interleave row** (triage → author → back to a record question in one chat) converts "unit-proven" → "proven through the widget" (the recurring STATUS 4g #6 gap).

**Explicit non-goals (do NOT redo -- already shipped):**
- The connector state-derived frontier `_afforded_drop_set` / `_authoring_active` (Phase 2, conn 0.5.23).
- M2 `surface_page_tools` per-page MCP surfacing + capability dedup (conn 0.5.25/0.5.26).
- Skills fold at `_resolve_profile → _apply_skills` (conn 0.5.34).
- The build→triage direction stays walled (C5 containment-in-authoring guard) until **Phase 3**'s disposition prompt exists. Phase 1 must not silently unwall it.

---

## 1b. Phase 0 -- persona/skills substrate (PREREQUISITE, decided 2026-07-28)

Phase 1 keys prior + persona + skills off one page signal, so the persona/skills storage must be first-class and user-editable *before* we build on it. Today they're asymmetric: **skills** live in a real custom module (`assistant_skills`, 6 typed fields, editable in the record grid) but **personas** live as opaque JSON blobs in the **Key Store** (`fsr_assistant_profile:<module>`) with no grid and no editor -- you hand-edit JSON. **Decision:** migrate personas to a module too; both become editable grids provisioned by one installer.

**P0 done =**
- New custom module **`assistant_personas`** mirroring the `Profile` model (`fsr_soc_triage/profiles.py:106-143`).
- Framework reads **module-first, Key Store fallback** -- existing Key Store personas keep resolving unchanged (back-compat; nothing breaks on ship).
- **One installer** provisions BOTH modules (extend `scripts/setup_assistant_skills.py` → `setup_assistant_surfaces.py` or add a persona step) so a fresh box gets both; a migration pass copies existing Key Store personas into the module.
- Edit surface = the **built-in FortiSOAR record grids** for both modules (no widget work -- the "Module grids only" decision). A dedicated editor widget is explicitly deferred.

**Profile → module field mapping (design care point).** Flat/human fields become first-class columns; list/nested fields need a JSON-bearing Long Text (FortiSOAR modules have no native list/object type):
- First-class: `scopeModule` (Text, = `module`), `label` (Text), `prompt` (**Long Text**), `version` (Integer), `enabled` (Checkbox).
- `tools_allow`, `may_write`, `run_playbook_allow`, `run_playbook_auto`, `bind_modules` → **Long Text JSON arrays** (grid-editable as JSON; reader parses, fail-open to []).
- `mcp`, `capabilities`, `ui` (nested) → a single `advanced_json` **Long Text** blob the reader deserializes into `PersonaMcp`/`PersonaCapabilities`.
- `instruction`-class Long Text columns MUST be created as textarea, not `varchar(255)` -- same 500-error trap `setup_assistant_skills.py` already self-heals via `set_field_type`.

**P0 steps (do before Phase 1 steps below):**
- **P0.1** -- Define the `assistant_personas` module schema + a `PersonaRecord`↔`Profile` (de)serializer in `profiles.py` (parse JSON columns → typed `Profile`; fail-open per field). Unit-test round-trip: `Profile → record dict → Profile` is identity; malformed JSON in one column degrades that field, doesn't crash resolution.
- **P0.2** -- `resolve_profile_status` reads the module first (`client.records("assistant_personas")` filtered by `scopeModule`), falls back to the existing Key Store read on miss/error. Cache + negative-TTL logic unchanged. Test: module hit wins; Key-Store-only persona still resolves; neither present → `None` (built-in default).
- **P0.3** -- Installer: extend the setup script to create `assistant_personas` (idempotent, typed via `admin.create_module`, Long Text self-heal) and a `--migrate-keystore-personas` pass that upserts each existing `fsr_assistant_profile:*` into the module (`get_or_create` keyed on `scopeModule`). `--dry-run` + per-step flags, box-agnostic. Run against both .159 and .206.
- **P0.4** -- Confirm the grids are usable: create/edit a persona row and a skill row in the FortiSOAR UI, resolve it live, assert the agent picks it up (read-path only; no LLM turn needed for P0).

## 2. The unifying artifact -- `PageClass` affordance taxonomy

One declarative table, authored **server-side** (single source of truth; the widget reports raw page *facts*, the connector classifies). Lives next to the existing M2 surfacing config in `fsr_soc_triage/triage_sources.py` (where `SOURCE_TOOLS` already is).

| PageClass | Mounted where (widget facts) | Frontier prior | Default persona key (no custom) | M2 surface class |
|---|---|---|---|---|
| `triage` | alert / incident drawer, war-room | `triage` | built-in triage | soc / fortisiem / faz hunt servers |
| `author` | playbook detail (`main.playbookDetail`) | `build` | built-in build | playbooks / utility (+ deepwiki external) |
| `record` | generic record / dashboard | `triage` | module persona if present, else generic | module-scoped only |
| `device` | ztpf device / metadata modules | `triage` | ztpf_* personas | modules + connector:`<fmg/faz>` |

The taxonomy is a pure function `classify_page(module, state_name, in_playbook_editor) -> PageClass`, and three tiny resolvers read it: `prior_for(PageClass)`, `default_persona_for(PageClass, module)`, `surface_class_for(PageClass)`. `surface_page_tools` and `_resolve_profile` are refactored to consult these instead of re-deriving from `module` ad hoc. This is the "key off one taxonomy" requirement, made mechanical and testable.

> **Design stance (recommended):** keep the wire's `intent` field for back-compat but treat it as a **soft override**, not the source. The widget sends new page facts (`module` already goes via `entity`; add `page`=`$state.current.name` and keep `inPlaybookEditor`); the connector classifies. If `intent` is present it overrides the derived prior (lets tests/power-users pin), else the derived prior wins. This is the smallest change that removes the widget's semantic monopoly without breaking the existing contract.

---

## 3. Affected files

**Widget** (`widgets-src/fortiaiAgenticAssistant/widget/`)
- `view.controller.js`
  - `_defaultIntent()` (≈230) + `$scope.uiIntent` seed -- becomes a *hint*, not a latch.
  - `_inPlaybookEditor()` / `$state` page detection (≈4408).
  - `_runTurnNow` payload assembly (≈3557) -- add `page` fact; keep `intent` as soft override.
  - `_entityPayload()` (≈3041) -- already sends `module`; confirm it's present for every PageClass (esp. `author`/`record`).
  - Per-intent session key `fsrPbSession:<intent>` (from C3) -- **decision point** (see Open Questions): keep two threads, or one thread with page facts per turn.
- Widget jest specs under `widgets-src/fortiaiAgenticAssistant/tests/`.

**Connector** (`connector-fsr-soc-assistant/`)
- `fsr_soc_triage/profiles.py` -- (P0) `assistant_personas` schema constants + `PersonaRecord`↔`Profile` (de)serializer; `resolve_profile_status` (≈528-601) reads module-first, Key Store fallback.
- `scripts/setup_assistant_skills.py` -- (P0) extend to also create `assistant_personas` + `--migrate-keystore-personas` pass.
- `fsr_soc_triage/triage_sources.py` -- new `PageClass` enum + taxonomy table + `classify_page` / `prior_for` / `default_persona_for` / `surface_class_for`; refactor `surface_page_tools` (≈411) to consult `surface_class_for`. `default_persona_for` resolves against the `assistant_personas` module (P0).
- `operations.py`
  - `_resolve_intent` / `ResolvedPersona.intent` path -- derive prior from `classify_page` when `intent` absent (≈2474-2518, 2610).
  - `_resolve_profile` (≈2836) -- default-persona fallback via `default_persona_for` when no Key Store record.
  - `_advertised_tools` call sites (chat turn ≈4059, resume ≈5685) -- pass the page facts / derived prior through; they already pass `module`.
- `pydantic_models.py` -- `ChatTurnParams` (≈212): add optional `page: Optional[str]`; `intent` stays optional soft override.
- Connector offline tests under `tests/` (`test_afforded_frontier.py`, `test_intent_tool_scoping.py`, new `test_affordance_taxonomy.py`).

---

## 4. Ordered implementation steps

Each step is independently reviewable and leaves suites green. **Do Phase 0 (P0.1-P0.4, §1b) first** -- the module substrate -- then the Phase 1 steps below.

1. **Taxonomy module (connector, pure, no behavior change yet).** Add `PageClass` + table + `classify_page`/`prior_for`/`default_persona_for`/`surface_class_for` in `triage_sources.py`. Unit-test the table directly (`test_affordance_taxonomy.py`): every PageClass yields a prior ∈ {triage,build}, a surface class, and a default persona; `classify_page` maps the known `(module, state)` facts. **No call sites changed.** Suite green.

2. **Wire `page` into the contract (connector).** Add `page: Optional[str]` to `ChatTurnParams`; thread it (with `module`, `in_playbook_editor`) into a single `classify_page(...)` call at both dispatch sites. Derive the prior from the PageClass **only when `intent` is absent**; when present, `intent` overrides (back-compat: today's payloads always send `intent`, so behavior is byte-identical until the widget stops pinning). Add a test asserting absent-intent → derived prior, present-intent → override.

3. **Refactor M2 + persona to consult the taxonomy (connector).** Point `surface_page_tools` at `surface_class_for(PageClass)` and `_resolve_profile`'s no-persona fallback at `default_persona_for`. Assert (new test) that for each PageClass the *prior*, the *surfaced servers*, and the *default persona* are mutually consistent -- the "one taxonomy" guarantee. Existing M2 tests must stay green (refactor, not behavior change).

4. **Widget: send page facts, demote the latch.** `_runTurnNow` adds `payload.page = $state.current.name` and keeps `inPlaybookEditor`; `uiIntent` is still computed for the *UI* (label/toggle) but no longer the semantic gate -- either stop sending it, or send it only as the explicit user-chosen override (see step 6). Jest: payload includes `page`; a triage-mounted turn and an author-mounted turn send the right facts.

5. **Widget: single interleave thread (DECIDED -- one thread).** Stop keying the session id on intent (`fsrPbSession:<intent>`); key it on the mounted **record/page** so triage→author→record stays in ONE `session_id` with continuous history. The connector already recomputes the slice per turn (Phase 2), so the bleed that C3's per-intent split guarded against is now prevented by the per-turn frontier, not by thread separation. Add a jest test that a triage turn followed by an author turn share one `session_id`, and a regression that the per-turn frontier still gates tools correctly within the shared thread (author turn on an alert page does NOT auto-expose containment -- the C5 wall). Update the KB drawer-widgets gotcha that documented the C3 per-intent key.

6. **Widget: intent as an explicit soft override (optional UI).** If a visible Ask/Agent-style toggle is desired, wire it to send `intent` explicitly (overriding the page prior) -- this is the Phase-3 disposition seam previewed; keep it minimal here (a labelled prior, not full disposition).

7. **Live-sweep interleave row.** Add a `scenarios.local.*` row (gitignored) that, in ONE chat on an alert page: (a) triages, (b) asks to author a playbook from the trace, (c) asks a record question -- asserting each reaches its tools without a page flip. Run via the Makefile live-sweep against a box.

8. **Docs + STATUS.** Update the plan doc (Phase 1 → done, note the shared taxonomy) and STATUS row; add a KB gotcha if the session-thread decision changes drawer behavior.

---

## 5. Risks, edge cases, open questions

**Risks**
- **Silently unwalling build→triage.** The C5 guard must survive: `classify_page(author) → prior=build`, and the build prior still drops `TRIAGE_ONLY_TOOLS`. Add an explicit regression asserting the author PageClass does **not** reach triage/containment tools (Phase 3 territory).
- **Refactor drift in M2.** Steps 3 changes `surface_page_tools`'s inputs; the existing M2 offline tests are the guard -- they must pass unchanged. If they need editing, that's a behavior change, not a refactor -- stop and flag.
- **Parity guard.** `test_intent_tool_scoping.py` asserts framework `BUILD_ONLY_TOOLS ⊆` connector `_BUILD_ONLY_TOOLS`; the taxonomy must not fork these sets.
- **Fail-open discipline.** `_resolve_profile` and skills already fail-open. `classify_page` must too: unknown `(module,state)` → a safe default PageClass (`record`/`triage` prior), never an exception into dispatch.

**Edge cases**
- Cold authoring ask in a triage session with **no trace and no open playbook** -- under the shipped frontier this stays gated (authoring_active False). Confirm that's still intended (I believe yes: "author from nothing" flips to the playbook page); the interleave case the 4f bug hit *had* a trace.
- Widget mounted where `module` is absent/unknown (dashboard) → PageClass `record`, generic persona.
- Resume turn: the resume call site (≈5685) currently hardcodes `has_open_playbook=True` and derives `module` from resume state -- ensure the derived prior on resume matches the original turn's PageClass (persist it on the session, don't reclassify from a possibly-stale page).

**Resolved decisions**
1. **One thread (DECIDED 2026-07-28).** Collapse `fsrPbSession:<intent>` → one session keyed on the mounted record/page. Bleed is now prevented by the per-turn frontier, not thread separation. See step 5.

2. **Keep the `intent` wire field (DECIDED 2026-07-28).** Retained as a soft override of the page-derived prior -- smallest blast radius, doubles as the Phase-3 Ask/Agent toggle seam. Widget still sends it; connector uses it only when present, else derives the prior from `PageClass`.
3. **Where does the default-persona table live** relative to the existing built-in triage/build personas -- extend `profiles.py` defaults, or keep the mapping in `triage_sources.py`? Recommend the latter (one taxonomy file).

---

## 6. How to verify

**Offline / box-free (must all pass):**
- Connector: `cd <connector> && make local-turn-ci` (deterministic PL gate) + the offline pytest suite. **P0:** persona record↔`Profile` round-trip test + module-first/Key-Store-fallback resolution test. **P1:** `test_affordance_taxonomy.py`, `test_afforded_frontier.py`, `test_intent_tool_scoping.py`, M2 surfacing tests. Assert the "one taxonomy" consistency test and the build→triage-still-walled regression.
- **P0 installer dry-run:** `python scripts/setup_assistant_skills.py --dry-run` (and the persona/migrate steps) prints the intended module create + migration without writing.
- Widget: jest via `make test-unit WIDGET=fortiaiAgenticAssistant` -- payload includes `page`; intent demoted; interleave-thread behavior.
- Widget DOM/template: `make test-e2e-spec SPEC="…"` for any template/controller change (per repo rule).

**Live (one row, box-touching):**
- `make test-live-sweep RUNS=2` (or the interleave scenario specifically) against `.206` -- the triage→author→record interleave in one chat, each step reaching its tools without a page flip. A FAIL ⇒ widget/frontier bug; `[[SWEEP-ENV-SKIP]]` ⇒ box down, not the widget. (Two runs; a defect twice is a defect.)

**Ship (only after green):** `make ship-verify WIDGET=fortiaiAgenticAssistant BUMP=patch` for the widget; connector via its own `make ship` if the taxonomy/contract changed. Confirm workers on-version + a live interleave turn.
