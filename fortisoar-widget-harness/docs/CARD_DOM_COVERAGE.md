# What we actually claim about each analyst-facing card

Tracker #105, Phase 4 of PLAN_testing_that_can_fail.

**The matrix grades the wire.** It digests transcript frames, so a row can
verdict PASS while the analyst's screen says the opposite -- which is exactly how
#90 survived: the frames were perfect (`triggered:true`, a `run_pk`, a
`manual_input` frame) while the approval card told the analyst their live, parked
run had not run.

Hermetic e2e specs close the render half against a **fixture**, and #104 is the
standing reminder that a fixture is its author's belief about the wire. So
"hermetic-only" is a real claim with a real limit, not a synonym for covered:

> *hermetic-only means: given this payload, the widget renders and behaves this
> way. It does NOT claim the connector ever sends that payload, and it does not
> claim the deployed widget on a box behaves the same.*

This file is the written, per-card admission #105 asks for. It is **enforced**:
`tests/cardDomCoverage.test.js` discovers the card types from the renderer's own
dispatch chain, so a card type added tomorrow fails the gate until it is
classified here, and a row for a card that no longer exists fails too.

## Tiers

| tier | means |
|---|---|
| `live-dom` | a live spec drives this card on a real box and asserts the DOM. Must be backed by a spec carrying `@covers-card-live: <type>`. |
| `hermetic-only` | render is pinned against a fixture only. The note says what that does not cover. |
| `not-a-card` | display-only frame; nothing for the analyst to act on. |

## The registry

