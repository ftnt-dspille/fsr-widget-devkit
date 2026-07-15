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
