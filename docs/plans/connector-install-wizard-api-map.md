---
title: Connector install/configure/ingestion wizard — construct + API map
status: draft
category: platform-reference
topics: [connectors, install, configuration, data-ingestion, pyfsr, api]
summary: Every UI construct in the FortiSOAR 7.x/8.x connector install path (Content Hub install → agent install → configuration → health → data ingestion), traced to the exact HTTP call the AngularJS app makes, so the whole flow can be driven headlessly from pyfsr.
---

# Connector install wizard — construct + API map

Source: `fsr_src/app_min/app.beautified.js` (beautified `800_app.min.js`).
Line refs below are into that file and are the authority for payload shapes.

## 0. API base constants (`app.beautified.js:298-360`)

| Symbol | Value |
| --- | --- |
| `API.BASE` | `api/3/` |
| `API.API_3_BASE` | `/api/3/` |
| `API.INTEGRATIONS` | `api/integration/` |
| `API.QUERY` | `api/query/` |
| `API.WORKFLOW` | `api/wf/` |
| `API.MANUAL_TRIGGER` | `api/triggers/1/notrigger/` |
| `API.SOLUTION_PACKS` | `api/3/solutionpacks/` |
| `API.EXPORT` | `api/export/` |

Nearly the whole connector surface lives under **`api/integration/`**, *not* `api/3/`.
That is the single biggest thing to get right in pyfsr: `client.connectors.*`
must target `api/integration/…`, while Content Hub listing/install targets
`api/3/solutionpacks/…`.

---

## 1. The five distinct "wizards" (don't conflate them)

| # | Construct | Where | What it does |
| --- | --- | --- | --- |
| 1 | **Content Hub install** (`marketplaceDetailView` + `installContent`/`installConnector`) | `:54803-55600` | Pull a connector RPM from the repo (or upload a file) and install it on the node |
| 2 | **Agent install** (`agentInstallComponent`, `_onAddAgent`) | `:55058`, `:58369` | Install the *same* connector onto one or more remote agents |
| 3 | **Connector configuration panel** (`connectorConfigurationComponent`) | `:57599-57847` | Create/update/delete named configurations from `config_schema`, mark default, assign teams, run health check |
| 4 | **Data-ingestion wizard** (`ingestionWizard` + `dataIngestionService`) | `:59804-60960` | Clone the connector's tagged sample playbooks into a per-config collection, fetch sample data, map fields, create the cron schedule |
| 5 | **Connector *development* wizard** (`connectorWizard`) | `:55646-56320` | Authoring a *new* connector (metadata → configuration fields → actions → publish). Different endpoints (`connector/development/…`) — not part of install |

Wizards 1–4 are the "install a connector and make it do work" chain. Wizard 5
is content authoring; listed here only so the endpoints aren't mistaken for
install endpoints.

---

## 2. Flow 1 — Install the connector

### 2a. Repo install / upgrade — `installConnector` (`:55476`, service at `:58412`)

```
POST  api/integration/install-connector/?format=json     # fresh install
PUT   api/integration/install-connector/?format=json     # upgrade
```

Body (built at `:55483`):

```json
{
  "name": "fortinet-fortisiem",
  "label": "FortiSIEM",
  "version": "6.0.0",
  "rpm_name": "...",
  "rpm_full_name": "...",
  "category": "SIEM",
  "description": "...",
  "publisher": "Fortinet"
}
```

Rules encoded in the UI:
- `"update"` mode sets `version = newVersion` and switches POST→**PUT**.
- If installing onto agents, add `"agent": [<agentId>, …]` and **delete `rpm_name`**
  (`:55490`). The presence of `agent` is what makes it a remote install.
- Response is async; the UI then polls/subscribes. See §6.

### 2b. Upload a connector tarball — `submitContent` (`:54085`)

```
POST api/integration/import-connector/<basename-of-file>/?replace=<bool>&format=json
     body = raw file
```

`<basename>` is `file.name.split(".")[0]` — i.e. the filename minus extension is
part of the URL, not a form field.

### 2c. Content Hub (solution-pack style) install — `installContent` (`:53988`, `:55165`)

```
POST api/3/solutionpacks/install                 { "name": ..., "version": ... }
POST api/3/solutionpacks/install?$type=<type>&$replace=<bool>   # multipart {file}
DELETE api/3/solutionpacks/uninstall             { ... }
POST api/3/solutionpacks/update
```

