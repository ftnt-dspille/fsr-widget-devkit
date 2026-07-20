# Agentic-tooling best-practices alignment — plan

**Status:** planning / not started
**Created:** 2026-07-19
**Scope:** `fortiaiAgenticAssistant` widget + `connector-fsr-soc-assistant` + `fsr-playbook-framework`

## Purpose

Capture the gap analysis between our current agentic assistant and 2025–26
standards for embedded agentic/copilot tools, and sequence the work.

**Governing priority (user directive, 2026-07-19):** make the app work at a
basic level *first*. Enhancement pillars like undo/rollback and confidence
scoring are explicitly deferred until the core loop is reliable end-to-end.

---

## Where we already meet the bar (do not re-litigate)

- Streaming with visible `tool_use`/`tool_result` frames (`duration_ms`, live
  preview, tool ticker) — the "show your work" convention.
- Tiered permissions: tier 0–1 auto (read-only) / tier 3 approval gate, plus
  `grant='always'` allowlist (allow-once / allow-always norm).
- HITL cards as first-class UI (approval, action, choice, manual-input,
  playbook-offer, patch-proposal) — richer than most products.
- ReAct loop + guards (`hunt_floor` / `call_once` / `forbidden_pivot`).
- HMAC-sealed durable sessions/cards surviving worker restarts.
- Typed wire contract (`contract.d.ts` 2.8.0) with drift-detection banner.

Reference maps produced during analysis:
- Widget/connector architecture — see `WORKFLOW_MAP.md` + agent map (2026-07-19).
- STATUS.md is the live source of truth for what's open/done.

---

## P0 — Make the app work at a basic level (TOP PRIORITY)

Before any of the pillars below, the core turn/resume loop must be reliable
end-to-end on the box. **Action item:** define "works at a basic level" as a
concrete, testable checklist, then close whatever fails it. Candidate
invariants to nail down (confirm/adjust against real box behavior):

- [ ] A fresh triage turn on a record drawer streams to `end_turn` cleanly 3/3.
- [ ] A build turn (trace → offer → accept → push) completes 3/3.
- [ ] Approval gate (tier 3) pauses, resumes, and executes the op correctly.
- [ ] manual-input mid-playbook pause/resume round-trips.
- [ ] Detached-turn + poll path never orphans a turn (watchdog settles).
- [ ] Contract-version drift degrades gracefully (no hard break).

This section owns whatever "the app doesn't work" turns out to mean in
practice — fill it in from live failures, not speculation.

### P0a — Unify the turn-drive + test tooling (do this FIRST)

We've independently built turn-drive harnesses on **three** paths and they've
drifted. Before we can trust any "does it work" answer, they need one shared
vocabulary. Inventory (box-verified 2026-07-19):

| Repo | Hermetic turn-drive | Live turn-drive | Evaluation logic |
|---|---|---|---|
| **Widget** (`fsr_all_widgets`) | jest + Playwright e2e (`FSR_HERMETIC=1`) | `liveSweep.spec.js` (4 scen.) + `matrix.live.test.js` | `matrixDriver.js` (`digestFrames`/`isErr`/`evaluate`/`gateRow`) — **the only real grader** |
| **Connector** (`connector-fsr-soc-assistant`) | `scripts/local_turn.py` (fake LLM + cassette), `test_local_turn_harness.py` | `scripts/live_integration.py` (12 contract paths) | none (ops return raw) |
| **Framework** (`fsr-playbook-framework`) | `make chat-fast` (offline) | `cli.py chat-drive`, `calibrate_investigation.py` | `tooling/evals/` (score+render) |

