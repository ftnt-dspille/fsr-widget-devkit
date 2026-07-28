---
title: Scheduled Agent Tasks
category: plans
status: plan
source: hand-written
topics:
  - feature-design
  - scheduling
  - cron
  - agent-loop
  - soc-assistant
summary: Design for recurring/ scheduled agent tasks built into the
  fortiaiAgenticAssistant widget. Each task = one generated runner playbook +
  one FortiSOAR scheduler row. The widget panel manages the prompt; cron is
  native FSR scheduling. Platform facts live-verified on 8.0.0.
---

# Scheduled Agent Tasks — design plan

A Hermes/OpenClaw-style recurring-task feature for the SOC Assistant: run the
agent (`chat_turn`) on a cron schedule, with an intuitive UX that lets the
analyst manage **the prompt** ("what the agent does at this interval") rather
than the plumbing. Lives entirely inside `fortiaiAgenticAssistant` as a new
panel.

## 1. Platform facts (verified live on 8.0.0)

These are the constraints the design is grounded in — all confirmed against a
live box, not assumed.

### 1.1 The scheduler is django-celery-beat

- Scheduled triggers live in the **sealab wf-engine DB**
  (`django_celery_beat_periodictask`), not the PHP `/api/3/` DB. Managed via
  `POST/GET/PUT/DELETE /api/wf/api/scheduled/` + the designer "Schedule
  Trigger" UI.
- `celerybeatd.service` reads those rows and enqueues due tasks onto
  RabbitMQ; `celeryd` workers drain + execute. Stop beat → schedules
  silently stop firing (manual runs keep working). Only one beat per cluster
  (HA failover handles this).
- A scheduled task is a `PeriodicTask` with a nested `crontab`
  (`minute`/`hour`/`day_of_month`/`month_of_year`/`day_of_week`/`timezone`)
  and a `kwargs` payload.

### 1.2 The schedule payload is fixed — no free-form data

`kwargs` carries **only** `wf_iri` (which playbook to run) plus
`exit_if_running`/`timezone`/`utcOffset`. The server fills `auth`,
`schedule_entry_name`, `schedule_id`, `referenceid`, `name`, `description`.
**There is no slot to pass an arbitrary task ID, prompt, or data blob.**

> This is the decisive constraint. It means "one generic runner playbook +
> task-IRI-in-the-payload" is **impossible** through the scheduler row. The
> design must be: **the playbook IS the task.** Each scheduled task = one
> generated runner playbook + one schedule row pointing at it.

### 1.3 The `id` is a rotating Fernet token — key by `name`

Each row's `id` is a per-request Fernet token that decrypts to a stable
primary key but **rotates between requests**. Always look a task up by `name`
before writing it back. The id from one GET is fine to PUT/trigger immediately,
but never cache it long-lived. (`pyfsr` `SchedulesAPI` already does this.)

### 1.4 The connector already reaches `/api/wf/` — zero new transport

The `connector-fsr-soc-assistant` live transport is
`integrations.crudhub.make_request` — a service-token loopback against
`https://localhost` that hits nginx, which routes both `/api/3/` (PHP) and
`/api/wf/` (Django wf-engine). Existing ops already call:
- `/api/wf/api/workflows/{pk}/` (GET run details) — `operations.py`
- `/api/wf/api/workflows/?format=json&limit=1&ordering=-modified` (run lookup)
- `/api/wf/api/jinja-editor/?format=json` (POST render)

So `/api/wf/api/scheduled/` is reachable from the connector via the same
`make_request` shim. No separate HTTP client, no new auth, no SSH. The
schedule CRUD ops reuse `_live_crudhub._make_request()` / `make_cyops_request`.

### 1.5 Full schedule lifecycle confirmed working

Verified end-to-end via `pyfsr` (the same wire shape the connector will use):

| Op | Result |
|----|--------|
| `create(name, iri, cron)` | Returns `ScheduledTask`; server fills `task=workflow.tasks.periodic_task` |
| `get(name)` | Returns `None` when absent (not raise) — use for idempotent checks |
| `trigger_now(name=)` | `{'message': 'The associated workflow is successfully triggered'}` — fires async, ignores `enabled` |
| `set_enabled`/`disable`/`enable` | Full-record PUT (no PATCH); flips `enabled` |
| `delete(name)` | Resolves name→fresh id, then DELETE; `get` returns `None` after |
| `get_or_create(update_if_exists=True)` | Idempotent upsert with cron/wf_iri replacement |

