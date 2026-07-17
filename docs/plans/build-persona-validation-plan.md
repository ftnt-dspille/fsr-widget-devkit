# Build-persona validation plan — "the playbook actually runs"

**Sibling plan:** `live-chat-eval-and-build-flow-fixes.md` (triage-side T2/D2 defects; shares the
prompt file but does not block this work).

---

## ▶ RESUME HERE (last touched 2026-07-16, session 2)

**P2 is done, S2 answered the question, and F1 — the blocker it found — is FIXED and live-proven.**
The assistant was never the problem: given the playbook's YAML it edits it correctly first try. It
had no way to *get* the YAML. Evidence in §"S2 findings"; all three findings reproduce with **no
LLM** (`scripts/_s2_409_probe.py`).

### ✅ F1 fixed — the widget now reads the open playbook (UNCOMMITTED)

New connector op **`decompile_playbook`** (the READ mirror of `compile_yaml`; the framework's
`decompile_to_yaml` already existed and simply was not exposed) + the widget calls it at designer
mount → seeds `currentYaml` → carries the YAML on every build turn as `entity.playbook_yaml`.

Same scenario on 206, before → after: 8 failed `analyze_playbook` calls → a correct one-field edit;
**409 → `ok method=put`**; playbook still ALPHA → **runs and emits BRAVO**.

Two deliberate calls, each pinned by a test:
- the read **always hits the live connector, even in mock mode** — a mocked answer would ground the
  assistant in a playbook that is not the one on screen, which is worse than no grounding;
- the YAML is **never truncated** (unlike the capped record-data section). The assistant edits that
  text and Save compiles the result back *over* the real record, so a clipped copy would return as
  a playbook with the analyst's steps silently deleted. It fails closed instead.

Green: widget **708 jest / 60 suites** + e2e smoke 14/14; connector **291 root** + **227 triage**.

### ✅ F3 fixed — the graft matches by identity, not by uuid (UNCOMMITTED)

