# Onboarding — FSR Widget Dev Kit

This repo is the **dev kit** for building FortiSOAR 7.x AngularJS widgets the way
this team does: render in isolation, drive a real SOAR box through a proxy, test
every change, and package + install in one click. Read this once, then keep
`KNOWLEDGEBASE.md` open while you work.

## The three repos

A full working setup is three independent git repos. The kit ties them together
but does not contain the other two.

| Repo | What it is | Where it lives |
|------|------------|----------------|
| **Dev Kit** (this repo) | Harness, `Makefile`, `scripts/`, `KNOWLEDGEBASE.md`, lint configs, widget template. Ships `widgets-src/` **empty**. | `fsr_all_widgets/` |
| **Widget(s)** | One repo per widget (e.g. `fsrSocAssistant`). Cloned into `widgets-src/` via the manifest. | private GitLab / GitHub |
| **Connector** | The agentic backend (`fortinet-fsr-playbook-builder` + `fsr_core`) the SOC-assistant widget talks to. Published + deployed separately. | separate repo (Dylan) |

The harness (`fortisoar-widget-harness/`) is **part of this repo** — plain files,
not a separate git repo. (It used to be its own repo; that standalone repo is now
frozen. Harness work happens here.) It is still intentionally generic — it knows
nothing about any specific widget.

This one repo has two remotes — the private GitLab `origin` and the public GitHub
`github` (`ftnt-dspille/fsr-widget-devkit`) — sharing the same history. Publish
with a plain `git push origin master && git push github master`. Secrets and
proprietary Fortinet assets are gitignored, so the tracked tree is what ships;
keep them that way (never `git add -f` an `.env`, the dev-guide PDF, or theme
CSS).

## First-time setup

```bash
# 1. Bootstrap: install harness deps + clone widget repos from widgets.manifest
make setup

# 2. Point the harness at a TRUSTED LAB FortiSOAR box (never production)
cp fortisoar-widget-harness/.env.example fortisoar-widget-harness/.env
$EDITOR fortisoar-widget-harness/.env        # set FSR_BASE_URL + creds

# 3. Run the harness you drive by hand
make dev                                      # http://localhost:14400

# 4. (only for e2e tests) fetch the SOAR app shell from your licensed box
make assets                                   # populates fsr_src/ from FSR_BASE_URL
```

`make setup` runs `make install` (pnpm deps) then `make widgets`
(`scripts/clone-widgets.sh` → clones each `widgets.manifest` entry into
`widgets-src/`). **jest unit tests work immediately after setup.** Playwright
**e2e** tests additionally need `make assets`, which fetches the FortiSOAR app
shell (`fsr_src/`) from your own licensed box — these Fortinet platform assets
are not redistributed with the kit. Private GitLab entries need your fortilab git credentials. A
widget with no remote yet stays local-only — add its URL to `widgets.manifest`
once it's pushed.

> **Security:** the proxy disables TLS verification and strips CSP so the
> harness can talk to a lab box. Only ever point `FSR_BASE_URL` at a trusted lab
> instance. `.env` is gitignored — never commit credentials.

## Daily workflow

```bash
make dev                                   # drive widgets by hand on :14400
make test-unit WIDGET=fsrSocAssistant      # jest (controller logic)
make test-e2e-widget WIDGET=fsrSocAssistant# Playwright (DOM/template) on a fresh :14401
make test-e2e-spec SPEC=tests/e2e/foo.spec.js
make stop                                  # kill both servers
```

Always run tests **through the Makefile** — it manages the two never-overlapping
ports (dev 14400, test 14401) so a test run never races your dev server. See
`CONTRIBUTING.md` for the full widget-dev discipline (KB-first, ship.sh, etc.).

To package + push a widget to the lab box:

```bash
cd fortisoar-widget-harness
scripts/ship.sh fsrSocAssistant --bump patch
```

## Compatibility matrix

A widget, the connector it talks to, and the wire **contract** between them are
versioned independently. Pin these together when you cut a release.

| Widget | Version | Connector | Contract | Notes |
|--------|---------|-----------|----------|-------|
| `fsrSocAssistant` ("FSR SOC Assistant") | 1.2.1 | `fortinet-fsr-playbook-builder` 0.3.121 | 2.8.0 | SOC copilot: investigate → hunt → triage → build |
| `widget-jinja-editor` | — | none | n/a | standalone Monaco/Jinja editor |
| `c3charts` | — | none (registry-driven) | n/a | chart builder |
| `widget-action-renderer` | — | none | n/a | playbook action renderer |

> Keep this table current when bumping any widget/connector/contract. The widget
> talks to the connector over the contract version baked into its config; a
> mismatch shows up as unrendered transcript events or rejected pushes.

## Where to look

- **`KNOWLEDGEBASE.md`** — the comprehensive widget-building reference (lifecycle,
  drawer/`enableFor`, platform services, packaging, 60-widget gotcha catalog).
  **Consult before any widget change; add new gotchas back into it.**
- **`fortisoar-widget-harness/README.md`** — harness internals, the `widget` CLI,
  proxy/auth behavior.
- **`fortisoar-widget-harness/examples/helloCounter/`** — a minimal working
  widget to read or copy.
- **`widgets-src/_template/`** — scaffold for a new widget. Start one with
  `scripts/new-widget.sh <camelName> "Title"` (copies the template and fills in
  every placeholder, incl. tests, so `make test-unit WIDGET=<camelName>` passes
  right away). Use `widget rename` only to rename an *existing* widget.
- **`CONTRIBUTING.md`** — how we build, test, and ship widgets.
