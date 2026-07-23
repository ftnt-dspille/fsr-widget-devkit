# Widget capability testing + persona rollout — consolidating tracker

_Created 2026-07-21 (session 4c), after connector **0.4.93** / framework **0.4.36**
shipped to 159 + 206. **Nothing in this doc has been started.** It exists so the
next session can pick up cold._

**Read this first, then the linked per-area plans.** This is an index + gap map,
not a replacement for the detailed plans that already exist.

---

## 0. Why this doc

The widget (`fortiaiAgenticAssistant`) has five distinct user-facing capability
areas plus a cross-cutting persona concept. Each has *some* coverage, but the
coverage is spread across ~6 harnesses and 4 plan docs written at different
times, so it's not currently possible to answer "is the widget good?" without
re-deriving the map. This doc fixes that.

The unit of work is **one capability area at a time, driven through the real
widget UI against a real box** — not just connector-level evals. Several areas
have connector proof but no widget proof; those gaps are the point.

---

## 1. The five capability areas + persona

| # | Area | What the user does | Existing coverage | Gap |
|---|------|--------------------|-------------------|-----|
| **C1** | **SOC triage** | Opens an alert/incident, asks "what is this, how bad, what next" | `scripts/_soc_agent_eval.py` (live, 5 scenarios, graded by pass-rate); `system_prompt_triage.md`; T-rows in the live matrix | Widget-level pass. Known open: T2 containment drift ([[t2_containment_drift_is_prompt_imbalance]]); baseline (no-persona) intelligence |
| **C2** | **Investigation** | Multi-step pivot: IOC → related records → blast radius | Native FortiAI `investigate_alert` (159/GA only); fsr-mcp-bridge on .60 (7 simulated product MCP servers); `mcp_soc__*` tools live since 0.4.87/0.4.91 | No graded scenario set. Bridge tool-use proven once, not regression-tested |
| **C3** | **Playbook troubleshooting** | "Why did this playbook fail / fix it" | `why_did_playbook_fail` connector-side lever (0.4.78, box-proven 3/3); `eval_s5_diagnose.py`, `eval_s6_apply_fix.py`; C3 Diagnose&fix shipped widget 1.2.17 | Diagnose→fix→re-run loop not proven end-to-end *through the widget* |
| **C4** | **Assistance** | General "help me with this record/module" | `_CONNECTOR_INVARIANT_RULES` (0.4.92, every intent+persona); Tools panel (widget 1.2.29) | Thinnest area. No dedicated scenario set — this is where "baseline must be smart without a persona" lives |
| **C5** | **Building** | Author a playbook from a description, deploy it | `eval_s1_create` / `s2_modify` / `s3_connector`; `build_run_proof.py`; build-persona validation plan (F1+F3+manual_input+P4, 3/3 live on 206) | S4/S8 slices not run. `update_playbook` is a WIDGET op in no tool slice |
| **P** | **Persona concept for other modules** | Per-module Key Store prompt+tools | 4 ZTPF personas exist; `docs/plans/module-scoped-assistant-personas.md` (Phases 0–3 live) | **The open design question — see §3** |

---

## 2. Detailed plans (do not duplicate these — extend them)

| Plan | Covers | State |
|------|--------|-------|
| `docs/plans/module-scoped-assistant-personas.md` | P — the persona mechanism itself, incl. ZTPF capability spec (§7c) and a post-clear resume checklist (§277) | Phases 0–3 live on 206 |
| `docs/plans/live-chat-eval-and-build-flow-fixes.md` | C5 + the live matrix; has its own "RESUME HERE" at §16 | Phases 0/1/2/4 done; 4 harness fixes + Phase 3 connector open |
| `docs/plans/build-persona-validation-plan.md` | C5 — "the playbook actually runs" bar | BAR MET, shipped 1.2.25 |
| `docs/plans/soc-assistant-ui-gaps.md` | Cross-cutting widget UX; B0 `info_card` overwrite bug is the lead item | Not started |
| `docs/plans/stability-and-scalability-plan.md` | Infra under all of the above (MCP bridge, soc-401) | Phases 0/1/2 shipped; 3A in progress |
| `docs/plans/agentic-tooling-best-practices-alignment.md` | P0 unify 3 drifted turn-drive harnesses; P1 audit persistence | Not started — **P0 is a prerequisite for trusting any cross-area comparison** |

---

## 3. The open design question (user's, carried forward)

> "It seems we need a Key Store persona per module to even get close to
> intelligent. That doesn't scale."

This is the highest-leverage open item and it spans C1/C4 and P. The 0.4.92
invariant rules now apply to non-persona turns, which helped, but **tool scoping
and domain framing still come only from a persona**. A module without a
hand-authored persona is still comparatively dumb.

Decide before building more personas: is the answer (a) make the baseline
module-aware automatically, (b) generate personas from module schema, or
(c) accept per-module authoring and build tooling for it? Currently unanswered.

---

## 4. Harness inventory (what to drive things with)

| Harness | Box? | Use for |
|---------|------|---------|
| `scripts/_soc_agent_eval.py` | live 206 | C1 graded scenarios |
| `scripts/eval_model_ab.py` | **box-free** | model comparison; now reports cache hit-rate |
| `scripts/local_turn.py` (`make local-turn`) | **box-free** | any in-process turn drive |
| `scripts/eval_s{1,2,3,5,6}_*.py` | live | C5/C3 slices |
| `scripts/build_run_proof.py` | live | C5 build→run |
| `make matrix` | live | prompt/flow matrix |
| `make ship-verify WIDGET=…` | live | the canonical widget pipeline (lint→unit→mock-e2e→deploy→live-sweep) |
| `make test-live-sweep [RUNS=n]` | live | widget vs real connector through the UI |

⚠️ Per `agentic-tooling-best-practices-alignment.md` P0, **three of these turn-drive
harnesses have drifted apart.** Unify before treating their results as comparable.

---

## 5. Suggested order (not started, not agreed)

1. **P0 harness unification** — otherwise every later comparison is suspect.
2. **C4 + §3 design decision** — the scaling question gates how much persona work is worth doing.
3. **C1 widget-level pass** — best existing coverage, so fastest to close.
4. **C3 diagnose→fix→re-run through the widget.**
5. **C5 remaining slices (S4/S8, `update_playbook` tool-slice gap).**
6. **C2 investigation scenario set** — largest greenfield.
7. **`soc-assistant-ui-gaps.md` B0** — can run in parallel; independent of the above.

---

## 6. State of the world as of this doc

- **Shipped today:** connector `0.4.93`, framework `0.4.36` (PyPI), both on **159 and 206**;
  7/7 workers recycled each, warmup green.
- **Verified live:** prompt-cache accounting works in-platform (206: turn 2 →
  `cache_read=11136` of `11227`, cost halved).
- **Resolved:** the `fsrpb-frank` default-clobber-on-every-ship gotcha is gone.
- ✅ **RESOLVED (2026-07-21, session 4d): both boxes now default to `gpt-4.1-mini`.**
  A new config **`fsrpb-41mini`** was created on each box and marked default:
  - **206** — `config_id 9df4bc33-4a98-4389-8bbd-c41c1ff65646`. Prior default
    `fsrpb-live` (gpt-4o) is retained, non-default, as the **A/B baseline arm**.
  - **159** — `config_id 7c6c4ca2-36c3-4ce9-a17d-a75b974ca62b`. Note 159 had
    **no OpenAI config at all and no default set** — only `fsrpb-anthropic`
    (haiku-4-5, non-default). So this also fixes a missing-default on 159.

  Field set mirrors 206's working `fsrpb-live` exactly (`mcp_allowlist: ""`,
  no `soar_api_key` → on-box CS-HMAC), changing only provider model. That makes
  `fsrpb-41mini` vs `fsrpb-live` a clean single-variable A/B.

  **Verified live** — one `chat_turn` through the default config on each box:
  `ok=True`, `usage.model = 'gpt-4.1-mini'`, `cache_read=11136/11225`
  (prompt caching working on both). ⚠️ Gotcha for the next probe: `usage` is
  **not** a top-level key on the `chat_turn` response — the model lands in a
  `{"type":"usage"}` **entry of `transcript[]`** (see `_flatten` in
  `scripts/_soc_agent_eval.py`). Reading `r["usage"]` returns `{}` and looks
  like a failure when the turn was fine.

