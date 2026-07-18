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

**Status:** IN PROGRESS.

---

## A — Interactive-card feedback & error recovery (highest value)

The approval / manual_input / patch_proposal cards hide their action buttons via
`ng-if="!ev._resolved"` **before** the network call, with no in-flight state and
no recovery path.

- **A1 — No in-flight feedback.** accept/reject/apply/submit buttons vanish
  instantly; no spinner/disabled state. `view.html:1836` (patch), `:1898`
  (manual_input), `:2194` (approval); handlers `view.controller.js:1174`,
  `:1280`, `:942`. Add a per-card `_submitting` state → disabled buttons +
  spinner; only flip `_resolved` on success.
- **A2 — No card-level error recovery.** On failure the card stays
  `_resolved=true`, buttons gone, error only in the global banner
  (`view.controller.js:3215`) → user can't retry from the card. On failure,
  clear `_submitting`, keep the card actionable, show an inline error + retry.
- **A3 — manual_input has no validation UI.** No required markers, no
  submit-gating (unlike `action_card`'s `ng-disabled="!actionCardValid(ev)"`),
  no inline field errors. `view.html:1860-1896`.
- **A4 — Inconsistent `viewState` gating.** Composer & value-patch buttons gate
  on `viewState`; interactive cards don't. Fold into A1's disabled logic.
- **A5 — (opt) "Always allow" grant** exists only on `action_card`
  (`view.html:1797`); patch_proposal / approval have tiers but no grant UI.

## B — Everyday UX: scroll, focus, keyboard, theme

- **B1 — No auto-scroll to bottom** on new/streamed messages
  (`view.controller.js` append flow ~`:3018`). Cheap, high-impact. Pin-to-bottom
  unless the user has scrolled up.
- **B2 — Focus not restored** to the composer after send (`:886`).
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
1. **B0** — info_card overwrite (functional bug, foundational to card correctness). ← current
2. **A1–A4** — interactive-card in-flight/error/validation (core HITL flows).
3. **B1 + B2** — auto-scroll + focus restore (cheap, daily-visible).
4. **C1–C4** — render robustness.
5. **B3/B4/B5, A5, C5** — a11y, theme, polish (batchable).

Each item ships with tests (jest for logic, e2e for DOM) per repo policy.
