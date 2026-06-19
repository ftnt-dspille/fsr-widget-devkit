HARNESS := fortisoar-widget-harness

# Two dedicated, never-overlapping ports:
#   DEV_PORT  — the harness you drive by hand (`make dev`)
#   TEST_PORT — the isolated server Playwright boots for `make test`
# They differ on purpose so running tests never kills (or races) your dev
# server, and a stale dev server never serves the wrong widget to a test run.
# Both are forced here via PORT=, which overrides .env (dotenv does not
# override an already-set env var) so the port can't drift out from under us.
DEV_PORT  := 14400
TEST_PORT := 14401

.PHONY: help setup install widgets assets dev start stop test test-unit test-e2e-headed test-e2e-spec test-e2e-widget test-live-sweep test-ar-playbook-live ship-verify clean

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

BUMP ?= patch
ship-verify: ## CANONICAL ship path: lint→unit→e2e(mock)→deploy→live-sweep for one widget (WIDGET=, BUMP=patch)
	@if [ -z "$(WIDGET)" ]; then echo "Usage: make ship-verify WIDGET=<name> [BUMP=patch]"; exit 2; fi
	@echo "▶ 1/5 lint";       cd $(HARNESS) && node scripts/widget.js lint $(WIDGET)
	@echo "▶ 2/5 unit";       $(MAKE) test-unit WIDGET=$(WIDGET)
	@echo "▶ 3/5 e2e (mock)"; $(MAKE) test-e2e-widget WIDGET=$(WIDGET)
	@echo "▶ 4/5 deploy ($(BUMP)) via ship.sh (bulletproof start+push, harness .env → same box tests hit)"; \
	  cd $(HARNESS) && FSR_ENV_FILE=$(CURDIR)/$(HARNESS)/.env PORT=$(DEV_PORT) WIDGETS_SRC=$(CURDIR)/widgets-src \
	    scripts/ship.sh $(WIDGET) --bump $(BUMP)
	@echo "▶ 5/5 live-sweep"; \
	  if [ "$(WIDGET)" = "fsrSocAssistant" ]; then $(MAKE) test-live-sweep; \
	  else echo "  (no live sweep defined for $(WIDGET) — skipping)"; fi
	@echo "✅ ship-verify complete: $(WIDGET) gated, deployed, and live-verified."

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

test-ar-playbook-live: ## LIVE action-renderer EDIT playbook-listing test vs the box that has playbooks (.env.box = 205). AR_ALERT_UUID=<uuid> to override the alert.
	-lsof -ti:$(TEST_PORT) | xargs kill -9 2>/dev/null || true
	@if [ ! -f $(HARNESS)/.env.box ]; then echo "missing $(HARNESS)/.env.box (box creds)"; exit 2; fi
	cd $(HARNESS) && set -a && . ./.env.box && set +a && \
	  PORT=$(TEST_PORT) E2E_LIVE=1 \
	  pnpm test:e2e tests/e2e/actionRenderer.playbookListingLive.spec.js --reporter=list

clean: ## Remove harness node_modules + test artifacts
	rm -rf $(HARNESS)/node_modules $(HARNESS)/test-results test-results
