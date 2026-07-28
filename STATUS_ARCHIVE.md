# STATUS — archive

Append-only session history and superseded detail blocks, split out of
`STATUS.md` on 2026-07-28 to keep the live tracker focused. Nothing here is
deleted — it is moved. Durable facts already live in the auto-memory files and
the `docs/plans/` docs; this is the narrative record for when you need the
"how did we get here" detail.

Contents:
1. Session banners (newest-first), 2026-07-17 → 2026-07-28.
2. Superseded detail blocks: the widget live-validation pass, the prompt+flow
   test matrix, the local-dev-loop notes, and the strategic-vision pointer.

---

_Last updated: 2026-07-28 (session G — 🟢 **Scheduled Agent Tasks + SOC Assistant Monitor — LIVE-VERIFIED on .159.** Picked up from session C's shipped-but-blocked state: connector v0.5.37 on .159 was pre-monitor (box reimage wiped ops) → deployed **v0.5.39** (10 new ops: 6 scheduled + 4 monitor + dual-write telemetry). Seeded 3 LLM turns through the widget drawer: `list_usage` returns 3 entries, `get_usage_summary` 16.6k tokens, `get_audit_trail` 3 entries, `list_pending` 3 HITL. Created "Daily alert review" scheduled task via widget overflow → Scheduled Tasks panel (cron `0 9 * * 1`, every Monday at 09:00 UTC), verified `run_scheduled_task_now` triggers workflow, `update_scheduled_task` enable/disable. Monitor dashboard shows real data: 3 turns, 16.6k tokens, $0.0038 cost, 3 pending, 1 scheduled task; audit trail tab populated; scheduled tab with run/action buttons. All 10 ops green on .159. Dashboard at `/?qid=80d9d1fc...`. Screenshots saved to `introspection-reports/dashboard-render/`.)_

_Prior: 2026-07-28 (session D — 🟢 **Two follow-ups cleared: .159 caught up to 0.5.37 + ztpf matrix regression swept on .206 (RUNS=2) with NO widget regression.** (1) **.159 ship:** deployed `connector-fsr-soc-assistant 0.5.37` (no bump; the already-committed `a62b7a7` build) — all 9 workers verified on 0.5.37, republish recycled them, warmup re-synced the op catalog (32 connectors / 488 ops / 45 modules). .159 was found on **0.5.36** (memory's "0.5.34" was stale). Both boxes now == 0.5.37. (2) **ztpf sweep .206:** Z1–Z5 + 10 SKL-* ×2 headed. **13/15 clean 2/2** incl. tool-heavy rows (SKL-2/3 drove 7–13 tool calls) and every gate (approval + manual-input cards fire correctly). Run 1 was invalidated by a **transient .206 network drop** (5 scenarios hit `ERR_INTERNET_DISCONNECTED` mid-sweep) → re-ran two clean full passes (A+B). **Two non-green rows, both non-regressions:** **Z5** — its record `38baa767…` was DELETED from .206 (drawer mounted to `/not-found`); retargeted to `96fa3a89`, mount now clean but that source drives the playbook to a `manual_input` gate not the asserted `approval_request` → scenario-data mismatch, widget behaved correctly (see new Open row). **SKL-MI2** — manual-input-chain flake, **2 PASS / 1 FAIL** across the 3 runs (stochastic; the resume path 0.5.37 touched). Scenario file is gitignored/box-specific — Z5 note updated in place, no commit. The two session-C follow-ups this addressed are closed — see Done.)_

_Prior: 2026-07-27 (session C — 🟢 **Scheduled Agent Tasks + SOC Assistant Monitor — BUILT, COMMITTED, SHIPPED to .159.** Both features from the session-C plans are now implemented, gated green, and deployed: **Connector v0.5.36** (6 workers recycled + verified; 10 new ops: 6 scheduled-task ops + 4 monitor ops; dual-write telemetry hook to `/api/3/llm_activity_logs` + sqlite `agent_usage`), **fortiaiAgenticAssistant v1.2.44** (Scheduled Tasks panel: create/edit/run-now/delete with cron→human preview), **socAssistantMonitor v1.0.1** (new standalone dashboard: glassy KPI cards w/ SVG sparklines, gradient area chart, per-user rollup, tabbed overview/usage/audit/pending views). All tests green (893 widget + 57 connector). Both widget repos committed; connector committed `97366ff`. The two session-C Open rows are closed — see Done.

_Prior (same session): 🔵 **Two feature plans written + platform probed on .159/.206.** Authored `docs/plans/scheduled-agent-tasks.md` (recurring agent tasks inside `fortiaiAgenticAssistant`) + `docs/plans/soc-assistant-monitor.md` (a separate `socAssistantMonitor` dashboard widget: usage/tokens/cost over time, pending HITL tasks, per-user activity, auditable LLM-call trail). Both grounded in live-verified platform facts, not assumptions. **Key probe results:** (1) the scheduler is django-celery-beat at `/api/wf/api/scheduled/` — `id` is a rotating Fernet token (key by `name`), `kwargs` carries only `wf_iri` (no free-form payload → **the playbook IS the task**), full create/get/trigger/disable/delete cycle confirmed on .159; the connector already reaches `/api/wf/` via crudhub (`operations.py:6583,6610,6963`) so zero new transport. (2) **`/api/3/llm_activity_logs` is the audit home** — a real platform module (102 rows on .206, `App\Entity\Ai\LLMActivityLog`), writable by the crudhub service account via standard `POST /api/3/llm_activity_logs` (proven end-to-end on .206). This **flips the earlier draft**: the connector writes here per LLM turn (camelCase field map) as the primary audit path; sqlite `agent_usage` is the secondary store for the richer fields the module lacks (tool_calls, cache stats, tags, session_id, intent). Do NOT confuse with fsr-ai's internal `llm_activity_log` sealab-DB table (no route, fsr-ai-only writer — ruled out). (3) Transport probe: `/api/3/*` works via crudhub (same as `push_playbook`); `/api/ai/*` is RBAC-gated by PHP (403s the service account on most routes); `/ai/*` direct to fsr-ai:8001 403s (HMAC key mismatch). See the two new Plan-docs rows.)_

_Prior: 2026-07-27 (session B — 🟢 **GA demo prep on .206 + .159 recovery.** Seeded 3 indicator-rich demo alerts on .206 (ransomware precursor / SSH brute-force / C2 beacon); configured all three response connectors on .206 (FortiGate `fortigate-lab`, FortiEDR `fortiedr-lab`, **FortiSIEM auto-installed v6.1.1 from Content Hub** + `fortisiem-lab`) — containment now executes live on .206. Enhanced `configure_fortisiem.py` to auto-install a missing connector from Content Hub. **.159 fixed**: UI `alerts metadata not found` was post-reimage stale client metadata (server-side fully intact) — republish + clean browser context cleared it (user-confirmed); the connector 0.5.34/fw 0.5.7 mismatch self-healed (0.5.7 now installed AND on public PyPI, health_check clean). Discovered the native `llm_activity_logs` module + an MCP tooling gap. See the session-B banner for follow-ups.)_

_Prior: 2026-07-27 (session — 🟡 **run-vs-author mis-routing fixed in the framework (3 commits, 2135 offline-green); NOT released, NOT shipped, NOT live-proven.** Levers 1+2 landed on framework `main`; fw 0.5.7 was un-published at the time — **now published to public PyPI** (0.5.7 is the current latest). Connector 0.5.34 on .159 pins 0.5.7 and imports it cleanly. See the 2026-07-27 banner for the remaining open items.)_
>
> _**Tracker reorg, same day:** follow-ups from sessions 4g → 07-27 lived only inside the
> banners and were invisible from the Open table — they are now rows in **🔴 Open / next up**
> (newest-first, above a divider). The three plans written since the last index audit
> (`state-derived-intent-and-tool-slicing`, `assistant-skills-learned-house-rules`,
> `connector-install-wizard-api-map`) are now in **Plan docs**, which is 1:1 with `docs/plans/`.
> **🟡 Built but uncommitted** gained a current table (its only note was a stale 2026-07-05
> all-clean sweep). Convention going forward: a banner records what happened; anything still
> owed must also get an Open row, and a new plan is only tracked once it has a Plan-docs row._
>
> _**⚠️ The 2026-07-27 banner below is partly STALE — verified against the repos during the reorg.**
> It says fw 0.5.7 is unpublished and Lever 2 is dead code; **both are closed**: 0.5.7 is on PyPI,
> connector **0.5.34** pins it, and `classify_run_or_author` is wired at `operations.py:2362`.
> The banners are append-only history and were not rewritten — **the Open table is the authority
> on what is still owed.** Assistant Skills went further than any banner records: live-proven
> end-to-end on .159 the same day, though its code is still uncommitted._

_Prior: 2026-07-26 (session — 🟡 **M2 per-page MCP surfacing BUILT + SHIPPED conn 0.5.25 to 159, offline-green (549 passed); LIVE DEMO BLOCKED by a 159 box outage.** Deterministic core (a) + persona composition (step 4): affordance-class + curated↔MCP capability maps in `triage_sources.py`; persona `jSONValue.mcp` block (`PersonaMcp`) in `profiles.py`; `_tools_for_persona` COMPOSE-not-replace; two pure filters in `_advertised_tools` threaded at all 3 turn-like callsites; `test_surfacing_oracle.py` (14 tests, grounded in live inventory deepwiki 3 / fortisiem 20 / soc 9). **⚠️ Code still UNCOMMITTED in the connector `main` worktree.** **⚠️ 159 outage:** FortiSOAR frontend down — ports **13000 (API) + 11000 (admin-SSH) both refuse**, VM up on stock 22/443 → fresh workers can't materialize external MCP nor reach the LLM. Plan: [state-derived-intent-and-tool-slicing.md](docs/plans/state-derived-intent-and-tool-slicing.md) §M2. Memory: `resume_2026_07_26_fortisiem_and_m2`.)_

_Prior: 2026-07-23 (session 4i — 🟢 ZTPF tool-robustness SHIPPED to .206. Framework **0.4.47** (list-form filters + name-list relationships) → connector **0.5.12** → widget **1.2.36**; 3 ztpf personas upserted (device/metadata/authoring). **Live-proven:** `list_module_playbooks` returns 6 device playbooks; **actual `run_playbook` execution** — "Synch Device DVMDB info from FMG" on FG1 triggered → `status: finished` (workflow pk 5671). Closes the ztpf Track-1 ship + the "run not verified live" gap. UI scenario pass pending box login.)_

_Prior: 2026-07-23 (session 4h — 🟢 TWO model-agnostic tool fixes shipped to GA. (1) output-binding: `get_op_schema` teaches `.data.<field>`; haiku S3 0/5 → 5/5 (fw 0.4.45/conn 0.5.10). (2) config-less verify false-positive on cyops_utilities fixed (fw 0.4.46/conn 0.5.11). Direction set: support MOST models, harden the tool, Frank-local primary loop; dropped 4g #2/#3. See [[model_agnostic_tool_robustness_direction]].)_

_Prior: 2026-07-23 (session 4g — enhance-delivery guard SHIPPED fw 0.4.44 / connector 0.5.9 on GA; e3 delivery 1/4 → 5/5 live. Coverage hardened, approved-card reconciled, S3 authoring A/B run. 6 follow-ups in the 4g banner.)_

_Prior: 2026-07-22 (session 4f — "stuck in build mode" traced to 4 defects + a lying catalog; all fixed, shipped 0.4.42/0.5.6/1.2.33 and live-proven on 159. 5 follow-ups logged in the 4f banner.)_

_Prior: 2026-07-21 (session 4d — SOC-investigation offline coverage + 3 defects fixed; emit-card surface measured dead. See the 4d banner below.)_

_Prior: 2026-07-20 (session 3q — **FULL-LLM `chat_turn` integrated proof CLOSED, box-proven on 206.** Real OpenAI gpt-4o on config `repro-openai` (206's `fsrpb-live`/`repro-openai` are OpenAI, not Anthropic; `fsrpb-apikey-proof`'s Anthropic key is a dead placeholder) **decided on its own** to call materialized `mcp_soc__get_indicators {"values":["8.8.8.8"]}` → `status:success` real hydra Indicator collection, **no 401/403**, `stop=end_turn`. Getting there proved: (1) **config PUT round-trip is clobber-SAFE** — GET returns the key as re-submittable ciphertext, re-PUT preserves LLM auth (the "UI-only" fear was unfounded); (2) **soar_api_key ciphertext is portable across configs** (appliance-global key), copied donor→target, no plaintext; (3) **`enrich_indicator` (playbook-TRIGGER tool) 403s** — trigger accepted (past 401, task_id issued) but api-key user's SOC-Analyst role can't read exec status; READ tools return real data; (4) **MCP `run_connector_operation` ignores `config_name`** → hits DEFAULT (`fsrpb-frank`, unreachable Frank gw); drive via pyfsr `execute(config_name=…)`. `repro-openai` left carrying soar_api_key+allowlist. Session 3p below.)_

> _Prior: 2026-07-20 (session 3p — **soc-401 fix completed via API-KEY path + BOX-PROVEN on 206.** Read the gateway source on-box (`/opt/mcp-server`): `FortiSOARApp` replays the `Authorization` header **verbatim** on downstream `/api/3`; `auth_service.py` accepts "Bearer OR **API-KEY**". So the fix is any non-URI-bound, user-mapped credential — shipped an **API-KEY** path (preferred over bearer: static `Authorization: API-KEY <key>`, no minting) `soar_api_key` field, priority api_key>bearer>hmac. Added diagnostic op **`probe_native_mcp`**. Created a FortiSOAR api-key user (SOC Analyst) + a fresh `fsrpb-apikey-proof` config via pyfsr (no clobber). **A/B on 206 through the real gateway (worker context): HMAC → `get_indicators` 401; API-KEY → `status:success` real data.** connector **0.4.91** on 206. Api-key auth 400s on 159 (per-box URL-scoping) so proof ran on 206. Prior session 3o below.)_

> **🎯 TOP PRIORITY (user): make the SOC assistant look great in a GA demo.**
>
> **▶ 2026-07-27 (session B) — 🟢 GA demo prep on .206 + .159 recovery + tooling finds.**
> Driven by a live-demo crunch; demo pivoted from .159 → **.206**.
> - 🟢 **3 demo alerts seeded on .206** (indicator-rich so triage/hunt ground on real data):
>   `Ransomware Precursor: vssadmin Delete Shadows on WIN-DC01` (Critical, id 90,
>   uuid `7c9045a1-853c-4cbb-912a-2dc1c1e4100d`) · `Brute-Force: 47 Failed SSH Logons on
>   bastion-prod-01 from 203.0.113.66` (High, id 91, `61ad5575-…`) · `C2 Beaconing to
>   45.155.205.233 from finance-ws-12` (Critical, id 92, `24fc81b2-…`). Each carries host/IP/
>   user/hash/JA3/MITRE in the description. Created via `create_record` (MCP), instance 206.
> - 🟢 **All 3 response connectors configured + Available on .206** via the commit-safe scripts
>   in `…/ConnectorsV2/fsr-playbook-builder/scripts/` (creds in gitignored `.env.fortigate/
>   .fortiedr/.fortisiem`; box env `…/fortisoar-widget-harness/.env.206`):
>   FortiGate `fortigate-lab` (block IP, cfg `315e75ea`), FortiEDR `fortiedr-lab` (isolate,
>   org **Palm Labs**, cfg `d1a91b44`), **FortiSIEM auto-installed v6.1.1 from Content Hub**
>   then `fortisiem-lab` (cfg `223a41de`). Containment now EXECUTES live on .206 (was card-only).
> - 🟢 **`configure_fortisiem.py` enhanced** — new `_ensure_installed()` installs a missing
>   connector from Content Hub (`connectors.install(name, version, wait=True)`; version
>   auto-discovered via `content_hub.find_uninstalled_connector`) before configuring.
>   Flags: `--install-version <v>` to pin, `--no-install` to opt out. Proven: it installed
>   fortinet-fortisiem 6.1.1 on .206 → `Import Complete` → configured → Available.
> - 🟢 **.159 UI `alerts metadata not found` FIXED** (user-confirmed). NOT data loss: server-side
>   `alerts` intact in `/api/3/modules` (67), `model_metadatas` (45), `attribute_metadatas`,
>   `staging_model_metadatas`, and the UI mmd locales — all carry alerts. Root cause = the SPA's
>   client metadata store (`u.get("metadata.alerts")`, localStorage `cs.metadata.*`) held a
>   **stale/partial copy from the reimage window**; a hard reload keeps localStorage so it
>   persisted. Fix = `publish` (regenerated ModelMetadata + cleared caches) **+ a clean browser
>   context** (Clear site data / fresh Incognito *after* the publish). The earlier Incognito test
>   predated the publish, which is why it looked server-side.
> - 🟢 **.159 connector self-healed.** The `fsr_playbooks version mismatch: worker imported
>   '0.5.6', connector pinned '0.5.7'` error class stopped after 0.5.7 finished installing
>   (~18:38); **fw 0.5.7 is now on public PyPI** (latest) AND installed on-box. Live `health_check`
>   on `fsrpb-41mini` (connector 0.5.34) returns clean: `ok, llm_reachable (125 models),
>   fsr_soc_triage_pkg ok, live_crudhub_available, NO mismatch`.
> - 🆕 **Native `llm_activity_logs` module discovered** (entity `App\Entity\Ai\LLMActivityLog`,
>   endpoint `/api/3/llm_activity_logs`; 96 rows on .206). It's the platform-wide per-LLM-call
>   audit — DISTINCT from the connector's agent-session transcripts (`list_agent_sessions`/
>   Widget History). It does NOT appear in `list_modules` (AI/system module, not CRUD).
>
> **🔵 FOLLOW-UPS from session B:**
> 1. 🟠 **MCP `fortisoar` tooling gap** — `list_modules`/`describe_module` present an
>    incomplete list as complete, hiding AI/system modules (`llm_activity_logs`, `assistant_skills`)
>    and the `describe_module` error even ships a misleading `available[]`. Proposed fixes:
>    `list_modules include_system=true` sourced from `/api/3/model_metadatas`; on a name miss,
>    probe `/api/3/<module>` before failing; reword `available` as "standard CRUD (not exhaustive)".
>    (User asked whether to improve this — not yet implemented.)
> 2. 🟠 **`scenarios.local.159.json` authored, never run.** Built a 5-row demo-verification
>    matrix for .159 (T1 triage / T2 hunt / TB block-IP approval / B1 explain-playbook /
>    B2 add-error-handling) on real .159 records (alert `e94dc2dc` IPS exploit; playbooks
>    `0d0a1c8b` Hunt Indicators, `20f32ef0` Link Similar Alerts). Run via
>    `make test-matrix-live MATRIX_ENV=.env.159` (headed). Not executed this session.
> 3. 🟡 **.206 containment is now LIVE-EXECUTABLE** — a demo "block that IP" / "isolate that host"
>    will push to a real device. Decide whether to actually approve-and-execute on stage
>    (FortiEDR isolate is reversible via `unisolate_collector`; FortiGate block persists).
> 4. 🟡 **Confirm the .159 fix holds** through a real alert-open + widget drawer mount (the
>    demo pivoted to .206 before this was rehearsed on .159).
>
> **▶ 2026-07-27 (session) — 🟡 run-vs-author mis-routing FIXED offline; release + ship + live proof ALL still open.**
> Defect (from the ZTPF thumbs-down sessions): asking to **run an already-deployed playbook by name**
> got treated as an *authoring* task — the model called `verify_playbook`/`validate_yaml`/`compile_yaml`
> with a playbook NAME and blank `yaml_text`, fabricated YAML, and never triggered anything. Live on 8.0
> this was **0/3**. Three commits on framework `main`, full suite **2135 passed / 9 skipped**:
> - `af77ef6` — build system prompt: route "run the existing playbook X" to `run_playbook` **first**;
>   `run_playbook`'s docstring restated in run/execute/trigger terms so it's selectable from wording alone.
> - `f5cf78c` — **Lever 1 (dispatch forcing-redirect).** Authoring tool + playbook name + blank YAML is
>   nonsensical for authoring and unambiguous for "run it" ⇒ `dispatch()` **re-dispatches `run_playbook`
>   itself** rather than returning an advisory the model can ignore (a passive tool_result was unreliable —
>   gpt-4.1-mini reads it and wanders back into authoring). Keyed on **call shape, never on the analyst's
>   words**, so it holds in any language. Goes **through the same tier gate** — tier-3 still yields the
>   approval envelope, nothing runs un-approved. Mutation-checked: disabling the guard turns 6 tests red.
> - `c398026` — **Lever 2 (run-mode slice + run/author classifier).** Covers the case Lever 1 can't see:
>   the model fabricating *full* YAML with no name to key on. A run-classified turn collapses the advertised
>   slice to a strict allowlist — **`run_playbook` alone**, no authoring terminal, no discovery to wander into.
>   Classifier takes an injected `complete(system, user)` (provider-agnostic), fails **open** to `other`.
>
> **⚠️ OPEN — nothing below is done:**
> 1. **fw 0.5.7 UNPUBLISHED.** `make release` is blocked by the sandbox classifier (public PyPI publish);
>    needs a human to run it. An earlier attempt failed the **clean-tree gate**, not the publish — tree is
>    clean now. Until this lands, items 2–4 cannot start.
> 2. **Connector not bumped/shipped.** Still pins `fsr-playbooks==0.5.6`; connector sits at **0.5.32**
>    (uncommitted `info.json`/`requirements.txt`). Then `make bump-framework VERSION=0.5.7` → `make ship ENV=…/.env.206`.
> 3. **No live proof on .206.** Repro is the original thumbs-down ask ("run these steps") against the ZTPF
>    persona/records. **Grading note:** the expected pass is `unknown_playbook` + the real candidate list **only
>    when the name doesn't resolve**. A playbook that *does* resolve still returns an **approval card** — that's
>    Lever 1 routing through the tier gate by design, NOT a failed fix. Don't read a correct card as a regression.
> 4. **Lever 2 is UNWIRED.** `classify_run_or_author` / `tools_for_run_mode` have **zero callers** — dead code
>    until the connector threads the classifier into its turn path and picks the run-mode slice. Only Lever 1
>    is actually live-effective after the ship.
> 5. **Connector release notes are placeholders** — `0.5.30`/`0.5.31`/`0.5.32` all say "_TODO: describe this release._".
> 6. **Pre-existing red, unrelated:** `tooling/tests/integration/test_e2e_runs.py::test_stage4_manual_input_resume`
>    and `::test_stage5_manual_input_multi_field` fail against box .205 — `'FortiSOAR' object has no attribute
>    'system_settings'` (pyfsr API drift). Predates this session; not a gate on the ship.
>
> _Hygiene: an untracked `build/` artifact dir in the framework repo trips the release clean-tree gate and is
> not gitignored — moved aside this session; consider adding it to `.gitignore`._
>
> **▶ 2026-07-26 (session, cont.) — 🟢 M2 per-page MCP surfacing LIVE-VERIFIED on 159 (conn 0.5.28).**
> 159 fully recovered (license lockout + egress gone): `health_check` → `0.5.28, llm_reachable=true
> (125 models)`. M2.1 dispatch bug fixed (`d8f712e`: `list_mcp_servers` was in info.json/operations
> but not `_LIVE_OPERATIONS` → `unknown operation`; + `test_every_info_json_operation_has_a_handler`
> guard). **Per-page surface PROVEN live** via `list_mcp_servers`: module=None→all; alerts(soc_triage)
> →[fortisiem,soc]; workflows(authoring)→[deepwiki] — exactly the spec. Servers wired into `fsrpb-41mini`
> (deepwiki3/fortisiem17/soc9); cold workers return `servers:[]` (process-global materializer, warm first).
> Code committed on `main` (d8a6e44/b6adbfb/d8f712e), tree clean. ⚠️ Minor follow-up: `allowlist_keys`
> always `[]` (bare-op config doesn't carry `mcp_allowlist`; only a real `chat_turn` hydrates it — cosmetic).
> ⏳ Remaining: (1) confirm widget emits `module=workflows` from a playbook page; (2) widget-tier in-browser
> rehearsal of the per-page surface (the money demo). Memory `resume_2026_07_26_fortisiem_and_m2`.
>
> **▶ 2026-07-26 (session) — 🟡 M2 per-page MCP surfacing BUILT + SHIPPED (conn 0.5.25 on 159); live demo blocked by box outage.**
> Problem M2 fixes: every page advertised the SAME materialized MCP surface (all servers in `mcp_allowlist`),
> regardless of what the analyst is looking at (live-confirmed: identical 29 MCP tools across triage/build and
> module=None). M2 makes the advertised surface a deterministic function of the page (module).
> - **(a) Deterministic core** — `fsr_soc_triage/triage_sources.py`: `AFFORDANCE_SERVERS` (soc_triage→{fortisiem,soc},
>   noc_device→{fortisiem}, authoring→{deepwiki}) + `MODULE_AFFORDANCE` (unmapped ⇒ unrestricted/fail-open) +
>   `CAPABILITY_DEDUP` (curated `siem_events_for_incident`/`siem_raw_query` win over their `mcp_fortisiem__*` dupes).
>   Two pure filters `apply_server_surfacing` + `apply_capability_dedup` → `surface_page_tools`.
> - **(step 4) Persona composition** — `profiles.py` `PersonaMcp` (`servers`, `capability_dedup`) parsed from
>   `jSONValue.mcp` (fail-open) + lint; `_tools_for_persona` COMPOSE-not-replace (`tools_allow ∪ afforded MCP`);
>   `_advertised_tools` gains `module=` + persona overrides, threaded at chat_turn/resume/list_agent_tools.
> - **Tests:** `test_surfacing_oracle.py` (14, grounded in live inventory) + 5 profiles parse/validate. Full suite
>   **549 passed / 1 skipped**, no regressions. Shipped **connector 0.5.25** to 159 (5 workers recycled).
> - **⚠️ OPEN:** (1) code **UNCOMMITTED** in connector `main` worktree; (2) **live per-page demo BLOCKED** — 159
>   FortiSOAR frontend down (13000 API + 11000 SSH refuse; VM up on 22/443); (3) when box back: verify one
>   unreachable server doesn't poison on-box `soc`/internal `fortisiem` materialization; fill real authoring
>   module name in `MODULE_AFFORDANCE` (guessed `workflows`). Plan §M2, memory `resume_2026_07_26_fortisiem_and_m2`.
>
> **▶ 2026-07-23 (session 4i cont.) — 🟢 Multi-gate manual-input CHAIN fixed + live-proven (connector 0.5.13 on .206).**
> A playbook that paused on a SECOND `manual_input` after the first was submitted dead-ended in the widget:
> `resume_playbook` did one status read and returned no `awaiting` form, so `_manual_input_card_from_awaiting`
> synthesized no second card. **Fix:** `resume_playbook` now polls the run to settle and, on a re-pause on a
> fillable gate, re-emits the SAME `awaiting_input` seam (run_pk + form) `run_playbook` returns for gate 1 →
> the transcript splice renders the next `manual_input` card, chain continues. Only a *transient* (running)
> status keeps the poll alive; button-only/terminal/unknown settle immediately (`_TRANSIENT_STATUSES` +
> `_reawait_after_resume` in tools_playbook.py). **Proven:** live regression `scripts/repro_two_manual_inputs.py`
> builds a 2-gate ztpf_devices playbook, uploads it, drives run→submit→re-pause → "CHAIN OK: gate-2 fields
> [note_two] surfaced" (was "GAP" pre-fix). 2 unit tests + full triage suite green. Widget needs NO change
> (it already renders whatever `manual_input` card it's handed). NOTE: caveat still open — a MANUAL-trigger
> (non record-action) playbook that pauses returns `not_finished_awaiting_or_slow` with no form; only
> record-action-triggered playbooks get the clean seam.
>
> **▶ 2026-07-23 (session 4i) — 🟢 ZTPF Track-1 tool robustness SHIPPED to .206 + live `run_playbook` proven.**
> Full pipeline shipped: framework **0.4.47** (PyPI, commit `7cc9b1d`; `SearchModuleRecordsArgs.filters` accepts
> dict OR list-of-conditions, `GetRecordArgs.relationships` accepts bool|list[str] — the top validation dead-ends
> in live ztpf sessions) → connector pin bumped (preflight: 68 symbols/27 modules) → connector **0.5.12** on .206
> (10.99.248.206, 10 workers recycled, warmup 21 conn/283 ops, commit `7ed859b`) → widget **1.2.36**
> (`fortiaiAgenticAssistant`, uuid `6054a063…`, ship-verify green: lint/typecheck/unit/mock-e2e/introspect-gate).
> 3 ztpf personas upserted to .206 Key Store (device/metadata/authoring), all read-back OK.
> - ✅ **`list_module_playbooks` (deployed):** returns **6** ztpf_devices playbooks.
> - ✅ **ACTUAL `run_playbook` execution (the gap the user flagged):** "Synch Device DVMDB info from FMG" on
>   device FG1 (`/api/3/ztpf_devices/5b23794a…`) triggered via the persona-bound tool → workflow run **pk 5671**,
>   `status: finished`, `triggered: true` `followed: true`. Previously only discovery + auto-record wiring were
>   verified; the live trigger→finish path is now proven.
> - ✅ **UI scenario pass DONE** (`make test-matrix-live MATRIX_ENV=.env.206 MATRIX_GATE=soft`, headed, self-auth):
>   4 ztpf rows on FG1 all **PASS, 0 tool errors** — Z1 summarize steps (6 tools), Z2 steps-with-no-run-group
>   (isnull filter, 1 tool), Z3 list_module_playbooks discovery (1 tool), Z4 run_playbook. **Z4 frame order
>   `tool_use → approval_request → stream_end`**, trace `run_playbook({"playbook":"Synch Device DVMDB info from FMG"})`,
>   terminal `approval_required` — the widget surfaces the tier-3 approval card (not auto-run), exactly right.
>   The prior tool-flailing (search/discovery guesses) is gone. Rows added to gitignored scenarios.local.206.json.
>
> **▶ 2026-07-23 (session 4h) — 🟢 Haiku S3 output-binding bug FIXED + SHIPPED + LIVE-PROVEN (0/5 → 5/5). Closes 4g follow-up #1.**
> Framework **0.4.45** (PyPI, commit `cfd1822`) · connector **0.5.10** on GA (159:13000, 6 workers, warmup
> 38 conn/515 ops, commit `d3e64f1`). **Live confirmation:** `eval_s3` haiku arm (`fsrpb-anthropic`) went
> **0/5 → 5/5** — every run authored `vars.steps.<name>.data.minutes` and the alert rendered `180`.
> On GA the haiku authoring arm previously failed all 5 S3 runs identically:
> it bound a connector op's whole envelope (`vars.steps.X.data`) into an alert description → rendered
> `Array` instead of the scalar `180`. Root cause: the `.data.<field>` envelope rule lived ONLY in
> `get_step_type("connector")`, which the build sequence SKIPS; `get_op_schema` (which it DOES call)
> surfaced no output guidance and even hid the static output schema as "untyped scaffolding".
> - ✅ **Fix:** `get_op_schema` now surfaces the op's output FIELD NAMES (from the static schema — its
>   keys are the real `.data` fields even though its types are empty) + an explicit `## output binding`
>   hint in the markdown. `convert_periodic_time_to_minutes` now hands the author `minutes` →
>   `vars.steps.<name>.data.minutes`.
> - 🔒 **Guardrail against a NEW wrong binding:** an OBSERVED schema captures the FLAT envelope
>   (`status`/`message` as siblings of the payload), NOT the `.data` sub-object — so observed keys are
>   trusted only when they nest an explicit `data` object; otherwise fall back to the generic envelope
>   rule. (Static schema = the `.data` payload shape, reliably.)
> - 🧪 7 unit tests (`test_op_schema_output_binding.py`); full framework suite **835 passed**.
> - ✅ **SHIPPED + PROVEN:** framework 0.4.45 → connector 0.5.10; `eval_s3` haiku arm **0/5 → 5/5**.
>
> **▶ 2026-07-23 (session 4h cont.) — 🟢 Direction set: MODEL-AGNOSTIC tool robustness. 2nd fix shipped.**
> User dropped 4g follow-ups #2 (per-intent model routing) and #3 (provision a stronger GA config):
> the tool should **support most models** — harden the tool surface, don't route to a chosen model.
> Low-tier model = fast testing only; **primary test loop = Frank local harness** (GLM-5.2, runs the
> editable framework in-process → no ship needed to test). See [[model_agnostic_tool_robustness_direction]].
> - 🔎 **Found via the Frank loop:** `verify_playbook` flagged `connector_config_missing` as a REQUIRED
>   fix on `cyops_utilities` (config-less built-in that backs no_op/stop/end). A GLM-5.2 build turn
>   burned **~6 tool calls** fighting the false gate (retrying verify, mis-formatting `disable_checks`,
>   tripping the repeated-call guard) before abandoning verify for `dry_run`. Classic weak-model friction.
> - ✅ **Fix** (framework `6f3cd0b` → **0.4.46** → connector **0.5.11** on GA, 7 workers, warmup green):
>   `CONFIG_LESS_CONNECTORS` exemption in `record_op_checks`, scoped to empty config (a typo'd config
>   *name* still errors). `config_schema_json` is empty across all catalogs so it can't distinguish
>   config-less — the authoritative set is the reliable signal. 2 tests; suite **837 passed**.
> - ✅ **Confirmed on GLM-5.2 (Frank):** verify now returns clean `ready_to_push` on the FIRST call,
>   straight to `emit_playbook_offer` with correct `.data.minutes` binding. Both 4h fixes model-agnostic.
> - 🔜 Connector commits `d3e64f1`/`6e4f0f7` pushed to `origin` (Fortilab GitLab); `fndn` mirror pending (host unreachable w/o VPN).
> - 📦 **Also deployed to .206** (10.99.248.206, user request): **connector 0.5.11** (BUMP=none, 10 workers,
>   warmup 21 conn/282 ops) + **widget 1.2.35** (`fortiaiAgenticAssistant`, uuid `264fe55c…`; the widget
>   push CLI requires a bump so 1.2.34→1.2.35, identical code; info.json is gitignored so no repo change).
>   Full ship-verify gate (lint/unit/e2e/introspect) passed; deployed via ship.sh --bump patch to `.env.206`.
>   Both boxes now on connector 0.5.11 (GA widget stays 1.2.34).
>
> **▶ 2026-07-23 (session 4g) — 🟢 Enhance-delivery guard SHIPPED to GA + live-proven; coverage hardened; S3 authoring A/B.**
> Framework **0.4.44** (PyPI, commit 2e8de2f) · connector **0.5.9** on GA (159:13000, all 4 workers). Full detail:
> [[resume_2026_07_23_enhance_delivery_ship]], [[enhance_write_path_shipped_ga]].
> - 🟢 **EnhanceDeliveryGuard** — the enhance turn's terminal action (`emit_enhancement_offer`) was
>   prose-enforced, so a weak model narrated "Call emit_enhancement_offer with verified_id …" and ended
>   the turn instead of calling it. Now structural: both providers, at the terminal exit, run ONE
>   tool_choice-pinned round forcing the offer + override `verified_id` with the blessed handle. The loop
>   already forced *text* (P1 assessment) and *evidence* (hunt floors) — this adds *delivery*.
>   **e3 rewire-a-branch: 1/4 → 5/5 delivered live** (gpt-4.1-mini). Design rule: force the *execution* of
>   a decision already made+verified; never force the *decision*.
> - 🟢 **Coverage hardened** (framework 8d95d03): `make enhance-live` live delivery gate (5/5 GA, rich-trace
>   so it can't false-PASS a stall); anthropic parity test; **fixed chat_drive's 2 stale constants**
>   (CONN=pre-rename name, DEFAULT_VERSION=0.3.116) that broke EVERY current-box drive. Widget
>   enhancement_offer Apply-wiring jest test (widget f6a5e4a); matrixDriver regex (harness 87ba27d, LOCAL-ONLY).
> - 🟢 **Approved-card reconciled** — impl already shipped 0.5.9 (deterministic dispatch = the same
>   force-the-execution pattern); committed the loose regression test (connector 740625d) + 0.5.9 ship
>   artifacts (08b654e), pushed. See [[approved_card_execution_was_advisory]].
> - 🔬 **S3 authoring A/B on GA** — 41mini & haiku BOTH 0/5, but haiku fails CLEAN (one output-binding bug:
>   `.data` vs `.data.minutes`) while 41mini scatters (no YAML / wrong mode / dropped op). GA has NO gpt-4o.
>   See [[s3_authoring_ab_gpt41mini_vs_haiku_ga]].
> - **6 open follow-ups** (see resume): (1) fix haiku S3 output-binding → likely 0/5→pass; (2) per-intent
>   model routing (needs triage-side A/B; user decision); (3) GA has no gpt-4o config; (4) 41mini
>   create→enhance mode-confusion (drift smell); (5) harness 87ba27d local-only (65 ahead, no upstream);
>   (6) widget DOM/live-sweep tier for the offer card.
>
> **▶ 2026-07-22 (session 4f) — 🟢 "Stuck in build mode" traced to FOUR defects; all fixed + SHIPPED + live-proven on 159.**
> Framework **0.4.42** (PyPI) · connector **0.5.6** · widget **1.2.33**, all on 159. Driven from
> five real sessions pulled off the box (`sess-v6uv6x15` is the one in the screenshot).
> - 🔴 **The catalog was lying about what the box has.** `fsr_reference.db` is a warmup
>   SNAPSHOT and `_warmup_needed()` checks **emptiness only** — it cannot notice that the box
>   gained a connector. FortiAnalyzer was installed at 09:18; the last warm ran at 07:08. For
>   the rest of the day every `faz_*` call returned *"connector 'fortinet-fortianalyzer' not
>   found in store"* (reads as **does not exist**) while the appliance API listed it installed,
>   active, `config_count=1`. **~11 of ~25 tool calls across the five sessions died on this.**
>   Fix = verify **on the miss path only** (`_shared.set_live_catalog_probe` /
>   `stale_catalog_hint`; connector supplies it via `fsr_soc_triage/catalog_probe.py`, 60s TTL,
>   Option-A like `set_failed_run_provider`). A confirmed miss now returns code `stale_catalog`
>   naming the real cause. **No probe / failing probe ⇒ UNKNOWN, never "absent"** — treating
>   "couldn't ask" as "isn't there" would just swap one confident falsehood for another.
>   ✅ Live: post-ship warmup went **36 → 37 connectors, 466 → 505 ops**; asking the box
>   *"do we have a FortiAnalyzer connector?"* now answers `fortinet-fortianalyzer` + real ops.
>   That same lookup answered *"did you mean fortinet-fortiedr?"* this morning.
> - ✅ **`find_connector` near-matches now require evidence.** difflib at cutoff 0.45 with no
>   token evidence answered `"siem"` → `[smtp, imap]`, `"crowdstrike"` → `[cyops_utilities]`,
>   `"fortianalyzer"` → `[fortinet-fortiedr]`, all phrased *"did you mean…?"* — which the model
>   faithfully relayed as findings. Now: containment, or a prefix ≥70% of the **longer** string,
>   or ratio **≥0.85**, compared against `-`/`_` tokens so vendor-prefixed rows still match the
>   product name. The 0.85 floor is deliberate — a shared vendor stem alone drags unrelated
>   names to ~0.72–0.80 (`fortianalyzer`/`fortimanager`, `fortiedr`/`fortiai`). Zero suggestions
>   is now an ANSWER: the fallback tells the agent to report the capability unavailable rather
>   than substitute a vendor. 11/11 cases verified; real typos (`fortgate`, `virustotl`) still resolve.
> - ✅ **The assistant could not touch the record it was triaging.** `create_record`/`update_record`
>   sat in `_BUILD_ONLY_TOOLS` **and** (via `register_record_tools`) in `TRIAGE_ONLY_TOOLS` — in
>   BOTH drop sets, so unreachable outside a persona allowlist. *"change the type of the alert"*
>   made **ZERO tool calls** and got reinterpreted as playbook authoring. ⚠️ Reach alone was a
>   no-op: `_write_gate` refuses whenever no persona is active. `_host_record_write_profile`
>   scopes writes to the **mounted record's module only**; off-record stays read-only; a real
>   persona still wins. Safety never came from tool absence — both stay tier 3 / `confirm_mode="approve"`.
> - ✅ **Build mode had no exit** (widget `view.controller.js`). `buildPlaybookFromTriage` latches
>   `uiIntent='build'` and there is deliberately no toggle back; `newConversation` and
>   `_switchToSession` reset `_buildHandoffActive` but **not `uiIntent`**, and refresh re-latched
>   it from the restored YAML. Only navigating to a different record escaped. All three paths now
>   reset via `_defaultIntent()` — **before** the session mint, since `_sessionKey()` is intent-scoped.
> - ✅ **Saved playbooks kept a name nobody chose.** The push resolved title
>   params→`title_suggestion`→`"Triage Playbook"` and never read the `name:` in the YAML it was
>   sending. Model said *'named "DNS Tunneling Investigation and Response"'*; card read
>   *'Saved "Triage Playbook"'*. Now reads the document's own name (still below an explicit rename).
> - 🧪 27 new tests (801 framework / 181 + 227 connector / 818 widget, all green). Two notes worth
>   keeping: the old both-slices-excluded posture had **no test pinning it**, and the new test
>   caught a bug in the fix itself (`Profile` requires `module`/`prompt`; the constructor was
>   swallowing the ValidationError and returning `None` — it would have shipped as a silent no-op).
>
> **🔵 FOLLOW-UPS from 4f (deferred deliberately — chase these later):**
> 1. 🟠 **The catalog snapshot model itself is unchanged.** Installing a connector still does not
>    refresh the catalog; 0.4.42 makes the error HONEST and tells you to re-warm, it does not
>    auto-warm. `make ship` force-warms, which is why re-shipping "fixes" it. Decide whether
>    `_warmup_needed()` should gain a cheap box-vs-catalog drift check (count/name diff) at the
>    existing trigger sites, or whether the probe should auto-trigger a re-warm on a confirmed miss.
> 2. 🟠 **The two-intent split is too coarse.** Real analyst work interleaves triage and authoring
>    (read record → hunt → author → tweak record); the framework has two disjoint tool slices and
>    a one-way latch. 4f made the latch escapable but did not remove the trap. Session
>    `sess-v6uv6x15` died exactly at an interleave point — this is the normal shape of the work,
>    not a corner case. Bigger design item; see the intent model in `fsr_playbooks/llm/intents.py`.
> 3. 🟠 **Alert-scenario test matrix does not exist.** All 7 scenarios in
>    `scripts/scenarios.json` and the T1 set are clean single-purpose arcs on a healthy box.
>    **None** test an interleave, a capability the box lacks, a record edit, or a follow-up after
>    a playbook save — i.e. none of 4f's four defects were reachable by the existing suite. Build:
>    triage→build→record-question interleave; ask for an absent connector; edit the record;
>    follow-ups after a save. Tracker: `docs/plans/widget-capability-test-and-persona-rollout.md`.
> 4. 🟡 **FortiEDR `search_ioc` rejects a valid call.** Live on 159 it returned HTTP 400
>    *"At least one fromTime or toTime required when the time property is custom"* for a call that
>    **did** supply both `fromTime` and `toTime`. Looks like a genuine connector-side bug
>    (`fortinet-fortiedrV2.1.0`) — worth its own bug report, not ours to fix.
> 5. 🟡 **Pre-existing, unrelated:** harness `tests/server.test.ts` fails on widget-jinja-editor
>    static serving (`GET /<id>/view.html` → 404). Untouched by 4f; was already red.

> **▶ 2026-07-22 (session 4e) — 🟢 BEAT 5 FIRES. The containment gap is CLOSED and live-proven on GA.**
> Framework **0.4.40** + connector **0.5.2** shipped to GA/159 (7/7 workers, warmup green).
> Detail in `docs/plans/ga-demo-soc-investigation.md` §4b. Two framework defects, both found by
> driving the real two-turn shape (`scratchpad/ga_beat5_probe.py`, transcripts in
> `scratchpad/ga_beat5.json`) rather than reading code:
> - ✅ **Hunt floor under-counted the connector's own hunt tools** (fw `8e9f534`, connector
>   `7f2225e`). A turn-1 investigation run through `fmg_*`/`faz_*` scored **0 of 3** evidence
>   calls, so turn 2's "isolate that host" was refused as un-scoped and the model burned the
>   turn satisfying the floor, staging an *enrichment* op as the action card.
>   `_INVESTIGATION_TOOLS` is now mutable + `siem_`/`faz_`/`fmg_` prefixes; the connector
>   registry calls the new `credit_as_investigation()`. Same Option-A drift as
>   `TRIAGE_ONLY_TOOLS`.
> - ✅ **🔒 `isolate_collector` was ungated AND undiscoverable** (fw `a5c2afa`). FortiEDR's
>   isolate op is categorized `investigation` and had **no `op_safety` verdict** on GA (391 of
>   466 ops carry one), so it resolved to **tier 2** — `run_op` would have isolated a host with
>   **no approval card**, and `find_containment_actions` dropped it from its tier≥3 slice.
>   `_op_name_is_destructive()` now reuses discovery's own verb list as the fail-safe.
> - 🟢 **PROVEN, twice, on different records:** `stop=awaiting_action_card` in 7-8s,
>   `find_containment_actions → emit_action_card(fortinet-fortiedr.isolate_collector,
>   devices=<the alert's host>)`, card carrying an `approval_id` + full `param_schema`.
> - 🔵 **NEXT:** rehearse beat 5 through the **widget** (this proof is connector-level), and
>   decide whether to approve-and-execute the isolate live on stage.
> - 📌 Box facts corrected: **`fortinet-fortiedr` IS configured and Available** on GA (the plan's
>   "0 configs" was stale). **`fortigate-firewall` is Disconnected** — "Invalid endpoint or
>   credentials" — so block-IP genuinely cannot run; user deferred fixing it, demo uses FortiEDR.
>

> Tracker: **`docs/plans/ga-demo-soc-investigation.md`** — start there.
> GA = 10.99.249.159:13000. **Beats 1–4 (open record → investigate → enrich → verdict) are
> LIVE-VERIFIED GOOD on GA** (30s, gpt-4.1-mini, real `run_op` enrichment, Qakbot attribution,
> grounded on host/IP/user/command-line). 🔴 **Beat 5 — the containment action — does NOT fire:**
> the assistant *recommends* "isolate the endpoint" in prose but emits **`info_card` only, no
> `action_card`**, so the demo ends on advice, not action. That reproduces the emit-card gap on
> the box with the real demo record. 🔑 **Connector name is `connector-fsr-soc-assistant`
> EVERYWHERE** (info.json + 206 + GA all agree; `fortinet-fsr-playbook-builder` is the pre-rename
> name and is on neither box). `fsr_live.py` was always right; `session_analyze.py` shipped with
> the stale constant and now derives it from `info.json`. FortiGate (block IP) is configured ✅;
> **FortiEDR (isolate host) has 0 configs
> ❌** and so does the MCP bridge.
>
> **▶ 2026-07-22 (session 4e, part 2) — beat 5 REHEARSED through the widget; 3 more fixes.**
> Framework **0.4.41** + connector **0.5.4** on GA. Detail in §4c of the GA plan.
> - 🎯 **The demo record must name a real FortiEDR collector.** Simulator hosts are
>   synthetic; the tenant has only `JPALM-DC` + `The-Flame`. Seeded
>   *"Ransomware Precursor … on The-Flame"* (`scratchpad/seed_demo_alert.py`) — **use that
>   record**, and query it by NAME (the simulator pushes it out of any newest-N window).
>   ✅ isolate proven live: **1.5s**, un-isolated after, so the demo is repeatable.
> - ✅ **Investigation can now check EDR device inventory.** `get_collector_list` was
>   invisible to `find_enrichment_actions(host)` — `collector`/`agent` were in the
>   containment keywords but not the enrichment tokens. **Third instance of the same
>   list-drift bug this session**; the fix asserts containment keywords ⊆ enrichment tokens.
> - ✅ **Resume turns stream progress.** The 7-minute "Executing…" was not a stuck button
>   (the op takes 1.5s; the time was the follow-up LLM turn) — `_resume_conversation` simply
>   wasn't a streaming producer. Now reserves the turn + forwards every event.
>   Proven: **170 frames, first at 1.8s**. Terminal frame now built via `StreamEndFrame`
>   (the hand-rolled dict had dropped `last_assistant_yaml`).
> - 🔵 **NEXT:** full widget rehearsal on the The-Flame record end-to-end; decide whether to
>   approve-and-execute live on stage. FortiGate block-IP still deferred (config Disconnected).
>
> **▶ 2026-07-21 (session 4d) — offline testing for the SOC-INVESTIGATION half + 3 defects fixed; emit-card surface found dead.**
> Detail in `docs/plans/widget-capability-test-and-persona-rollout.md` §6h. All committed; the
> framework/connector compiler bits are offline-proven and **need a release+ship**.
> - ✅ **needs-config panel BLESSED** (widget `39d5ee1`) — matches the 1.2.32 tarball already on
>   both boxes; no deploy.
> - ✅ **F2 CLOSED** — read-only fence guard (widget `d72b670`, 15 tests). Prompt lever confirmed
>   spent (`explain_loop_semantics` 3/6 unchanged at RUNS=6); the write is refused where it lands.
> - ✅ **Token cap 4096 → 16384 + `max_turns`→`max_tokens`** (framework `9241ee0`). The "overloaded
>   token" belief was WRONG — corrected in `max_turns_stop_reason_is_overloaded`. Proven: the
>   scenario that died truncated now passes 6/6.
> - ✅ **F4 unblocked, 2/3 leads fixed** (framework `edd45d9`) via a **400-playbook box pull**.
>   Biggest class was OUR decompiler dropping declared parameters, not strictness. **142→178/400
>   compile clean.** Probe at `scripts/session_analyze.py` sibling `f4_pull.py` (scratchpad).
> - ✅ **automate_manual_step 0/6 was a GRADER defect** (`cb6102f`) — 2nd grader defect after F1;
>   `replaces_step` grader, 0/6→3/3.
> - ✅ **`scripts/session_analyze.py`** (`c843a37`) — pull agent sessions (local sqlite OR a box)
>   and grade tool errors + **signal density**. One analysis core, two sources.
> - ✅ **SOC-investigation T1 scenarios** (`31b8e18`) — the triage half, **box-free**: mount a real
>   captured record through `entity`; 3 scenarios, 5 grounding graders, 12 grader unit tests.
> - 🔴 **Emit-card surface is effectively dead (MEASURED):** across 481 sessions, all 5 interactive
>   `emit_*` tools fired **16× total**; `emit_action_card` (the "block this IP" button) **4×**,
>   `emit_manual_input` **0×**. Can't yet tell "model won't emit" from "path is broken" — untested.
>   **Highest-value SOC gap.** See §6h.1–6h.2.
> - 🔵 **OPEN — ad-hoc action after investigation** (*"ok, block that IP"*) has ZERO coverage and is
>   the money path; needs a MULTI-TURN offline scenario. **ZTP personas on .206 not started**
>   (user's 2nd priority; offline-vs-live question open).
>
> **▶ 2026-07-21 (session 4c) — prompt-cache correctness + cost accounting SHIPPED; NEXT PHASE organized.**
> **▶▶ NEXT PHASE TRACKER: `docs/plans/widget-capability-test-and-persona-rollout.md`** — the
> consolidating index for widget testing across **C1 SOC triage / C2 investigation /
> C3 playbook troubleshooting / C4 assistance / C5 building** + the **persona-for-other-modules**
> design question. Start there after a clear; it maps each area to its existing plan + harness
> and lists the gaps. **Nothing in it is started.**
> - **SHIPPED:** connector **0.4.93** + framework **0.4.36** (PyPI) → **both 159 and 206**,
>   7/7 workers recycled each, warmup green. Both repos merged to `main` (connector `main`
>   committed but **NOT pushed**).
> - **Caching was silently broken/blind on both providers.** OpenAI `cache_read` was hardcoded 0
>   (caching *was* working — 99% hit — but nothing could see it); Anthropic cached only
>   (tools+system) and re-sent the whole conversation **uncached every tool-loop iteration**
>   (now a rolling history breakpoint: round 2 went from re-billing ~15.4k input to
>   `cache_read=15202 / write=233`). **GPT-5 models were 100% unusable** — we sent `max_tokens`,
>   which they reject with a 400, and the provider's blanket `except` swallowed it into a
>   zero-token result that reads as a dumb model.
> - **Cost math was wrong**: ignored caching entirely (overstated OpenAI ~3.2x). The two providers
>   report cached tokens with **opposite semantics** — OpenAI nests them inside `input_tokens`,
>   Anthropic keeps them disjoint. Branch on **model name**, never `cache_write>0`
>   (memory `prompt_cache_accounting_two_provider_shapes`). GPT-5 price rows added.
> - **Live-verified in-platform on 206:** turn1 `cache_read=0` → turn2 `cache_read=11136` of
>   `11227`, cost $0.028→$0.015.
> - **Model A/B (box-free, `scripts/eval_model_ab.py`, now reports cache hit-rate):**
>   **gpt-4.1-mini 15/15** · gpt-5.4-mini 12/15 · gpt-4o **9/15** · gpt-5.4-nano 4/15.
>   4o and 5.4-mini both fail `no_halluc` 0/3 (the confabulation guard). Default moved to
>   **gpt-4.1-mini** in `info.json` + `install_to_fsr.py`.
> - 🔴 **OPEN (user-owned):** that default only affects **newly created** configs. The boxes
>   still run **gpt-4o**. **User said they will update the connector config.** Verify by driving
>   a `chat_turn` and reading `usage.model` — do NOT infer from `info.json`.
> - **RESOLVED:** the `fsrpb-frank` default-clobber-on-every-ship gotcha (deploy now leaves the
>   manual default untouched and never installs frank). That memory entry is updated.
> - Also repaired 10 pre-existing stale tests (6 turn-context goldens vs the shipped GROUND-TRUTH
>   block, 3 `end_turn`→`awaiting_playbook_offer` from the Phase 2.4 salvage, 1 magic-number
>   prompt-length assert). Suites: connector 629 pass, framework 752 pass.

> **▶ 2026-07-21 (session 4a) — SOC-agent "not intelligent" root-caused + connector-wide fix SHIPPED 0.4.92 on 206.**
> Detail: memory `resume_2026_07_21_soc_agent_intelligence` + `soc_agent_smartness_eval_and_repro`.
> - **Root cause (live-reproduced in the real widget):** the agent presents a record's
>   embedded EXAMPLE/sample data as REAL results. On a `ztpf_metadata_sources` page,
>   "what interfaces were created in the last run group?" → 0 tool calls, recited
>   `exampleOutput` port1..port4 (fake IPs) as fact. NOT an entity-plumbing bug (proved
>   live the widget sends the correct `entity.module`; `viewPanel.modulesDetail` params
>   resolve correctly).
> - **Fix (connector-wide, every intent + persona — NOT one persona):** (1) `_entity_context_block`
>   fences+labels `example*/sample*` fields "ILLUSTRATIVE — not live"; (2) `_CONNECTOR_INVARIANT_RULES`
>   appended to EVERY turn's prompt unconditionally (never cite example as real; tool-verify
>   factual/live claims; don't guess); (3) `get_record full=True` over-cap → pruned projection
>   not a byte-chop; (4) `SearchModuleRecordsArgs` coerces list-form `filters`. Tests
>   `tests/test_ground_truth_hardening.py` (22) + 171 suite green.
> - **SHIPPED 0.4.92 → 206** (all 10 workers recycled, warmup clean). **Live-verified via eval
>   harness `scripts/_soc_agent_eval.py`:** reproduced follow-up now **2/2 calls `run_playbook`**
>   + "must verify real live data" (was 0 tools + port1..port4 as fact).
> - **FIXED the frank-default gotcha:** deleted `fsrpb-frank` from 206 + promoted `fsrpb-live`
>   (OpenAI/gpt-4o/api.openai.com) to DEFAULT (clobber-safe PUT); verified default chat_turn → gpt-4o,
>   no fortilab error. **`deploy.sh` fixed** to stop installing/defaulting frank (leaves the manual
>   default untouched). `deploy.sh` change UNCOMMITTED.
> - **OPEN:** (a) **model A/B simulated LOCALLY** via connector harness `scripts/local_turn.py`
>   (`make local-turn`; no box needed) — extend with `--llm openai/anthropic`. **PRIMARY compare:
>   GLM 5.2 (local, OpenAI-compat endpoint) vs Claude Haiku 4.5** — user runs GLM 5.2 locally + expects
>   it to beat live gpt-4o. gpt-4.1-mini = secondary (needs real OpenAI key). eval-harness `--expect-model`
>   validates routing; grade by pass-rate+cost. Post-clear TASK: search WIDER for an OpenAI key (Keychain,
>   1Password, other repos, shell history — not just env files; frank key = fortilab gw, not api.openai.com;
>   real key only in box `fsrpb-live` ciphertext).
>   (b) **baseline (no-persona) intelligence** — don't require a per-module Key Store persona to be
>   smart (user's key point; 4 personas exist: ztpf_templates/_automation_profiles/_devices/_metadata_sources).
>   (c) relationship-query self-correction in `search_module_records` (0-row `field="uuid"` free-text).
>   Connector 0.4.92 + deploy.sh changes **uncommitted**.

> **▶ 2026-07-20 (session 3p) — soc-401 fix completed (API-KEY) + box-proven on 206.**
> Plan: **`docs/plans/stability-and-scalability-plan.md`** (§3A).
> - **Root cause reconfirmed from the gateway source on-box** (not just the connector docstring):
>   `/opt/mcp-server/app/fsr_app.py` `FortiSOARApp.__init__` → `headers={'Authorization': self.auth_value}`
>   and **replays it verbatim** on downstream `/api/3`. `core/auth_service.py` accepts an
>   `Authorization` that is a Bearer token **or an API-KEY**. So CS-HMAC (signed for `/mcp/soc/`)
>   fails the replay against `/api/3` → 401; any **non-URI-bound, user-mapped** credential works.
>   (The 0.4.87 "identity only on bearer" framing was imprecise — it's URI-binding vs verbatim replay.)
> - **Shipped the API-KEY path (connector 0.4.89 → 0.4.91 on 206):** `_live_mcp.build_client(soar_api_key=…)`
>   sends static `Authorization: API-KEY <key>` (no mint/TTL); priority api_key > bearer > hmac. New
>   `soar_api_key` config field. 2 new unit tests. Added diagnostic op **`probe_native_mcp`**
>   (`server`/`tool`/`args` + `api_key` param override + `schemas`).
> - **Credential:** FortiSOAR api-key user via pyfsr (`api_users.create` + `api_keys.create`,
>   role SOC Analyst, team SOC Team); reads `/api/3/indicators` → 200.
> - **BOX-PROVEN on 206 through the real localhost:8010 gateway, worker context** (driven via the
>   connector API against a fresh `fsrpb-apikey-proof` config — no SSH, no password, no clobber):
>   HMAC (`fsrpb-frank`/`repro-openai`) → `soc.get_indicators {"values":["8.8.8.8"]}` **401**;
>   API-KEY (`fsrpb-apikey-proof`) → same call **`status:success`**, real hydra Indicator collection.
>   `list_tools` passes on HMAC too (same URI) — only the downstream fetch 401s.
> - **⚠️ Api-key auth 400s "invalid URL" on 159** (per-box api-key URL-scoping) but is clean on 206 —
>   so the api-key user needs unrestricted URL scope; bearer (user+password) is the fallback.
> - **OPEN:** (a) the full LLM `chat_turn` proof (agent *decides* to call the tool) still needs a
>   config with a reachable LLM + `soar_api_key` — set it on `fsrpb-live` (has the Anthropic key) via
>   UI, or reuse `fsrpb-apikey-proof` with a real key; the adapter/auth itself is now proven.
>   (b) connector 0.4.91 changes are **uncommitted**. (c) Phase 3A breadth (utility/modules/`connector:<name>`).

> **▶ 2026-07-20 (session 3o) — Phase 3A (deeper tools): MCP bridge lit up + soc-401 fixed, shipped to 159.**
> Plan: **`docs/plans/stability-and-scalability-plan.md`** (§3A, RESUME block updated).
> - **Bridge was fully built + shipped but dormant.** The dynamic-tool-surface materializer
>   (`fsr_playbooks/mcp_server/materializer.py`) is in released framework 0.4.34 (live on 159 in
>   connector 0.4.85) and the connector already reads `mcp_allowlist` from config. Live-probing
>   159 found the native gateway healthy (`soc` = 9 cross-product tools: get_alert, block_indicator,
>   enrich_indicator, hunt_ioc_siem, …) but the materializer registered **zero** tools.
> - **Two materializer bugs (framework `1cd6d4d`, released v0.4.35 → connector 0.4.86):**
>   1. pyfsr's **native** `client.mcp.list_tools` returns `MCPTool` pydantic models, but the loop
>      gated on `isinstance(tool, dict)` → silently skipped every one. (On-box CS-HMAC adapter
>      builds dicts, so this bit only the native-pyfsr path.) Fixed via `_tool_field` (dict-or-model).
>   2. Shorthand allowlist values (`{"soc": true}` / `"*"` / list) raised `'bool' object has no
>      attribute 'get'` and aborted ALL materialization. Fixed via `_normalize_rule`.
>   28 materializer tests, 758 framework green. **Bridge now live-proven on 159**: real `chat_turn`
>   on `fsrpb-live` → agent offered + **called** `mcp_soc__enrich_indicator` / `get_indicators`.
> - **But every soc call 401'd — ROOT-CAUSED to the connector (not the appliance):**
>   `soc.get_indicators` from desktop with **admin bearer** auth → success (soc server is healthy).
>   159's `/opt/mcp-server/config.yaml` = `auth_strategy: api_call`; the auth middleware sets the
>   downstream user identity (`current_user_id`) **only** on the `bearer` path. The on-box adapter
>   sent `Authorization: CS <hmac>` whose fingerprint covers URI+verb → carries no forwardable
>   identity → record-fetch / playbook-trigger 401. **Corrects `ga_mcp_soc_401_resolved` memory**
>   (its "resolved" check used bearer auth, so never exercised the HMAC-forwarding path).
> - **Fix (connector `13c73a7` → connector 0.4.87 shipped to 159):** `_live_mcp` **bearer mode**.
>   New optional `soar_username`/`soar_password` config fields → `build_client` mints a FortiSOAR
>   access token (`_mint_bearer` → `/auth/authenticate`, TTL-cached, one 401 re-mint retry) and
>   sends `Authorization: Bearer <jwt>`. No creds → prior CS-HMAC (fine for utility/modules).
>   **Proven end-to-end against 159's real soc server** (`bearer_adapter_probe.py`): bearer adapter
>   → `soc.get_indicators` returns data. 6 hermetic unit tests; connector suite 399 passed
>   (3 pre-existing §2.4 fake-provider failures, unrelated).
> - **`make_request` vs `make_cyops_request`:** `make_request` is real (`integrations.crudhub`,
>   HMAC per-URL); `make_cyops_request` **does not exist** on-box (would be a bad call).
> - **Live on 159 now:** widget 1.2.28 + connector **0.4.87** (framework **0.4.35**).
> - **OPEN:** (a) final integrated agent-turn proof — needs a config with a reachable LLM AND soar
>   creds (Frank/openai unreachable from 159; `fsrpb-live` = Anthropic + allowlist, add soar creds
>   via UI then re-run `chat_turn`); (b) clean up leftover test config `fsrpb-mcp-bearer-test` (id
>   408, openai) on 159; (c) then Phase 3A breadth (utility/modules/`connector:<name>`, .60 bridge).

> **▶ 2026-07-19 (session 3n) — Phase 2 (linchpin) + FULL STACK SHIPPED to 8.0 box 159.**
> Plan: **`docs/plans/stability-and-scalability-plan.md`** (RESUME block updated).
> - **Phase 2 audit correction (verified in code).** Mapped the connector + framework state layer.
>   The plan's Phase-2 premises were STALE — the session-state spine already solves them:
>   - **2.1 (persist grounding/progress/capabilities/phase/guard counters) = ALREADY BUILT.**
>     Grounding cached per `record_key` → preflight skipped w/ continuation directive
>     (`operations.py:2434`); guard counters seed from persisted `Investigation` + sticky
>     `hunt_floor_met` (`_loop_helpers.py:365`); capabilities persist via `note_result`
>     (`:514`, wired w/ persisted `case_state.capabilities` `openai_provider.py:382`); phase via
>     `_advance_phase`; intent via `session_intent` table. **No code needed.**
>   - **2.2 (intent per-turn-aware) = SYMPTOM ALREADY HANDLED.** Capability-gap "Re-check &
>     continue" resolves via **`chat_resume`**: cached grounding + *"resuming an in-progress
>     triage — do NOT restart the hunt"* directive (`operations.py:4233`), no preflight re-run
>     (`:4220`), `capgap_recheck` clears just that connector's guard (`:4148–4246`). Page-pinned
>     `uiIntent` is a **deliberate** widget constraint (no triage→build jump from an alert), not
>     a bug. **No code needed.**
>   - **2.3 (tool-output budgeting) = THE ONE REAL GAP → BUILT + TESTED.** `shrink_history` only
>     deduped identical read-only calls + capped old yaml *arg* bodies; a single large *result*
>     (`verify_playbook` ~47KB, dup-enrichment ~40KB) sailed through uncapped → long chains blow
>     context. Added a 3rd pass: oversized `tool_result` bodies clipped head+tail, freshest kept
>     full, deterministic fixed point. `test_shrink_history_result_cap.py` (4) + full framework
>     suite **741 passed**. (framework `e860ea7`)
>   - **2.4 (unify build-completion via `emit_playbook_offer`) = the only remaining Phase-2 code
>     item** (soft reliability gap — tool exists + is prompt-advertised; free-form "design a
>     playbook" can still dead-end in prose).
> - **SHIPPED the full stack to 159** (`fsr8`, 10.99.249.159, 8.0 GA — **206 still down**, 168
>   lacks `/api/ai/*`):
>   - **Widget `1.2.28`** via `make ship-verify` (lint→typecheck→unit→mock-e2e→introspect-gate→deploy;
>     no live-sweep is defined for this widget). uuid `891fd3ae…`. (widget-repo `d6157f7`)
>   - Fixed a **Phase-0 gate-wiring bug** en route: `seamHermetic.spec.js` needs the hermetic
>     sidecar that only `make turn-hermetic` starts, but the general mock-e2e gate globbed it →
>     `seamc_sidecar_unreachable` red'd ship-verify. Now **self-skips when `FSRPB_SEAMC_URL` is
>     unset**. (Would have red'd every ship-verify of this widget.)
>   - **Framework `fsr-playbooks v0.4.34`** released to PyPI (`make release`; publish workflow green)
>     → `make bump-framework` (symbol preflight OK, 66/25) → **connector `0.4.84`** on 159, all 7
>     workers recycled + warmup re-synced (36 conn/464 ops). (connector `f82ebd0`)
>   - **v0.4.34 also carried the user's uncommitted `ApprovalManualInput` WIP** (5 files: parser
>     accepts+hoists `is_approval`, normalizer re-points step type to `ApprovalManualInput`,
>     decompiler, AUTHORING.md, tests — complete + passing). Committed authored as the user
>     (`8daaf43`) since release requires a clean tree and the feature was ready.
> - **Live on 159 now:** widget **1.2.28** + connector **0.4.84** (framework 0.4.34, §2.3).
> - **Gotchas captured:** `make ship-verify` hardcodes `FSR_ENV_FILE=…/.env` (line 123) — to ship
>   to a non-default box, point `.env` at it (the `.env.<box>` sidecar files aren't read by
>   ship-verify). `fsr8`/`fsr159` = **10.99.249.159** (not .250.159). Framework pre-commit
>   fast-subset has pre-existing **test-order pollution** (2 tests pass in isolation; `make tests`
>   release gate is clean) — not a real failure.

> **▶ 2026-07-19 (session 3m) — Stability & Scalability push: audit → plan → Phase 0 spine started.**
> Plan: **`docs/plans/stability-and-scalability-plan.md`** (the durable home for this thread).
> User directive: "focus on stability and scalability of the widget and connector." Scoped with
> the user — **stability** = state/session correctness + basic functionality not fully vetted;
> **scalability** = feature breadth toward the end-stage (co-equal SOC copilot + authoring IDE;
> deeper tools / richer cards / more autonomy). Method: audit first, then plan.
> - **Audit (3 parallel, read-only):** (a) connector session/state code is SOLID — every historical
>   bug fixed; the gap is that the full session lifecycle is UNTESTED (cross-worker resume, corrupt
>   state, concurrent-turn minting). (b) widget has 4 real HIGH bugs: YAML-fence extractor can
>   silently truncate a playbook on deploy; no message dedup (export/audit double-count);
>   connector-resolution cache never recovers from a 404; messages `track by $index`. (c) session-
>   state depth is the linchpin for BOTH halves (durable case-state = correctness fix + autonomy
>   substrate). Roadmap docs are STALE (C2 update_playbook / C5 build-scoping are done, not open).
> - **Plan = 4 phases:** 0 vet-the-basics (consolidate the 5 existing harnesses; NOT greenfield) →
>   1 widget HIGH fixes → 2 session-state depth (the pivot) → 3 feature expansion (deeper tools /
>   richer cards / autonomy) → 4 structural (split monoliths, pydantic, Postgres audit, SSE).
> - **Phase 0, connector-first, spine-first (user's calls):** mapped the real testing surface —
>   `local_turn.py` (in-process, swappable LLM/persona/tools; the hub), `eval_harness`+`eval_s*`
>   (live oracle), framework `chat_drive`/`scoring`, widget Playwright hermetic + live matrix. The
>   ONE real gap = **Seam C**: nothing drives the real widget controller against real `operations.py`
>   with a mock LLM. Five harnesses = five verdict dialects sharing ZERO codes.
> - **✅ 0.2 shared verdict registry BUILT + tested (uncommitted):** `scripts/verdict_registry.json`
>   (canonical codes, every framework gate + widget red-flag + eval prose aliased in) + `scripts/verdict.py`
>   (pydantic `Finding`/`Verdict`, 3 adapters `from_framework_score`/`from_widget_grade`/`from_checks`,
>   soft/strict/xfail `rollup` ported from the widget gate ladder). `tests/test_verdict_registry.py`
>   **48 passed** — completeness guard (no unmapped grader term), adapters, rollup ladder. Additive
>   only; rewrites no harness.
> - **✅ 0.1 shared scenario schema BUILT + tested (uncommitted):** `scripts/scenario.py` (pydantic
>   `Scenario`+`Expectations`; one superset of matrix rows / chat tasks / native form; adapters
>   `from_matrix_row`/`from_chat_task`; `to_local_turn_kwargs()` maps onto the hub; red-flags
>   canonicalize through the verdict registry) + `scripts/scenarios/example_triage.json`.
>   `tests/test_scenario_schema.py` (15, incl. a REAL-spine integration drive: Scenario →
>   `local_turn` fake-LLM → 38-tool slice/31KB prompt → verdict rollup). New `make spine-test`
>   runs 0.1+0.2 together: **63 passed**. All additive — no existing harness rewritten.
> - **✅ 0.5 session-lifecycle tests BUILT + a REAL bug fixed (uncommitted):** `tests/test_session_lifecycle.py`
>   (8) closes the audit's untested corners — full lifecycle as one flow (open→reserve→conversation→
>   card→suspend→pop→next) verified cross-instance (cold worker); **concurrent `reserve_next_turn`**
>   under real thread contention (6×15, separate Storage instances → no shared lock) mints no
>   duplicate turns (BEGIN IMMEDIATE holds); patch_proposal card recoverable by `proposal_id`
>   cross-worker. **Found + fixed a real bug:** `load_conversation` AND `get_card` did a bare
>   `json.loads` (no guard) → a corrupt/half-written row **crashed the resume turn**; now fail-soft
>   ([]/None) matching `get_case_state`. Tests went RED first, then green. **Full connector root
>   suite: 394 passed / 21 skipped / 0 failed** (71 new tests this session, no regression).
> - **✅ 0.4 Seam C DONE — `make turn-hermetic` green (real widget ↔ real connector, box-free).**
>   The big reframe: the plumbing already existed. The harness's `local-connector-sidecar.py` runs
>   real `operations.py` in-process and the harness forwards `/api/integration/execute` to it under
>   `FSR_LOCAL_CONNECTOR=1` — but as the *live* loop (real LLM gateway + live pyfsr reads). Seam C's
>   only real gap was the two **hermetic seams** the connector's own `scripts/local_turn.py` already
>   implements. Added `FSRPB_SIDECAR_HERMETIC=1`: the sidecar **imports** (never reimplements)
>   `local_turn._install_fake_provider` + `_CassetteClient` + `_cassette_rules` → real `operations.py`
>   against a **fake LLM + cassette reads**, box-free, no LLM credits. Widget side: new e2e
>   `fortiaiAgenticAssistant.seamHermetic.spec.js` boots the real widget `&real=1` and **forwards**
>   the intercepted execute call to the hermetic sidecar (vs the usual static fixture), so the real
>   controller drives real connector logic. New Makefile target **`make turn-hermetic`** boots the
>   sidecar → runs the spec → tears down (verified: sidecar killed on exit). **1 passed (8.6s)** — a
>   real `chat_turn` ran persona resolution + prompt assembly + envelope shaping and rendered in the
>   widget timeline with ZERO box. All in THIS repo (parent `fsr_all_widgets`: Makefile + harness
>   sidecar; the widget spec is in the nested `widget-fsr-soc-assistant` repo). The connector's
>   `local_turn.py` was only imported, not modified. _(Follow-up: script tool-using fake turns to
>   exercise cards; today the fake turn is a single end_turn text — enough to gate the contract.)_
>   User's Frank note captured: the sidecar's non-hermetic path already uses Frank (local
>   OpenAI-compat gateway) as a free real-LLM seam; hermetic uses the zero-dependency fake.
> - **✅ 0.3 shared cassette format + 0.6 acceptance checklist DONE → Phase 0 COMPLETE.** 0.3: one
>   cassette JSON (`{"reads":[{"match","body"}]}`) in `local_turn`'s rule shape feeds BOTH the Python
>   hub (`extra_reads`) and the widget-facing hermetic sidecar (`FSRPB_SIDECAR_CASSETTE`, appended
>   after the persona fixture); example `scripts/cassettes/example_alerts.json`; verified the sidecar
>   loads it and a hermetic turn still runs green. 0.6: `docs/acceptance-checklist.md` — every row
>   tagged `hermetic` vs `live`, with a recorded-passes table (the one live run is box-gated).
>   Follow-up carried forward: scripted-tool fake turns so the hermetic tier exercises tool cards
>   (unlocks 0.3's read payoff).
>
> **▶ 2026-07-19 (session 3m cont.) — Phase 1 widget HIGH fixes SHIPPED to the tree (widget 1.2.27, `c1ebb55`).**
> All four audit HIGH bugs fixed, each with tests; full widget unit **66 suites / 756 passed**, smoke+rendering
> e2e (incl. `history_rehydrate`) **20 passed**. Committed in the nested `widget-fsr-soc-assistant` repo.
> - **1.1 YAML-fence truncation (data corruption):** the old `([\s\S]*?)```` stopped at the FIRST
>   ``` anywhere, so a ``` INSIDE the YAML (mid-line string, description, embedded example) clipped
>   the playbook and Save compiled the clipped copy OVER the record, deleting steps. Fix: shared
>   `_extractLastYamlFence` with a **line-anchored** close (an inline ``` can't clip) + a **stateless
>   fail-closed save guard** that refuses YAML still holding a standalone ``` line. Both fence scans
>   (live + rehydrate) use the one helper so they can't drift.
> - **1.2 Message dedup (audit integrity):** the turn-level idempotency guard only fires when
>   `result.turn != null`; a null-turn transcript / poll-vs-late-return race slipped past and
>   double-counted tool calls. Fix: dedup assistant commits by globally-unique `tool_use` id (a re-commit
>   carries an id already on the timeline → drop it). Centralized in `_appendAssistantMessage` so the
>   rehydrate path is covered too.
> - **1.3 Connector-resolution self-heal:** a cached SUCCESSFUL resolution goes stale on a mid-session
>   connector redeploy/rename/reconfig → every later call 404s until reload. Fix: `_dispatchReal` drops
>   `_resolved` and re-resolves ONCE on a stale-resolution error (404 / unknown-connector / bad-config).
> - **1.4 Stable message track-by:** the messages ng-repeat `track by $index` bled card state across a
>   history rebuild by position. Fix: stamp a monotonic per-message `_key` lazily in `chatMessages()`
>   (covers every creation path) + `track by (msg._key || $index)`.
> - **🔜 NEXT:** ship 1.2.27 to a box (`make ship-verify`) when a window opens + record the 0.6 live
>   acceptance pass; then Phase 2 (session-state depth — the linchpin). Optional Phase-1 mediums (1.5)
>   remain. Nothing shipped to a box this session; parent-repo Phase-0 work + widget-repo Phase-1 both
>   committed to their trees, unpushed.

> **▶ 2026-07-19 (session 3l) — patch_proposal ACCEPT/APPLY: BUILT + tested, uncommitted/unshipped.**
> The emit_patch_proposal PROPOSE half shipped (0.4.79); this closes the APPLY half — the
> `apply_patch` reply-tool resume dispatch that applies the card's `after_yaml` to the open playbook.
> - **Connector `_resume_apply_patch`** (`operations.py`): on a patch_proposal accept the connector
>   recovers the card's FULL (uncapped) `after_yaml` from storage, compiles it, and applies it via
>   `update_playbook` — the same snapshot-first, fail-closed Save path the designer's own ```yaml fence
>   uses. Splices a deterministic `apply_patch` tool_use/tool_result + an analyst-facing summary
>   (outage-survivable; no model round-trip). Honest failure reporting (compile-fail is fail-closed;
>   update-fail surfaces the code, playbook unchanged). Routed in `chat_resume` on `reply_tool` BEFORE
>   the action_card path; degrades to conversational resume for a non-patch card.
> - **Persistence gap fixed:** `patch_proposal` was not in `_persist_session_state._GATE_TYPES`, so the
>   card (with `after_yaml`) was never stored → unrecoverable on resume. Added it; `storage.save_card`
>   now falls back to `proposal_id` for the key (patch cards use `proposal_id`, not `id`), matching the
>   id the widget resumes with (`normalizePatchProposal`).
> - **Widget:** `acceptPatchProposal` sends `reply_tool` + the open playbook's `workflow_iri` at the
>   resume params TOP level (chat_resume carries no entity, contract §4). `_runResumeAction` gained an
>   `extra` merge; new `_openPlaybookIri()` helper (module==='workflows' guarded) shared with Save.
>   `ChatResumeParams` typed `reply_tool`/`workflow_iri`/`workflow_uuid`.
> - **Tests:** connector `tests/test_apply_patch_resume.py` (7: recover→compile→update chain, uncapped
>   after_yaml, missing-iri/failed-update honesty, compile fail-closed, non-patch degrade, persist +
>   save_card id fallback, chat_resume routing). Widget e2e
>   `fortiaiAgenticAssistant.applyPatchResume.spec.js` — route-intercepted in **playbook-designer
>   context**, asserts the wire chat_resume carries `reply_tool='apply_patch'` + `workflow_iri`
>   containing the open playbook uuid. Widget unit **748 passed**; patchProposal(3)+applyPatchResume(1)
>   e2e green; connector root suite 318 passed (8 pre-existing/environmental fails, baseline-confirmed).
> - **🔜 NEXT to go live:** the build prompt does NOT yet advertise `emit_patch_proposal` (deferred
>   until apply landed — it just did). Advertise it (framework release → connector pin → `make ship`),
>   then box-prove the accept applies. Until then the card is reachable but the agent won't proactively
>   emit it. Nothing committed/pushed/shipped this session.

> **▶ 2026-07-19 (session 3k) — P5 S3 (connector-action playbook): OUTPUT-PATH DEFECT SOLVED + shipped; residual is stochastic discovery noise.**
> Built `eval_s3_connector.py` (dual oracle: a real connector step invoking
> `cyops_utilities/convert_periodic_time_to_minutes` with the asked input AND the record field is a
> Jinja ref to its output, not a hardcoded literal; + behavioural: run → alert description == "180").
> Three lever-ships took the box rate 0/3 → 1/3 → 2/3 → 2/5:
> - **Ship-1 (fw 0.4.31 / conn 0.4.79):** compiler param-hoist (connector step's top-level `params`
>   now hoisted into `arguments:` like `connector`/`operation`) + `.data`-envelope grounding fix
>   (`get_step_type('connector')` + validator: a connector result is `{data, status, message,
>   operation}`, op fields at `vars.steps.<name>.data.<field>`).
> - **Ship-2 (fw 0.4.32 / conn 0.4.80):** the deterministic output-path lever the user chose (A+B):
>   **A** compile-time auto-correct rewrites `vars.steps.<connstep>.<x>` → `.data.<field>` when
>   unambiguous (real subkey, or `.result`/`.outputs` on a single-output op), on the always-taken
>   Deploy compile path; **B1** pure-compute verbs (convert/parse/format/…) classify op_safety 'safe';
>   **B2** safe live-probe default-on in build verify (double-gated: walker op_safety=='safe' + run_op
>   refuses non-safe categories w/o confirm → no mutating op runs).
> - **Ship-3 (fw 0.4.33 / conn 0.4.82):** config-less-connector grounding — `find_connector` returns
>   `config_required` + a note that config-less utilities are usable with `config: ''` and won't appear
>   in `list_configured_connectors` (the model had misread `config_count=0` as "unavailable").
> - **Verdict:** the output-path defect the eval existed to catch is FIXED deterministically (runs
>   reliably author `.data.minutes` when the model wires the step). The residual 2/5 is the box gpt-4.1
>   model's discovery/comprehension unreliability for a deliberately-obscure utility op (can't find it →
>   declares it nonexistent; or `.data`-whole-dict) — diminishing-returns stochastic noise, the S6
>   lesson at full strength. **Grade the defect (solved), not the symptom. Next: S4 / S8.**
> - Framework releases 0.4.31–0.4.33 committed + pushed (tests: connector_step_envelope,
>   probe_op_safety, verify_live_probe_default, connector_config_required). Connector commits scoped to
>   pin+version only (a parallel session's patch_proposal WIP left uncommitted, but baked into the box
>   build). Detail: `docs/plans/build-persona-validation-plan.md` RESUME + `s3_connector_step_envelope_and_params` memory.

> **▶ 2026-07-18 (session 3j) — P5 S6 (apply the fix so a failed playbook runs): SHIPPED + BOX-PROVEN 3/3 on 206.**
> Started as a "close to free" eval; the box turned it into a real fix. Chain of findings:
> - **S6 can't reuse S5's fixture.** S5's bug (`resource:` outside `arguments:`) is destroyed at
>   compile time, so the fix can't recreate the record deterministically (the model must invent a
>   body; 1/3 flaky). New anchor `broken_create_record_missing_module.yaml`: body intact, only
>   `module:` missing → the fix is structural.
> - **A prose prompt rule alone doesn't move the box model.** Shipped a build-prompt fix (framework
>   0.4.30: diagnose-before-fix moved OUT of the chip-gated quick-action section into the always-on
>   open-playbook section). In-process (Frank GLM-5.2) 3/3; **on the box 0/3** — the box `chat_turn`
>   uses the connector's configured LLM (gpt-4.1-class), which ignores the prose and confabulates an
>   `ALPHA`→`BRAVO` rename found nowhere in prompt/seed. **Lesson: the in-process eval proxy ≠ the
>   box model; a green in-process run does NOT prove box behavior.**
> - **Fix = a deterministic, transparent CONNECTOR lever** (chosen by the user over aligning the box
>   model). `operations._maybe_inject_failure_diagnosis`: on a build turn reporting a runtime failure
>   on the OPEN playbook, the connector runs `why_did_playbook_fail` ITSELF and folds the failing
>   step + cause into the turn — model-agnostic, and saves prompt context. **Transparent:** streams a
>   visible `activity` frame ("Checking why the last run failed…" → the failing step) like the triage
>   preflight, so the analyst sees the connector consult the failed run.
> - **The gate bug the box caught:** `why_did_playbook_fail` returns `ok=False` for a SUCCESSFUL
>   diagnosis of a FAILED run (`ok` = "run healthy"); gating on `ok` silently discarded every real
>   diagnosis (lever fired but never injected). Fixed to gate on a resolution `code` + content.
> - **Oracle is rename-proof:** the box model rewrites the record body regardless of the prompt, so
>   S6 grades a uuid-diff (the fixed run creates a record the broken run didn't), not a specific name.
> - **Shipped:** framework **0.4.30** (PyPI, pushed), connector **0.4.78** on 206 (workers verified).
>   S6 **3/3 live** — incl. a run where the model called no diagnosis tool itself yet still fixed the
>   module, because the connector injected the diagnosis. Commits: framework `f0172a7` (pushed);
>   connector `f0172a7`… `29f0fa5` (LOCAL, ahead 9 of origin). Tests: 16 lever unit + build-prompt
>   skeleton regression. Gotcha: a box connector install hung ~53min once (transient); killing it
>   left workers wedged — recovered via a direct `install_to_fsr.py` (5s). **Next: S3/S4/S8.**
> - _(prior)_ P5 S5 SHIPPED + box-proven (framework 0.4.29 / connector 0.4.75); see below.

> **▶ 2026-07-18 (session 3h) — P5 S5 (troubleshoot a broken playbook): SHIPPED + LIVE-PROVEN on 206.**
> The build persona can now diagnose why a run failed. Getting there, the validation caught a
> **3-layer latent defect** — the whole runtime-troubleshooting stack was dead in this connector:
> - **Exposed `why_did_playbook_fail` to the build LLM slice** (framework `tools.py` + build prompt
>   `find_issues`): the slice had `diagnose_yaml_against_pb_execution` + `get_run_env` but no way to
>   DISCOVER the failed run. Chosen over widget-seeding (it's a slice gap, not missing content).
> - **L1** — `why_did_playbook_fail` imported a non-existent `fsr_playbooks.mcp_server.tools_triage`
>   → `no_investigation_tools` on every live box. Fix: framework `set_failed_run_provider` hook; the
>   connector's `register_triage_tools()` supplies `list_recent_failed_runs`.
> - **L2** — it AND `diagnose_yaml_against_pb_execution` (the supposed "working last link" — equally
>   dead) called `tools_triage.get_run_env`, absent here. Fix: use the library's own `get_run_env`.
> - **L3** — `get_run_env` reimplemented the fetch with RAW calls + an `isinstance(data, dict)` guard
>   that broke on pyfsr's typed `RunSummary` → "unexpected response type". Fix: **delegate to pyfsr's
>   typed `playbooks.run_env()`** (per the user's pyfsr-first directive — no raw endpoints).
> - **Enrichment** — surface the RUNTIME step error (not just jinja diagnostics) via pyfsr
>   `why_failed()`; `why_did_playbook_fail` now returns `failing_step` + `error_message`.
> - **pyfsr enhancements** (committed, tested; NOT in the ship's critical path — used `why_failed`
>   already in released 0.11.0): new typed `run_failure(run)` (by-run counterpart to `why_failed`) +
>   `RunEnv.name`. +3 unit tests.
> - **Validated:** Frank/GLM-5 half-live eval (`scripts/eval_s5_diagnose.py`, in-process editable
>   framework + live 206) 3/3 then 2/2 with the strict run-grounded assertion; **box probe PASS on
>   shipped 0.4.75** (`_s5_whyfail_box_probe.py`, no LLM): `failing_step='Emit'`, `error_message=
>   'insert_data() takes at least 2 positional arguments (1 given)'`.
> - **Shipped:** framework **v0.4.29** (PyPI, main+tag pushed); connector **0.4.75** on 206 (10 workers,
>   warmup ok). Commits: pyfsr `a18f643`, framework `5b6c8fb`, connector `a0bb403`+`e68deda`
>   (connector/pyfsr LOCAL — box got it via `make ship`). Lesson reinforced: **the box is the truth**
>   — every unit test was green while the tool had never worked once on a live run.
> - **NEXT:** S6 (apply the fix → it runs), then S3, S4, S8. Two known non-blockers: `why_did_playbook_fail`
>   Step-2 decompile fallback needs the framework's `tooling/cli` (absent in the connector runtime) —
>   moot on the real path since the widget always supplies `entity.playbook_yaml`; and pyfsr
>   `run_failure`/`RunEnv.name` await a pyfsr release to be usable on-box (framework uses `why_failed`).

> **▶ 2026-07-18 (session 3i) — SOC assistant widget UI gaps + hardening plan.**
> Lane A pivots onto the assistant widget's own UI. Full plan + backlog:
> `docs/plans/soc-assistant-ui-gaps.md` (3 parallel UI audits synthesized into
> workstreams A/B/C, plus **B0** — a user-reported functional bug: *info_card
> blocks show up at odd times and overwrite other tools/content*).
> - **B0 lead root cause:** the streaming preview rebuilds `msg.events` every ~700ms
>   and the timeline tracks by `(ev._toolUseId || $index)` (`view.html:1698`) — only
>   tool_calls have a stable id, so info_cards/activity/text fall back to positional
>   `$index` and get reused onto the wrong slot as tool frames interleave between
>   polls; compounded by idless cards getting a per-rebuild `cardId` (`fsrPbRender.ts:683`).
>   Fix: stable per-event `_key`, track by it. **← IN PROGRESS.**
> - Order: B0 → A1–A4 (card in-flight/error/validation) → B1/B2 (auto-scroll, focus)
>   → C1–C4 (render robustness) → a11y/theme/polish. Each ships with tests.
> - **🟢 MERGE POINT committed — widget `41cb5be` ("Lane A merge point … 1.2.25"), all green.**
>   The interleaved widget tree (B0 + patch_proposal + F1 seed + the manual_input WIP)
>   is now ONE clean commit, so widget commits stop stacking as done-uncommitted.
>   - **B0 DONE** (stable per-event `_key`, `track by ev._key`) — 4 jest + rendering e2e.
>   - **manual_input WIP COMPLETE + tested** (A3 done): required-field validation at
>     parity with action_card — `required` through `normalizeManualFields`, pure
>     `manualInputComplete` gate (dynamic_list needs group+item; required checkbox
>     checked; others non-empty), required stars, submit-gating + hint, typed
>     `ManualInputField` in contract. +6 jest + new e2e gating case.
>   - Full unit **735 passed**; e2e rendering/manualInput(4)/patchProposal(3)/smoke(14) green.
>   - Handoff updated (`scratchpad/LANE_B_BACKEND_HANDOFF.md`): Lane B should rebase/
>     discard any local widget-side manual_input copy — it's in this commit now.
>   - Remaining Lane A: A1/A2/A4 (card in-flight + error recovery), B1/B2, C1–C4.
>
> **▶ 2026-07-18 (session 3h) — Two-agent lane split (Frontend / Backend) + patch_proposal contract.**
> Agentic-assistant work partitioned so two agents don't collide (handoff:
> `fortisoar-widget-harness/scratchpad/LANE_B_BACKEND_HANDOFF.md`).
> - **Lane A (Frontend — widget + harness):** this session. Introspection DOM/style
>   diffing was already DONE 2026-07-12 (STATUS was stale). **✅ `patch_proposal`
>   chat-card renderer BUILT + tested (uncommitted):** contract in `contract.d.ts`;
>   `normalizePatchProposal` in `fsrPbRender.ts` (+compiled .js, tsc strict clean);
>   `acceptPatchProposal`/`rejectPatchProposal` in `view.controller.js` (resume via
>   chat_resume keyed on cardId, tier≥3 badge); before→after diff block in
>   `view.html`; fixture `patch_proposal_demo.json`; jest `patchProposal.test.js`
>   (5 cases) + e2e `fortiaiAgenticAssistant.patchProposal.spec.js` (3 cases, green);
>   full unit suite 716 passed. **✅ emit_patch_proposal EMITTER BUILT (local,
>   2026-07-18) — propose half done:** framework `emit_patch_proposal` tool
>   (fn+schema+pydantic gate+tier0+`BUILD_ONLY_TOOLS`; framework `e306d18`, +5
>   tests) and connector wire-map (`_CARD_EMITTER_TO_TYPE`/`_CARD_STOP_REASON` →
>   `awaiting_patch_proposal`; connector `df1d390` = 0.4.79, +4 splice tests). The
>   build agent can now emit the card, which renders (C4-hardened) and halts the
>   turn; reject works client-side. **STILL OPEN:** the accept path — the
>   `apply_patch` reply-tool resume dispatch that applies the after_yaml to the
>   open playbook (reuses `update_playbook`). Not prompt-advertised yet (would
>   produce failing accepts until apply lands). Unshipped/unpushed.
> - **✅ TS-linter `enablefor` state-match BUILT + tested (uncommitted):** new rules in
>   `scripts/lint-angular.ts::checkInfoJson` — `enablefor-page-label` (error: a marketplace
>   page label like "Dashboard"/"View Panel", or any space-containing entry, can't match
>   `$state.current.name`), `enablefor-bare-state` (warning: dot-less segment), and
>   `enablefor-entry-not-string`. KB §18.4-grounded: does NOT flag missing/empty enableFor
>   (that legitimately means "always visible"), no closed state allowlist (any UI-Router
>   state is valid). 4 new jest cases in `tests/lintAngular.test.js`; suite 720 passed;
>   zero false positives across real widgets.
> - **✅ config-defaults AST-accuracy DONE (uncommitted).** R2 (`checkConfigDefaultsBeforeAccess`)
>   rewritten on a real `acorn` AST: `config-access-before-defaults` is now judged per **function
>   scope** — a `$scope.config.X` read only counts as "before the guard" when it lives in the SAME
>   function scope as the guard assignment and precedes it, so a read inside a later-invoked handler/
>   `$scope` method above the guard no longer false-positives. Missing-guard (`config-defaults-missing`)
>   stays a nesting-independent whole-file check. Regex heuristic kept as a parse-failure fallback
>   (linter stays lit on exotic/partial sources). `acorn`+`acorn-walk` added as devDeps. 5 new jest
>   cases (before/after guard, later-invoked-fn no-flag, missing-guard-any-nesting, comment-ignored);
>   suite 13 green; tsc clean; full-fleet lint has **zero `config-access-before-defaults`** and the
>   same 2 genuine `config-defaults-missing` findings as before (no regression). This clears the last
>   Lane-A linter item.
> - **✅ Orphaned-tooling audit + ship-verify wiring (uncommitted).** Found that
>   `ship-verify`'s lint step ran only the harness-server `HU.lintWidget` (info.json/
>   controller-name/files) — the RICHER standalone `lint-angular.js` (config-defaults,
>   drawer-standalone, copyright-header, the new enableFor rule) and `lint-testids.js`
>   were reachable ONLY via `pnpm lint`, which no make target / CI / git-hook invoked.
>   `introspect-gate` was also never in the pipeline. **Fix (Makefile + introspect-gate.ts):**
>   `ship-verify` now runs server-lint + angular-lint + testid-lint + typecheck (step 1),
>   unit, mock-e2e, then a **per-widget-scoped `introspect-gate`** (new optional `<widget>`
>   filter arg → `GATE_WIDGET`; a single-widget ship no longer blocks on unrelated widgets'
>   stale baselines), deploy, live-sweep. `SKIP_INTROSPECT=1` escape hatch (gate renders the
>   full fleet, ~2.8 min). Verified: scoped gate PASSes fortiaiAgenticAssistant, FAILs counter
>   in isolation; recipe dry-run clean. **Note (unrelated, pre-existing):** `counter`,
>   `dataVisualization`, `myWidget` currently regress the fleet-wide gate (stale baselines /
>   real drift) — needs re-baseline, separate from this work. Widget also has 7
>   copyright-header-missing warnings (Content Hub rejects) — pre-existing, non-blocking.
> - **🔴 Backend orphans handed to Lane B** (in handoff doc): connector
>   `scripts/validate_connector.py` (contract self-test T1–T12, "run before every release
>   tag") is wired into NOTHING — no make target/CI; offline subset should gate `make build`/
>   `ship`. Framework `shape-contract-ratchet` pre-commit hook lacks a `pre-push` stage.
> - **Lane B (Backend — framework + connector):** other agent. P5 matrix S5→S6,
>   materializer Phase 4, `emit_patch_proposal` emitter, custom-module personas.
> - **Shared-resource rules:** one live-box window at a time (announce here); each
>   lane appends its own dated bullet, never rewrites the other's; framework→connector
>   release sequencing is Lane B's alone.
> - **🔗 CROSS-LANE CONTRACT — `patch_proposal` card (locked in widget
>   `contract.d.ts`, Lane B emits to match):** frame `type:'patch_proposal'` with
>   `{proposal_id, title?, rationale?, target:{step?,path?}, before_yaml, after_yaml,
>   tier?, reply_tool}`. Widget renders a before→after diff + tier-gated accept/reject;
>   on accept it resumes via `chat_resume` and the connector invokes `reply_tool`
>   (e.g. `apply_patch`). Distinct from the YAML-pane apply-patch panel (whole-doc
>   `corrected_yaml`/`auto_fixes` from `validate_yaml`) — this is agent-initiated,
>   value-level, in-chat.
>
> **▶ 2026-07-18 (session 3g) — P5 matrix: linter gap fixed, S1 + S7 landed, S5 grounded.**
> Continued the build-persona scenario matrix (plan: `docs/plans/build-persona-validation-plan.md`).
> A **parallel session** worked the same thread — it pinned framework 0.4.28, released connector 0.4.74,
> and committed the S7 pytest; notes below reflect the reconciled state.
> - **Linter gap FIXED + RELEASED + LIVE** (framework `4778ec8` = tag **v0.4.28**; connector **0.4.74**
>   on 206): the `create_record`-args-outside-`arguments:` class (module:/resource: as siblings of
>   type:) that compiled clean and crashed only at runtime (`insert_data() takes at least 2 positional
>   arguments`). Root cause was `parser.py` silently dropping unrecognized step-level keys — NOT the
>   arg-validator. Fix: check each step's top-level keys against
>   `_UNIVERSAL_STEP_KEYS | _STEP_KEYS_BY_TYPE[type]`, emit an `unknown_param` **warning** pointing at
>   `arguments:`; decompiler escape keys allowlisted. 6 new parser tests. Full pre-commit gate passed.
>   ✅ **Verified live on 206**: the box's `validate_yaml` flags the broken fixture
>   `unknown_param warning | steps[1].resource`. (An earlier draft said "needs release + re-pin" —
>   wrong; already shipped.)
> - **S1 (create from natural language) committed** (connector `9ae4015`): `scripts/eval_s1_create.py`
>   + `EvalHarness.track()` for create-scenario teardown. Was validated 6/6 live on 206 last session;
>   now committed. Alert name is FIXED (grade the playbook, not the model's copy-typing).
> - **S7 (linter negative test) — the parallel session's pytest** (connector `0dcbca4`):
>   `tests/test_broken_fixtures_linted.py` + fixture `scripts/eval_fixtures/broken_create_record_bad_args.yaml`.
>   Asserts `validate_yaml` flags the misplaced `resource:` as an `unknown_param` warning AND that the
>   corrected `marker_emitter.yaml` is NOT flagged. 2 passed. (I had built a broader `eval_s7_lint.py`
>   script with extra defect classes + a severity model but **dropped it as redundant** with their
>   pytest; the extra coverage — missing-type, dangling-next — is a future add to their fixture-glob.)
> - **S5 ground truth characterized on 206** (throwaway probe, not kept): the anchor fixture RUNS →
>   `status=failed`, `why_failed`/`diagnose_run` both give clean structure: `failing_step='Emit'`,
>   `insert_data() takes at least 2 positional arguments`. So S5's oracle is well-defined, and the
>   SAME fixture doubles as the S5/S6 runtime-failure playbook.
> - **🔜 S5 design crux (the next real chunk):** the assistant's build slice has
>   `diagnose_yaml_against_pb_execution(yaml_text, pb_execution)`, but it has **no channel to a failed
>   run's execution env** — mirroring exactly how S2 surfaced F1 (no read channel). S5 will likely be
>   an investigation + a grounding change (feed the failed run's `pb_execution` into the build turn),
>   not just an eval script. THEN S6 (apply the fix → it runs), S3, S4, S8.

> **▶ 2026-07-17 (session 3d) — reference-DB clobber blocker RESOLVED; P4 committed.**
> The framework pre-commit gate no longer depends on the mutable, clobber-prone dev cache
> `data/fsr_reference.db`.
> - **Gate decoupled** (framework `071bd57`): `tooling/tests/conftest.py` now copies a small
>   COMMITTED fixture `tooling/tests/fixtures/tooling_reference.db` (~13 MB — 14 test-referenced
>   connectors at full param fidelity + the infra tables the compiler needs) to a temp file and points
>   `db_path`+`$FSRPB_DB` there (tmp copy because compile paths connect read-write and would otherwise
>   trip pre-commit's "files modified by hook"). Regenerate via
>   `tooling/tests/fixtures/build_tooling_fixture.py` — sources the committed slim catalog + the public
>   Fortinet RPM repo (`repo.fortisoar.fortinet.com`; `apivoid/aws-access-analyzer/recorded-future/
>   http/claroty-xdome` probed at full fidelity), regenerates `op_safety` via `probe_op_safety`.
>   `cli.py --db` now honors `default_db_path()`/`$FSRPB_DB`. **Repo-wide gate: 1852 passed, 0 failed**
>   (silent skips 12 → 6 — the fixture restored `fortinet-fortisiem`/`cyops_utilities` the clobber had
>   removed, so coverage went UP).
> - **P4 committed** (framework `d9a18b7`): open-playbook edit-in-place (final ```yaml fence → Save
>   updates the open record) vs new-playbook `emit_playbook_offer`; + skeleton test pinning both
>   terminal-action branches.
> - **Warmup guard** (connector `285c032`): `operations._warmup_clobber_refusal()` refuses a warmup
>   that would write the framework dev cache unless `FSR_REFERENCE_DB`/`FSRPB_DB` points elsewhere or
>   `FSRPB_ALLOW_DEV_DB_CLOBBER=1`; inert on-box. Framework primitive `_db.warmup_write_path()`. Guard
>   test green.
> - **Loop closed (session 3e, same day): all commits PUSHED + widget SHIPPED + on-box proof.**
>   - Pushed: framework `d9a18b7` (github/main), connector `285c032` (origin/main), widget
>     `7743229` (origin/master).
>   - **Widget shipped to 206: `fortiaiAgenticAssistant-1.2.25`** (ship-verify: 110 e2e + unit green,
>     deploy confirmed to 10.99.248.206).
>   - **Real widget-path proof, 3/3 live on 206** (connector `6a136ec`): new `eval_s2_modify.py
>     --widget-path` seeds `entity.playbook_yaml` exactly as the deployed widget does (read into the
>     connector's OPEN PLAYBOOK block) — the SHIPPED grounding channel, not the `--ground` prompt
>     rehearsal. Every run: grounded read → complete YAML fence (open-playbook edit, no offer card) →
>     `update_playbook ok method=put` → snapshot → `diff changed=[('Emit','arguments')] added=0
>     removed=0` → playbook runs to `finished`. Committed + pushed.
> - The full 724-connector dev cache is still clobbered locally (21 connectors) — no longer blocks
>   anything; rebuild from a full-catalog box when convenient.

> **▶ 2026-07-17 (session 3c) — build-persona validated end-to-end; connector 0.4.73 live on 206.**
> - **F1** (read path / `decompile_playbook`) + **F3** (graft-by-name write) committed `779ae18`,
>   **pushed**; **manual_input awaiting-form card** (EMIT + clean-green SUBMIT `respond_manual_input`
>   no-owners retrieve→resume) committed `56bd5b1`, **pushed**. Both shipped to 206 as **0.4.73**
>   (10/10 workers recycled, warmup OK).
> - **Grounded S2 eval 3/3 live on 0.4.73**: every run `update_playbook ok method=put`,
>   `diff changed=[('Emit','arguments')] added=0 removed=0`, snapshot taken, `status=finished`.
> - **SUBMIT** live-clean inside the input window (`scratchpad/freshfwd.py`): fresh trigger → pause
>   → forward `forwarded:True` → run advances to `finished`.
> - **STILL OPEN (do NOT report as shipped):** P4 framework prompt is written + live-proven but
>   UNCOMMITTED (blocked by the reference-DB clobber, below); widget-side F1 seed `7743229` committed
>   but unpushed + unshipped (eval used `--ground` rehearsal, not the widget path on-box).

> **▶ 2026-07-17 (session 3b) — P4 DONE + live-proven; 🔴 reference DB was clobbered (now resolved, see 3d).**
> **P4** (framework, **UNCOMMITTED**): the designer prompt was promising three things that don't
> exist, each checked against the real `tools_for_intent("build")` slice, not inferred —
> (1) *"call `analyze_playbook` on [the IRI]"*, but that tool is `required: ['yaml_text']` with **no
> IRI param** and nothing in the build slice reads a live playbook: **this is the sentence behind
> S2's 0/4**; (2) `suggest_fix_for_diagnostic`, exposed to **no intent at all**; (3) "always end with
> `emit_playbook_offer`", whose accept path **pushes/creates** — so with a playbook open it saves a
> **duplicate** and leaves the analyst's untouched. Live on 206 (real LLM, grounded via F1's shipped
> `entity.playbook_yaml`): **new prompt 3/3 PASS** (`verify_enhancement`, complete fence, `diff
> changed=1 added=0 removed=0`, runs → BRAVO) vs **old prompt 1/2 FAIL** as the control (the failing
> run emitted an offer card and **no yaml fence at all**). So F1's grounding alone gives a correct
> EDIT but still loses the SAVE ~half the time. Durable piece = a test pinning the prompt against the
> slice, so it can't name a tool the persona lacks. **S2 is now effectively green.**
> 🔴 **BLOCKER, my fault:** running connector ops locally fires the warmup, which `db_write`s the
> **box's** catalog into `FSRPB_DEV`'s `data/fsr_reference.db` → **724 connectors → 206's 21**
> (proof: `warmup_runs` ledger). ~10 `fsr_playbooks` tests silently became skips; **31 `tooling`
> tests FAIL** → the framework **pre-commit gate refuses the P4 commit**. Gitignored (no `git
> restore`), no intact copy on the machine, and `fsr_reference.json` is a *reduced* export (missing
> `config_schema_json`/`condition_value`/`observed_type`) so reseeding is lossy. Real fix =
> `probe_connectors` against a box that has those connectors (the 26 Jun probe got 724/6867) —
> **which box is the open question.** Backup: `/tmp/fsr_reference.db.post-my-warmup.bak`.
> **Prevention:** `export FSRPB_DB=/tmp/probe.db` before ANY local connector op.
>
> **▶ 2026-07-17 (session 3) — F3 FIXED + live-proven on 206 (uncommitted).**
> `_graft_live_ids` now pairs compiled↔live records by **uuid first, then name** (routes: by the two
> steps they connect), and a paired record takes the live **uuid as well as the `@id`** — so the live
> identity survives the edit. Taking the uuid strands every reference to it, so the graft remaps
> route `sourceStep`/`targetStep`, a step's `group`, and the workflow's **`triggerStep`**. Ambiguous
> names pair nothing rather than guess. Live on 206 via `scripts/_f3_graft_probe.py` (no LLM), case D
> (designer-built — the persona's premise): `kept=0 new=2 dropped=2` → **`kept=2 new=0 dropped=0`**;
> `diff_versions` `added=2 removed=2` → **`changed=1 added=0 removed=0`** (step `Emit`, field
> `arguments`); the playbook **runs, `status=finished`, emits BRAVO**. The plan's chosen oracle is
> restored. Case C (compiler-created) still updates — no regression. Connector **303 root** + **227
> triage** green; 9 of 13 new graft tests provably RED against the old graft.
> **The probe runs `update_playbook` LOCALLY in-process against the box** (local-dev loop → .env pyfsr
> client) — deliberate, so proving a graft change does not ship the user's in-flight WIP to an
> appliance. **Two things only the box caught:** `triggerStep` (13 green unit tests, then the live PUT
> rejected on a `triggerstep_uuid` FK — tests inherit the fix's blind spots), and that **F2 was
> mischaracterised** (the uuid collision is closed; what remains is an honest `(name, collection)`
> refusal for an ask only reachable by hand). ⚠️ `test_hitl_durability.py::test_manual_input_unreachable_run_degrades_cleanly`
> is red and is **not mine** — identical failure with the old graft pinned back in (the user's
> `manual_input` WIP). Still **UNCOMMITTED** and unshippable alone: `operations.py` interleaves my
> F1+F3 work with the user's manual_input WIP.
>
> **▶ 2026-07-16 (session 2) — Build-persona validation: P2 done, S2 answered it, F1 FIXED (uncommitted).**
> Plan + **RESUME BLOCK**: `docs/plans/build-persona-validation-plan.md` (read its resume block
> first — it carries repo-by-repo state, the foreign-WIP list, and the P2 gotchas).
> - **Goal (unchanged, unmet):** validate that agentic playbook creation actually works and the
>   assistant is genuinely useful. Bar = **the playbook runs and does the asked-for thing**, not
>   "the right tools were called". 8 scenarios (S1–S8); build persona is the designer's mount
>   intent; save-as-playbook stays triage's job (the earned handoff).
> - **✅ P0** — C2 write path fixed for real (see the entry below). Connector **0.4.68**, pushed,
>   live-verified on 206.
> - **✅ P1** — every AI edit now snapshots into the playbook's Versions tab first, **fail-closed**.
>   Live-verified: snapshot holds the user's PRE-edit work, the edit lands, restore reverts it.
> - **✅ P3 — build surface cut** (widget commit `3b5705b`, **local/unpushed**): render step
>   (`step_test`) parked behind `config.enableStepVerify` (default OFF — authoring aid, not on the
>   compile/push path, never called by the build prompt); `config.defaultIntent='build'` **retired**
>   (it was the one way to reach build with nothing to build against; the edit-page picker is gone —
>   a control that silently does nothing is its own lie); `session_id` threaded so a restore point
>   reads `ai-pre-edit <session>`. Build is now the DESIGNER's mount intent — *not* "designer-only":
>   the earned handoff (`openDraftInBuild`) still enters build after a real hunt, WITH a draft in
>   hand. Widget 695 jest + 107 e2e green (19 tests across 6 specs had to be rewired — they all used
>   `defaultIntent='build'` to reach the YAML pane).
> - **✅ P2 — the eval harness** (connector `f52af4c`). `scripts/eval_harness.py` +
>   `eval_fixtures/`; `make eval-selfcheck ENV=<file>` runs the whole S2 shape live on 206 with the
>   AI taken OUT (deterministic pyfsr edit), so a failure there is a harness bug, not a finding. It
>   proves its own teardown (alerts AND run records). 19 unit tests pair every oracle with a case it
>   must REJECT — an oracle that only ever passes is this plan's original bug one level up.
> - **🔴 S2 — built (`b6c8b1e`), and it answered the question: the assistant is NOT the problem.**
>   Ungrounded: **0/4** runs, each dead-ending in `analyze_playbook` with nothing to pass it, asking
>   the analyst to paste in the playbook already on their screen. Handed the YAML (`--ground`, the
>   only variable changed): it read, verified, and returned a correct one-field edit first try.
>   Three live blockers, ALL reproducible with **no LLM** (`scripts/_s2_409_probe.py`):
>   - **F1 — the build tool slice cannot READ a live playbook.** `get_record`/`search_module_records`
>     scoped out of build by C5; `search_playbooks` = offline corpus; `analyze_playbook` takes
>     `yaml_text` only. The widget assumed the opposite in a comment ("the connector can also fetch
>     by iri with its own SOAR tools" — it cannot), and "⊕ Pull in this playbook's steps" fetched
>     `?$relationships=true` then **dropped the steps** in `_composeEntitySummary`.
>   - **F2 — `update_playbook` 409s on any playbook it did not itself compile.** `_graft_live_ids`
>     matches steps **by uuid**, so editing a CLONE collides with the original (probe A 409s; probe C,
>     identical body vs the fixture itself, `ok=True`). Real bug: duplicate a playbook → AI edit
>     always fails. P0's live-verify missed it (it built its collection FROM the compiled envelope,
>     so the uuids matched by construction).
>   - **F3 — on a designer-built playbook the graft matches nothing** → `ok=True` but
>     `kept=0 new=2 dropped=2`: every step destroyed and recreated. **This defeats `diff_versions`**
>     (uuid-keyed), so the plan's own oracle only works against compiler-created fixtures.
> - **✅ F1 FIXED and live-proven on 206 — but UNCOMMITTED.** New connector op **`decompile_playbook`**
>   (the READ mirror of `compile_yaml`; the framework's `decompile_to_yaml` existed, it just was not
>   exposed) + the widget calls it at designer mount → seeds `currentYaml` → carries the YAML on
>   every build turn as `entity.playbook_yaml`. Same scenario, before → after: 8 failed
>   `analyze_playbook` calls → a correct edit; **409 → `ok method=put`**; still-ALPHA → **runs and
>   emits BRAVO**. Two deliberate calls: the read always hits the LIVE connector even in mock mode
>   (a mocked answer grounds the assistant in a playbook that isn't the one on screen — worse than
>   no grounding), and the YAML is **never truncated** like the capped record-data section (the
>   assistant edits that text and Save compiles it back OVER the real record, so a clipped copy
>   returns as a playbook with the analyst's steps silently deleted — it fails closed instead).
>   Also corrected `update_playbook`'s info.json description, which still advertised the
>   `import_jobs` fallback deleted 3 releases ago.
>   Green: widget **708 jest / 60 suites** + e2e smoke 14/14; connector **291 root** + **227 triage**.
> - **🔜 NEXT: F3 — graft by step NAME, not uuid** (`operations.py` `_graft_live_ids`). It is the ONLY
>   thing between S2 and green: the edit is already behaviourally perfect, the diff just reads a
>   one-field change as a total rewrite. The same fix closes F2 (which is currently only *dodged* —
>   the decompile carries the clone's real name, so the uuids no longer collide; two playbooks
>   sharing names would still 409). THEN P4 (designer prompt) — and S2 is now the argument for
>   keeping it last: the grounded run shows the prompt is not what's broken.
> - **⚠️ NOTHING of the F1 fix is committed, and it CANNOT be cleanly committed by itself.**
>   `operations.py` and widget `view.controller.js` each hold the user's in-flight
>   `manual_input`/`resume_playbook` work interleaved with mine. Mine: connector `operations.py`
>   (`decompile_playbook`, `_live_collection_envelope`, `_entity_context_block`'s OPEN PLAYBOOK
>   block), `info.json`, `pydantic_models.py`, `tests/test_operations.py` (+13); widget
>   `view.controller.js` (`_seedPlaybookYaml`, `_entityPayload`), `fsrPbAgent.service.js`
>   (`decompilePlaybook`), `tests/playbook.yaml.seed.test.js` (new, 7).
>   **Not shipped** — the box runs the user's 0.4.72, which has no `decompile_playbook`; a ship would
>   carry their WIP (incl. whatever currently reds `tests/test_hitl_durability.py`, which passes at
>   HEAD — so it is theirs, not mine).
> - **⚠️ Foreign WIP left untouched:** widget `fsrPbRender.ts`/`view.html` (manual_input
>   dynamic_list), connector `fsr_soc_triage/tools_playbook.py`, `tests/test_persona_resume_persist.py`.
> - **🔑 The lesson, twice over:** every unit test stayed green through a feature that had never
>   worked once — and *this* session's first S2 draft reported **0/3 against the assistant** for
>   failing to call `update_playbook`, which is a WIDGET op in no tool slice that it could never
>   have called. Grade the thing that can actually act.

> **🔴→✅ 2026-07-16 — C2 was NEVER fixed, and now is. Plus: AI edits were unrecoverable.**
> Plan: `docs/plans/build-persona-validation-plan.md`; memory
> `update_playbook_write_path_at_identity`. Connector **0.4.68** on 206, pushed.
> - **The 2026-07-13 "C2 RESOLVED / LIVE-VERIFIED" entry below (and its commit
>   `8597807`) is FALSE.** On 206 the PUT 409'd on *every* attempt and the edit never
>   landed. The earlier entry at the bottom of the Three-pillar row — "both update
>   paths fail … the committed claims are unverified-and-wrong" — was **right all
>   along**; the later "resolved" entry overwrote a correct diagnosis with a wrong one.
> - **Real root cause (live-diagnosed, not inferred):** FortiSOAR decides
>   **create-vs-update on `@id`**, not `uuid`. The compiler emits `uuid` and no `@id`,
>   and its uuids are *deterministic* — so they collide EXACTLY with the live records
>   and the `$relationships=true` cascade tried to INSERT over them
>   (`UniqueConstraintViolationException … fields (uuid)`). `$relationships=true` was
>   never the missing piece; the identity was. The old entry's GET-modify-PUT probe
>   passed only because a GET's steps already carry `@id` — that never generalised to
>   the compiled body the op actually sends.
> - **Fix:** read the live workflow → graft its `@id`s onto the compiled body → PUT.
>   New steps stay `@id`-less and are created; live steps absent from the body are
>   dropped by the cascade.
> - **`import_jobs merge_replace` fallback DELETED, not fixed.** It wasn't the
>   designer's mechanism (re-importing the WHOLE collection to change one step), and
>   live it returned `ok=True` while applying nothing — turning every PUT failure into
>   a **phantom success**. It existed only because the PUT was broken. `update_failed`
>   is now honest and carries the restore point.
> - **🔴 Separately: `create_version` appeared NOWHERE in the connector.** Shipped AI
>   edits had **no rollback point** — and the `$relationships` cascade that makes the
>   write work is exactly what makes it destructive (it replaces nested step/route/group
>   records). `update_playbook` now snapshots into the playbook's **Versions tab**
>   before touching it, **fail-closed** (no restore point ⇒ no edit). Prunes only its
>   own `ai-pre-edit` snapshots at FortiSOAR's 20-cap; never a human's.
> - **LIVE-VERIFIED on 206 (0.4.68)**, full loop: `method=put`, snapshot holds the
>   user's *pre-edit* work, the edit lands, restore reverts it. Probe:
>   `scripts/_p1_snapshot_live_confirm.py` (gitignored per `scripts/_*` convention).
> - **Lesson, recorded because it cost real time:** a commit message and a docstring
>   both claimed "live-verified on 8.0" for 3 releases while the feature never worked,
>   and every unit test was green throughout. **A commit message is not evidence; only
>   the box is.** This is precisely the gap the behavioural eval bar exists to close.

> **✅ 2026-07-16 — Lookup-tool hardening + persona-gated `run_playbook` (from live 206 session review).** Reviewed real agent sessions on 206; found three systemic lookup failures + a missing playbook-exec capability. Memory: `soc_triage_lookup_hardening_and_run_playbook`.
> - **#1 clean error envelope** (`_live_crudhub.py`): recovers the real HTTP status behind a loopback error instead of collapsing to a synthetic `599`, and strips the internal `https://localhost` host. A 404 now surfaces as clean `not_found` across every tool (was a raw `http_599` blob + URL leak). **LIVE-VERIFIED on 206** (fabricated uuid → clean not_found).
> - **#4 field-filter search** (`search_module_records`): `filters={field:value}` arg AND a `field:value` written into `q` route to a real equality filter instead of full-text `$search` that silently returned zero for existing records (9 observed false negatives, e.g. `datakey:interface_stats`). Empty results carry a hint; `$search` fallback keeps a bad field from regressing. **LIVE-VERIFIED on 206** (`datakey:interface_stats` → total 1, matched_by=filter).
> - **#2 module suggestion** (reactive, never blocking — the ref catalog isn't authoritative for custom modules): a genuine 404 on a bad module route is enriched with the nearest known module. **LIVE-VERIFIED on 206** (`ztpfRunGroups` → suggestions `["ztpf_run_groups"]`).
> - **#5 `run_playbook`** (new `tools_playbook.py`, persona-gated): triggers a deployed playbook via pyfsr's typed `client.playbooks.trigger` (crudhub on-box / pyfsr off-box); motivating case = validate a metadata-source script by running "Get Metadata Source Data on Device". **Allowlist is advisory; human approval is the gate** — `run_playbook.auto` → tier 2 (auto-run), `allow` or unlisted → tier 3 approval card → runs on approve (flagged `unlisted`), no persona ⇒ refused. Dynamic tier via framework `set_run_playbook_auto_resolver` hook (getattr-guarded → older pinned wheel degrades to always-tier-3). **Live on 206:** correctly registered agent-only (excluded from the approval-bypassing `call_mcp_tool` path like the record writes; a live test caught + fixed the library dev-path `run_playbook` shadowing that path).
> - **SHIPPED to box .206** as connector **0.4.63** (`make ship ENV=.env.206`; all 10 workers, warmup ok). Connector imports cleanly against pinned **fsr-playbooks 0.4.26** (getattr guard verified). Tests: connector 319 green; framework tier/dispatch 61 + llm 1201 green (5 pre-existing live-`.env` e2e failures unrelated).
> - **Commits LOCAL/UNPUSHED:** framework `bf237ab` (resolver hook), connector `0542d6a` (core) + `0.4.63` fix commit. The unrelated `test_persona_resume_persist.py` session-id WIP left untouched.
> - **✅ (A)+(B) DONE 2026-07-16 — LIVE-PROVEN on 206.** Framework **0.4.27** released to PyPI (resolver hook `bf237ab`; tag+main pushed); connector pin→0.4.27 (preflight OK, 63 symbols) + shipped as **connector 0.4.64→0.4.66** (10 workers, warmup ok, health openai-reachable). Authored Key Store persona `fsr_assistant_profile:ztpf_metadata_sources` (`_upsert_ztpf_metadata_persona.py`; run_playbook.allow=auto=[name,uuid]). Live turn grounded on `ztpf_metadata_sources/ecaab084-…`: model CALLED run_playbook, `stop=end_turn` (no card) ⇒ **tier-2 auto-ran** → real trigger. Connector pin+info.json UNCOMMITTED (deploy.sh doesn't commit).
> - **🐛 run_playbook trigger-route BUG FOUND+FIXED (0.4.66, live-verified).** First run failed CS-WF-5 `list object has no element 0` — `run_playbook` used pyfsr `trigger` (manual `notrigger` route), which doesn't populate `vars.input.records[0]`. The validation playbook fires from a **record-action** trigger (`cybersponse.action`, route `81d0acd1-…`) needing `trigger_action(route, module, record_uuid)`. Fixed `tools_playbook.py`: `_record_action_trigger()` inspects the definition + routes record-action playbooks via `trigger_action`; `_task_id_of()` handles the `/action/` route's plural `task_ids` + waits. Tests +4 (18). Live: run now advances to **`awaiting`** (was `failed`) → record reached the run; pauses on device/manual-input = graceful `not_finished_awaiting_or_slow` seam (#5b follow-up to fully finish).
> - **✅ #5b resume_playbook DONE + LIVE-VERIFIED (connector 0.4.69).** New persona-gated agent-only `resume_playbook(run, decision)` = thin wrapper over pyfsr `PlaybooksAPI.approval` (approve=primary/reject=first-non-primary/label). Fixed `run_playbook` follow (record-`/action/` task_id doesn't correlate via log_list → follow via `wait_for_run`, surface `awaiting_input` + `run_pk`). Attached pyfsr `ManualInputAPI` as `client.manual_input` so `approval()` works on-box. Live on 206: agentic turn `run_playbook`→`awaiting_input`(pk 2973)→agent `resume_playbook(reject)`→run 2973 `finished`. **✅ 0.4.70: shows + fills the FORM** — `awaiting_input` carries `awaiting.fields` (from `input.schema.inputVariables`) + `options`; `resume_playbook` gained `inputs=` (submits via pyfsr `manual_input.answer`). Live: turn surfaced the real "Choose a Manager and a Device" fields + Ok/Cancel. Tests 29 (suite 226). Open: live-submit a valid device value (green data run); widget chat-card rendering of the form.
> - **REMAINING:** (C) **#3 prompt guard** (only get_record IRIs from prior results; don't invent UUIDs) + **#6 `list_related_records`** (paginated/projected traversal). (D) **#5b manual-input handling inside chat** (paused-run detection → prompt as chat turn → `resume_playbook`; chat-contract change; `run_playbook` already returns `not_finished_awaiting_or_slow` as the seam).

> **✅ 2026-07-16 — Persona Spine Unification (PL→P6) COMPLETE + LIVE on box 206.**
> Collapsed the privileged hardcoded `triage`/`build` intent system and the Key
> Store persona system into ONE resolution spine. Plan (local-only):
> `fsr-playbook-framework/docs/plans/PERSONA_SPINE_UNIFICATION_PLAN.md`; memory
> `persona_spine_unification_plan`.
> - **P3 (connector `5e786b8`):** grounding/preflight/CaseState is now
>   `ResolvedPersona.capabilities.grounding`, not an `intent=="triage"` branch. A
>   Key Store persona opts in via `jSONValue.capabilities.grounding` and grounds on
>   its OWN prompt. P0 goldens byte-exact.
> - **P4 (framework `2e754d8`, released 0.4.24):** `fsr_playbooks/llm/tool_result.py`
>   tool-output envelope contract (dict | list[dict]; fail-open, strict under
>   `FSRPB_STRICT_TOOL_OUTPUT`); `dispatch` validates every tool output; all 56
>   registered tools conform.
> - **P5 (connector `8c2bf05`):** `profiles.validate_persona_record()` authoring
>   lint + `docs/PERSONA_AUTHORING.md`.
> - **P6 (connector `1136637`):** PLAN.md one-spine section; `TRIAGE_BUILD_AUDIT_PLAN`
>   marked superseded.
> - **SHIPPED to box .206** (`.env.ztpf-8.0`) as connector **0.4.56** (`bfe595c`);
>   framework **0.4.24 on PyPI** (main+tag pushed). On-box `health_check` verified:
>   `p4_tool_output_contract.present=true` (definitive — module imports in worker)
>   + `c5_build_scoping.symbol_present=true`. Tests: framework 712, connector root
>   248, triage 186, PL 5 — all green.
> - **Connector `main` is LOCAL-only** (box got it via `make ship`, not git origin).
> - **REMAINING = deferred GA/live only:** (1) T2 containment-drift grade on a
>   drift-exhibiting model (GLM5 doesn't repro; durable fix = rebalance
>   `30_what_you_do.md` L100-132), (2) live agentic-turn confirm of a Key Store
>   grounding persona on 206.

> **✅ 2026-07-15 — Widget SHIPPED (1.2.17) to GA/159 + 168; GA demo-readiness
> VERIFIED end-to-end.** `fortiaiAgenticAssistant 1.2.17` (C3 Diagnose & fix)
> deployed to BOTH boxes via `ship.sh` per-box `FSR_ENV_FILE` (same version, `.env`
> never mutated). **Built-in FortiAI demo readiness (native `/api/ai/*`, 8.0-only):**
> - **GA/159 (`.env.fsr-ga` = 10.99.249.159:13000): READY.** FortiAI enabled,
>   provider "Fortinet FortiAI", reasoning profiles Low/High, **5 MCP servers
>   registered** (FortiSIEM, SOC Framework, Utility Tools, FortiSOAR Playbook
>   Management, FortiSOAR Module Management), native MCP gateway usable
>   (`client.mcp` soc=9 tools, modules=query_records). **A real AI investigation ran
>   end-to-end** on the newest alert ("S3 Exfil …") → 9-phase pipeline
>   (normalization→verdict→next_action), verdict **Malicious**, findings attributed
>   to source agents (threat_intelligence). Connector 0.4.48 healthy, anthropic
>   reachable.
> - **168 (10.99.250.168): native FortiAI ABSENT** — `/api/ai/*` routes 404 (older
>   build predating the 8.0 FortiAI/MCP gateway). Only the connector-backed widget
>   chat works there; the AI-investigation + MCP-integration demo must run on GA.
> - **pyfsr surface bug found:** `records("alerts").first()` returns a typed `Alert`
>   that the `/api/ai/triage/alert` POST can't JSON-serialize (the
>   `trigger_ai_investigation.py` example's own pattern fails); pass a plain `dict()`.
>   Worth a small pyfsr fix. MCP setup surface: `client.ai.register_and_verify` /
>   `list_mcp_servers` / `delete_mcp_server`; DeepWiki public no-auth server
>   (`https://mcp.deepwiki.com/mcp`) is a ready zero-cred "add an external MCP server"
>   demo beat (`pyfsr examples/register_and_call_public_mcp_server.py`).

> **✅ 2026-07-15 — C3 "Diagnose & fix" (value-level render patches) BUILT + green,
> box-independent, unshipped/uncommitted.** Completes the C3 apply-patch story: the
> existing "Check & fix" handles the compiler's mechanical whole-YAML `corrected_yaml`
> auto-fixes; the new "Diagnose & fix" is its render-path sibling — `analyze_playbook`
> → `suggest_fix_for_diagnostic` per diagnostic → reviewable **before→after** value
> patches (`{step_id, location, before, after, confidence, explanation, kind}`).
> One-click **Apply** only for unambiguous unique-literal swaps (re-checked at apply
> time); ambiguous/structural fixes get a "Send to chat" escape hatch that seeds the
> composer. **Zero framework/connector ship needed** — both tools were already
> `@mcp.tool()`-registered and reachable via the widget's `call_mcp_tool` seam (the
> same path C3 Verify/debug use). Widget-only change: `fsrPbAgent.service.js`
> (`analyzePlaybook`/`suggestFix`), `view.controller.js`
> (`diagnoseAndFix`/`applyValuePatch`/`sendPatchToChat`/`dismissValuePatches` +
> `$watch` guard), `view.html` panel + toolbar button. Tests: **619 jest** (+8 new
> `valuePatch.controller.test.js`) + **5 e2e** (`diagnoseFix.spec.js`); lint +
> typecheck clean. KB: 2 gotchas added to `docs/kb/drawer-widgets.md` §18.6
> (call_mcp_tool tool-reachability; unique-literal client-side apply). Also verified
> + corrected a stale STATUS note: the `tools_triage.py` reauth latent-bug follow-up
> is already RESOLVED (centralized `_shared.live_request_with_reauth`).

> **✅ 2026-07-14 — Module-scoped assistant personas + ZTPF authoring: v1 COMPLETE,
> LIVE-VERIFIED, MERGED + PUSHED.** Plan:
> `docs/plans/module-scoped-assistant-personas.md` (§7c = the authoring capability
> spec + live findings); memory `custom_module_agentic_assistant_plan` +
> `ztpf_authoring_persona_next_direction`. A per-module persona (own system prompt +
> tool subset + write scope) is defined by ONE Key Store record
> (`fsr_assistant_profile:<module>`) — no connector edit to add one. Phases 0–4 all
> DONE + live-passed on box 206 (has the ztpf_* modules; connector 0.4.50). What's
> shipped end-to-end:
> - **Persona resolution + tool narrowing + record writes** (`profiles.py`,
>   `_resolve_profile`/`_tools_for_turn`, `tools_records.py` tier-3 approval-carded
>   `create_record`/`update_record` `may_write`-gated) and **widget framing**
>   (`resolvePersona` → `personaUi` → greeting/placeholder/quick-action deck).
> - **`test_template` tool** (`tools_ztpf.py`) — the authoring spine: reads a
>   `ztpf_templates` record (its own `script` + `exampleJinjaVars` fixture), lints
>   the Jinja (`do`-extension-aware syntax + unknown-filter warnings), and RENDERS
>   through FSR's live jinja-editor on-box (`render_via:"live"` — resolves `do`,
>   `regex_replace`, `ipaddr`, and the seeded `record`). Read-only tier-1,
>   persona-allowlist-only, also callable via `call_mcp_tool`.
> - **Transient-None cache bug FIXED** (`resolve_profile_status` → `(profile,
>   definitive)`; only definitive results cached).
> - **FULL AGENTIC TURN LIVE-PASSED** (gpt-4o via `fsrpb-live`): "test render this"
>   → LLM calls `test_template` → live-rendered config; "fix the typo + save" →
>   `get_record` → `test_template` on the drafted script → `update_record` (tier 3)
>   → `stop=approval_required` with a formed approval card; left unapproved, real
>   record byte-unchanged.
> - Suites green: connector fsr_soc_triage **172**, widget **611 unit + e2e**.
> - **MERGED + PUSHED to origin** (2026-07-14): connector→`main` (gitlab) @ b4b4e03,
>   widget→`master` (gitlab) @ aef8ef1, dev-kit→`main` (GitHub) @ ca31056. (The
>   `fndn` remotes on connector+widget were intentionally NOT pushed.)
>
> **Key Store:** only `fsr_assistant_profile:ztpf_templates` exists/needed (on 206);
> modules without a record fall back to default triage/build (unchanged). Extending
> to sibling ztpf_* modules is future scope (see NEXT below).
>
> **NEXT (open, when picked up):** (1) **action-creation persona** — the
> step→action→flow write model for `ztpf_automation_actions`/`_profile_steps`
> (deliberately deferred §7c.2; needs the domain map before scoping a write tool).
> (2) Optionally extend the authoring persona to sibling ztpf_* modules via
> `bind_modules` or a new Key Store record. (3) Cleanup: box 159 still has an inert
> spike key `fsr_assistant_profile:__phase0_spike__` (remove via Key Store UI).

> **2026-07-13 — C5 fully live + release process standardized (connector 0.4.47).**
> Released framework **fsr-playbooks 0.4.22 to PyPI** the standard way
> (`make release VERSION=0.4.22` → GitHub Release → OIDC publish CI), bumped the
> connector pin 0.4.19→0.4.22, shipped. Live-verified on-box:
> `health_check.c5_build_scoping = {symbol_present: true, triage_only_count: 19}`
> (register_triage_tools extended the set) → **C5 build-slice tool scoping ACTIVE**,
> and `update_playbook` via platform execute still `method="put"`.
> **New guardrails (so the 0.4.43-class skew can't recur):** framework
> `make release` (guarded: on-main/clean/version>PyPI/tag-new/tests, then tag+push
> +gh release — fixes the tag-without-release drift that stranded v0.4.21); connector
> `build.sh` runs `preflight_framework.py` (static AST check that the pinned wheel
> defines every symbol the connector imports — fails the BUILD on skew), hard-errors
> on an un-fetchable pin, and uses a pip-capable interpreter (the uv venv has no pip,
> which had silently skipped bundling the wheel). Process doc:
> [[fsr_framework_release_process]].

> **2026-07-13 — C2 SHIPPED to box (connector 0.4.46) + live-verified through the
> platform, AND fixed a self-inflicted live-surface regression.** After the C2
> rework (below), shipping surfaced that `update_playbook` (and `push_playbook`)
> returned `crudhub_unavailable` via `/api/integration/execute` — the path the
> widget's save button uses. Added a `crudhub_transport` diag to `health_check`
> which pinpointed the cause: C5's hard `from fsr_playbooks.llm.intents import
> TRIAGE_ONLY_TOOLS` in `fsr_soc_triage/registry.py` raised ImportError against the
> pinned **fsr-playbooks 0.4.19** wheel (the symbol lives in the unshipped ~0.4.20),
> breaking the WHOLE `fsr_soc_triage` import → the crudhub bridge went unbound →
> every live op failed. Introduced by shipping 0.4.43 (first build with C5).
> **Fix (0.4.46): defensive import** — C5 scoping degrades to dormant instead of
> nuking the surface. Live-verified: `update_playbook` via `connectors.execute`
> now edits in place (`method="put"`, `live_crudhub_available: true`).
> Details: [[crudhub_unavailable_via_integration_execute]].
> **⚠️ FOLLOW-UP (C5 not fully live):** build the framework as **0.4.20** (adds
> `TRIAGE_ONLY_TOOLS`, commit `f55f396`) + bump the connector `requirements.txt`
> pin 0.4.19→0.4.20 + re-ship, or build-intent still sees the triage tools C5 means
> to exclude.

> **⛔ SUPERSEDED — THIS ENTRY IS WRONG. See the 2026-07-16 C2 entry at the top.**
> The "live-verified" claim below did not hold: on 206 the PUT 409'd every time and
> the edit never landed. The `$relationships=true` diagnosis is a red herring — the
> write turns on **`@id`**, which a compiled body lacks. The "fresh-compiled body …
> 200" bullet is the specific false one; only the GET-modify-PUT probe passed, because
> a GET's steps already carry `@id`. Kept for history, not for reference.
>
> **2026-07-13 — C2 RESOLVED: `update_playbook` reworked + LIVE-VERIFIED on 8.0
> (box 159).** Found the real in-place-update mechanism by inspecting the designer's
> beautified app JS (`app.beautified.js` — canvas Save `ye()` → `Modules` $resource
> `update` PUT) and confirmed it end-to-end with self-cleaning throwaway probes:
> - **The designer Save is `PUT /api/3/workflows/<uuid>?$relationships=true&$versions=true`**
>   with a `preparePlaybookForSave`-shaped body. The **`$relationships=true` query is
>   load-bearing** — it cascades the PUT into the nested step/route/group records.
>   The pre-rework bare `PUT` (no query) 409'd because the platform treated the body's
>   steps as create attempts (`UniqueConstraintViolationException` on a step uuid).
> - **Fix (connector `operations.py`):** inline the query into the URL (the on-platform
>   crudhub PUT bridge ignores a params dict), add `_prepare_workflow_for_save`
>   (strip `versions`, flatten `stepType`→IRI, stamp `lastModifyDate`). import_jobs
>   `merge_replace` fallback kept as a safety net.
> - **Live-verified on 8.0:** both a GET-modify-PUT round-trip AND a fresh-compiled
>   body (aligned wf uuid) 200 → replace steps in place, cascade to nested records,
>   preserve the workflow uuid. End-to-end through the REAL `operations.update_playbook`
>   via the crudhub bridge: `method="put"`, edit landed. Details:
>   [[fortisoar_workflow_update_endpoint]]. Unit tests updated (8/8), full connector
>   suite green (290 passed / 21 skipped). Committed (branch
>   `dynamic-tool-surface-connector`); **NOT yet shipped to the box** (needs the
>   `release_notes.md` WIP call before a build-path ship — see live-test note below).
> - **Unaffected by this finding:** C4 + Track B remain testable NOW on the deployed
>   stack (1.2.13 ships the editor tailoring + always-allow checkbox). C1/C5 are
>   unaffected (prompt/tool-slicing, no playbook mutation). C3 (debug UI) is
>   unblocked and box-independent.

> **2026-07-13 — live-test session (partial; box 159 window open):** Box 159 up +
> healthy: connector `0.4.42` (anthropic reachable, 10 models, crudhub bridge ok,
> contract 2.8.0), deployed widget `fortiaiAgenticAssistant v1.2.13` (44 widgets).
> **What this means for the tracks:**
> - **C4 (playbook-editor mount) + Track B (Always-allow checkbox) are testable
>   NOW on the deployed stack** — 1.2.13 already ships the editor tailoring
>   (`d2741b0`) and the always-allow checkbox (`cdb4788`); only the live drive
>   remains.
> - **C1 / C2 / C5 are NOT live-verified yet** — they're committed locally but
>   unshipped; box still runs pre-C5/C2/C1 0.4.42. Shipping them = connector bump
>   0.4.42→0.4.43 (+ widget bump for C1). **Caveat:** `make ship`→`deploy.sh`
>   auto-mutates + packages `release_notes.md`, which has unrelated mid-flight
>   WIP on `dynamic-tool-surface-connector` — needs a user call (stash? commit
>   separately? ship from a clean branch?) before a build-path ship.
> - `make health`/`make bridge-check`/`make matrix` all operational against 159.

> **2026-07-12 (later) — drawer-widget rig-mount DONE, stub-vs-real map works:**
> `introspect.ts` now reads `introspection-profiles.json` (harness-side, keyed by
> widget id: config + ctx + urlParams + mountProbe) so drawer/standalone widgets
> mount for real instead of hitting the config-prompt gate. `fortiaiAgenticAssistant`
> now mounts in-harness (56→128 resources) and its `runtime.stubHits` populate →
> the fidelity diff reports the exact stubs the harness fakes that are real on the
> box: `$exceptionHandler, localStorageService, $state, toaster, $translate,
> config, $uibModal`. Validated my seeding change is harmless (counter/myWidget
> mount unchanged); the hermetic-sweep tail failures were the non-hermetic
> introspect server's box-proxy hanging on the last widgets (env flake, not a
> regression); `funnelChart`/`fsocFieldsOfInterest` are pre-existing no-mounts.
>
> **2026-07-12 — Introspection Phase 2 DOM/applied-style diffing DONE:**
> New `lib/domCapture.ts` (`captureDom` + `normalizeSkeleton` + `summarizeDomDiff`,
> 17 jest cases) captures a widget's own subtree (depth-4/child-32 cap, ng-* classes
> stripped) + an intrinsic computed-style whitelist (color/font/display/etc — NOT
> layout-resolved width/margins/position, which would mismatch between `#widget-host`
> and the SOAR drawer). Two hashes per capture: `skeletonHash` (tag+static classes)
> and `tagHash` (tag only) → distinguishes a real branch divergence (tagHash
> differs, likely mock-vs-real viewState) from a class-level ng-class toggle.
> `fidelity()` now populates `FidelityDiff.domMismatch`/`styleMismatches` for real
> (was stubs). Hermetic gate gained **Check 6** (`dom.skeletonHash` vs baseline) —
> `make introspect-gate` fails on a rendered-DOM change (re-baseline if intended);
> verified load-bearing (a class flip trips it). **Bug fixed along the way:** the
> rig looked up `introspection-profiles.json` by the *versioned* widget id but
> profile keys are *unversioned* → the profile was silently missed → rig fell back
> to the generic config + generic `ng-scope` sentinel, which **falsely reported
> "mounted"** (config-prompt carries ng-scope + >200 chars). The widget had
> *never actually mounted* in prior rig runs. Fix: `PROFILES[widget.id] ||
> PROFILES[widget.name]`; for domRoot widgets the mount signal is now the view root
> attaching (`waitForSelector(state:"attached")`), not the controller-global probe.
> Verified end-to-end on `fortiaiAgenticAssistant` (16 nodes, stable skeletonHash,
> Check 6 trips on a class change). Baseline `tests/introspect/baseline/
> fortiaiAgenticAssistant-1.2.13.json` added. **Live SOAR diff DONE** —
> `make introspect-soar ENV=.env.159 ARGS=fortiaiAgenticAssistant` captured the
> soar-side `dom` (16 nodes) and produced the first real harness↔SOAR fidelity
> diff. Result: **tagHash matches** (identical element tree — strong fidelity), but
> `0/1/0/1` is `div.build-hint` (harness, mock `capability_gap`/`build` config) vs
> `div.quick-actions` (soar, real alert) — a data-driven branch, surfaced as an
> *element-identity divergence* (not a style mismatch). Style parity ok on
> same-identity paths. Refined `summarizeDomDiff` to separate "same element,
> different CSS" (real fidelity signal) from "different elements at same path"
> (data branch) so the style-signal isn't muddied (18→19 jest cases, 339 green).
>
> **2026-07-12 — Introspection Phase 2 rig built + first live fidelity diff:**
> `scripts/introspectSoar.ts` (+ `make introspect-soar ENV=.env.<box>
> [ARGS='--offline']`) renders a deployed widget on a live box via the record
> drawer (WAF-safe headed Chrome), captures a `source:"soar"` RenderReport, and
> diffs it against the harness baseline → `FidelityDiff`. First run
> (`fortiaiAgenticAssistant` on 159/8.0): widget renders **clean** (0 errors
> attributable to it; the 3 captured are shell/other-widget noise). **Key finding:**
> the Phase-1 introspect rig renders drawer/standalone widgets as `no-mount` (config
> gate) — so they have no true harness baseline, and the stub-vs-real service map
> needs a rig-mount follow-up. Details in the introspection plan Phase 2 section.
> **Side note:** a stray tsc clobber of `tests/live/lib/soarClient.js` (a broken
> `.ts` sibling not in the build) was caught + restored; the rig now `require()`s
> that .js at runtime to keep it out of tsc's program.
>
> **2026-07-10 — box connectivity confirmed:** all three lab boxes (159/8.0,
> 168, 205) reachable; box 159 authenticates + serves authenticated reads via the
> harness client (`tests/live/lib/soarClient.js` `makeClient()`, loads `.env.159`)
> — 44 widgets, 67k alerts. So the box-dependent threads below (**Introspection
> Phase 2**, **live prompt/flow matrix run**, **playbook-editor live verify**) are
> unblocked network-wise; they just need a run window. Gotcha captured (raw curl to
> `/auth/authenticate` 405s on a header quirk — auth via `makeClient()`/pyfsr, not
> curl): memory `deploy_159_fortisoar_8`.
>
> **2026-07-10 — harness housekeeping:** (a) Introspection backlog #4 confirmed
> DONE (`module is not defined` render noise eliminated via `harnessUtils.js`
> IIFE wrap, `758cbaa`) — verified by a full `make introspect` sweep: errorCount
> 0 / empty `consoleErrors` on all 15 widget reports; baselines regenerated, 3
> orphaned stale-version reports pruned. Introspection plan now has only Phase 2
> (real-SOAR fidelity baseline) open. (b) Confirmed the 8.0 live-UI driver fixes
> (`soarBrowser` SIGN-IN label, `openWidgetDrawer` by-title, mock-only probe) are
> committed (`5d29ad4`) — the `live_ui_driver_8_0_fixes` memory's "UNCOMMITTED"
> note was stale.

> **2026-07-05 — commit/push sweep + new public repo:** (a) pushed the
> `triage-firewall-noc-investigation` branch (connector 0.4.37, already
> committed, just unpushed) to origin/fndn. (b) `fsr_all_widgets` main repo:
> committed the `fsrSocAssistant`→`fortiaiAgenticAssistant` e2e-fixture rename,
> local-dev sidecar scripts, and matrix-live-infra plumbing; pushed to
> `live-matrix-infra`. (c) `widgets-src/fortiaiAgenticAssistant` (separate repo):
> pushed the pending commit (card attribution + S1–S6/R7 security hardening +
> playbook-editor tailoring, `d2741b0`) to `origin/master`. (d)
> `fsr-playbook-framework` confirmed already clean/pushed — the stale
> `b2_hunt_depth_offline`/`noc_fortimanager_tools_plan` memories (24–26 days
> old) no longer reflect uncommitted state; treat those two memories as
> historical only. (e) **New: `ztpAutomationGraph` widget promoted to its own
> public repo** — `https://github.com/ftnt-dspille/widget-ztp-automation-graph`,
> scaffolded to match `widget-action-renderer` (package.json, packager
   scripts, version-triggered `.github/workflows/release.yml`, README), added
   to `widgets.manifest`. See memory `ztpautomation-graph-widget`.

> **2026-07-02 ship + live-verify DONE:** widget `fortiaiAgenticAssistant-1.2.8`
> + connector `0.4.13` (both version-bumped to dodge FortiSOAR same-version
> cache) deployed to 159. Live jest verified on 159: `chat.live.test.js` (real
> `chat_turn`→`end_turn` on v0.4.13 + mock parity) and `widgetUi.live.test.js`
> (drawer renders, `chat_poll` streams live frames) both PASS. Required two
> live-UI-driver fixes (run headed + drawer-icon-by-title) — see memory
> `live_ui_driver_8_0_fixes` + KB §18.7. Driver fixes UNCOMMITTED in harness `lib/`.
>
> **2026-07-02 also DONE (offline, UNCOMMITTED):** (a) **Pydantic Stage 3** —
> params+response models for the 14 remaining connector ops + 7 storage-row
> models in `pydantic_models.py`, `tests/test_pydantic_stage3.py` (32 tests),
> full connector suite **176 passed**. run_op/emit_* left ungated (deliberate).
> (b) **entityContext seeding** — the widget seeds the open playbook as its entity
> on `main.playbookDetail` (no misfit seed card), `playbook.editor.entity.test.js`
> (5 tests), widget suite **492 passed**. **SHIPPED 1.2.9 + LIVE-VERIFIED on 159's
> designer:** "Explain this playbook" fires a chat_turn carrying the full playbook
> in `entity` (iri+fields). Both in resume `resume_2026_07_02_contract_parity`.
>
> **2026-07-02 (later) — agentic workflow hardening, ALL offline-green, UNCOMMITTED,
> one vendor bump ships it:** (a) coherence-review **decisions LOCKED** (spine first /
> one build path / router deferred) — `AGENTIC_WORKFLOW_COHERENCE_REVIEW.md`;
> (b) **§G jinja catalog** (Ansible namespace + advisory wording + `find_jinja_filter`
> never-`[]`) and **§A build Deploy button** (`emit_playbook_offer(yaml=…)` + connector
> accept prefers card `final_yaml`) built + tested; (c) **case-state spine P1+P2 BUILT**
> per `CASE_STATE_SPINE_DESIGN.md` (framework `case_state.py`, seeded TriageDiscipline +
> `guard_redirect`, connector `session_case_state` + grounding cache + resume parity) —
> framework 624 / connector 169 passed (4 pre-existing fails unrelated).
> **SHIPPED + LIVE-VERIFIED (same day):** fsr-playbooks **v0.4.14 on PyPI**, connector
> **0.4.22 live** (0.4.20 briefly broke chat via a hard case_state import vs the old
> pinned wheel — fail-open hotfix 0.4.21). Live drive PASSED all 4: §G clean validate,
> §4.6 gap-resume = 0 tool calls, §4.7 block-ip = card only (zero re-hunt), §A build →
> `awaiting_playbook_offer` → accept → pushed. Next: spine P3/P4. Memory:
> `hardening_g_a_built`.
>
> **2026-07-02 (latest) — spine P3+P4 BUILT offline, UNCOMMITTED:** P3 capability
> facts (capability guard + `note_result` learning + `forget_connector_availability`
> cache-bust; framework 632 passed) and the **capability-gap "Re-check & continue"
> made deterministic** (clears learned facts + availability caches + explicit
> re-check instruction — closes the user-reported dead-button gap). P4 phase
> transitions at the persist chokepoint + §A build-terminal eval + re-triage
> transcript-scan eval. Connector 184 passed (+15 new tests), same 4 pre-existing
> fails (now fixed — 188 passed, fully green). **SHIPPED + LIVE-VERIFIED same
> day:** fsr-playbooks **v0.4.15 on PyPI** (framework 7c0a895), connector
> **0.4.23 live** on all 8 workers (6892f3d). Live drive: servicenow gap card →
> "Re-check & continue" → live re-probe, zero re-hunt, guard doesn't block the
> retry. Memory: `hardening_g_a_built`.

> **2026-07-02 (session: §F/§B + matrix run 5 + case_state tag) — COMMITTED offline,
> NOT shipped:** (a) **§F build-authoring efficiency** (framework `0721e14`):
> `validate_yaml` returns `corrected_yaml`+`auto_fixes` (source_fixer wired into
> the tool via new `apply_fixes`); parameters shape error carries examples + the
> mapping equivalent of a list-of-dicts; **§B** verify_playbook slimmed (no
> duplicated compile evidence, lean typed_walk = counts, warnings/fixes deduped
> by (code,message) with count). (b) **Matrix run 5 executed** (`make matrix`,
> T1): FAIL, but diagnosis says the blocker is a **stale framework gate model**
> — `tool_models.GetRecordArgs` required module+record_id(str) and bounced
> iri-only / module+uuid / int-record_id (3 of 4 "errors"); fixed (framework
> `2ad99de`) + eval false-positive fixed (`ok:true` payloads with nested
> "status":"error" no longer count as tool errors, matrixDriver.js) + connector
> Makefile→widgets Makefile MATRIX_ENV abs-path handoff fixed. **Matrix re-run
> gated on shipping framework fix: tag v0.4.16 → PyPI → pin bump → `make ship`
> → `make matrix`.** (c) **case_state envelope tag built** (connector `94be9f1`):
> chat_turn/chat_resume tags carry `{phase, record_key, scenario, searched,
> enriched, unavailable_connectors}` for a widget status strip (widget-side strip
> NOT built yet — needs the connector shipped first). Suites: framework 1757,
> connector 192, matrixEval 15 — all green.
>
> **2026-07-02 (SHIPPED + matrix run 6):** framework **v0.4.16 on PyPI**,
> connector **0.4.24 live on all 6 workers** (pin bump `fe9d30c`), provider
> anthropic. `make matrix` run 6: **infra fully healthy** — get_record errors
> gone, guard redirects now excluded from the eval (`da2ee3f`). T1's remaining
> FAIL is one precise gap: **`fortinet-fortiguard-ioc` missing from the
> reference catalog** → discovery's tier≤2 filter drops it AND the dispatch
> tier gate stages an approval card for its read-only `ip_reputation`, so the
> turn ends `awaiting_approval` with no info_card. Fix next: ingest
> live-configured connectors into a warmed per-install DB, or tier-gate
> fallback to live op metadata (see memory `matrix_run1_findings` RUN 6).
>
> **2026-07-02 (latest) — run 6 T1 gap DIAGNOSED + FIXED + SHIPPED (0.4.25):**
> NOT a DB-location bug — the site-packages slim DB is writable + persists. Real
> root cause: **stale catalog**. `_warmup_needed` only re-warmed when
> `connectors`/`modules` are *empty*, so after the first partial warmup (12
> connectors, `op_safety=0` from an older connector version preserved across the
> `$replace` upgrade) it **always skipped** → the 20 connectors configured since
> (incl. `fortinet-fortiguard-ioc`) were never ingested. A forced warmup ingests
> all 32 + `op_safety` (357 rows) in ~7s. Fix: (a) `_warmup_needed` now also
> re-warms when `op_safety` is empty with `operations>0` (version-skew
> staleness); (b) `make ship` force-warms after `verify` (operational guarantee).
> `fortinet-fortiguard-ioc` 1.1.0 has NO `ip_reputation` op (the agent
> hallucinated it) — its real ops (`ioc_search` etc.) are investigation/safe/
> tier-2, so discovery surfaces them `requires_approval:false`. **SHIPPED +
> LIVE-VERIFIED on 8.0:** connector `0.4.25` on all 6 workers (commit `efb545f`,
> unpushed). `make matrix` T1 now **DEGRADED** (was FAIL): `info_card` delivered,
> `find_enrichment_actions` returns fortiguard-ioc tier-2, agent runs real
> `ioc_search` via `run_op` (auto-allowed, no approval card). Suite: connector
> **195 passed** (run with `FSRPB_DEV=1`; +3 staleness tests in
> `test_warmup_hooks.py`). Known gap: a connector configured via UI between
> ships isn't auto-detected — run `make warmup` after adding connectors.
>
> **2026-07-02 — emit_action_card gate drift FIXED + SHIPPED (framework v0.4.17 /
> connector 0.4.26):** the `emit_action_card`/`emit_choice_card` pydantic gate
> models required `title` (a field neither registered tool accepts) while
> omitting the real required params — every staged card bounced "title: Field
> required". Same drift class as GetRecordArgs (run 5). Fix: gate models now
> mirror the real signatures + a signature-sync guard test keeps them aligned.
> Released framework **v0.4.17 on PyPI** (tag `v0.4.17`, bundled 2
> conditional_refetch probe commits), connector pin bumped 0.4.16→0.4.17,
> shipped 0.4.26. `make matrix` T1: **PASS** (toolErrors 0, info_card delivered).
> Framework commit `afdfea0` (unpushed past the tag); connector `80b287e`+`0591322`.
>
> **2026-07-02 — triage flow FIXED + SHIPPED (connector 0.4.27):** the agent
> opened triage turns with a full structured "Triage Summary" (indicator/
> confidence/action table, MITRE, prioritized next-actions) from the raw record
> BEFORE any lookup — presenting a plan as a conclusion, then a second summary
> once findings landed. Root cause: the prompt's Quick-action intents section
> licensed record-only structured answers and the agent over-generalized it to
> the default opening; no ordering rule existed. Fix: new "Order of operations"
> section in `system_prompt_triage.md` (lookups before verdict; one summary at
> the end; one-line plan orientation allowed, structured verdict not) +
> Quick-action intents marked opt-in. `make matrix` T1: **PASS** — opens with a
> plan, runs 10 tools, then surfaces the verdict (no premature summary). The 1
> minor error is the pre-existing whois-rdap-not-configured env gap, handled
> gracefully (wider enrichment fan-out is better, not a regression). Connector
> `d26cd35`+`5cda516` (unpushed). Quick-action path not matrix-covered (T1 is
> default triage). See memory `matrix_run1_findings` RUN 8.

> **2026-07-02 (matrix run 9 — EXPANDED to 7 rows; ONE real defect found):**
> Wired T2/T3/T4/T7/P1 + a new T11 quick-action row into gitignored
> `tests/live/scenarios.local.json` (recorded UUIDs). `make matrix`: **T1 PASS,
> T11 PASS** (opt-in IOC table confirms the 0.4.27 investigate-first/opt-in
> split); **T3 DEGRADED** (FMG/FAZ `unknown_connector` — env gap, RFC1918
> acceptance met); **T2/T4/T7 FAIL** are box-159 env / scenario-design limits
> where the agent behaved correctly (T2: alert's indicator is reserved
> `203.0.113.66` + `expectedCards:["ioc_card"]` typo — connector emits
> `info_card` variant `ioc_enrichment`, widget normalizes ioc_card→info_card;
> T4: no containment connector → agent correctly emits `capability_gap`; T7:
> "delete alert" isn't a tier-gatable op). **P1 FAIL is the ONE real defect:**
> on a "save as playbook" ask the agent over-reaches into `find_containment_actions`
> → `capability_gap` truncates the turn before `emit_playbook_offer` fires (HARD
> RULE violation). **P1 prompt fix APPLIED (UNCOMMITTED)** in
> `system_prompt_triage.md` (save-as-playbook → enrichment + offer, no
> containment hunt). **NEXT (needs user call):** ship the P1 fix + re-run
> matrix; AND re-scope T2/T4/T7 to box-159 reality (or stand up FMG/FAZ/FortiGate
> /whois-rdap). Artifacts in `tests/live/_artifacts/`. See memory
> `matrix_run1_findings` RUN 9.
>
> **2026-07-04 — SECOND real defect FIXED + SHIPPED (framework v0.4.18 / connector
> 0.4.35):** `list_configured_connectors` advertised inactive-config connectors as
> `Available` (whois-rdap on 159 had a config record but no active config → listed
> `Available`, then `run_op` rejected it `connector_not_configured` — agent wasted a
> turn, run 9 P1). Root cause: the listing used pyfsr's `list_configured()` (any
> config record) while `run_op`'s preflight uses `_configured_rows` (active-only);
> the two disagreed. Fix (framework `d2ff950`): `list_configured_connectors` now
> filters through `_configured_rows` (fail-open if unreachable). Also cleans
> `find_enrichment_actions`/`find_containment_actions`. +3 regression tests. Released
> **framework v0.4.18 on PyPI** (tag → `publish.yml` → Trusted Publishing). Connector
> pin 0.4.17→0.4.18, shipped **0.4.35** on all 7 workers (anthropic). Both repos
> pushed to main (framework `github/main`, connector `origin/main`). Matrix run 10
> validating the fix in flight. Note: the P1 prompt fix from run 9 was already
> shipped by the user as connector 0.4.32; this 0.4.35 is the framework-side
> discovery fix on top.

---

## 🎯 Widget live-validation pass (action-renderer + json-to-grid)

Goal: validate **all configurable options** for both widgets — live against the
box where the box adds signal, hermetic (mountWidget kit / stubbed grid) for
config-driven render options.

**✅ Done & pushed**
- **action-renderer — complete.**
  - Live (vs box): playbook listing (show-all/search/pick/classify), JSON-to-Grid
    flow (notrigger→grid_data→table), **connector flow** (connector→op→config→run→table,
    env-aware `[[AR-ENV-SKIP]]`). Targets: `make test-ar-playbook-live`,
    `test-ar-jtg-flow-live`, `test-ar-connector-live`.
  - Hermetic output matrix: raw, table styles ×5, sticky, auto+explicit alignment,
    custom columns, empty message, sandboxed-iframe jinja (11 assertions).
    `widgets-src/widget-action-renderer/tests/e2e/actionRenderer.outputRender.spec.js` + `applyOutput()` seam.
- **json-to-grid — filter matrix complete.** boolean/enum/date (pre-existing) +
  **number, string, column sort** (new). All 10 e2e green.
- **Harness fixes** (both unblocked the above): app-shell path now probes
  `fsr_src/app_min/`; `dollar-param-drop` lint downgraded error→advisory warning
  (was darking the whole JTG hermetic tier; single-`$` query params verified safe —
  KB updated).

**🔄 Continuing layer — remaining**
| Widget | Item | Type | Notes |
|---|---|---|---|
| JTG | Column discovery (runs provider playbook) | live | edit-flow `discoverColumns()` |
| JTG | Action buttons (with / without record) | live | execute selected playbooks |
| JTG | Execution wizard launch | live | `showExecutionProgress` |
| JTG | ✅ Card view, expandable rows | hermetic | **done** — 2 new e2e tests (see below) |
| JTG | Column width + order persistence | hermetic→live | `settingsService` keys; restore path needs box-seeded user_settings, defer to live |
| AR | Module-scoped playbook picker | ⛔ blocked | Application-Editor only, not harness-testable |

**Card view / expandable rows (done 2026-06-28).** Two hermetic e2e tests added
to `widget-json-to-grid/tests/e2e/jsonToGrid.spec.js` (12 green):
- **Expandable rows** — per-row `ui-grid-icon-plus-squared` toggle renders (one
  per row); clicking flips to `minus-squared` and mounts the `.expandableRow`
  sub-row container. Two non-obvious findings recorded in KNOWLEDGEBASE.md:
  (1) the detail body (`rowExpandable.html`) uses `cs-markdown-editor`, which the
  harness only vendors when editor markers appear in `view.html`/`edit.html` —
  **not** in `widgetAssets/` sub-templates — so the detail TEXT + row height are
  **live-only** (deferred to box); (2) the platform binds expanded height to
  `row.expandedRowHeight`, not `gridOptions.expandableRowHeight`.
- **Card view** — the `#grid-card-view-btn`/`#grid-list-view-btn` toggle is
  ng-show-gated on `allowGlobalFilter && allowCardView`; the widget disables
  `allowGlobalFilter`, so the toggle is intentionally unreachable and the grid
  always renders list view. Test pins that contract (a future `allowGlobalFilter`
  flip would expose a half-wired card view — `cardView.html` binds
  `record.name/image`, a collection shape, not arbitrary `grid_data`).

**Env note:** lab **FortiGate connector config is down** ("invalid endpoint or
credentials") — env, not a widget bug; connector test env-skips it cleanly.

---


---

## Superseded detail blocks

### Prompt + flow test matrix (triage & playbook creation)

Proven so far on 8.0 (2026-07-01): the widget drawer renders and **one** triage
chat turn streams to `done` with frames (9 polls, 7 frames). That proves the
plumbing, not that every prompt/flow behaves. This matrix is the backlog of
"various kinds of testing" to run later. Detail + acceptance signals live in
`fortisoar-widget-harness/docs/PROMPT_FLOW_TEST_PLAN.md`.

**Runner (built, branch `live-matrix-infra`):** `make test-matrix-live` drives
the whole matrix through the deployed widget and prints per-scenario digests +
a summary table (`tests/live/matrix.live.test.js` + `tests/live/lib/matrixDriver.js`;
eval engine unit-tested offline in `tests/matrixEval.test.js`). Scenario rows
(box-specific record UUIDs) are now **per box** — `MATRIX_ENV=.env.206` auto-selects
the gitignored `tests/live/scenarios.local.206.json` (159's UUIDs don't exist on
206), template `scenarios.local.example.json`. **Gating is per-row (`gate`), not
global** — `soft` (default; hard-FAIL only, the original contract), `strict`
(DEGRADED or any red flag blocks too), `xfail` (documents an open bug; **reports,
never blocks**). Blocking on a clean `xfail` was removed after live evidence: rows
are LLM turns, so a defect is only visible when the model exercises it (one prompt
tripped D2 on 3 of 4 runs against an unchanged connector) — "clean" would have
announced a live bug as fixed. `forbidRedFlags[]` and **drive errors** block on
every gate, so an xfail row still guards already-fixed bugs (P6b guards D1) and
never launders a row that never ran. Rows are additionally graded by the
`exportGrader` red-flag rules — the same rules `make grade-export` runs offline.
`make test-matrix-gate` runs the gating rows only; it is deliberately NOT in
`ship-verify` (each row is a headed box turn). See PROMPT_FLOW_TEST_PLAN.md
"Gating".
**Current state (2026-07-02): the probes/crudhub bridge BLOCKER is RESOLVED.**
Root cause was NOT a code bug — the box's connector *workers were stale in
memory* (they only recycle on a version-bumped publish; dropping 0.4.13 on disk
didn't reload them, so they kept returning `no_fsr_configured: No module named
'probes'` while on-disk `lc.available()` was `True`). Fixed by shipping a bump
(0.4.13 → 0.4.14) which recycled all 7 workers; `make bridge-check` confirms the
live crudhub bridge (30k+ alerts, `available: True`). See memory
`ship_via_connector_makefile` + KNOWLEDGEBASE §20.4.

**STANDARDIZATION (enforced):** ship + diagnose ONLY through the connector-repo
Makefile (`/Users/dylanspille/PycharmProjects/ConnectorsV2/fsr-playbook-builder/Makefile`):
`make ship` (connector, bump→build→install→verify workers recycled),
`make ship-widget` (widget ship-verify), `make verify`, `make bridge-check`,
`make matrix`. Never hand-run `deploy.sh` / `ssh` / ad-hoc `pyfsr`.

**Pick up here: re-run `make matrix` (T1 should now pass) → extend
scenarios.local.json with the T2/T4/T7/T9/P1 rows.**

**Triage flows**
- Single-alert triage → `info_card` summary (severity, indicators, next steps).
- Hunt chain: multi-pivot across indicators (`get_record` → `search_module_records`
  → enrich) → consolidated `ioc_card`. (The `c2_hunt.json` fixture is the mock
  golden; need a live equivalent vs a real 8.0 alert.)
- Negative cases: RFC1918 IP deliberately NOT enriched; unlinked records
  (pivot-by-search, not relationship-traversal).
- Direct-containment ask → `action_card` (not a silent `run_op`).
- Approval lifecycle: approve → `execute_action` → `end_turn` summary; reject →
  logged, no action, `end_turn`.
- Tier gating: mutating ops need human approval at the dispatch tier (≥3 →
  `pending_approval` unless `_approved`).
- Empty-opener / late-entity / bad-fetch races (render path, not prompt — but
  drive them live too).
- Triage prompt steering: fetch-by-IRI goes to `get_record`; never invents a
  connector/op (connector 0.4.11 steering).
- Provider parity: anthropic (8.0 default) vs openai/gpt-4o-mini terse-triage
  hunt-depth guard (connector 0.4.10 guard) — run both if both configs reachable.

**Playbook-creation flows**
- "Build a playbook from this investigation" → `playbook_offer` → Create
  Playbook → verify the compiled playbook on the box → delete (the
  `liveSweep.spec.js` test-4 pattern).
- Playbook draft branching; offer decline path.
- `manual_input` stage handling (framework 0.4.10 hoist).
- Rehydrate-build (resume a saved draft).

**Harness gate — DONE (verified 2026-07-05):** the 3 8.0 harness fixes
(`soarBrowser.js` login, `liveUiDriver.js` drawer-icon-by-title, Monaco
`define.amd`) are committed + pushed (`5d29ad4`, `live-matrix-infra`), not just
working-tree. Clear to drive the matrix.

**Env notes:** 8.0 box has 25k+ real alerts (soc-simulator `create_simulated_alert`
available for clean known records); FortiGate lab config is down (env, not a bug
— containment `action_card` can still be offered/approved, but `execute_action`
will env-skip). Run live turns on the gb200 box only for openai parity (per user).

### Local dev loop — connector + LLM on laptop (BUILT + curl-verified 2026-07-01)

Run the connector + LLM on the laptop; a FortiSOAR box (159) supplies SOAR data
only (records + other connectors' ops via `run_op` to pyfsr). No redeploy, no
credits, no sim/mock. **Full how-to + no-cache discipline: `LOCAL_DEV.md`.**

- **Built:** sidecar (`scripts/local-connector-sidecar.py`), venv setup
  (`scripts/setup-localdev-venv.sh` — editable fsr-playbooks+pyfsr + connectors
  engine wheel + openai/httpx), harness `POST /api/integration/execute/` handler
  gated by `FSR_LOCAL_CONNECTOR=1` (top-level, NOT in the HERMETIC block),
  `connectors.json` fixture (advertises `fsrpb-live`), `operations.py`
  `FSRPB_DEV=1` version-assert bypass.
- **Verified via curl:** `list_models` to LLM models, `health_check` ok, full
  `chat_turn` (231 events, 17 tool calls, `run_op` reached 159). Tests: connector
  125 / framework 1010 / widget 481 green.
- **P0 DONE (2026-07-01):** widget drives a real `chat_turn` in the browser
  against the sidecar, both blocking and detached/`chat_poll`-streamed paths
  proven, tool-call cards render live. Found + fixed a real bug along the way:
  `local-connector-sidecar.py` wrapped every response as
  `{"status": 200 (number), "data": ...}`; the widget's `_unwrapEnvelope` only
  peels `.data` when `typeof status === 'string'` (the real SOAR envelope is
  `{"status": "Success"|"Failed", "data": ...}`), so numeric status silently
  broke every real-mode call with a false "connector too old" error. Fixed.
- **push_playbook DONE (2026-07-01), live-verified end-to-end on 159 —
  playbook actually created, confirmed via GET, then cleaned up.** Three real
  bugs found + fixed chasing this down: (1) widget `pushPlaybook` did
  `'Create failed: ' + (res.error || JSON.stringify(res))` — `res.error` is
  an object `{code,message}`, truthy, so it never reached `JSON.stringify`
  and coerced to `[object Object]`; now prefers `error.message`/`error.code`.
  (2) connector `push_playbook`'s retry loop conflated "all 6 attempts
  raised" with "the first attempt succeeded at the transport layer but
  returned an empty body" — both left `resp is None`, producing a bogus
  "could not create after 6 attempts: None" instead of the honest
  `push_no_record` diagnosis one branch below; fixed by tracking
  `call_succeeded` explicitly. (3) **the actual root cause**, initially
  misdiagnosed as an RBAC/team-ownership gap (it was NOT — the admin user has
  create rights, confirmed): `push_playbook`/`render_jinja`/`dry_run_playbook`
  imported `integrations.crudhub.make_request` directly, which IS importable
  off-platform (the connectors SDK dev package ships it) but is a **stub that
  unconditionally `return None`** — meant to be shadowed by the real
  implementation only at deploy time. A raw `pyfsr` POST to the identical
  `/api/3/workflow_collections` endpoint succeeded immediately, proving the
  box/creds/RBAC were fine all along. Fixed `_make_request()` (the shared
  helper all three ops call) to resolve through `probes._env.get_client()` —
  the same bridge `run_op`/`get_record`/every other live tool already uses —
  instead of the dead crudhub stub. Live-verified: the widget now shows
  "Created playbook in FortiSOAR: 00 - FSR Studio", confirmed via a direct
  `GET /api/3/workflows/<uuid>` against 159, then deleted (hard-delete,
  no orphan left).
- **NOT yet proven:** `chat_resume` approval-card lifecycle, the PROMPT_FLOW
  flows, triage quality (turn hit `max_tool_turns`). No known blocker on any
  of these now — the crudhub/transport gap that blocked push is fixed.
- The internal LLM gateway name is **never in tracked files** — public text
  says "the LLM gateway"; real creds only in gitignored `scripts/localdev.env`.
- **Full-chain inspection is built in:** `chat_history` (full transcript incl.
  tool_use args + tool_result content per turn), `list_sessions`, and
  `get_session_trace` (recorded skill trace + compiled playbook) — any agent can
  pull a session's whole I/O chain to find optimizations. memory
  `chat_history_full_chain_inspection`.

### Triage & playbook roadmap (strategic vision)

**Superseded by `widgets-src/fortiaiAgenticAssistant/ROADMAP.md`** (2026-07-03)
— that file is now the single home for the two-sided (Investigate/Build)
vision, current-state snapshot, and ordered next-actions. This section stays
as a pointer; update the roadmap doc, not here, when the plan changes.
memory `triage_and_playbook_vision` holds the pre-2026-07-03 version of this
same vision for historical detail.

