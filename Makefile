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

.PHONY: harness-build loop doctor session-health help setup install widgets assets new-widget dev start stop test test-unit test-e2e-headed test-e2e-spec test-e2e-widget turn-hermetic test-mcp-surface-live test-live-sweep test-matrix-live test-matrix-local test-matrix-gate grade-export test-designer-stage-live test-designer-apply-live introspect introspect-gate introspect-soar ship-verify release clean widget-inspect deploy-guard promote

# --- Effect-level guards -----------------------------------------------------
# Claude Code sets CLAUDECODE=1 in every shell it spawns. These are the real
# enforcement for an agent (TESTING.md, "Guardrails"); the permission deny rules in
# .claude/settings.json are advisory. Each block below is the ONE copy of its check.
#
# 1. Deploys and releases are the user's to run. A protected target depends on
#    deploy-guard, which runs before any prerequisite (harness-build included).
#    A human overrides with CONFIRM_DEPLOY=1.
define require_human
if [ -n "$$CLAUDECODE" ] && [ "$$CONFIRM_DEPLOY" != 1 ]; then echo "$(1): deploys/releases are the user's to run; a human can override with CONFIRM_DEPLOY=1" >&2; exit 2; fi
endef
deploy-guard:
	@$(call require_human,$(strip $(MAKECMDGOALS)))

# 2. The jest globalSetup and playwright.config.ts refuse to start under
#    CLAUDECODE unless VIA_MAKE=1 (scripts/via-make-guard.js). Target-specific,
#    so only these runs and their prerequisites carry it. Not guarded: loop,
#    doctor, session-health and the other non-runner targets.
test-unit test-e2e-headed test-e2e-spec turn-hermetic test-mcp-surface-live test-live-sweep test-matrix-live test-matrix-local test-designer-stage-live widget-inspect introspect introspect-soar: export VIA_MAKE := 1

# 3. Box-only dev deploys are the agent's iteration (CLAUDE.md: agents own
#    direct-to-box work; only the GitHub/PyPI release path -- release, push,
#    ship-verify -- stays the user's). make loop and make widget-push both just
#    push a widget to a box over REST, so each exports its own marker that the
#    ship.sh header check accepts: VIA_LOOP (loop) and VIA_WIDGET_PUSH
#    (widget-push). Nothing else reads them.
loop: export VIA_LOOP := 1

# 4. Feature branches reach main only after live confirmation. make promote is the
#    ONE way an agent moves main (any repo: root, widgets-src/*, connector,
#    framework, docubot); scripts/githooks/reference-transaction refuses every
#    other update of main under CLAUDECODE. Local merge only, never pushes.
promote: ## Merge BRANCH into local main of REPO, only with a VERIFIED clean live-sanity stamp for its head (REPO=<path> BRANCH=<branch>). Never pushes
	@bash scripts/promote.sh

help:
	@grep -E '^[a-zA-Z0-9_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

setup: install widgets ## One-shot bootstrap: install harness deps + clone widgets from the manifest
	bash scripts/install-git-hooks.sh
	@echo "Setup complete. Copy fortisoar-widget-harness/.env.example to .env, then 'make dev'."

install: ## Install harness deps (pnpm)
	cd $(HARNESS) && pnpm install

widgets: ## Clone/update widget repos into widgets-src/ from widgets.manifest
	bash scripts/clone-widgets.sh

harness-build: ## Compile the harness TypeScript into its gitignored .js (tsc). Prerequisite of every target that runs harness node code, so a fresh clone or a pull never runs stale compiled code
	cd $(HARNESS) && pnpm build

assets: harness-build ## Fetch the FortiSOAR app shell into fsr_src/ (needed for e2e; reads harness .env)
	bash fortisoar-widget-harness/scripts/fetch-soar-assets.sh

refresh-soar-types: harness-build ## Regenerate lib/soar-platform.d.ts from contenthub widgetServiceAPI docs (cross-checks fsr_src/app.unmin.js if present)
	cd $(HARNESS) && pnpm build && pnpm gen-types

