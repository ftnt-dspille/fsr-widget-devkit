HARNESS := fortisoar-widget-harness

# Three dedicated, never-overlapping ports:
#   DEV_PORT        — the harness you drive by hand (`make dev`)
#   TEST_PORT       — the isolated server Playwright boots for `make test`
#   INTROSPECT_PORT — the introspection rig (`make introspect`)
# They differ on purpose so running tests never kills (or races) your dev
# server, and a stale dev server never serves the wrong widget to a test run.
# All are forced here via PORT=, which overrides .env (dotenv does not
# override an already-set env var) so the port can't drift out from under us.
DEV_PORT        := 14400
TEST_PORT       := 14401
INTROSPECT_PORT := 14403

.PHONY: help setup install widgets assets new-widget dev start stop test test-unit test-e2e-headed test-e2e-spec test-e2e-widget turn-hermetic test-live-sweep test-matrix-live test-matrix-gate grade-export test-ar-playbook-live test-ar-jtg-flow-live test-ar-connector-live introspect introspect-gate introspect-soar ship-verify release clean widget-inspect

help:
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

setup: install widgets ## One-shot bootstrap: install harness deps + clone widgets from the manifest
	@echo "Setup complete. Copy fortisoar-widget-harness/.env.example to .env, then 'make dev'."

install: ## Install harness deps (pnpm)
	cd $(HARNESS) && pnpm install

widgets: ## Clone/update widget repos into widgets-src/ from widgets.manifest
	bash scripts/clone-widgets.sh

assets: ## Fetch the FortiSOAR app shell into fsr_src/ (needed for e2e; reads harness .env)
	bash scripts/fetch-soar-assets.sh

refresh-soar-types: ## Regenerate lib/soar-platform.d.ts from contenthub widgetServiceAPI docs (cross-checks fsr_src/app.unmin.js if present)
	cd $(HARNESS) && pnpm build && pnpm gen-types

new-widget: ## Scaffold a widget from a spec. SPEC=spec.json OR NAME=incidentSummary [KIND=record] [TRIGGER=1] [TITLE="…"]
	@if [ -n "$(SPEC)" ]; then \
	  cd $(HARNESS) && WIDGETS_SRC=$(CURDIR)/widgets-src node scripts/new-widget.js --spec $(CURDIR)/$(SPEC); \
	elif [ -n "$(NAME)" ]; then \
	  cd $(HARNESS) && WIDGETS_SRC=$(CURDIR)/widgets-src node scripts/new-widget.js "$(NAME)" $(if $(TITLE),--title "$(TITLE)") $(if $(KIND),--kind $(KIND)) $(if $(TRIGGER),--triggers-playbook); \
	else \
	  echo "Usage: make new-widget SPEC=spec.json   (or)   make new-widget NAME=<camelCase> [KIND=record] [TRIGGER=1] [TITLE=\"…\"]"; exit 2; \
	fi

dev: ## Run the harness you drive by hand — http://localhost:14400
	cd $(HARNESS) && PORT=$(DEV_PORT) pnpm start

start: dev ## Alias for dev

stop: ## Kill both the dev (14400) and test (14401) servers
	-lsof -ti:$(DEV_PORT)  | xargs kill -9 2>/dev/null || true
	-lsof -ti:$(TEST_PORT) | xargs kill -9 2>/dev/null || true

test: test-unit ## Full check: jest unit tests (use test-e2e-widget WIDGET=<name> for e2e)

test-unit: ## Jest unit tests — harness only by default; WIDGET=<name>[,<name>] adds widget project(s), WIDGET=all runs every widget
	cd $(HARNESS) && WIDGET="$(WIDGET)" pnpm test

test-e2e-headed: ## Playwright e2e with browser UI (test server on 14401)
	cd $(HARNESS) && PORT=$(TEST_PORT) pnpm test:e2e:headed

