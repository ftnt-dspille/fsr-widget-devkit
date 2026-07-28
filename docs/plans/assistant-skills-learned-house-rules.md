---
title: Assistant Skills — learned house rules as records
status: in-progress
topics: [agentic-assistant, personas, skills, ztpf]
summary: A custom module `assistant_skills` stores per-module house rules the agent reads (and can write) to shape how generic tools are used, without connector edits. Born from 8 live .206 analyst FIXMEs.
---

# Assistant Skills — learned house rules as records

## Why

Grepping stored .206 chat sessions for analyst `FIXME:` notes surfaced 8
corrections (see `session_analyze.py --replay --defects`). Every one is the
analyst *teaching the assistant a rule* for a specific module/task — not a tool
bug. Baking any of them into a tool would (a) hardcode one site's preference into
a generic primitive and (b) require a connector release to change.

**Principle (user-directed): tools stay generic; skills shape how tools are
used.** A skill is data the user owns and the agent can grow.

## Architecture

Two layers, both fail-open, both Key-Store/module data — no tool branches:

| Layer | Store | Answers | Editable by |
|---|---|---|---|
| **Persona** (existing) | Key Store `fsr_assistant_profile:<module>` | who am I, which tools, quick-actions | user (UI) |
| **Skills** (new) | custom module `assistant_skills` | granular house rules for a module | user (grid) **and the agent** |

### The skills module

`assistant_skills` — one record per rule:

| field | meaning |
|---|---|
| `scope_module` | module the rule applies to (e.g. `ztpf_devices`); blank = global |
| `trigger` | short human name ("list pending steps") |
| `instruction` | the rule text injected into the prompt |
| `enabled` | bool; disabled rules kept for history, not applied |
| `priority` | int; higher sorts earlier in the injected block |
| `source` | `analyst` \| `agent` (provenance) |

### Read path (SHIPPED in connector code)

- `fsr_soc_triage/skills.py` — `load_skills(client, module)` pulls enabled rules
  scoped to the module **plus** globals, highest-priority first; `render_skills_block`
  renders a `## Learned house rules` prompt section framed as OVERRIDES.
- `operations._resolve_profile` → `_apply_skills` folds the block onto the
  resolved persona's prompt once, so every downstream path (ungrounded, grounded,
  resume) inherits it. Cached with the profile. Fail-open: no `assistant_skills`
  module (404) or any read error ⇒ prompt unchanged.
- Tests: `fsr_soc_triage/tests/test_skills.py` (15, offline).

### Write path (NO new tool needed)

A skill is an ordinary record: the agent creates/updates it with the existing
**persona-gated, tier-3 approval-carded** `create_record` / `update_record`
(module = `assistant_skills`). For that to work the module's persona must list
`assistant_skills` in `may_write` and include the write tools in `tools.allow`.
So capturing a FIXME as a durable skill = one approval-carded `create_record`.

## The 8 FIXMEs → skills (seed data)

All from live .206, initiator james hilving. Replay: `session_analyze.py --env <.env.206> --replay --defects`.

Ground-truth `ztpf_device_automation_steps` fields (live 8.0): relationships
`ztpfAutomationActions`, `ztpfDevices`, `ztpfRunGroups`; order `stepNumber`;
outputs `outputMarkdown`, `outputSourceData`; timing `stepStartTimestamp`/`stepStopTimestamp`/`stepTime`.

| session | scope_module | skill (instruction) |
|---|---|---|
| lpa30d4s | ztpf_devices | When listing playbooks, do not offer any whose name contains "deprecated". |
| cbjul0hr | ztpf_devices | When summarizing run groups, include how long ago each run group ran (relative time from its timestamp). |
| m3zxn9rn | ztpf_devices | Sort run groups by createDate descending; within a run group, sort steps by `stepNumber` ascending (execution order). |
| 3ekddn8m | ztpf_devices | "list pending device steps" = steps on this device with no run group (`ztpfRunGroups` is empty). "Run the pending steps" = run the playbook "Create Run Group and Queue Steps" (never run the step records individually). |
| yyf7icf4 | ztpf_devices | "the devices in this module" means the `ztpf_devices` module — read all of its records. |
| 7rb2m81c | **ztpf_automation_actions** (needs persona) | To find every device an action ran on, traverse in order: search `ztpf_device_automation_steps` where `ztpfAutomationActions.uuid` = this action, then collect the distinct `ztpfDevices` from those steps. Show each step's `outputMarkdown` / `outputSourceData` for results. |
| rkqpjiq7 | **ztpf_automation_actions** (needs persona) | Here you AUTHOR automation-action records (templates keyed by Category + Type that call the right playbook). Do NOT offer to "build a playbook" or use containment/triage tooling. |
| ipz3qfp6 | ztpf_metadata_sources | Help create a record IN the current module; a static metadata source needs a `name` and the raw script/data body. |

## Remaining work (box DATA — deploy)

1. **Create the `assistant_skills` custom module** (fields above). `create_module`.
2. **Create the missing `ztpf_automation_actions` persona** (Key Store) — identity =
   "author automation-action records", tool allowlist WITHOUT build/containment,
   `may_write: [ztpf_automation_actions, assistant_skills]`, quick-actions.
3. **Add `assistant_skills` to `may_write`** (and `create_record`/`update_record`
   to `tools.allow`) on the ztpf personas that should let the agent capture skills.
4. **Seed the skill records** from the table above.
5. **Ship the connector** (skills read path) and live-verify the replay FIXMEs no
   longer reproduce.

## Follow-ups / open questions
- Should a global (blank-scope) skill apply to plain triage turns (no persona)?
  Today `_apply_skills` only runs when a persona resolves. Revisit if house rules
  are wanted on alert/incident pages too.
- Positive `_PROFILE_CACHE` is process-life, so a newly-added skill needs a worker
  recycle to take effect (same property personas already have). Acceptable for v1.
- 8.0 organizational-context module considered for tenant-scoped skills; deferred
  (semantics = facts about the org, not assistant behavior). Revisit for MSSP.
