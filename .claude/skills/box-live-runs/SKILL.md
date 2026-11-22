---
name: box-live-runs
description: Use before putting code on a FortiSOAR lab box, running a live sweep/matrix/A-B, choosing which box or LLM model to use, or briefing a subagent that will touch a box. Covers box roles, what the two front doors do on a box, paid-vs-free model rules and recurring live-run traps.
---

# Box and live runs

Specifics (hosts, ports, credentials, seeded record ids) are NOT here. Aliases come from the
connector's `scripts/box.sh --list`; per-box facts live in the auto-memory dir and gitignored
`docs/plans/`.

## Getting code onto a box
- `make check` (box-free) then `make ship BOX=<alias>`. When the diff ships, ship puts the working
  code on the box, runs the live sanity pass, stamps the head, and promotes. You do not run
  `loop`, `dev-push`, `widget-push` or `doctor SANITY=1` yourself. A skipped sanity is NOT a pass.
- Before any box run, look box-free: `make local-chat BUNDLE=<name>` (check does it for agent-loop
  diffs). It does not prove the install; the box run does.
- Verify the write, not the card: read the record back from the box after an approved action.
  Write checks run offline first (a sweep row on a `writable: true` fixture bundle); keep a live write
  row only for what needs the platform (connector `TESTING.md`).
- A new connector operation needs a bumped INSTALL, not a PyPI release; the push path escalates by
  itself. A plain copy leaves the op "does not exist".

## Which box
- Pass `BOX=<alias>`; there is no default. Read the first line printed, `>> target box: <alias>`.
- Roles live in the pyfsr registry (`scripts/box.sh --role <alias>`: stable|experimental|unset).
  A `stable` box is the customer demo. It takes code ONLY through `make stable BOX=<alias>` (Import
  Wizard over REST: one solution pack with the connector, the promoted framework wheel bundled, both
  widgets and the dashboard). `make ship` and every ssh path refuse it, with no override. Run
  `ARGS=--build-only` first to check the package. `make stable` refuses unless each source repo is clean,
  on remote main, and VERIFIED on an experimental box. Only when the owner asks.
- A dev-patched box reports the wheel's version while running other code: `make doctor BOX=<alias>`
  shows the state before you trust a live result.
- A box address can front more than one appliance behind NAT (ssh port vs API port). Before debugging
  box-side state over ssh, prove it is the box serving the API (make the failing call, see whether the
  log you tail changes).

## What agents may do
- Put working trees on an experimental box without asking (through `make ship`).
- Never `make deploy FW=...` (PyPI release), `release-ship`, a tag, or a push of an unpromoted main.
  Permission for one release does not carry to the next.
- Models: Frank first when reachable (VPN on, free, at most 3 concurrent sessions, `eco` slug).
  Unreachable, or the run needs the Anthropic side: paid Haiku without asking. Live Sonnet for
  verification only. Do not plan "N live paid runs" gates: fake-model mechanics, offline quality on
  Frank, at most a small live confirmation.

## Live-run hygiene
- Headed live matrices steal focus (the WAF blocks headless). Not unless the owner is at the machine.
- `make test-matrix-live` has no `RUNS` knob (silently ignored); `RUNS=n` belongs to `test-live-sweep`.
- A trailing "Test timeout of 90000ms exceeded" after a serial live-sweep failure is a Playwright
  reporting artifact; the row body completed.
- Any harness that drives `claude -p` must pass `--strict-mcp-config` with an explicit config and a server
  name unique to the target box, and assert identity (whoami base URL) before any write.
- Agent liveness: a heartbeat return proves nothing; fire it, then poll `healthCheckLastSync`. A fresh
  agent-bound container may report Disconnected for a minute while Python deps install.
- Connector pip: the platform installs the pinned `fsr-playbooks` itself once the box's pip has a PyPI
  extra-index. Never `ssh ... pip install` a wheel; if a dep will not install, the release is wrong. The
  stable package is the exception by design (the wheel is bundled in the tarball).
- Live LLM provider per box differs: a box without a route to the lab gateway must use a real
  OpenAI/Anthropic config. Check `llm_provider` before blaming the agent.
- Credentials: Bash auto-mode blocks sourcing credential `.env` files; use `scripts/box_run.sh`, never
  echo keys. Product-connector creds live in gitignored `.env.<key>` files in the connector repo.

## Seeding and planting (procedure only)
- FortiSOAR honors a supplied `uuid` on create, so seed fixture records to the exact uuid a sweep row
  mounts. Required fields vary per module.
- Needle-in-haystack evals: plant evidence via the lab's own generators; confirm the EDR collector is
  online first. Demo alerts must name a REAL collector (simulator hostnames always 400 isolate).
- Lab sources are shared by the stable and experimental boxes; planted seeds are visible from both.
- Licensing after reimage/clone ("duplicate license" lockout): redeem a fresh Flex token with the retry
  loop in the terraform post-launch script. Details in memory (flex licensing notes).
