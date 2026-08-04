# Shipping -- uploading the widget + connector to FortiSOAR

`LOCAL_DEV.md` is the fast local loop (connector + LLM on the laptop). This doc
is the other side: **shipping to a real FortiSOAR box** -- building, versioning,
and installing both the widget and the connector. Both sides already have
unified scripts; this is the one place that shows them together.

The canonical build→test→deploy pipeline (including the live sweep) is
`TESTING.md` §"Canonical build → test → deploy flow" (`make ship-verify`). This
doc is the narrower "just get it onto the box" reference.

## Two artifacts, two repos

| Artifact | Repo | Build output | Install target |
|---|---|---|---|
| **Widget** | this repo (`widgets-src/<name>/`) | `<name>-<ver>.tgz` (Connector Store shape) | `POST /api/3/widgets` (+ publish) |
| **Connector** | `~/PycharmProjects/ConnectorsV2/fsr-playbook-builder/` | `connector-fsr-soc-assistant-<ver>.tgz` (Connector Store shape; `fsr_playbooks` wheel materialized into `wheels/`) | Connector Store `$replace` install |

## Point both at the same box

Both shippers read box creds from a `.env` (pyfsr `EnvConfig` on the connector
side; the harness `FSR_ENV_FILE` on the widget side). Point them at the same box
so a widget+connector pair deploys consistently. For the 8.0 standard:

```sh
# A single env file with: FSR_BASE_URL, FSR_PORT, FSR_USERNAME, FSR_PASSWORD, FSR_VERIFY_SSL
# The harness already has .env.159 (gitignored) -- reuse it for both sides.
export FSR_BASE_URL=https://fortisoar.example.com:13000
export FSR_PORT=13000
export FSR_USERNAME=labuser
export FSR_PASSWORD='<your-password>'
export FSR_VERIFY_SSL=false   # self-signed
```

The harness's `.env.159` already has these; source it for the connector side too.

## Widget -- ship to the box

```sh
cd fortisoar-widget-harness

# Push one widget to the box the harness is pointed at (builds + version-bumps + installs + publishes):
scripts/ship.sh <widgetId>                  # e.g. fortiaiAgenticAssistant
scripts/ship.sh <widgetId> --bump patch     # bump info.json version first
scripts/ship.sh --restart                   # just (re)start the harness, no push

# Point at a specific box (default FSR_ENV_FILE = ~/PycharmProjects/FSRPlaybookYaml/.env):
FSR_ENV_FILE=$PWD/.env.159 PORT=14409 scripts/ship.sh <widgetId>
```

`ship.sh` guarantees a **fresh server** start (kills anything on the port first)
so a stale harness never pushes to the wrong box. **Never start `node server.js`
by hand for a deploy** -- use `ship.sh`.

The full pipeline (lint → unit → mock-e2e → deploy → live-sweep) is one command:

```sh
make ship-verify WIDGET=fortiaiAgenticAssistant [BUMP=patch]
```

See `TESTING.md` for the invariants `ship-verify` encodes (connector-identity
single-source, `make test-unit` must exit 0, the hermetic mock tier, the live
sweep).

## Connector -- ship to the box

```sh
cd ~/PycharmProjects/ConnectorsV2/fsr-playbook-builder

# Unified deploy: bump version → vendor+build tarball → install onto live FSR ($replace).
scripts/deploy.sh                      # bump patch, build, install
scripts/deploy.sh --bump minor         # 0.3.x → 0.4.0
scripts/deploy.sh --version 0.4.2      # set an explicit version
scripts/deploy.sh --bump none          # build+install the CURRENT version (no bump)
scripts/deploy.sh --with-config        # also create/refresh the named config (fsrpb-live)
scripts/deploy.sh --no-install         # bump + build only (CI / dry run)
scripts/deploy.sh --no-warmup          # install but skip the post-install warmup
```

Auth + target come from the env via pyfsr's `EnvConfig` (`FSR_BASE_URL`,
`FSR_API_KEY` **or** `FSR_USERNAME`/`FSR_PASSWORD`, `FSR_VERIFY_SSL`,
`FSR_PORT`) -- set those (or source `.env.159`) before running. Idempotent:
`$replace` upgrades in place; `--with-config` refreshes the named config without
duplicating it.

Under the hood (rarely run by hand):
- `scripts/build.sh` -- emits the `.tgz` (materializes the pinned `fsr_playbooks`
  wheel into `wheels/` so air-gapped boxes can `pip install --find-links wheels/`
  offline; the reference DB ships inside the wheel).
- `scripts/install_to_fsr.py` -- the install step (`deploy.sh` calls it). `--with-config`
  also creates/refreshes the `fsrpb-live` config.

## Order when shipping both

The connector emits the transcript events the widget renders -- keep their
contract versions in sync. When shipping a pair:

1. **Connector first** (`scripts/deploy.sh`) -- the widget may depend on a newer
   contract/operation. A widget deployed before its connector can 400 on a
   missing op.
2. **Widget second** (`scripts/ship.sh <widgetId>`).
3. Verify: connector `health_check` `ok=true` on the box; widget drawer renders
   one triage turn to `done` (the live-sweep in `make ship-verify` does this).

## Gotchas

- **8.0 login label** -- the box's "SIGN IN" button (not "Login"); the harness
  `soarBrowser.js` login selector handles both, but if a live Playwright run
  fails at login, confirm the harness has the 8.0 selector (uncommitted 8.0
  fixes -- see STATUS.md).
- **Connector identity single-source** -- the widget's `fsrPbAgent.service.js`
  resolves the connector by name (`connector-fsr-soc-assistant`); never
  hardcode a second copy of the name/version elsewhere (drift aborted a live
  build test after a rename -- see memory `widget_connector_name_drift`).
- **8.0 pip lock** -- the box's `pip.conf` is pinned to an internal repo +
  `chattr +i`; a fresh connector install can leave the venv stale. Fix:
  `sudo chattr -i` → add `extra-index-url = https://pypi.org/simple/` →
  `chattr +i`. See memory `fortisoar_8_pip_config_locked`.
- **Config PUT on 8.0** -- `PUT /api/integration/configuration/<id>/` with a JWT
  403s "Could not validate HMAC fingerprint"; use `pyfsr`
  `connectors.update_configuration(...)` (handles HMAC). memory
  `deploy_159_fortisoar_8`.
- **No `--bump none` for widget `ship.sh`** -- omit `--bump` entirely to ship
  as-is (ship.sh rejects `--bump none`).

## Pointers

- Widget ship: `fortisoar-widget-harness/scripts/ship.sh`, `scripts/widget.js`
  (`ship`/`push`/`install` subcommands). Canonical pipeline: `TESTING.md`
  §"Canonical build → test → deploy flow" + `make ship-verify`.
- Connector ship: `ConnectorsV2/fsr-playbook-builder/scripts/deploy.sh`
  (unified), `build.sh`, `install_to_fsr.py`.
- Box creds: harness `fortisoar-widget-harness/.env.159` (gitignored); connector
  side reads the same `FSR_*` env vars via pyfsr `EnvConfig`.
- Dev loop (the other direction): `LOCAL_DEV.md`.
