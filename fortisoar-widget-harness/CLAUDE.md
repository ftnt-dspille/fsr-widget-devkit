# Harness project

## Starting the dev server

**Always use `Bash` with `run_in_background: true` to start the harness.** Never use TaskCreate — it kills long-running processes.

```
command: npm run dev
cwd: <path-to>/fortisoar-widget-harness
run_in_background: true
```

Before starting, check if it is already running:
```
curl -s http://localhost:4401/ > /dev/null && echo "already running"
```

The harness listens on **port 4401** (set via `.env`). Always use `http://localhost:4401` — never 3000 or 4400.

## Testing & deploying widgets — go through the parent Makefile, never by hand

This `npm run dev` server is for **interactive** use only. Builds, tests, and
deploys run from the **parent repo's Makefile** — see `../TESTING.md` (canonical
build→test→deploy flow) and `../CONTRIBUTING.md`:

- `make test-unit WIDGET=<name>` (jest) / `make test-e2e-spec SPEC="…"` (Playwright).
- `make ship-verify WIDGET=<name> [BUMP=patch]` = lint→unit→mock-e2e→deploy→live-sweep.
- **e2e runs its own per-worker servers on `14401`/`14402`** (one per Playwright
  worker; `parallelIndex`→port via `tests/e2e/_isolated.js`). Never hand-start
  these — `make` boots and tears them down. The dev `:4401` is unrelated to e2e.
- The **mock e2e tier is hermetic**: `FSR_HERMETIC=1` (set by `playwright.config.js`
  for non-live runs) disables the forticloud proxy fallthrough; an un-snapshotted
  request returns a loud `599 HERMETIC-MISS` and the `globalTeardown` fails the
  run if any leaked. Live runs (`E2E_LIVE=1`) set `FSR_HERMETIC=0`.
- Version bumps are done **by the CLI** (`scripts/ship.sh` / `widget.js push --bump`),
  never by hand-editing `info.json` (it desyncs the controller name → lint blocks boot).
