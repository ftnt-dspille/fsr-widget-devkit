# Local development -- widget + connector on your laptop

Run the **connector** and the **LLM** on your laptop for fast iteration -- no
redeploy per change, no Anthropic credits, no box round-trip for the agent loop.
A configured FortiSOAR box (159 = the 8.0 standard) supplies **SOAR data only**
(records + other connectors' operations). The **widget** runs in the dev harness
as usual.

This is the fast loop. For the canonical build→test→deploy pipeline (when you
*do* want to ship to a box), see `TESTING.md`.

## How it works

```
browser → harness (:4401)
  widget fsrPbAgent.service → connectorService.executeConnectorAction(...)
    → POST /api/integration/execute/  {connector, operation, version, config, params}
       └─ harness handler (FSR_LOCAL_CONNECTOR=1) → LOCAL sidecar (localhost :4771)
            └─ operations[op](config, params)            ← connector code, on laptop
                 ├─ chat_turn/chat_poll/… → OpenAIProvider → LLM gateway  ← laptop
                 └─ run_op / get_record / search_module_records
                      └─ probes._env → pyfsr FortiSOAR client → 159         ��� SOAR data only
GET /api/3/<module>/<id>  (record context)  ��� harness proxy → 159   (real records)
everything else                             → harness proxy → 159 (or box-of-the-day)
```

**Routing rules** (the core of this setup):
- **Our connector's own ops** (`chat_turn`, `chat_poll`, `chat_resume`,
  `list_models`, `compile_yaml`, `health_check`, …) run **locally** in the
  sidecar. They never touch a box.
- **Other connectors' ops** the agent invokes during triage -- `run_op(connector=
  "fortisiem", operation="event_query", …)`, IP-enrichment (VirusTotal/Shodan/…),
  firewall block -- are **auto-proxied to the box**: `run_op` → `probes._env` →
  pyfsr → `POST /api/integration/execute/` on `FSR_BASE_URL` (the 8.0 box). No extra
  proxy code; just the box config.
- **Record fetches** (`GET /api/3/<module>/<id>`) go through the harness proxy
  to the box (real records; 159 has 25k+ alerts).

No sim, no mock -- the real `chat_turn` path. `simulation_mode` stays off; the
widget's localhost→mock default is overridden with `?mode=real`.

## Repos

- widget + harness: this repo (`fortisoar-widget-harness/`, `widgets-src/`)
- connector: `~/PycharmProjects/ConnectorsV2/fsr-playbook-builder/connector-fsr-soc-assistant/`
- framework (editable, local-first): `~/PycharmProjects/fsr-playbook-framework`
- an OpenAI-compatible LLM gateway you can reach from your laptop (any server
  that speaks `/v1/chat/completions` with streaming + `tool_calls`). Its
  base URL / API key / a chat model go in `localdev.env`.

## One-time setup

```sh
cd fortisoar-widget-harness

# 1. Build the unified local-dev venv (editable fsr-playbooks + pyfsr, the
#    connectors SDK engine wheel, the openai/httpx deps). Re-runnable.
bash scripts/setup-localdev-venv.sh

# 2. Create your localdev.env (gitignored) from the example + real creds.
#    Fill OPENAI_* from your LLM gateway (base URL, a chat model it serves,
#    your key) and FSR_* for the FortiSOAR box (labuser). See
#    scripts/localdev.env.example for the keys.
cp scripts/localdev.env.example scripts/localdev.env
$EDITOR scripts/localdev.env
```

## Run

Two processes: the sidecar (connector) and the harness (widget).

```sh
# Terminal 1 -- the connector sidecar (runs the real operations against the LLM gateway + 159)
FSRPB_DEV=1 .venv-localdev/bin/python scripts/local-connector-sidecar.py

# Terminal 2 -- the harness, routing connector-execute to the local sidecar
FSR_LOCAL_CONNECTOR=1 PORT=4401 node server.js
# (or via the parent Makefile: FSR_LOCAL_CONNECTOR=1 make start)
```

Then open the widget and force real mode (the widget defaults to **mock** on
localhost; `?mode=real` overrides that):

```
http://localhost:4401/?widget=fortiaiAgenticAssistant&mode=real
```

Drive a triage turn. Expect: the LLM streams reasoning, tool calls dispatch
(`run_op` reaches 159), an assessment / staged card at the end.

You can also poke the sidecar directly (no widget):

```sh
# health (box reachability + LLM probe)
curl -s localhost:4771/health
# list_models (calls the LLM gateway /v1/models)
curl -s -X POST localhost:4771/execute -H 'Content-Type: application/json' \
  -d '{"operation":"list_models","config":"fsrpb-live","params":{}}'
