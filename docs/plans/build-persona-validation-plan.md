# Build-persona validation plan — "the playbook actually runs"

**Sibling plan:** `live-chat-eval-and-build-flow-fixes.md` (triage-side T2/D2 defects; shares the
prompt file but does not block this work).

---

## ▶ RESUME HERE (last touched 2026-07-18, session 3h)

**S5 (troubleshoot a broken playbook) is SHIPPED + box-proven on 206. Next: S6, then S3/S4/S8.**
The build persona can now diagnose why a run failed. The validation caught a **3-layer latent
defect** — `why_did_playbook_fail` and `diagnose_yaml_against_pb_execution` were both dead against
live runs in this connector (wrong `tools_triage` module path; `get_run_env` broke on pyfsr's typed
`RunSummary`). Fixed pyfsr-first:
- Exposed `why_did_playbook_fail` to the build LLM slice + build prompt `find_issues`.
- Framework `set_failed_run_provider` hook (connector supplies `list_recent_failed_runs`);
  `get_run_env` now delegates to pyfsr's typed `run_env()` (no raw calls); enrichment via pyfsr
  `why_failed()` surfaces `failing_step` + the runtime error.
- pyfsr `run_failure(run)` + `RunEnv.name` added (committed, tested) but out of the ship's critical
  path (framework uses the already-released `why_failed`).
- **Eval:** `scripts/eval_s5_diagnose.py` (Frank half-live, in-process editable framework + live 206)
  passed; box probe PASS on shipped 0.4.75 → `failing_step='Emit'`, `insert_data()` error.
- **Shipped:** framework v0.4.29 (PyPI), connector 0.4.75 on 206. Commits: pyfsr `a18f643`, framework
  `5b6c8fb`, connector `a0bb403`+`e68deda`.
- **S6 next:** the anchor fixture doubles as S6's — the model already proposes a `verify_enhancement`-
  checked fix in the S5 runs; S6 = apply it → the playbook runs and creates the record.

---

### (superseded) session 3g resume

**S7 (linter negative test) + the create_record linter gap are DONE; S1 is committed. Next is S5.**
A **parallel session** worked this same thread (pinned framework 0.4.28, released connector 0.4.74,
committed the S7 pytest). Reconciled state:
- **Linter gap FIXED + RELEASED + LIVE** (framework `4778ec8` = tag **v0.4.28**; connector **0.4.74** on
  206): `parser.py` now flags step-level keys it would silently drop (`unknown_param` warning → "nest it
  under `arguments:`"). The `create_record` args-outside-`arguments:` runtime crash S1 found is caught
  pre-push. ✅ **Verified live on 206** — the box's `validate_yaml` flags `steps[1].resource`. (An
  earlier note said "needs release + re-pin"; wrong — already shipped.)
- **S1 committed** (connector `9ae4015`) — `eval_s1_create.py` + `EvalHarness.track()`. Was 6/6 on 206.
- **S7 = the parallel session's pytest** (connector `0dcbca4`): `tests/test_broken_fixtures_linted.py`
  + fixture `broken_create_record_bad_args.yaml`; asserts the misplaced `resource:` warns AND the
  corrected `marker_emitter.yaml` does not. 2 passed. (I dropped a broader `eval_s7_lint.py` as
  redundant; its extra defect classes — missing-type, dangling-next — are a future add.)
- **S5 ground truth characterized on 206:** the anchor fixture RUNS → `status=failed`,
  `why_failed`/`diagnose_run` both give `failing_step='Emit'` + `insert_data() takes at least 2
  positional arguments`. Clean oracle. SAME fixture = the S5/S6 runtime-failure playbook.
- **🔜 NEXT — S5, and it is an INVESTIGATION not just an eval.** The build slice has
  `diagnose_yaml_against_pb_execution(yaml_text, pb_execution)` — but the assistant has **no channel to a
  failed run's execution env**, exactly like S2 had no read channel (→ F1). Expect S5 to surface a
  grounding gap and need a connector/widget change to feed the failed run's `pb_execution` into the build
  turn, before the eval can grade the assistant's diagnosis against the ground truth above. THEN S6 (fix
  applied → runs), S3, S4, S8.

---

