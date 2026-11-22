---
name: agentic-eval-method
description: Use when designing, running or grading an eval or test of the agent loop (A/B arms, sweeps, known-answer, sims), when writing a regression test for an agent fix, when a result looks too clean, or when deciding sample size, model, and time budget for routine verification.
---

# Agentic eval and test method

## Budget and sample size
- Cheapest look at one behaviour end to end (widget cards included): `make local-chat BUNDLE=<name> [ASK=...]` (root repo): real widget + real connector in local Python + Frank (fake if down) + a fixture bundle for the box, one turn, screenshot + transcript + tool calls in `scratch/local-chat/`. Read the png. Run it first; it needs no box. ka_* bundles are known-answer rows (graded by the connector sweep, not here).
- Routine change: fast tiers (tool-sweep ~2-8s, t1 fake/frank ~11s, unit) plus a SMALL deterministic sample of
  the slow tiers (a few sessions or scenarios, 2 runs). Brief subagents with the time budget and sample size up
  front. Full analyst-sim / known-answer / 30-session runs are for sprint-level gates or when asked.
- Start sweeps small: `SAMPLE=1` (one row per surface), then one `CATEGORY=`, then the full corpus. A harness
  that is still changing wastes a full corpus on harness failures.
- Two runs per arm, not five. A defect that reproduces twice is a defect; a clean 2/2 is NOT proof of a fix.
- Frank `eco` for frequent offline runs; Haiku for paid offline/box runs (allowed); no unannounced paid batches.
- Eco is noisy. Prefer deterministic replay of recorded calls and rates over many calls to 3-run A/B.
- Grade structure, not disposition: the Frank model and box model differ in caution and verbosity;
  continuity and groundedness transfer.

## A clean run is not evidence
- A defect is only observable if the model exercises it. Grade the defect (did the offending tool get called,
  was the output right), not the symptom. Never auto-promote an expected-failure row off one clean run. Put
  determinism-requiring gates outside the LLM turn.
- Tests written from the same mental model as the fix inherit its blind spots. Red check: pin the OLD
  implementation back in (scratch worktree, throwaway plugin or revert) and confirm the new test fails; add it
  to the mutants manifest (`make mutants`).
- Card/UI tests must assert content that is TRUE (verdict value, record fields), not that a card exists. A
  fixture can contain the bug's evidence and still pass.
- Verify the write, not the card: approve on a live box and read the record back (`$relationships=true`).
  Hook and test the live route (`_resume_action_card_execute`), not the fallback path.
- A grader must be able to fail: pin one passing and one failing case; build fixtures by calling the producer.
  Vacuous graders (reading a fence the build path never emits) have hidden whole surfaces.
- Skip is not pass; a collection error is not a pass; a Disconnected connector or missing seed is SKIP.
- Gates that cannot observe their subject report blindness as coverage. Audit "is X wired?" with a reachability
  closure (AST/registry walk), never a flat grep, and make the relationship itself an assertion.
- Parallel hardcoded name lists drift (tool/op name lists in guards vs registries). Assert the relationship
  between lists, or derive one from the other.

## Method for tightening validators and guards
- Replay recorded real calls (tens of thousands exist in stored sessions) through a new validator, applying the
  dispatch coercions first; count calls that worked before and would now be refused. Review each hit.
- No regex or phrase-list intent detection; gate on structure (cards emitted, draft contents, bound state).
- Prefer a tool-contract change that makes the mistake impossible, then delete the guard it replaces. When
  hunt/containment behaviour drifts, rebalance imperative prompt rules before adding guards.
- Do not add a second validator beside tailored refusals (a schema pre-check pre-empted specific codes).
- Extend the library (`fsr_playbooks` validators) before writing a new checker.
- Use typed models (pydantic) for wire frames and tool inputs.

## Measurement traps
- Dedup by uuid: playbook corpus rows repeat (495 rows are 191 playbooks).
- Compilability and fidelity are different questions; conflating them makes a no-op look like a win.
- `resolve_config`-style fallbacks and `LLM=fake` defaults silently grade the wrong thing. Pass
  `--expect-model` and assert the resolved model from the transcript usage entry.
- Cache accounting differs by provider (OpenAI cached tokens are a subset of input; Anthropic disjoint).
- Re-grade stored transcripts instead of re-driving (see session-diagnosis-regrade).
- Machine load can fail boot-time waits uniformly; judge by the shape of failures.

Sources: feedback_verification_must_be_fast, eval_runs_default_two, sweeps_start_small, eval_llm_turns_are_stochastic,
tests_inherit_the_fixs_blind_spots, tests_assert_shape_not_truth, verify_the_write_not_the_card,
coverage_audits_must_be_closures, parallel_name_lists_drift, arg_gate_w1_replay_method, no_regex_intent_detection,
t2_containment_drift, library_first_validation (conn_main/framework CLAUDE.md already hold the core rules).
