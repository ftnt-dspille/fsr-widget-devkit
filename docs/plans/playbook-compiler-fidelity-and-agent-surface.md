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

### 4.2 Errors as affordances — evidence, from BOTH corpora

The tool that answers the *"does the YAML need to be simpler"* question is
**`session_analyze.py --tool validate_yaml`** in the connector repo, now wired
to make targets so it is a command rather than a rediscovered scratchpad script:

    make analyze      TOOL=validate_yaml      # local dev/eval corpus
    make analyze-box  TOOL=validate_yaml ENV=…/.env.fsr-ga
    make analyze-yaml ENV=…/.env.fsr-ga       # both, side by side

> A standalone `validate_yaml_corpus.py` was recovered from the same scratchpad
> and then **deleted**: it is the older local-only version of this same analysis
> and produced identical counts. Two implementations of one analysis is the
> drift bug class ([[parallel_name_lists_drift_bug_class]]) — keep one.

#### ⚠️ The two sources disagree. Run both.

| | **local** (long-lived dev/eval) | **GA box** (since last publish) |
|---|---|---|
| calls / sessions | 61 / 50 | 16 / 6 |
| **with a HARD error** | **1** | **5 of 16 (31%)** |
| advisory only | 47 | 8 |
| top finding | `InsertData.arguments.step_variables is missing` ×23 *(warning)* | **`set_variable outputs live at top-level vars, not under the step-output namespace` ×11 *(error)*** |

**A local-only read gives the wrong answer.** Local says agents almost never
emit invalid YAML (60/61 clean) and the surface is a warning tail. The box says
**roughly a third of real submissions carry a hard error**, and the top cause is
a different, deeper problem.

⚠️ Caveats on both: the box store is **wiped on connector upgrade**, so its 16
calls only cover sessions since the last publish (four connector versions
shipped 2026-07-22) — small N, treat as directional. Local is long-lived but is
dev/eval traffic, not production. Neither alone is authoritative.

#### What the box says the real problem is

| n | finding | read |
|---|---|---|
| **11** | **`vars.steps.X.y` rewritten — `set_variable` outputs live at top-level `vars`, not under the step-output namespace** | ⭐ **the genuine language/mental-model defect.** The agent has the wrong model of *where variables live*. Matches the known S3 residual (`.result` vs `.data.<field>`, missing `vars.` prefix). |
| 7 | `unknown connector: 'X'` | **discovery**, not authoring — cf. the `find_connector` first-word bug already fixed |
| 6 | Jinja ref `X is not in step X's output keys ()` | the agent guesses output keys; empty `()` means we could not tell it what they are |
| 3 | `unknown Jinja filter 'X'` | filter catalog gap or hallucination — split these |
| 1 each | duplicate start steps, missing required param, bad `parameters` shape | long tail |

#### Revised Phase 2 deliverables, in evidence order

1. **Fix the variable-namespace mental model** (11 box errors). The compiler
   already auto-rewrites `vars.steps.X.y` → `vars.y` — so the *fix* exists and
   the *teaching* does not. Decide: is the lever the prompt, the tool output, or
   making the wrong form legal? This is the closest thing to "the YAML needs to
   be simpler" that the evidence actually supports.
2. **Tell the agent the real output keys.** Six findings say `output keys ()` —
   an empty set. An error naming what *is* available is actionable; one naming
   what isn't, isn't.
3. **Step-level nesting hoist** — `connector:`/`resource:` at step level instead
   of under `arguments:` (11 local occurrences, warnings). Mirrors the shipped
   `WIRE_SHAPE_GAP_PLAN` Phase-3 envelope hoist; would delete the class.
4. **Kill the `step_variables`/`resource` convention warnings** (30 local) —
   default them in the emitter or teach them in tool output.
5. The opaque picklist IRI, and the error-string audit: *can an agent act on
   this without another tool call?*

**Re-run `make analyze-yaml` after each change to measure**, rather than
asserting improvement. Growing the box sample matters as much as any fix —
16 calls is too few to steer on alone.

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
