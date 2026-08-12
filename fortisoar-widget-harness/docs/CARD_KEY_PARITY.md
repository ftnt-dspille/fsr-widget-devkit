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

`tests/cardKeyParity.test.js` compares every card frame in the fixtures against
the keys the renderer reads **for that card type**. Per-type matters:
`after_yaml` IS read by `patch_proposal`, which is precisely why a file-wide
read set would have missed the bug above.

Every unread key must appear below with a reason. A key that is not listed fails
the gate; a listed key that is no longer unread fails too, so a row cannot
outlive the thing it explains.

`UNTRIAGED` is a real, visible state. These were found by the audit, and I have
not confirmed whether the widget should render them or the fixture should stop
sending them. Naming them beats both silence and a guess -- but do not read a
`UNTRIAGED` row as "fine".

| card | key | status | reason |
|---|---|---|---|
| `enhancement_offer` | `diff_summary` | by-design | The producer sends both the structured diff and the flattened `steps_added/removed/modified` lists; the card renders the flat lists. Kept in the fixture because the fixture's job is mirroring the wire, not the renderer. |
| `approval_request` | `args_hash` | by-design | Integrity handle for the connector's own tamper check on approved args. Never displayed; the analyst reads the args, not their hash. |
| `approval_request` | `tier` | UNTRIAGED | The gating tier of the action being approved. Arguably belongs on the card -- "this is a tier-3 write" is exactly the P2 signal an analyst wants -- but nothing renders it today. |
| `approval_request` | `reason` | UNTRIAGED | The machine-readable why (`unrequested_change`). The card carries the same thing as prose in `summary`, so today it is redundant rather than lost. |
| `approval_request` | `context` | UNTRIAGED | Only on the superseded `approval_run_playbook_old` fixture. Likely dead with that shape. |
| `approval_request` | `editable_fields` | UNTRIAGED | Read by `normalizeActionCard`, not by the approval branch: an approval card advertising editable fields is not editable. Either the approval path should honour it or the fixtures should stop sending it. |
