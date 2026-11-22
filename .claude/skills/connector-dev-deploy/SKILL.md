---
name: connector-dev-deploy
description: Use when changing the agentic-assistant connector or the fsr_playbooks framework and moving it to a box (new operation, dependency install trouble, info.json config fields, release ordering), or when a deploy "succeeded" but the box behaves like old code.
---

# Connector and framework: what the doors do not tell you

The loop is `make check` then `make ship BOX=<alias>` (project CLAUDE.md). Agents use the make
front doors only: never `scripts/deploy.sh`, raw ssh or ad-hoc pyfsr snippets. PyPI releases
(`make deploy FW=...`, `release-ship`) are the owner's. A STABLE box never gets a push: it takes
code only through `make stable`.

## Ordering and ownership
- Framework and connector are a producer/consumer pair: the connector pins `fsr-playbooks==X` in
  `requirements.txt` (single source) and imports symbols from it. Connector code that imports an
  unreleased framework symbol breaks the whole triage import on the box; the release order
  (release, PyPI serves it, symbol-verified pin bump, ship) is enforced by `deploy`, which is the owner's.
- Dependency install failures on a box have been "ship raced the PyPI release", not a platform bug. Fix
  the release; never hand-install a wheel. `requirements_installed = 'In-Progress'` is a symptom.
- Live proof comes BEFORE any publish; do not reach for `release-ship` to test.
- A framework change is tested against the framework tree you are in (agent tree, or the framework
  worktree). Ship syncs your own framework tree to the box, else a clean export of its remote main, never
  the shared checkout, and prints the sha.

## Stable box (make stable)
- The only path to a stable box: the promoted mains are built and uploaded as one solution pack through
  the Import Wizard (pyfsr `import_config`, REST). No ssh, no rsync, no PyPI for the framework.
- The framework wheel is built from `packaging/fsr_playbooks` at framework main (the version carries
  `g<sha>`) and bundled in the connector tarball with `--find-links wheels`; tracked `requirements.txt`
  is untouched. Widgets are packed fresh with the harness packager.
- The guard (`scripts/stable_guard.py`) refuses unless the box is `role = "stable"`, every repo is clean
  on its package inputs (`.github/package-inputs`), on main, equal to its remote main, and each HEAD
  has a VERIFIED clean stamp from an experimental box. `make ship` makes that stamp.
- Idempotent: a box already carrying the heads is not re-uploaded; a changed head re-imports.

## What bites on a box
- A NEW operation in `info.json` is not callable after a plain copy ("Operation matching query does
  not exist"). A bumped install registers it; the push path escalates by itself and re-applies the
  framework dev-patch. A widget tab on a new op reads as "Could not load" until then.
- Deleted files used to linger on the box; the sync prunes after each push (over `PRUNE_MAX=40`
  deletes nothing).
- Publish recycles the workers and clears in-process caches (the persona resolver caches a negative
  result per worker with no TTL); new Key Store personas may need that recycle.
- Verify your code is on the box by grepping the INSTALLED source under the connectors dir
  (`.../integrations/connectors/connector-<name>_<v_v_v>/`, version dots become underscores).
- `deploy.sh` publish-recycle can fail once with `publish FAILED 400: 'config_id'` on a loaded box and
  the warmup then errors `No module named '<connector>_<v>'`; the install itself succeeded. Re-run.
- Frontend lint runs TWO linters (`lint-angular`, `lint-testids`); neither is the harness server lint.

## Probing without shipping
- In-process against a real box: set the box env, `FSRPB_DEV=1`, run the script (the connector resolves
  a pyfsr client when there is no on-platform crudhub). The laptop sidecar (`FSR_LOCAL_CONNECTOR=1`)
  runs connector + LLM locally with a box for SOAR data; it must put the connector dir on `sys.path`.

## info.json and platform behaviours
- A config field without `"visible": true` is HIDDEN in the UI.
- `is_config_required: false` hands the op an EMPTY config dict; declare `true` for ops that read config.
- Shipped `fsr_playbooks` MCP tools that `sys.path`-insert `tooling/` break in non-editable installs
  (`No module named 'cli'`); do not import dev tooling from shipped code.
- A connector rename leaves two installed connectors on a box; widgets must follow the connector
  identity (single source: the widget service file). Stale browser bundle after a widget redeploy: hard refresh.
- mcp 2.x changed `streamable_http_client` to take `http_client=` (no `headers`); keep anyio below 4.15.
- Wire frames are built through pydantic models; `exclude_unset` matters.