### 1.6 Connector + configs present

`connector-fsr-soc-assistant` is installed. The runner playbook's `Connectors`
step needs a config ID — two exist (`fsrpb-anthropic`, `fsrpb-41mini`). The
widget already resolves this via `fsrPbAgent.service.js` from the connector
config the chat surface uses; the schedule panel reuses the same config.

### 1.7 Run tracking shape

`playbooks.execution_history()` returns typed run records: `name`, `status`
(`finished`/`failed`/...), `created`, `modified`, `pk`, `@id`
(`/wf/api/workflows/<pk>/`), `error_message`. This is the source for the
panel's "last run / status" column. A schedule row itself also carries
`last_run_at` and `total_run_count` (server-maintained).

## 2. Architecture

```
fortiaiAgenticAssistant widget
  └─ new "Scheduled Tasks" panel (view.html, alongside usage/history/tools panels)
       │  fsrPbAgent.service.js → new connector ops
       ▼
connector-fsr-soc-assistant  (reuses sqlite storage + push_playbook + crudhub)
  ├─ create_scheduled_task(name, cron, intent, prompt, enabled, allow_mutating)
  │     1. persist task def → sqlite (existing storage.py pattern)
  │     2. compile thin runner playbook YAML (SetVar prompt/intent → Connectors chat_turn)
  │     3. push_playbook → wf_iri
  │     4. schedules.create(name="agent-sched:<slug>", wf_iri, cron) via /api/wf/
  ├─ list_scheduled_tasks   → join sqlite defs with schedules.list() (last_run_at, enabled, runs)
  ├─ update_scheduled_task  → recompile + schedules.get_or_create(update_if_exists=True)
  ├─ delete_scheduled_task  → schedules.delete + playbook delete + sqlite row delete
  └─ run_scheduled_task_now → schedules.trigger_now(name=)   [the "Run now" button]

celerybeatd fires on cron
  → runner playbook (cybersponse.abstract_trigger / type: start)
     1. SetVariable: session_id = "sched:<slug>:<fire_ts>"
     2. Connectors → fsr-soc-assistant.chat_turn(intent, messages=[{user, prompt}])
     3. Branch on stop_reason:
          completed  → store transcript + verdict → Scheduled Agent Run (results)
          HITL gate  → park session + send notification; analyst resumes from chat History
     4. (optional) update task def last_run/last_status
```

### Why this shape

- **Playbook IS the task** (forced by §1.2): each task generates one runner
  playbook. The schedule row's `wf_iri` points at it. Edit = regenerate
  playbook + `get_or_create(update_if_exists=True)`; delete = `delete`
  schedule + delete playbook + delete sqlite row.
- **Native FSR scheduling** (§1.1): we do not reinvent a scheduler. celerybeat
  handles cron, HA, failover, `exit_if_running` overlap guard. The widget just
  writes rows.
- **Prompt lives where the user manages it** (the crux of the ask): the
  task def (name, cron, intent, prompt, allow_mutating) is a sqlite row the
  panel reads/writes. The schedule row is plumbing; the prompt is data.
- **One connector, two surfaces**: the runner playbook calls `chat_turn` —
  the same op the chat widget uses. No new agent entrypoint.

## 3. The UX — "Scheduled Tasks" panel

A new panel inside the widget, alongside the existing `usage-panel`,
`history-panel`, `tools-panel` (`view.html:1889,2006,2105`). Each row is a
scheduled task. The fields the analyst actually cares about are
front-and-center; cron is presented with a human-readable preview.

### Task list

| Column | Source | Notes |
|---|---|---|
| Name | sqlite def | e.g. "Weekly escalated-alert sweep" |
| Schedule | cron + human preview | "Every Monday 09:00" — the intuitive bit |
| What the agent does | `prompt` (truncated) | the mapping the user asked for |
| Intent | `triage`/`build` | `triage` default (read-only, safe) |
| Last run / status | `schedules.list().last_run_at` + `execution_history` | "2026-07-27 22:31 · finished" |
| Enabled | `schedules.list().enabled` | toggle |
| Scheduler healthy? | derived | surface if `celerybeatd` not running (§5) |

