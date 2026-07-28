---
title: SOC Assistant Monitor Widget
category: plans
status: done-v1
source: hand-written
topics:
  - feature-design
  - monitoring
  - audit
  - usage-telemetry
  - dashboard
  - llm-activity-log
summary: Design for a separate dashboard-style widget monitoring the SOC
  Assistant agent: usage/tokens/cost over time, pending tasks, user activity,
  and an audit trail. Includes findings on how FortiSOAR 8.0's llm_activity_log
  is written and the connector's existing per-turn telemetry. V1 shipped and
  live-verified; v2 follow-ups track richer audit trail, interactive sessions,
  and per-tool-call drill-down.
---

# SOC Assistant Monitor — design plan

A separate dashboard widget for monitoring the SOC Assistant agent: usage /
tokens / cost over time, pending (HITL-parked) tasks, per-user activity, and an
auditable LLM call trail. Companion to the scheduled-tasks feature
(`docs/plans/scheduled-agent-tasks.md`) and the existing
`fortiaiAgenticAssistant` chat widget.

## 1. Findings — audit/telemetry stores (live-verified on 8.0.0)

There are **two** distinct `llm_activity_log` stores on FortiSOAR 8.0. The
distinction is the crux of the path-into-the-log decision.

### 1.1 `llm_activity_log` — fsr-ai's internal sealab-DB table (NOT our target)

- `/opt/fsr-ai/database/schema.py:92` — `LLMActivityLogs(Base, Auditable)`,
  in fsr-ai's own `ai_metadata` Postgres DB (`setting.py:15`).
- Written only by fsr-ai's own LLM client: `provider.prepare_log_data()` →
  `LLMClient.persist_log()` (`/opt/fsr-ai/llm/base.py:57`) →
  `LLMLoggingService.add_log_entry()` → direct Postgres insert.
- **No HTTP read route**: the FastAPI router that would expose it is
  commented out in `/opt/fsr-ai/main.py:34`. `GET /api/3/lLMActivityLog` 404s.
- The SOC Assistant connector uses its **own** LLM wiring
  (`fsr_playbooks.llm`), so its calls never land here. Crossing into this
  table requires either an fsr-ai code change (new POST endpoint) or a direct
  DB connection the connector doesn't have. **Out of scope.**

### 1.2 `llm_activity_logs` — the platform `/api/3/` module (OUR target)

This is the native platform-wide audit module (entity
`App\Entity\Ai\LLMActivityLog`, the one STATUS.md session-B flagged). It is a
**standard `/api/3` CRUD route** — hydra envelope, `@id`, `@type`,
`createUser`/`createDate`, the works — NOT the sealab-DB table.

**Live-verified on .206 (8.0.0):**
- `GET /api/3/llm_activity_logs` → 102 rows, standard hydra collection.
- Schema (camelCase, `/api/3` convention): `@id`, `@type`, `title`,
  `correlationID`, `provider`, `modelName`, `prompt`, `response`,
  `inputTokens`, `outputTokens`, `totalTokens`, `costUSD`, `latencyMs`,
  `status`, `error`, `uuid`, `createUser`, `createDate`, `recordTags`.
- Records show FortiAI's own tool-using agents writing here (e.g. a
  `query_records` tool call with full prompt + response + token counts).
- **The crudhub service account can WRITE it**: `POST /api/3/llm_activity_logs`
  with `{title, provider, modelName, prompt, response, inputTokens,
  outputTokens, totalTokens, costUSD, latencyMs, status, correlationID}`
  returns the created hydra record (`@type: LLMActivityLog`); `DELETE
  /api/3/llm_activity_logs/<uuid>` removes it. Proven end-to-end on .206.

This is the better path: a real platform module, writable through the same
crudhub transport the connector already uses for `/api/3` CRUD, queryable
through the standard module API (so the monitor widget can read it without a
new connector op), and the audit home FortiAI itself uses.

### 1.3 Transport — `/api/3/` works via crudhub (verified)

