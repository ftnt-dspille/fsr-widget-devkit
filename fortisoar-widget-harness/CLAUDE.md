# Harness project

## Starting the dev server

The interactive harness is started by the parent Makefile, so `make stop` can find
it. Run it from the repo root:

```
make dev        # or: make start   -> http://localhost:14400
make stop       # kills the dev (14400) and test (14401) servers
```

Start it in the background (`Bash` with `run_in_background: true`). Never use
TaskCreate; it kills long-running processes. Check first:
```
curl -s http://localhost:14400/ > /dev/null && echo "already running"
```

`pnpm dev` from this directory also works. It reads `PORT` from `.env` (currently
4401), so the two entry points can end up on different ports. Use `make dev`
unless you have a reason not to.

## Inspecting/validating a widget's DOM (dropdown size, grid rows, clipping…)

Don't hand-roll Playwright to mount a widget and measure it -- that re-derives a
pile of harness foot-guns (hidden `#widget-select`, reload-on-pick, multi-stage
mount, `networkidle` hang). Use the **widget-harness kit** instead:
- **Ad-hoc, no spec file:** `node scripts/widget-inspect.js --widget <name> [--config '<json>'] [--edit] [--click <sel>] [--clipped 'child::ancestor'] [--rows <sel>] [--box <sel>] …` → prints JSON. (or `make widget-inspect ARGS='…'`).
- **In a spec:** `const { mountWidget } = require('./_widgetHarness')` → `mountWidget(page, name, {config})` then `.box/.count/.rowCount/.style/.text/.visible/.clippedBy/.click/.openEditModal`.

Full reference + the foot-guns it owns: `SOAR_TEST_KIT_DESIGN.md` §4.4. Self-tests:
`tests/e2e/widgetHarness.spec.js`.

## Testing & deploying widgets -- go through the parent Makefile, never by hand

The dev server is for **interactive** use only. Builds, tests, and
deploys run from the **parent repo's Makefile** -- see `../TESTING.md` (canonical
build→test→deploy flow) and `../CONTRIBUTING.md`:

- `make test-unit WIDGET=<name>` (jest) / `make test-e2e-spec SPEC="…"` (Playwright).
- `make ship-verify WIDGET=<name> [BUMP=patch]` = lint→unit→mock-e2e→deploy→live-sweep.
- **e2e runs its own per-worker servers on a pair it CLAIMS** (`base`/`base+1`,
  from 14401 up; `tests/e2e/_port.js` locks it, so concurrent runs from other
  sessions never share or kill each other's servers). Specs must build URLs from
  `baseURL` / `process.env.E2E_BASE_PORT`, never a literal port. `E2E_BASE_PORT`
  pins a pair; `E2E_REUSE=1` reuses already-running servers on 14401. Never
  hand-start these -- `make` boots and tears them down. The dev server
  (14400) is unrelated to e2e.
- The **mock e2e tier is hermetic**: `FSR_HERMETIC=1` (set by `playwright.config.js`
  for non-live runs) disables the forticloud proxy fallthrough; an un-snapshotted
  request returns a loud `599 HERMETIC-MISS` and the `globalTeardown` fails the
  run if any leaked. Live runs (`E2E_LIVE=1`) set `FSR_HERMETIC=0`.
- Version bumps are done **by the CLI** (`scripts/ship.sh` / `widget.js push --bump`),
  never by hand-editing `info.json` (it desyncs the controller name → lint blocks boot).