### Task editor (create / edit)

- **Name** (text)
- **Schedule**: cron string **+ live human-readable preview** ("Every Monday
  09:00"). A small cron helper (every-N-minutes / hourly / daily / weekly
  presets + advanced raw cron) so users don't read raw cron.
- **What the agent does**: the `prompt` textarea. This is the mapping. e.g.
  "Review alerts escalated in the last 7 days; flag any with IOC overlap to
  existing incidents."
- **Intent**: `triage` (default) / `build`. Scheduled tasks are almost always
  `triage` (read-only tool slice, gates unlikely). `build` offered but warned.
- **Allow mutating actions**: off by default. If on, a headless run may
  auto-approve an action card; if off (default), a gate parks the session +
  notifies.
- **Run now** button: `schedules.trigger_now(name=)` — fires immediately,
  bypassing cron, for testing.

### History drawer (per task)

Clicking a task opens a drawer showing **run history**: each fire's
transcript + verdict (from the results store). A "Resume" action on a parked
(HITL-gated) run hands the session to the existing chat History panel so the
analyst continues the conversation interactively.

## 4. Connector ops to add (`operations.py`)

All reuse the existing crudhub transport (`_live_crudhub._make_request()`)
and sqlite storage (`storage.default_storage()`). Wire contract additions
go in `fortisoar-widget-harness/FSR_PLAYBOOK_BUILDER_CONNECTOR_CONTRACT.md`.

| Op | Params | Returns | Notes |
|----|--------|---------|-------|
| `create_scheduled_task` | `name, cron, intent, prompt, enabled=true, allow_mutating=false` | `{task_id, schedule_name, wf_iri}` | persist def → compile runner → push → schedules.create |
| `list_scheduled_tasks` | (none) | `[{name, cron, intent, prompt, enabled, last_run_at, total_run_count, last_status}]` | join sqlite defs with `schedules.list()` |
| `get_scheduled_task` | `name` | task def + live schedule state | |
| `update_scheduled_task` | `name, cron?, intent?, prompt?, enabled?` | updated | recompile + `get_or_create(update_if_exists=True)` |
| `delete_scheduled_task` | `name` | `{deleted}` | schedules.delete + playbook delete + sqlite delete |
| `run_scheduled_task_now` | `name` | trigger ack | `schedules.trigger_now(name=)` |

### Runner playbook (generated per task)

Minimal YAML compiled by the existing `compile_yaml` path:

```yaml
# type: start  (cybersponse.abstract_trigger — what the scheduler fires)
steps:
  - set: session_id = "sched:<slug>:{{ run_id }}"
  - connectors:
      connector: fsr-soc-assistant
      operation: chat_turn
      session_id: "{{ session_id }}"
      intent: "<intent>"          # triage | build
      messages: [{role: user, content: "<prompt>"}]
  # branch on stop_reason in a follow-up step or via the connector result
```

The prompt/intent are baked into the playbook (SetVariable for readability +
so a playbook-editor viewer can see what it does). `push_playbook` creates
it; `update_scheduled_task` recompiles + re-pushes (or updates in place once
`update_playbook` lands — ROADMAP §3 item 4).

### Off-platform contract

Like the existing platform-side ops, when `crudhub` is unavailable these return
a `crudhub_unavailable` envelope so the contract still type-checks in dev.

## 5. State persistence + gotchas

- **Task defs in sqlite** (not derivable from `schedules.list()` — the
  schedule row has no prompt slot). `storage.py` gains a `scheduled_tasks`
  table: `{name PK, cron, intent, prompt, allow_mutating, wf_iri, created,
  updated}`. `list_scheduled_tasks` left-joins this with `schedules.list()`
  keyed by `name` (the stable lookup key per §1.3).
- **Scheduler health**: if `celerybeatd` is stopped, schedules silently stop
  firing (§1.1). The panel surfaces this — a cheap signal is whether
  `total_run_count` / `last_run_at` are advancing for any enabled task, or a
  direct check of the beat service. (Exact probe TBD; a dead beat is the #1
  "why isn't my task running" footgun.)