crudhub `make_request` is a service-token loopback to `https://localhost`
that nginx routes to PHP for `/api/3/`. The connector already uses this for
its platform-side ops (`push_playbook`, `dry_run_playbook`, `render_jinja`,
all `/api/3/workflows/*`). Writing to `/api/3/llm_activity_logs` is the same
pattern — zero new transport. (Note: the `/api/ai/*` routes that hit fsr-ai
directly are gated by PHP RBAC and 403 most crudhub service-account calls;
`/api/3/` has no such gate for module CRUD. See the probe log in §7.)

### 1.4 The connector ALREADY has richer per-turn telemetry

The framework (`fsr_playbooks/llm/usage_log.py`) writes a JSONL line per LLM
round-trip with a **richer** schema than `llm_activity_logs:

```json
{
  "ts": "2026-05-03T20:11:42.318Z",
  "session": "8f3e…",
  "turn": 1,
  "model": "claude-sonnet-4-5-…",
  "input_tokens": 1234,
  "output_tokens": 256,
  "cache_read": 6800,
  "cache_write": 0,
  "stop_reason": "tool_use",
  "self_repair_turn": 0,
  "history_chars": 14280,
  "history_est_tokens": 3570,
  "tool_calls": [{"name": "validate_yaml", "result_chars": 4096, ...}],
  "tags": {"playbook_collection": "..."}    # ← attribution key
}
```

The connector's `_usage_cost_usd()` (`operations.py:1279`) computes USD cost
from tokens with **correct** cached-token semantics per provider (OpenAI nests
cached inside `prompt_tokens`; Anthropic reports them disjoint — the function
handles both). Per-model pricing tables at `operations.py:1194+` cover
OpenAI, GPT-5 family, Anthropic, with input/output/cached rates.

So the data needed for usage/tokens/cost graphs **already exists** per turn —
it just lands in a file, not a queryable store. The plan: persist it to the
native `/api/3/llm_activity_logs` module (the audit source of truth) AND to a
connector sqlite `agent_usage` table (for the richer tool-call/cache/tags
fields the platform module doesn't have).

## 2. Architecture

```
NEW WIDGET: socAssistantMonitor (standalone dashboard)
  ├─ view.controller.js  → fsrPbAgent.service.js → connector ops
  ├─ view.html           → chart panels (c3charts pattern) + tables
  └─ info.json           → standalone:true, contexts:[dashboard]
       │
       ▼
connector-fsr-soc-assistant (new monitoring ops)
  ├─ list_usage        → sqlite agent_usage table (ts, session, user, model, tokens, cost, intent, tags)
  ├─ list_sessions     → existing storage.py session history + suspended (HITL-parked)
  ├─ list_scheduled_tasks → from scheduled-agent-tasks plan
  ├─ list_pending      → suspended_sessions (HITL gates awaiting analyst)
  ├─ get_audit_trail   → per-LLM-call records (prompt/response/tokens/cost/status) for audit
  └─ get_usage_summary → aggregated buckets (per hour/day, per user, per model)

DATA FLOW (existing — no new telemetry to build):
  chat_turn (every LLM round-trip)
    └─ UsageEvent (provider.py:109)  ← input/output/cache tokens + tags
         └─ usage_log.log_turn()       ← already writes JSONL today
         └─ NEW: also persist to sqlite agent_usage table (same data, queryable)