# Scoped e2e for one or more specs. Kills any stale test-port server first
# (the recurring stale-server breakage) so Playwright always boots a fresh one.
# Usage: make test-e2e-spec SPEC=tests/e2e/fsrSocAssistant.c2Hunt.spec.js
#        make test-e2e-spec SPEC="tests/e2e/a.spec.js tests/e2e/b.spec.js"
test-e2e-widget: ## Run all e2e specs for one widget (WIDGET=fsrSocAssistant) on an always-fresh test server
	@if [ -z "$(WIDGET)" ]; then echo "Usage: make test-e2e-widget WIDGET=<widgetName>"; exit 2; fi
	-lsof -ti:$(TEST_PORT) | xargs kill -9 2>/dev/null || true
	cd $(HARNESS) && PORT=$(TEST_PORT) pnpm test:e2e $(WIDGET) --reporter=list

test-e2e-spec: ## Run e2e for one/more specs (SPEC=path[, ...]) on an always-fresh test server
	@if [ -z "$(SPEC)" ]; then echo "Usage: make test-e2e-spec SPEC=tests/e2e/<file>.spec.js"; exit 2; fi
	-lsof -ti:$(TEST_PORT) | xargs kill -9 2>/dev/null || true
	cd $(HARNESS) && PORT=$(TEST_PORT) pnpm test:e2e $(SPEC) --reporter=list

# Seam C (stability plan Phase 0.4): the box-free real-widget ↔ real-connector
# turn. Boots the local-connector sidecar in HERMETIC mode (real operations.py +
# fake LLM + cassette reads — no box, no LLM credits), then runs the Seam C e2e
# spec whose route interception forwards /api/integration/execute to it. This is
# the one tier that exercises the real widget controller against real connector
# logic without a live appliance. Teardown always kills the sidecar.
SEAMC_PORT   := 4778
SEAMC_SIDECAR := $(HARNESS)/scripts/local-connector-sidecar.py
SEAMC_PY     := $(HARNESS)/.venv-localdev/bin/python
SEAMC_SPEC   := ../widgets-src/fortiaiAgenticAssistant/tests/e2e/fortiaiAgenticAssistant.seamHermetic.spec.js
turn-hermetic: ## Seam C: real widget ↔ real connector, box-free (hermetic sidecar + e2e)
	-lsof -ti:$(SEAMC_PORT) | xargs kill -9 2>/dev/null || true
	-lsof -ti:$(TEST_PORT) | xargs kill -9 2>/dev/null || true
	FSRPB_DEV=1 FSRPB_SIDECAR_HERMETIC=1 FSRPB_SIDECAR_PORT=$(SEAMC_PORT) \
		$(SEAMC_PY) $(SEAMC_SIDECAR) > /tmp/seamc-sidecar.log 2>&1 & echo $$! > /tmp/seamc-sidecar.pid
	@echo "▶ waiting for hermetic sidecar on :$(SEAMC_PORT)…"
	@for i in $$(seq 1 30); do \
		curl -sf http://127.0.0.1:$(SEAMC_PORT)/health >/dev/null 2>&1 && break; \
		sleep 0.5; \
	done; curl -sf http://127.0.0.1:$(SEAMC_PORT)/health >/dev/null || \
		{ echo "sidecar failed to start; log:"; cat /tmp/seamc-sidecar.log; exit 1; }
	@echo "▶ sidecar up; running Seam C e2e"
	cd $(HARNESS) && PORT=$(TEST_PORT) FSRPB_SEAMC_URL=http://127.0.0.1:$(SEAMC_PORT)/execute \
		pnpm test:e2e $(SEAMC_SPEC) --reporter=list; \
		rc=$$?; kill $$(cat /tmp/seamc-sidecar.pid) 2>/dev/null || true; exit $$rc

# Ad-hoc one-shot widget inspector: mount a widget in the RUNNING dev harness and
# answer a visual/DOM question as JSON (dropdown clipped? grid row count? size?).
# Needs the dev server up (pnpm dev on :4401, or pass BASE=). Pass-through flags
# via ARGS. See scripts/widget-inspect.js --help for the full flag list.
#   make widget-inspect ARGS='--widget counter --config {"start":7} --text [data-testid=counter-value]'
widget-inspect: ## Mount a widget in the running harness + measure it as JSON (ARGS='--widget <name> ...')
	@if [ -z "$(ARGS)" ]; then cd $(HARNESS) && node scripts/widget-inspect.js --help; exit 0; fi
	cd $(HARNESS) && $(if $(BASE),HARNESS_BASE=$(BASE) ,)node scripts/widget-inspect.js $(ARGS)