Listing/search of installed vs available content is a **query POST**:
`POST api/query/solutionpacks?$limit=&$page=[&$search=]` with
`{sort, page, limit, logic:"AND", filters:[…], __selectFields}`.

### 2d. Uninstall a connector (`:55317`)

```
DELETE api/integration/connectors/<connector-id>/?format=json    (body {})
```
Uninstall is *also* async: the UI then polls `getConnector` every 10s until it
404s (`_getUninstallConnectorStatus`, `:55327`). A 404 is success.

### 2e. Python dependencies (`:58586`)

```
GET  api/integration/connectors/dependencies_check/<name>/<version>/?format=json
POST api/integration/connectors/dependencies_check/<name>/<version>/?format=json[&agent=<id>]
```
GET returns `{dependencies_installed: bool}` → surfaced as
`requirements_installed ∈ {Completed, Failed, In-Progress}`. POST retries the install.

---

## 3. Flow 2 — Install onto agents

```
POST api/integration/connectors/agents/<name>/<version>/?format=json
     query: active=true[&configured=true]      body: {}      → array of agents
```
(`getAgents`, `:58369`.) Each returned agent is decorated client-side with
`isIncompatible` by comparing `agent_version` against
`versionService.getIntergrationVersionDetails().minimum_compatibility_version`
— a **client-side** gate, so a pyfsr caller must replicate it or ignore it.

Per-agent operations from the Agents tab (`:54988-55020`):
- **retry / install** → §2a with `agent: [id]`
- **upgrade** → §2a PUT with `agent: [id]`, `version = selfVersion || version`
- **activate/deactivate** → `updateConnector`:
  `PUT api/integration/connectors/<conn_id>/?format=json` body `{id, active, agent}`
- **uninstall from agent** → `DELETE api/integration/connectors/<conn_id>/?format=json`

Note `conn_id` here is the *per-agent* connector record id, distinct from the
node-local `connectorInfo.id`.

---

## 4. Flow 3 — Configuration (the core of "install wizard")

### 4a. Read the connector + its schema

```
POST api/integration/connectors/<name>/<version>/?format=json   [?agent=<id>]   body {}
```
(`getConnector`, `:58164`.) Returns `{id, name, version, label, status,
config_schema:{fields:[…]}, configuration:[…], tags, ingestion_modes,
ingestion_preferences, operations:[…], is_contain_function_ref}`.

Other reads:
```
GET  api/integration/connectors/?format=json[&status=<s>]&page_size=1000
POST api/integration/connector_details/?format=json&configured=true&agent=all[&exclude=operation]
POST api/integration/connector_details/?format=json&exclude=operation&ingestion_supported=true&ordering=label
POST api/integration/connector_details/<name>/<version>/?operation=<op>
GET  api/integration/annotation/categories/?format=json
GET  api/integration/annotation/[?category=<c>]
GET  api/integration/connectors/?tag_contains=<tag>
```

### 4b. The `config_schema.fields` contract

The UI filters fields through the `connectorFields` filter (`:58103`) before
rendering, and reverses it on save. Rules to reimplement:

- **Visibility:** keep a field if `visible === true` *and*
  (`visible_onchange` undefined or `=== true`); or if `visible` is falsy but
  `visible_onchange` is truthy. Everything else is dropped from the form —
  and therefore never appears in the saved `config`.
- **Conditionals:** `field.onchange` is a map `value → [child fields]`. For
  `type === "multiselect"` the value is an array and each selected value
  contributes its children. Children recurse through the same filter.
- **Flattening on save** (`saveValues`, `:57812`): the payload `config` is a
  **flat** `{field.name: value}` dict, walking `field.parameters` recursively;
  `undefined` becomes `""`.
- **Reading back** (`populateValues`, `:57736`): `field.value = config[field.name]`,
  then recurse into `onchange[value]` — so a stored config is only fully
  reconstructible if you replay the onchange graph.
- **Vault placeholder:** on *create*, the whole `fields` blob is stringified and
  every literal `CONFIG_ID_PLACEHOLDER` is replaced with
  `base64(config_id)` (`:57753`). Any field default referencing the config's own
  id (password-vault paths) depends on this substitution.

### 4c. Create / update / delete a configuration (`updateConnectorConfig`, `:58198`)

```
POST   api/integration/configuration/?format=json          # create (isNew)
PUT    api/integration/configuration/<id>/?format=json      # update
DELETE api/integration/configuration/<id>/?format=json      # delete (body {}, JSON content-type)
```