### 6a. Live A/B result — gpt-4o vs gpt-4.1-mini (2026-07-21, in-platform)

**Verdict: gpt-4.1-mini fixes the hallucination defect and regresses nothing.**
Across all 14 checks the two models are identical **except** the one that
mattered:

| check | gpt-4o | gpt-4.1-mini |
|---|---|---|
| `no_halluc.acknowledges_uncertainty` | **0/3** ❌ | **3/3** ✅ |
| `wrong_entity_repro.ran_validation_playbook` | 0/3 ❌ | 0/9 ❌ |
| all 12 other checks | pass | pass |
| totals | 48/54 | 93/102 |

⚠️ **Do not read the totals as a score** — the arms have different run counts
(the per-check rows are the comparison). The only behavioural delta is
`acknowledges_uncertainty`.

🐛 **`wrong_entity_repro.ran_validation_playbook` fails on BOTH models** (0/3 and
0/9). It is *not* a regression from the model switch and the switch does not fix
it — it's an independent open defect (or an intentionally-failing repro, per the
scenario name). Untriaged; needs its own look.

**How the baseline was obtained — session extraction, not a re-run.** The gpt-4o
arm could not be re-run (its config was gone, see §6b), so the baseline was
recovered by pulling stored sessions off the box and re-grading them offline:
`chat_history` returns full wire events including the `usage` frame, so each
session's model is recoverable and the harness's own graders can be replayed at
**zero LLM cost (~90s for 57 sessions)**. Harness pattern worth keeping — it
imports `_flatten` + `SCENARIOS` from `_soc_agent_eval.py` rather than
reimplementing them, so the offline path cannot silently diverge from the live
one. **Validated:** for scenarios run both ways, the offline re-grade reproduced
the live harness's numbers exactly.

⚠️ Confound to keep in mind: the gpt-4o sessions were recorded under **older
connector versions with different prompts**, so they carry model + prompt drift
together. The gpt-4.1-mini arm is a clean live run on 0.4.93 (`MODEL CHECK: PASS`).
One `md_interfaces` run hit a 180s read timeout (2/2 not 3/3) — infra, not a fail.

### 6c. 🔴 CORRECTION — gpt-4.1-mini is NOT strictly better. It trades confabulation for under-confidence.

§6a's "regresses nothing" was scoped to the **SOC-triage** suite only. Re-baselining
the **build/troubleshoot** slices on the new model found a real regression:

| slice | what it measures | gpt-4o | gpt-4.1-mini |
|---|---|---|---|
| `no_halluc` (C1) | admits uncertainty | 0/3 | **3/3** ⬆️ |
| **S6** (C3) apply-fix→runs | grounded fix of a broken PB | ~1/3 | **2/3** ⬆️ |
| **S3** (C5) author connector PB | author from scratch | 2/5 | **0/5** ⬇️ |

**The three results are one coherent behaviour change, not three unrelated ones:
gpt-4.1-mini is markedly more epistemically cautious.**

- Where the task is to *ground on existing evidence* — admit what you can't see
  (`no_halluc`), diagnose a real failed run and fix it (S6) — caution is a virtue
  and the scores go up.
- Where the task is to *author under ambiguity* (S3), the same caution is fatal:
  **3 of 5 runs produced no playbook YAML at all**, ending the turn with a
  clarifying question instead of a playbook — e.g. *"could not find an installed
  connector named 'FortiSOAR Utilities'… please confirm the exact name."*
  gpt-4o's documented failure modes were different (output-path `.data` variants,
  discovery-attribution); "refuses to author" is a **new** mode.

> 🔧 **ROOT CAUSE FOUND — S3's 0/5 is mostly a TOOL DEFECT, not the model.**
> See §6d. The model was reporting a wrong `find_connector` result correctly.
> The "under-confidence" reading above is **demoted, not deleted**: it still
> explains why gpt-4o scored 2/5 against the *same* broken tool (it guessed on
> and sometimes got lucky) while gpt-4.1-mini trusts the tool and stops.