BUMP ?= patch
# Which box `ship-verify` deploys to. Defaults to the harness `.env`; the deploy
# target used to be HARDCODED to it, so shipping the same build to a second box
# meant editing shared state. `SHIP_ENV=.env.206` targets one box explicitly.
SHIP_ENV ?= .env

ship-verify: ## CANONICAL ship path: lint→typecheck→unit→e2e(mock)→deploy→live-sweep for one widget (WIDGET=, BUMP=patch)
	@if [ -z "$(WIDGET)" ]; then echo "Usage: make ship-verify WIDGET=<name> [BUMP=patch]"; exit 2; fi
	@echo "▶ 1/6 lint (server)";  cd $(HARNESS) && node scripts/widget.js lint $(WIDGET)
	@echo "▶ 1/6 lint (angular)"; cd $(HARNESS) && WIDGETS_SRC=$(CURDIR)/widgets-src node scripts/lint-angular.js $(WIDGET)
	@echo "▶ 1/6 lint (testids)"; cd $(HARNESS) && WIDGETS_SRC=$(CURDIR)/widgets-src node scripts/lint-testids.js $(WIDGET)
	@echo "▶ 1/6 typecheck";      cd $(HARNESS) && WIDGETS_SRC=$(CURDIR)/widgets-src node scripts/typecheck-widgets.js $(WIDGET)
	@echo "▶ 2/6 unit";       $(MAKE) test-unit WIDGET=$(WIDGET)
	@echo "▶ 3/6 e2e (mock)"; $(MAKE) test-e2e-widget WIDGET=$(WIDGET)
	@echo "▶ 4/6 introspect-gate (hermetic DOM/payload/console regression vs baseline — scoped to $(WIDGET))"; \
	  if [ -n "$(SKIP_INTROSPECT)" ]; then echo "  (SKIP_INTROSPECT set — skipping; run 'make introspect-gate' separately)"; \
	  else $(MAKE) introspect-gate GATE_WIDGET=$(WIDGET); fi
	@echo "▶ 5/6 deploy ($(BUMP)) via ship.sh (bulletproof start+push, $(SHIP_ENV) → same box tests hit)"; \
	  cd $(HARNESS) && FSR_ENV_FILE=$(CURDIR)/$(HARNESS)/$(SHIP_ENV) PORT=$(DEV_PORT) WIDGETS_SRC=$(CURDIR)/widgets-src \
	    scripts/ship.sh $(WIDGET) --bump $(BUMP)
	@echo "▶ 6/6 live-sweep"; \
	  if [ "$(WIDGET)" = "fsrSocAssistant" ]; then $(MAKE) test-live-sweep; \
	  else echo "  (no live sweep defined for $(WIDGET) — skipping)"; fi
	@echo "✅ ship-verify complete: $(WIDGET) gated (server+angular+testid lint, typecheck, unit, mock-e2e, introspect-gate), deployed, and live-verified."

release: ## GitHub release for one widget: bump info.json -> commit -> push develop (fires release.yml). WIDGET=, BUMP=patch
	@if [ -z "$(WIDGET)" ]; then echo "Usage: make release WIDGET=<name> [BUMP=patch]"; exit 2; fi
	cd $(HARNESS) && WIDGETS_SRC=$(CURDIR)/widgets-src scripts/release.sh $(WIDGET) $(BUMP)

test-live-sweep: ## LIVE forticloud UI bug-hunt sweep (real connector). RUNS=<n> repeats (default 1)
	-lsof -ti:$(TEST_PORT) | xargs kill -9 2>/dev/null || true
	@n=$${RUNS:-1}; i=1; fail=0; \
	while [ $$i -le $$n ]; do \
	  echo "===== live-sweep run $$i/$$n ====="; \
	  ( cd $(HARNESS) && PORT=$(TEST_PORT) E2E_LIVE=1 FSRPB_LIVE_UI=1 \
	    pnpm test:e2e tests/e2e/fsrSocAssistant.liveSweep.spec.js --reporter=list ) || fail=1; \
	  i=$$((i+1)); \
	done; \
	exit $$fail

