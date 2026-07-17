# Build-persona validation plan — "the playbook actually runs"

**Sibling plan:** `live-chat-eval-and-build-flow-fixes.md` (triage-side T2/D2 defects; shares the
prompt file but does not block this work).

---

## ▶ RESUME HERE (last touched 2026-07-16)

**Where the work is: the plumbing is fixed and live-verified; the actual question is unanswered.**
P0/P1/P3 are done. **Nothing yet tests whether the assistant is any GOOD at building playbooks** —
that starts at S2, and P2 is the only thing in the way.

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

1. **P2 — the eval harness.** `scripts/_p1_snapshot_live_confirm.py` in the connector repo is a
   WORKING prototype (gitignored per the `scripts/_*` convention — read it before rebuilding).
   Generalise: fixture deploy (`import_from_yaml(replace=True)`) + `clone()` per test, trigger+wait,
   marker-record assertion helper, `diff_versions` helper, run cleanup.
2. **S2 — modify an existing playbook.** First real scenario. Smallest, sharpest oracle, and it
   exercises everything P0/P1 just fixed. A passing S2 also regression-tests P1 for free.
3. **P4 — the designer prompt.** Deliberately AFTER S2: writing a better prompt before the harness
   exists is tuning blind, and this session is a strong argument against that.

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