new-widget: harness-build ## Scaffold a widget from a spec. SPEC=spec.json OR NAME=incidentSummary [KIND=record] [TRIGGER=1] [TITLE="…"]
	@if [ -n "$(SPEC)" ]; then \
	  cd $(HARNESS) && WIDGETS_SRC=$(WIDGETS_SRC) node scripts/new-widget.js --spec $(CURDIR)/$(SPEC); \
	elif [ -n "$(NAME)" ]; then \
	  cd $(HARNESS) && WIDGETS_SRC=$(WIDGETS_SRC) node scripts/new-widget.js "$(NAME)" $(if $(TITLE),--title "$(TITLE)") $(if $(KIND),--kind $(KIND)) $(if $(TRIGGER),--triggers-playbook); \
	else \
	  echo "Usage: make new-widget SPEC=spec.json   (or)   make new-widget NAME=<camelCase> [KIND=record] [TRIGGER=1] [TITLE=\"…\"]"; exit 2; \
	fi

dev: harness-build ## Run the harness you drive by hand -- http://localhost:14400
	cd $(HARNESS) && PORT=$(DEV_PORT) pnpm start

start: dev ## Alias for dev

stop: ## Kill both the dev (14400) and test (14401) servers
	-lsof -ti:$(DEV_PORT)  | xargs kill -9 2>/dev/null || true
	-lsof -ti:$(TEST_PORT) | xargs kill -9 2>/dev/null || true

# alias of test-unit
test: test-unit ## Full check: jest unit tests (use test-e2e-spec WIDGET=<name> for e2e)

test-unit: harness-build ## Jest unit tests -- harness only by default; WIDGET=<name>[,<name>] adds widget project(s), WIDGET=all runs every widget
	cd $(HARNESS) && WIDGET="$(WIDGET)" pnpm test

test-e2e-headed: harness-build ## Playwright e2e with browser UI (test server on 14401)
	cd $(HARNESS) && PORT=$(TEST_PORT) pnpm test:e2e:headed

# Scoped e2e on a fresh test server: kills any stale test-port server first (the
# recurring stale-server breakage) so Playwright always boots a fresh one.
#   make test-e2e-spec SPEC=tests/e2e/fsrAgenticAssistant.c2Hunt.spec.js
#   make test-e2e-spec SPEC="tests/e2e/a.spec.js tests/e2e/b.spec.js"
#   make test-e2e-spec WIDGET=agenticAssistant   # every e2e spec of one widget
# WIDGET matches the exact name: the folder widgets-src/<name>/ or a file named
# <name>.*.spec.js, never a longer widget name it prefixes (agenticAssistantMonitor).
# SPEC is one or more file patterns, separated by spaces or commas. Each is passed
# to Playwright as its own single-quoted argument: commas used to reach it as one
# regex that matched nothing ("No tests found"), and a `|` in a pattern ran as a
# shell pipe.
comma := ,
SPEC_ARGS = $(foreach s,$(subst $(comma), ,$(SPEC)),'$(s)')
WIDGET_ARG = '/$(WIDGET)[./]'
test-e2e-spec: harness-build ## Run e2e for one/more specs (SPEC="a.spec.js b.spec.js" or comma-separated) or every e2e spec of one widget (WIDGET=<name>) on an always-fresh test server
	@if [ -z "$(SPEC)$(WIDGET)" ]; then echo "Usage: make test-e2e-spec SPEC=tests/e2e/<file>.spec.js   (or WIDGET=<widgetName>)"; exit 2; fi
	-@$(HARNESS)/scripts/reap-e2e-orphans.sh
	@# E2E_LIVE= forces the MOCK stage to stay mock. playwright.config.ts keys
	@# testIgnore on that variable, so an ambient E2E_LIVE=1 in the caller's
	@# shell silently un-ignores every *Live*.spec.js and this stage starts
	@# driving a real box -- ship-verify's step 3/6 then fails on live-only
	@# preconditions long before the deploy it is supposed to gate. The stage
	@# that owns live (test-live-sweep, step 6/6) sets the flag itself.
	@# SPEC wins over WIDGET when both are given (Playwright filters are OR-ed, so
	@# combining them would widen the run instead of narrowing it).
	cd $(HARNESS) && PORT=$(TEST_PORT) E2E_LIVE=$(if $(SPEC),$$E2E_LIVE,) pnpm test:e2e $(if $(SPEC),$(SPEC_ARGS),$(WIDGET_ARG)) --reporter=list

# Old name for `test-e2e-spec WIDGET=<name>`.
test-e2e-widget: harness-build test-e2e-spec

