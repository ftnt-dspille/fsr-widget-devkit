# Playbook compiler — round-trip fidelity gate + agent-facing surface

**Status:** spec only, nothing implemented. Written 2026-07-22.
**Origin:** proposed in conversation 2026-07-21 (*"does the yaml need to be
simpler so that…"*), deprioritized the same session when the GA demo became top
priority, and **never written down** — it survived only in a session transcript.
That is the exact failure mode this plan's own argument names: work filed as
someone else's follow-up bullet stays invisible. Hence a doc of its own.

**Scope note:** this is about the **compiler/decompiler** — the framework's
playbook read/write path. It is *not* the connector wire-shape typing work
(`connector-fsr-soc-assistant/PLAN.md`), and not `WIRE_SHAPE_GAP_PLAN.md`
(✅ complete 2026-06-25, which already delivered the *authoring ergonomics* half:
the universal step envelope + `retry:`/`on_remote:`/`post_comment:` sugars).

---

## 1. Why this exists

### The failure mode is silent destruction, not a bad error message

The widget saves the agent's last ```yaml fence **back over the open record**.
So any field the decompiler fails to read is not merely missing from the YAML —
it is **deleted from the customer's playbook** on the next one-field edit, with
no error and no diff an analyst would notice.

This has now happened **twice**, through the same path:

| bug | what was lost | how it was found |
|---|---|---|
| dropped `for_each` | loop config on a step | by accident, chasing something else |
| dropped declared `parameters` | the playbook's entire manual-trigger input form | by accident, during the F4 corpus pull |

Both were invisible to **every existing test tier**, and this is the crux:

- **unit fixtures are synthesized** — they inherit the fix's blind spots
  ([[tests_inherit_the_fixs_blind_spots]]);
- **mock e2e is hermetic** — it never sees real content;
- **the live sweep drives the UI**, not the compiler.

So nothing in the pipeline can currently answer *"how many more are there?"*

The `parameters` bug had a second tell worth stating plainly: **the compiler
rejected its own decompiler's output.** A round-trip gate is exactly the
instrument that catches that class, and there wasn't one.

### There is now a real metric, and nobody owns it

The F4 work (framework `edd45d9`, **shipped in 0.4.39 → GA**) pulled **400 stock
playbooks** from a live 8.0 appliance and moved the corpus from
**142/400 → 178/400 clean** (122 → 86 hard failures). That number is a genuine
regression metric currently living in a scratchpad probe. Phase 1 is mostly
about making it a **gate that someone owns**.

---

## 2. Goal / what "done" means

**Phase 1 (safety).** A CI-able gate that pulls a corpus of real playbooks,
round-trips each (decompile → compile → diff vs the original wire JSON), and
**fails on any field that does not survive**. Corpus pass-rate is tracked so it
cannot silently regress.

**Phase 2 (capability).** The residual failures triaged, and compile errors
turned into **affordances an agent can act on**.

### Explicit non-goals

- **The 136 `unknown connector` results.** A local reference-DB gap, not a
  compiler bug (cf. [[local_dev_loop_warmup_clobbers_reference_db]]). Excluded
  from every count here; do not let them re-enter the denominator.
- **Rewriting the YAML dialect.** The ergonomics work is *done*
  (`WIRE_SHAPE_GAP_PLAN.md` Phase 3). The remaining problem is fidelity and
  error quality, not syntax.
- **Grading on lint warnings.** Grade `severity == "error"` only — counting
  style notes (absent `button_label`, missing `mock_result`) inflates "stock
  content does not compile" with noise.

---

## 3. Phase 1 — round-trip fidelity gate

### 3.1 Own the corpus

- ✅ **The probe was recovered, not lost** — `f4_pull.py` was still in the
  2026-07-21 session scratchpad under `/private/tmp/...` (ephemeral). It is now
  committed at **`fsr-playbook-framework/scripts/corpus_pull.py`**. The 1,389
  written-out failing playbooks (`f4_failing/`, JSON + YAML per playbook) are
  also recovered, to `fsr-playbook-framework/scratch/f4_failing/` (14 MB) —
  **gitignored for now**: `scratch/` is a tracked directory, so the dump would
  otherwise be committed by a `git add -A` before the R1 review. A scan found
  **no lab IPs**, but licensing/PII review still gates committing it.
- Pull via `/api/3/workflows?$relationships=true`, wrapping **each workflow as a
  one-workflow collection envelope** — `decompile()` takes a
  `WorkflowCollection`, not a bare workflow row. This cost time last round;
  encode it.
- **Commit the corpus as fixtures**, not just the puller. The original F4
  10-playbook corpus was never saved, which is *why* F4 sat blocked — it could
  not be re-derived without a box. Redacted/anonymized if needed, but committed.

### 3.2 The gate itself

For each playbook: `wire JSON → decompile → YAML → compile → wire JSON`, then
diff **field-by-field against the original**.

- Fail on **any dropped key**. Data loss is the whole point; a "close enough"
  diff defeats it.
- Distinguish three outcomes: **identical** / **semantically equal** (key order,
  defaults) / **lossy** (fail).
- Emit a pass-rate. Baseline to pin today: **178/400**.

### 3.3 Wire it into the pipeline

- A `make corpus-gate` target, box-free once fixtures are committed.
- Ratchet: the gate fails if pass-rate **drops**, so a fix can't regress another
  field silently.

---

## 4. Phase 2 — compiler surface for agents

**Downstream of Phase 1** — don't start until the gate is green and owned.

### 4.1 Triage the 86 residual hard failures

Known buckets from the F4 pull:

| class | n | verdict |
|---|---|---|
| `parameters` shadows `vars.input.records` | 5 | ⏸ judgment call, still open |
| per-connector param-schema mismatches | ~66 | ⏸ may be reference-DB fidelity, not content bugs |
| remainder | ~15 | unbucketed |

Resolve the ~66 first: if they are reference-DB fidelity rather than content
bugs, the true residual is far smaller and Phase 2 shrinks dramatically.

### 4.2 Errors as affordances — now backed by evidence

There is a second recovered script that answers the *"does the YAML need to be
simpler"* question directly, and it is the more important of the two:
**`connector-fsr-soc-assistant/scripts/validate_yaml_corpus.py`** (recovered
from the same scratchpad, now committed alongside `session_analyze.py`). It
mines every `validate_yaml` call out of the connector's session store and
buckets the errors that came back — *"to decide, on evidence, whether the lever
is a better PROMPT, a better LANGUAGE, or better TOOL OUTPUT, rather than
guessing from the failures we happen to remember."*

**Run 2026-07-22 — 61 call/result pairs across 50 sessions:**

    submissions with NO hard error : 60/61
    severity mix                   : 76 warnings, 1 error

⚠️ Pairing caveat, encoded in the script: `chat_messages` stores tool_use and
tool_result separately and results are keyed by the provider's `tool_call_id`,
so they pair by **adjacency across ALL tools** — queueing only the target tool
mis-attributes another tool's result. Independently re-verified for this run:
all 61 paired results are genuine `validate_yaml` envelopes, 0 suspicious.

**This overturns the plan's original premise.** Agents are *not* failing to
produce valid playbook YAML — 60 of 61 submissions had **no hard error at all**.
So "make the YAML simpler" is not indicated for *validity*. The real surface is
the **warning** tail and message quality:

| n | finding | read |
|---|---|---|
| 23 | `InsertData.arguments.step_variables is missing — every corpus sample sets this key` | convention the agent can't infer; a **prompt/tool-output** lever |
| 15 | `unknown argument 'X' for handler 'X'` | schema drift or genuine agent error — needs splitting |
| 7 | `InsertData.arguments.resource is missing` | same class as the 23 |
| **7 + 4** | **`connector step has step-level 'connector:' — hoisted into 'arguments.connector'`** and `step-level key 'resource' … nest it under 'arguments:'` | ⭐ **the one real LANGUAGE signal** — the agent repeatedly puts keys at step level instead of under `arguments:`. `WIRE_SHAPE_GAP_PLAN` Phase 3 hoisted the *universal envelope* but not `connector:`/`resource:`. Extending the hoist would delete this class outright. |
| 4 | `reference catalog was warmed from a DIFFERENT SOAR than target …` | **environment**, not agent — cf. [[local_dev_loop_warmup_clobbers_reference_db]] |
| 2–3 | `value '/api/3/picklists/1c4def41-…' is not in picklist 'IndicatorType' (valid: Domain, Email Address, …)` | the opaque-IRI case — **confirmed real**, and note the message *does* list valid values; the defect is that the agent was handed an IRI to begin with |

**Revised Phase 2 deliverables, in evidence order:**

1. **Extend the step-level hoist to `connector:` / `resource:`** (11 occurrences,
   pure language ergonomics, mirrors a pattern already shipped).
2. **Kill the `step_variables` / `resource` convention warnings** (30
   occurrences) — either default them in the emitter or teach them in the tool
   output; they are the single biggest bucket by far.
3. Split the 15 `unknown_param` cases into schema-drift vs real agent error.
4. Only then the error-string audit: *can an agent act on this without another
   tool call?*

Re-run `validate_yaml_corpus.py` after each to measure, rather than asserting
improvement.

---

## 5. Risks / open questions

| # | risk |
|---|---|
| R1 | **Corpus licensing/PII — now concrete.** The 1,389-file dump is recovered to a gitignored `scratch/f4_failing/`. An IP scan came back clean, but before it becomes a committed fixture: confirm stock content only, and scrub tenant/host specifics per the public-repo hygiene rule. **This gates Phase 1.1.** |
| R2 | **Ratchet brittleness.** A legitimate compiler improvement can change wire output and read as a regression. The gate needs a documented "accept new baseline" path or it gets disabled the first time it's inconvenient. |
| R3 | **`parameters` vs `vars.input.records` (5 cases) is a real judgment call**, not a bug to fix blindly — decide the semantics before coding. |
| R4 | Phase 2's ~66 param-schema mismatches may dissolve into a reference-DB refresh, making Phase 2 much smaller than it looks — **measure before scoping**. |

**Open question:** should the gate run against a *live pull* (fresh, catches
platform drift, needs a box) or *committed fixtures* (deterministic, CI-able,
goes stale)? Recommendation: **fixtures for the gate**, plus an occasional
live-pull refresh job — the whole point is that it runs when nobody is thinking
about it.

---

## 6. Verification

```bash
cd fsr-playbook-framework
FSRPB_DEV=1 .venv/bin/python -m pytest fsr_playbooks/tests -q   # baseline: 785 passed
make corpus-gate                                               # new; must report >= 178/400
```

Per the "tests inherit the fix's blind spots" rule: for each fidelity bug the
gate catches, **pin the old implementation back in and confirm the gate goes
RED** before accepting the fix.

---

## 7. Recommended first slice

**Phase 1.1 + 1.2** — the puller is now committed; commit the corpus and build
the diff. Phase 2 item 1 (hoist `connector:`/`resource:`) is a strong parallel
candidate: 11 evidenced occurrences, and it mirrors a pattern already shipped.
Even with zero new bugs fixed, that converts "we found two silent data-loss bugs
by accident" into "we would have caught both automatically", which is the entire
argument for this plan.