**The drift that hurts P0:**
- **3 invocation styles**: Makefile `PARAM=value` (widget) vs CLI `--flag` (connector) vs `SCENARIO=` (framework). No single "drive one turn" command.
- **2 scenario formats**: widget `scenarios.local.json` (box UUIDs, gate, expectedCards) vs framework `examples/*.test.yaml` vs connector CLI args.
- **Grading lives in ONE place** (`matrixDriver.js`, JS) — connector/framework can't reuse it, so "did the turn go wrong" is judged differently (or not at all) per path.
- **No hermetic widget→connector turn**: widget's only real-agentic e2e is box-only (liveSweep); connector's `local_turn` is CLI-only and never driven through the widget harness. So there is no fast, box-free "the whole stack processed a turn" check.

**What's already right (keep):** connector identity has ONE source
(`connectorIdentity.js`, derived from `fsrPbAgent.service.js`) — do not add a
second copy.

**Unification direction (options, not yet chosen):**
1. **Shared scenario schema** in the framework repo (`id`, `intent`, `module`,
   `entity`, `message`, `expectedCards`, `minTools`, `forbidRedFlags`, `gate`,
   `tier`) that all three repos consume — kills the JSON-vs-YAML-vs-CLI split.
2. **Shared verdict vocabulary** (PASS / DEGRADED / FAIL ladder + card/error
   canon) so all three paths grade a turn the same way. ⚠️ Caveat: the grader
   is JS (`matrixDriver.js`) and two consumers are Python — "extract to one
   module" means either a JS↔Python port or a language-neutral CLI that both
   shell out to. Pick the cheaper one; don't hand-port and let them re-drift.
3. **Promote `local_turn()` as the canonical hermetic baseline** — a single
   `make turn-hermetic SCENARIO=<id>` in each repo that drives the real
   `chat_turn()` with fake LLM + cassette and grades with the shared verdict.
   This is the fastest honest "does a turn work" signal (~seconds, no box).

**Recommended P0a sequence:** (1) shared verdict vocabulary + a language-neutral
way to call it → (2) one `turn-hermetic` command per repo speaking it →
(3) shared scenario schema. Keep the existing live/browser tiers as-is; just
make them report against the same verdict. This is scoped as *tooling
consolidation*, not a rewrite of any existing suite.

_Full per-repo file inventory captured in this session's analysis; canonical
docs are widget `TESTING.md`, connector + framework `Makefile`/`CLAUDE.md`._

---

## P1 — Unified audit trail (highest-value best-practice gap)

**Why:** SOC product ⇒ SOC2/FedRAMP expect a complete, exportable record of
every tool invocation: args + result + who approved + authorization decision
+ side effects. We already persist most raw data (`session_trace`,
`session_cards`, `chat_turns`, `suspended_sessions`) but it is triage-scoped
and not consolidated into one audit record.

**Efficiency note (user, 2026-07-19):** may warrant a dedicated **nginx route**
rather than routing audit writes/reads through the normal connector-execute
path — investigate a lightweight ingest/query endpoint so audit volume doesn't
tax the agentic turn path. (Cross-ref streaming-transport roadmap:
`nginx_custom_route_streaming_roadmap` — 8.0 ships `/mcp/` + `/ai/` routes;
an `/audit/` sibling may fit the same pattern.)

**Scope sketch (not committed):**
- Emit one structured audit event per tool dispatch (all tiers, both intents),
  not just run_ops in the triage SkillTrace.
- Fields: tool name, args, result summary, tier, authorization decision +
  approver identity, side effects, session/turn id, timestamp.
- Exportable (extend existing card-export markdown+JSON sidecar).
- Decide transport: connector storage vs dedicated nginx `/audit/` route.

### The persistence problem (user's core concern, box-verified 2026-07-19)

The connector today persists sessions/trace/cards to **local SQLite** on the
box (`turn_progress`, `session_*`, `suspended_sessions`). **That storage is
connector-local and is wiped/reset on connector upgrade** — so any audit data
kept there is lost on every release. Audit must live somewhere the connector
lifecycle does not own.

### ⭐ CHOSEN DESIGN (2026-07-19, box-probed) — direct SQL via the integrations Django connection into the `connectors` DB

