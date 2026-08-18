# Card keys the widget does not read

A card key that no renderer branch reads is one of two bugs wearing the same
face, and both look exactly like the feature not existing:

- **the #78 shape** -- a live producer with no consumer. The connector shipped
  `target` / `changes` / `context_match` on record-write approvals for months;
  `normalizeActionCard` read none of them, so the analyst kept seeing an args
  blob. Tests were green on both sides, because each repo tested its own half.
- **the #104 shape** -- a fixture inventing a key the producer does not send.
  `unrequested_change.json` sent an `enhancement_offer` with `after_yaml` +
  `diff` where the producer sends `final_yaml` + `steps_*`. The renderer read
  neither, so the card carried an empty payload and a zero change count, and the
  e2e spec passed because it only asked whether the Apply button existed. An
  Apply button over nothing is the worst version of that card.

`tests/cardKeyParity.test.js` compares every card frame -- **in the fixtures AND
in the live captures** -- against the keys the renderer reads for that card type.

Both sources matter, for different reasons:

- per-type comparison is what catches the #104 shape. `after_yaml` IS read by
  `patch_proposal`, which is precisely why a file-wide read set would have missed
  the enhancement_offer bug.
- **captures are what catch the #78 shape.** A fixture is its author's belief
  about the wire, so auditing only fixtures makes the audit inherit their blind
  spots. `tier`, `requires_step_up`, `cursor`, a run-history `context` block and
  the manual-input deadline are on every recorded card and were in *no* fixture
  at all -- invisible until the captures were read.

Every unread key must appear below with a reason. A key that is not listed fails
the gate; a listed key that is no longer unread fails too, so a row cannot
outlive the thing it explains.

`UNTRIAGED` is a real, visible state: found by the audit, evidenced on the wire,
and not yet decided. It is not a synonym for "fine".

| card | key | status | reason |
|---|---|---|---|
| `approval_request` | `args_hash` | by-design | Integrity handle for the connector's own tamper check on approved args. Never displayed; the analyst reads the args, not their hash. |
| `approval_request` | `cursor` | by-design | Transcript position for the connector's own resume bookkeeping. Nothing for the analyst to read. |

<!-- `approval_request` / `reason` was the last UNTRIAGED row, and triaging it
     found the #78 shape rather than the redundancy the row assumed. The row
     read "the same information reaches the analyst as prose in `summary`, so
     it is redundant rather than lost: render it as a chip, or stop sending
     it." Both halves were wrong, and the second would have deleted a real
     feature:

     - the producer is live (`fsr_playbooks/llm/tools.py`), not fixture-only.
       Its branch is DORMANT, gated on `CHANGE_GATED_TOOLS` -- empty today and
       deliberately kept armed by a test on that side. So `reason` is `null` on
       every current capture, which is why the audit read absence-from-captures
       as "unverified". Absence was evidence of dormancy, not of safety.
     - it is not redundant with `summary`. `reason` selects the card's FRAMING,
       which prose cannot do: the connector empties `preview.args` on that
       branch precisely because the card is an offer, so the widget was heading
       a suggestion "Approval required: verify_enhancement" -- a raw tool name
       -- over an empty arg table with a green Approve button.

     The widget now reads it (`isOffer`): the head becomes "Suggested change"
     and the buttons "Draft it" / "No thanks". Covered by
     `tests/approval.unrequestedChange.test.js`, firing/silencing paired so an
     ordinary containment approval cannot inherit offer framing. #124. -->

<!-- The table above is now entirely `by-design`. That is a state to hold
     deliberately, not a finish line: UNTRIAGED existing is the gate working,
     and the next audit that finds a key should add a row rather than reach for
     a reason to leave one out. -->

<!-- `enhancement_offer` / `diff_summary` was by-design here on the premise
     that the card renders only the flattened `steps_*` lists. #126 killed
     that premise: the key now carries per-step `changes` and the card
     renders them as its body, so the row is gone rather than reworded. -->

<!-- `manual_input` / `expires_at` + `expires_in_seconds` were UNTRIAGED here
     until the card grew a live countdown and a submit that is refused past the
     deadline (#124, the durable half of #77/#79). Both keys are read now, so
     their rows are gone -- a row cannot outlive the thing it explains. The
     connector still folds the countdown into the question prose as well; that
     duplication is deliberate, so an older widget against a current connector
     still says something rather than nothing. -->