`_graft_live_ids` (`operations.py`) now pairs compiled records to live ones on **uuid first, then
name** (the compiler's own uuid seed — the thing that made the uuids deterministic to begin with).
Routes have no meaningful name, so they pair on **the two steps they connect**. A paired record
takes the live **uuid as well as the `@id`**, so the live identity survives the edit — which is the
half that restores the oracle.

Taking the live uuid strands every reference *to* it, so the graft then remaps them:
route `sourceStep`/`targetStep`, a step's `group`, and the workflow's own **`triggerStep`**. An
ambiguous name (two live steps sharing one) pairs **nothing** rather than guessing — a wrong graft
moves the user's edit onto the wrong record silently, which is worse than the create-and-drop it
falls back to.

**Live-proven on 206** — `scripts/_f3_graft_probe.py`, no LLM, the same three targets `_s2_409_probe`
used. Case D (designer-built, the persona's whole premise), before → after:

| | before | after |
|---|---|---|
| write | `ok=True` | `ok=True method=put` |
| step records | `kept=0 new=2 dropped=2` (every step destroyed + recreated) | **`kept=2 new=0 dropped=0`** |
| `diff_versions` | `changed=[] added=2 removed=2` (reads as a total rewrite) | **`changed=1 added=0 removed=0`** — step `Emit`, field `arguments` |
| the playbook | — | **runs, `status=finished`, emits BRAVO** |

Case C (compiler-created) still updates — the uuid path is an exact identity and the name path must
not shadow it. **The oracle this plan chose is restored:** `assert_diff_only` can now tell a
one-field edit from collateral damage on a designer-built playbook.

**The probe runs `update_playbook` LOCALLY, in-process, against the live box** (the local-dev loop
resolves the .env pyfsr client). Deliberate: the box runs a build without this fix, and shipping one
to prove a graft change would drag the user's in-flight WIP onto an appliance. Same `operations.py`
either way; what the box contributes is what no unit test can fake — a real cascade PUT, a real
constraint, a real step graph read back.

**Two things the box caught that the suite could not**, both worth keeping:
- **`triggerStep`.** The first cut remapped routes and groups, passed every unit test, and the live
  PUT was rejected outright: `Foreign key violation on field 'triggerstep_uuid' ... is not a valid
  entry of type 'workflow_steps'`. It lives on the *parent* record, not alongside the steps, so it
  is the reference easiest to forget. Now pinned by a unit test.
- **F2 was mischaracterised.** The fix closes the **uuid** collision, but "duplicate a playbook → AI
  edit always fails" was not quite the bug. Probe A (the clone) now fails with an honest
  `(name, collection)` conflict — because that body asks to rename the clone *onto the fixture's
  name*, which the platform should refuse. And that ask is only reachable by hand: a decompile hands
  the assistant the **clone's** name, which is case D, which passes. Compiled uuids are seeded from
  collection+playbook name, so two live records can only collide on uuid if they already collide on
  `(name, collection)` — which the platform forbids anyway. F2 is closed; its *description* in
  §"S2 findings" below overstates it.

Green: connector **303 root** + **227 triage**. 9 of the 13 new graft tests go **red** against the
old uuid-only graft (verified by pinning it back in); the 4 that stay green are the invariance
guards (uuid-wins-over-name, refuses-to-guess, non-mutating) — they must hold on both.

⚠️ `tests/test_hitl_durability.py::test_manual_input_unreachable_run_degrades_cleanly` is red, and it
is **not mine** — it fails identically with the old graft pinned back in. It is the user's
`manual_input` WIP, exactly as this plan predicted.

### 🔜 NEXT: P4 — the designer prompt

The last item, and S2 is the argument for that ordering rather than an instinct: the grounded run
shows the prompt is not what is broken. F1 gave the persona a read path; F3 makes its writes
surgical. What is left is whether the prompt asks for the right thing.

### ⚠️ None of the F1 fix is committed, and it cannot be cleanly committed alone

`operations.py` and widget `view.controller.js` each interleave the user's in-flight
`manual_input`/`resume_playbook` work with mine, so any commit of mine drags theirs in.
- **Mine (connector), F3:** `operations.py` (`_graft_live_ids` rewritten + new `_uuid_from_ref` /
  `_remap_ref` / `_match_live_records` / `_k_uuid` / `_k_name` / `_k_route_ends`),
  `tests/test_operations.py` (+13). Plus `scripts/_f3_graft_probe.py` (new) — **local-only, never
  committed**: `.gitignore:31` (`scripts/_[a-z]*.py`) is the repo's convention for probes, the same
  reason `_s2_409_probe.py` isn't tracked either.
- **Mine (connector), F1:** `operations.py` (`decompile_playbook`, `_live_collection_envelope`, the
  OPEN PLAYBOOK block in `_entity_context_block`), `info.json` (the new op + corrected the
  `update_playbook` description, which still advertised the `import_jobs` fallback deleted 3
  releases ago), `pydantic_models.py`, `tests/test_operations.py` (+13).
- **Mine (widget):** `view.controller.js` (`_seedPlaybookYaml`, `_entityPayload`),
  `fsrPbAgent.service.js` (`decompilePlaybook`), `tests/playbook.yaml.seed.test.js` (new, 7).
- **Not shipped.** The box runs the user's **0.4.72**, which has no `decompile_playbook`; a ship
  would carry their WIP — including whatever currently reds `tests/test_hitl_durability.py` (it
  passes at HEAD, so it is theirs, not mine).
- **Foreign WIP, untouched:** widget `fsrPbRender.ts` / `view.html` (manual_input dynamic_list),
  connector `fsr_soc_triage/tools_playbook.py`, `tests/test_persona_resume_persist.py`.

### State by repo

| Repo | State |
|---|---|
| **connector** (`ConnectorsV2/fsr-playbook-builder`) | 3 commits **PUSHED** (`cd842e7`, `a964ee3`, `156db66`); **shipped to box 206 as 0.4.68**, live-verified. Suite 260 green + triage 215 green. |
| **fsr_all_widgets** | 1 commit local (`85abea5`, STATUS.md + this plan). Plus this resume edit. **Unpushed.** |
| **widget** (`widgets-src/fortiaiAgenticAssistant`, its OWN repo — gitignored from the parent via `widgets-src/*/`) | 1 commit local (`3b5705b`, P3). 695 jest + 107 e2e green. **Unpushed — and 8 pre-existing commits of the user's sit ahead of the remote, so pushing mine pushes theirs. ASK FIRST.** |

**Foreign WIP — do not touch/commit:** `widget/widgetAssets/js/fsrPbRender.ts` (the user's
`manual_input` dynamic_list / manager→device picker work) and, in the connector,
`connector-fsr-soc-assistant/tests/test_persona_resume_persist.py`.

### Done

- **P0 — the write path.** `update_playbook` had NEVER worked (see §P0 below for the full story).
  Fixed: graft live `@id`s onto the compiled body. `import_jobs` fallback deleted. Live-verified.
- **P1 — the snapshot gate.** AI edits had NO rollback point at all. Now snapshots into the
  Versions tab, fail-closed, live-verified.
- **P3 — surface cut.** Render step parked behind `config.enableStepVerify` (default off);
  `config.defaultIntent='build'` retired; `session_id` threaded for snapshot attribution.

### Next, in order

1. ~~**P2 — the eval harness.**~~ ✅ **DONE 2026-07-16** (`f52af4c`). `scripts/eval_harness.py` +
   `scripts/eval_fixtures/marker_emitter.yaml`; `make eval-selfcheck ENV=<file>` proves the harness
   against 206 with the AI taken out (deterministic pyfsr edit), incl. proving its own teardown.
   19 unit tests pair every oracle with a case it must REJECT.
2. ~~**S2 — modify an existing playbook.**~~ **BUILT, and RED for real reasons** — see below.
3. **P4 — the designer prompt.** Still after S2, now with evidence: the grounded run shows the
   prompt is not the blocker.

## S2 findings (live on 206, connector 0.4.71 — 2026-07-16)

`scripts/eval_s2_modify.py`. **The assistant is competent and structurally blocked.** Ungrounded:
0/4 runs, every one dead-ending in `analyze_playbook` with nothing to pass it. With `--ground`
(the YAML a read tool *would* have returned, injected — the only variable changed): it read the
playbook, verified it, emitted a correct one-field revision and an offer card on the first try.

**F1 — the build persona cannot read the playbook it is editing.** ✅ **FIXED** (see the resume
block: `decompile_playbook` + widget seeding, live-proven, uncommitted). Its whole premise
(Decision 1: "may assume an open playbook with a real step graph") was unmet by the shipped
toolset. Kept in full below because the *shape* of the gap is what the fix has to keep closed:
- `tools_for_intent("build")` has no tool that reads a live playbook. `get_record` and
  `search_module_records` are excluded from build by **C5's triage-only scoping**
  (`fsr_soc_triage/registry.py:88` adds them to `TRIAGE_ONLY_TOOLS`); `search_playbooks` queries an
  **offline pattern corpus** (`tools_corpus.py:26`), not the box; `analyze_playbook` takes
  `yaml_text` only. Verified by enumerating the slice, not by inference.
- The widget assumes otherwise: *"the connector can also fetch by iri with its own SOAR tools"*
  (`view.controller.js:3331`). It cannot — that comment is wrong, and the authoring quick-actions
  ("Explain this playbook", "Find issues") all fire into this hole.
- The **"⊕ Playbook context / Pull in this playbook's steps"** button does not pull steps.
  `_resolveEntityRecord` does GET `?$relationships=true` (so the steps ARE on the record), but
  `_composeEntitySummary` (`view.controller.js:3507`) renders only name/severity/status/description
  and drops the step graph. The tooltip promises the one thing it doesn't do.

**F2 — `update_playbook` 409s on any playbook it did not itself compile.** ✅ **FIXED** (see the
resume block) — **and overstated here.** The uuid collision was real and is closed. But "duplicate a
playbook → fails every time" was not the bug: probe A asks to rename the clone *onto the fixture's
name*, and post-fix it fails with an honest `(name, collection)` conflict the platform *should*
raise. That ask is only reachable by hand — a decompile hands the assistant the clone's name, which
is case D, which passes. Compiled uuids are seeded from collection+playbook name, so two live
records can only collide on uuid if they already collide on `(name, collection)`, which is forbidden
anyway. Kept in full below because the *diagnosis method* (a clean no-LLM control) is the reusable
part. `_graft_live_ids`
(`operations.py:4606`) matches compiled steps to live steps **by uuid**, so it only grafts when the
target's step uuids ARE the compiler's deterministic ones. Clean control, no LLM, 2/2 reproducible:

| probe | target | body | result |
|---|---|---|---|
| A | a **clone** of the fixture | fixture's names, marker flipped | **409 UniqueConstraintViolation** |
| C | the **fixture itself** | *identical body* | `ok=True method=put` |

The deterministic uuids collide with whatever record *does* own them (here, the original). The
user-facing bug: **duplicate a playbook, ask the assistant to tweak the copy → fails every time.**
P0's live-verify never saw this because it created its collection *from* the compiled envelope, so
the uuids matched by construction.

**F3 — on a designer-built playbook the "in-place update" replaces every step.** ✅ **FIXED and
live-proven on 206** (`kept=2 new=0 dropped=0`, `diff changed=1 added=0 removed=0`, and the playbook
runs — see the resume block). Kept in full because the shape of the gap is what the fix must keep
closed. Probe D: target's
step uuids random (as the designer makes them), body's names hash to uuids that exist nowhere → the
graft matches nothing → `ok=True`, edit lands, but `kept=0 new=2 dropped=2`. Every step record is
destroyed and recreated. `_graft_live_ids`'s docstring ("Compiled uuids are deterministic, so they
collide EXACTLY with the live ones") is true *only* for a playbook the compiler created — which a
designer-built playbook, the persona's entire premise, is not.

**F3 defeated this plan's chosen oracle** (✅ restored by the fix — `assert_diff_only` now reads a
one-field edit on a designer-built playbook as exactly that). `diff_versions` is **uuid-keyed**
(`pyfsr/api/playbooks.py:303`), so a correct one-field AI edit of a designer-built playbook reads as
`added=N, removed=N` — a total rewrite — and no `assert_diff_only` expectation can distinguish it
from actual collateral damage. Fixing F3 (graft by name) restores the oracle; until then S2's diff
check only works against compiler-created fixtures.

**Suggested fix for F2+F3 (one change):** ✅ **DONE, and the suggestion was two-thirds right.**
Matching by name with uuid as a *fallback* had the precedence backwards — uuid is an exact identity
and must win; name is the inference. And "align each compiled step's uuid to its live counterpart's"
is correct but incomplete: doing it strands every reference *to* that step, so the graft must also
remap route endpoints, a step's `group`, and the workflow's `triggerStep` — the last of which only
the box found (the PUT is rejected on a `triggerstep_uuid` foreign key). See the resume block.

### The lesson this session actually taught (read before trusting any doc here)

Three times, an artifact was trusted over a measurement, and three times the box disagreed:
- a commit message + docstring claimed C2 "live-verified on 8.0" for **3 releases** while it never
  worked once;
- the P3 blast radius was estimated **four times** and wrong every time (cheap → 9 specs → 4 specs
  → 10 tests → 19 tests / 6 specs). The one-command sweep that showed the whole picture took
  seconds and should have been first;
- "I expect the suite to come back clean" — it didn't, twice.

**Trust the box and the suite, not the commit message, the docstring, or the estimate.** That gap
is the entire reason this plan exists: every unit test stayed green through a feature that was
totally broken.

**F3 made it four, and this one cuts closer** (2026-07-17): the fix had **13 new unit tests, all
green, 9 of them provably red against the old code** — and the very first live PUT was rejected on a
`triggerStep` foreign key the tests never modelled. Tests written from the same mental model as the
fix inherit its blind spots; they can only check the references you *remembered*. The box does not
share the model. Two cheap habits carried this session, keep both:
- **Pin the old implementation back in and re-run the new tests.** A test that passes against the
  code it was written to catch is testing nothing (the plan's own oracle bug, one level up). Cost:
  a ~20-line pytest plugin.
- **The local-dev loop is a live probe without a ship.** `_make_request` resolves the .env pyfsr
  client, so `operations.py` can be driven in-process against a real box — real cascade, real
  constraints — without shipping a build or touching someone else's WIP. Reach for it *before*
  declaring a connector change done.

---

## Why

Build intent is wired end to end (validate → offer → push) and is well covered *hermetically*:
mock e2e, golden files, ~619 jest tests. But live agentic coverage is a single scenario (the
save-as-playbook quick-action). **Nothing today asserts that a playbook the assistant created is
valid, let alone that it runs.** Every green test is compatible with an assistant that calls the
right tools and produces a playbook that does the wrong thing — which is how a broken render step
shipped green.

The bar for this plan: **a scenario passes when the playbook executes on a real box and produces
the right observable result.** Not "the right tools were called". Not "the run status is finished".

## Decisions taken

1. **The build MOUNT intent is the playbook designer, and only there.** Its prompt may therefore
   *assume* an open playbook with a real step graph, a UUID, and an ask that is about that
   playbook. This is what lets the prompt be specific rather than defensive.
   **Precision matters here** (a loose version of this claim already had to be corrected in the
   controller): build is not *unreachable* elsewhere. The earned handoff
   (`openDraftInBuild` / `buildPlaybookFromTriage`, gated on `hasTriageDraft()`) still flips
   `uiIntent` to `build` at runtime — that IS the save-as-playbook path. The difference is it
   arrives **with a drafted playbook in hand**, so build still has something to work on. What was
   removed is the *mount* that had nothing.
2. **"Save as playbook" is a triage feature, not a build one.** Triage hunts, `emit_playbook_offer`
   (trace mode) summarises the hunt into draft steps, the user accepts, `push_playbook` creates the
   record. The handoff ends at *creation*; refinement happens later, in the designer.
3. **`config.defaultIntent='build'` (dashboard mount) is dropped.** It is the only remaining way to
   get a build persona with nothing to build against — the weak variant this split designs away.
4. **The render step (`step_test`) is feature-flagged off**, not deleted. It is an authoring aid,
   not on the compile/push critical path, and it is *not referenced in the build system prompt* —
   so disabling it in the tool registry needs no prompt rewrite. The capability it wants to provide
   (per-step ground truth) is something the eval harness needs anyway; park it, don't burn it.
5. **No AI write to a playbook without a version snapshot first.** Product invariant — see §Safety.

## Safety invariant: every AI write is recoverable

The connector's write path (`push_playbook`, `update_playbook`) MUST call
`client.playbooks.create_version(pb, note=...)` **before** any mutation. This is product code, not
test code. Notes:

- `restore_version()` deliberately does NOT snapshot before overwriting
  (`pyfsr/src/pyfsr/api/playbooks.py`) — the rollback point must be created by us, on the write
  path, every time.
- `create_version` does not echo the `json` blob back; re-fetch via `get_version(uuid)`.
  pyfsr surfaces the non-echo as a typed `ValueError`, not a silent `None`.
- Snapshot notes should be attributable and greppable, e.g. `ai-pre-edit <session_id>`.

This invariant is also load-bearing for the evals — see §Oracles.

## Oracles — how a scenario is graded

| Oracle | Source | Grades |
|---|---|---|
| **Behavioural** | run the playbook, read a record it created | did it *do* the right thing |
| **`diff_versions(v_before, v_after)`** | `added` / `removed` / `changed` with from/to per field | did the AI change *exactly* what was asked — and nothing else |
| **`diagnose_run()`** | definition-vs-execution diff: verdict, failing step, executed-not-defined | ground truth for the troubleshooting scenarios |
| **`why_failed()`** | first genuinely failing step + its error | ditto |

### Two traps, already solved by prior art

`pyfsr/tests/integration/test_playbook_versions_integration.py` is live-verified on 8.0.0 and is
the template. Steal from it:

- **Do NOT assert on `set_variable` / jinja values via `run_env()`.** Those are only persisted when
  *global workflow debug logging* is on (off by default) — asserting on them couples the suite to
  an appliance-wide setting. Instead, have the fixture playbook **create a record carrying a
  marker**; assert on the record.
- **Snapshot pre-existing records before the run** and match only new uuids, so a leftover from an
  earlier run can never be read as this run's output.
- `time.sleep(3)` after terminal status — the `create_record` commit trails the run.
- Teardown deletes the collection *and* every record it emitted.

### Harness triggers runs via pyfsr, never via the agent

Connector 0.4.63 added `run_playbook` behind an advisory allowlist **and a human-approval gate**.
The harness must call `client.playbooks.trigger(pb, follow=True, timeout=...)` directly — otherwise
every eval blocks on an approval card. *The agent's own ability to run a playbook is a separate
thing to validate, not the mechanism for validating everything else.*

## P0 — prove the write path (C2): ✅ **FIXED FOR REAL (0.4.68). It had never worked.**

**A lesson worth keeping.** The first pass of this plan read commit `8597807 fix(C2): ... —
live-verified on 8.0` plus a docstring making the same claim, and concluded C2 was fine and the
"blocked" status was stale. Both were wrong. A live probe against 206 showed the PUT 409ing *every
time*. **A commit message is not evidence; only the box is.** The original P0 instinct — "diff what
the connector sends against what pyfsr sends" — was correct and was abandoned too early.

**The real root cause** (live-diagnosed 2026-07-16, not inferred): `update_playbook` PUT a
*compiled* body whose steps carry `uuid` but no `@id`. The platform decides create-vs-update on
`@id`, and the compiler's uuids are deterministic — so they collide **exactly** with the live
records, and the `$relationships=true` cascade tried to INSERT over them:

    UniqueConstraintViolationException: ... uniqueness constraint for the fields (uuid)
    and a record already exists ...

`$relationships=true` was never the missing piece; the identity was. This is precisely why pyfsr's
`playbooks.update()` works — its steps come from a GET and already carry `@id`.

**Fix:** read the live workflow, graft its `@id`s onto the compiled body, then PUT. New steps stay
`@id`-less and are created; live steps absent from the body are dropped by the cascade. One read
feeds both the restore point and the graft.

**The `import_jobs merge_replace` fallback is deleted, not fixed.** It was not the designer's
mechanism (re-importing the whole collection to change one step), and live on 8.0 it returned
`ok=True` while applying nothing — converting every PUT failure into a phantom success. It existed
only because the PUT was broken. Now `update_failed` is honest and carries the restore point.

**Live-verified on 8.0, connector 0.4.68**, full loop: `method=put`, snapshot holds the user's
pre-edit work, the edit lands, restore reverts it. Probe: `scripts/_p1_snapshot_live_confirm.py`
(gitignored per repo convention for `scripts/_*`).

## P1 — ✅ SHIPPED (0.4.68) + LIVE-VERIFIED. The snapshot gap was a live defect.

Confirmed by grep 2026-07-16: **`create_version` / `workflow_versions` / `restore_version` appear
nowhere in the connector's source.**

So as shipped (0.4.43+), when the assistant edits a playbook in the designer it PUTs replacement
steps in place **with no rollback point**. The `$relationships=true` cascade that makes the write
work is precisely what makes it destructive: it replaces the nested step/route/group records. A
user's hand-built playbook can be silently rewritten by a bad turn with no recovery path.

This is the highest-priority item in this plan and it is independent of the eval work.

**Built 2026-07-16** in `operations.py` (`_snapshot_playbook`, `_prune_ai_snapshots`,
`_prepare_version_body`) + `update_playbook`'s fail-closed gate. 8 new tests; connector suite
242→250 passing, no regressions. Not committed, not shipped.

- Snapshot mirrors the editor's `saveSnapshot`: GET live workflow w/ relationships → strip
  platform-managed fields → POST `{note, json, workflow, modifyDate}` to `/api/3/workflow_versions`.
  It lands in the playbook's **Versions** tab, so rollback is a normal product gesture — the user
  never needs to know an AI was involved.
- **Fail-closed:** no restore point ⇒ no write. Tested by asserting the transport sees no PUT.
- **The 20-snapshot cap** (FortiSOAR rejects the POST past it) would wedge editing forever under a
  fail-closed gate, so we prune our OWN oldest auto-snapshots to make room. Never a human's — a cap
  full of human restore points fails closed with an actionable message instead.
- True-create (`push_playbook`) is exempt: nothing to recover.

**Follow-up (small):** the widget's `updatePlaybook(cfg, yaml, workflowIri)` does not send
`session_id`, so notes are an unqualified `ai-pre-edit`. Safety is unaffected; attribution is
thinner. Wire the controller's session id through when convenient (+ jest).

## Scenario matrix

All designer scenarios run against a **seeded fixture playbook** (deploy via
`import_from_yaml(replace=True)`, then `clone()` per test — `clone()` already regenerates every
owned UUID, rewires internal references, and strips server-managed fields).

| # | Scenario | Persona | Passes when |
|---|---|---|---|
| S1 | Create from natural language | designer | playbook runs; marker record proves it did the asked-for thing |
| S2 | Modify an existing playbook | designer | runs correctly after edit; `diff_versions` shows *only* the asked-for change |
| S3 | Connector-action playbook | designer | runs; the connector op received the right inputs and its output was mapped onward |
| S4 | Trigger + conditions + jinja | designer | the *taken branch* is correct — assert via marker record, not `run_env` |
| S5 | Troubleshoot a broken playbook | designer | assistant's diagnosis matches `diagnose_run()` / `why_failed()` ground truth |
| S6 | Help with a user's broken playbook | designer | as S5, plus: the proposed fix, applied, makes the playbook run |
| S7 | Issues our validation should catch | designer | the linter flags it *before* a push — negative test against deliberately-broken fixtures |
| S8 | Save as playbook (hunt → playbook) | **triage** | offer card emitted from trace; accepted; created playbook is valid and runs |

S5–S7 need deliberately-broken fixtures. Those double as negative tests for the linter, which is
why S7 is nearly free once S5/S6 exist.

## Build order

- ~~**P0** — prove the write path.~~ **DONE** (was already fixed in 0.4.43; status was stale).
- **P1** — 🔴 snapshot-before-write in `update_playbook`, fail-closed, + unit coverage. Ship first:
  it is a live data-loss risk in released code and does not depend on any eval work.
- **P2** — 🔜 **NEXT.** Harness: fixture deploy/clone/teardown, trigger+wait, marker-record
  assertion helper, `diff_versions` assertion helper, run cleanup. (pyfsr gaps: no run cleanup, no
  step-assert helpers — thin wrappers, we build them.)

  **Start from the working prototype**, don't rebuild from scratch:
  `ConnectorsV2/fsr-playbook-builder/scripts/_p1_snapshot_live_confirm.py`. It already does
  seed → act via the DEPLOYED connector → assert behaviour → restore → self-clean, and it encodes
  every gotcha listed under §"Two traps" plus these, each of which cost a live round-trip:
    * **Read a snapshot with `get_version()`, never a raw GET** — the server withholds the `json`
      blob without `$includeData=true`, so a bare GET reads back an EMPTY snapshot and looks
      exactly like a connector bug. (It isn't.)
    * **`set_variable` takes a top-level `vars:` mapping, not `arguments:`** — the compiler rejects
      the latter outright. It compiles to `arguments: {marker: X}`, which is what you read back.
    * **Hard-delete needs the `$` prefix** (`$hardDelete=true&$showDeleted=true`) or the row
      soft-deletes into the recycle bin and keeps reserving its name → the next run 409s on the
      name. Timestamp fixture names anyway.
    * `time.sleep(3)` after terminal status — a `create_record` commit trails the run.
    * Trigger runs via **pyfsr directly**, never the agent's `run_playbook` (approval-gated).
- ~~**P3** — flag off `step_test`; retire `config.defaultIntent='build'`.~~ ✅ **DONE 2026-07-16.**
  - `step_test`'s Verify panel is behind `config.enableStepVerify`, **default off**. Code and tests
    stay; the e2e opts in and still passes, which is what makes flipping it back a one-line change.
  - `config.defaultIntent` is no longer read (kept only so saved configs round-trip); the edit-page
    picker is gone — it was offering a choice with no effect.
  - **Blast radius was bigger than estimated, then smaller than feared.** 9 e2e specs set
    `defaultIntent: 'build'`, but only 4 depended on it — the 4 that click `yaml-push`. They now
    reach build the way a user does: the earned handoff (`enterBuildWithDraft` helper). The rest
    reached build via fixtures and never noticed. Widget: 695 jest + smoke e2e green.
- **P4** — flesh out the designer build prompt against its now-guaranteed context.
- **P5** — scenarios, in order: S2 (smallest, sharpest oracle) → S1 → S5/S6/S7 → S3 → S4 → S8.

S2 first: it has a real fixture, a tight `diff_versions` oracle, and it exercises the write path
that P0 confirmed already works. It also directly regression-tests P1 — a passing S2 proves both
that the edit landed *and* that a rollback point exists.

## Open questions

- ~~Is `emit_playbook_offer` scoped build-only?~~ **Answered 2026-07-16: no, and correctly so.** It
  is in neither `BUILD_ONLY_TOOLS` nor `TRIAGE_ONLY_TOOLS` (`fsr_playbooks/llm/intents.py:29,56`),
  so both intents see it — triage uses its trace mode, build its yaml mode. The split is already
  right here; an earlier report had miscategorised it.
- ~~Does `create_version` belong on the push (create) path too?~~ **Answered: no.** A true create
  has nothing to recover. `push_playbook` is exempt; `update_playbook` is fail-closed.
- Which box does the suite run against, and can it tolerate created/deleted records? (The live
  probe uses 206 and self-cleans with the `$`-prefixed hard-delete.)
