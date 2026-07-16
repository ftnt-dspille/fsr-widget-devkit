---
title: Live-chat eval loop + build-flow fixes
status: active
created: 2026-07-15
owner: dylan
topics: [eval-harness, prompt-flow, fortiaiAgenticAssistant, connector-fsr-soc-assistant, build-intent]
summary: >
  A failed live chat ("create a new playbook to block an ip and create an alert")
  exposed two defects and a process gap. This plan fixes the defects and closes
  the eval-harness gaps so build/authoring flows are graded and gated, not just
  triage.
---

# Live-chat eval loop + build-flow fixes

## ⏭️ Open follow-ups (RESUME HERE after a context clear) — 2026-07-16

### T2 ROOT CAUSE (2026-07-16, from full-transcript eval) — imperative guards force it, NOT tool pollution

Read all three `_artifacts/T2r{1,2,3}.json` end-to-end. The mechanism is
identical across runs and is a **prompt imbalance**, not tool-output pollution:

1. The hunt SUCCEEDS — searches alerts/incidents on the C2 IP + host, finds a
   10+ host botnet blast radius, and writes a full consolidated summary
   (indicator table, attack chain, MITRE) **as plain text**. That prose IS the
   info_card content.
2. Because the finding is critical, the model reasonably *glances* at
   containment: it calls `find_containment_actions`.
3. The imperative containment machinery at `system_prompt_triage.md` **lines
   100–132** then HIJACKS the ending: "you MUST", "`find_containment_actions` is
   never the last thing you do", "pass it straight into
   `emit_capability_gap_card`", "Never dead-end the analyst". The instant the
   model touches containment, the prompt COMPELS a `capability_gap` close — which
   replaces the hunt deliverable.

Evidence: all 3 runs called `find_containment_actions`, NONE called
`emit_info_card`/`emit_ioc_card`, all 3 ended on `emit_capability_gap_card`.

**Imbalance:** containment path = loud imperative scaffolding; hunt-deliverable
path (emit an info_card consolidating findings) = weakly specified. The earlier
steps-6/7 edit ("only contain if asked") loses to the heavier block at 100–132.