MATRIX_ENV ?= .env.159
# MATRIX_ENV accepts a harness-relative name (.env.159) or an absolute path
# (the connector-repo Makefile passes one). Boxes: .env.159 (8.0 triage),
# .env.206 (ZTPF + the build/authoring flows — where the P6 rows belong).
MATRIX_ENV_PATH := $(if $(filter /%,$(MATRIX_ENV)),$(MATRIX_ENV),$(abspath $(HARNESS)/$(MATRIX_ENV)))
# Scenario rows carry real record UUIDs, so they are BOX-SPECIFIC and must track
# MATRIX_ENV — otherwise a 206 run drives 159's records. `.env.206` →
# scenarios.local.206.json when present, else the plain scenarios.local.json.
# MATRIX_SCENARIOS=<path> overrides. All are gitignored; the template is
# scenarios.local.example.json.
MATRIX_BOX := $(patsubst .env.%,%,$(notdir $(MATRIX_ENV)))
MATRIX_SCENARIOS ?= $(if $(wildcard $(HARNESS)/tests/live/scenarios.local.$(MATRIX_BOX).json),$(abspath $(HARNESS)/tests/live/scenarios.local.$(MATRIX_BOX).json),$(abspath $(HARNESS)/tests/live/scenarios.local.json))
# MATRIX_GATE filters rows by their `gate` field (see matrixDriver.gateRow).
# Unset = every runnable row.
test-matrix-live: ## LIVE prompt/flow matrix (docs/PROMPT_FLOW_TEST_PLAN.md T1–T10/P1–P6) vs the deployed widget. HEADED (WAF blocks headless). Scenarios auto-select per box: MATRIX_ENV=.env.206 → tests/live/scenarios.local.206.json (gitignored). MATRIX_GATE=strict,xfail for gating rows only; MATRIX_IDS=Z3,Z5 for a hand-picked subset.
	@if [ ! -f "$(MATRIX_ENV_PATH)" ]; then echo "missing $(MATRIX_ENV_PATH) (box creds)"; exit 2; fi
	@if [ ! -f "$(MATRIX_SCENARIOS)" ]; then \
	  echo "⚠️  [[MATRIX-ENV-SKIP]] missing $(MATRIX_SCENARIOS) — copy tests/live/scenarios.local.example.json and fill in real record UUIDs for box '$(MATRIX_BOX)' (box-specific, gitignored)"; \
	else \
	  echo "▶ matrix: env=$(MATRIX_ENV) scenarios=$(notdir $(MATRIX_SCENARIOS)) gate=$(if $(MATRIX_GATE),$(MATRIX_GATE),<all>) ids=$(if $(MATRIX_IDS),$(MATRIX_IDS),<all>)"; \
	  cd $(HARNESS) && set -a && . "$(MATRIX_ENV_PATH)" && set +a && \
	  FSRPB_LIVE=1 FSRPB_HEADED=1 MATRIX_GATE="$(MATRIX_GATE)" MATRIX_IDS="$(MATRIX_IDS)" MATRIX_SCENARIOS="$(MATRIX_SCENARIOS)" \
	    pnpm test:live tests/live/matrix.live.test.js; \
	fi

test-matrix-gate: ## LIVE matrix, GATING rows only (gate:strict must stay clean + gate:xfail must stay broken-or-promote). Deliberately NOT in ship-verify — each row is a headed box turn (~2–4 min). MATRIX_ENV=.env.206 for build flows.
	@$(MAKE) test-matrix-live MATRIX_GATE=strict,xfail MATRIX_ENV=$(MATRIX_ENV)

grade-export: ## Grade a downloaded widget .events.json chat export offline (EXPORT=~/Downloads/fsrpb-chat-...events.json). Flags known-bad flow signatures; exits non-zero on FAIL.
	@if [ -z "$(EXPORT)" ]; then echo "Usage: make grade-export EXPORT=<path-to-.events.json>"; exit 2; fi
	cd $(HARNESS) && node tests/live/scripts/gradeExport.js "$(EXPORT)"