## ▶ RESUME (session 3f)

**S1 (create from natural language) is GREEN — 6/6 live on 206, connector 0.4.73.**
`scripts/eval_s1_create.py` (new, tracked — mirrors `eval_s2_modify.py`) drives a build turn
with **no OPEN PLAYBOOK**, extracts the final YAML from `emit_playbook_offer(yaml=…)` (fallback: last
```yaml fence), then does the Deploy button's work — `compile_yaml` → **`push_playbook`** (create, not
update) → activate → trigger → assert the created alert's `description == CHARLIE`. Oracle is purely
behavioural (a create has no `diff_versions` before). Harness gained `EvalHarness.track(collection=,
playbook=)` so a create scenario registers its pushed collection/playbook for teardown (no clone to do
it). **Both files UNCOMMITTED**; no box details in source (hygiene-clean).

Two things the box taught, both kept:
- **Eval brittleness, fixed:** an early draft made the alert name a per-run unique timestamp for
  isolation. The model occasionally *mistranscribes* a hyphenated literal (`…1791-2` → `…1791_2`),
  which read as a behavioural FAIL while the playbook had in fact created the alert correctly (the run
  tree showed the created record). Isolation is not the model's job — `emit_marker` already snapshots
  records BEFORE the run and returns only the new one, so the name is now FIXED (`ZZ Eval S1 Alert`)
  and the model only reproduces two simple strings. **Grade the playbook, not the model's copy-typing.**
- **A real finding for the S5/S7 cluster (linter gap) — ✅ FIXED at the parser level.** ~1-in-a-handful
  of runs the model authors `create_record` with `module:`/`resource:` as **siblings of `type:`**
  instead of nested under `arguments:`. `validate_yaml`/`compile_yaml`/`verify_playbook` **all passed
  it**, and it failed only at runtime: `insert_data() takes at least 2 positional arguments (1 given)`
  (the step ran with no data). **Root cause was in the parser, not the arg-validator:**
  `parser.py` built each `Step` from a fixed set of recognized top-level keys and *silently dropped*
  any others — there was no unknown-step-key check (unlike `for_each`/`retry`, which already had one).
  **Fix:** `parser.py` now checks each step's top-level keys against `_UNIVERSAL_STEP_KEYS |
  _STEP_KEYS_BY_TYPE[type]` and emits an `UNKNOWN_PARAM` **warning** ("…not recognized and was ignored
  — nest it under `arguments:`") for any leftover. Warning (not error) so a harmless extra key can't
  hard-fail a compile; decompiler escape keys (`branches`/`unlabeled_next`) are allowlisted so
  decompiled YAML never trips it. 6 new tests in `tooling/tests/test_parser.py`; full tooling suite
  1135 passed (5 pre-existing live-`.env` e2e fails unrelated). **Framework change — UNCOMMITTED,
  needs release + connector re-pin to reach the box.** Still carry a broken fixture into S5/S6/S7 as
  the negative-test anchor.

Next: the **S5/S6/S7 troubleshooting cluster** (broken fixtures double as linter negative tests — start
by encoding the `create_record`-args-outside-`arguments:` gap above as a deliberately-broken fixture),
then S3, S4, S8.

---

## ▶ RESUME (session 3d)

**Session 3d — the reference-DB blocker is RESOLVED and P4 is COMMITTED.** The framework
pre-commit gate no longer reads the mutable, clobber-prone dev cache, so P4 landed:
- **Gate decoupled** (framework `071bd57`): `tooling/tests/conftest.py` copies a small COMMITTED
  fixture `tooling/tests/fixtures/tooling_reference.db` (~13 MB — 14 test-referenced connectors at
  full param fidelity + infra tables) to a temp file and points `db_path`+`$FSRPB_DB` there (tmp copy
  because compile paths connect read-write and would else trip pre-commit's "files modified by hook").
  Regenerate via `tooling/tests/fixtures/build_tooling_fixture.py` (committed slim catalog + public
  Fortinet RPM repo; `op_safety` regenerated by `probe_op_safety`). `cli.py --db` now honors
  `default_db_path()`/`$FSRPB_DB`. **Repo-wide gate: 1852 passed, 0 failed** (silent skips 12 → 6 —
  fixture restored `fortinet-fortisiem`/`cyops_utilities`, so coverage went UP).
- **P4 committed** (framework `d9a18b7`): the two staged files below.
- **Warmup guard** (connector `285c032`): `operations._warmup_clobber_refusal()` refuses a warmup that
  would clobber the framework dev cache unless `FSR_REFERENCE_DB`/`FSRPB_DB` points elsewhere or
  `FSRPB_ALLOW_DEV_DB_CLOBBER=1`; inert on-box. Framework primitive `_db.warmup_write_path()`.
- **Session 3e (same day) — LOOP CLOSED.** All commits PUSHED (framework `d9a18b7` github/main,
  connector `285c032` origin/main, widget `7743229` origin/master). **Widget shipped to 206 as
  `fortiaiAgenticAssistant-1.2.25`** (ship-verify 110 e2e + unit green). **Real widget-path proof
  3/3 live on 206** (connector `6a136ec`): `eval_s2_modify.py --widget-path` seeds
  `entity.playbook_yaml` exactly as the deployed widget does — the SHIPPED grounding channel, not the
  `--ground` prompt rehearsal. Each run grounds the read, emits a complete YAML fence (open-playbook
  edit, no offer card), `update_playbook ok method=put`, snapshot, `diff
  changed=[('Emit','arguments')] added=0 removed=0`, runs to `finished`. **Nothing left open on the
  build-persona thread** — next is the P5 scenario matrix (S1, then S5/S6/S7, S3, S4, S8).
- Full 724-connector dev cache still clobbered locally — no longer blocks anything; rebuild from a
  full-catalog box when convenient (§"BLOCKER" is historical).

---

**Session 3 — F1+F3 committed, PUSHED, SHIPPED to 206 as 0.4.73, and the grounded S2 eval is
3/3 GREEN with a real LLM in the loop.** The build-persona bar ("the playbook runs and does the
asked-for thing") is **met**. The manual_input awaiting-form card (EMIT + clean-green SUBMIT) is
committed + pushed too. What this session did, precisely:
- **connector**: `779ae18` (F1 read path + F3 graft-by-name) and `56bd5b1` (manual_input card /
  `respond_manual_input` no-owners submit) — both **committed + pushed to origin/main**. Shipped
  via `make ship ENV=.env.206 BUMP=patch` → **0.4.73**, all 10 workers recycled, warmup OK.
- **grounded S2 eval** (`scripts/eval_s2_modify.py --ground --runs 3`, real LLM on 0.4.73): **3/3**.
  Every run: `update_playbook ok method=put`, `diff changed=[('Emit','arguments')] added=0 removed=0`,
  snapshot taken, `ran … status=finished`. F1+F3 are live-proven with the model in the loop, not
  just by the no-LLM probes.
- **SUBMIT clean-green live** (`scratchpad/freshfwd.py`): fresh trigger → pause → `respond_manual_input`
  → `forwarded:True "Awaiting Playbook resumed successfully."` → run advances to `finished`, inside
  the input-validity window. Closes the last open item on the manual_input thread.

**Still open (NOT done this session — do not report these as shipped):**
- **✅ P4 (framework prompt) COMMITTED `d9a18b7`** (2026-07-17, open-playbook edit-in-place vs
  new-playbook offer) — LOCAL/unpushed. The reference-DB clobber that blocked it is now
  **structurally handled**: the pre-commit gate was decoupled onto a committed fixture (`071bd57`)
  + a warmup guard added on the connector side (`285c032`), so a local-dev warmup can no longer
  clobber the tracked reference DB. See §"BLOCKER" (now resolved). Remaining: push the framework
  P4 + connector warmup-guard commits.
- **widget-side F1 seed** (`7743229`, `_seedPlaybookYaml`) is committed but **unpushed + unshipped**
  — the real widget grounds a build turn via `entity.playbook_yaml`; the eval used `--ground`
  (in-process decompile rehearsal), so the widget path itself is proven in unit/e2e but not yet on
  the box. The user's manual_input dynamic_list widget WIP is still uncommitted (foreign — untouched).

---

**Session 2 — P2 is done, S2 answered the question, and F1/F3 are FIXED and live-proven.**
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

### ✅ P4 — the designer prompt: DONE, live-proven, and COMMITTED `d9a18b7` (framework, LOCAL/unpushed)

S2 said the prompt was not the blocker, and it was right — but "not the blocker" turned out not to
mean "correct". P4 was mostly **deletion**: three instructions could not be followed at all, each
verified against the real slice (`tools_for_intent("build")`), not inferred.

1. **`"the open playbook's IRI is in the entity block, so call `analyze_playbook` on it"`** —
   `analyze_playbook` is `required: ['yaml_text']` with **no IRI parameter**, and nothing in the
   build slice reads a live playbook. **This is the sentence behind S2's 0/4.** The model was
   obeying an instruction that named a capability that does not exist. F1 now seeds the YAML, so
   the prompt points at the `OPEN PLAYBOOK` block and says to pass that text as `yaml_text`.
2. **`suggest_fix_for_diagnostic`** (instructed by `add_error_handling`) — exists as an MCP
   function, exposed to **no intent at all**. Already shipped; found by auditing the prompt against
   the slice, not by another eval.
3. **"the moment `verify_playbook` passes, END by calling `emit_playbook_offer`"** — unconditional.
   That card's accept path **pushes (creates)**, so obeyed while a playbook is open it saves a
   **duplicate** and leaves the analyst's playbook untouched. Now conditional: editing the open
   playbook ends with the complete YAML in a fence (their Save updates in place); a NEW playbook
   still ends with the offer.

Also written down for the first time: **the widget saves the LAST ```yaml fence over the open
record**, so a fragment — or an illustrative snippet placed *after* the full playbook — silently
deletes every step it omits. And untouched steps must stay byte-identical **including `name:`**,
since names are how F3's graft matches an edit to the live records it updates.

**Live on 206** (`scripts/_p4_prompt_probe.py`, real LLM, real box, grounded via
`entity.playbook_yaml` — F1's shipped contract, not S2's `--ground` rehearsal):

| prompt | runs | result |
|---|---|---|
| **new (P4)** | **3/3 PASS** | `verify_enhancement`, a complete fence, `diff changed=1 added=0 removed=0`, playbook **runs and emits BRAVO** |
| **old**, same grounding (the control) | **1/2 FAIL** | the failing run emitted `emit_playbook_offer` and **no yaml fence at all** — the duplicate-instead-of-edit path, exactly as predicted from the code |

**So F1's grounding alone yields a correct EDIT but still loses the SAVE about half the time.** The
control is what makes P4 a fix rather than a guess; it is stochastic, which is how it survived.

**The durable part is the test, not the wording.** The prompt is now checked against
`tools_for_intent("build")`, so it cannot name a tool the persona does not have — that catches (1)
and (2) mechanically, and would have caught one of them before S2 spent four live runs on it. Prose
cannot be trusted to stay true to a toolset that moves underneath it: C5's scoping silently removed
`get_record` from build and this prompt never noticed. 5 of the new tests go red against the old
prompt; the rest are invariance guards, including one that fails if the tool-mention parser ever
stops seeing anything.

### ✅ RESOLVED (see §"Session 3d" at top) — historical: the framework's reference DB was clobbered, and P4 could not commit

> Resolved 2026-07-17: the pre-commit gate was decoupled from the mutable dev cache (`071bd57`) and
> a warmup guard added (`285c032`); P4 committed `d9a18b7`. The account below is kept for the
> root-cause detail.

Running connector ops **locally** fires the connector's warmup, which `db_write`s the **box's**
catalog into `db_path` — and under `FSRPB_DEV=1` that resolves to the framework's dev store
`data/fsr_reference.db`. My probes took it from **724 connectors → box 206's 21**. The DB's own
ledger is the proof: `select ts, connectors, operations from warmup_runs` shows my run today at
`21 / 280`, matching the file's current state exactly.

- ~10 `fsr_playbooks` tests degrade to **skips** (`fortinet-fortisiem not in reference DB`) — a
  green-looking run that quietly stopped testing anything;
- **31 `tooling` tests FAIL** (`unknown_connector`) → the repo's **pre-commit gate refuses the P4
  commit**. The hook did its job; P4 is written, live-proven, and **not committed**.

**Restore is not clean, which is why it is parked rather than guessed at:**
- gitignored (`.gitignore:13`) → no `git restore`; no intact copy anywhere on the machine (every
  other `fsr_reference.db` is the shipped *slim* catalog, 12–23 connectors);
- `data/fsr_reference.json` holds all 714 but is a **reduced** export — no `config_schema_json`, no
  `parent_param_name`/`condition_value`, no `observed_type`/`coerces_from`. Reseeding from it
  restores connector *names* while silently degrading the corpus, including the columns the
  param-type tests read. `fsrpb refresh` is DB → JSON; there is no importer.
- the real rebuild is `tooling/probes/probe_connectors.py` against **a box that has those connectors
  installed** (the 2026-06-26 probe captured 724 / 6867). Which box that is, is the open question.
  Its local fallback `fortisoar-rpm-extracted/*/info.json` does not exist here.

Current state backed up to `/tmp/fsr_reference.db.post-my-warmup.bak`.

**Prevention (one line, use it every time):** `FSRPB_DB` (`fsr_playbooks/_db.py:42`) wins over the
repo DB, so point it at a scratch copy *before* running any connector op locally:
`cp <framework>/data/fsr_reference.db /tmp/probe.db && export FSRPB_DB=/tmp/probe.db`.

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

| Repo | State (session 3) |
|---|---|
| **connector** (`ConnectorsV2/fsr-playbook-builder`) | F1+F3 (`779ae18`) + manual_input card (`56bd5b1`) **committed + PUSHED**. **Shipped to box 206 as 0.4.73**, 10/10 workers recycled. Grounded S2 eval **3/3 live**; SUBMIT live-clean. Suites green. |
| **fsr_all_widgets** | STATUS.md + this plan updated for session 3. Local. |
| **widget** (`widgets-src/fortiaiAgenticAssistant`, its OWN repo — gitignored from the parent via `widgets-src/*/`) | F1 seed `7743229` on top of `3b5705b` (P3). **Unpushed + UNSHIPPED** — 8+ of the user's commits sit ahead of the remote, so pushing mine pushes theirs. ASK FIRST. The user's manual_input dynamic_list WIP is uncommitted in this repo (foreign — untouched). |
| **framework** (`fsr-playbook-framework`) | P4 (`system_prompt_build.md` + `test_build_prompt_skeleton.py`) staged, **UNCOMMITTED** — blocked by the reference-DB clobber (§"BLOCKER"). |

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
- ~~**P2** — Harness: fixture deploy/clone/teardown, trigger+wait, marker-record assertion helper,
  `diff_versions` assertion helper, run cleanup.~~ ✅ **DONE** (connector `f52af4c`, per STATUS.md
  session 3c). Built as `scripts/eval_harness.py` (`EvalHarness`: `deploy`/`clone`/`track`/
  `snapshot`/`version_json`/`ai_snapshots`/`diff`/`run`/`new_records`/`emit_marker`/`cleanup`) +
  `assert_diff_only` (the `diff_versions` oracle) + `eval_fixtures/`. Wired into `eval_s1_create.py`
  and `eval_s2_modify.py`. It encodes every gotcha below and proves its own teardown.

  **Started from the working prototype** (this is how it was built, not a TODO):
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
- ~~**P4** — flesh out the designer build prompt against its now-guaranteed context.~~ ✅ **DONE
  2026-07-17, live-proven 3/3 on 206 with a 1/2 control on the old prompt** (see the resume block).
  It was mostly deletion: three instructions were uncallable, one of them the cause of S2's 0/4.
  **UNCOMMITTED** — the framework's pre-commit gate is red because my local probes clobbered its
  reference DB (see the blocker above).
- **P5** — scenarios, in order: S2 (smallest, sharpest oracle) → S1 → S5/S6/S7 → S3 → S4 → S8.
  **S2 is now effectively green** — `_p4_prompt_probe.py` runs S2's shape end to end (edit lands,
  diff shows only the asked-for change, the playbook runs and emits BRAVO), 3/3. Folding it back
  into `eval_s2_modify.py` needs the F1+F3 connector on the box; today the probe runs the turn and
  the push locally so it needs no ship.

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
