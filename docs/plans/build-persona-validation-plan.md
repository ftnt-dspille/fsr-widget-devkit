# Build-persona validation plan — "the playbook actually runs"

**Status:** DRAFT — not started. Written 2026-07-16.
**Sibling plan:** `live-chat-eval-and-build-flow-fixes.md` (triage-side T2/D2 defects; shares the
prompt file but does not block this work).

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

1. **The build persona lives in the playbook designer, and only there.** Its prompt may therefore
   *assume* an open playbook with a real step graph, a UUID, and an ask that is about that
   playbook. This is what lets the prompt be specific rather than defensive.
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

## P1 — ✅ BUILT (uncommitted, unshipped). The snapshot gap was a live defect.

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
- **P2** — harness: fixture deploy/clone/teardown, trigger+wait, marker-record assertion helper,
  `diff_versions` assertion helper, run cleanup. (pyfsr gaps: no run cleanup, no step-assert
  helpers — thin wrappers, we build them.)
- **P3** — flag off `step_test`; retire `config.defaultIntent='build'`.
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