- **`exit_if_running=True` default**: long agent turns (minutes) can overlap
  a cron fire. `exit_if_running` (skip if the prior run is still active) is
  the platform's built-in guard — keep it on by default.
- **Connector identity has ONE source** (repo `CLAUDE.md`): the runner
  playbook references `fsr-soc-assistant` by the name in
  `fsrPbAgent.service.js`; never hardcode a second copy.
- **Long turns**: `chat_turn` can take minutes (LLM + tool calls). The
  runner playbook step must account for this — either blocking with a
  generous step timeout, or use the detached/streaming `chat_poll` contract
  (2.5.0+) so the playbook isn't holding a worker for the whole turn. For v1
  blocking is simpler; streaming is a v2.

## 6. HITL policy for headless runs

- **Default tasks to `triage`** (read-only tool slice — gates unlikely).
- If a gate **does** fire under cron:
  - **Default (`allow_mutating=false`)**: park the session (it's already
    persisted in `suspended_sessions` via the existing `chat_turn` HITL
    path) + send a FortiSOAR notification (rules engine). The analyst resumes
    from the widget's existing chat History panel (`reopenConversation`).
  - **`allow_mutating=true`**: auto-approve the gate and continue. Off by
    default; the panel warns when toggled on.
- This reuses the connector's existing `ApprovalRequestEvent` +
  `suspended_sessions` (HMAC-bound) machinery — no new HITL path.

## 7. Open decisions

1. **Stateless one-shot vs continuation sessions** — recommend **stateless**
   for v1: each cron fire = fresh `session_id` (`sched:<slug>:<fire_ts>`),
   one `chat_turn`, done. Simpler, no accumulating context across runs.
   Continuation (same `session_id` appended each fire → "ongoing
   investigation") is a v2.
2. **Results module** — a separate `Scheduled Agent Run` module (one row per
   fire: transcript + verdict + stop_reason) gives clean audit + reporting
   without bloating the task def. Recommend building it. Alternative: store
   runs in sqlite only (simpler, but not dashboard-queryable).
3. **Runner playbook: blocking vs streaming** — v1 blocking (simpler); v2
   streaming via `chat_poll` so the playbook releases the worker during the
   LLM turn.
4. **`update_playbook` dependency** — `update_scheduled_task` currently
   recompiles + re-pushes (create-new + delete-old) since `push_playbook` is
   create-only (ROADMAP §3 item 4). Once `update_playbook` (modify-in-place)
   lands, `update_scheduled_task` should use it to preserve the wf_iri so
   the schedule row doesn't need resyncing.

## 8. Phased build order

1. **Connector ops** (`operations.py` + `storage.py`): `create_/list_/get_/
   update_/delete_/run_scheduled_task_now`. Reuse `push_playbook` +
   crudhub `/api/wf/api/scheduled/`. Unit tests stub `crudhub`.
2. **Runner playbook compiler**: thin YAML generator (SetVar + Connectors
   step) via the existing `compile_yaml` path. Verify a generated playbook
   imports + runs on a live box.
3. **Widget panel** (`view.html` + `view.controller.js`): Scheduled Tasks
   panel with list, editor (cron + human preview), run-now, enable toggle.
   Add `fsrPbAgent.service.js` wrappers for the new ops.
4. **History drawer**: per-task run transcripts + verdicts; "Resume" handoff
   to the chat History panel for parked HITL sessions.
5. **Scheduler-health indicator** + the `celerybeatd`-down footgun surfacing.
6. **Results module** (if decision §7.2 = separate module): `Scheduled Agent
   Run` module + runner playbook write-back step.
7. **Tests** via the repo Makefile flow: hermetic mock e2e for the panel
   (`FSR_HERMETIC=1`); a live-sweep that creates a task with a 1-min cron and
   confirms a run lands (`make test-live-sweep`). Connector identity via
   `tests/live/lib/connectorIdentity.js` (single source).

## 9. What is explicitly out of scope for v1

- A reinvented scheduler (we use celerybeat).
- Continuation sessions across fires (v2).
- Streaming runner (v2).
- Cross-instance schedule sync.
- A standalone management widget / custom module on the module list (the
  panel inside the SOC Assistant is the home).
