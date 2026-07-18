---
title: SOC assistant widget — UI gaps + hardening plan
status: in-progress
owner: Lane A (frontend — widget + harness)
created: 2026-07-18
widget: fortiaiAgenticAssistant (widgets-src/, own git repo, branch master)
related: build-persona-validation-plan.md, STATUS.md (session 3h Lane A)
---

# SOC assistant widget — UI gaps + hardening

Lane A work is on the **UI of the SOC assistant widget** (`fortiaiAgenticAssistant`).
This plan captures the gap audit (3 parallel UI audits, 2026-07-18) plus a
user-reported functional bug, groups them into workstreams, and tracks progress.

Files: `widget/view.html` (~2600 lines, incl. inline `<style>`),
`widget/view.controller.js` (~4188), `widget/widgetAssets/js/fsrPbRender.ts`
(+compiled `.js`). Tests: jest (`tests/*.test.js`) for controller/render logic,
Playwright e2e (`tests/e2e/*.spec.js`) for DOM. Ship/test only via the parent
Makefile (`make test-unit WIDGET=fortiaiAgenticAssistant`, `make test-e2e-spec`).

> ⚠️ The widget working tree interleaves another session's **manual_input WIP**
> (`manualInput.*` tests, `manual_input_form.json`, and edits inside
> `view.controller.js` / `view.html` / `contract.d.ts` / `fsrPbRender.ts`). Scope
> every commit to this plan's files/hunks; do NOT stash or commit foreign WIP.

---

## B0 — 🐛 info_card overwrites other tools/content (USER-REPORTED; lead item)

**Symptom (user):** "info card blocks show up at odd times and seem to overwrite
other tools or content, hard to explain."

**Lead root cause (to confirm with a repro):** the streaming preview rebuilds
`msg.events` from scratch every ~700ms poll (`view.controller.js` `_pollStream` →
`buildAssistantMessage(s.frames, …)`), and the timeline is tracked by
`ng-repeat="ev in msg.events track by (ev._toolUseId || $index)"`
(`view.html:1698`). Only `tool_call` events carry a stable `_toolUseId`;
`info_card` / `status_card` / `ioc_card` / `activity` / `text` / cards fall back
to **positional `$index`**. As tool frames interleave and reshape the array
between polls, a card's `$index` maps onto a DOM node/scope that previously held
a different event type → Angular reuses that node and the card renders into /
overwrites another slot. Compounded by `normalizeInfoCard` giving an idless card
`cardId: 'card-' + _now(opts)` (`fsrPbRender.ts:683`), regenerated each rebuild —
no stable identity across polls.

**Fix:** assign every event a stable, unique key in `buildAssistantMessage`
(e.g. `_key` derived from `_toolUseId` else a monotonic per-build seq that is
stable across rebuilds because frame order is stable — or a content hash), carry
`cardId` stably for idless cards, and change the timeline `track by` to
`ev._key`. Verify with a jest test that rebuilding from a growing frame list
keeps each card's key stable, plus an e2e that streams tool→info_card→tool and
asserts no slot collision.