test-ar-playbook-live: ## LIVE action-renderer EDIT playbook-listing test vs the box that has playbooks (.env.box = 205). AR_ALERT_UUID=<uuid> to override the alert.
	-lsof -ti:$(TEST_PORT) | xargs kill -9 2>/dev/null || true
	@if [ ! -f $(HARNESS)/.env.box ]; then echo "missing $(HARNESS)/.env.box (box creds)"; exit 2; fi
	cd $(HARNESS) && set -a && . ./.env.box && set +a && \
	  PORT=$(TEST_PORT) E2E_LIVE=1 \
	  pnpm test:e2e tests/e2e/actionRenderer.playbookListingLive.spec.js --reporter=list

test-ar-jtg-flow-live: ## LIVE action-renderer FULL edit flow (pick JSON-to-Grid playbook -> Run sample via notrigger -> Output) vs .env.box (205). AR_PLAYBOOK_NAME=<name> to override.
	-lsof -ti:$(TEST_PORT) | xargs kill -9 2>/dev/null || true
	@if [ ! -f $(HARNESS)/.env.box ]; then echo "missing $(HARNESS)/.env.box (box creds)"; exit 2; fi
	cd $(HARNESS) && set -a && . ./.env.box && set +a && \
	  PORT=$(TEST_PORT) E2E_LIVE=1 \
	  pnpm test:e2e tests/e2e/actionRenderer.jsonToGridFlowLive.spec.js --reporter=list

test-ar-connector-live: ## LIVE action-renderer CONNECTOR edit flow (pick connector -> operation -> Run sample -> table) vs .env.box. AR_CONNECTOR/AR_OPERATION to override (default mitre-attack/get_mitre_data_sample; unreachable connectors [[AR-ENV-SKIP]]).
	-lsof -ti:$(TEST_PORT) | xargs kill -9 2>/dev/null || true
	@if [ ! -f $(HARNESS)/.env.box ]; then echo "missing $(HARNESS)/.env.box (box creds)"; exit 2; fi
	cd $(HARNESS) && set -a && . ./.env.box && set +a && \
	  PORT=$(TEST_PORT) E2E_LIVE=1 \
	  pnpm test:e2e tests/e2e/actionRenderer.connectorFlowLive.spec.js --reporter=list

introspect: ## Hermetic widget-render introspection (builds baseline reports; introspect-gate compares). Boots its own server on $(INTROSPECT_PORT).
	-lsof -ti:$(INTROSPECT_PORT) | xargs kill -9 2>/dev/null || true
	@echo "▶ Starting introspection harness on port $(INTROSPECT_PORT)…"
	@( cd $(HARNESS) && PORT=$(INTROSPECT_PORT) node server.js > /dev/null 2>&1 & \
	  server_pid=$$!; \
	  sleep 2; \
	  if ! kill -0 $$server_pid 2>/dev/null; then \
	    echo "Failed to start server"; exit 1; \
	  fi; \
	  trap "kill $$server_pid 2>/dev/null || true" EXIT; \
	  echo "▶ Running introspection rig…"; \
	  cd $(HARNESS) && HARNESS_URL=http://localhost:$(INTROSPECT_PORT) pnpm node scripts/introspect.js; \
	)

introspect-gate: introspect ## Run introspection + fail if any widget regresses past thresholds (payload +10%, boot +15%, new console errors). GATE_WIDGET=<name> scopes the pass/fail to one widget.
	@echo "▶ Checking regressions against baseline…"
	@cd $(HARNESS) && pnpm node scripts/introspect-gate.js $(GATE_WIDGET)

introspect-soar: ## Real-SOAR fidelity diff (Phase 2): render deployed widget(s) on a live box, diff vs the harness baseline. Source the box env first (e.g. `set -a; . .env.159; set +a`). ENV=.env.159 to point it; ARGS='--offline' to re-diff without driving the box.
	@echo "▶ Rendering deployed widget(s) live + diffing vs harness baseline…"
	@cd $(HARNESS) && set -a; [ -n "$(ENV)" ] && . ./$(ENV); set +a; pnpm node scripts/introspectSoar.js $(ARGS)

clean: ## Remove harness node_modules + test artifacts
	rm -rf $(HARNESS)/node_modules $(HARNESS)/test-results test-results
