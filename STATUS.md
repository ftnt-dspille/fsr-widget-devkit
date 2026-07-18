# STATUS — master tracker

Single source of truth for what's open, in progress, and done across the FSR
widgets work. The detailed plans live in their own docs (linked below); this file
is the index. Update it when a thread changes state; move finished items to
**Done / archived** rather than deleting them.

_Last updated: 2026-07-18 (session 3g — P5 scenario matrix: **S1 + S7 committed**, linter gap **fixed + committed** with full gate green. S5 ground truth characterized on 206. See top entry.)_

> **▶ 2026-07-18 (session 3g) — P5 matrix: linter gap fixed, S1 + S7 landed, S5 grounded.**
> Continued the build-persona scenario matrix (plan: `docs/plans/build-persona-validation-plan.md`).
> - **Linter gap FIXED + committed** (framework `4778ec8`): the `create_record`-args-outside-
>   `arguments:` class (module:/resource: as siblings of type:) that compiled clean and crashed only
>   at runtime (`insert_data() takes at least 2 positional arguments`). Root cause was `parser.py`
>   silently dropping unrecognized step-level keys — NOT the arg-validator. Fix: check each step's
>   top-level keys against `_UNIVERSAL_STEP_KEYS | _STEP_KEYS_BY_TYPE[type]`, emit an `unknown_param`
>   **warning** (not error, so a harmless extra key can't hard-fail a compile) pointing at
>   `arguments:`; decompiler escape keys allowlisted. 6 new parser tests, 33 green. **Full pre-commit
>   gate passed** (the decoupled tooling fixture from 3d held). Needs a framework release + connector
>   re-pin to reach the box.
> - **S1 (create from natural language) committed** (connector `9ae4015`): `scripts/eval_s1_create.py`
>   + `EvalHarness.track()` for create-scenario teardown. Was validated 6/6 live on 206 last session;
>   now committed. Alert name is FIXED (grade the playbook, not the model's copy-typing).
> - **S7 (linter negative test) BUILT + committed** (connector `ceade46`): `scripts/eval_s7_lint.py`
>   — deterministic, box-free, runs `validate_yaml`/`compile_yaml` in-process against the editable
>   framework via the repo's test bootstrap. Table of broken fixtures, each asserting a
>   **(code, severity)** diagnostic (severity is load-bearing — `missing_field` is an ERROR for an
>   absent type but a soft WARNING corpus-hint on a good playbook). Anchor = the create_record gap
>   above; GOOD control must trip none of them. 4/4 green.
> - **S5 ground truth characterized on 206** (throwaway probe, not kept): the anchor fixture RUNS →
>   `status=failed`, `why_failed`/`diagnose_run` both give clean structure: `failing_step='Emit'`,
>   `insert_data() takes at least 2 positional arguments`. So S5's oracle is well-defined, and the
>   SAME fixture doubles as the S5/S6 runtime-failure playbook.
> - **🔜 S5 design crux (the next real chunk):** the assistant's build slice has
>   `diagnose_yaml_against_pb_execution(yaml_text, pb_execution)`, but it has **no channel to a failed
>   run's execution env** — mirroring exactly how S2 surfaced F1 (no read channel). S5 will likely be
>   an investigation + a grounding change (feed the failed run's `pb_execution` into the build turn),
>   not just an eval script. THEN S6 (apply the fix → it runs), S3, S4, S8.

> **▶ 2026-07-17 (session 3d) — reference-DB clobber blocker RESOLVED; P4 committed.**
> The framework pre-commit gate no longer depends on the mutable, clobber-prone dev cache
> `data/fsr_reference.db`.
> - **Gate decoupled** (framework `071bd57`): `tooling/tests/conftest.py` now copies a small
>   COMMITTED fixture `tooling/tests/fixtures/tooling_reference.db` (~13 MB — 14 test-referenced
>   connectors at full param fidelity + the infra tables the compiler needs) to a temp file and points
>   `db_path`+`$FSRPB_DB` there (tmp copy because compile paths connect read-write and would otherwise
>   trip pre-commit's "files modified by hook"). Regenerate via
>   `tooling/tests/fixtures/build_tooling_fixture.py` — sources the committed slim catalog + the public
>   Fortinet RPM repo (`repo.fortisoar.fortinet.com`; `apivoid/aws-access-analyzer/recorded-future/
>   http/claroty-xdome` probed at full fidelity), regenerates `op_safety` via `probe_op_safety`.
>   `cli.py --db` now honors `default_db_path()`/`$FSRPB_DB`. **Repo-wide gate: 1852 passed, 0 failed**
>   (silent skips 12 → 6 — the fixture restored `fortinet-fortisiem`/`cyops_utilities` the clobber had
>   removed, so coverage went UP).
> - **P4 committed** (framework `d9a18b7`): open-playbook edit-in-place (final ```yaml fence → Save
>   updates the open record) vs new-playbook `emit_playbook_offer`; + skeleton test pinning both
>   terminal-action branches.
> - **Warmup guard** (connector `285c032`): `operations._warmup_clobber_refusal()` refuses a warmup
>   that would write the framework dev cache unless `FSR_REFERENCE_DB`/`FSRPB_DB` points elsewhere or
>   `FSRPB_ALLOW_DEV_DB_CLOBBER=1`; inert on-box. Framework primitive `_db.warmup_write_path()`. Guard
>   test green.
> - **Loop closed (session 3e, same day): all commits PUSHED + widget SHIPPED + on-box proof.**
>   - Pushed: framework `d9a18b7` (github/main), connector `285c032` (origin/main), widget
>     `7743229` (origin/master).
>   - **Widget shipped to 206: `fortiaiAgenticAssistant-1.2.25`** (ship-verify: 110 e2e + unit green,
>     deploy confirmed to 10.99.248.206).
>   - **Real widget-path proof, 3/3 live on 206** (connector `6a136ec`): new `eval_s2_modify.py
>     --widget-path` seeds `entity.playbook_yaml` exactly as the deployed widget does (read into the
>     connector's OPEN PLAYBOOK block) — the SHIPPED grounding channel, not the `--ground` prompt
>     rehearsal. Every run: grounded read → complete YAML fence (open-playbook edit, no offer card) →
>     `update_playbook ok method=put` → snapshot → `diff changed=[('Emit','arguments')] added=0
>     removed=0` → playbook runs to `finished`. Committed + pushed.
> - The full 724-connector dev cache is still clobbered locally (21 connectors) — no longer blocks
>   anything; rebuild from a full-catalog box when convenient.

> **▶ 2026-07-17 (session 3c) — build-persona validated end-to-end; connector 0.4.73 live on 206.**
> - **F1** (read path / `decompile_playbook`) + **F3** (graft-by-name write) committed `779ae18`,
>   **pushed**; **manual_input awaiting-form card** (EMIT + clean-green SUBMIT `respond_manual_input`
>   no-owners retrieve→resume) committed `56bd5b1`, **pushed**. Both shipped to 206 as **0.4.73**
>   (10/10 workers recycled, warmup OK).
> - **Grounded S2 eval 3/3 live on 0.4.73**: every run `update_playbook ok method=put`,
>   `diff changed=[('Emit','arguments')] added=0 removed=0`, snapshot taken, `status=finished`.
> - **SUBMIT** live-clean inside the input window (`scratchpad/freshfwd.py`): fresh trigger → pause
>   → forward `forwarded:True` → run advances to `finished`.
> - **STILL OPEN (do NOT report as shipped):** P4 framework prompt is written + live-proven but
>   UNCOMMITTED (blocked by the reference-DB clobber, below); widget-side F1 seed `7743229` committed
>   but unpushed + unshipped (eval used `--ground` rehearsal, not the widget path on-box).

> **▶ 2026-07-17 (session 3b) — P4 DONE + live-proven; 🔴 reference DB was clobbered (now resolved, see 3d).**
> **P4** (framework, **UNCOMMITTED**): the designer prompt was promising three things that don't
> exist, each checked against the real `tools_for_intent("build")` slice, not inferred —
> (1) *"call `analyze_playbook` on [the IRI]"*, but that tool is `required: ['yaml_text']` with **no
> IRI param** and nothing in the build slice reads a live playbook: **this is the sentence behind
> S2's 0/4**; (2) `suggest_fix_for_diagnostic`, exposed to **no intent at all**; (3) "always end with
> `emit_playbook_offer`", whose accept path **pushes/creates** — so with a playbook open it saves a
> **duplicate** and leaves the analyst's untouched. Live on 206 (real LLM, grounded via F1's shipped
> `entity.playbook_yaml`): **new prompt 3/3 PASS** (`verify_enhancement`, complete fence, `diff
> changed=1 added=0 removed=0`, runs → BRAVO) vs **old prompt 1/2 FAIL** as the control (the failing
> run emitted an offer card and **no yaml fence at all**). So F1's grounding alone gives a correct
> EDIT but still loses the SAVE ~half the time. Durable piece = a test pinning the prompt against the
> slice, so it can't name a tool the persona lacks. **S2 is now effectively green.**
> 🔴 **BLOCKER, my fault:** running connector ops locally fires the warmup, which `db_write`s the
> **box's** catalog into `FSRPB_DEV`'s `data/fsr_reference.db` → **724 connectors → 206's 21**
> (proof: `warmup_runs` ledger). ~10 `fsr_playbooks` tests silently became skips; **31 `tooling`
> tests FAIL** → the framework **pre-commit gate refuses the P4 commit**. Gitignored (no `git
> restore`), no intact copy on the machine, and `fsr_reference.json` is a *reduced* export (missing
> `config_schema_json`/`condition_value`/`observed_type`) so reseeding is lossy. Real fix =
> `probe_connectors` against a box that has those connectors (the 26 Jun probe got 724/6867) —
> **which box is the open question.** Backup: `/tmp/fsr_reference.db.post-my-warmup.bak`.
> **Prevention:** `export FSRPB_DB=/tmp/probe.db` before ANY local connector op.
>
> **▶ 2026-07-17 (session 3) — F3 FIXED + live-proven on 206 (uncommitted).**
> `_graft_live_ids` now pairs compiled↔live records by **uuid first, then name** (routes: by the two
> steps they connect), and a paired record takes the live **uuid as well as the `@id`** — so the live
> identity survives the edit. Taking the uuid strands every reference to it, so the graft remaps
> route `sourceStep`/`targetStep`, a step's `group`, and the workflow's **`triggerStep`**. Ambiguous
> names pair nothing rather than guess. Live on 206 via `scripts/_f3_graft_probe.py` (no LLM), case D
> (designer-built — the persona's premise): `kept=0 new=2 dropped=2` → **`kept=2 new=0 dropped=0`**;
> `diff_versions` `added=2 removed=2` → **`changed=1 added=0 removed=0`** (step `Emit`, field
> `arguments`); the playbook **runs, `status=finished`, emits BRAVO**. The plan's chosen oracle is
> restored. Case C (compiler-created) still updates — no regression. Connector **303 root** + **227
> triage** green; 9 of 13 new graft tests provably RED against the old graft.
> **The probe runs `update_playbook` LOCALLY in-process against the box** (local-dev loop → .env pyfsr
> client) — deliberate, so proving a graft change does not ship the user's in-flight WIP to an
> appliance. **Two things only the box caught:** `triggerStep` (13 green unit tests, then the live PUT
> rejected on a `triggerstep_uuid` FK — tests inherit the fix's blind spots), and that **F2 was
> mischaracterised** (the uuid collision is closed; what remains is an honest `(name, collection)`
> refusal for an ask only reachable by hand). ⚠️ `test_hitl_durability.py::test_manual_input_unreachable_run_degrades_cleanly`
> is red and is **not mine** — identical failure with the old graft pinned back in (the user's
> `manual_input` WIP). Still **UNCOMMITTED** and unshippable alone: `operations.py` interleaves my
> F1+F3 work with the user's manual_input WIP.
>
> **▶ 2026-07-16 (session 2) — Build-persona validation: P2 done, S2 answered it, F1 FIXED (uncommitted).**
> Plan + **RESUME BLOCK**: `docs/plans/build-persona-validation-plan.md` (read its resume block
> first — it carries repo-by-repo state, the foreign-WIP list, and the P2 gotchas).
> - **Goal (unchanged, unmet):** validate that agentic playbook creation actually works and the
>   assistant is genuinely useful. Bar = **the playbook runs and does the asked-for thing**, not
>   "the right tools were called". 8 scenarios (S1–S8); build persona is the designer's mount
>   intent; save-as-playbook stays triage's job (the earned handoff).
> - **✅ P0** — C2 write path fixed for real (see the entry below). Connector **0.4.68**, pushed,
>   live-verified on 206.
> - **✅ P1** — every AI edit now snapshots into the playbook's Versions tab first, **fail-closed**.
>   Live-verified: snapshot holds the user's PRE-edit work, the edit lands, restore reverts it.
> - **✅ P3 — build surface cut** (widget commit `3b5705b`, **local/unpushed**): render step
>   (`step_test`) parked behind `config.enableStepVerify` (default OFF — authoring aid, not on the
>   compile/push path, never called by the build prompt); `config.defaultIntent='build'` **retired**
>   (it was the one way to reach build with nothing to build against; the edit-page picker is gone —
>   a control that silently does nothing is its own lie); `session_id` threaded so a restore point
>   reads `ai-pre-edit <session>`. Build is now the DESIGNER's mount intent — *not* "designer-only":
>   the earned handoff (`openDraftInBuild`) still enters build after a real hunt, WITH a draft in
>   hand. Widget 695 jest + 107 e2e green (19 tests across 6 specs had to be rewired — they all used
>   `defaultIntent='build'` to reach the YAML pane).
> - **✅ P2 — the eval harness** (connector `f52af4c`). `scripts/eval_harness.py` +
>   `eval_fixtures/`; `make eval-selfcheck ENV=<file>` runs the whole S2 shape live on 206 with the
>   AI taken OUT (deterministic pyfsr edit), so a failure there is a harness bug, not a finding. It
>   proves its own teardown (alerts AND run records). 19 unit tests pair every oracle with a case it
>   must REJECT — an oracle that only ever passes is this plan's original bug one level up.
> - **🔴 S2 — built (`b6c8b1e`), and it answered the question: the assistant is NOT the problem.**
>   Ungrounded: **0/4** runs, each dead-ending in `analyze_playbook` with nothing to pass it, asking
>   the analyst to paste in the playbook already on their screen. Handed the YAML (`--ground`, the
>   only variable changed): it read, verified, and returned a correct one-field edit first try.
>   Three live blockers, ALL reproducible with **no LLM** (`scripts/_s2_409_probe.py`):
>   - **F1 — the build tool slice cannot READ a live playbook.** `get_record`/`search_module_records`
>     scoped out of build by C5; `search_playbooks` = offline corpus; `analyze_playbook` takes
>     `yaml_text` only. The widget assumed the opposite in a comment ("the connector can also fetch
>     by iri with its own SOAR tools" — it cannot), and "⊕ Pull in this playbook's steps" fetched
>     `?$relationships=true` then **dropped the steps** in `_composeEntitySummary`.
>   - **F2 — `update_playbook` 409s on any playbook it did not itself compile.** `_graft_live_ids`
>     matches steps **by uuid**, so editing a CLONE collides with the original (probe A 409s; probe C,
>     identical body vs the fixture itself, `ok=True`). Real bug: duplicate a playbook → AI edit
>     always fails. P0's live-verify missed it (it built its collection FROM the compiled envelope,
>     so the uuids matched by construction).
>   - **F3 — on a designer-built playbook the graft matches nothing** → `ok=True` but
>     `kept=0 new=2 dropped=2`: every step destroyed and recreated. **This defeats `diff_versions`**
>     (uuid-keyed), so the plan's own oracle only works against compiler-created fixtures.
> - **✅ F1 FIXED and live-proven on 206 — but UNCOMMITTED.** New connector op **`decompile_playbook`**
>   (the READ mirror of `compile_yaml`; the framework's `decompile_to_yaml` existed, it just was not
>   exposed) + the widget calls it at designer mount → seeds `currentYaml` → carries the YAML on
>   every build turn as `entity.playbook_yaml`. Same scenario, before → after: 8 failed
>   `analyze_playbook` calls → a correct edit; **409 → `ok method=put`**; still-ALPHA → **runs and
>   emits BRAVO**. Two deliberate calls: the read always hits the LIVE connector even in mock mode
>   (a mocked answer grounds the assistant in a playbook that isn't the one on screen — worse than
>   no grounding), and the YAML is **never truncated** like the capped record-data section (the
>   assistant edits that text and Save compiles it back OVER the real record, so a clipped copy
>   returns as a playbook with the analyst's steps silently deleted — it fails closed instead).
>   Also corrected `update_playbook`'s info.json description, which still advertised the
>   `import_jobs` fallback deleted 3 releases ago.
>   Green: widget **708 jest / 60 suites** + e2e smoke 14/14; connector **291 root** + **227 triage**.
> - **🔜 NEXT: F3 — graft by step NAME, not uuid** (`operations.py` `_graft_live_ids`). It is the ONLY
>   thing between S2 and green: the edit is already behaviourally perfect, the diff just reads a
>   one-field change as a total rewrite. The same fix closes F2 (which is currently only *dodged* —
>   the decompile carries the clone's real name, so the uuids no longer collide; two playbooks
>   sharing names would still 409). THEN P4 (designer prompt) — and S2 is now the argument for
>   keeping it last: the grounded run shows the prompt is not what's broken.
> - **⚠️ NOTHING of the F1 fix is committed, and it CANNOT be cleanly committed by itself.**
>   `operations.py` and widget `view.controller.js` each hold the user's in-flight
>   `manual_input`/`resume_playbook` work interleaved with mine. Mine: connector `operations.py`
>   (`decompile_playbook`, `_live_collection_envelope`, `_entity_context_block`'s OPEN PLAYBOOK
>   block), `info.json`, `pydantic_models.py`, `tests/test_operations.py` (+13); widget
>   `view.controller.js` (`_seedPlaybookYaml`, `_entityPayload`), `fsrPbAgent.service.js`
>   (`decompilePlaybook`), `tests/playbook.yaml.seed.test.js` (new, 7).
>   **Not shipped** — the box runs the user's 0.4.72, which has no `decompile_playbook`; a ship would
>   carry their WIP (incl. whatever currently reds `tests/test_hitl_durability.py`, which passes at
>   HEAD — so it is theirs, not mine).
> - **⚠️ Foreign WIP left untouched:** widget `fsrPbRender.ts`/`view.html` (manual_input
>   dynamic_list), connector `fsr_soc_triage/tools_playbook.py`, `tests/test_persona_resume_persist.py`.
> - **🔑 The lesson, twice over:** every unit test stayed green through a feature that had never
>   worked once — and *this* session's first S2 draft reported **0/3 against the assistant** for
>   failing to call `update_playbook`, which is a WIDGET op in no tool slice that it could never
>   have called. Grade the thing that can actually act.

> **🔴→✅ 2026-07-16 — C2 was NEVER fixed, and now is. Plus: AI edits were unrecoverable.**
> Plan: `docs/plans/build-persona-validation-plan.md`; memory
> `update_playbook_write_path_at_identity`. Connector **0.4.68** on 206, pushed.
> - **The 2026-07-13 "C2 RESOLVED / LIVE-VERIFIED" entry below (and its commit
>   `8597807`) is FALSE.** On 206 the PUT 409'd on *every* attempt and the edit never
>   landed. The earlier entry at the bottom of the Three-pillar row — "both update
>   paths fail … the committed claims are unverified-and-wrong" — was **right all
>   along**; the later "resolved" entry overwrote a correct diagnosis with a wrong one.
> - **Real root cause (live-diagnosed, not inferred):** FortiSOAR decides
>   **create-vs-update on `@id`**, not `uuid`. The compiler emits `uuid` and no `@id`,
>   and its uuids are *deterministic* — so they collide EXACTLY with the live records
>   and the `$relationships=true` cascade tried to INSERT over them
>   (`UniqueConstraintViolationException … fields (uuid)`). `$relationships=true` was
>   never the missing piece; the identity was. The old entry's GET-modify-PUT probe
>   passed only because a GET's steps already carry `@id` — that never generalised to
>   the compiled body the op actually sends.
> - **Fix:** read the live workflow → graft its `@id`s onto the compiled body → PUT.
>   New steps stay `@id`-less and are created; live steps absent from the body are
>   dropped by the cascade.
> - **`import_jobs merge_replace` fallback DELETED, not fixed.** It wasn't the
>   designer's mechanism (re-importing the WHOLE collection to change one step), and
>   live it returned `ok=True` while applying nothing — turning every PUT failure into
>   a **phantom success**. It existed only because the PUT was broken. `update_failed`
>   is now honest and carries the restore point.
> - **🔴 Separately: `create_version` appeared NOWHERE in the connector.** Shipped AI
>   edits had **no rollback point** — and the `$relationships` cascade that makes the
>   write work is exactly what makes it destructive (it replaces nested step/route/group
>   records). `update_playbook` now snapshots into the playbook's **Versions tab**
>   before touching it, **fail-closed** (no restore point ⇒ no edit). Prunes only its
>   own `ai-pre-edit` snapshots at FortiSOAR's 20-cap; never a human's.
> - **LIVE-VERIFIED on 206 (0.4.68)**, full loop: `method=put`, snapshot holds the
>   user's *pre-edit* work, the edit lands, restore reverts it. Probe:
>   `scripts/_p1_snapshot_live_confirm.py` (gitignored per `scripts/_*` convention).
> - **Lesson, recorded because it cost real time:** a commit message and a docstring
>   both claimed "live-verified on 8.0" for 3 releases while the feature never worked,
>   and every unit test was green throughout. **A commit message is not evidence; only
>   the box is.** This is precisely the gap the behavioural eval bar exists to close.

> **✅ 2026-07-16 — Lookup-tool hardening + persona-gated `run_playbook` (from live 206 session review).** Reviewed real agent sessions on 206; found three systemic lookup failures + a missing playbook-exec capability. Memory: `soc_triage_lookup_hardening_and_run_playbook`.
> - **#1 clean error envelope** (`_live_crudhub.py`): recovers the real HTTP status behind a loopback error instead of collapsing to a synthetic `599`, and strips the internal `https://localhost` host. A 404 now surfaces as clean `not_found` across every tool (was a raw `http_599` blob + URL leak). **LIVE-VERIFIED on 206** (fabricated uuid → clean not_found).
> - **#4 field-filter search** (`search_module_records`): `filters={field:value}` arg AND a `field:value` written into `q` route to a real equality filter instead of full-text `$search` that silently returned zero for existing records (9 observed false negatives, e.g. `datakey:interface_stats`). Empty results carry a hint; `$search` fallback keeps a bad field from regressing. **LIVE-VERIFIED on 206** (`datakey:interface_stats` → total 1, matched_by=filter).
> - **#2 module suggestion** (reactive, never blocking — the ref catalog isn't authoritative for custom modules): a genuine 404 on a bad module route is enriched with the nearest known module. **LIVE-VERIFIED on 206** (`ztpfRunGroups` → suggestions `["ztpf_run_groups"]`).
> - **#5 `run_playbook`** (new `tools_playbook.py`, persona-gated): triggers a deployed playbook via pyfsr's typed `client.playbooks.trigger` (crudhub on-box / pyfsr off-box); motivating case = validate a metadata-source script by running "Get Metadata Source Data on Device". **Allowlist is advisory; human approval is the gate** — `run_playbook.auto` → tier 2 (auto-run), `allow` or unlisted → tier 3 approval card → runs on approve (flagged `unlisted`), no persona ⇒ refused. Dynamic tier via framework `set_run_playbook_auto_resolver` hook (getattr-guarded → older pinned wheel degrades to always-tier-3). **Live on 206:** correctly registered agent-only (excluded from the approval-bypassing `call_mcp_tool` path like the record writes; a live test caught + fixed the library dev-path `run_playbook` shadowing that path).
> - **SHIPPED to box .206** as connector **0.4.63** (`make ship ENV=.env.206`; all 10 workers, warmup ok). Connector imports cleanly against pinned **fsr-playbooks 0.4.26** (getattr guard verified). Tests: connector 319 green; framework tier/dispatch 61 + llm 1201 green (5 pre-existing live-`.env` e2e failures unrelated).
> - **Commits LOCAL/UNPUSHED:** framework `bf237ab` (resolver hook), connector `0542d6a` (core) + `0.4.63` fix commit. The unrelated `test_persona_resume_persist.py` session-id WIP left untouched.
> - **✅ (A)+(B) DONE 2026-07-16 — LIVE-PROVEN on 206.** Framework **0.4.27** released to PyPI (resolver hook `bf237ab`; tag+main pushed); connector pin→0.4.27 (preflight OK, 63 symbols) + shipped as **connector 0.4.64→0.4.66** (10 workers, warmup ok, health openai-reachable). Authored Key Store persona `fsr_assistant_profile:ztpf_metadata_sources` (`_upsert_ztpf_metadata_persona.py`; run_playbook.allow=auto=[name,uuid]). Live turn grounded on `ztpf_metadata_sources/ecaab084-…`: model CALLED run_playbook, `stop=end_turn` (no card) ⇒ **tier-2 auto-ran** → real trigger. Connector pin+info.json UNCOMMITTED (deploy.sh doesn't commit).
> - **🐛 run_playbook trigger-route BUG FOUND+FIXED (0.4.66, live-verified).** First run failed CS-WF-5 `list object has no element 0` — `run_playbook` used pyfsr `trigger` (manual `notrigger` route), which doesn't populate `vars.input.records[0]`. The validation playbook fires from a **record-action** trigger (`cybersponse.action`, route `81d0acd1-…`) needing `trigger_action(route, module, record_uuid)`. Fixed `tools_playbook.py`: `_record_action_trigger()` inspects the definition + routes record-action playbooks via `trigger_action`; `_task_id_of()` handles the `/action/` route's plural `task_ids` + waits. Tests +4 (18). Live: run now advances to **`awaiting`** (was `failed`) → record reached the run; pauses on device/manual-input = graceful `not_finished_awaiting_or_slow` seam (#5b follow-up to fully finish).
> - **✅ #5b resume_playbook DONE + LIVE-VERIFIED (connector 0.4.69).** New persona-gated agent-only `resume_playbook(run, decision)` = thin wrapper over pyfsr `PlaybooksAPI.approval` (approve=primary/reject=first-non-primary/label). Fixed `run_playbook` follow (record-`/action/` task_id doesn't correlate via log_list → follow via `wait_for_run`, surface `awaiting_input` + `run_pk`). Attached pyfsr `ManualInputAPI` as `client.manual_input` so `approval()` works on-box. Live on 206: agentic turn `run_playbook`→`awaiting_input`(pk 2973)→agent `resume_playbook(reject)`→run 2973 `finished`. **✅ 0.4.70: shows + fills the FORM** — `awaiting_input` carries `awaiting.fields` (from `input.schema.inputVariables`) + `options`; `resume_playbook` gained `inputs=` (submits via pyfsr `manual_input.answer`). Live: turn surfaced the real "Choose a Manager and a Device" fields + Ok/Cancel. Tests 29 (suite 226). Open: live-submit a valid device value (green data run); widget chat-card rendering of the form.
> - **REMAINING:** (C) **#3 prompt guard** (only get_record IRIs from prior results; don't invent UUIDs) + **#6 `list_related_records`** (paginated/projected traversal). (D) **#5b manual-input handling inside chat** (paused-run detection → prompt as chat turn → `resume_playbook`; chat-contract change; `run_playbook` already returns `not_finished_awaiting_or_slow` as the seam).

> **✅ 2026-07-16 — Persona Spine Unification (PL→P6) COMPLETE + LIVE on box 206.**
> Collapsed the privileged hardcoded `triage`/`build` intent system and the Key
> Store persona system into ONE resolution spine. Plan (local-only):
> `fsr-playbook-framework/docs/plans/PERSONA_SPINE_UNIFICATION_PLAN.md`; memory
> `persona_spine_unification_plan`.
> - **P3 (connector `5e786b8`):** grounding/preflight/CaseState is now
>   `ResolvedPersona.capabilities.grounding`, not an `intent=="triage"` branch. A
>   Key Store persona opts in via `jSONValue.capabilities.grounding` and grounds on
>   its OWN prompt. P0 goldens byte-exact.
> - **P4 (framework `2e754d8`, released 0.4.24):** `fsr_playbooks/llm/tool_result.py`
>   tool-output envelope contract (dict | list[dict]; fail-open, strict under
>   `FSRPB_STRICT_TOOL_OUTPUT`); `dispatch` validates every tool output; all 56
>   registered tools conform.
> - **P5 (connector `8c2bf05`):** `profiles.validate_persona_record()` authoring
>   lint + `docs/PERSONA_AUTHORING.md`.
> - **P6 (connector `1136637`):** PLAN.md one-spine section; `TRIAGE_BUILD_AUDIT_PLAN`
>   marked superseded.
> - **SHIPPED to box .206** (`.env.ztpf-8.0`) as connector **0.4.56** (`bfe595c`);
>   framework **0.4.24 on PyPI** (main+tag pushed). On-box `health_check` verified:
>   `p4_tool_output_contract.present=true` (definitive — module imports in worker)
>   + `c5_build_scoping.symbol_present=true`. Tests: framework 712, connector root
>   248, triage 186, PL 5 — all green.
> - **Connector `main` is LOCAL-only** (box got it via `make ship`, not git origin).
> - **REMAINING = deferred GA/live only:** (1) T2 containment-drift grade on a
>   drift-exhibiting model (GLM5 doesn't repro; durable fix = rebalance
>   `30_what_you_do.md` L100-132), (2) live agentic-turn confirm of a Key Store
>   grounding persona on 206.

> **✅ 2026-07-15 — Widget SHIPPED (1.2.17) to GA/159 + 168; GA demo-readiness
> VERIFIED end-to-end.** `fortiaiAgenticAssistant 1.2.17` (C3 Diagnose & fix)
> deployed to BOTH boxes via `ship.sh` per-box `FSR_ENV_FILE` (same version, `.env`
> never mutated). **Built-in FortiAI demo readiness (native `/api/ai/*`, 8.0-only):**
> - **GA/159 (`.env.fsr-ga` = 10.99.249.159:13000): READY.** FortiAI enabled,
>   provider "Fortinet FortiAI", reasoning profiles Low/High, **5 MCP servers
>   registered** (FortiSIEM, SOC Framework, Utility Tools, FortiSOAR Playbook
>   Management, FortiSOAR Module Management), native MCP gateway usable
>   (`client.mcp` soc=9 tools, modules=query_records). **A real AI investigation ran
>   end-to-end** on the newest alert ("S3 Exfil …") → 9-phase pipeline
>   (normalization→verdict→next_action), verdict **Malicious**, findings attributed
>   to source agents (threat_intelligence). Connector 0.4.48 healthy, anthropic
>   reachable.
> - **168 (10.99.250.168): native FortiAI ABSENT** — `/api/ai/*` routes 404 (older
>   build predating the 8.0 FortiAI/MCP gateway). Only the connector-backed widget
>   chat works there; the AI-investigation + MCP-integration demo must run on GA.
> - **pyfsr surface bug found:** `records("alerts").first()` returns a typed `Alert`
>   that the `/api/ai/triage/alert` POST can't JSON-serialize (the
>   `trigger_ai_investigation.py` example's own pattern fails); pass a plain `dict()`.
>   Worth a small pyfsr fix. MCP setup surface: `client.ai.register_and_verify` /
>   `list_mcp_servers` / `delete_mcp_server`; DeepWiki public no-auth server
>   (`https://mcp.deepwiki.com/mcp`) is a ready zero-cred "add an external MCP server"
>   demo beat (`pyfsr examples/register_and_call_public_mcp_server.py`).

> **✅ 2026-07-15 — C3 "Diagnose & fix" (value-level render patches) BUILT + green,
> box-independent, unshipped/uncommitted.** Completes the C3 apply-patch story: the
> existing "Check & fix" handles the compiler's mechanical whole-YAML `corrected_yaml`
> auto-fixes; the new "Diagnose & fix" is its render-path sibling — `analyze_playbook`
> → `suggest_fix_for_diagnostic` per diagnostic → reviewable **before→after** value
> patches (`{step_id, location, before, after, confidence, explanation, kind}`).
> One-click **Apply** only for unambiguous unique-literal swaps (re-checked at apply
> time); ambiguous/structural fixes get a "Send to chat" escape hatch that seeds the
> composer. **Zero framework/connector ship needed** — both tools were already
> `@mcp.tool()`-registered and reachable via the widget's `call_mcp_tool` seam (the
> same path C3 Verify/debug use). Widget-only change: `fsrPbAgent.service.js`
> (`analyzePlaybook`/`suggestFix`), `view.controller.js`
> (`diagnoseAndFix`/`applyValuePatch`/`sendPatchToChat`/`dismissValuePatches` +
> `$watch` guard), `view.html` panel + toolbar button. Tests: **619 jest** (+8 new
> `valuePatch.controller.test.js`) + **5 e2e** (`diagnoseFix.spec.js`); lint +
> typecheck clean. KB: 2 gotchas added to `docs/kb/drawer-widgets.md` §18.6
> (call_mcp_tool tool-reachability; unique-literal client-side apply). Also verified
> + corrected a stale STATUS note: the `tools_triage.py` reauth latent-bug follow-up
> is already RESOLVED (centralized `_shared.live_request_with_reauth`).

> **✅ 2026-07-14 — Module-scoped assistant personas + ZTPF authoring: v1 COMPLETE,
> LIVE-VERIFIED, MERGED + PUSHED.** Plan:
> `docs/plans/module-scoped-assistant-personas.md` (§7c = the authoring capability
> spec + live findings); memory `custom_module_agentic_assistant_plan` +
> `ztpf_authoring_persona_next_direction`. A per-module persona (own system prompt +
> tool subset + write scope) is defined by ONE Key Store record
> (`fsr_assistant_profile:<module>`) — no connector edit to add one. Phases 0–4 all
> DONE + live-passed on box 206 (has the ztpf_* modules; connector 0.4.50). What's
> shipped end-to-end:
> - **Persona resolution + tool narrowing + record writes** (`profiles.py`,
>   `_resolve_profile`/`_tools_for_turn`, `tools_records.py` tier-3 approval-carded
>   `create_record`/`update_record` `may_write`-gated) and **widget framing**
>   (`resolvePersona` → `personaUi` → greeting/placeholder/quick-action deck).
> - **`test_template` tool** (`tools_ztpf.py`) — the authoring spine: reads a
>   `ztpf_templates` record (its own `script` + `exampleJinjaVars` fixture), lints
>   the Jinja (`do`-extension-aware syntax + unknown-filter warnings), and RENDERS
>   through FSR's live jinja-editor on-box (`render_via:"live"` — resolves `do`,
>   `regex_replace`, `ipaddr`, and the seeded `record`). Read-only tier-1,
>   persona-allowlist-only, also callable via `call_mcp_tool`.
> - **Transient-None cache bug FIXED** (`resolve_profile_status` → `(profile,
>   definitive)`; only definitive results cached).
> - **FULL AGENTIC TURN LIVE-PASSED** (gpt-4o via `fsrpb-live`): "test render this"
>   → LLM calls `test_template` → live-rendered config; "fix the typo + save" →
>   `get_record` → `test_template` on the drafted script → `update_record` (tier 3)
>   → `stop=approval_required` with a formed approval card; left unapproved, real
>   record byte-unchanged.
> - Suites green: connector fsr_soc_triage **172**, widget **611 unit + e2e**.
> - **MERGED + PUSHED to origin** (2026-07-14): connector→`main` (gitlab) @ b4b4e03,
>   widget→`master` (gitlab) @ aef8ef1, dev-kit→`main` (GitHub) @ ca31056. (The
>   `fndn` remotes on connector+widget were intentionally NOT pushed.)
>
> **Key Store:** only `fsr_assistant_profile:ztpf_templates` exists/needed (on 206);
> modules without a record fall back to default triage/build (unchanged). Extending
> to sibling ztpf_* modules is future scope (see NEXT below).
>
> **NEXT (open, when picked up):** (1) **action-creation persona** — the
> step→action→flow write model for `ztpf_automation_actions`/`_profile_steps`
> (deliberately deferred §7c.2; needs the domain map before scoping a write tool).
> (2) Optionally extend the authoring persona to sibling ztpf_* modules via
> `bind_modules` or a new Key Store record. (3) Cleanup: box 159 still has an inert
> spike key `fsr_assistant_profile:__phase0_spike__` (remove via Key Store UI).

> **2026-07-13 — C5 fully live + release process standardized (connector 0.4.47).**
> Released framework **fsr-playbooks 0.4.22 to PyPI** the standard way
> (`make release VERSION=0.4.22` → GitHub Release → OIDC publish CI), bumped the
> connector pin 0.4.19→0.4.22, shipped. Live-verified on-box:
> `health_check.c5_build_scoping = {symbol_present: true, triage_only_count: 19}`
> (register_triage_tools extended the set) → **C5 build-slice tool scoping ACTIVE**,
> and `update_playbook` via platform execute still `method="put"`.
> **New guardrails (so the 0.4.43-class skew can't recur):** framework
> `make release` (guarded: on-main/clean/version>PyPI/tag-new/tests, then tag+push
> +gh release — fixes the tag-without-release drift that stranded v0.4.21); connector
> `build.sh` runs `preflight_framework.py` (static AST check that the pinned wheel
> defines every symbol the connector imports — fails the BUILD on skew), hard-errors
> on an un-fetchable pin, and uses a pip-capable interpreter (the uv venv has no pip,
> which had silently skipped bundling the wheel). Process doc:
> [[fsr_framework_release_process]].

> **2026-07-13 — C2 SHIPPED to box (connector 0.4.46) + live-verified through the
> platform, AND fixed a self-inflicted live-surface regression.** After the C2
> rework (below), shipping surfaced that `update_playbook` (and `push_playbook`)
> returned `crudhub_unavailable` via `/api/integration/execute` — the path the
> widget's save button uses. Added a `crudhub_transport` diag to `health_check`
> which pinpointed the cause: C5's hard `from fsr_playbooks.llm.intents import
> TRIAGE_ONLY_TOOLS` in `fsr_soc_triage/registry.py` raised ImportError against the
> pinned **fsr-playbooks 0.4.19** wheel (the symbol lives in the unshipped ~0.4.20),
> breaking the WHOLE `fsr_soc_triage` import → the crudhub bridge went unbound →
> every live op failed. Introduced by shipping 0.4.43 (first build with C5).
> **Fix (0.4.46): defensive import** — C5 scoping degrades to dormant instead of
> nuking the surface. Live-verified: `update_playbook` via `connectors.execute`
> now edits in place (`method="put"`, `live_crudhub_available: true`).
> Details: [[crudhub_unavailable_via_integration_execute]].
> **⚠️ FOLLOW-UP (C5 not fully live):** build the framework as **0.4.20** (adds
> `TRIAGE_ONLY_TOOLS`, commit `f55f396`) + bump the connector `requirements.txt`
> pin 0.4.19→0.4.20 + re-ship, or build-intent still sees the triage tools C5 means
> to exclude.

> **⛔ SUPERSEDED — THIS ENTRY IS WRONG. See the 2026-07-16 C2 entry at the top.**
> The "live-verified" claim below did not hold: on 206 the PUT 409'd every time and
> the edit never landed. The `$relationships=true` diagnosis is a red herring — the
> write turns on **`@id`**, which a compiled body lacks. The "fresh-compiled body …
> 200" bullet is the specific false one; only the GET-modify-PUT probe passed, because
> a GET's steps already carry `@id`. Kept for history, not for reference.
>
> **2026-07-13 — C2 RESOLVED: `update_playbook` reworked + LIVE-VERIFIED on 8.0
> (box 159).** Found the real in-place-update mechanism by inspecting the designer's
> beautified app JS (`app.beautified.js` — canvas Save `ye()` → `Modules` $resource
> `update` PUT) and confirmed it end-to-end with self-cleaning throwaway probes:
> - **The designer Save is `PUT /api/3/workflows/<uuid>?$relationships=true&$versions=true`**
>   with a `preparePlaybookForSave`-shaped body. The **`$relationships=true` query is
>   load-bearing** — it cascades the PUT into the nested step/route/group records.
>   The pre-rework bare `PUT` (no query) 409'd because the platform treated the body's
>   steps as create attempts (`UniqueConstraintViolationException` on a step uuid).
> - **Fix (connector `operations.py`):** inline the query into the URL (the on-platform
>   crudhub PUT bridge ignores a params dict), add `_prepare_workflow_for_save`
>   (strip `versions`, flatten `stepType`→IRI, stamp `lastModifyDate`). import_jobs
>   `merge_replace` fallback kept as a safety net.
> - **Live-verified on 8.0:** both a GET-modify-PUT round-trip AND a fresh-compiled
>   body (aligned wf uuid) 200 → replace steps in place, cascade to nested records,
>   preserve the workflow uuid. End-to-end through the REAL `operations.update_playbook`
>   via the crudhub bridge: `method="put"`, edit landed. Details:
>   [[fortisoar_workflow_update_endpoint]]. Unit tests updated (8/8), full connector
>   suite green (290 passed / 21 skipped). Committed (branch
>   `dynamic-tool-surface-connector`); **NOT yet shipped to the box** (needs the
>   `release_notes.md` WIP call before a build-path ship — see live-test note below).
> - **Unaffected by this finding:** C4 + Track B remain testable NOW on the deployed
>   stack (1.2.13 ships the editor tailoring + always-allow checkbox). C1/C5 are
>   unaffected (prompt/tool-slicing, no playbook mutation). C3 (debug UI) is
>   unblocked and box-independent.

> **2026-07-13 — live-test session (partial; box 159 window open):** Box 159 up +
> healthy: connector `0.4.42` (anthropic reachable, 10 models, crudhub bridge ok,
> contract 2.8.0), deployed widget `fortiaiAgenticAssistant v1.2.13` (44 widgets).
> **What this means for the tracks:**
> - **C4 (playbook-editor mount) + Track B (Always-allow checkbox) are testable
>   NOW on the deployed stack** — 1.2.13 already ships the editor tailoring
>   (`d2741b0`) and the always-allow checkbox (`cdb4788`); only the live drive
>   remains.
> - **C1 / C2 / C5 are NOT live-verified yet** — they're committed locally but
>   unshipped; box still runs pre-C5/C2/C1 0.4.42. Shipping them = connector bump
>   0.4.42→0.4.43 (+ widget bump for C1). **Caveat:** `make ship`→`deploy.sh`
>   auto-mutates + packages `release_notes.md`, which has unrelated mid-flight
>   WIP on `dynamic-tool-surface-connector` — needs a user call (stash? commit
>   separately? ship from a clean branch?) before a build-path ship.
> - `make health`/`make bridge-check`/`make matrix` all operational against 159.

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
> **2026-07-12 — Introspection Phase 2 DOM/applied-style diffing DONE:**
> New `lib/domCapture.ts` (`captureDom` + `normalizeSkeleton` + `summarizeDomDiff`,
> 17 jest cases) captures a widget's own subtree (depth-4/child-32 cap, ng-* classes
> stripped) + an intrinsic computed-style whitelist (color/font/display/etc — NOT
> layout-resolved width/margins/position, which would mismatch between `#widget-host`
> and the SOAR drawer). Two hashes per capture: `skeletonHash` (tag+static classes)
> and `tagHash` (tag only) → distinguishes a real branch divergence (tagHash
> differs, likely mock-vs-real viewState) from a class-level ng-class toggle.
> `fidelity()` now populates `FidelityDiff.domMismatch`/`styleMismatches` for real
> (was stubs). Hermetic gate gained **Check 6** (`dom.skeletonHash` vs baseline) —
> `make introspect-gate` fails on a rendered-DOM change (re-baseline if intended);
> verified load-bearing (a class flip trips it). **Bug fixed along the way:** the
> rig looked up `introspection-profiles.json` by the *versioned* widget id but
> profile keys are *unversioned* → the profile was silently missed → rig fell back
> to the generic config + generic `ng-scope` sentinel, which **falsely reported
> "mounted"** (config-prompt carries ng-scope + >200 chars). The widget had
> *never actually mounted* in prior rig runs. Fix: `PROFILES[widget.id] ||
> PROFILES[widget.name]`; for domRoot widgets the mount signal is now the view root
> attaching (`waitForSelector(state:"attached")`), not the controller-global probe.
> Verified end-to-end on `fortiaiAgenticAssistant` (16 nodes, stable skeletonHash,
> Check 6 trips on a class change). Baseline `tests/introspect/baseline/
> fortiaiAgenticAssistant-1.2.13.json` added. **Live SOAR diff DONE** —
> `make introspect-soar ENV=.env.159 ARGS=fortiaiAgenticAssistant` captured the
> soar-side `dom` (16 nodes) and produced the first real harness↔SOAR fidelity
> diff. Result: **tagHash matches** (identical element tree — strong fidelity), but
> `0/1/0/1` is `div.build-hint` (harness, mock `capability_gap`/`build` config) vs
> `div.quick-actions` (soar, real alert) — a data-driven branch, surfaced as an
> *element-identity divergence* (not a style mismatch). Style parity ok on
> same-identity paths. Refined `summarizeDomDiff` to separate "same element,
> different CSS" (real fidelity signal) from "different elements at same path"
> (data branch) so the style-signal isn't muddied (18→19 jest cases, 339 green).
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
| **Three-pillar demoable push (Investigation / Action-taking / Playbook-helper)** | Tracks A-E in `widgets-src/fortiaiAgenticAssistant/PLAN_demoable_three_pillars.md` (approved 2026-07-13). **C5 DONE+green 2026-07-13** - build intent now drops triage-only tools (`emit_action_card`/`run_op`/the fsr_soc_triage hunt set) via a framework `TRIAGE_ONLY_TOOLS` set the connector extends at import; framework 1805 / connector 204 / widget 549 passed. **C2 DONE offline 2026-07-13 BUT live-confirm FAILS on 8.0 — needs rework** - `update_playbook` op (pydantic `UpdatePlaybookParams/Response`, registered in `_LIVE_OPERATIONS`+`_MOCKABLE`+`info.json` (21 ops); widget `updatePlaybook()` + controller create-vs-update branch w/ module guard; 8 connector + 4 widget tests green) BUT the no-ship live probe on 159 (2026-07-13) showed **both** update paths fail: primary `PUT /api/3/workflows/<uuid>` (bare workflow record) → 409 `UniqueConstraintViolationException` on `uuid` (platform treats it as create-with-uuid, not in-place update); fallback `POST /api/3/import_jobs` `merge_replace` ��� 201 accepted but the ImportJob never completes (status null, pct 0, 40s) and the workflow name does NOT change. The committed "PUT = designer's Save path / import_jobs = verified upsert" claims are unverified-and-wrong. **NEXT:** find the real in-place-update mechanism (inspect the beautified designer app JS at `fsr_src/app_min/app.beautified.js` for the actual Save call — likely PATCH or a different body shape), fix `update_playbook`, re-probe, then ship. **C1 DONE+green 2026-07-13** - per-quick-action build-prompt tailoring: the 5 build chips (`explain`/`add_step`/`find_issues`/`add_error_handling`/`optimize`) each send a `quick_action` tag; widget `runQuickAction`→`_runTurn` threads it onto the `chat_turn` payload; connector `ChatTurnParams.quick_action` (typed field, not extra-passthrough) + `_resolve_system_prompt` appends a build-only `# Active quick-action` directive; framework `system_prompt_build.md` gains a "Quick-action modes" section routing each chip to its tools (Explain→analyze/step_through; Add a step→get_step_type+verify_enhancement; Find issues→analyze+diagnose_yaml_against_pb_execution; Add error handling→analyze+suggest_fix_for_diagnostic+verify_enhancement; Optimize→analyze+verify_enhancement). Triage chips carry the tag too (observability; connector ignores it for triage). Suites green: framework 680+2skip / connector 290+21skip / widget 552+3skip. **C3 DONE (local) 2026-07-14** — all three debug surfaces built in the widget YAML pane, box-independent: (1) **Step-test Verify** — per-step Verify control → live `step_test`, renders status/rendered_args/output_top_keys/note + `needs_confirm` confirm gate; `yamlSteps()` YAML parser + `stepTest` service. (2) **Apply-patch** — built on the REAL `corrected_yaml`/`auto_fixes` contract (`validate_yaml` already returns them; the planned `verify_enhancement`/`suggest_fix` proposals have no card emitter — noted as a framework follow-up): "Check & fix" button → `validateYamlLive` → reviewable before→after patch panel → one-click Apply. (3) **Debug-session drawer** — Debug panel drives the connector's stateful walker (`start_debug_session`→step/continue/stop, all live via `call_mcp_tool`): controls, per-step breakpoint toggles, live trace, status line, first_error, stale-session teardown. Suites: widget **50 jest suites / 588 passed** + verifyStep/applyPatch/debugSession/rendering/smoke e2e all green. Also fixed a reported bug: triage/investigation chats bleeding onto the playbooks page — session id was persisted under one un-namespaced `fsrPbSession` key shared across all mounts; now intent-scoped (`fsrPbSession:build`/`:triage`). KB updated (3 gotchas). **Unshipped/uncommitted.** **Track D1 DONE (local) 2026-07-14** — canonical seedable example-playbook fixture set committed at `widgets-src/fortiaiAgenticAssistant/tests/fixtures/playbooks/` (5 valid FSR YAML fixtures, one per authoring scenario, + `scenarios.json` acceptance manifest + gitignored `scenarios.local.json` overlay for box IRIs/exec-ids + a 7-test box-free guard). **Track A DONE (local) 2026-07-14 (box-independent parts)** — (1) hunt/pivot FortiSIEM/FAZ prompt guidance already landed+pushed on the connector `dynamic-tool-surface-connector` branch (commits `80f5abc`/`bba7561`/`bd79a43` — the "triage firewall/NOC investigation" work; `system_prompt_triage.md` now has full `siem_*`/`faz_*` source-aware hunt sections). (2) **Matrix scenario hygiene** fixed in the harness: `matrixDriver.js` now canonicalizes `ioc_card ≡ info_card` (`CARD_ALIAS`) in the expected-card gate — the widget renders both (+`status_card`) through one `normalizeInfoCard` path, so a hunt turn that emits `ioc_card` no longer FAILs a scenario expecting `info_card`; committed `scenarios.local.example.json` corrected (T2 `ioc_card`→`info_card`; T7 delete-ask is non-tier-gatable → `[]`/`minTools:0`/refusal, not a fabricated `action_card`); KB gotcha added (`docs/kb/drawer-widgets.md` §18.6). Harness jest **13 suites / 344 passed** (incl. 4 new normalization tests). Remaining Track A is box-dependent: run the T2–T11+P1 matrix live on 159. **Remaining:** Track D2–D4 (seed fixtures to box via push_playbook, extend matrixDriver + widget-driven UI scenarios — box-dependent); box follow-ups — richer value-level `suggest_fix` patch (needs a framework `emit_patch_proposal` card + apply tool), C4 live-verify, C2 update_playbook rework. **Live-test window open on 159:** C4 (playbook-editor mount) + Track B (always-allow checkbox) are testable NOW on the deployed 1.2.13/0.4.42 stack (code already shipped). C2 PUT endpoint (`PUT /api/3/workflows/<uuid>`) needs live-confirm — pyfsr probe written, run next session. C1/C2/C5 need a ship (0.4.42→0.4.43) — blocked on the `release_notes.md` foreign-WIP caveat (deploy.sh auto-mutates it). | live box window for ship + C4/B/matrix runs; C3/D/A are box-independent | `widgets-src/fortiaiAgenticAssistant/PLAN_demoable_three_pillars.md`; `ROADMAP.md` sections 3-4; memories `fortisoar_workflow_update_endpoint`, `feedback_typing_pydantic_solidify_structure` |
| **Auto-approve safe / read-only actions** | **Mostly DONE.** (1) explicit policy is already built: `FSR_AUTO_APPROVE_READONLY` env var + `_readonly_auto_approve()`/`_approval_floor()` in `fsr_playbooks/llm/tools.py` (default on, tier 1–2 auto-run, tier ≥3 gated) — memory `readonly_auto_approve_flag`. (2) **"allow once / always-allow per tool" BUILT 2026-07-05** (offline, committed, not pushed): `grant_tool_approval()`/`_consume_grant()`/`clear_session_grants()` in framework `tools.py` (commit `4356e2b`), `dispatch()` takes an optional `session_id` and checks/consumes a per-(session,tool,op_key) grant before staging the approval envelope (audited `auto_allow_grant`); connector `_resume_action_card_execute` threads an optional `grant: "once"\|"always"` resume param + `session_id` into dispatch (commit `413a1c3`). In-memory only, backward compatible (no session_id/grant = unchanged behavior). Framework 655 passed/2 skipped, connector 77 passed, 10 new grant tests. Playbook-read tools (`analyze_playbook` tier 0, `verify_playbook`/`verify_enhancement`/`diagnose_yaml_against_pb_execution` tier 1) confirmed already safe/never-prompt. **Widget UI also BUILT 2026-07-05** (`widgets-src/fortiaiAgenticAssistant` commit `cdb4788`): action card gained an "Always allow this action" checkbox that sends `grant: "always"` on `chat_resume` when checked (unchecked = today's one-shot behavior, unchanged). 3 new tests, full widget suite 521 passed/3 skipped/524 total. **Remaining (2026-07-06 update): all 3 commits are now pushed** — widget `cdb4788` (origin/master, pushed 07-06 under the e2e-migration push), framework `4356e2b` (on framework `github/main`), connector `413a1c3` (on `origin/triage-firewall-noc-investigation`). Only the **live-box verify** of the "Always allow this action" checkbox end-to-end remains (needs a box window + `make ship`; note the connector repo is currently mid-flight on `dynamic-tool-surface-connector` with unrelated WIP). | live verify only | memory `agent_mutating_op_approval_gate`, `readonly_auto_approve_flag`, `approval_grants_built`; `fsr_playbooks/llm/tools.py::dispatch`, `_consume_grant` |
| **Local dev loop — prove full functionality** | P0/P2 DONE. **P1 DONE 2026-07-05** (harness was proxying to `.env.box`=205; flipped to `.env.159` via `POST /_fsr/soar-envs`, confirmed a real `/api/3/alerts` fetch from 159). **P3 triage-quality: re-checked, no longer reproduces** — a real triage turn against a live 159 alert ran 13 well-directed tool calls (record → connector discovery → enrichment/containment → IOC lookups on both IPs + host) and closed clean (`end_turn` + a real `ioc_enrichment` info_card); the old `max_tool_turns` complaint looks fixed by since-shipped prompt work (0.4.27 "investigate first, summarize once", etc.). **Real bug found + fixed along the way:** `_shared._live_client()` memoises the FSR session for the process lifetime with no re-auth on token expiry — a sidecar idle since 2026-07-01 failed every `get_record` call `http_401` (15 tool calls, every arg permutation, never succeeded) even though the record existed; fixed via `_invalidate_live_client()` (framework `295b2fc`) + a `_get_with_reauth()` retry wired into `get_record`'s two request sites (connector `7e6ac6c`). Other `client.session.get/post` call sites in `tools_triage.py` (search_module_records, tags, etc.) had the same latent bug — **RESOLVED (verified 2026-07-15):** the reauth wrapper was centralized into the framework as `_shared.live_request_with_reauth` (+`live_get_with_reauth`/`live_post_with_reauth`, self-heal once on 401/403) and threaded through every live request site in `tools_triage.py`/`tools_records.py`/`tools_ztpf.py`/`profiles.py`/`triage_preflight.py`; the one raw `client.session.get` left (triage_preflight.py) is a guarded fallback that prefers the wrapper. Remaining: P3 run the full PROMPT_FLOW_TEST_PLAN matrix locally. | none known | `LOCAL_DEV.md`; memory `local_dev_loop_next_steps`, `sidecar_fsr_soc_triage_import_fix` |
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
(box-specific record UUIDs) are now **per box** — `MATRIX_ENV=.env.206` auto-selects
the gitignored `tests/live/scenarios.local.206.json` (159's UUIDs don't exist on
206), template `scenarios.local.example.json`. **Gating is per-row (`gate`), not
global** — `soft` (default; hard-FAIL only, the original contract), `strict`
(DEGRADED or any red flag blocks too), `xfail` (documents an open bug; **reports,
never blocks**). Blocking on a clean `xfail` was removed after live evidence: rows
are LLM turns, so a defect is only visible when the model exercises it (one prompt
tripped D2 on 3 of 4 runs against an unchanged connector) — "clean" would have
announced a live bug as fixed. `forbidRedFlags[]` and **drive errors** block on
every gate, so an xfail row still guards already-fixed bugs (P6b guards D1) and
never launders a row that never ran. Rows are additionally graded by the
`exportGrader` red-flag rules — the same rules `make grade-export` runs offline.
`make test-matrix-gate` runs the gating rows only; it is deliberately NOT in
`ship-verify` (each row is a headed box turn). See PROMPT_FLOW_TEST_PLAN.md
"Gating".
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
