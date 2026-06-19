# FSR all-widgets — project instructions

New to this repo? Read `ONBOARDING.md` (the three repos, `make setup`, the
compat matrix) and `CONTRIBUTING.md` (how we build/test/ship widgets) first.

## KNOWLEDGEBASE.md is the first stop for any widget work
`KNOWLEDGEBASE.md` (repo root) is the comprehensive reference for building
FortiSOAR 7.x AngularJS widgets — lifecycle, drawer/`enableFor` mechanics,
platform services (`FormEntityService`, `$state`, `websocketService`), packaging,
and a catalog of gotchas distilled from 60 certified widgets.

- **Before** designing or modifying any widget (template, controller, or a
  directly-used service), consult the relevant KNOWLEDGEBASE.md section. Its
  table of contents is at the top; §18 covers drawer/standalone widgets.
- **After** discovering anything non-obvious about how the platform behaves —
  a new gotcha, a service quirk, a state-name mapping, a packaging rule — **add
  it to KNOWLEDGEBASE.md** in the matching section (terse, with the widget/file
  reference and, where it helps, a short code block). Treat it as the durable
  home for platform knowledge; conversation memory is not a substitute.
- If a bug traces to an assumption the KB documents incorrectly, fix the KB text
  in the same change — don't leave a known-wrong reference standing.

## Testing
Run tests **only through Makefile targets** (`make test-unit WIDGET=<name>`,
`make test-e2e-spec SPEC="…"`) — never hand-start a server or run
`pnpm exec playwright test` directly. Every widget change ships with tests
(controller logic → jest, DOM/template → playwright e2e).

**`TESTING.md` "Canonical build → test → deploy flow" is the single, enforced
pipeline** — read it before building/shipping. The whole path is one command:
`make ship-verify WIDGET=<name> [BUMP=patch]` (lint → unit → mock-e2e → deploy →
live-sweep). Invariants it encodes, don't reinvent them:
- **Connector identity has ONE source** (the widget's `fsrPbAgent.service.js`).
  Test infra derives it via `tests/live/lib/connectorIdentity.js` — never
  hardcode a second copy (that drift aborted the live build test after a rename).
- **`make test-unit` must exit 0.** A guard blocked by a missing external artifact
  skips-with-warning and auto-re-arms; it never sits perma-red.
- **Live sweep** (`make test-live-sweep [RUNS=n]`) drives the widget through the
  UI vs the real connector. A FAIL ⇒ widget bug; an `[[SWEEP-ENV-SKIP]]` ⇒ the
  backend/gateway is down, not the widget. (The box has **no SSO** — `csadmin`
  is a local login; the live-UI gotcha is FortiGuard IPS blocking a headless UA,
  so the sweep uses a real desktop Chrome UA.)
- **Two tiers** (see `TESTING.md` §"Two tiers: hermetic mock gate vs live
  sweep"): the **mock e2e tier is hermetic** — `FSR_HERMETIC=1` (default for
  non-live e2e) disables the forticloud proxy fallthrough so a box outage can't
  red a mock test; an un-snapshotted call is a loud `599 HERMETIC-MISS` and a
  `globalTeardown` gate fails the run on any leak. The live sweep is the only
  box-touching tier.

## Harness
Dev server: see `fortisoar-widget-harness/CLAUDE.md` (port 4401, `npm run dev`
in the background). Never start `node server.js` by hand — use `scripts/ship.sh`.
