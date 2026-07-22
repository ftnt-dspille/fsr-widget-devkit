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

The F4 work (framework `edd45d9`, **shipped in 0.4.40 → GA**) pulled **400 stock
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

- Promote the throwaway probe (`f4_pull.py`, written to a scratchpad and since
  lost) into a committed tool: `scripts/corpus_pull.py`.
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

### 4.2 Errors as affordances (the actual agent question)

The question behind *"does the YAML need to be simpler"* turned out **not** to be
about syntax — it is whether a failure tells the agent what to do next.

| today | problem | better |
|---|---|---|
| `required param 'ip' is missing` | ✅ already actionable | — |
| `value '/api/3/picklists/1c4d…' is not in picklist` | ✗ hands the agent an **opaque IRI** it cannot reason about or resolve | name the picklist, list valid display values, and say how to resolve one |

Deliverable: an audit of every compiler error string against one test — *can an
agent act on this without another tool call?* — and a fix pass on the ones that
fail it. This is measurable through the existing offline scenario rig, not by
opinion.

---

## 5. Risks / open questions

| # | risk |
|---|---|
| R1 | **Corpus licensing/PII.** 400 stock playbooks from a customer-representative appliance become committed fixtures. Confirm they are stock content only, and scrub any tenant/host specifics per the public-repo hygiene rule. |
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

**Phase 1.1 + 1.2 only** — commit the puller, commit the corpus, build the diff.
Even with zero new bugs fixed, that converts "we found two silent data-loss bugs
by accident" into "we would have caught both automatically", which is the entire
argument for this plan.
