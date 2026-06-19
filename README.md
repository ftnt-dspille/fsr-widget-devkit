# FSR Widget Dev Kit

A batteries-included kit for building **FortiSOAR 7.x AngularJS widgets** the way
this team does: render a widget in isolation, drive a real (lab) SOAR box through
a proxy, test every change with jest + Playwright, and package + install in one
command.

The kit ships the harness, the `Makefile`, the `scripts/`, the lint configs, a
widget scaffold, and `KNOWLEDGEBASE.md` — the distilled reference for how the
platform actually behaves. Your widgets live in their own repos and are cloned in
on demand; `widgets-src/` ships empty.

## Quick start

```bash
make setup                                       # install harness deps + clone widgets from widgets.manifest
cp fortisoar-widget-harness/.env.example fortisoar-widget-harness/.env
$EDITOR fortisoar-widget-harness/.env            # set FSR_BASE_URL + creds (TRUSTED LAB BOX ONLY)
make dev                                          # drive widgets by hand → http://localhost:14400
make assets                                       # only for e2e: fetch the SOAR app shell into fsr_src/
```

`make setup` is enough to run **jest** unit tests. Playwright **e2e** additionally
needs `make assets`, which pulls the FortiSOAR app shell from your own licensed
box (those Fortinet platform assets are not redistributed with the kit).

> **Security:** the proxy disables TLS verification and strips CSP so the harness
> can talk to a lab box. Only ever point `FSR_BASE_URL` at a trusted lab instance.
> `.env` is gitignored — never commit credentials.

## Daily workflow

```bash
make dev                                          # drive widgets by hand on :14400
make test-unit WIDGET=fsrSocAssistant             # jest (controller logic)
make test-e2e-widget WIDGET=fsrSocAssistant       # Playwright (DOM/template) on a fresh :14401
make test-e2e-spec SPEC=tests/e2e/foo.spec.js     # one or more specs
make stop                                         # kill both servers
```

Always run tests **through the Makefile** — it owns the two never-overlapping
ports (dev 14400, test 14401) and kills stale servers so a test run never races
your dev server. `make help` lists every target.

To package + push a widget to the lab box:

```bash
cd fortisoar-widget-harness && scripts/ship.sh fsrSocAssistant --bump patch
```

To start a new widget:

```bash
scripts/new-widget.sh myWidget "My Widget"        # scaffolds from widgets-src/_template/, tests pass immediately
```

## Documentation map

| Read this | For |
|-----------|-----|
| **[ONBOARDING.md](ONBOARDING.md)** | The three repos, first-time setup, the compat matrix, where everything lives. **Start here.** |
| **[CONTRIBUTING.md](CONTRIBUTING.md)** | The working rules: KB-first, tests-with-every-change, ship via scripts, commit conventions. |
| **[TESTING.md](TESTING.md)** | How to write/run tests — controller naming the lint enforces, where specs live, the `make assets` requirement, testid conventions. |
| **[KNOWLEDGEBASE.md](KNOWLEDGEBASE.md)** | The comprehensive widget-building reference — lifecycle, drawer/`enableFor`, platform services, packaging, a 60-widget gotcha catalog. **Consult before any widget change; add new gotchas back into it.** |
| **[fortisoar-widget-harness/README.md](fortisoar-widget-harness/README.md)** | Harness internals, the `widget` CLI, proxy/auth behavior. |
| **[CLAUDE.md](CLAUDE.md)** | Conventions for working in this repo with Claude Code. |

## What's in the box

```
fortisoar-widget-harness/   the dev/test harness (also published standalone; widget-agnostic)
  examples/helloCounter/    a minimal working widget to read or copy
widgets-src/                 your widget repos clone in here (ships empty)
  _template/                 scaffold for a new widget
fsr_src/                     SOAR app-shell extractor tooling (assets fetched via `make assets`)
scripts/                     clone-widgets, new-widget, asset fetch, theming, bundling
Makefile                     the one entry point for setup / dev / test / stop
KNOWLEDGEBASE.md             the durable home for platform knowledge
widgets.manifest             which widget repos `make widgets` clones into widgets-src/
```

The three-repo model (dev kit · widgets · connector) and the
widget/connector/contract compatibility matrix are explained in
[ONBOARDING.md](ONBOARDING.md).