**Balanced fix direction (do NOT add another guard — the user's call):** scope the
`find_containment_actions → capability_gap` machinery to when containment is the
intent; make "consolidate the hunt into an `emit_info_card`/`emit_ioc_card`" the
strong DEFAULT close for a hunt ask; allow the agent to NOTE a containment gap
inside the info_card's next-actions WITHOUT that promoting to a capability_gap
card that hijacks the deliverable. This is a rebalancing of existing rules, best
done in a dedicated "evaluate the whole chat / guard balance" session (user's
framing). Confound remains: GA `mcp_soc__` 401 degrades enrichment; fix that too
so T2 grades cleanly.

### Session update (2026-07-16, THIRD pass) — live-verified on GA; T2 STILL FAILS

Shipped connector **0.4.54** to GA (all 5 workers recycled, warmup ok, fixed
prompt confirmed on-box) and live-verified everything:

- **E — VERIFIED** (4× clean live drives on GA). The first drive *caught a bug my
  own send-button change introduced* (the `.composer button` selector matched the
  **Case context** button → injected context, never sent); corrected to
  Enter+ng-model-settle, re-verified 4×. Committed `dd1463c`.
- **D2 — VERIFIED ALREADY ACTIVE on GA.** Ran the build-slice scoping check
  directly on the 159 worker: build slice = 34 tools, 22 in `TRIAGE_ONLY_TOOLS`,
  **nothing leaked**, hunt tools present in triage slice. The resume block's "not
  active" was 206-specific (206 pins 0.4.19; GA runs 0.4.23). No ship needed for D2.
- **T2 — STILL FAILS 3/3 on GA even with the prompt fix live.** All three runs
  completed a 10–13-tool hunt then **self-assigned IP containment** and closed on
  a *containment* `capability_gap` (`capgap_ip_containment` / `capgap_block_c2` /
  `capgap_c2_block`), never emitting the expected `info_card`. The prompt-only fix
  (steps 6–7 + lines 41–50) is **insufficient**. Artifacts: `_artifacts/T2r{1,2,3}.json`.
  - **Confound:** every run also hit the **GA `mcp_soc__` enrichment 401** (issue
    D — `mcp_soc__get_indicators` / `enrich_indicator` → 401; fortiguard op
    rejected). Enrichment failing means the agent has little to consolidate, which
    *feeds* the drift toward containment. T2 cannot be cleanly graded on GA until
    the `mcp_soc__` bridge 401 is fixed.
  - **Durable fix (open, needs a decision):** per the plan's own recommendation
    and [[eval_llm_turns_are_stochastic]] ("determinism-requiring gates belong
    outside the LLM turn"), T2 wants a **deterministic connector-side
    containment-drift guard** in triage: classify the ask (hunt/consolidate vs
    explicit containment) and, on a hunt ask, refuse/steer an
    `emit_capability_gap_card` whose `missing` is containment (guard_redirect),
    OR withhold `find_containment_actions`/`emit_capability_gap_card` from a
    pure-hunt turn. This is a connector design change (tradeoff: a hunt can
    legitimately surface a containment need) + another GA ship + re-verify.



- **A. DONE + committed** (`98ef332`, fsr_all_widgets): the 4 uncommitted harness
  fixes. 47/47 matrixEval green.
- **B/C. Code DONE + committed** (`ab3621d`, connector branch
  `fix/persona-negative-cache`): T2 drift fixed in `system_prompt_triage.md`
  (hunt-loop steps 6–7 now gate containment on an *explicit ask* — the conflict
  with lines 41–50 that drove the self-assign is gone); D2 has a **deterministic
  connector-side guard** `tests/test_intent_tool_scoping.py` (build slice excludes
  `TRIAGE_ONLY_TOOLS` + every registered hunt tool after `register_triage_tools()`;
  2 pass, full suite 261 pass ex. the pre-broken `test_warmup_instance_rewarm`).
  ⏳ **Still needs a box window:** (1) T2 is a prompt fix → live re-verify on GA
  (LLM stochastic, a clean run ≠ proof — grade the defect over ≥3 runs); (2) D2
  becomes *active* on-box only once the framework wheel ≥0.4.20 is deployed to
  206 (the guard catches regressions in CI regardless). Commit is UNPUSHED.
- **E. DONE + committed** (`cacf12c`, fsr_all_widgets): fixed the no-turn flake at
  its source — `sendChat` now dispatches an `input` event + settles 250 ms so
  Angular's ng-model captures the text before submit, and prefers an enabled send
  button over a blind `Enter`. Added `SendChatResult.submitConfirmed` (turn
  started OR composer cleared within 6 s); matrixDriver treats
  `submitConfirmed===false` as a deterministic drive error even if a stray frame
  leaked. Honored the "NOT auto-retried" directive (can't confirm from here that
  this widget clears the composer on send, the premise a safe resubmit needs).
  49/49 matrixEval green; typecheck + eslint clean; `.js` rebuilt via `pnpm build`.

**Remaining: D (GA infra, needs owner) + F (gating, box-local) + the two B/C
live re-verifies above — all need a box window, no more code here.**

### Original priority list (below) — items A/B/C/E now addressed above

Phases 1/0/2/4 are DONE and committed (`598d319`) + live-verified on 206 and GA.
What remains, in priority order:

**A. UNCOMMITTED harness fixes — commit first (4 files, all green: 400 unit tests,
typecheck, lint, build).** These landed AFTER `598d319` while running GA:
- `tests/live/lib/matrixDriver.js` — (1) tool-name resolution via tool_use_id
  index (live `tool_result` has no `.tool`, so every live error printed blank);
  (2) `ENV-SKIP (no containment capability)` verdict (narrow: containment ask +
  0 configured actions only); (3) empty-capture → `FAIL (no turn captured)` +
  `driveError` instead of falsely blaming the agent; (4) `driveError` blocks on
  every gate in `gateRow`; (5) xfail now REPORTS (`XPASS (promote?)`), never
  blocks on a clean run.
- `tests/matrixEval.test.js` — tests for all of the above (wire-shaped frames,
  ENV-SKIP narrowness, empty-capture, gate ladder, drive-error blocking).
- `tests/live/scenarios.local.example.json` — T3/T7 reverted strict→soft with
  reason; xfail keyed on deterministic `triage_tool_in_build`.
- this plan doc.
  Suggested commit: `harness: live-matrix ENV-SKIP + drive-error + tool-name
  attribution; xfail reports not blocks`.

**B. 🔴 PRODUCT — T2 hunt-vs-containment drift (connector, Phase 3).** REAL,
reproducible 3/3 on GA: a clean hunt (13 tools, 0 errors) then self-assigns
containment → emits a containment `capability_gap` instead of the consolidated
`info_card`. Fix in `system_prompt_triage.md`; **bundle with D2** — both are
triage-toolset scoping. Deterministic connector-side assertion: build toolset
must exclude `TRIAGE_ONLY_TOOLS` (see recommendation under Phase 4 below).

**C. 🔴 PRODUCT — D2 (connector, Phase 3), live-confirmed + re-framed.** Not "the
guard fires in build": the triage/containment toolset is REACHABLE in
`intent:build` at all (matches the C5 `TRIAGE_ONLY_TOOLS` gap — framework wheel
needs 0.4.20, NOT active on 206). Fix + assert connector-side. P6a/P6b stay
`xfail`; promote only on repeated clean runs, never off one.

**D. 🟠 INFRA (not widget) — GA box.** Surfaced by the matrix, need owner action,
NOT code fixes here: (1) `mcp_soc__*` bridge → HTTP 401 on GA ("Failed to trigger
playbook. Reason 401") — enrichment degrades; check the bridge credential path on
`.env.fsr-ga` = 159:13000. (2) `faz_*`/`fmg_*` → `unknown_connector` +
FortiAnalyzer connector not configured → T3/T7 DEGRADED. See
[[fsr_mcp_bridge_deploy]].

**E. 🟡 HARNESS — no-turn flake (~1 row in 14).** Composer accepts the prompt but
no `chat_turn` fires → 0 frames. Now loud (`FAIL (no turn captured)`) instead of a
false agent verdict. Root cause open. Deliberately NOT auto-retried (a retry
risks double-sending a merely-slow turn). Investigate the composer submit path in
`lib/liveUiDriver.ts` `sendChat` (Enter keypress vs a send button / debounce).

**F. 🟡 GATING — promote on box-local evidence only.** GA: T1 + P1 clean 3/3 →
safe to gate `strict` on GA. Do NOT inherit gate levels across boxes (the
T3/T7-strict mistake). Whoever owns the GA scenario file (`scenarios.local.json`,
gitignored) should set T1/P1 strict there after their own repeated-clean runs.

## Origin
Live chat on box 206 (playbooks page), `intent:build`, connector 0.4.51, widget
1.2.19. Prompt: "create a new playbook to block an ip and create an alert".
Export: `fsrpb-chat-sess-0ggimysk-*.events.json`. It went badly. Root causes below.

## Findings

### D1 — widget: stale entity leaks into the playbook editor (THIS repo)
`view.controller.js` `_refreshEntityContext` (~:3786) and the init guard (~:200)
only seed the open playbook (`workflows`) as `entityContext` **when it is empty**:

```js
if ($scope.inPlaybookEditor) {
    if (!($scope.entityContext && $scope.entityContext.iri)) _seedPlaybookEntity();
    return;   // a STALE non-workflows entity survives here
}
```

The widget is a persistent drawer. Opening it on a Key Store **key** detail page
captures `entityContext={module:keys}`; navigating to the playbook editor keeps
that stale entity because it isn't empty. Result (matches the live screenshot):
`inPlaybookEditor` true (playbook deck shows) **but** module=`keys` → hero reads
"Triaging key:", subtitle is the SOC containment line, pull button "Case context",
and the stale `keys` module poisons the authored playbook's Start step.

**Fix:** in the editor, the open playbook must WIN — replace any non-`workflows`
entity, not just fill an empty slot. Apply at both `:3786` and `:200`.
Also: in the editor the empty-hero should read build/authoring framing, not
"Triaging <module>".

### D2 — connector: triage logic fires in `intent:build` (connector repo)
From the trace, in a build/authoring turn:
1. **The triage/containment toolset is REACHABLE in build at all.**
   `find_containment_actions` returned `hunt_floor_guard` ("0 of 3 investigation
   steps… call search_module_records on incidents/alerts"). Triage-only guard, no
   business in build. → gate the triage/containment toolset + guard on
   `intent == 'triage'`. (Matrix run 9 P1 already flagged this class —
   "over-reaches into containment before the playbook offer".)
   **LIVE-CONFIRMED on 206 (5 matrix runs, 2026-07-15), and the framing above is
   too narrow.** The guard firing is only a *sometimes* symptom — the model
   called `find_containment_actions` on nearly every run while the guard tripped
   on only some. The defect is that the tool is **exposed to the model in
   `intent:build` at all**; whether its guard trips is incidental. This matches
   the known C5 gap: `TRIAGE_ONLY_TOOLS` scoping needs the framework wheel bumped
   to 0.4.20 to activate, and it is NOT active on 206. Fix + assert
   deterministically connector-side (the build toolset must exclude
   `TRIAGE_ONLY_TOOLS`); the matrix flags it as `triage_tool_in_build`.
2. **`build_playbook_from_trace` reached with no trace** → `empty_trace`. For a
   from-scratch "create a playbook" ask there is no trace. → don't prefer/surface
   it without a trace; steer to the hand-author path.
3. **No native step-type knowledge.** "create an alert" is a platform
   `create_record` step on the `alerts` module, not a connector op. The model
   searched connectors for `create_alert`, found nothing, and hallucinated a
   `set_variable` "alert" + a `code-snippet` HTTP POST to a fake firewall URL.
   → give the build toolset/prompt a native step-type catalog (start,
   set_variable, create_record/update_record, decision, connector, end).

### P0 — process: the harness exists but doesn't gate build flows
`make test-matrix-live` (matrixDriver.js + liveUiDriver.js + scenarios.local.json
+ PROMPT_FLOW_TEST_PLAN.md + matrixEval.test.js) captures & grades real chats and
has run 9+ times on box 159. Gaps:
- No `.events.json → offline fixture` converter — live failures never become
  repeatable regression tests (why P1 stayed a note, not a red test).
- Only hard-FAIL blocks ship; DEGRADED ships. Only T1 runs in `ship-verify`.
- Never run against 206 (ZTPF modules / the box where this failed).
- Widget-state bugs (D1) are invisible to a frame-grading matrix — need widget
  unit/e2e coverage of mount context.

## Plan (sequenced)

### Phase 1 — Fix D1 (widget), ship. [this repo, do now]
- Editor mount: open playbook wins over any stale/non-workflows entity (`:3786`,
  `:200`).
- Build/editor empty-hero framing: not "Triaging <module>".
- Tests: controller unit (stale keys entity + inPlaybookEditor → entity becomes
  workflows, hero not "Triaging key"); e2e (drawer persists keys entity, enter
  playbookDetail → deck + build framing, no "Case context").
- `make ship-verify` → 168 + 206.

### Phase 0/2 — events.json → offline fixture converter. [this repo, high leverage]
- Script: `tests/live/scripts/exportToFixture.js` — read a `.events.json`, emit a
  mock scenario JSON (responses[] keyed by action) + a graded expectation block
  (expectedCards, minTools, errBudget, and an `expectErrors[]` for known-bad
  guard signatures). Register under widgetAssets/fixtures + a matrix row.
- Convert THIS export as the first regression: `build_block_ip_create_alert` —
  asserts NO `hunt_floor_guard` in build, NO `empty_trace`, and a real
  create_record alert step once D2 lands (until then it's an xfail documenting
  the bug).

### Phase 3 — Fix D2 (connector). [connector repo — needs go-ahead]
- Gate triage toolset/guard on intent; de-prefer build_playbook_from_trace w/o
  trace; add native step-type catalog. Verify via matrix P-rows on 206.

### Phase 4 — Make the harness a gate.
- Add `.env.206` matrix env + ZTPF/build scenarios (Pn: block-ip+create-alert
  from a non-record mount AND from a keys-record mount to catch D1-class).
- Promote DEGRADED→blocks (or a quality threshold); gate more than T1 in
  ship-verify.
- Loop: every live failure → export → convert → offline regression + fix.

## Status
- [x] Phase 1 (widget D1) — SHIPPED 1.2.21 to 168 + 206. Open playbook wins over
  a stale entity in the designer (`_ensurePlaybookEntity`); editor empty-hero +
  pull-context read build framing, not "Triaging <module>"/"Case context". Tests:
  `playbook.editor.entity.test.js` (stale-keys replacement, active-chat safety
  valve, editor framing).
- [x] Phase 0/2 (grader + first regression) — `tests/live/lib/exportGrader.js`
  (`gradeExport` red-flag rules), CLI `tests/live/scripts/gradeExport.js`, Make
  target `make grade-export EXPORT=<path>`, regression `tests/exportGrader.test.js`
  asserts all 4 flags on the real captured failure
  (`tests/live/fixtures/exports/build_block_ip_create_alert.events.json`).
- [ ] Phase 3 (connector D2) — gate triage guard on intent, de-prefer
  build_playbook_from_trace w/o trace, add native create_record knowledge. NEXT.
- [x] Phase 4 (gate + 206 scenarios) — BUILT offline, **not yet run live**.
  - **Per-row gating** (`matrixDriver.gateRow`, unit-tested): `soft` (default,
    the legacy hard-FAIL-only contract) / `strict` (DEGRADED or any red flag
    blocks) / `xfail` (documents an open bug; **reports, never blocks**).
    Chose per-row over a global "DEGRADED blocks" because D2 is still open — a
    global rule would sit perma-red, which TESTING.md's own invariants forbid.
    Two overrides block on EVERY gate, xfail included:
    - `forbidRedFlags[]` — a row parked for one open bug still hard-blocks if an
      already-fixed bug regresses (P6b guards D1 this way).
    - `driveError` — login/mount/drawer/timeout means the row never sent a
      prompt. It is infrastructure, never an "expected bug". Found the hard way:
      the broken dashboard mount made P6a report `XPASS (promote?)` — i.e. it
      claimed a bug looked fixed for a scenario that never ran.
  - **Red-flag rules now grade BOTH halves**: `exportGrader.gradeLive(frames,
    requests)` adapts a live matrix capture onto the same digest contract as a
    downloaded `.events.json`, so one rule set gates offline exports and live
    rows. A red flag can hard-fail a row the frame metrics call clean — the
    derailed build turn emitted its offer with 0 tool errors.
  - **P6a/P6b**: from-scratch build from a non-record mount (dashboard) and from
    a stale keys mount (`visitFirst` a key → drawer carries the entity →
    playbook designer). Both `xfail` w/ `expectRedFlags:[triage_guard_in_build,
    trace_tool_no_trace]` (D2 open) and
    `forbidRedFlags:[mount_module_leaked_into_start]` — P6b is the **D1
    regression guard**. Needs a `liveUiDriver` change: `openWidgetDrawer` now
    takes `mountPath`/`visitFirst`, so recordUuid is no longer required.
  - **Mount paths verified on the box** (my first guesses were all wrong):
    dashboard is `/dashboard?module=<uuid>` — a bare `/dashboard` **404s**;
    designer is `/playbooks/<collection-uuid>`, not `/playbooks`; records stay
    `/modules/<module>/<uuid>` (SPA rewrites to `/modules/view-panel/…`). The
    drawer icon title `FortiAI Agentic Assistant` matches the driver default.
  - **Gotcha found while validating — the drawer renders on `/not-found` too.**
    A wrong mount path still opens a composer and runs the turn, just with NO
    entity context, so a broken mount reads as a PASSING row. `goto()` now
    throws on `/not-found`. KB: `docs/kb/drawer-widgets.md` §18.8.
  - **Scenario rows are now per-box.** They carry real record UUIDs, but
    `MATRIX_ENV` switched boxes while a single `scenarios.local.json` stayed put
    — pointing at 206 would have driven 159's alert UUIDs. `.env.206` →
    `scenarios.local.206.json` (gitignored; falls back to
    `scenarios.local.json`), `MATRIX_SCENARIOS=<path>` overrides. The `.gitignore`
    rule was an exact match on one filename, so the per-box files were widened to
    a `scenarios.local*.json` glob + a negation for the template — otherwise real
    box UUIDs would have been committed.
  - **New red-flag rules**, grounded in the real fixture:
    `native_action_as_wrong_step_type` ("Create Alert" authored as a
    `set_variable`) and `hallucinated_http_endpoint` (the invented
    `your-firewall-api` POST). `mount_module_leaked_into_start` now also fires
    on a build tool's `module` arg, not just the final YAML.
  - **Gated rows: T1/T3/T7 → `strict`** (T3/T7 are live-verified 0-error on 8.0;
    T1 was already the ship-verify row). T2/T4/T9/P1 stay `soft` — P1 has a
    known DEGRADED over-reach (matrix run 9), so promoting it now would red the
    suite for a tracked bug rather than a regression.
  - **Boxes**: `make test-matrix-live MATRIX_ENV=.env.206`; `make
    test-matrix-gate` runs strict+xfail only. Deliberately NOT added to
    `ship-verify` (each row is a headed box turn, ~2–4 min; a box outage would
    red every ship).
  - **Real 206 values are filled in** (`scenarios.local.206.json`, gitignored):
    a real Key Store key for `visitFirst`, the "AI Insights" dashboard for P6a,
    and the `01 - Drafts` collection for the designer mount.
  - **RAN LIVE ON 206 — gate green (`make test-matrix-live MATRIX_ENV=.env.206
    MATRIX_GATE=xfail` → exit 0).** Five runs; the calibration they forced is
    below.

### Phase 4 — what the live runs taught (each cost a debug cycle)

1. **A clean LLM run is NOT evidence of a fix.** The original xfail *blocked* on
   a clean run ("the bug is fixed → promote"). Across 4 runs of the identical
   prompt against an unchanged, still-broken connector, P6b tripped the triage
   toolset 3× and not at all the 4th. A defect is only observable when the model
   happens to EXERCISE it, so "clean" and "didn't try" are indistinguishable from
   one turn. xfail now reports (`XPASS (promote?)`) and never blocks; promotion
   is a human call on repeated evidence.
2. **Grade the defect, not the symptom.** The first rule keyed on the hunt-floor
   guard *firing*. But the model called `find_containment_actions` on every run
   while the guard tripped on only some — so the rule reported "promote, looks
   fixed" while D2 was fully present. `triage_tool_in_build` now fires on ANY
   triage-only tool call in `intent:build`, independent of its result. Key xfail
   rows on deterministic codes.
3. **`gradeLive` was silently blind to YAML.** `text` frames are streaming
   DELTAS — a live turn produced 612 and not one contained "```yaml" (the fence
   splits across frames). `finalYaml` was null, so 4 of 6 rules were dead on live
   captures while looking healthy. Join the text frames first (as `digestFrames`
   does).
4. **Static "bad module" lists produce false regressions.** `mount_module_leaked_
   into_start` used a BAD list containing `alerts`; a live build legitimately
   authored `module: alerts` from a `workflows` mount → would have tripped
   `forbidRedFlags` and blocked P6b as a **D1 regression that never happened**.
   The rule now compares against the actual mount (`entity.module`).
5. **A leaked browser turns a finished run into a fake hang.** `session.close()`
   was unreachable when `sendChat` threw → "Jest did not exit" → a completed
   219s run looked infinite and got killed. Now `try/finally`.

**Recommendation for Phase 3:** "tool X must not be exposed for intent Y" does
NOT belong in the matrix — it is a property of the connector's tool registration,
and asserting it through a stochastic LLM turn will always be probabilistic. Add a
**connector-side test that the build toolset excludes `TRIAGE_ONLY_TOOLS`**
(deterministic, instant). The matrix's real strength is grading what the model
DID do (`triage_tool_in_build`, `native_action_as_wrong_step_type`) and guarding
D1 via `forbidRedFlags`, where the entity is set by the widget, not the model.

## GA run (`MATRIX_ENV=.env.fsr-ga`, 2026-07-15) — T-rows

GA = `159:13000` (same host as `.env.159`, different port; **shares records**, so
`scenarios.local.json`'s UUIDs resolve there). Widget **1.2.21** deployed (the
memory saying 1.2.17 is stale). 5/7 pass; 2 findings + 3 harness bugs it exposed.

**Findings (product):**
- **T2 — hunt-vs-containment drift is NOT holding.** The agent ran a full hunt and
  wrote a strong analysis, then *self-assigned a containment check* and emitted a
  containment `capability_gap` instead of the consolidated `info_card` — exactly
  what T2's scenario note warns against (`system_prompt_triage.md` hunt-vs-
  containment fix). Real defect, caught by the existing card gate, no new rule
  needed.
- **MCP bridge auth is failing on GA: `mcp_soc__get_indicators` /
  `mcp_soc__get_asset` / `mcp_soc__enrich_indicator` → HTTP 401** ("Failed to
  trigger playbook. Reason 401"). Enrichment silently degrades. The bridge is
  linked to GA (see [[fsr_mcp_bridge_deploy]]) but the credential path is broken.
- **FAZ/FMG NOC tools error on GA**: `faz_search_device_events`,
  `faz_event_summary`, `fmg_get_device_status`, `fmg_get_policy_package_status`
  → `unknown_connector`. Drove T7 to DEGRADED (5 errors).
- **T4 is env, not a bug**: no response connector configured
  (`find_containment_actions` → 0 actions; `fortigate-firewall get_devices_list`
  → `unknown_operation`), so the agent correctly emitted a capability_gap rather
  than inventing an action_card. Now **ENV-SKIP**, not FAIL.

**Harness bugs the GA run exposed (all fixed + tested):**
1. **Tool-error attribution was blank on EVERY live run.** Live `tool_result`
   frames carry only `{tool_use_id, content}` — no `.tool`; `digestFrames` read
   `f.tool` and got `""`, so every error printed as "✗  {json}" with no tool
   name. Survived because the offline suite's synthetic frames set `.tool`,
   encoding a shape the wire never produces. Now resolved via a tool_use_id →
   name index; tests use the real wire shape.
2. **An empty capture was blamed on the agent.** T2 once returned 0 frames AND 0
   chat_turn requests (the prompt never reached the connector), and the eval
   reported "FAIL (no-investigation) — an LLM summarizer that narrated the seed
   context" — a confident accusation about a turn that never ran. Zero frames is
   now `FAIL (no turn captured)` + `driveError` (blocks every gate).
   **KNOWN FLAKE, open:** why the composer accepts the prompt but no `chat_turn`
   fires (~1 row in 14 observed). Deliberately NOT auto-retried — a retry risks
   double-sending a turn that was merely slow.
3. **ENV-SKIP had to be narrow.** T2 and T4 BOTH end in a `capability_gap` card,
   but only T4's is the box's fault. A naive "capability_gap ⇒ env" rule would
   have masked T2's real defect, so ENV-SKIP fires only when containment was the
   ASK (`kind:"containment"`) and the connector reported zero actions.

**Three-run aggregate (the only honest way to read a stochastic suite):**

| row | r1 | r2 | r3 | read |
|---|---|---|---|---|
| T1 | PASS | PASS(minor) | PASS | consistently clean → safe to gate `strict` |
| T2 | FAIL (drift) | FAIL (no turn — harness flake) | FAIL (drift, 0 errors) | **3/3 FAIL — real defect** |
| T3 | PASS | PASS | DEGRADED (4 err) | varies on env tool errors |
| T4 | FAIL→ENV-SKIP | ENV-SKIP | ENV-SKIP | env, correct behaviour |
| T7 | PASS(minor) | DEGRADED (5 err) | PASS(minor) | varies on env tool errors |
| P1 | PASS(minor) | PASS | PASS | consistently clean → safe to gate `strict` |
| T11 | PASS(minor) | PASS(minor) | PASS(minor) | stable |

**T2 is REPRODUCIBLE (3/3), and run 3 is the cleanest proof:** a fully successful
hunt — 13 tools, **0 errors**, found related alerts, enriched them — then
`find_containment_actions` → `emit_capability_gap_card("ip_containment")`, closing
with *"I need to fix the IP containment gap so we can actually block the C2."* It
was asked to hunt and consolidate, never to contain. Not an env problem: nothing
errored. This is the `system_prompt_triage.md` hunt-vs-containment fix not holding.

**Gating recommendation, revised BY this data:** T1 + P1 are clean 3/3 → gate
`strict`. **Do NOT gate T3/T7 strict on GA** — each went DEGRADED in 1 of 3 runs
purely from env tool errors (`faz_*`/`fmg_*` `unknown_connector`), so strict would
flake on a box limitation. This directly contradicts the earlier
"T3/T7 → strict" note, which was extrapolated from 8.0/159 evidence and never
observed on GA — the reason gates must follow box-local observation, not
inference.

## Grader red-flag codes (extend as new failure classes surface)
`triage_guard_in_build`, `trace_tool_no_trace`, `crud_searched_as_connector_op`,
`mount_module_leaked_into_start`, `native_action_as_wrong_step_type`,
`hallucinated_http_endpoint`. Add a rule in `RED_FLAG_RULES` + a case in
`exportGrader.test.js` for each new class caught from a live export. Rules run
over a shared digest contract, so one rule grades **both** a downloaded export
(`digestExport`) and a live matrix capture (`digestLive`) — write it once.

**Gotcha when writing a rule:** key off the tool RESULT PAYLOAD, not the status.
The same guard call is `resultStatus:"error"` in an offline export but status
`"ok"` live, because `matrixDriver.isErr()` deliberately classifies
`kind:"guard_redirect"` as steering rather than a tool error. A status-based rule
fires offline and silently misses live (pinned by a test in
`exportGrader.test.js`).