```

## Running tests

- **Widget (jest unit):** `make test-unit WIDGET=fortiaiAgenticAssistant`
  (controller-logic tests under `widgets-src/fortiaiAgenticAssistant/tests/`).
- **Widget (playwright e2e):** `make test-e2e-spec SPEC="<spec>"` (auto-boots
  its own harness on :14401/:14402).
- **Connector (pytest):**
  `.venv-localdev/bin/python -m pytest
  ~/PycharmProjects/ConnectorsV2/fsr-playbook-builder/connector-fsr-soc-assistant/fsr_soc_triage/tests/`
  -- exercises the triage library + intent slice (conftest imports
  `fsr_soc_triage` for registration side-effects). Mocked tests need no box.
- **Framework (offline contract):**
  `cd ~/PycharmProjects/fsr-playbook-framework && make tests` (fast pytest,
  excludes live/slow; includes the golden-trace pin) and `make chat-fast`
  (offline structure guards, no API, ~seconds).
- **End-to-end local smoke:** the sidecar + `?mode=real` triage turn above --
  the real proof the whole loop works.

## No-cache / latest-changes discipline (prevent stale-state bugs)

- **fsr-playbooks / pyfsr**: installed **editable** → Python re-reads source on
  each import. No wheel to go stale. This is *why* editable + `FSRPB_DEV=1`:
  the production version-assert (`operations.py` `_import_fsr_playbooks`, which
  guards the box's pinned `0.4.10` wheel) is counterproductive locally -- an
  editable install reports `0.0.0+unknown`, not the pin. `FSRPB_DEV=1` skips
  that one check (still asserts importability).
- **Connector code**: edit `operations.py` → **restart the sidecar** (it holds
  the module + the `probes._env` `sys.modules` bridge, which caches across
  calls). If an import seems stuck, clear bytecode caches:
  `find <connector-dir> ~/PycharmProjects/fsr-playbook-framework -name __pycache__ -prune -exec rm -rf {} +`
- **Widget code**: the harness hot-reloads templates, but the bundled AngularJS
  layer caches → hard-refresh the browser. If a rename/version bump misbehaves,
  `make stop` + `make start` (never `node server.js` by hand -- use the
  Makefile / `scripts/ship.sh`).
- **Config flip** (LLM gateway↔box, `simulation_mode`): restart the sidecar -- the
  `probes._env` bridge rebinds on restart.
- **Reference catalog (warmup / instance switch)**: the connector auto-rewarms
  the reference DB when it was warmed from a *different* SOAR than `FSR_BASE_URL`
  (identity gate `_warmup_instance_mismatch`, alongside the emptiness gate), and
  re-stamps it to the target so the compiler's `instance_mismatch` warning
  clears. **But the framework's MCP layer captures the catalog path + connection
  once at import** (`fsr_playbooks/mcp_server/_shared.py` `DB_PATH =
  default_db_path()`), so a rewarm that happens *after* the sidecar already
  compiled once is invisible in-process → **restart the sidecar** after a warmup
  or an `FSR_BASE_URL` switch. (On-box this never bites: the lifecycle-hook
  warmup fires at worker start, before any compile.) The DB lives at
  `~/PycharmProjects/fsr-playbook-framework/data/fsr_reference.db`
  (`REPO_PROBED_DB`, preferred over the packaged slim DB); it is gitignored, so a
  local rewarm never shows up as a diff. Check the stamp with:
  `sqlite3 …/data/fsr_reference.db "SELECT value FROM _catalog_meta WHERE key='base_url';"`
- **Run a check before trusting a change**:
  `.venv-localdev/bin/python -c "import fsr_playbooks, pyfsr, openai; print('ok')"`
  + `make test-unit WIDGET=fortiaiAgenticAssistant`.

## Troubleshooting

- **`fsr_playbooks version mismatch`** -- `FSRPB_DEV=1` isn't set. The sidecar
  sets it itself; if you run ops by hand, export it.
- **LLM `403 model_blocked`** -- the model in `OPENAI_MODEL` isn't permitted for
  your gateway key (a gateway can expose a model under a routing prefix your key
  isn't allowed to use). Run `list_models` to see what your key *can* use and set
  `OPENAI_MODEL` to one of those.
- **`run_op` returns `no_live_fsr` / "FSR instance not configured"** -- the
  sidecar's `localdev.env` is missing `FSR_BASE_URL` / creds, or the box is
  unreachable. (`probes/_env.py` `is_live()` needs base_url + (api_key OR
  username+password).)
- **`ReadTimeoutError` to the FortiSOAR box** -- the box was slow on a `run_op`
  (8s timeout). A real-but-slow-box issue; the agent retries / degrades. Raise
  `FSR_TIMEOUT` in `localdev.env` if it's flaky.
- **`502 sidecar_unreachable`** -- the sidecar isn't running (Terminal 1), or
  `FSRPB_SIDECAR_URL` points somewhere else.
- **execute still hits the box (returns box-shape `{"operation":null,...}`)** --
  `FSR_LOCAL_CONNECTOR=1` wasn't set when the harness started, OR the harness is
  running stale `server.js` (rebuild: `npx tsc -p tsconfig.json`; restart).
- **Widget shows mock data** -- you forgot `?mode=real` (localhost defaults to
  mock; `fsrPbAgent.service.js` `_activeScenario`).

## Pointers

- LLM gateway creds: your own OpenAI-compatible gateway's base URL, API key,
  and a chat model it serves (set as `OPENAI_BASE_URL` / `OPENAI_API_KEY` /
  `OPENAI_MODEL` in `scripts/localdev.env`).
- Connectors SDK engine wheel: `~/.vscode/extensions/fortisoar.fortisoar-connector-0.0.1/resources/wheels/fortisoar_connector_engine-3.0.0.3-py3-none-any.whl`
  (re-point the setup script if the extension updates).
- Sidecar: `fortisoar-widget-harness/scripts/local-connector-sidecar.py`
  (stdlib HTTP, localhost-only, no auth -- dev machine, not for shared use).
- Harness handler: `server.ts` `POST /api/integration/execute/` (gated by
  `FSR_LOCAL_CONNECTOR`; off = unchanged box-proxy behavior).
- Widget connectors fixture:
  `widgets-src/fortiaiAgenticAssistant/widget/widgetAssets/fixtures/api3/connectors.json`
  (advertises `connector-fsr-soc-assistant` + the `fsrpb-live` config so widget
  discovery resolves).