Payload (`:57786`):

```json
{
  "connector": "<connectorInfo.id>",
  "connector_name": "<name>",
  "connector_version": "<version>",
  "name": "<config label>",
  "config_id": "<uuid the CLIENT generates>",
  "id": "<existing config id, or undefined on create>",
  "default": true,
  "config": { "<flat field name>": "<value>", "...": "..." },
  "teams": [ /* team objects */ ],
  "agent": "<agent id, only in agent mode>"
}
```

Critical, easy-to-miss behaviours:
- **`config_id` is client-generated** (`$window.UUID.generate()`, `:57751`) on
  create. The server does not mint it. pyfsr must generate a UUID4 itself.
- **`default` is exclusive** — the UI clears `default` on all sibling configs
  locally before saving (`removeDefaultFromOthers`, `:57727`); nothing on the
  server does this for you. First config gets `default: true` automatically
  (`setNewConfig`, `:57668`).
- **HTTP 207** on create means partial success → UI shows a warning toast
  (`CONNECTOR.TOASTER_WARNING_CREATE_CONFIG`). Treat 207 as "check it".
- **Delete is a save-shaped call** — `removeConfiguration` splices locally then
  calls `saveConfiguration("deleteConfigAndSave", true)` which routes to the
  DELETE branch with the full payload built anyway.
- Connectors tagged `vault`, `webserver`, `mlengine`, `classifier`
  (`CONNECTOR_CONFIG_EXCLUDE_TAGS`, `:1918`) hide the configuration UI entirely.

### 4d. Health check (`getConnectorHealth`, `:58186`)

```
GET api/integration/connectors/healthcheck/<name>/<version>/?config=<config_id>[&agent=<id>]
```
Two response shapes:
- **synchronous**: `{status, message, last_known_health_time}` — status is one of
  `Available` / `Disconnected` / `Deactivated`.
- **async**: `{id: "<job id>"}` → the UI subscribes to websocket topic `<id>` and
  waits for a message with `status`. For pyfsr: poll the healthcheck GET, or
  re-`getConnector` and read `configuration[].health_status`.

Ingestion is only enabled when `selectedConfiguration.status.toLowerCase() === "available"`
(`checkIngestionEnable`, `:57712`) — i.e. **health must pass before the ingestion
wizard is reachable**.

### 4e. Role-gating actions (`applyRolesToActions`, `:58502`)

```
POST|PUT api/integration/connectors/operations/<operation-id>/roles/    { "roles": [...] }
```
POST when the op had no roles, PUT when replacing.

### 4f. Ad-hoc action execution (`executeConnectorAction`, `:58235`)

```
POST api/integration/execute/?format=json
{ "connector", "version", "config", "operation", "params", "audit", "audit_info"[, "agent"] }
```
Also used by `getFieldData` (dynamic dropdown population inside the config form)
and by `connector_output_schema/<name>/<version>/` for schema inference.

---

## 5. Flow 4 — Data ingestion wizard

Opened from the configuration panel (`dataIngestion()`, `:57821`) only when
health is `Available`. `dataIngestionService.openWizard` (`:60915`) resolves four
things before the modal opens — each is a required API step:

1. `connector` — the connector object (§4a)
2. `currentConfig` — the selected configuration
3. `collectionUUID` — `getIngestionPlaybookCollectionUUID` (`:58386`):
   look up a `workflow_collections` record by `uuid == config.config_id`; if
   absent, **create** one named
   `"<label> <version> <configName>Ingestion(<config_id>)"` with
   `{uuid: config_id, visible: false}`.
4. `metadata` — `getScheduleMetadata` →
   `GET api/integration/data-import/?configuration=<config_id>`

### 5a. Playbook discovery + cloning (`preparePlaybooksForIngestion`, `:60755`)

Ingestion playbooks are identified purely by **record tags**:

```
/api/3/tags/dataingestion   /api/3/tags/fetch   /api/3/tags/create
/api/3/tags/ingest          /api/3/tags/update  /api/3/tags/<connectorName>
```

Steps:
- Load candidate playbooks — either the existing per-config collection
  (`PagedCollection("workflows", …, {collection: <collectionUUID>})`) or the
  connector's sample playbooks (`getSamplePlaybooks`, `POST api/query/workflows?$relationships=true&$export=true&$limit=256`).