# Seam C (stability plan Phase 0.4): the box-free real-widget ↔ real-connector
# turn. Boots the local-connector sidecar in HERMETIC mode (real operations.py +
# fake LLM + cassette reads -- no box, no LLM credits), then runs the Seam C e2e
# spec whose route interception forwards /api/integration/execute to it. This is
# the one tier that exercises the real widget controller against real connector
# logic without a live appliance. Teardown always kills the sidecar.
SEAMC_PORT   := 4778
SEAMC_SIDECAR := $(HARNESS)/scripts/local-connector-sidecar.py
SEAMC_PY     := $(HARNESS)/.venv-localdev/bin/python
SEAMC_SPEC   := ../widgets-src/agenticAssistant/tests/e2e/agenticAssistant.seamHermetic.spec.js
turn-hermetic: harness-build ## Seam C: real widget ↔ real connector, box-free (hermetic sidecar + e2e)
	-lsof -ti:$(SEAMC_PORT) | xargs kill -9 2>/dev/null || true
	-@$(HARNESS)/scripts/reap-e2e-orphans.sh
	CONN_REPO="$(CONN_REPO)" FSRPB_DEV=1 FSRPB_SIDECAR_HERMETIC=1 FSRPB_SIDECAR_PORT=$(SEAMC_PORT) \
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
# Needs the dev server up (make dev on DEV_PORT, or pass BASE=). Pass-through flags
# via ARGS. See scripts/widget-inspect.js --help for the full flag list.
#   make widget-inspect ARGS='--widget counter --config {"start":7} --text [data-testid=counter-value]'
widget-inspect: harness-build ## Mount a widget in the running harness + measure it as JSON (ARGS='--widget <name> ...')
	@if [ -z "$(ARGS)" ]; then cd $(HARNESS) && node scripts/widget-inspect.js --help; exit 0; fi
	cd $(HARNESS) && HARNESS_BASE=$(or $(BASE),http://localhost:$(DEV_PORT)) node scripts/widget-inspect.js $(ARGS)

BUMP ?= patch

# --- Box selection: ONE knob, ONE registry ------------------------------------
# BOX=<alias> picks the box: an alias in the pyfsr registry (~/.pyfsr/instances.toml)
# on the connector repo's scripts/box.sh list (`$(CONN_REPO)/scripts/box.sh --list`).
# The registry answers the env file every recipe sources and the ssh target; there
# is no default box. SHIP_ENV / SWEEP_ENV / MATRIX_ENV / LIVE_ENV / ENV / FSR_ENV /
# SSH_HOST are retired: for one release a human gets a warning and a registered env
# file is mapped to its alias; an agent (CLAUDECODE) is refused. `soarEnv.ts`
# (FSR_ENV_FILE) is still the harness runtime resolver; recipes hand it BOX_ENV.
#
# INVARIANT (ship-verify): the box it DEPLOYS to and the box its live sweep GRADES
# are the same BOX. There is one knob, so they cannot differ.
CONN_REPO ?= $(HOME)/PycharmProjects/ConnectorsV2/conn_main
BOX_SH := $(CONN_REPO)/scripts/box.sh
# A worktree of this repo has no widget repos under widgets-src/: default to the
# main checkout's (D10). An explicit WIDGETS_SRC= wins.
MAIN_CHECKOUT := $(or $(patsubst %/.git,%,$(shell git -C "$(CURDIR)" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)),$(CURDIR))
WIDGETS_SRC ?= $(if $(wildcard $(CURDIR)/widgets-src/*/widget/info.json),$(CURDIR)/widgets-src,$(MAIN_CHECKOUT)/widgets-src)
export WIDGETS_SRC
_DEP_KNOBS := ENV FSR_ENV SHIP_ENV SWEEP_ENV MATRIX_ENV LIVE_ENV SSH_HOST
_DEP_ARGS := $(strip $(foreach v,$(_DEP_KNOBS),$(if $(filter command line environment,$(origin $(v))),$(v)='$($(v))')))
_RESOLVED := $(if $(strip $(BOX)$(_DEP_ARGS)),$(shell BOX='$(BOX)' $(_DEP_ARGS) bash "$(BOX_SH)" --need 'env,ssh?' --make))
RESOLVED_BOX := $(word 1,$(_RESOLVED))
BOX_ENV := $(word 2,$(_RESOLVED))
unexport $(_DEP_KNOBS)
# A target that reaches a box must be TOLD which one: this prints the target or
# stops with the reason (no BOX, unknown alias, retired knob under an agent).
define require_box
@BOX='$(BOX)' $(_DEP_ARGS) bash "$(BOX_SH)" --need env
endef
# What to forward to the connector repo's make.
_FWD_BOX = BOX=$(or $(RESOLVED_BOX),$(BOX))

ship-verify: deploy-guard harness-build ## CANONICAL ship path: lint→typecheck→unit→e2e(mock)→deploy→live-sweep for one widget (WIDGET=, BUMP=patch)
	$(require_box)
	@if [ -z "$(WIDGET)" ]; then echo "Usage: make ship-verify WIDGET=<name> BOX=<alias> [BUMP=patch]"; exit 2; fi
	@echo "▶ 1/6 lint (server)";  cd $(HARNESS) && node scripts/widget.js lint $(WIDGET)
	@echo "▶ 1/6 lint (angular)"; cd $(HARNESS) && WIDGETS_SRC=$(WIDGETS_SRC) node scripts/lint-angular.js $(WIDGET)
	@echo "▶ 1/6 lint (testids)"; cd $(HARNESS) && WIDGETS_SRC=$(WIDGETS_SRC) node scripts/lint-testids.js $(WIDGET)
	@echo "▶ 1/6 typecheck";      cd $(HARNESS) && WIDGETS_SRC=$(WIDGETS_SRC) node scripts/typecheck-widgets.js $(WIDGET)
	@echo "▶ 2/6 unit"
	@$(MAKE) test-unit WIDGET=$(WIDGET)
	@echo "▶ 3/6 e2e (mock)"
	@$(MAKE) test-e2e-spec WIDGET=$(WIDGET)
	@echo "▶ 4/6 introspect-gate (hermetic DOM/payload/console regression vs baseline -- scoped to $(WIDGET))"
	@if [ -n "$(SKIP_INTROSPECT)" ]; then echo "  (SKIP_INTROSPECT set -- skipping; run 'make introspect-gate' separately)"; fi
	@$(if $(SKIP_INTROSPECT),,$(MAKE) introspect-gate GATE_WIDGET=$(WIDGET))
	@echo "▶ 5/6 deploy ($(if $(BUMP),$(BUMP),no bump)) via ship.sh (bulletproof start+push, BOX=$(RESOLVED_BOX) → same box tests hit)"; \
	  cd $(HARNESS) && FSR_ENV_FILE=$(BOX_ENV) PORT=$(DEV_PORT) WIDGETS_SRC=$(WIDGETS_SRC) \
	    scripts/ship.sh $(WIDGET) $(if $(filter-out none,$(BUMP)),--bump $(BUMP),)
	@# A missing sweep spec used to "skip" and still print "live-verified" below.
	@# That is the 0.2 bug class: the gate ran over an empty set and reported the
	@# same thing it reports when it passes -- and it already burned us once at
	@# the widget rename (see SWEEP_WIDGET). Skipping is now an explicit choice
	@# (SKIP_LIVE_SWEEP=1), and the completion line says which gates actually ran.
	@echo "▶ 6/6 live-sweep (BOX=$(RESOLVED_BOX) → the box just deployed to)"
	@WIDGET=$(WIDGET) SKIP_LIVE_SWEEP=$(SKIP_LIVE_SWEEP) BOX=$(RESOLVED_BOX) bash scripts/ship-verify-sweep.sh

widget-push: export VIA_WIDGET_PUSH := 1
widget-push: harness-build ## FAST dev deploy (~1-2 min): angular lint + unit -> deploy ONE widget to a box. No e2e/introspect/sweep (that is ship-verify, for releases). Box-only, agent-allowed (no CONFIRM_DEPLOY). WIDGET=, BOX=<alias>, BUMP=patch to bump (default: no bump)
	@if [ -z "$(WIDGET)" ]; then echo "Usage: make widget-push WIDGET=<name> BOX=<alias> [BUMP=patch]"; exit 2; fi
	$(require_box)
	@cd $(HARNESS) && WIDGETS_SRC=$(WIDGETS_SRC) node scripts/lint-angular.js $(WIDGET)
	@$(MAKE) --no-print-directory test-unit WIDGET=$(WIDGET)
	@cd $(HARNESS) && FSR_ENV_FILE=$(BOX_ENV) PORT=$(DEV_PORT) WIDGETS_SRC=$(WIDGETS_SRC) \
	    scripts/ship.sh $(WIDGET) $(if $(filter command line,$(origin BUMP)),$(if $(filter-out none,$(BUMP)),--bump $(BUMP),),)
	@echo "✓ widget-push: $(WIDGET) deployed to BOX=$(RESOLVED_BOX)"
	@# Live sanity on the box just deployed to, scoped to this widget (SKIP_LIVE_SANITY=1 opts out, loudly).
	@BOX="$(RESOLVED_BOX)" WIDGETS="$(WIDGET)" WIDGETS_SRC="$(WIDGETS_SRC)" CONN_REPO="$(CONN_REPO)" \
	  LIVE_SANITY_STAMP_REPOS="$(WIDGETS_SRC)/$(WIDGET)" bash scripts/live-sanity.sh

push: deploy-guard harness-build ## IDEMPOTENT deploy of working trees to a box: connector+framework + CHANGED widgets. BOX=<alias> WIDGETS=auto|all|list CONNECTOR=1|0 DRY_RUN=1 (no gates; that is loop/ship-verify)
	$(require_box)
	@BOX="$(RESOLVED_BOX)" WIDGETS="$(WIDGETS)" CONNECTOR="$(CONNECTOR)" \
	    DRY_RUN="$(DRY_RUN)" DEV_PORT="$(DEV_PORT)" CONN_REPO="$(CONN_REPO)" bash scripts/push.sh

release: deploy-guard harness-build ## GitHub release for one widget: bump info.json -> commit -> push develop (fires release.yml). WIDGET=, BUMP=patch
	@if [ -z "$(WIDGET)" ]; then echo "Usage: make release WIDGET=<name> [BUMP=patch]"; exit 2; fi
	cd $(HARNESS) && WIDGETS_SRC=$(WIDGETS_SRC) scripts/release.sh $(WIDGET) $(BUMP)

# The dev loop, doctor and session-health live in the connector repo (it owns the
# Python venv with pyfsr); these forward so either repo is a fine place to type them.
loop: ## THE dev command: local tests + Frank agent smoke -> copy working trees to the box -> ~35s live smoke (see conn_main scripts/loop.sh)
	$(require_box)
	@$(MAKE) --no-print-directory -C $(CONN_REPO) loop $(_FWD_BOX)

doctor: ## Preflight: is anything about to make a test result lie? (LOCAL=1 no box, RELEASE=1 strict, SANITY=1 adds the ~1-2 min live sanity pass: re-check a box without pushing; STAMP=<repo dir>[:<dir>] also stamps those checkouts for make promote)
	$(if $(LOCAL),,$(require_box))
	@$(MAKE) --no-print-directory -C $(CONN_REPO) doctor $(_FWD_BOX)
	@$(if $(SANITY),$(if $(LOCAL),echo "doctor: SANITY=1 needs a box (drop LOCAL=1)"; exit 2,BOX="$(RESOLVED_BOX)" CONN_REPO="$(CONN_REPO)" WIDGETS="$(WIDGETS)" LIVE_SANITY_STAMP_REPOS="$(STAMP)" bash scripts/live-sanity.sh),true)

session-health: ## Which chat tools fail, with inputs/outputs, classed model/remote/guard/env/tool_bug + recovered vs stuck (LIMIT=30 OUT=report.md SOURCE=local)
	$(if $(filter local,$(SOURCE)),,$(require_box))
	@$(MAKE) --no-print-directory -C $(CONN_REPO) session-health $(_FWD_BOX) \
	  $(if $(LIMIT),LIMIT=$(LIMIT),) $(if $(OUT),OUT=$(abspath $(OUT)),) $(if $(SOURCE),SOURCE=$(SOURCE),)

# Derive the sweep spec from the widget name instead of hardcoding it. The old
# hardcoded `fsrAgenticAssistant` path went stale at the widget rename, and BOTH
# call sites failed silently-ish: `make test-live-sweep` died with "No tests
# found", and ship-verify's `if [ "$(WIDGET)" = "fsrAgenticAssistant" ]` guard
# stopped matching, so the CANONICAL ship path skipped its live gate entirely
# and still printed "live-verified".
SWEEP_WIDGET ?= $(if $(WIDGET),$(WIDGET),agenticAssistant)
# Use the BOX env file explicitly. The bare `.env` points at whichever box was
# last worked on, so a sweep run right after shipping elsewhere silently
# [[SWEEP-ENV-SKIP]]s with "connector not present/configured" -- which reads like
# a box outage rather than "you are pointed at the wrong box".

test-mcp-surface-live: harness-build ## LIVE M2 widget-tier proof: the mounted page decides the MCP surface (BOX=<alias>)
	@# Its own target rather than `test-e2e-spec SPEC=…` because a live spec needs
	@# the box env sourced, and test-e2e-spec deliberately does not source one --
	@# an ambient E2E_LIVE=1 there would un-ignore every live spec in the mock tier.
	$(require_box)
	-@$(HARNESS)/scripts/reap-e2e-orphans.sh
	cd $(HARNESS) && set -a && . "$(BOX_ENV)" && set +a && \
	  PORT=$(TEST_PORT) E2E_LIVE=1 FSRPB_LIVE_UI=1 \
	  pnpm test:e2e ../widgets-src/$(SWEEP_WIDGET)/tests/e2e/$(SWEEP_WIDGET).mcpSurface.spec.js --reporter=list

# ROWS= runs only the named rows (their leading id: ROWS=2,3 or ROWS=1a) -- the
# fast way to re-check the row an edit touched. A targeted run prints
# [[SWEEP-PARTIAL]], never [[SWEEP-VERIFIED]]: it cannot stand in for the full
# proof a release needs. Every run's output is KEPT under
# test-results/live-sweep/<timestamp>/ -- a failure whose details scrolled away
# has to be re-driven at ~2 min a row.
SWEEP_GREP = $(if $(ROWS),--grep "(^| )($(subst $(COMMA),|,$(ROWS)))[a-z]? ",)
COMMA := ,
test-live-sweep: harness-build ## LIVE forticloud UI bug-hunt sweep (real connector). RUNS=<n> repeats, ROWS=2,3 for a subset. Prints [[SWEEP-VERIFIED]]/[[SWEEP-PARTIAL]]/[[SWEEP-ENV-SKIP]]/[[SWEEP-FAIL]]; exits 0 only when verified.
	$(require_box)
	-@$(HARNESS)/scripts/reap-e2e-orphans.sh
	@# A hard-down box makes the spec's beforeAll print [[SWEEP-ENV-SKIP]] and
	@# skip every scenario. Playwright exits 0 on all-skipped, so without this
	@# check ship-verify would print "live-verified" over a gate that graded
	@# NOTHING (#96). The gate keys on output markers (not exit codes): a
	@# `$(MAKE)` recipe exit is remapped to 2, so 77 can't cross the make
	@# boundary. fail=1 is a real widget failure; ran==0 (no [[SWEEP]] result
	@# lines) with fail==0 is the env-skip class (box down).
	@# THIRD class: the box is up and most rows grade fine, but one needs a
	@# capability it lacks (no firewall connector ⇒ containment can't card).
	@# Playwright exits 0 on a skip, so keying only on the exit code would print
	@# "live-verified" over a gate that graded LESS than it claims -- #96 again,
	@# partial instead of total. Any [[SWEEP-ENV-SKIP]] marker therefore demotes
	@# the whole run, and says how many rows covered nothing.
	@set -o pipefail; \
	n=$${RUNS:-1}; i=1; fail=0; \
	log_dir="$(CURDIR)/test-results/live-sweep/$$(date +%Y%m%d-%H%M%S)"; mkdir -p "$$log_dir"; \
	sweep_log="$$log_dir/all.log"; : > "$$sweep_log"; \
	while [ $$i -le $$n ]; do \
	  echo "===== live-sweep run $$i/$$n ====="; \
	  ( cd $(HARNESS) && set -a && . "$(BOX_ENV)" && set +a && \
	    PORT=$(TEST_PORT) E2E_LIVE=1 FSRPB_LIVE_UI=1 \
	    pnpm test:e2e ../widgets-src/$(SWEEP_WIDGET)/tests/e2e/$(SWEEP_WIDGET).liveSweep.spec.js --reporter=list $(SWEEP_GREP) ) 2>&1 | tee "$$log_dir/run$$i.log" || fail=1; \
	  cat "$$log_dir/run$$i.log" >> "$$sweep_log"; \
	  i=$$((i+1)); \
	done; \
	if [ $$fail -ne 0 ]; then \
	  echo "[[SWEEP-FAIL]] live-sweep reported a test failure (see output above) -- widget regression. Logs: $$log_dir"; \
	  exit 1; \
	fi; \
	ran=$$(grep -F -c '[[SWEEP]]' "$$sweep_log" 2>/dev/null || true); ran=$${ran:-0}; \
	envskip=$$(grep -F -c '[[SWEEP-ENV-SKIP]]' "$$sweep_log" 2>/dev/null || true); envskip=$${envskip:-0}; \
	echo "   logs: $$log_dir"; \
	if [ "$$ran" -eq 0 ]; then \
	  echo "[[SWEEP-ENV-SKIP]] live-sweep graded 0 scenarios -- NOT live-verified (box down / gate covered nothing). Re-run when the box is up."; \
	  exit 1; \
	fi; \
	if [ "$$envskip" -ne 0 ]; then \
	  echo "[[SWEEP-ENV-SKIP]] live-sweep graded $$ran scenario(s) but env-skipped $$envskip -- NOT live-verified (a capability this box lacks, e.g. an unconfigured connector). The rows that RAN are clean; the skipped ones covered nothing."; \
	  exit 1; \
	fi; \
	if [ -n "$(ROWS)" ]; then \
	  echo "[[SWEEP-PARTIAL]] live-sweep graded $$ran scenario(s) of ROWS=$(ROWS) -- clean, but a subset is not the full proof."; \
	  exit 0; \
	fi; \
	echo "[[SWEEP-VERIFIED]] live-sweep graded $$ran scenario(s) -- live-verified."; \
	exit 0

# Scenario rows carry real record UUIDs, so they are BOX-SPECIFIC and track BOX:
# BOX=206 -> scenarios.local.206.json when present, else the plain
# scenarios.local.json. MATRIX_SCENARIOS=<path> overrides. All are gitignored; the
# template is scenarios.local.example.json.
MATRIX_BOX := $(RESOLVED_BOX)
MATRIX_SCENARIOS ?= $(if $(wildcard $(HARNESS)/tests/live/scenarios.local.$(MATRIX_BOX).json),$(abspath $(HARNESS)/tests/live/scenarios.local.$(MATRIX_BOX).json),$(abspath $(HARNESS)/tests/live/scenarios.local.json))
# MATRIX_GATE filters rows by their `gate` field (see matrixDriver.gateRow).
# Unset = every runnable row.
test-matrix-live: harness-build ## LIVE prompt/flow matrix (docs/PROMPT_FLOW_TEST_PLAN.md T1-T10/P1-P6) vs the deployed widget. HEADED (WAF blocks headless). Scenarios auto-select per box: BOX=206 → tests/live/scenarios.local.206.json (gitignored). MATRIX_GATE=strict,xfail for gating rows only; MATRIX_IDS=Z3,Z5 for a hand-picked subset.
	$(require_box)
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
	  echo "▶ matrix: box=$(MATRIX_BOX) scenarios=$(notdir $(MATRIX_SCENARIOS)) gate=$(if $(MATRIX_GATE),$(MATRIX_GATE),<all>) ids=$(if $(MATRIX_IDS),$(MATRIX_IDS),<all>)"; \
	  cd $(HARNESS) && set -a && . "$(BOX_ENV)" && set +a && \
	  FSRPB_LIVE=1 FSRPB_HEADED=1 MATRIX_GATE="$(MATRIX_GATE)" MATRIX_IDS="$(MATRIX_IDS)" MATRIX_SCENARIOS="$(MATRIX_SCENARIOS)" \
	    pnpm test:live tests/live/matrix.live.test.js; \
	fi

# Old name for `test-matrix-live MATRIX_GATE=strict,xfail`: GATING rows only (gate:strict must stay clean + gate:xfail must stay broken-or-promote). Deliberately NOT in ship-verify -- each row is a headed box turn (~2-4 min). BOX=206 for build flows.
test-matrix-gate: MATRIX_GATE = strict,xfail
test-matrix-gate: test-matrix-live

# ── The LOCAL matrix ────────────────────────────────────────────────────────
#
# Same grader, same scenario rows, same verdict ladder as test-matrix-live --
# but driven against the widget in the dev harness talking to the connector
# sidecar on this laptop (lib/localUiDriver.js). No widget ship, no connector
# ship, no box login. Use it to iterate; use test-matrix-live to certify.
#
# Where it sits among the tiers (each proves something the others cannot):
#   make test-e2e-spec    mocked connector      → DOM/render only
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
test-matrix-local: harness-build ## LOCAL matrix: the same graded rows against the harness + connector sidecar (no ship, no box login). Needs the LOCAL_DEV.md loop running. MATRIX_IDS=Z3,Z5 for a subset.
	@echo "▶ matrix (LOCAL): base=$(MATRIX_LOCAL_BASE) gate=$(if $(MATRIX_GATE),$(MATRIX_GATE),<all>) ids=$(if $(MATRIX_IDS),$(MATRIX_IDS),<all>)"
	@echo "  grading your WORKING TREE -- this does not prove the deployed path (use test-matrix-live for that)"
	cd $(HARNESS) && \
	  MATRIX_TARGET=local FSRPB_LOCAL_BASE="$(MATRIX_LOCAL_BASE)" \
	  MATRIX_GATE="$(MATRIX_GATE)" MATRIX_IDS="$(MATRIX_IDS)" \
	  $(if $(MATRIX_SCENARIOS_LOCAL),MATRIX_SCENARIOS="$(MATRIX_SCENARIOS_LOCAL)",) \
	    pnpm test:live tests/live/matrix.live.test.js

grade-export: harness-build ## Grade a downloaded widget .events.json chat export offline (EXPORT=~/Downloads/fsrpb-chat-...events.json). Flags known-bad flow signatures; exits non-zero on FAIL.
	@if [ -z "$(EXPORT)" ]; then echo "Usage: make grade-export EXPORT=<path-to-.events.json>"; exit 2; fi
	cd $(HARNESS) && node tests/live/scripts/gradeExport.js "$(EXPORT)"

# Live box tests resolve their box through the registry (require_box): BOX=<alias>.

test-designer-stage-live: harness-build ## LIVE: Apply to designer stages an edit into the REAL open designer (no reload, nothing written). Pushes + deletes a scratch playbook. BOX=<name>
	$(require_box)
	@cd $(HARNESS) && set -a && . "$(BOX_ENV)" && set +a && \
	  E2E_LIVE=1 pnpm test:live tests/live/designerStage.live.test.js

# docubot (TEC kit) drives the live designer tier. DOCUBOT= points at a kit
# checkout or worktree (its own node_modules and Playwright pin); its config +
# tsconfig are both required (the tsconfig carries the `docubot` path mapping).
DOCUBOT ?= $(HOME)/PycharmProjects/TEC/docubot
test-designer-apply-live: ## LIVE (docubot, no LLM): Apply to designer -> designer Save -> Apply again is never blocked, and each Save writes. Scratch playbook run-tagged and deleted. BOX=<name> [DOCUBOT=<kit>]
	$(require_box)
	@test -x "$(DOCUBOT)/node_modules/.bin/playwright" || { echo "docubot kit not installed at $(DOCUBOT) (pass DOCUBOT=<kit>)"; exit 2; }
	@set -a && . "$(BOX_ENV)" && set +a && \
	  cd "$(DOCUBOT)" && VIA_MAKE=1 FORCE=1 DOCUBOT_TARGET="$(CURDIR)/$(HARNESS)/tests" \
	  node_modules/.bin/playwright test --config="$$PWD/playwright.config.ts" --tsconfig="$$PWD/tsconfig.json" \
	  "$(CURDIR)/$(HARNESS)/tests/docubot/designerApply.spec.ts"

introspect: harness-build ## Hermetic widget-render introspection (builds baseline reports; introspect-gate compares). Boots its own server on $(INTROSPECT_PORT).
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

introspect-gate: harness-build introspect ## Run introspection + fail if any widget regresses past thresholds (payload +10%, boot +100% relative to the run, new console errors). GATE_WIDGET=<name> scopes the pass/fail to one widget.
	@echo "▶ Checking regressions against baseline…"
	@cd $(HARNESS) && pnpm node scripts/introspect-gate.js $(GATE_WIDGET)

introspect-soar: harness-build ## Real-SOAR fidelity diff (Phase 2): render deployed widget(s) on a live box, diff vs the harness baseline. BOX=<alias> to point it; ARGS='--offline' to re-diff without driving the box.
	@echo "▶ Rendering deployed widget(s) live + diffing vs harness baseline…"
	@cd $(HARNESS) && set -a; [ -n "$(BOX_ENV)" ] && . "$(BOX_ENV)"; set +a; pnpm node scripts/introspectSoar.js $(ARGS)

clean: ## Remove harness node_modules + test artifacts
	rm -rf $(HARNESS)/node_modules $(HARNESS)/test-results test-results

# Cross-repo agreement report (widget dev kit / framework / connector). Reads only.
agreement: ## Report every cross-repo agreement point; DRIFT exits 1 (REPORT=1 always exits 0)
	python3 scripts/cross_repo_agreement.py $(if $(REPORT),--report,)