```

### Data source: dual-write to `/api/3/llm_activity_logs` + sqlite

Two stores, one write per turn:

1. **`/api/3/llm_activity_logs`** (the native platform module, §1.2) — the
   audit source of truth. Written via crudhub `POST /api/3/llm_activity_logs`
   alongside the existing JSONL write, using the same transport the
   connector already uses for `/api/3/workflows/*`. Carries the fields the
   module supports: `title, provider, modelName, prompt, response,
   inputTokens, outputTokens, totalTokens, costUSD, latencyMs, status,
   correlationID`. This is what makes the connector's calls visible in
   FortiAI's native audit view + queryable by any `/api/3` client (including
   the monitor widget, without a connector op).
2. **Connector sqlite `agent_usage`** — the richer fields the platform module
   lacks: `tool_calls`, `cache_read`, `cache_write`, `tags`, `session_id`,
   `intent`, `user_iri`. Powers the monitor widget's per-session/per-user
   drill-downs that the platform module can't express.

The platform write is best-effort (telemetry never breaks chat); the sqlite
write is the fallback record. The monitor widget reads `/api/3/llm_activity_logs`
via the standard module API for the audit trail + totals, and the connector
ops for the drill-down detail.

### Why a separate widget (not a panel in the chat widget)

The user explicitly asked for a separate widget. It also fits the
architecture: a dashboard widget is `standalone:true`, mounts on a dashboard
context, and renders charts/tables — a different lifecycle + template pattern
than the drawer-mounted chat widget. The existing `datavisualization` and
`counter` widgets are the pattern templates.

## 3. The dashboard — panels

### 3.1 Usage over time (line chart)

- X-axis: time (hour/day, configurable bucket).
- Y-axis: turn count / token count / USD cost — toggle.
- Series: per-model or per-intent (`triage`/`build`).
- Data: `get_usage_summary(bucket=hour, metric=tokens|cost|turns, group_by=model|intent)`.

### 3.2 Tokens over time (stacked area)

- Input vs output vs cache-read tokens stacked, per day.
- Cache-read is the prompt-cache hit — surface it so users see caching value.

### 3.3 Cost over time (line chart)

- USD per day, cumulative option.
- Per-model breakdown.
- Uses the connector's existing `_usage_cost_usd()` (already correct).

### 3.4 Pending tasks (table)

- HITL-parked sessions from `suspended_sessions` (existing storage).
- Columns: session ID, parked-at, intent, the action card summary, parked-by
  user, age ("waiting 2h 14m").
- "Resume" action → deep-link to the chat widget with that session
  (`reopenConversation`).

### 3.5 Scheduled tasks status (table)

- From `list_scheduled_tasks` (scheduled-agent-tasks plan).
- Columns: name, next fire (cron preview), last run, last status, enabled.
- Scheduler-health indicator (celerybeatd running?).

### 3.6 User activity (table + bar chart)

- Per-user: turn count, token total, cost total, last-active, intent split.
- Data: `agent_usage` has `author` (the connector already records the acting
  user per turn — `operations.py:3532` `_actor`).
- Bar chart: top users by cost or turn count.

### 3.7 Audit trail (searchable table)

- One row per LLM call: timestamp, user, session, model, intent, prompt
  (truncated, expandable), response (truncated), tokens, cost, latency,
  status, error.
- Filter by user / session / model / status / time range.
- This is the "auditable capabilities" requirement — a full per-call record,
  queryable, exportable.
- Data: `get_audit_trail(filters)` from sqlite `agent_usage` (the prompt +
  response are already in the JSONL + transcript; persist them to sqlite).

## 4. Connector ops to add (`operations.py`)

All read from the new `agent_usage` sqlite table (populated by the existing
per-turn telemetry path) + existing `storage.py`. The audit trail + totals
also read the native `/api/3/llm_activity_logs` module via the standard
module API (the monitor widget can read it directly, no connector op needed).

### Write path (per LLM turn, alongside the existing JSONL write)

`_log_llm_activity(record)` — one helper called from the existing per-turn
telemetry call site. Two writes, both best-effort (telemetry never breaks
chat):

1. `POST /api/3/llm_activity_logs` via crudhub with the platform-module field
   set (camelCase): `title, provider, modelName, prompt, response,
   inputTokens, outputTokens, totalTokens, costUSD, latencyMs, status,
   correlationID`. `costUSD` from the existing `_usage_cost_usd()`.
2. sqlite `agent_usage` insert with the richer fields (tool_calls,
   cache_read, cache_write, tags, session_id, intent, user_iri).

### Read ops

| Op | Params | Returns |
|----|--------|---------|
| `list_usage` | `from?, to?, user?, model?, intent?, limit` | `[{ts, session, user, model, intent, input_tokens, output_tokens, cache_read, cost_usd, stop_reason, tool_calls, tags}]` (sqlite) |
| `get_usage_summary` | `bucket=hour\|day, metric=tokens\|cost\|turns, group_by=model\|intent\|user, from?, to?` | `[{bucket, group, value}]` (sqlite) |
| `list_pending` | (none) | `[{session_id, parked_at, intent, action_summary, user, age_seconds}]` (storage) |
| `get_audit_trail` | `from?, to?, user?, session_id?, model?, status?, limit` | `[{ts, session_id, user, model, intent, prompt, response, input_tokens, output_tokens, cost_usd, latency_ms, status, error}]` (sqlite join, or proxy `/api/3/llm_activity_logs` reads) |
| `list_sessions` | `user?, limit` | existing — extend with usage rollup |

### sqlite `agent_usage` table

```sql
CREATE TABLE agent_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,           -- ISO 8601
  session_id TEXT NOT NULL,
  user_iri TEXT,               -- /api/3/people/<uuid>, nullable
  user_name TEXT,              -- resolved display name, nullable
  intent TEXT,                 -- triage | build
  model TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cache_read INTEGER,
  cache_write INTEGER,
  cost_usd REAL,
  latency_ms REAL,
  stop_reason TEXT,
  status TEXT,                 -- success | error
  error TEXT,
  tool_calls TEXT,             -- JSON array
  tags TEXT,                   -- JSON object (attribution)
  prompt TEXT,                 -- full prompt (for audit)
  response TEXT,               -- full response (for audit)
  turn INTEGER
);
CREATE INDEX idx_usage_ts ON agent_usage(ts);
CREATE INDEX idx_usage_session ON agent_usage(session_id);
CREATE INDEX idx_usage_user ON agent_usage(user_iri);
```

Populated by a one-line addition to the existing per-turn telemetry path
(the same place `usage_log.log_turn()` is called today) — same data, second
write target. Failures swallowed (telemetry never breaks chat).

## 5. Widget structure

```
widgets-src/socAssistantMonitor/
  ├── widget/
  │   ├── info.json          ← standalone:true, contexts:[dashboard]
  │   ├── view.controller.js ← chart data fetching, table rendering
  │   ├── view.html          ← c3charts panels + tables (mirror datavisualization)
  │   ├── edit.controller.js ← config: time range default, refresh interval
  │   ├── edit.html
  │   └── widgetAssets/
  │       └── js/
  │           └── fsrMonitorAgent.service.js ← wraps the new connector ops
  ├── tests/
  └── docs/
```

- `info.json`: `standalone: true`, `contexts: ["dashboard"]` (or a custom
  landing context). Mirror `counter`/`datavisualization` info.json shape.
- Charts: reuse the `c3charts` widget's library (c3/d3) already in the
  harness. Line/area/bar from the existing `datavisualization` patterns.
- Edit mode: pick time range (last 24h / 7d / 30d / custom), refresh interval
  (30s / 1m / 5m), which panels to show.
- The widget calls the connector via `fsrPbAgent.service.js`'s
  `executeAction` pattern (same as the chat widget) — the connector config
  is the same `fsr-soc-assistant` instance.

## 6. Relationship to the scheduled-tasks plan

- The monitor widget's "Scheduled tasks status" panel (§3.5) reads the
  `list_scheduled_tasks` op from the scheduled-agent-tasks plan. Build the
  connector ops first; the monitor widget consumes them.
- The "Pending tasks" panel (§3.4) shows HITL-parked sessions — these include
  sessions parked by scheduled tasks (§6 of the scheduled-tasks plan: "park +
  notify"). So the monitor widget is the natural place to see and resume
  them, not just the chat widget's History panel.

## 7. Audit capability — the path into the log (live-probed)

The user asked for "auditable capabilities" + a way to write to
`llm_activity_log`. Probing on .159 + .206 settled the answer.

### 7.1 The two stores (don't confuse them)

| | `llm_activity_log` (sealab DB) | `llm_activity_logs` (DAS `/api/3`) |
|---|---|---|
| Owner | fsr-ai (`/opt/fsr-ai/`) | PHP platform (`App\Entity\Ai\LLMActivityLog`) |
| DB | `ai_metadata` Postgres | DAS DB (standard module table) |
| Route | **none** (router commented out, `main.py:34`) | `GET/POST/DELETE /api/3/llm_activity_logs` ✓ |
| Writer | fsr-ai's `LLMClient` only | any `/api/3` client (incl. crudhub) |
| Rows | n/a on .159 | 0 on .159, **102 on .206** |

`llm_activity_logs` (plural, `/api/3`) is the platform-wide audit module;
`llm_activity_log` (singular, sealab) is fsr-ai's internal duplicate with no
API. **We target the plural `/api/3` route.**

### 7.2 Probe results (.159 + .206, 8.0.0)

- `GET /api/3/llm_activity_logs` → standard hydra collection (102 rows on
  .206, 0 on .159). Records are FortiAI's own tool-call audits (prompt +
  response + tokens + cost + latency).
- `POST /api/3/llm_activity_logs` with the minimal field set → creates a
  `@type: LLMActivityLog` record, returns the new `@id`. **Proven via the
  admin API on .206.** The crudhub service account uses the same `/api/3`
  transport (verified: the connector's `push_playbook`/`render_jinja` already
  POST to `/api/3/workflows/*` and `/api/wf/api/jinja-editor/` via the same
  shim), so the write works from the connector without new transport.
- `DELETE /api/3/llm_activity_logs/<uuid>` → removes it. (Test record
  created + deleted cleanly during the probe.)

### 7.3 Transport paths probed (why `/api/3/` wins)

| Path | Result | Why |
|------|--------|-----|
| **`/api/3/llm_activity_logs`** (crudhub) | **works** (POST/GET/DELETE) | Standard module CRUD, same transport as `push_playbook`. No RBAC gate on module writes. |
| `/api/ai/*` (crudhub → PHP → fsr-ai) | `/api/ai/llm/config` works; most routes → **403 `AccessDeniedException`** | PHP blanket-proxies `/api/ai/*` to fsr-ai but applies per-route RBAC. Service account lacks most roles. |
| `/ai/*` direct to fsr-ai:8001 (crudhub) | **403 Forbidden** | HMAC key mismatch: fsr-ai uses `/opt/fsr-ai/keys/fsraiprivate.key`, crudhub uses `/opt/cyops/certs/tmp/integrationsprivate.key`. |
| Direct DB write to sealab | not possible | Connector has crudhub HTTP only, no `ai_metadata` connection. |
| Route connector through fsr-ai's `LLMClient` | don't | Breaks tool-calling fidelity (framework streaming `Event` vs fsr-ai non-streaming `LLMResponse`). |

The `/api/3/` path wins on every axis: works today, no fsr-ai code change, no
PHP RBAC role grant, no second repo, same transport the connector already
uses. The only cost is mapping the connector's snake_case telemetry to the
module's camelCase fields (`inputTokens` etc.).

### 7.4 Recommendation (flipped from the earlier draft)

**Write to `/api/3/llm_activity_logs` as the primary audit path** — it's the
platform's audit home, visible in FortiAI's native view, queryable by any
`/api/3` client (including the monitor widget's standard module reads), and
reachable through the connector's existing crudhub transport. The connector
adds one `POST` per LLM turn alongside the existing JSONL write.

The connector sqlite `agent_usage` table stays as the **secondary** store for
the richer fields the platform module lacks (tool calls, cache stats, tags,
session_id, intent, user) — powering the monitor widget's drill-downs.

What's NOT viable (ruled out by the probes): writing to fsr-ai's
`llm_activity_log` sealab table (no route, no DB access), routing the
connector's LLM calls through fsr-ai's `LLMClient` (breaks fidelity), or
hitting `/api/ai/*` (PHP RBAC 403s the service account on most routes).

## 8. Phased build order

1. **Connector: dual-write path** — `_log_llm_activity(record)` helper at
   the existing per-turn telemetry call site. Two best-effort writes: `POST
   /api/3/llm_activity_logs` (camelCase field map) via crudhub + sqlite
   `agent_usage` insert. Reuse `_usage_cost_usd()` for `costUSD`. Unit tests
   stub crudhub (the `/api/3/` POST is the new surface).
2. **Connector: monitoring ops** — `list_usage`, `get_usage_summary`,
   `list_pending`, `get_audit_trail`, `list_sessions` (extend). Unit tests
   stub crudhub.
3. **Widget: skeleton** — `socAssistantMonitor`, standalone, dashboard
   context. Edit config (time range, refresh). Mirror `counter`/`datavisualization`.
4. **Widget: charts** — usage/tokens/cost over time (c3charts). Data from
   `get_usage_summary` (sqlite) + `/api/3/llm_activity_logs` reads (platform).
5. **Widget: tables** — pending tasks, scheduled tasks status, user
   activity, audit trail. The audit trail reads `/api/3/llm_activity_logs`
   directly via the standard module API (FormEntityService) for the
   platform-wide view, joined with sqlite for tool-call/session drill-down.
   Filter + export.
6. **Tests** — hermetic mock e2e (`FSR_HERMETIC=1`); live-sweep that runs a
   chat turn and confirms it lands in BOTH `/api/3/llm_activity_logs` and
   sqlite `agent_usage`. Makefile flow
   (`make ship-verify WIDGET=socAssistantMonitor`).

## 9. Out of scope for v1

- Writing to fsr-ai's sealab `llm_activity_log` table (no route, no DB
  access — ruled out by probe, §7.3). The `/api/3/llm_activity_logs` module
  is the audit source.
- Real-time streaming updates (use polling refresh interval for v1).
- Alerting / thresholds ("notify when cost exceeds $X").
- Cross-instance aggregation.

## 10. v2 follow-ups (from session G live review)

> **Phase 2 — Live Sessions: IMPLEMENTED (code-side, pending live-verify).**
> `list_active_sessions` op + `chat_sessions` table + a "Sessions" tab in the
> widget. Status is **derived at read time** from `turn_progress` (in-flight)
> + `suspended_sessions` (HITL-parked) — never a stored column, so it can't
> drift. The platform `/api/3/llm_activity_logs` module is **not** involved
> (per user direction: the live-sessions panel reads only the connector's own
> session stores). Phases 1/3/4 remain open.

### 10.1 Richer audit trail — per-tool-call detail

Today the audit trail shows one row per LLM turn: timestamps, token counts, cost,
status. It does **not** show:
- **What tools the agent called** (tool name, params, success/failure, output)
- **What the agent actually did** — the narrative reasoning, containment decisions,
  playbook authoring steps, record mutations
- Prompt/response full text (currently stored in sqlite but not surfaced in the
  monitor UI)
- Per-tool-call cost attribution (which tool call drove the expensive turn)

**Fix**: Extend `agent_usage` schema with per-tool-call rows (not the current
aggregate JSON blob). New `agent_tool_calls` table: `(id, usage_id, turn,
tool_call_index, tool_name, params_json, result_status, result_summary,
input_tokens, output_tokens, cost_usd, latency_ms)`. The agent's `tool_use`
frames in the LLM transcript already carry `name`, `input`, `output`, and per-call
token accounting — wire them through `_log_llm_activity()`. Widget audit trail
gains expandable rows that show the tool call chain with params, status badges,
and inline cost/latency.

### 10.2 Active agentic sessions widget

The monitor is static — KPIs and historical tables only. No visibility into
what's **running right now**. The user wants to see:
- Currently active agentic chat sessions (which users have open turns, what
  prompts they're running)
- In-flight tool calls (agent is mid-loop, not yet done)
- Session state: `streaming` / `waiting_approval` / `idle` / `suspended`

**Fix**: Add a "Live Sessions" panel that reads from `storage.py`'s
`suspended_sessions` (for parked HITL) + adds a `chat_sessions` table that
tracks active sessions: `(session_id, user, record_uuid, current_prompt,
status, turn_count, started_at, last_activity)`. Status values: `active`
(LLM streaming), `waiting_approval` (HITL gate), `suspended` (HITL parked,
already in `suspended_sessions`), `idle` (completed, recent). Widget shows
a real-time table with status pips, last-activity countdown, and "View in
chat" deep-link. Connector op: `list_active_sessions`.

**Implemented (Phase 2):**

- **`chat_sessions` table** (`storage.py`) — descriptive metadata only:
  `session_id (PK), record_uuid, record_module, current_prompt, started_at,
  updated_at`. UPSERTed at one hook — the top of `chat_turn` (after
  `reserve_next_turn` + the entity is parsed). `started_at` is first-writer-
  wins; the record/prompt/`updated_at` are last-writer-wins. No `status` column
  by design.
- **`list_active_sessions(limit)`** (`storage.py` + op) — derives status at
  read time:
  - `active` — the session's highest `turn_progress` turn has no terminal
    frame (a turn is streaming right now).
  - `waiting_approval` — the session is in `suspended_sessions` (parked at a
    HITL gate). Wins over `active`.
  - `idle` — otherwise.
  `last_activity`/`turn_count` come from the `turn_progress` watermark (so
  resume turns, which write frames but skip the `chat_turn` hook, stay fresh);
  the acting user is JOINed from `session_initiator`. The platform
  `/api/3/llm_activity_logs` module is **not** read — this panel is connector-
  store-only (per user direction).
- **Widget** — a "Sessions" tab between Overview and Pending; a table with a
  status pip (active = pulsing teal, waiting = amber, idle = faint), the
  session id, user, mounted-record module, the latest prompt (truncated),
  turn count, a relative last-activity ("2m ago"), and a best-effort "Open in
  chat" action. "Open in chat" navigates to the session's mounted record
  (where the chat drawer mounts) via `$state.go` + `appModulesService`, and
  broadcasts an `fsrSocAssistant:openSession` event as the forward seam for a
  future chat-widget listener; sessions with no mounted record are honestly
  disabled (the chat widget is drawer-mounted on a record, so a dashboard-
  originated session can't be reopened from here yet).
- **Tests** — `tests/test_active_sessions.py` (9 cases: status derivation
  across idle/active/waiting, waiting-wins-over-active, ordering, first-
  writer-wins `started_at`, user/record/turn-count surface, limit, empty);
  widget `view.controller.test.js` gains 6 cases (tab load, status class,
  relative age, `canOpenInChat`, the openSession broadcast); the e2e smoke
  spec asserts the Sessions tab + empty state render.

### 10.3 Audit deep-dive — agent narrative + tool chain view

Beyond per-row drill-down, the user wants a full **session audit view**:
the complete agent run from prompt → tool calls → approvals → final response,
as a timeline. Currently the connector stores each turn's JSONL but no
queryable per-turn narrative.

**Fix**: New `agent_turns` table: `(id, usage_id, session_id, turn, user_prompt,
agent_thinking, tool_calls_array, final_response, approvals_count, status, ts)`.
Wired at `_log_llm_activity()` from the existing transcript frames. Widget adds
a "Turn Detail" overlay: click any audit row → opens a timeline showing the full
agent execution: user prompt → tool call sequence (with expand params/output) →
approvals → final text. This is the "what did the agent do?" view.

### 10.4 Interactive dashboard — pivots and filters

The current KPI cards are static summaries. Make them into
**click-to-filter** elements: click a model in the per-model chart filters the
audit trail; click a user in the user activity table filters to that user's
sessions. The audit trail and other panels respond to the active filters via
a shared `$scope.activeFilters` state object (time range, user, session, model,
intent, status). Status pill badges become filter chips (click "error" → show
only failed turns; click again to clear).

### 10.5 Real audit logs integration

The monitor currently reads from the connector's sqlite `agent_usage` — not
from the platform's `/api/3/llm_activity_logs` module directly. This means the
monitor only shows the SOC Assistant connector's own calls, not the platform-wide
FortiAI audit trail. **Fix**: For the "Audit Trail" tab, option to switch to
"Platform audit" mode that reads `/api/3/llm_activity_logs` via the standard
module API (FormEntityService), showing all AI agent activity across instances
not just the SOC Assistant connector.