- Bucket them by tag into `{fetch, ingest, create, update}`.
- If no `ingest` playbook exists → clone the samples: `exportService.copyEntities`,
  then **rewrite the JSON**:
  - every `globalVars.X` → `globalVars.X_<config_id with - → _>`
  - each step whose `arguments.connector === connector.name` gets
    `arguments.config = config.config_id` and, in agent mode, `arguments.agent = <agent>`
  - the step named `"fetch and create"` gets `arguments.params.create_pb_id = <uuid of the create-tagged playbook>`
  - each cloned playbook gets `collection = /api/3/workflow_collections/<collectionUUID>`
- Persist: `saveIngestionPlaybooks` (`:60860`) →
  `POST api/3/?$relationships=true` (bulk upsert against `API.BASE`) with the array.
  If the collection changed, first hard-delete the old ones:
  `DELETE api/3/delete/workflows?$hardDelete=true` body `{ids: [...]}`.
- Failure modes are tag-shaped: no ingest tag ⇒ error naming `#ingest`,
  `#dataingestion`, or `#<connectorName>`.

### 5b. Sample data

`fetchSampleData` runs the fetch playbook (or a connector action), then persists:

```
POST api/integration/data-import/    { "sample_data": [...], "configuration": "<config_id>" }
```

### 5c. Activate the cloned playbooks (`activateIngestionPlaybooks`, `:60100`)

Load the per-config collection's workflows, set `isActive = true` on each, and
bulk-save via `POST api/3/?$relationships=true`.

### 5d. Schedule (`saveScheduleDetails`, `:60118`; `SchedulesService`, `:24060`)

```
GET    api/wf/api/scheduled/?format=json&task=workflow.tasks.periodic_task[&<filters>]
POST   api/wf/api/scheduled/?format=json                 # create
PUT    api/wf/api/scheduled/<id>/?format=json            # update
DELETE api/wf/api/scheduled/<id>/?format=json
GET    api/wf/api/scheduled/<id>/?format=json
POST   api/wf/api/scheduled/trigger-now/                 { "id": <id> }
POST   api/triggers/1/notrigger/<workflow-uuid>          # run the PB once, now
```

Schedule payload:

```json
{
  "name": "Ingestion_<connector>_<config name>_<config_id>",
  "enabled": true,
  "crontab": {"minute":"01","hour":"0","day_of_week":"*","day_of_month":"*","month_of_year":"*","timezone":"<tz>"},
  "kwargs": {
    "exit_if_running": false,
    "wf_iri": "<@id of the ingest-tagged playbook>",
    "createUser": "<@id of current actor>"
  }
}
```

The default name comes from `_getSchedularName()` (`:60498`):
`"Ingestion_" + connector.name + "_" + config.name + "_" + config.config_id`.
**Live-confirmed on 8.0** — the UI-built FortiGuard Threat Intelligence ingestion
on the test box carries exactly this string as its schedule name, its
`kwargs.name`, *and* the `data-import` record's `name`/`metadata.scheduleName`.
Diverging from it makes an otherwise-working ingestion read as unconfigured in
the *Data Ingestion* screen.

`kwargs.wf` (the full playbook object) is stripped before save; only `wf_iri` is sent.
There is a client-side `validateCronDayOfWeek` guard (`:24089`) that silently
aborts the save on a bad `day_of_week` — replicate or validate server-side.

### 5e. Ingestion metadata record (`makePayloadMetadata`, `:60079`)

```
POST api/integration/data-import/
{
  "name": "<schedule name or config_id>",
  "description": "Metadata for <name>",
  "created_by": "<actor>",        // only on first create
  "modified_by": "<actor>",
  "owners": [],
  "connector": {"name": "...", "version": "..."},
  "configuration": "<config_id>",
  "metadata": {"scheduleId": <id>, "scheduleName": "...", "scheduleStatus": true}
}
```
This record is how the UI later re-finds the schedule for a configuration
(`loadScheduleDetails`, `:60129`): metadata → `scheduleId` → `GET api/wf/api/scheduled/<id>/`.

Which ingestion modes are offered comes from `connector.ingestion_modes`
(`scheduled` / `notification` / `app_push`) and `connector.ingestion_preferences`
(`launch_name`, `modules`) — `:59901`.

---

## 6. Asynchrony — what pyfsr must poll instead of subscribe

The UI leans on STOMP websockets throughout. Headless equivalents:

| UI subscription | Meaning | pyfsr substitute |
| --- | --- | --- |
| topic `connector` | any connector install/uninstall state change | poll `getConnector` / `connectors/?status=` |
| topic `connectorconfiguration/<config_id>` | remote (agent) config push; `remote_status.status ∈ {in-progress, finished, deletion-in-progress}` | poll `getConnector` and read `configuration[].remote_status` |
| topic `<healthcheck job id>` | async health result | re-issue the healthcheck GET |
| playbook status websocket | ingestion sample fetch finished | poll `api/wf` run status |

Connector `status` values seen in the UI: `Completed` (installed & usable),
`Installing`, `Uninstallation in progress`. `contentDetail.installed` is the
Content Hub-level boolean.

---

## 7. Minimum end-to-end sequence for pyfsr

```
1.  POST   api/integration/install-connector/?format=json        {name,label,version,rpm_name,…}
2.  poll   POST api/integration/connectors/<name>/<version>/      until status == "Completed"
3.  GET    api/integration/connectors/dependencies_check/<n>/<v>/ until dependencies_installed
    (retry: POST same URL)
4.  read   config_schema.fields; filter by visible/visible_onchange; walk onchange
5.  cfg_id = uuid4()
    POST   api/integration/configuration/?format=json            {connector, connector_name,
             connector_version, name, config_id, default, config:{flat}, teams:[]}
    (207 ⇒ partial; clear `default` on siblings yourself)
6.  GET    api/integration/connectors/healthcheck/<n>/<v>/?config=<cfg_id>
           → expect status "Available"   (else stop: ingestion is gated on this)
--- ingestion only ---
7.  GET/POST api/3/workflow_collections   (find-or-create by uuid == cfg_id, visible:false)
8.  POST   api/query/workflows?$relationships=true&$export=true&$limit=256   (sample PBs)
    rewrite: globalVars suffix, arguments.config = cfg_id, create_pb_id, collection IRI
    POST   api/3/?$relationships=true    (bulk persist clones)
9.  POST   api/integration/data-import/   {sample_data, configuration: cfg_id}
10. bulk set isActive=true on the collection's workflows → POST api/3/?$relationships=true
11. POST   api/wf/api/scheduled/?format=json   {name, enabled, crontab, kwargs:{wf_iri, exit_if_running, createUser}}
12. POST   api/integration/data-import/   {…, metadata:{scheduleId, scheduleName, scheduleStatus}}
13. (optional) POST api/triggers/1/notrigger/<ingest-pb-uuid>   to run it once now
```

## 7a. Verified live on 8.0 (box 159)

Read-only checks against a UI-built ingestion (FortiGuard Threat Intelligence,
already wired through the real wizard) confirm the derived rules:

- the ingestion collection's **uuid is the `config_id`**, and its name follows
  the `"<label> <version> <config>Ingestion(<config_id>)"` pattern;
- `arguments.config` is stamped **only** on steps whose `arguments.connector` is
  that connector — the `cyops_utilities` steps in the same playbook have no
  `config`, exactly as the rewrite rule predicts;
- `params.create_pb_id` on the *Fetch and Create* step names the **cloned**
  create playbook, not the sample one;
- the `data-import` record's `metadata.scheduleId` is the periodic task's Fernet
  id, and is the only link back from a configuration to its schedule.

FortiSIEM 6.1.1 on the same box is the write-side test bed: `ingestion_supported`
is true, `ingestion_modes` is `["scheduled"]`, and its
`Sample - Fortinet FortiSIEM - 6.1.1` collection ships a `#fetch` playbook plus
an ingest playbook tagged `#ingest #create` **both at once** — so the four
ingestion roles do not map one-to-one onto four playbooks.

## 8. Open questions to settle against a live box

1. Does `POST api/integration/configuration/` mint a `config_id` if omitted, or
   is the client-side UUID mandatory? (UI always sends one.)
2. Does the server enforce single-`default`, or is that purely the UI's job?
   (Code says UI-only — worth confirming, it's a data-integrity hazard for pyfsr.)
3. Exact 207 semantics on config create.
4. Whether `install-connector` returns a job id we can poll directly rather than
   polling `getConnector`.
5. Whether the bulk `POST api/3/?$relationships=true` upsert is a documented
   endpoint or an internal convention.
6. Agent-mode `remote_status` transitions — is there a terminal `failed` state,
   or only absence of `finished`?
