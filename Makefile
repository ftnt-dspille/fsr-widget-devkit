HARNESS := fortisoar-widget-harness

# Three dedicated, never-overlapping ports:
#   DEV_PORT        -- the harness you drive by hand (`make dev`)
#   TEST_PORT       -- the isolated server Playwright boots for `make test`
#   INTROSPECT_PORT -- the introspection rig (`make introspect`)
# They differ on purpose so running tests never kills (or races) your dev
# server, and a stale dev server never serves the wrong widget to a test run.
# All are forced here via PORT=, which overrides .env (dotenv does not
# override an already-set env var) so the port can't drift out from under us.
DEV_PORT        := 14400
TEST_PORT       := 14401
INTROSPECT_PORT := 14403

.PHONY: help setup install widgets assets new-widget dev start stop test test-unit test-e2e-headed test-e2e-spec test-e2e-widget turn-hermetic test-live-sweep test-matrix-live test-matrix-local test-matrix-gate grade-export test-ar-playbook-live test-ar-jtg-flow-live test-ar-connector-live introspect introspect-gate introspect-soar ship-verify release clean widget-inspect

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

dev: ## Run the harness you drive by hand -- http://localhost:14400
	cd $(HARNESS) && PORT=$(DEV_PORT) pnpm start

start: dev ## Alias for dev

stop: ## Kill both the dev (14400) and test (14401) servers
	-lsof -ti:$(DEV_PORT)  | xargs kill -9 2>/dev/null || true
	-lsof -ti:$(TEST_PORT) | xargs kill -9 2>/dev/null || true

test: test-unit ## Full check: jest unit tests (use test-e2e-widget WIDGET=<name> for e2e)

test-unit: ## Jest unit tests -- harness only by default; WIDGET=<name>[,<name>] adds widget project(s), WIDGET=all runs every widget
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
# fake LLM + cassette reads -- no box, no LLM credits), then runs the Seam C e2e
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
	@echo "▶ 4/6 introspect-gate (hermetic DOM/payload/console regression vs baseline -- scoped to $(WIDGET))"; \
	  if [ -n "$(SKIP_INTROSPECT)" ]; then echo "  (SKIP_INTROSPECT set -- skipping; run 'make introspect-gate' separately)"; \
	  else $(MAKE) introspect-gate GATE_WIDGET=$(WIDGET); fi
	@echo "▶ 5/6 deploy ($(if $(BUMP),$(BUMP),no bump)) via ship.sh (bulletproof start+push, $(SHIP_ENV) → same box tests hit)"; \
	  cd $(HARNESS) && FSR_ENV_FILE=$(CURDIR)/$(HARNESS)/$(SHIP_ENV) PORT=$(DEV_PORT) WIDGETS_SRC=$(CURDIR)/widgets-src \
	    scripts/ship.sh $(WIDGET) $(if $(filter-out none,$(BUMP)),--bump $(BUMP),)
	@# A missing sweep spec used to "skip" and still print "live-verified" below.
	@# That is the 0.2 bug class: the gate ran over an empty set and reported the
	@# same thing it reports when it passes -- and it already burned us once at
	@# the widget rename (see SWEEP_WIDGET). Skipping is now an explicit choice
	@# (SKIP_LIVE_SWEEP=1), and the completion line says which gates actually ran.
	@echo "▶ 6/6 live-sweep"; \
	  lv_status="unverified"; \
	  if [ -n "$(SKIP_LIVE_SWEEP)" ]; then \
	    echo "  ⚠️  SKIP_LIVE_SWEEP set -- this build is NOT live-verified."; \
	    lv_status="skip"; \
	  elif [ -f "widgets-src/$(WIDGET)/tests/e2e/$(WIDGET).liveSweep.spec.js" ]; then \
	    sweep_log=$$(mktemp -t fsr-ship-sweep.XXXXXX); \
	    $(MAKE) test-live-sweep WIDGET=$(WIDGET) 2>&1 | tee "$$sweep_log"; \
	    if grep -F -q '[[SWEEP-ENV-SKIP]]' "$$sweep_log"; then \
	      echo "  ⚠️  box down / [[SWEEP-ENV-SKIP]] -- this build is NOT live-verified."; \
	      lv_status="envskip"; \
	    elif grep -F -q '[[SWEEP-VERIFIED]]' "$$sweep_log"; then \
	      lv_status="verified"; \
	    else \
	      echo "✗ live-sweep FAILED -- widget regression, not shipped (see output above)."; \
	      rm -f "$$sweep_log"; exit 1; \
	    fi; \
	    rm -f "$$sweep_log"; \
	  else \
	    echo "✗ no live sweep spec at widgets-src/$(WIDGET)/tests/e2e/$(WIDGET).liveSweep.spec.js"; \
	    echo "  ship-verify's live gate would cover NOTHING, so it fails instead of"; \
	    echo "  claiming 'live-verified'. Write the spec, or pass SKIP_LIVE_SWEEP=1"; \
	    echo "  to ship knowing this build is unverified against a box."; \
	    exit 1; \
	  fi; \
	  case "$$lv_status" in \
	    verified) lv_msg=" and live-verified";; \
	    skip) lv_msg=" -- NOT live-verified (SKIP_LIVE_SWEEP)";; \
	    envskip) lv_msg=" -- NOT live-verified (box down / [[SWEEP-ENV-SKIP]])";; \
	    *) lv_msg=" -- NOT live-verified";; \
	  esac; \
	  echo "✅ ship-verify complete: $(WIDGET) gated (server+angular+testid lint, typecheck, unit, mock-e2e, introspect-gate), deployed$$lv_msg."