Corroborating detail: in S6 the model still raises the confabulated ALPHA→BRAVO
rename, but now **flags the contradiction instead of acting through it** ("though
the current description is 'created by the eval harness', I interpret this as…").
Same underlying change, visible in the build slice.

⚠️ **Confound:** the gpt-4o S3 2/5 was recorded on connector 0.4.82 / framework
0.4.33; this run is 0.4.93 / 0.4.36. Model *and* connector version both moved, so
this is not a clean single-variable A/B either. Before treating "0/5" as
model-caused, re-run S3 against a gpt-4o config on **0.4.93** — that config no
longer exists on 206 (§6b) and would have to be recreated.

**Open decision:** the default is currently one model per connector config, but
triage/troubleshoot and build want *opposite* dispositions. Options: accept the
trade, keep a separate build-intent config on a less cautious model, or attack it
in the prompt (loosen the authoring persona's ask-vs-assume threshold). Not decided.

S6's one failure (run 3) is worth its own look: the turn called **only**
`verify_enhancement` — it never called `why_did_playbook_fail`, so the
diagnose-before-fix lever didn't fire, and it left the invalid `type: insert_record`
in place.

### 6d. 🔧 S3 root cause: `find_connector` searched only the FIRST word — FIXED (framework, unshipped)

`fsr_playbooks/mcp_server/tools_discovery.py::find_connector` did a whole-phrase
`LIKE`, then broadened **only `if not rows`**, and the broadening searched
**`words[0]` only**. Traced for S3's exact ask:

| step | result |
|---|---|
| whole phrase `"FortiSOAR Utilities"` | **0 hits** |
| broaden on `words[0]` = `"FortiSOAR"` | `fortisoar-ml-engine` (wrong) |
| the word never searched: `"Utilities"` | **`cyops_utilities`** — label literally `"Utilities"` ✅ |

So the model asked for a plausible human name, the tool searched half of it and
returned a confidently wrong match, and the model reported exactly what it was
told. **Not confabulation, not excess caution — a correct answer to a wrong tool
result.**

Second, latent defect in the same function: the near-match `suggestion` **and**
the broadening were both gated on **zero** hits, so one spurious whole-phrase hit
suppressed both. *One bad hit was worse than no hits.* (Didn't bite here — the
phrase got 0 hits — but it will.)

**Fix:** always broaden, across **every** word (skipping ≤2-char noise words),
and UNION with the whole-phrase hits; whole-phrase matches keep their rank so
word-level noise can't bury them; `limit` enforced across the union.

**Tests:** `fsr_playbooks/tests/test_find_connector_multiword.py` (7 tests).
Verified honestly per [[tests_inherit_the_fixs_blind_spots]] — the old
implementation was pinned back in and the two behavioural tests went **red**
with the real diagnostic (`got ['fortisoar-ml-engine']`); the 5 no-regression
guards pass against both. Full framework suite: **759 passed, 12 skipped**
(pre-existing slim-DB skips).

✅ **SHIPPED + RE-PROVEN.** framework **v0.4.37** (PyPI) → connector **0.4.94** on
**206** (10/10 workers recycled, warmup green: 21 connectors / 282 ops).

**S3 re-run x5 against the fix: 0/5 → 2/5, and the targeted defect is GONE.**

| signal | before fix | after fix |
|---|---|---|
| runs that found + authored the connector step | 2/5 | **5/5** ✅ |
| runs that failed on discovery ("could not find… FortiSOAR Utilities") | 3/5 | **0/5** ✅ |
| overall pass | 0/5 | **2/5** |

Discovery is fully fixed — every run now resolves `cyops_utilities` /
`convert_periodic_time_to_minutes`. 2/5 restores parity with the gpt-4o-era best.

🔜 **The residual is now a single, clearly-named defect: the Jinja OUTPUT PATH**,
not discovery. Authored descriptions across the 5 runs:

```
{{ steps.Convert_Time_to_Minutes.result | string }}        ← missing `vars.` prefix
''                                                          ← no reference at all (x2)
{{ vars.steps.Convert_Time_to_Minutes.data.minutes | string }}  ← correct
{{ vars.steps.Convert_Time.result | string }}               ← `.result`, not `.data.<field>`
```

Two recurring authoring errors: **`.result` instead of `.data.<field>`**, and a
**missing `vars.` prefix**. One run also failed compile with `record` instead of
`resource`.

> ✅ **RESOLVED OFFLINE (2026-07-21) — and the diagnosis above was half wrong.**
> See §6f. Running each observed path through the compiler (seconds, no box)
> showed `.result` and the bare-field form were **already auto-repaired**; only
> the **missing `vars.` prefix** was uncovered, and it was *silent*. Fixed in
> framework `4dc754f`. **This is the S3 residual closed without a single box
> run** — exactly what §6e.3 predicted for a 100%-structural defect.

### 6f. ✅ S3 residual closed OFFLINE — the output-path defect was ONE form, not three

_2026-07-21. The first real payoff of the §6e tiering: an S3 defect diagnosed and
fixed in **seconds, with no box and no LLM**, by replaying the observed authored
paths through the compiler._

Every path from the §6d table, run through `compile_yaml`:

| observed authored path | verdict (pre-fix) |
|---|---|
| `{{ vars.steps.X.result }}` | ✅ already auto-rewritten → `.data.minutes` |
| `{{ vars.steps.X.minutes }}` (bare field) | ✅ already auto-rewritten |
| `{{ vars.steps.WrongName.… }}` | ✅ already a **hard error** |
| `{{ steps.X.result }}` — **missing `vars.`** | ❌ **SILENT: 0 errors, 0 warnings** |
| `''` — no reference at all | ❌ silent (scenario-level, not compiler-level) |

**So §6d's "the lever doesn't cover `.result`" was wrong** — it covers it, and
the bare-field form, and an unresolvable step name. The single uncovered form was
the missing `vars.` prefix.

🔑 **Why it was silent is the interesting part.** The entire reference lint
anchors on `\bvars\.steps\.` (`validator.py:21`), so dropping `vars.` makes the
mistake **invisible to the machinery built to catch it** — the one error that
consists of not matching the anchor. FSR exposes step output only under `vars`,
so it renders EMPTY at runtime: the same silent-blank failure as a dropped
`.data`.

**Fix — framework `4dc754f`** (`compiler/connector_output_refs.py`): normalize
`steps.<step>` → `vars.steps.<step>` *before* the alias/bare-field passes, so a
reference needing both repairs (`steps.X.result`) is fixed end-to-end in one
compile. Only a **real** connector step is rewritten — an unresolvable name is
left for the reference lint's hard error, since inventing a prefix for a
nonexistent step would turn a caught error into a runtime blank. The gate in
`_rewrite_in_node` also had to widen from `"vars.steps." in node` to
`"steps." in node`, which was skipping exactly the strings needing repair.

5 tests; the 3 behavioural ones verified **red** against the pinned-back old code
per [[tests_inherit_the_fixs_blind_spots]]. Framework suite **764 passed, 12
skipped**. ⚠️ **Not yet released/shipped** — offline-proven only; needs
`make release` + `bump-framework` + `make ship` to reach a box, and an S3 re-run
to confirm the pass-rate moves off 2/5.

### 6b. ⚠️ Two hazards found while doing this

1. **`pyfsr.connectors.resolve_config` silently falls back to the default** when
   the named config doesn't exist — no error, no warning
   (`pyfsr/src/pyfsr/api/connectors.py:729`). Proven live:
   `resolve_config('totally-bogus-name')` returns the *default's* UUID. So
   `--config <anything>` can grade the wrong model and look fine. **Always pass
   `--expect-model`** — that guard is the only reason this A/B wasn't reported
   with a bogus baseline arm.
2. **Three connector configs disappeared from 206** during this work — `fsrpb-live`
   (378, the gpt-4o baseline), `fsrpb-apikey-proof` (379), `repro-openai` (380).
   They were present in the listing taken immediately *after* the new config was
   created and gone ~20 min later. No delete call exists in the eval harness or
   the scripts used, and pyfsr POSTs a single config object (not a list), so the
   cause is server-side and **unknown** — possibly related to writing a new
   config with `default=True`. User assessed them as disposable, so they were not
   recreated and the cause was not chased. **Flagged in case it recurs on a box
   where the configs matter.**
- Connector repo `main` is committed but **not pushed**.

## 6e. 🔜 FOLLOW-UPS — build out OFFLINE testing for every playbook task

_Added 2026-07-21. Motivation: a pure-function bug (`find_connector`, §6d) was
validated with a `make release` → PyPI → bump → `make ship` → 20-min box eval
cycle (~35 min). It was catchable by a 0.5s unit test. The tiering below is the
fix._

### 6e.1 The tiering to build toward

| tier | cost | proves | use for |
|---|---|---|---|
| **T0** unit test | ~0.5s | pure functions: catalog search, compile, lint, Jinja | anything not model-dependent |
| **T1** local turn | **~12s** | real model + real tool-use loop vs the **editable** framework — no release, no ship | tool resolves? in the slice? prompt assembles? spine routes? |
| **T2** box eval | ~4 min/run + ship | model-specific behaviour, runtime outcomes | grading the box model only |

**Design principle: offline by default, proxy by exception.** A real FortiSOAR
must stay reachable for the calls that genuinely need it (live records, real
failed runs, module/picklist schemas) — but that should be the *exception the
cassette hasn't covered yet*, not the default path. See Task C.

T1 recipe + the `FRANK_MODEL` trap: `[[fast_local_validation_loop_frank]]` /
connector `dff10c7`. **Frank runs GLM-5.2, the box runs gpt-4.1-mini** — T1 is a
proxy; never grade model disposition on it (§6c).

### 6e.2 🔑 The missing seam: mount a CONTEXT PLAYBOOK offline

Everything except "create from scratch" needs an **existing playbook in
context** — build-onto, modify, troubleshoot. The grounding channel is already
known exactly (`eval_s2_modify._entity`, the shape the shipped widget seeds):

```python
entity = {
    "iri": "/api/3/workflows/<uuid>", "module": "workflows", "uuid": ..., "id": ...,
    "fields": {"name": ..., "description": ...},
    "playbook_yaml": "<decompiled YAML>",   # ← read into the OPEN PLAYBOOK block
}
```

`local_turn.py` cannot build this today — it only makes `{module, iri}` from
`--module/--entity-uuid`. **`entity.playbook_yaml` is just a string, so a local
YAML fixture mounts an open playbook with NO BOX AT ALL.**

**Task A — ✅ DONE (2026-07-21), `scripts/local_turn.py`:**
- `--playbook-yaml <path>` — mount a local fixture as the open playbook
  (synthetic iri/uuid/id via `_playbook_entity()`). A **bare name resolves
  against `scripts/eval_fixtures/`**, so the fast loop is one flag. Combined
  with `--tools cassette --llm fake` this is a **fully offline** turn.
- `--playbook-uuid <uuid>` — decompile from a live box for fidelity
  (`_decompile_live_playbook()`, lifted from `eval_s2_modify._decompile_live`
  so the two can't diverge). In-process; needs no ship.
- A mounted playbook forces `module=workflows` and beats a conflicting
  `--module` (otherwise the turn grounds in a record that doesn't exist).
- `local_turn(playbook_yaml=...)` is the library seam for S2/S5/S6 harnesses.

  ⚠️ **Gotcha for anyone asserting on this: the OPEN PLAYBOOK block is NOT in
  `TurnResult.system`.** The static prompt carries only the "when a playbook is
  open…" instructions; the YAML rides in the **messages** (record context,
  `operations.py:1019`). Asserting on `system` passes while the YAML never
  arrived. Tests read `ops._PL_LAST_FAKE.last_messages`.

  **Verified:** `tests/test_local_turn_context_playbook.py` (6 tests, 1.6s).
  Honesty-checked per [[tests_inherit_the_fixs_blind_spots]] — renaming the
  `playbook_yaml` key reds 3 of them with the real diagnostic. Full connector
  suite **424 passed, 7 skipped**.

### 6e.3 Per-task offline coverage — split each oracle into structural vs runtime

**The key realisation: most S-slices have a STRUCTURAL half that is fully
offline and a RUNTIME half that needs the box.** The structural half catches
most defects (S3's whole failure was structural). Split them so the fast half
runs constantly.

| task | offline (T0/T1) — build this | needs box (T2) |
|---|---|---|
| **S1 create** | authored YAML compiles + passes the linter | it actually runs |
| **S2 modify** | needs Task A. Diff the returned YAML vs the mounted fixture — **only the asked-for change** (`assert_diff_only` logic, no box) | runs correctly after edit |
| **S3 connector-action** | **already offline-able**: connector step present + record field is a Jinja ref to its output, not a literal. This is S3's own STRUCTURAL oracle, and the current residual (`.result` vs `.data.<field>`, missing `vars.` prefix — §6d) is *entirely* structural | the runtime `180` |
| **S4 trigger/cond/jinja** | authored branch structure + Jinja validity | which branch is TAKEN |
| **S5 diagnose** | cassette one `why_did_playbook_fail` response, replay it; grade the diagnosis text offline | fresh failed-run ground truth |
| **S6 apply fix** | fix applied to the mounted fixture → recompiles + lints clean | the fixed playbook RUNS |
| **S7 linter** | ✅ already fully offline | — |
| **S8 hunt→playbook** | cassette a trace → offer card emitted + compiles | created playbook runs |

**Task B — ✅ DONE (2026-07-21): `scripts/preflight.py` + `make preflight`.**
Per scenario, asserts the discovery tools resolve what the ask names — and does
it **using the ask's own human phrasing** (`"FortiSOAR Utilities"`), never the
canonical name. That distinction *is* the oracle: preflighting
`find_connector('cyops_utilities')` would pass trivially and prove nothing,
since the model only ever types what the analyst said. A guard test enforces
that the registry can't be defanged into a tautology.

Checks per scenario: connector query → expected connector (with **rank**, since
a hit buried past the limit isn't one the model will act on), operation query →
expected op, every step type real, every needed tool present in that intent's
slice (generalising `eval_s5_diagnose._build_slice_has_tool()`).

Registry covers **s1/s2/s3/s4/s5/s6 — 6/6 clean**, in **0.55s**, no LLM/box/ship.

> ✅ **Proven against the regression it exists for.** Pinning the pre-`8ea4ec2`
> `find_connector` back into the framework turns `s3` red with the *true*
> diagnostic — `did not return 'cyops_utilities' — got ['fortisoar-ml-engine']`.
> That defect cost a ~35-min release→PyPI→bump→ship→box-eval cycle to find;
> preflight finds it in **milliseconds**. This is the plan's thesis, demonstrated.

CI gate: `tests/test_preflight_resolves.py` (8 tests, parametrized per scenario
so a failing slice names itself), wired into `make local-turn-ci`.

**A FAIL here is a TOOL/CATALOG defect, not a model defect** — the script says so
in its own output, because that misattribution is what cost the 35 minutes.

**Task C — cassette record mode + live PROXY fallthrough.** This is the one that
actually compounds. `_CassetteClient` exists but its rules are hand-written.

Make the tool backend a **cassette-first, live-fallthrough proxy** rather than
the current all-or-nothing `cassette | live`:

1. replay the call from the cassette if recorded → **offline, instant**;
2. on a miss, **proxy it to a real FortiSOAR** (some calls genuinely must run
   there — live records, real failed runs, module schemas);
3. **record the miss** so the next run needs no box for it.

Box dependence then decays toward zero as the cassette fills, while anything
that truly needs a real appliance still works. `--tools live` (proxy every read)
and a strict offline mode both remain available as explicit choices.

> **Mirror the widget harness — it already solved this exact problem.** Per
> `TESTING.md` ("Two tiers"), the mock e2e tier is **hermetic**: `FSR_HERMETIC=1`
> disables the proxy fallthrough so a box outage can't red a mock test, an
> un-snapshotted call is a **loud `599 HERMETIC-MISS`** (never a silent pass),
> and a `globalTeardown` gate fails the run on any leak. Reuse that design
> wholesale on the connector eval tier: **silent fallthrough is the trap** — a
> test that quietly reaches the box looks offline until the box is down, and a
> hermetic run that silently mocks a miss looks green while proving nothing.

**Task D — ✅ DONE (the two named targets).** `make preflight [S=s3]` and
`make t1-turn PLAYBOOK=<fixture|path> MSG="…"` (build intent + built-in persona
by default; CLI `INTENT=`/`PERSONA=` still win). `make local-turn-ci` now runs
both new test files. Remaining Task-D work waits on Task C's shape.

⚠️ Makefile gotcha found: the file sets `INTENT ?= triage` / `PERSONA ?= fixture`
for `local-turn`, so `$(or $(INTENT),build)` in a new target **never** sees an
empty value and silently ran the T1 turn as triage-with-a-persona. Use
target-specific assignment (`t1-turn: INTENT = build`) instead.

### 6e.5 ✅ T1 behavioural-invariant suite — `make t1-scenarios` (2026-07-21)

Five **box-free** scenarios (connector `49cf1d7`, `scripts/t1_scenarios.py`)
driven through the mounted context playbook: `modify_one_field`,
`troubleshoot_missing_module`, `troubleshoot_bad_args`,
`build_onto_open_playbook`, `answer_about_open_playbook`.
**Baseline: 22/22 green vs Frank.**

Every grader is a defect actually observed, not an invented bar:

| grader | the failure it pins |
|---|---|
| `returns_complete_playbook` | the widget saves the LAST ```yaml fence **over** the open record — a fragment silently deletes every step it omits. The most destructive failure this product has |
| `called_before(diagnose, fix)` | S6 run 3 fixed without ever calling `why_did_playbook_fail` |
| `never_asks_for_the_playbook` | it is already in context; the prompt calls this the most common wasted turn |
| `emitted_yaml` | §6c: 3/5 S3 runs ended in a clarifying question, no playbook |
| `changed_only_what_was_asked` | S2's oracle, now offline |
| `yaml_compiles` | catches the `record:`-for-`resource:` slip with no box |

🚧 **The line this tier must not cross:** Frank is GLM-5.2, the box is
gpt-4.1-mini. Grade **structure/behaviour** only — **never disposition**
(caution, verbosity, ask-vs-assume). §6c is exactly a disposition finding, and
it needs the box. The runner prints this warning on every non-fake run.

**Graders are pure functions and must be able to FAIL** —
`tests/test_t1_scenario_graders.py` pins each with a passing *and* a failing
case. A broken grader manufactures a model defect, and a false finding costs
more than a missing one.

### 6e.6 🪤 The stale-model trap — found, root-caused, REMOVED

Building the suite surfaced a landmine that had been mis-scoped in the notes.

`fsr_soc_triage/tools_agent.py::_load_repo_env_once()` `setdefault`s the
framework repo's `.env` into `os.environ` (so the MCP server finds creds) — and
that file carries `FRANK_MODEL` / `OPENAI_MODEL`. It fires on **any tool-using
turn**, not just `--tools live` as previously recorded; it bit a `cassette` run.

**Why it is vicious: it is not a crash.** Turn 1 in a process runs on the
correct model; every later turn 403s (`Provider 'gb200' is not allowed for this
virtual key`). The suite's first run therefore showed scenario 1 passing 5/5 and
scenarios 2–5 failing every grader — which reads as *"the model fell apart"*.
It was **the harness poisoning its own environment**.

> 🔑 **Rule: if a local suite degrades after run 1, suspect the harness, not the
> model.** And a turn that never ran must never be scored — the first version
> reported a 403 as `emitted_yaml 0/1 — no playbook authored`, blaming the model
> for a turn no model ever saw.

**Fixed in code, not in shell config:** `local_turn.py` snapshots model
resolution at **import** (`_ENV_MODEL_AT_IMPORT`), immune to anything a turn
injects; `run_one` raises `DriveError` and the runner aborts loudly. Two
regression tests, verified red without the fix. The stale ids in the framework
`.env` were corrected too, but that file is gitignored — **the code fix is what
protects everyone**. Consequence: the `FRANK_MODEL`-in-`~/.zshenv` chore in §7
is **no longer required**.

### 6g. 🐛 REAL-PLAYBOOK FIXTURES — and the decompiler defect they found on day one

_2026-07-21. Extending the §6e.5 T1 suite: instead of hand-writing more
fixtures, pull real playbooks off a live appliance, decompile them to YAML, and
mount them offline via `--playbook-yaml`. **Hand-written fixtures share the
author's blind spots**; the shapes that actually break things are ones nobody
invents._

**Method (repeatable, ~2 min, no ship):** `pyfsr` →
`/api/3/workflows?$relationships=true` (paged) → classify by step-type UUID
(`fsr-schema.ts`) → pick small, feature-distinct playbooks →
`local_turn._decompile_live_playbook()` in-process → compile-check → install
under `scripts/eval_fixtures/`. From a 1200-playbook corpus this surfaced
usable examples of decision-branching, `for_each` loops, manual input,
workflow_reference, code snippets, approvals and API-endpoint triggers.

> 🐛 **It found a data-loss defect on the very first pull.** Two of the pulled
> playbooks loop (`for_each.item`); the decompiled YAML contained **no loop at
> all**. `for_each` lives inside `arguments:` on the wire and the IR build lifts
> it out (`decompiler.py:744`) — but the emitter never put it back, so it was
> lifted into a field nothing read. The parser accepts step-level `for_each:`
> and the compiler validates it, so **only the pull side was lossy** — which is
> exactly why no round-trip test caught it.
>
> **Why this is worse than a normal fidelity gap:** the widget saves the agent's
> LAST ```yaml fence back **over** the open record. So *open a looping playbook →
> ask for any one-field edit → save* silently rewrote "run this for every open
> incident" into "run it once". No error, no visible diff, and control flow is
> not something an analyst re-checks after a one-field edit.
>
> **Fixed** — `compiler/decompiler.py` emits `for_each` on the step surface.
> 5 tests (`test_decompiler_for_each_roundtrip.py`), 3 behavioural ones verified
> **red** against the pinned-back old code per
> [[tests_inherit_the_fixs_blind_spots]] (`assert 'for_each' in {...}` /
> `expected exactly one looping step, got 0`). Framework suite **769 passed,
> 12 skipped**. ⚠️ Offline-proven only — needs release + ship.

**Second finding, not chased:** real playbooks from a real box do **not** all
compile. Of 10 pulled, 5 hit hard errors — `unknown connector: 'ssh'` /
`'microsoft-sccm'` (local reference-DB gap, benign, cf.
[[local_dev_loop_warmup_clobbers_reference_db]]), but also
`set_variable.message: unknown key(s) 'tenant'` and `playbook parameter
'records' shadows vars.input.records`. **Those last two are compiler-strictness
gaps against shipped Fortinet content**, and they matter: an agent asked to edit
such a playbook cannot return a compiling result no matter how good it is. The 5
clean ones were installed as fixtures; the failing ones are a lead, untriaged.

#### 6g.1 New T1 scenarios (all box-free) + 4 new graders

Coverage was previously all *edit/troubleshoot* on toy fixtures. The new set
widens along the axis the user asked about — **the range of questions an
analyst actually asks** — and deliberately includes read-only turns, which had
no coverage at all:

| scenario | fixture | what it pins |
|---|---|---|
| `preserve_loop_on_edit` | loop / SLA violations | the defect above, at the AGENT layer — a correct decompiler doesn't stop the model omitting the loop |
| `explain_loop_semantics` | loop / SLA violations | does it know `for_each` makes one step run N times |
| `explain_decision_branches` | decision / Fetch SLA Details | the MSSP arm turns on a Jinja `is not none` over a **parameter**, not the record |
| `trace_variable_origin` | decision / Fetch SLA Details | dataflow across steps — the skill behind every "why is this field empty" |
| `impact_of_removing_a_step` | decision / Fetch SLA Details | counterfactual + refusal: `Do Nothing` is a decision's **default arm** |
| `add_branch_to_decision` | indicator reputation | control-flow editing — add one arm without thinning the others |
| `automate_manual_step` | manual input / block IPv4 | the build ask the fixture itself invites; trap is the `no_op` placeholder |
| `explain_trigger` | manual input / block IPv4 | action-trigger vs event — decides the answer to "why didn't it fire" |

New graders (each pinned with a passing **and** a failing case in
`tests/test_t1_scenario_graders.py`, 28 tests):

- **`preserves_loops`** — a `for_each` that goes in must come out, iterating the
  *same source*. The destructive class one level below a dropped step: the step
  survives and silently does 1/N the work. Also catches a **retargeted** loop,
  which a dict-key diff would call lossless.
- **`preserves_branches(allow_new=)`** — decisions keep every arm. A decision
  that loses its default arm compiles, runs, and strands every record that
  misses the explicit conditions.
- **`grounded_in_real_steps`** — an explanation may only name steps that exist.
  The anti-confabulation bar that **scales**: it needs no expected answer, just
  the mounted playbook. Only backticked/quoted multi-word tokens are judged —
  scanning free prose would flag ordinary English, and a grader that cries wolf
  gets ignored.
- **`emitted_no_yaml`** — the mirror of `emitted_yaml`. On a read-only ask an
  unrequested fence is an unrequested **WRITE**, because of the save-last-fence
  behaviour.

#### 6g.2 First Frank baseline on the new scenarios — 🔜 FOLLOW-UPS TO INVESTIGATE

> 🏎 **Harness (2026-07-21): the suite now drives turns CONCURRENTLY.**
> `make t1-scenarios … JOBS=n` (default 3, hard-capped at 3 — the Frank gateway
> is shared lab infrastructure). One **process** per turn, not a thread:
> `local_turn` monkeypatches process-global state (`_shared._live_client`, the
> persona cache) to install the cassette, so two turns in one interpreter would
> trample each other's seams. A 6-turn matrix now costs ~2 turns of wall-clock.
> A worker's `SystemExit` (missing key / base URL) is converted to a
> `DriveError` — raw, it kills the process and the parent sees only
> `BrokenProcessPool`, i.e. a config typo reading as an infrastructure mystery.
> **Second model arm:** the Frank key permits exactly two models —
> `coding-b200/glm-5.2-nvfp4-highthroughput` (default) and
> `coding-l40s/gpt-oss-120b`. Pass `MODEL=coding-l40s/gpt-oss-120b` to run the
> non-high-throughput arm; a finding that reproduces on both is a real one.

`make t1-scenarios LLM=frank` (1 run, box-free). **The 5 pre-existing scenarios
stayed 22/22 — no regression from the new fixtures/graders.** The 8 new ones are
a first baseline, NOT a verdict: one run each, and per
[[eval_llm_turns_are_stochastic]] the pattern needs RUNS=n before anything here
is called a defect.

Clean first time: `preserve_loop_on_edit` **6/6** (the loop survived a real
edit), `trace_variable_origin` 4/4, `explain_decision_branches` 3/4,
`explain_trigger` 3/4, `impact_of_removing_a_step` 3/4.

**Open items, triaged by whose bug it probably is. Nothing below is fixed.**

**F1 — 🐛 GRADER DEFECT (fix first; it is contaminating three scenarios).**
`grounded_in_real_steps` fired on four things that are *not* invented steps:

| flagged | what it actually is |
|---|---|
| `Awaiting Action` | a picklist value quoted in the answer |
| `and hyphens` | ordinary prose inside double quotes |
| `Incident 04 Check for SLA violations` | the **playbook's own name**, punctuation-stripped |
| `Return SLA` | a decision **branch display label** |
| `Block File Hash` | the trigger's `button_label` |

All five are legitimate references to things the mounted playbook contains. The
grader's vocabulary is step names only, and its candidate filter scans
double-quoted prose. This is precisely the cry-wolf failure its own docstring
warns about — **and it is the more dangerous direction**, because a false
"the model confabulated" finding costs more than a missed one. Fix: judge
**backticked tokens only**, and widen the vocabulary to step names ∪ branch and
option display labels ∪ playbook names ∪ `button_label` ∪ module names. Then
re-run `explain_loop_semantics`, `impact_of_removing_a_step`, `explain_trigger`.
⚠️ Do not read those three as model failures until this is done.

> ✅ **FIXED (2026-07-21)** — `t1_scenarios.grounded_in_real_steps`. Two changes,
> both narrowings: (1) **backticks only** — double-quoted text is prose as often
> as it is a literal, and English quoting is not a reference marker; (2) the
> vocabulary is now **the whole mounted document, punctuation-normalized**, not
> step names. Anything the document literally contains is grounded by
> definition, which covers branch `display`s, option labels, the playbook and
> collection names, `button_label`, module names and picklist values in one rule
> instead of a list that would need extending for the next legitimate reference.
> Normalizing punctuation on both sides is what stops `Incident 04 Check for SLA
> violations` reading as invented. Pinned with all five original false positives
> **plus** a still-catches-it case (`Quarantine Endpoint`) in
> `tests/test_t1_scenario_graders.py` (38 pass).

**F2 — 🔴 LIKELY REAL MODEL DEFECT: unrequested writes on read-only asks.**
`explain_loop_semantics` and `explain_decision_branches` both emitted a full
playbook (1846 and 4812 chars) in answer to *"Don't change anything"* /
*"Just explain it, change nothing"*. `emitted_no_yaml` is doing its job. This is
not chattiness — **the widget saves the last ```yaml fence over the open
record**, so an unrequested fence is an unrequested WRITE on a turn the analyst
explicitly scoped as read-only. 2 of 5 read-only scenarios. Investigate whether
the build-intent prompt makes authoring unconditional; consider a read-only
detection or a widget-side guard that will not save a fence the user did not ask
for. **This is the single highest-value item in this section** and it had no
coverage before these scenarios existed.

> ✅ **ROOT-CAUSED + PROMPT FIX LANDED (2026-07-21), model re-run still owed.**
> The build prompt *did* make authoring unconditional. `system_prompt_build.md`'s
> "Terminal action — **hard rule**" branched only on *is a playbook open*, never
> on *did the analyst ask for a change*: with an `OPEN PLAYBOOK` block present it
> said "end the turn with the complete revised playbook as the last ```yaml
> fence" for **every** turn. Nothing anywhere told the model a fence is a write.
> (The one place that says "do not propose edits unless asked" is the `explain`
> quick-action mode — which only fires when the widget sends a chip marker, so a
> typed question never reaches it.)
> **Fix:** a new rule *above* the terminal-action rule — "**A ```yaml fence is a
> WRITE. Never emit one on a question**", naming the read-only phrasings
> (*don't change anything*, *just explain*, *explain first*, *do not edit yet*)
> and requiring prose-only; the terminal-action rule is now explicitly scoped to
> "a CHANGE request". Pinned by 2 tests in framework
> `fsr_playbooks/tests/test_build_prompt_skeleton.py` (21 pass).
> **Validated against TWO models (box-free, `--jobs` concurrency):**
> | scenario | GLM-5.2 | gpt-oss-120b |
> |---|---|---|
> | `explain_decision_branches` `no_yaml_written` | **3/3** | **3/3** |
> | `explain_loop_semantics` `no_yaml_written` | 2/3, then **3/6** on a wider run | 2/3 |
>
> So the prompt rule works — but **`explain_loop_semantics` still writes a
> playbook ~half the time on BOTH models**, byte-identical 1877 chars each time.
> Cross-model means it is not a model quirk: something about *"How many times
> does the Update SLA Status step run … Don't change anything"* still reads as an
> edit request. **F2 is improved, not closed.**
> ➡️ Next lever is NOT more prompt text — it is the widget: **refuse to adopt a
> fence the analyst did not ask for**, the same shape as the truncation guard in
> F3. A prompt is a disposition lever, and disposition is exactly what a prompt
> cannot guarantee.
>
> ✅ **CLOSED — widget guard shipped (2026-07-21, widget `d72b670`).** Re-ran T1
> vs Frank at `RUNS=6` first: `explain_loop_semantics no_yaml_written` **3/6**,
> unchanged — confirming the prompt lever is spent and the residual is real, not
> run-to-run noise. So the write is now refused where it lands: `_runTurnNow`
> latches whether the ask **scoped** the turn read-only (the composer is cleared
> by the time the fence arrives), and `_handleTurnResult` diverts the authored
> YAML into `withheldYaml`, restoring `currentYaml` untouched.
> - Deliberately narrow — phrasings that scope the turn, not every question.
>   *"How does this loop work?"* may well want the fix; *"…and don't change
>   anything"* does not. A quick-action chip is an explicit clicked intent and
>   always beats whatever phrasing rode along with it.
> - Because it is still a heuristic over English the playbook is **withheld,
>   never discarded** — a notice offers *"Load it anyway"*, so a false positive
>   costs one click rather than the model's work.
> - 15 tests (`tests/yaml.readonly.withhold.test.js`): the verbatim T1 asks,
>   prose-only turns raising no notice, `last_assistant_yaml` withheld too, and
>   **4 edit-intent asks proving the guard is not overbroad**. Widget suite
>   **808 pass**.

**F3 — ❓ UNTRIAGED: two build scenarios ended mid-sentence with no YAML.**
`add_branch_to_decision` stopped at `"…so it's evaluated before the fallback.
Let"`; `automate_manual_step` at `"…firewall connectors in parallel.Good — the"`.
Both cut off **mid-word**, which does not read like the refuse-to-author
disposition of §6c — it reads like a **cap** (max tool-loop iterations, output
token limit, or a transport truncation). Per §6e.6, *if a turn was truncated the
model never finished it and must not be scored as a refusal.* **Triage before
grading: find the stop reason.** If it is a cap, `run_one` should raise
`DriveError` for it exactly as it does for a 403 — a silently-truncated turn
graded as "no playbook authored" is the same class of false finding that cost a
session already. Note `automate_manual_step` is also the only new scenario whose
ask needs **discovery tools**, so it may simply be the longest turn.

> ✅ **TRIAGED — it is a cap, and the harness now aborts on it (2026-07-21).**
> Re-drove `add_branch_to_decision` against Frank: **`stop_reason='max_turns'`**.
> That label is a misnomer — the OpenAI provider's `_FINISH_TO_CONTRACT` maps the
> provider's `finish_reason: "length"` onto `"max_turns"`, so this is the
> **output-token cap**, not a tool-loop cap. The cap is a **hardcoded 4096** in
> all three providers (`openai_provider.py:507`, `anthropic_provider.py:464`,
> `lmstudio_provider.py:144`) — not configurable, not per-intent. Returning a
> whole real playbook plus prose does not fit in it.
> **Harness fix:** `_raise_on_drive_error` now raises `DriveError("TRUNCATED…")`
> on `max_turns` / `max_tokens` / `length` / `max_tool_turns`, exactly as it does
> for a 403, so a cap can never be scored as a refusal. 4 parametrized tests.
> 🔴 **The product-side finding is bigger than the harness one and is NOT fixed:**
> on the box, an authoring turn that overruns 4096 output tokens emits a
> **truncated ```yaml fence** — and the widget saves the last fence over the open
> record with no `stop_reason` guard (`view.controller.js` handles `error` /
> `approval_required` / `approval_unverified`, nothing for a truncation). That is
> the same destructive class as the fragment fence, arriving by a different door.
> ✅ **Widget guard SHIPPED IN CODE (not yet deployed):** `_handleTurnResult`
> now discards the fence — and `last_assistant_yaml` — from any turn whose
> `stop_reason` is `max_turns` / `max_tokens` / `length` / `max_tool_turns`,
> keeps the analyst's previous draft, and surfaces "the reply was cut off …".
> Both the blocking return and the detached poll terminal funnel through that
> one handler, so one guard covers both. 7 jest tests
> (`tests/yaml.truncated.discard.test.js`), suite **793 pass / 3 skipped**.
> ⚠️ Still open: (a) the **provider cap itself** is a hardcoded 4096 — a large
> playbook simply cannot be returned, which is a product limit, not a harness
> one; (b) **history rehydration** (`_rehydrateBuildState`) re-scans stored
> transcripts for the last fence and has no `stop_reason` to consult, so a
> truncated fence from a past turn can still be restored on refresh.
>
> ✅ **(a) FIXED — cap raised + the name collision removed (framework `9241ee0`).**
> Two defects that shared a root: *the output-token cap was invisible.*
> 1. `finish_reason: "length"` mapped onto the contract token **`max_turns`**,
>    which reads as the tool-loop budget — so a build cut off mid-playbook was
>    indistinguishable on the wire from the benign "out of tool turns, send
>    another message" stop. ⚠️ **The earlier note that `max_turns` is
>    *overloaded* was wrong**: the tool loop has always emitted its OWN reason
>    (`max_tool_turns`), and the widget's `payload.max_turns` is not consumed by
>    the connector at all — so `max_turns` never meant anything but the cap. The
>    collision was purely in the name. It now maps to **`max_tokens`**; both
>    consumers already accepted that token and `stop_reason` is an unconstrained
>    `str` on the wire, so no coordinated bump was needed.
> 2. The cap is now `_loop_helpers.DEFAULT_MAX_OUTPUT_TOKENS` = **16384**, with a
>    `max_output_tokens` ctor override on all three providers. Raised
>    **uniformly, not per-intent**, because a cap is a *ceiling, not an
>    allocation* — billing is on tokens emitted, so a 300-token triage answer
>    costs the same under a 16k ceiling as under 4k. Per-intent would buy nothing
>    and would need `intent` plumbed into the provider, which is deliberately
>    unaware of it. 16384 is the largest value gpt-4o accepts.
>
> **Proven, not assumed:** `add_branch_to_decision` — the scenario that died as a
> hard `DRIVE ERROR (TRUNCATED, stop_reason='max_turns')` — now completes with
> **6/6 checks green at 3/3 runs**.
> Still open: **(b) history rehydration** is unchanged.

**F4 — 📋 The 5 real playbooks that do not compile** (§6g above) — in
particular `set_variable.message: unknown key(s) 'tenant'` and `playbook
parameter 'records' shadows vars.input.records`. Untriaged compiler-strictness
gaps against shipped Fortinet content.

> ⏸ **NOT FIXED — blocked on the evidence.** The 5 failing playbooks were never
> saved locally (only the 5 clean ones became fixtures), so the offending YAML no
> longer exists on this machine. The `set_variable.message` allowlist is
> `{content, tags, type, thread, record, records}`
> (`compiler/resolver/normalizers.py:1457`); widening it to admit `tenant` on the
> strength of a remembered error string would be guessing at the wire contract —
> the right move is to **re-pull those playbooks from the box, install them as
> fixtures, and fix against the real documents**. Same for the `records`
> parameter shadowing. Box-dependent, so it is a separate work item.

> ✅ **UNBLOCKED + 2 of 3 leads FIXED (2026-07-21, framework `edd45d9`).** Pulled
> **400** stock playbooks from a live 8.0 appliance (`/api/3/workflows` with
> `$relationships=true`, each wrapped as a one-workflow collection envelope —
> `decompile()` takes a `WorkflowCollection`, not a bare workflow row). Compiled
> the whole corpus and bucketed by message shape. That is far better evidence
> than the original 10, and it reframed the biggest class entirely.
>
> **Baseline: 142/400 clean, 122 hard failures** (plus 136 `unknown connector`
> results that are a LOCAL reference-DB gap, not compiler bugs — excluded from
> both counts; cf. [[local_dev_loop_warmup_clobbers_reference_db]]). Grade on
> `severity == "error"` only: the result also carries lint *warnings* (absent
> `button_label`, missing `mock_result`) and counting those inflates "stock
> content does not compile" with style notes.
>
> | class | n | verdict |
> |---|---|---|
> | undeclared playbook parameter | 42 | 🐛 **our decompiler**, not strictness |
> | `set_variable.message` unknown key | 9 | 🐛 compiler strictness — all 9 are `tenant` |
> | `parameters` shadows `vars.input.records` | 5 | ⏸ judgment call, still open |
> | per-connector param-schema mismatches | ~66 | ⏸ may be reference-DB fidelity, not content bugs |
>
> **The 42 were not a strictness gap at all.** A playbook's input form is built
> from the **trigger step's `arguments.inputVariables[]`**, but the decompiler
> read declarations only from the workflow's top-level `parameters`. The two
> sources disagree on real content — most stock playbooks leave the top-level
> field empty, and *some carry a non-empty list that still omits names the
> trigger declares*, so a fallback was not enough and they must be **unioned**
> (found only because the first fix left 17 failures behind). Same silent
> data-loss class as the dropped `for_each`, and destructive the same way: pull
> → any one-field edit → save stripped the playbook's entire manual-trigger
> input form. It also meant **the compiler rejected its own decompiler's
> output**.
>
> `tenant` is the ONLY message key real content uses outside the allowlist, in 9
> playbooks — strictness rejecting valid product output. The emitter passes it
> through too, since accepting a key and then dropping it trades a loud error for
> silent data loss.
>
> **Result: 142/400 → 178/400 clean, 122 → 86 hard failures.** 8 new tests, old
> impls pinned back in and the behavioural ones verified RED (3 + 1) per
> [[tests_inherit_the_fixs_blind_spots]]. 780 pass.
> ~~⚠️ Offline/box-pull-proven only — needs a release + ship~~ → ✅ **SHIPPED
> 2026-07-22** in framework **0.4.39** (`edd45d9` verified an ancestor of the
> tag), on GA via connector 0.5.1+. Probe kept at `scratchpad/f4_pull.py`; the 86 failing playbooks
> are written out as JSON + YAML for fixture installation.

**F5 — content bug spotted in passing, not ours:** the stock `Action - IPv4
Addresses - Block Threat Feeds` playbook has `button_label: Block File Hash`.
Harmless to us, but it is why `explain_trigger`'s vocabulary needs `button_label`
in it, and worth a note if anyone files against the content pack.

### 6e.4 Order

1. ~~**Task A** (context playbook)~~ — ✅ **DONE**, S2/S5/S6 are now mountable offline.
2. ~~**Task B** (preflight resolve)~~ — ✅ **DONE**, and it reproduces the
   `find_connector` regression offline in 0.5s.
3. ~~**S3 structural offline**~~ — ✅ **DONE, and it paid off immediately**: the
   residual was one silent form (missing `vars.` prefix), found + fixed offline
   in seconds. See **§6f**. Needs a release+ship + S3 re-run to confirm on-box.
4. 🔵 **Task C** (cassette record + hermetic fallthrough) → S5/S6/S8 offline.
5. 🔵 **§6g.2 follow-ups F1→F3, in that order.** F1 is a grader defect that is
   contaminating three scenarios, so it gates reading the rest; F2 (unrequested
   writes on read-only asks) is the highest-value real finding; F3 must be
   triaged as cap-vs-refusal *before* it is scored at all. Then re-run
   `make t1-scenarios LLM=frank RUNS=3` for a pattern rather than a sample.
5. ~~Task D (make targets)~~ — ✅ `make preflight` + `make t1-turn` done; the
   rest waits on Task C.

## 6h. Session 2026-07-21 (later) — SOC-investigation offline coverage + the emit-card gap

Everything below is committed; framework/connector compiler bits are
offline-proven only and still need a release+ship.

**Shipped/committed this session:**
- ✅ needs-config panel BLESSED — widget `39d5ee1` (matches the 1.2.32 tarball
  already on both boxes; no deploy).
- ✅ **F2 CLOSED** — read-only fence guard, widget `d72b670`. Re-confirmed the
  prompt lever is spent (`explain_loop_semantics` 3/6 at RUNS=6, unchanged), so
  the write is refused where it lands. 15 tests.
- ✅ **F3(a) FIXED** — token cap 4096 → 16384 + `max_turns`→`max_tokens`,
  framework `9241ee0`. The "overloaded" belief was WRONG (see
  [[max_turns_stop_reason_is_overloaded]] — corrected). Proven: the scenario
  that died truncated now passes 6/6.
- ✅ **F4 unblocked + 2/3 leads fixed** — framework `edd45d9`, from a 400-playbook
  box pull. Biggest class was OUR decompiler dropping declared parameters, not
  strictness. 142→178/400 clean.
- ✅ **automate_manual_step 0/6 was a GRADER defect** (`cb6102f`) — second grader
  defect after F1. `replaces_step` grader; 0/6 → 3/3.
- ✅ **`scripts/session_analyze.py`** (`c843a37`) — pull agent sessions (local
  sqlite OR box) and grade tool errors + signal density. One analysis core, two
  sources.
- ✅ **SOC-investigation T1 scenarios** (`31b8e18`) — the triage half, box-free.
  Mount a real captured record through `entity`; 3 scenarios, 5 grounding
  graders, 12 grader unit tests. First offline coverage of the OTHER half of the
  product.

### 6h.1 🔴 The emit-card surface is effectively dead — MEASURED

`session_analyze.py` over the local corpus (481 sessions, 1218 tool calls):

| interactive tool | calls | note |
|---|---|---|
| `emit_action_card` | **4** | the "Block this IP" button after triage |
| `emit_decision_step` | 7 | |
| `emit_playbook_offer` | 2 | |
| `emit_capability_gap_card` | 2 | |
| `emit_choice_card` | 1 | |
| `emit_manual_input` | **0** | never fires |

Five interactive-card tools, **16 firings total** across the whole corpus, and
the one that matters for an ad-hoc action (`emit_action_card`) fired 4×. The
user's read — *"we have a lot of emit cards, not sure they're actually being
used"* — is correct on the numbers. Two hypotheses, and this session cannot tell
them apart (the corpus is dev/eval traffic, mostly GLM via Frank):
  1. the model rarely *chooses* to emit — a prompt/affordance problem, or
  2. the paths are *broken* and never reached — a functionality problem.
**Neither is tested.** This is the highest-value SOC-investigation gap.

### 6h.2 🔜 SOC-investigation quality — what still needs coverage

The 3 new scenarios cover the READ path (grounding, no-confab, honest gaps,
verdict). The gaps, roughly in priority order:

1. **Ad-hoc action after investigation** — *"ok, block that IP"* as a follow-up
   turn. This is the money path and has ZERO coverage. It should route to
   `emit_action_card` (analyst-approved) or `run_op` behind the tier-≥3 approval
   gate ([[agent_mutating_op_approval_gate]], [[agent_triage_pivot_toolset]]).
   Needs a MULTI-TURN offline scenario (investigate → then ask to act) — the
   current rig is single-turn. Assert the card/op is actually emitted with the
   right IP bound, and that it's gated, not auto-run.
2. **Emit-card liveness** — a direct offline test that each `emit_*` path, when
   the model is steered to it, produces a well-formed card the widget can
   render. Separates "model won't" from "path is broken" (6h.1).
3. **Tool-works coverage** — the triage tools (`search_module_records`,
   `find_enrichment_actions`, SIEM ops, `run_op`) are exercised only
   incidentally. A cassette-backed test per tool: given a known input, the tool
   returns the expected SHAPE and the agent uses it. Ties into Task C.
4. **Multi-turn investigation memory** — does a second turn remember the first
   turn's findings, or re-investigate from scratch? Offline, multi-message.
5. **Wrong-tool / refusal discipline** — asked something out of triage scope
   (e.g. "build me a playbook" mid-investigation), does it stay in lane?
6. **Signal density as a quality gate** — 6h.1's `session_analyze` metric
   (70% of tool output carried nothing actionable) should become a tracked
   number, not a one-off. Big-playbook-in / little-value-out is a real
   agent-usability regression risk.

### 6h.3 ZTP personas on .206 — NOT STARTED (user's second priority)

`_soc_agent_eval.py` already has ZTP scenarios (`ztpf_metadata_sources`,
`ztpf_devices`) but drives them LIVE on 206. Open question for the user (asked,
unanswered): offline in the T1 style, or live-on-206? Persona *resolution* reads
206's Key Store, so a resolution test likely needs the box; the persona's
*behaviour* can be graded offline with a fixture persona (the `persona_fixture`
seam in `local_turn`). Likely split: behaviour offline, resolution live.


## 7. RESUME HERE (post-clear)

1. Read this doc, then §3 (the design question), then the plan for whichever area you pick.
2. Confirm with the user which capability area is in scope — do not start all of them.
3. ~~Check the box model first~~ / ~~run the A/B~~ — **both done, see §6 + §6a.**
   Boxes default to gpt-4.1-mini; the A/B is settled (hallucination 0/3 → 3/3,
   but it REGRESSED authoring — read §6c before assuming it's a pure win).

4. 🔵 **START HERE — §6e: build the offline playbook-testing tiers.**
   ✅ **Tasks A, B, D-lite AND the S3 structural close are DONE** —
   `--playbook-yaml` context-playbook seam, `scripts/preflight.py`,
   `make preflight` / `make t1-turn`, and the §6f `vars.`-prefix compiler fix.
   19 new tests; connector suite **432 passed / 7 skipped**, framework
   **764 passed / 12 skipped**. Commits **ALL UNPUSHED**: connector `ed7dd89`,
   `8ac3649`; framework `4dc754f`.
   ⚠️ **The §6f fix is offline-proven only** — it needs `make release` +
   `make bump-framework` + `make ship` and an S3 re-run to confirm 2/5 moves.
   **NEXT = Task C** (cassette record + hermetic fallthrough). Use the ~12s T1 loop
   ([[fast_local_validation_loop_frank]]) — **do not** release+ship to validate a
   framework change again.

5. Other open items from this session:
   - 🐛 `wrong_entity_repro.ran_validation_playbook` fails on *both* models —
     an independent defect, untriaged.
   - ✅ ~~S3 residual is the Jinja output path~~ — **CLOSED offline, §6f.** Only
     the missing `vars.` prefix was uncovered (`.result` and the bare-field form
     were already auto-repaired); fixed in framework `4dc754f`. Awaiting
     release+ship + an S3 re-run.
   - ⚠️ **159 is still on connector 0.4.93** (old `find_connector`); only 206 got
     0.4.94. Ship 159 to match.
   - S6's one failure called only `verify_enhancement` — never
     `why_did_playbook_fail`, so the 0.4.78 diagnose-before-fix lever didn't fire.
   - Dead worktree `fpb-fix-persona-resume` (0 unique commits, 55 behind) — safe
     to `git worktree remove`; not yet done.
   - ✅ ~~`export FRANK_MODEL=…` belongs in `~/.zshenv`~~ — **NO LONGER NEEDED.**
     Root-caused and fixed in code (§6e.6): the loop now works with `FRANK_MODEL`
     unset. The old note also mis-scoped it to `--tools live`; it fires on any
     tool-using turn.
4. LLM turns are stochastic — grade the pattern over N runs, never one sample
   ([[eval_llm_turns_are_stochastic]]).

### 6f. S3 authoring A/B on GA — gpt-4.1-mini vs claude-haiku-4-5 (2026-07-23)

Ran `eval_s3_connector.py --runs 5` on GA (159:13000, connector 0.5.9) for two
arms. **GA has NO gpt-4o config** — both `default` and `fsrpb-live` resolve to
gpt-4.1-mini (the `fsrpb-live=gpt-4o` mapping is 206-only). The only non-41mini
model on GA is `fsrpb-anthropic` → claude-haiku-4-5. So the "does a stronger
model fix authoring" hypothesis is **not testable on GA** without provisioning a
stronger config.

**Result — both 0/5, but failure QUALITY is decisive:**
- **gpt-4.1-mini: scattered/structural** — some runs no YAML; one wandered into
  the ENHANCE path on a CREATE task (`stop=awaiting_enhancement_offer`); one
  dropped the named connector op. Incoherent.
- **claude-haiku-4-5: consistent/one bug** — EVERY run authored the right op,
  validated, verified, emitted the offer, deployed AND ran; failed only on output
  binding — referenced `.data` (Array) not `.data.minutes` (scalar) → alert
  description rendered `Array` instead of `180`.

**Takeaways:**
1. Haiku is the qualitatively BETTER authoring model of the two — one promptable
   fix from passing. **NEXT: teach connector-output-shape referencing**
   (`{{ vars.steps.X.data.minutes }}`), re-run haiku S3, expect 0/5 → passing.
2. **OPEN DECISION: per-intent model routing** — build wants haiku (coherent
   authoring), triage wants 41mini (no-halluc, per §6a). Run the TRIAGE-side A/B
   on GA to confirm the tradeoff still holds before committing to routing.
3. See [[s3_authoring_ab_gpt41mini_vs_haiku_ga]] and
   [[resume_2026_07_23_enhance_delivery_ship]].
