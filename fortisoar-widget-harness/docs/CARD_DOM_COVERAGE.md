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
| `capability_gap` | live-dom | `tests/live/capabilityGap.live.test.js` -- a mailbox-purge ask against a real box, where no configured connector can touch mail, produces a real gap card (id `capgap_email`), and the spec asserts it names what is missing and why, renders at least one fix step, and carries a live resume button. Fix steps are the assertion that matters: the emit tool rejects an empty `fix_steps`, so zero rendered steps means a dead end wearing a capability-gap costume. Resume is NOT clicked -- on a box where the gap is real it just loops back to the same card. OPT-IN behind `CG_ENABLE=1` because it has a precondition the other specs do not: a **seeded** phishing alert (module `alerts`, type Phishing, the four email fields populated, name prefixed `[TEST-105]`). That seeding is the whole story of this row -- the box always had the capability gap (no configured mail connector); what it lacked was a RECORD an email-remediation ask could ground on, so three earlier attempts failed for three different correct reasons (see the spec header). NOT claimed: the post-resume arc, and that a gap card raised by an un-configured connector behaves the same as one raised by an absent capability. |
| `patch_proposal` | live-dom | `tests/live/patchProposal.live.test.js` -- a narrow one-field change request against a real open playbook on a box produces a real patch card (id `fix-step-name-case`), and the spec asserts the title, rationale, target and BOTH before/after snippets are in the DOM. Green 2026-08-12 on fsr-playbooks 0.6.19 / connector 0.5.114, which is what removed the second approval that had blocked it (the change-affordance gate escalated the write frontier for a pure emit; `CHANGE_GATED_TOOLS` is now empty). It stops AT the proposed card: **Apply is deliberately not clicked**, because applying writes into a real playbook. NOT claimed: that a live Apply lands the edit, or that the resumed turn reflects it in the DOM -- that half stays fixture-pinned by `applyPatchResume`. |
| `enhancement_offer` | live-dom | `tests/live/enhancementOffer.live.test.js` -- a whole-doc change request against a real open playbook on a box produces a real offer card (id `add_error_handling_…`), and the spec asserts a change row exists, that the "Review the full playbook" toggle expands to non-empty YAML that parses as a playbook, and that Apply and Not-now are both live. This matters more here than elsewhere because the card is dispatched via `(ev as any)` -- it is not in the `RenderEvent` union, so the type checker never saw it and only a live payload can. It stops AT the offered card: **Apply is deliberately not clicked**, because applying overwrites a real playbook. NOT claimed: that a live Apply lands the edit (hermetic: `enhancementOffer.apply.controller.test.js`), or that the warnings row renders live -- a clean enhancement has none, and manufacturing one means proposing a knowingly bad edit. **NOT claimed since #126, and this is the part to re-run:** the card now leads with a step-level before/after diff and the spec demands it, but no box has drawn one yet -- the framework half shipped in the same change, so the deployed box must carry it before this row's diff assertion means anything. The diff itself is fixture-pinned (`enhancementOffer.render.test.js`). |
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

**There is no `hermetic-only` row left.** All five specs #105 asked for exist:
`patch_proposal`, `enhancement_offer`, `choice_card` and `capability_gap` joined
the three that were already there.

What the last one taught, because it is the reusable part: a card that fires
only when the instance CANNOT do something is unreachable on a healthy demo box
by construction, and three attempts failed before the actual precondition became
visible. It was not the one assumed. The box always had the capability gap -- no
configured mail connector -- what it lacked was a RECORD an email-remediation ask
could ground on, because its whole alert corpus is network traffic. The agent
refusing to invent an email indicator for an IPS alert was correct behaviour,
and reading that refusal as the blocker is what pointed at seeding.

So the cost was one seeded alert, not an un-configured connector. When a live
spec cannot reach its card, check what the agent is being asked to ground on
before concluding the capability is the thing in the way.

Two limits this file still carries, and they are not bookkeeping:
- `capability_gap` is opt-in behind `CG_ENABLE=1` because it needs that seeded
  record. A box without it should report "skipped", never red.
- Every one of these specs stops AT its card. Not one clicks the button that
  writes: Apply, Confirm, Resume and the choice chips are all deliberately
  unclicked, because each of them mutates a real box. **The post-click half of
  every card in this file remains fixture-pinned.** That is the honest shape of
  what #105 bought -- the render half, proven against real payloads.