release: ## GitHub release for one widget: bump info.json -> commit -> push develop (fires release.yml). WIDGET=, BUMP=patch
	@if [ -z "$(WIDGET)" ]; then echo "Usage: make release WIDGET=<name> [BUMP=patch]"; exit 2; fi
	cd $(HARNESS) && WIDGETS_SRC=$(CURDIR)/widgets-src scripts/release.sh $(WIDGET) $(BUMP)

# Derive the sweep spec from the widget name instead of hardcoding it. The old
# hardcoded `fsrSocAssistant` path went stale at the widget rename, and BOTH
# call sites failed silently-ish: `make test-live-sweep` died with "No tests
# found", and ship-verify's `if [ "$(WIDGET)" = "fsrSocAssistant" ]` guard
# stopped matching, so the CANONICAL ship path skipped its live gate entirely
# and still printed "live-verified".
SWEEP_WIDGET ?= $(if $(WIDGET),$(WIDGET),fortiaiAgenticAssistant)
# Source the box env explicitly, mirroring test-matrix-live's MATRIX_ENV. The
# bare `.env` points at whichever box was last worked on, so a sweep run right
# after shipping elsewhere silently [[SWEEP-ENV-SKIP]]s with "connector not
# present/configured" -- which reads like a box outage rather than "you are
# pointed at the wrong box".
SWEEP_ENV ?= .env.159

