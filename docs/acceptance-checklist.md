---
title: "App-works acceptance checklist"
status: living
owner: fortiaiAgenticAssistant
summary: "The end-to-end 'the app actually works' pass for the SOC-assistant widget + connector. Phase 0.6 of the stability & scalability plan — run box-free where possible (make turn-hermetic), live once per release and record the date + box below."
---

# App-works acceptance checklist

The single "does the whole thing work" pass, complementing the automated tiers
(`make test-unit`, mock e2e, `make turn-hermetic`, live matrix). Each row names
**how** it's covered: `hermetic` = provable box-free (`make turn-hermetic` /
mock e2e), `live` = needs a real appliance window. Run the `live` rows once per
release and record the result at the bottom.

## Core turn loop
- [ ] **Mount (triage)** — open on an `alerts`/`incidents` record; the composer,
      persona greeting, and quick-action deck render. _(hermetic — seamHermetic
      spec boots the real controller)_
- [ ] **Mount (build/designer)** — open in the playbook designer; the YAML pane
      + build quick-actions render; `decompile_playbook` seeds `currentYaml`.
      _(live — decompile always hits the live connector)_
- [ ] **Send a turn** — type a message → a real `chat_turn` runs and the
      assistant transcript renders in the timeline. _(hermetic)_
- [ ] **Tool card** — a turn that calls a tool renders the tool_call card with
      input + result. _(hermetic once scripted-tool fake turns land (0.4/0.3
      follow-up); live today)_
- [ ] **Streaming** — the working indicator holds for the whole send; live
      preview frames coalesce into the committed message without a re-layout
      jump. _(hermetic — smoke e2e; live for real SSE cadence)_

## State & correctness (the Phase-1/2 surface)
- [ ] **History rehydrate** — reload mid-session; prior turns + the created-
      playbook link + the YAML draft restore. _(hermetic — smoke e2e)_
- [ ] **No duplicate timeline entries** — a poll-terminal / late-return race
      commits each turn's tool calls exactly once (audit/export not double-
      counted). _(hermetic — message.dedup unit; live to confirm the real race)_
- [ ] **No card-state bleed on reload** — after rehydrate, an approval/choice
      card's resolved state stays on its own message. _(hermetic — trackkey unit)_
- [ ] **YAML never truncates on save** — a playbook whose YAML contains a ```
      marker still saves in full (or is refused, never silently clipped).
      _(hermetic — yaml.fence.robust unit)_
- [ ] **Connector redeploy recovery** — redeploy/reconfigure the connector mid-
      session; the next turn self-heals (re-resolves) without a page reload.
      _(hermetic — connectorResolution.invalidate unit; live to confirm end-to-end)_

## Mutations & gates
- [ ] **Create playbook** — Build → Create writes a real playbook; the deep link
      opens it. _(live — a real SOAR mutation)_
- [ ] **Update playbook in place** — designer edit → Save PUTs the open record,
      snapshots a pre-edit restore point, preserves the workflow uuid. _(live)_
- [ ] **Approval gate** — a tier≥3 tool pauses on the inline approval card;
      approve completes, reject returns to idle without looping. _(hermetic —
      smoke e2e; live to confirm the real mutation fires only on approve)_
- [ ] **manual_input form** — an awaiting-input card gates submit on required
      fields, then resumes the turn. _(hermetic — manualInput e2e)_

## Failure surfaces
- [ ] **Compile/validation error** — a broken playbook surfaces inline errors
      and lands in the error state, no silent success. _(hermetic — smoke e2e)_
- [ ] **Connector error** — a rejected `chat_turn` shows the error banner.
      _(hermetic — smoke e2e)_
- [ ] **Hermetic leak guard** — the mock tier fails loudly (`599 HERMETIC-MISS`)
      on any un-snapshotted forticloud call. _(hermetic — globalTeardown gate)_

## Recorded live passes
_Record each release's live run: date, box (generic, per public-repo hygiene),
widget + connector versions, and any row that failed._

| Date | Box | Widget | Connector | Result / notes |
|------|-----|--------|-----------|----------------|
| _pending_ | — | 1.2.27 | — | Phase-1 fixes shipped; live acceptance run not yet recorded. |