Write each audit event with a direct SQL `INSERT` executed through the
integrations service's **existing Django DB connection** (`from django.db import
connection`) into a custom table in the **`connectors` Postgres DB**.

Why this over the alternatives:
- The connector runs **inside the `cyops-integrations` Django process**
  (`/api/integration/execute/` is a Django view; workers run as `nginx`).
  Django already owns a configured, pooled connection to the `connectors` DB
  with the pg driver present (its own migrations prove it).
- **No credential management**: we reuse Django's connection — nothing per-box
  to source. (Local pg auth is `md5`, no peer/trust, so a *fresh* psycopg2
  connection would otherwise force sourcing the per-box device-UUID password,
  which rotates on rebuild. Avoid that.)
- **Durable across connector upgrades**: the `connectors` DB is owned by the
  integrations service, not the connector package. Today's SQLite storage
  (`turn_progress`, `session_*`) is connector-package-local FILE storage → wiped
  on upgrade. A table in `connectors` is not. This is the exact data-loss fix.
- Bootstrap with idempotent `CREATE TABLE IF NOT EXISTS` on first write
  (connectors don't ship Django migrations).

**Accepted trade-off (vs. the custom-module-record approach):** direct SQL
gives up the free RBAC scoping, the FortiSOAR UI audit view, native export, and
the platform auto-auditing the write. That's fine IF the audit consumer queries
the table directly / forwards to syslog/SIEM. If a SOC analyst must *see* the
audit in the FSR UI, revisit the module approach (kept as a fallback below).
The native gateway API cannot help here regardless: `/api/gateway/audit/*` is
query/count/delete/TTL only — **no create-an-audit-entry endpoint** (audit rows
are written internally by Java `AuditLogController` on record ops); a raw INSERT
into `gateway.auditlogs` is a hack (bypasses Java, manual RBAC IRI FK, not
schema-upgrade-safe) — do not do it.

#### Proposed table DDL (`connectors` DB) — draft, not yet created
```sql
CREATE TABLE IF NOT EXISTS agent_audit_log (
    id            BIGSERIAL PRIMARY KEY,
    ts            TIMESTAMPTZ  NOT NULL DEFAULT now(),
    session_id    TEXT         NOT NULL,
    turn_id       TEXT,
    intent        TEXT,                 -- triage | build
    tool_name     TEXT         NOT NULL,
    tool_args     JSONB,                -- redact/cap sensitive values before write
    tier          SMALLINT,             -- 0..3 dispatch tier
    decision      TEXT,                 -- auto | approved | rejected | n/a
    approver      TEXT,                 -- user id/name for tier-3 approvals
    grant_scope   TEXT,                 -- once | always | null
    entity_type   TEXT,
    entity_uuid   TEXT,
    result_status TEXT,                 -- ok | error
    result_digest JSONB,                -- capped summary, NOT the full 40-50KB blob
    duration_ms   INTEGER,
    error         TEXT
);
CREATE INDEX IF NOT EXISTS idx_agent_audit_session ON agent_audit_log (session_id, ts);
CREATE INDEX IF NOT EXISTS idx_agent_audit_ts      ON agent_audit_log (ts DESC);
CREATE INDEX IF NOT EXISTS idx_agent_audit_entity  ON agent_audit_log (entity_uuid);
```
Field list is a starting point — reconcile against what `session_trace`
(SkillTrace) and `suspended_sessions` already capture so we don't duplicate.

#### Write hook (where it goes in the connector) — to be located during impl
- One emit per **tool dispatch**, at the single dispatch chokepoint in the
  framework/connector loop (all tiers, both intents) — not scattered per tool.
  Candidate site: the tier-gate/dispatch layer noted in
  [[agent_mutating_op_approval_gate]] (`run_op`/dispatch), extended to cover
  read-only tiers too.
- For tier-3, emit on **resolution** (approve/reject) so `approver`/`decision`
  are populated, in addition to the request.
- Apply the existing arg preview cap / redaction before writing `tool_args`
  and `result_digest` — ties into P2 (tool-output budgeting): never write the
  raw 40–50KB result.
- Must be **best-effort / non-blocking**: an audit-write failure must never
  fail or stall the agentic turn (wrap, log, continue).

#### Open items before implementing
- Confirm `django.setup()` context is active in the code path we hook (it is for
  `/api/integration/execute/`; verify for any detached/threaded turn worker).
- Verify a custom table in `connectors` survives a **platform** upgrade (not
  just a connector upgrade) — Django migrations for the integrations app operate
  on its own models; an unmanaged table should persist, but confirm.
- Decide retention/rotation (the native audit has TTL; ours needs its own — a
  periodic delete-older-than or a size cap).
- Reconcile with export: the widget already has a card-export markdown+JSON
  sidecar; decide whether audit export reads this table or stays separate.

**Postgres DB map (empirically verified on GA/159, connect as `cyberpgsql`,
password = device UUID from `sudo csadm license --get-device-uuid`):**
Databases present: `sealab` (core platform, 76 tables), `venom` (fsr-ai's OWN
DB, 344 tables), `gateway` (native audit store), `connectors` (Django connector
config DB), `das`, `data_archival`, `notifier`, `postman`. `cyberpgsql` has
CREATE on `sealab`, `connectors`, and `venom`.

Options, best → worst fit:

- **(C) FortiSOAR native audit store — `gateway.auditlogs` (RECOMMENDED).**
  ⚠️ Corrects the earlier "too coarse" note — schema probed 2026-07-19, it is
  NOT coarse. Columns: `id, component, sub_component, operation, origin,
  entity_type, entity_uuid, entity_singular_name, playbook_iri, playbook_name,
  title, display_name, user_name, user_id, transaction_date (bigint epoch),
  details jsonb, link_entity_details jsonb, legacy` + team/user IRI FK tables
  for RBAC scoping; indexed on `entity_uuid` + `transaction_date`; ~7.9M rows
  (live, heavily used). Gives who (`user_name`/`user_id`), what
  (`operation`/`component`), on-what (`entity_uuid`/`entity_type`), playbook
  context, when — AND a flexible **`details` jsonb** that absorbs our
  fine-grained tool/args/tier/approval-decision/side-effect envelope. Survives
  ALL upgrades, is the platform's canonical audit surface (shows in the FSR UI
  audit log; what SOC2/compliance auditors already read). **KEY OPEN QUESTION:**
  find the *supported write path* — audit rows are normally written BY the
  platform (Java `AuditLogController` via `/api/gateway/*`), not by arbitrary
  external inserts. Confirm whether the connector can emit an audit entry via a
  gateway API / crudhub, vs. only raw INSERT (raw INSERT into a core table is a
  last resort, not upgrade-safe against schema changes). This gates C.
- **(A) Own table in the CORE platform DB `sealab` (fallback / full control).**
  ⚠️ Corrected: put it in **`sealab`, NOT `venom`** — `venom` is fsr-ai's own
  DB and only exists where fsr-ai is installed (e.g. 168 lacks `/api/ai/*`), so
  it's neither portable nor ours. `sealab` is core, present on every box,
  survives connector upgrades, and `cyberpgsql` has CREATE. Use this if C has no
  supported write path or we need a schema the `details` jsonb can't cleanly
  hold. Own DDL = own migration burden, and a custom table in the core DB is not
  something the platform manages for us.
- **(B) Reuse fsr-ai's `llm_activity_log` — REJECTED.** Schema probed
  (`/opt/fsr-ai/database/schema.py`, live table confirmed, 654 rows): `id, uuid,
  title, correlationid, provider, modelname, prompt, response, inputtokens,
  outputtokens, totaltokens, latencyms, costusd, status, error` + Auditable. A
  per-LLM-CALL cost/token log — NO tool/args/tier/approval/approver/side-effect
  fields. Lives in `venom` (fsr-ai's DB, not portable), `extend_existing=True`,
  owned by a service we don't control. At most optionally mirror our own LLM
  cost there — separate concern. Do NOT use for tool/approval audit.
- Also noted: **`connectors.connectors_executeaction`** exists — connector
  action executions may already be recorded natively there; worth a look as
  supplementary provenance, but it's not an approval/tier audit.

### nginx route mechanism (box-verified 2026-07-19, GA/159 = 8.0)

- `/etc/nginx/nginx.conf` includes `/etc/nginx/conf.d/*.conf` — so any `.conf`
  dropped in `conf.d/` is loaded.
- **The 3.9 upgrade-safe path `/etc/nginx/custom/` does NOT exist on 8.0.**
  Vendor routes live directly in `conf.d/cyops-api.conf`, which is NOT
  upgrade-safe (editing it risks the web tier).
- 8.0 already ships agentic routes we could ride instead of building our own:
  `location /mcp/` → `http://localhost:8010`, `location /ai/` →
  `https://localhost:8001`, plus `location /gateway/` (the audit gateway above).
- **OPEN:** whether a *non-vendor-named* file (e.g. `conf.d/zz-fsr-audit.conf`)
  survives a FortiSOAR upgrade on 8.0 is unverified — needs a probe of the
  upgrade's conf.d handling before relying on it. Until then, prefer riding a
  shipped route or writing audit straight to Postgres (no new nginx route
  needed for a DB-write path — the route is only needed if we want a
  *streaming/query* HTTP surface for audit).
- Auth pattern if we do add a route: copy `/mcp/`'s Bearer gate, not the 3.9
  pb-stats `auth_request`/cookie gate.

_Note: for option (A)/(B) — a plain DB write — **no nginx route is required at
all**. The "nginx route for efficiency" idea only pays off if we also want a
fast read/query or streaming audit endpoint; scope that separately so it
doesn't block the write path._

---

## P2 — Tool-output budgeting

Known seam (WORKFLOW_MAP): 40–50KB uncapped tool results consume model context
and degrade reliability. Standard = explicit token budget + truncation with
continuation on tool results. Self-contained, directly improves the loop.

---

## P3 — Tool-catalog consolidation

Three catalogs (jinja-filter validation / discovery / runtime) disagree — the
opposite of the single-JSON-Schema-source-of-truth convention, and already a
live correctness risk (contributed to S3 output-path noise). Consolidating
toward MCP-style single-schema tool defs also buys future portability to
external MCP servers (threat intel / EDR / ticketing).

---

## P4 — Defense-in-depth guards

Guards (`hunt_floor` etc.) are per-turn and error-shaped (surface as capability
gaps). Best practice = distinct layers (input validation + runtime monitoring +
output validation) with state that carries across the case. Coupled to the
known "no persistent case state" seam.

---

## Deferred (do NOT start until P0 is done and reliable)

- **Undo / rollback.** High trust value per the research, but explicitly
  deferred by user directive. Would need reversal of `update_playbook`, applied
  patches, and `run_op` side effects — non-trivial.
- **Confidence scoring / auto-execute thresholds.** Skeptical: LLM self-reported
  confidence is miscalibrated; do NOT wire auto-execution to it. A soft
  "analyst review recommended" signal on low-grounding triage is the most we'd
  consider, and only as display, never as an auto-act trigger.
- **Tool-count consolidation ("5–8 tools").** Generic advice; our granularity is
  domain-justified. The catalog-*consistency* problem (P3) is the real issue,
  not tool count.

---

## Open questions

- What specifically fails "works at a basic level" today? (Drive on box, fill P0.)
- nginx `/audit/` route feasibility on 8.0 vs storage-only path.
- Does the audit record need to satisfy a named compliance profile (SOC2 /
  FedRAMP) now, or is "complete + exportable" enough for v1?