**Status:** ✅ FIXED + tested (uncommitted in widget repo — interleaved with the
manual_input WIP). Stable per-event `_key` stamped in `buildAssistantMessage`
(`fsrPbRender.ts`, recompiled `.js` with the repo's tsc 6.0.3); idless `card-<n>`
ids pinned to the key; timeline `track by ev._key` (`view.html:1698`). Tests: 4
new jest cases in `render.pipeline.test.ts` (unique keys, key stable across an
incremental streaming rebuild, two idless cards get distinct pinned ids,
connector id preserved) — full unit suite **729 passed**; e2e `rendering.spec`
6/6 incl. "info_cards renders all card kinds". Repro-on-box still worth a glance
but the structural defect is closed.

---

## A — Interactive-card feedback & error recovery (highest value)

The approval / manual_input / patch_proposal cards hide their action buttons via
`ng-if="!ev._resolved"` **before** the network call, with no in-flight state and
no recovery path.

- **A1 — ✅ DONE (widget `af11159`).** Per-card `_submitting` state across all
  four interactive cards (action_card, patch_proposal, manual_input, approval):
  buttons disable + show an inline spinner and the card stays put; `_resolved`/
  `_outcome` flip only on SUCCESS. Shared `_resolveCardVia` orchestrator; the
  `_runResume*` helpers now return the resume promise so card handlers chain
  success/failure independently of the global `_handleTurnResult` path.
- **A2 — ✅ DONE (widget `af11159`).** On failure `_resolveCardVia` clears
  `_submitting`, stamps a secret-scrubbed `_error` on the card (inline `.card-error`
  with a "retry from the buttons above" hint), and leaves it unresolved so the
  same buttons retry in place. Global banner still shows too. +5 jest
  (`card.inflight-error.test.js`) + 1 e2e (`cardInflightError.spec.js`, 503-then-
  retry via new `manual_input_error` fixture).
- **A3 — ✅ DONE (widget `41cb5be`).** manual_input now has required-field
  validation at parity with `action_card`: `required` carried through
  `normalizeManualFields`, pure `manualInputComplete` gate (dynamic_list needs
  group+item; required checkbox checked; others non-empty), required stars,
  `ng-disabled="!manualInputValid(ev)"` submit-gating, and a "fill required
  fields" hint. Typed `ManualInputField` in contract. +6 jest + e2e gating case.
  (Completed as the manual_input-WIP merge-point work.)
- **A4 — ✅ DONE (widget `af11159`).** `cardBusy(ev)` gates every interactive
  card's buttons — busy while its own resume is in flight (`_submitting`) OR any
  turn is streaming (`viewState === 'sending'`), but deliberately NOT on
  `viewState === 'error'` so a failed card stays retryable. Folded into A1's
  disabled logic across all four cards.
- **A5 — (opt) "Always allow" grant** exists only on `action_card`
  (`view.html:1797`); patch_proposal / approval have tiers but no grant UI.

## B — Everyday UX: scroll, focus, keyboard, theme

- **B1 — ✅ DONE (widget `21926fd`).** Transcript pins to the latest content as
  messages append and the live preview streams in, unless the analyst scrolled up
  (scroll listener releases the pin past a 48px slop, re-arms near bottom); the
  analyst's own send always re-pins. Driven by a per-digest content signal
  (message count + preview event/text growth); scroll deferred a tick for layout.
- **B2 — ✅ DONE (widget `21926fd`).** Composer regains focus on the sending→idle
  transition after a USER send (disabled mid-turn, so restored on settle), gated
  on `_wantComposerFocus` so card resume / history load / entity seed don't steal
  focus. +2 e2e (`scrollFocus.spec.js`).
- **B3 — a11y:** only 1 aria-label in the widget; no `aria-live` on the
  transcript; no focus move to a newly-rendered card; quick-action/choice chips
  lack labels. `view.html:1523`, `:1680`, `:2249`.
- **B4 — Theme:** hardcoded hex on Stop button + connector-gate/version badges
  break light theme (`view.html:2338`, `:2310`, `:1530`, `:1585`). Move to CSS
  vars with a `.theme-light` override.
- **B5 — Overflow:** long tool/skill names (`.step-name`, `view.html:1919`) wrap
  and shove siblings; add `min-width:0` + ellipsis on the flex row.

## C — Render robustness (defensive)

- **C1 — Unknown block kinds render blank** in `info_card` (`view.html:2104`,
  the six-`ng-if` set) and unknown `draftStep` kinds in `playbook_offer`
  (`:2000`). Add a catch-all that renders the raw block rather than nothing.
- **C2 — capability_gap `tips`/`alternatives` unnormalized** (`fsrPbRender.ts:896`)
  — template assumes `.text`/`.hint`/`.label`/`.value`. Normalize like other cards.
- **C3 — Table row/column mismatch** unguarded (`view.html:2133`); pad/clip rows
  to `columns.length`.
- **C4 — Catch-all exclusion list incomplete** (`view.html:2214`, missing
  patch_proposal/playbook_offer/error) — semantically fragile; tighten.
- **C5 — Score `max===0`** suppresses the `/max` suffix (`view.html:2128`); minor.

---

## Order of execution
1. **B0** — ✅ info_card overwrite (functional bug, foundational to card correctness).
2. **A1–A4** — ✅ interactive-card in-flight/error/validation (core HITL flows).
   A3 (`41cb5be`) + A1/A2/A4 (`af11159`) all landed.
3. **B1 + B2** — ✅ auto-scroll + focus restore (widget `21926fd`).
4. **C1–C4** — render robustness. ← current
5. **B3/B4/B5, A5, C5** — a11y, theme, polish (batchable).

Each item ships with tests (jest for logic, e2e for DOM) per repo policy.
