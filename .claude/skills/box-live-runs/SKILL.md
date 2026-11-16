---
name: box-live-runs
description: Use before putting code on a FortiSOAR lab box, running a live sweep/matrix/A-B, choosing which box or LLM model to use, or briefing a subagent that will touch a box. Covers box roles, the dev-push loop, live sanity, paid-vs-free model rules and recurring live-run traps.
---

# Box and live runs

Specifics (hosts, ports, credentials, seeded record ids) are NOT here. Aliases come from
`scripts/box.sh --list`; per-box facts live in the auto-memory dir (box notes) and
gitignored `docs/plans/`.

## Which box
- Pass `BOX=<alias>` to every box target. There is no default box. The old `ENV`, `FSR_ENV`,
  `SSH_HOST` knobs are refused under Claude Code.
- Roles live in the pyfsr registry (`scripts/box.sh --role <alias>` -> stable|experimental|unset).
  A `stable` box is the customer demo. It takes code ONLY through `make stable BOX=<alias>`:
  the FortiSOAR Import Wizard over REST, one solution pack (connector with the promoted framework
  wheel bundled, both widgets, dashboard). Every ssh push target (`push`, `widget-push`,
  `ship-verify`, `loop`, `dev-push`, `ship-dev`, `deploy`) is refused on a stable box, with no
  override (`scripts/box.sh`). `make stable` refuses unless each source repo is clean, on remote
  main, and VERIFIED by a live-sanity stamp from an experimental box (`scripts/stable_guard.py`).
  Push experiments to an experimental box.
- Read the first line printed, `>> target box: <alias>`, before anything installs.
- Before trusting a live result run `make doctor BOX=<alias>` (version, dev-patch state) and, in the
  connector repo, `make ship-dev ACTION=status`: a dev-patched box reports the wheel's version
  while running other code. `make release-ship` does not clear the dev-patch marker; restore
  explicitly with `ship-dev ACTION=restore`.
- A box address can front more than one appliance behind NAT (ssh port vs API port). Before
  debugging box-side state over ssh, prove it is the box serving the API: make the failing call
  and check whether the log you are tailing changes. See memory note on the NAT topology.

## What agents may do on their own
- Dev-push / dev-sync any working tree to an experimental box without asking (`make loop`,
  `make dev-push`, `make widget-push`, `make push`). Nothing there is permanent.
- `make stable BOX=<stable alias>` when the owner asks to put promoted mains on the stable box.
  It is the Import Wizard install, not a push: the guard in front of it is the rule. Run
  `ARGS=--build-only` first to check the package, and read the first line (`>> target box`).
- Never `make deploy FW=...` (PyPI release), `release-ship`, or `git push` main. Releases are the
  owner's, and permission for one release does not carry to the next request. Releases are now
  only for outside users; the stable box does not need one.
- Model choice: Frank first whenever it is reachable (VPN on; several free models). If Frank is
  unreachable, or the run needs the Anthropic side (A/B outside agent), use paid Haiku without
  asking. Live Sonnet only for verification.
  Default every frequent/offline loop to the free gateway (Frank, `eco` model slug,
  at most 3 concurrent sessions). Do not plan "N live paid runs" gates; split into
  fake-model mechanics, offline quality on Frank, and at most a small live confirmation.
- Order for a fix: local (editable source + Frank) -> copy working tree to the box -> short live
  sanity -> merge only after live proof -> (owner) publish. Dev-sync + live BEFORE any publish.

## The fast loop
- `make loop BOX=<alias>`: local tests, Frank smoke, copy working trees, ~35s live smoke.
- Single widget: `make widget-push WIDGET=<w> BOX=<alias>` (lint + unit + deploy, 1-2 min), then ONE
  targeted live check. `ship-verify` (mock e2e + live sweep, 10-15 min) is only for public releases.
- Every push ends with a live sanity pass that stamps the commits. A skipped sanity is NOT a pass.
- A new connector operation needs a bumped INSTALL (`make ship BUMP=patch`), not a PyPI release;
  `dev_push.sh` auto-escalates. A plain copy leaves the op "does not exist".
- Verify the write, not the card: read the record back from the box after an approved action.

## Live-run hygiene
- Headed live matrices steal focus (the WAF blocks headless). Do not run them unless the owner is
  at the machine; run one confirming row, or wait.
- `make test-matrix-live` has no `RUNS` knob (it is silently ignored); invoke twice for two runs.
  `RUNS=n` belongs to `make test-live-sweep`.
- A trailing "Test timeout of 90000ms exceeded" after a serial-mode live-sweep failure is a
  Playwright reporting artifact (soft-assert plus serial mode); the row body completed.
- `make ship-verify` printing "not shipped" after a failed live sweep is false: deploy is step 5,
  the sweep is step 6. Check the `installed on SOAR:` line.
- Any harness that drives `claude -p` must pass `--strict-mcp-config` with an explicit config and a
  server name unique to the target box, and assert identity (whoami base URL) before any write.
  A same-named user-level MCP server otherwise points the run at another instance.
- Agent liveness: a heartbeat return proves nothing; fire it, then poll `healthCheckLastSync`.
- A fresh agent-bound container may report Disconnected for a minute while Python deps install.
- Connector pip: the platform installs the pinned `fsr-playbooks` itself once the box's pip has a PyPI
  extra-index. Never `ssh ... pip install` a wheel; if a dep will not install, the release is wrong
  (ship raced the PyPI release). Push tooling re-applies the extra-index (lift and restore the
  immutable bit on `pip.conf`). The stable package is the exception by design: `build.sh` with
  `FSR_PLAYBOOKS_WHEEL` bundles the framework built from main and adds `--find-links wheels` to the
  staged requirements, so fsr-playbooks resolves from the tarball with no PyPI.
- Live LLM provider per box differs: a box without a route to the lab gateway must use a real
  OpenAI/Anthropic config, never the lab gateway. Check `llm_provider` before blaming the agent.
- Credentials: Bash auto-mode blocks sourcing credential `.env` files. Pre-load env via the
  user's shell profile or use `scripts/box_run.sh`; never echo keys. Product-connector creds live
  in gitignored `.env.<key>` files in the connector repo (`configure_connector.py --list/--all`).

## Seeding and planting (procedure only)
- FortiSOAR honors a supplied `uuid` on create, so seed fixture records to the exact uuid a sweep
  row mounts. Required fields vary per module (reputation, severity, criticality for alerts).
- Needle-in-haystack evals: plant evidence via the lab's own generators (SIEM event generator on the
  collector, EDR host alert generator); confirm the EDR collector is online first. Demo alerts must
  name a REAL collector, simulator hostnames always 400 the isolate action.
- Lab sources are shared by the stable and experimental boxes; planted seeds are visible from both.
- Licensing after reimage/clone ("duplicate license" lockout): redeem a fresh Flex token with the
  retry loop in the terraform post-launch script; do not wait for an entitlement to turn ACTIVE.
  Details in memory (flex licensing notes).

Sources: memory notes box_roles, paid_haiku_and_92_devsync, dev_push_rules, never_release_or_push_main,
prefer_dev_ship, house_rule_dev_sync, claude_p_loads_user_mcp, fsr_agent_liveness, fortisoar_8_pip_config_locked,
live_sweep_90s_timeout, matrix_target_has_no_runs_var, lab_shared_sources (checked against
`scripts/box.sh` and conn_main CLAUDE.md).
