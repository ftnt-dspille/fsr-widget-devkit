---
name: fortisoar-platform-gotchas
description: Use when writing code or tests against the FortiSOAR 8.x REST/query API, module metadata, picklists, playbook (workflow) save, widget/solution-pack install, or pyfsr calls, and when an API call returns an opaque 400/500 or silently returns unfiltered data.
---

# FortiSOAR platform and API gotchas

Search `soardocs <query>` first for documented behaviour; this skill holds what the docs miss.
Use pyfsr typed methods (`client.connectors.execute`, `client.playbooks...`), not raw `c.get`/`c.post`:
they carry HMAC signing, envelope parsing and the 8.0 quirks. Verified live on 8.0.x unless noted.

## Query API (`POST /api/query/<module>`)
- `logic: "AND"|"OR"` is REQUIRED with `filters`; without it the filters are silently dropped and you get the
  unfiltered baseline, no error.
- Cross-module filter field is `<currentModule>.uuid` with a bare uuid. `@id` with an IRI is rejected
  ("Field:@id does not exist in module definition").
- Operators: `eq neq lt lte gt gte in nin like notlike contains isnull`. `ne`/`le`/`ge` return 500.
  Datetime filters need `type: "primitive"` + ISO string. `between` is rejected; use `gte` + `lte` under AND.
  `gte`/`lte` skip NULLs. AND on the same field can drop one record (query-planner quirk, tolerate +-1).
- Groupby on a picklist attribute needs the `.itemValue` suffix (plus `.color`, `.orderIndex` for charts);
  plain name returns 400/500. Client code without metadata uses name heuristics, so new picklist names
  (e.g. reputation) fail until added.
- Timestamps are `createDate` / `modifyDate` (epoch floats). `createdOn`/`modifiedOn` return an opaque
  QueryException. `sort: [{field, direction}]` works only on the query API; flat `GET /api/3/<module>` has
  no ordering. Query rows already carry every field (`fields=` costs no extra call).
- Test the same query shape against EVERY applicable module and assert zero failures; one module accidentally
  accepting a bad filter once let a broken shape ship.
- Records link by IRI; "cases" are the `incidents` module on current builds. Platform adds the literal word
  "Array" when a list/dict is saved into a `string` field.
- `$relationships=true` is needed to read relations back when verifying a write.

## Metadata and picklists
- Schema: `/api/3/model_metadatas?$limit=1000&$relationships=true`; field list is `attributes[]`, and
  `attr.type` IS the related module type for relations (primitives: string/integer/boolean/object/picklists).
- Browser console with Chrome: `fetch('/api/3/...')` 403s (JWT is in-memory). Read schemas from the SPA's
  localStorage `cs.metadata.<module>` and `cs.picklists.<Name>`.
- Module sources of truth for UI behaviour: extracted templates/controllers under `fsr_src/` (grep them
  before live-inspecting).

## Playbooks (workflows)
- Create-vs-update is decided on `@id`, not `uuid`. To save in place: GET the live workflow, graft its `@id`s
  onto the compiled body by uuid, then `PUT /api/3/workflows/<uuid>?$relationships=true&$versions=true`.
  A body without `@id` but with the same deterministic uuids dies with UniqueConstraintViolation.
  Be suspicious of any "live-verified" claim for this path that has no read-back.
- `playbooks.get_definition` returns a typed `Workflow` model, not a dict; `isinstance(x, dict)` guards
  silently skip it. Read with `obj.get(k) if isinstance(obj, dict) else getattr(obj, k, None)`.
- Playbook runtime facts (find_record output is a list, set_variable binds at two paths, approval gates are the
  distinct `ApprovalManualInput` step type, full Ansible Jinja filter set) belong to the `fsr-playbooks` skill.

## Principals, teams, agents, licensing
- A principal (user or API key) with no team reads fine but 403s on every create/update ("must be on at least
  one team"). Fix the data (give it a team), not the auth.
- `client.agents.heartbeat` returns in-progress for dead agents too; liveness is `healthCheckLastSync`.
- Duplicate-license lockout (`FSR-Auth-018`) after clone: apply a fresh Flex license (see box-live-runs).

## Widgets and solution packs (API side)
- Widget install: `POST /api/3/solutionpacks/install?$type=widget&$replace=true` (multipart tgz), then publish.
  A 400 `ForeignKeyConstraintViolation ... picklist_uuid` means `info.json` `metadata.category` is not in the
  target box's widget-category picklist: blank it or create the entry; do not hunt inside the package.
- Solution pack imports (`$type=solutionpack`) log "Import completed" but NEVER install bundled `tgz`
  connectors/widgets (SP import skips tgz); install those separately. `info.json contents.widgets` entries are
  `{apiName, name}` (a `title` key empties the list). `$replace` leaves the import job as Draft; only one
  pack install at a time per box (check `/api/3/import_jobs`).
- Widget placement: `metadata.pages` (picker) vs `metadata.view.enableFor` (drawer, UI-Router state names).
- Connector config: `info.json` fields need `"visible": true`; `is_config_required:false` passes `{}`.
- TEST-NET ranges (203.0.113/24, 198.51.100/24, 192.0.2/24) are `is_private` in Python's `ipaddress`; use the
  framework's `is_internal_ip` for "internal" decisions.
- `claude -p` or MCP clients loading a USER-level server with the same name as a project server hit the wrong
  instance. Native MCP gateway tools wrap args under `params` and need `connector:<name>` for connector tools.

Sources: soar_query_filter_uuid, soar_filter_operators, soar_picklist_groupby, soar_query_aggregates,
soar_metadata_shape, search_tool_fields_sort_and_truncation, update_playbook_write_path_at_identity,
fortisoar_workflow_update_endpoint, pyfsr_get_definition_returns_typed_model, pyfsr_teams_required_guardrail,
widget_category_picklist_fk, solution_pack_install_findings, fortisoar_ui_localstorage_schema_cache,
fsr_agent_liveness_test, testnet_ips_are_not_internal. Note pyfsr_teams_required_guardrail's code fix is on an
unmerged branch.
