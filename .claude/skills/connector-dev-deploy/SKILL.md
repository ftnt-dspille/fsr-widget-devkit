---
name: connector-dev-deploy
description: Use when changing the agentic-assistant connector or the fsr_playbooks framework and moving it to a box (dev-push, ship, new operation, dependency install trouble, info.json config fields, release ordering), or when a deploy "succeeded" but the box behaves like old code.
---

# Connector dev and deploy loop

The connector repo's `CLAUDE.md` and `make help` are authoritative; this skill carries the gotchas.
Agents use the make front doors only: never `scripts/deploy.sh`, raw ssh or ad-hoc pyfsr snippets.
PyPI releases (`make deploy FW=...`, `release-ship`) are the owner's, and releases are now only for
outside users. A STABLE box never gets a deploy or a release: it takes code only through `make stable`.

## Ordering and ownership
- Framework and connector are a producer/consumer pair: the connector pins `fsr-playbooks==X` in
  `requirements.txt` (single source) and imports symbols from it. Shipping connector code that imports an
  unreleased framework symbol breaks the whole triage import on the box. Release order is enforced by
  `deploy`: release, wait until PyPI SERVES the version, symbol-verified pin bump, ship.
- Dependency install failures on a box have been "ship raced the PyPI release" (the box's index was one
  version stale), not a platform bug. Fix the release; never hand-install a wheel. `Connector.
  requirements_installed = 'In-Progress'` is a symptom, and several built-in connectors sit there forever.
- Dev-sync + live proof comes BEFORE any publish. Dev-ship the working tree to validate a fix; do not reach
  for `release-ship` to test (it aborted twice on unrelated flaky gates once).

## Stable box (make stable)
- `make stable BOX=<stable alias>` (root Makefile -> `scripts/stable.sh`) is the only path to a stable
  box. It builds the promoted mains and uploads one solution pack through the Import Wizard (pyfsr
  `import_config`, REST). No ssh, no rsync, no PyPI for the framework.
- The framework wheel is built from `packaging/fsr_playbooks` at framework main (hatch-vcs: the version
  carries `g<sha>`). `build.sh` with `FSR_PLAYBOOKS_WHEEL=<wheel>` bundles it in the tarball: the tarball
  is built from a staged copy whose `requirements.txt` pins that exact version and adds `--find-links
  wheels`. Tracked `requirements.txt` is untouched (it pins the PyPI release for every other path).
  pip resolves the relative `--find-links` against the requirements file, so the platform's pip finds the
  bundled wheel from any working directory.
- The widgets are packed fresh with the harness packager (`packageWidget`), not taken from a cached tgz.
  The pack builder (`build_agentic_assistant_pack.py`) takes explicit `--connector-tgz`/`--widget-tgz`.
- The stable guard (`scripts/stable_guard.py`) refuses unless the box is `role = "stable"`, every repo is
  clean on its package inputs, on main, equal to its remote main, and each HEAD has a VERIFIED clean
  stamp taken on an experimental box. To get that stamp for a head: push it to an experimental box
  (`make push`/`dev-push`/`widget-push`), then `make doctor BOX=<exp> SANITY=1 STAMP=<checkout>`.
- Idempotent: the install record (`dist/stable/installed-<box>.json`) holds the heads; a box already
  carrying them with its versions is not re-uploaded. A changed head re-imports, and `bump_existing`
  re-versions any installer the box would silently skip (the bump is reported).

## Dev loop
- `make loop BOX=<alias>` is the default. `make dev-push BOX=<alias>` copies framework + connector trees and
  recycles workers once. `make push` is the idempotent front door (connector + framework + CHANGED widgets).
- Deleted files used to linger on the box (rsync has no `--delete`); `scripts/prune_remote_py.sh` runs after
  each dev sync (dry-run count first; over `PRUNE_MAX=40` deletes nothing).
- A NEW operation in `info.json` is not callable after a plain copy ("Operation matching query does not
  exist"). A bumped install registers it (`make ship BUMP=patch`); `dev_push.sh` auto-escalates and then
  re-applies the framework dev-patch. A widget tab on a new op reads as "Could not load" until then.
- Publish recycles the workers and clears in-process caches (persona resolver caches a negative result per
  worker with no TTL). New Key Store personas may need that recycle to show up.
- Verify your code is on the box by grepping the INSTALLED source under the connectors dir
  (`.../integrations/connectors/connector-<name>_<v_v_v>/`, version dots become underscores).
  Guessing another path returns a false NOT_FOUND.
- `deploy.sh` publish-recycle can fail once with `publish FAILED 400: 'config_id'` on a loaded box and the
  warmup then errors `No module named '<connector>_<v>'`; the install itself succeeded. Re-run with the bump
  set to none.
- `make release-ship` does not clear the dev-patch marker; `make ship-dev ACTION=status|restore`.
- Frontend `ship-verify` runs TWO linters; `lint-angular` and `lint-testids` are not the harness server lint.

## Probing without shipping
- In-process against a real box: set the box env, `FSRPB_DEV=1`, run the script (the connector resolves a
  pyfsr client when there is no on-platform crudhub). The laptop sidecar (`FSR_LOCAL_CONNECTOR=1`, harness
  route registered at top level, not inside the hermetic block) runs connector + LLM locally with a box
  for SOAR data. The sidecar must put the connector dir on `sys.path` (bare `import fsr_soc_triage`).

## info.json and platform behaviours
- A config field without `"visible": true` is HIDDEN in the UI; omitting it is not a safe default.
- `is_config_required: false` hands the op an EMPTY config dict, every config-derived branch takes its unset
  path and the op still returns ok. Declare `true` for ops that read config.
- Shipped `fsr_playbooks` MCP tools that `sys.path`-insert `tooling/` break in non-editable installs
  (`No module named 'cli'`); do not import dev tooling from shipped code.
- Connector rename leaves two installed connectors on a box; widgets must follow the connector identity
  (single source: the widget service file). Stale browser bundle after widget redeploy: hard refresh.
- mcp 2.x changed `streamable_http_client` to take `http_client=` (no `headers`); keep anyio below 4.15.
- Wire frames are built through pydantic models; `exclude_unset` matters (HARDEN-3).

Sources: ship_via_connector_makefile, dev_push_cannot_register_new_connector_ops (UPDATE section),
fsr_framework_release_process, connector_dep_install_stuck, connector_publish_refreshes_workers,
box_connector_install_path, fsrpb_deploy_publish_retry, connector_config_field_needs_visible_true,
is_config_required_false, published_fsr_playbooks_imports_dev_tooling, mcp_2x_upgrade (UNMERGED branch; verify
pin before relying), widget_connector_name_drift; checked against conn_main CLAUDE.md.
