# STATUS — master tracker

Single source of truth for what's open, in progress, and done across the FSR
widgets work. The detailed plans live in their own docs (linked below); this file
is the index. Update it when a thread changes state; move finished items to
**Done / archived** rather than deleting them.

_Last updated: 2026-06-28_

---

## 🔴 Open / next up

| Thread | Next action | Blocker | Doc |
|---|---|---|---|
| **8.0 box live verification** | (#3) Seed records on the 8.0 box via `fortisoar-soc-simulator`, then drive live triage; (#4) confirm widget renders on 8.0 shell via WAF-safe Playwright | the 8.0 box has 0 alerts/incidents | memory `deploy_159_fortisoar_8`, `pyfsr_8_0_config_fixes` |
| **TS static analysis — Phase 3 wiring** | Wire `pnpm typecheck:widgets` into `ship-verify` as a gate; harden | — | `fortisoar-widget-harness/TYPESCRIPT_STATIC_ANALYSIS_PLAN.md` |
| **Chat Intelligence — Track B** | Live drive vs forticloud + re-capture 2 stale goldens, then start Track B | Phase 0 done offline; needs live | memory `chat_intelligence_plan` |
| **Introspection Phase 2** | Build live-fidelity rig | not started | `fortisoar-widget-harness/docs/INTROSPECTION_OPTIMIZATION_PLAN.md` |

## 🟡 Built but uncommitted / unpushed

| Thread | State | Doc |
|---|---|---|
| OpenAI terse-triage guard | Connector **0.4.10** live-verified, **uncommitted**. Residue: widget empty-opener path not re-tested | memory `openai_terse_triage_shallow` |
| B2 hunt_depth gate | Gate + 6 tests (141 green) offline, **uncommitted**; live drive parked (run only on gb200) | memory `b2_hunt_depth_offline` |
| Widget-harness inspect kit | mount+measure primitives built, **uncommitted** | memory `widget_harness_inspect_kit` |
| action-renderer live-test on the 7.x box | Proven live (fix #3); #1/#2/#4 need Application Editor. **Uncommitted** in harness repo | memory `action_renderer_live_205` |
| stop_reason contract fix (framework) | Committed `6c3afa0`, **not pushed, not deployed** (box runs 0.4.7) | memory `session_2026_06_23_handoff` |
| pyfsr 8.0 `status`-shape fix | `f34d78e` committed, **not pushed** (remote ahead + foreign WIP — user reconciles) | memory `pyfsr_8_0_config_fixes` |
| Harness full-TS migration | `b38e2a4`+`27b3e6a` green, **not pushed** | memory `session_2026_06_23_handoff` |

## 🟢 In progress (multi-phase)

| Thread | Where | Doc |
|---|---|---|
| **TypeScript** | Test infra + scripts + harness `lib/` converted (✅). ~33 jest specs still `.js` (deliberate). Widget *source* stays JS (AngularJS). Active front = static-analysis Phases 2–3, **not** more file conversion. | `TYPESCRIPT_STATIC_ANALYSIS_PLAN.md` |
| NOC FortiManager+FortiAnalyzer tools | Connector live on the 7.x box (0.4.7), committed not pushed | memory `noc_fortimanager_tools_plan` |

---

## ✅ Done / archived

- **Hermetic mock-e2e tier** — `FSR_HERMETIC` gate + local Monaco + boot stubs. (`fortisoar-widget-harness/HERMETIC_E2E_PLAN.md`)
- **North Stars NS1–NS6** — fixture layer, atomic bump, `HARNESS_RENDERING.md`, spec-driven `make new-widget` generator. (NS7 introspect Phase 2 = open, see above)
- **Harness rendering / render-error surfacing** — visible panel for swallowed controller throws.
- **Deploy to the 8.0 box** — fsrSocAssistant-1.2.7 + connector 0.4.10 installed+healthy (live UI render = open #4).
- **TS Phase 2** — SOAR platform `.d.ts` generator built + emitted.
- Resolved defects: chat_poll turn-counter desync (`0.3.134`), live-sweep chat_poll classify, connector name-drift (widget 1.2.2), live triage failure sess-uq31go5p.

---

## Plan docs (canonical detail)

- `fortisoar-widget-harness/TYPESCRIPT_STATIC_ANALYSIS_PLAN.md`
- `fortisoar-widget-harness/HERMETIC_E2E_PLAN.md` (done)
- `fortisoar-widget-harness/docs/HARNESS_RENDERING_PLAN.md`
- `fortisoar-widget-harness/docs/INTROSPECTION_OPTIMIZATION_PLAN.md`
- `widgets-src/fsrSocAssistant/PLAN_live_updates_and_error_hardening.md`
- `widgets-src/c3charts/ROADMAP.md`
- `HANDOFF.md` — most recent session snapshot