test-live-sweep: ## LIVE forticloud UI bug-hunt sweep (real connector). RUNS=<n> repeats (default 1). Prints [[SWEEP-VERIFIED]]/[[SWEEP-ENV-SKIP]]/[[SWEEP-FAIL]]; exits 0 only when verified.
	-lsof -ti:$(TEST_PORT) | xargs kill -9 2>/dev/null || true
	@# A hard-down box makes the spec's beforeAll print [[SWEEP-ENV-SKIP]] and
	@# skip every scenario. Playwright exits 0 on all-skipped, so without this
	@# check ship-verify would print "live-verified" over a gate that graded
	@# NOTHING (#96). The gate keys on output markers (not exit codes): a
	@# `$(MAKE)` recipe exit is remapped to 2, so 77 can't cross the make
	@# boundary. fail=1 is a real widget failure; ran==0 (no [[SWEEP]] result
	@# lines) with fail==0 is the env-skip class (box down).
	@set -o pipefail; \
	n=$${RUNS:-1}; i=1; fail=0; sweep_log=$$(mktemp -t fsr-sweep.XXXXXX); \
	while [ $$i -le $$n ]; do \
	  echo "===== live-sweep run $$i/$$n ====="; \
	  ( cd $(HARNESS) && set -a && . "$(SWEEP_ENV)" && set +a && \
	    PORT=$(TEST_PORT) E2E_LIVE=1 FSRPB_LIVE_UI=1 \
	    pnpm test:e2e ../widgets-src/$(SWEEP_WIDGET)/tests/e2e/$(SWEEP_WIDGET).liveSweep.spec.js --reporter=list ) 2>&1 | tee "$$sweep_log" || fail=1; \
	  i=$$((i+1)); \
	done; \
	if [ $$fail -ne 0 ]; then \
	  echo "[[SWEEP-FAIL]] live-sweep reported a test failure (see output above) -- widget regression."; \
	  rm -f "$$sweep_log"; exit 1; \
	fi; \
	ran=$$(grep -F -c '[[SWEEP]]' "$$sweep_log" 2>/dev/null || true); ran=$${ran:-0}; \
	rm -f "$$sweep_log"; \
	if [ "$$ran" -eq 0 ]; then \
	  echo "[[SWEEP-ENV-SKIP]] live-sweep graded 0 scenarios -- NOT live-verified (box down / gate covered nothing). Re-run when the box is up."; \
	  exit 1; \
	fi; \
	echo "[[SWEEP-VERIFIED]] live-sweep graded $$ran scenario(s) -- live-verified."; \
	exit 0

MATRIX_ENV ?= .env.159
# MATRIX_ENV accepts a harness-relative name (.env.159) or an absolute path
# (the connector-repo Makefile passes one). Boxes: .env.159 (8.0 triage),
# .env.206 (ZTPF + the build/authoring flows -- where the P6 rows belong).
MATRIX_ENV_PATH := $(if $(filter /%,$(MATRIX_ENV)),$(MATRIX_ENV),$(abspath $(HARNESS)/$(MATRIX_ENV)))
# Scenario rows carry real record UUIDs, so they are BOX-SPECIFIC and must track
# MATRIX_ENV -- otherwise a 206 run drives 159's records. `.env.206` →
# scenarios.local.206.json when present, else the plain scenarios.local.json.
# MATRIX_SCENARIOS=<path> overrides. All are gitignored; the template is
# scenarios.local.example.json.
MATRIX_BOX := $(patsubst .env.%,%,$(notdir $(MATRIX_ENV)))
MATRIX_SCENARIOS ?= $(if $(wildcard $(HARNESS)/tests/live/scenarios.local.$(MATRIX_BOX).json),$(abspath $(HARNESS)/tests/live/scenarios.local.$(MATRIX_BOX).json),$(abspath $(HARNESS)/tests/live/scenarios.local.json))
# MATRIX_GATE filters rows by their `gate` field (see matrixDriver.gateRow).
# Unset = every runnable row.
test-matrix-live: ## LIVE prompt/flow matrix (docs/PROMPT_FLOW_TEST_PLAN.md T1-T10/P1-P6) vs the deployed widget. HEADED (WAF blocks headless). Scenarios auto-select per box: MATRIX_ENV=.env.206 → tests/live/scenarios.local.206.json (gitignored). MATRIX_GATE=strict,xfail for gating rows only; MATRIX_IDS=Z3,Z5 for a hand-picked subset.
	@if [ ! -f "$(MATRIX_ENV_PATH)" ]; then echo "missing $(MATRIX_ENV_PATH) (box creds)"; exit 2; fi
	@# A missing scenario file used to warn and exit 0 -- "the matrix passed"
	@# over zero rows (PLAN_testing_that_can_fail 0.2). MATRIX_ALLOW_SKIP=1 is
	@# the explicit opt-out for a machine with no box-specific scenarios.
	@if [ ! -f "$(MATRIX_SCENARIOS)" ]; then \
	  echo "⚠️  [[MATRIX-ENV-SKIP]] missing $(MATRIX_SCENARIOS) -- copy tests/live/scenarios.local.example.json and fill in real record UUIDs for box '$(MATRIX_BOX)' (box-specific, gitignored)"; \
	  if [ "$(MATRIX_ALLOW_SKIP)" != "1" ]; then \
	    echo "   the matrix would grade 0 rows, which is not a pass. Re-run with MATRIX_ALLOW_SKIP=1 to skip deliberately."; \
	    exit 1; \
	  fi; \
	else \
	  echo "▶ matrix: env=$(MATRIX_ENV) scenarios=$(notdir $(MATRIX_SCENARIOS)) gate=$(if $(MATRIX_GATE),$(MATRIX_GATE),<all>) ids=$(if $(MATRIX_IDS),$(MATRIX_IDS),<all>)"; \
	  cd $(HARNESS) && set -a && . "$(MATRIX_ENV_PATH)" && set +a && \
	  FSRPB_LIVE=1 FSRPB_HEADED=1 MATRIX_GATE="$(MATRIX_GATE)" MATRIX_IDS="$(MATRIX_IDS)" MATRIX_SCENARIOS="$(MATRIX_SCENARIOS)" \
	    pnpm test:live tests/live/matrix.live.test.js; \
	fi

