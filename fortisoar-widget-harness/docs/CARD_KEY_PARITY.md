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
| `approval_request` | `reason` | UNTRIAGED | The machine-readable why (`unrequested_change`). Fixture-only -- no capture carries it, so it is unverified against the wire as well as unread. The same information reaches the analyst as prose in `summary`, so today it is redundant rather than lost: render it as a chip, or stop sending it. Tracker #124. |

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
