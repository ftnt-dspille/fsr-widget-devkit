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
| `choice_card` | hermetic-only | fixture-pinned only. NOT claimed: live multi-select bounds (`minSelect`/`maxSelect`), or that a live choice resolution reaches the connector. |
| `capability_gap` | hermetic-only | fixture-pinned only. NOT claimed: that a real unconfigured connector produces a gap card whose resume option works on a box. |
| `patch_proposal` | live-dom | `tests/live/patchProposal.live.test.js` -- a narrow one-field change request against a real open playbook on a box produces a real patch card (id `fix-step-name-case`), and the spec asserts the title, rationale, target and BOTH before/after snippets are in the DOM. Green 2026-08-12 on fsr-playbooks 0.6.19 / connector 0.5.114, which is what removed the second approval that had blocked it (the change-affordance gate escalated the write frontier for a pure emit; `CHANGE_GATED_TOOLS` is now empty). It stops AT the proposed card: **Apply is deliberately not clicked**, because applying writes into a real playbook. NOT claimed: that a live Apply lands the edit, or that the resumed turn reflects it in the DOM -- that half stays fixture-pinned by `applyPatchResume`. |
| `enhancement_offer` | hermetic-only | fixture-pinned only, and it is not even in the `RenderEvent` union -- it is dispatched via `(ev as any)`. NOT claimed: anything live. |
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

Each such spec runs a real mutating playbook on a real box. Five of them is the
expensive end of #105 -- this file is the cheap end, and is a legitimate stopping
point on its own: an honest documented gap beats a gate that implies coverage it
does not have.