test-matrix-gate: ## LIVE matrix, GATING rows only (gate:strict must stay clean + gate:xfail must stay broken-or-promote). Deliberately NOT in ship-verify -- each row is a headed box turn (~2-4 min). MATRIX_ENV=.env.206 for build flows.
	@$(MAKE) test-matrix-live MATRIX_GATE=strict,xfail MATRIX_ENV=$(MATRIX_ENV)

# ── The LOCAL matrix ────────────────────────────────────────────────────────
#
# Same grader, same scenario rows, same verdict ladder as test-matrix-live --
# but driven against the widget in the dev harness talking to the connector
# sidecar on this laptop (lib/localUiDriver.js). No widget ship, no connector
# ship, no box login. Use it to iterate; use test-matrix-live to certify.
#
# Where it sits among the tiers (each proves something the others cannot):
#   make test-e2e         mocked connector      → DOM/render only
#   make turn-hermetic    real connector, FAKE  → deterministic contract, box-free
#                         LLM + cassette data
#   make test-matrix-local real connector, REAL → agent behaviour on YOUR working
#                         model, box for data     tree, graded (this target)
#   make test-matrix-live  everything deployed  → proves the SHIPPED path
#
# It does NOT prove the deployment (the fsr-playbooks pin, the on-box install,
# the worker recycle). That seam belongs to release-ship / ship-verify.
#
# Expects the local loop already running (LOCAL_DEV.md), in two terminals:
#   FSRPB_DEV=1 .venv-localdev/bin/python scripts/local-connector-sidecar.py --reload
#   FSR_LOCAL_CONNECTOR=1 PORT=4401 node server.js
# The driver preflights both and refuses -- rather than silently grading the
# box's deployed connector -- if the harness is not wired to the sidecar.
MATRIX_LOCAL_BASE ?= http://localhost:4401
test-matrix-local: ## LOCAL matrix: the same graded rows against the harness + connector sidecar (no ship, no box login). Needs the LOCAL_DEV.md loop running. MATRIX_IDS=Z3,Z5 for a subset.
	@echo "▶ matrix (LOCAL): base=$(MATRIX_LOCAL_BASE) gate=$(if $(MATRIX_GATE),$(MATRIX_GATE),<all>) ids=$(if $(MATRIX_IDS),$(MATRIX_IDS),<all>)"
	@echo "  grading your WORKING TREE -- this does not prove the deployed path (use test-matrix-live for that)"
	cd $(HARNESS) && \
	  MATRIX_TARGET=local FSRPB_LOCAL_BASE="$(MATRIX_LOCAL_BASE)" \
	  MATRIX_GATE="$(MATRIX_GATE)" MATRIX_IDS="$(MATRIX_IDS)" \
	  $(if $(MATRIX_SCENARIOS_LOCAL),MATRIX_SCENARIOS="$(MATRIX_SCENARIOS_LOCAL)",) \
	    pnpm test:live tests/live/matrix.live.test.js

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
