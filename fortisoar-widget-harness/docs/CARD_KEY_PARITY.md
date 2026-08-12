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
| `enhancement_offer` | `diff_summary` | by-design | The producer sends both the structured diff and the flattened `steps_added/removed/modified` lists; the card renders the flat lists. Kept in the fixture because the fixture's job is mirroring the wire, not the renderer. |
| `approval_request` | `args_hash` | by-design | Integrity handle for the connector's own tamper check on approved args. Never displayed; the analyst reads the args, not their hash. |
| `approval_request` | `cursor` | by-design | Transcript position for the connector's own resume bookkeeping. Nothing for the analyst to read. |
| `approval_request` | `reason` | UNTRIAGED | The machine-readable why (`unrequested_change`). Fixture-only -- no capture carries it, so it is unverified against the wire as well as unread. The same information reaches the analyst as prose in `summary`, so today it is redundant rather than lost: render it as a chip, or stop sending it. Tracker #124. |
| `manual_input` | `expires_at` | UNTRIAGED | The gate's deadline as a timestamp. Not lost today -- the connector folds the countdown into the question PROSE ("⏱ This form expires in about 0m 56s") -- but nothing structured means no live countdown and no disabled submit after expiry, which is the durable half of #77/#79. |
| `manual_input` | `expires_in_seconds` | UNTRIAGED | Same as above: shipped, evidenced, and read only as prose. |