| type | tier | evidence, or what we are NOT claiming |
|---|---|---|
| `approval_request` | live-dom | `tests/live/approvalToManualInput.live.test.js` -- approve on a real box, real parked run, DOM asserted. The #90 arc. |
| `manual_input` | live-dom | same spec: the parked run's form renders live and the submission resumes the run. NOT claimed: the card's DEADLINE states. The countdown chip, the expired chip, and the refusal to submit past zero (#124) are proven by unit tests over the clock, the renderer and the controller (`widgets-src/fortiaiAgenticAssistant/tests/manualInput.expiry.test.js`, each assertion mutation-checked) -- no spec has watched a gate lapse on a box, because that means holding a real timed step open until its timeout branch fires. |
| `playbook_offer` | live-dom | `widgets-src/fortiaiAgenticAssistant/tests/e2e/fortiaiAgenticAssistant.createPlaybookLive.spec.js` clicks `playbook-offer-accept-*` on a box and verifies the workflow exists. NARROW: it proves accept-and-push, not the card's full render (draft steps, editable title, decline). |
| `action_card` | live-dom | `tests/live/actionCard.live.test.js` -- a real containment ask on a real box stages `fortigate-firewall.block_ip_new`, and the spec asserts the arg CONTROLS carry the analyst's IP (`10.100.88.102` came back in the live values), that Confirm and Cancel are both live, and that an unconfirmed card never reads as executed. It stops AT the staged card: Confirm is not clicked, so no containment is pushed to the lab firewall. NOT claimed: the post-Confirm execution path, and that a LIVE connector's `context_match` is right on a box (#120 is unit-tested only). |
| `choice_card` | live-dom | `tests/live/choiceCard.live.test.js` -- a deliberately two-way ask ("handle this, but I am not telling you how") against a real box produces a real branch card (id `choose_brute_force_response`), and the spec asserts the prompt is on screen, that at least two chips render, and that every chip is labelled and enabled. That last one is the point: the turn is BLOCKED on the pick, so a card whose chips fail to render is an unanswerable question, not a cosmetic bug. No chip is clicked -- picking commits the turn down a branch that on one side leads to staging containment against a real box. STILL NOT claimed, unchanged by this spec: live multi-select bounds (`minSelect`/`maxSelect`), or that a live choice resolution reaches the connector. A single-select branch is what the agent emits naturally; forcing multi-select with a contrived prompt would prove less than it appears to. |
| `capability_gap` | hermetic-only | fixture-pinned only, and **three live attempts failed to reach it** -- recorded here so nobody re-runs them. (1) "disable this AD account": the agent found ONE partially-relevant configured action (a FortiSIEM OAuth revoke), and the gap branch in `find_containment_actions` is `if not actions:`, so a near-miss suppresses the card and the analyst gets prose ending in "What would you prefer?" -- filed as #125. (2) "block this domain": zero DOMAIN actions, but the agent generalised onto the configured firewall's URL filtering and staged an approval instead. (3) "pull this phishing mail from every mailbox": the agent grounded on the mounted alert, correctly saw an IPS/network alert with no email indicators, and asked for the missing indicator rather than inventing one. (3) is not fixable by a better prompt: that box's alert corpus is ENTIRELY network-traffic and log-delay alerts, so every containment ask consistent with a real record routes to the configured firewall or EDR -- precisely where the gap branch cannot fire. The capability the box lacks and the alerts the box has do not intersect. NOT claimed: that a real unconfigured connector produces a gap card whose resume option works on a box. Reaching it live needs the box PERTURBED (seed a phishing alert, or un-configure a connector), which outlives the run and is a different bargain from reading the box. |
| `patch_proposal` | live-dom | `tests/live/patchProposal.live.test.js` -- a narrow one-field change request against a real open playbook on a box produces a real patch card (id `fix-step-name-case`), and the spec asserts the title, rationale, target and BOTH before/after snippets are in the DOM. Green 2026-08-12 on fsr-playbooks 0.6.19 / connector 0.5.114, which is what removed the second approval that had blocked it (the change-affordance gate escalated the write frontier for a pure emit; `CHANGE_GATED_TOOLS` is now empty). It stops AT the proposed card: **Apply is deliberately not clicked**, because applying writes into a real playbook. NOT claimed: that a live Apply lands the edit, or that the resumed turn reflects it in the DOM -- that half stays fixture-pinned by `applyPatchResume`. |
| `enhancement_offer` | live-dom | `tests/live/enhancementOffer.live.test.js` -- a whole-doc change request against a real open playbook on a box produces a real offer card (id `add_error_handling_…`), and the spec asserts a change row exists, that the "Review the full playbook" toggle expands to non-empty YAML that parses as a playbook, and that Apply and Not-now are both live. This matters more here than elsewhere because the card is dispatched via `(ev as any)` -- it is not in the `RenderEvent` union, so the type checker never saw it and only a live payload can. It stops AT the offered card: **Apply is deliberately not clicked**, because applying overwrites a real playbook. NOT claimed: that a live Apply lands the edit (hermetic: `enhancementOffer.apply.controller.test.js`), or that the warnings row renders live -- a clean enhancement has none, and manufacturing one means proposing a knowingly bad edit. |
| `text` | not-a-card | prose. |
| `tool_use` | not-a-card | call display; no analyst affordance. |
| `tool_result` | not-a-card | result display; no analyst affordance. |
| `status_card` | not-a-card | display-only summary. |
| `info_card` | not-a-card | display-only; the push result arrives this way but carries no control. |
| `ioc_card` | not-a-card | display-only enrichment. |
| `activity` | not-a-card | progress line. |
| `error` | not-a-card | error display. |

## What would close the gap

One live DOM spec per `hermetic-only` row, modelled on
`approvalToManualInput.live.test.js` -- which has the shape worth copying (all
five learned the hard way): assert on the DOM and never on
`window.__fortiaiAgenticAssistant__` (localhost-gated, so live it silently
compares against `undefined`); scope transcript reads to `.pb-message`; scope
answer assertions to `chat-message-assistant-*`; settle the previous turn before
measuring a delta; and separate drive failure from product failure at every step.

Each such spec runs a real mutating playbook on a real box. That was five specs
when this file was written. Four have since been claimed -- `patch_proposal`,
`enhancement_offer`, `choice_card` -- leaving **`capability_gap`** as the single
open row.

It is open for a reason worth stating, because it is not laziness and not a
widget defect: the card fires only when the instance CANNOT do what was asked,
and a working demo box is configured precisely so that it can. Three live
attempts are recorded in its registry row above. The blocker is not the prompt;
it is that the capability the box lacks and the alerts the box has do not
intersect. `tests/live/capabilityGap.live.test.js` exists and is sound, but is
opt-in behind `CG_ENABLE=1` rather than red on every live run.

Closing it needs the box PERTURBED rather than read -- seed an alert the ask can
ground on, or un-configure a connector -- and that outlives the run for whoever
picks the box up next. That is a decision to take deliberately, not a step to
slip into a test.

This file remains the cheap end, and a legitimate stopping point on its own: an
honest documented gap beats a gate that implies coverage it does not have.
