# FSR all-widgets -- project instructions

New here? `ONBOARDING.md` (repos, `make setup`, compat matrix), then
`CONTRIBUTING.md` (build/test/ship). Each widget under `widgets-src/<name>/` is
its **own git repo** (check its branch with `git -C widgets-src/<name> branch --show-current`):
commit inside that repo, not here.

## Verify before you trust

- Docs, trackers and memory go stale. Before acting on "release owed", "X is
  broken" or "pin is Y", check git and code: `info.json` version, the connector's
  `requirements.txt` pin, `git log`.
- Box, version and env state comes from `make doctor` (~15s, `LOCAL=1` for no box).
  Run it before believing any live result.
- If grep finds nothing in a file you know exists, use `/usr/bin/grep`: the
  interactive `grep` is a ugrep wrapper that skips big files.

## The product and where work is tracked

`fortiaiAgenticAssistant` and `socAssistantMonitor` are the surfaces of the
**FortiSOAR SOC Assistant**: "AI finds the pattern. A playbook runs it forever."
Four promises: **P1** investigate with cited verdicts · **P2** tier-gated,
analyst-approved actions · **P3** reach on-prem targets · **P4** bottle each
investigation into a playbook. The widget is the window; the connector is the engine.

- **Roadmap:** `ROADMAP.md` in `~/PycharmProjects/soc-assistant-tracker` (private) is
  the source: edit it there, the user pushes. §1-2 is the fastest context load.
- **Board:** https://github.com/users/ftnt-dspille/projects/1. **Claim a card before
  working it** (several agents run in parallel) and close or update it in the same
  session. Card ops: the framework's `scripts/tracker.sh`, never raw `gh issue`.
- **Local-only detail:** `docs/plans/` is gitignored because it carries box details.
  Index: `docs/plans/INDEX.md`.

## Git and shipping

- **The user releases and pushes.** Agents commit locally on a branch and never push
  `main`. Never run `make release-ship`, and never run a deploy target unless the
  user asked for it.
- Box testing: `make loop` (the default dev loop: local tests, Frank smoke, copy
  working trees to the box, ~35s live smoke). Single widget: `make widget-push
  WIDGET=<name> SHIP_ENV=.env.<box>` (lint + unit + deploy, ~1-2 min; `SHIP_ENV`
  must be explicit). `ship-verify` is for public releases only.
- Bumps: `BUMP=patch` on the CLI. Never hand-edit `info.json` version or
  releaseNotes; a hand edit desyncs the controller name and lint then blocks boot.
  Rename with the `widget rename` CLI, not by hand.
- Commits: author as the user. No AI attribution (no `Co-Authored-By`, no
  "Generated with" lines) in commits or PRs.
- A global pre-commit hook (`core.hooksPath=~/.git-hooks`) rejects en and em dashes.
  The connector is latin-1 on the box, so write hyphens. Don't use `--no-verify`.
- **Shared checkouts hold other people's WIP.** Never `git stash`, `pop` or rebase
  over it. For branch work, `git worktree add <scratch>/wt_<name> -b <branch> <base>`
  and work there. Check `git status` first, and leave the main checkout alone.

## Testing

Tier ladder, cheapest first. All targets run from the repo root:

1. `make test-unit WIDGET=<name>[,<name>]` (jest; `WIDGET=all` for every widget).
   Controller logic. Must exit 0.
2. `make test-e2e-spec SPEC="tests/e2e/a.spec.js tests/e2e/b.spec.js"` for scoped
   runs, or `make test-e2e-spec WIDGET=<name>` for one widget. DOM and template.
   Space- or comma-separated.
3. `make loop`: the default iteration (above).
4. `make ship-verify WIDGET=<name> [BUMP=patch]`: lint, unit, mock e2e, deploy, live
   sweep. Releases only, and the user runs it.

`make test-live-sweep [RUNS=n]` is the only tier that touches a box. A
`[[SWEEP-ENV-SKIP]]` means the backend is down or lacks an integration the row
needs, so it is **not** verified.

Rules:
- Never hand-start a server, and never run `pnpm exec playwright` or `pnpm jest`
  directly. Specs build URLs from `baseURL` or `E2E_BASE_PORT`, never a literal port.
- The mock e2e tier is hermetic (`FSR_HERMETIC=1`). An un-snapshotted call returns
  `599 HERMETIC-MISS` and `globalTeardown` fails the run on any leak.
- Every widget change ships with a test: controller logic gets jest, DOM/CSS gets
  e2e. Iterate every input in integration tests and assert on all of them.
- Testing a widget worktree: the harness resolves `widgets-src` through its real path,
  so a test run from a worktree silently tests the shared checkout. Put the widget
  worktree at `<scratch>/x/widgets-src/<name>` and pass `WIDGETS_SRC=<scratch>/x/widgets-src`.
- **A test for a fix must be shown red without the fix.** Remove the fix (in a
  scratch worktree, not the shared checkout), run the test, see it fail, restore.
  A jest test once passed with or without its fix. Tests written from the same
  model as the fix inherit its blind spots.
- **A skip is not a pass.** Report skipped tests as not run, with the reason.
- No paid LLM batch runs. Prove mechanics with fake-model tests, and quality offline
  on Frank (the free gateway; at most 3 concurrent turns). At most one live paid run,
  and only when the user asks for it.
- Verify the write, not the card. A rendered card proves nothing. Clicking Apply on a
  live box found two more bugs behind a card that looked right. Check the effect on the box.
- Don't run headed targets (`make test-e2e-headed`, or a headed live matrix) unless the
  user is at the machine. They pop a focus-stealing browser window.
- Card tests assert content, not shape. "A card exists" is not proof that the
  verdict or record is right.
- To verify a finished widget change, delegate to the `widget-change-verifier` agent
  (runs these gates and the red check, reports evidence, changes nothing).
- Visual or DOM claims: `make widget-inspect ARGS='--widget <name> [--config <json>] [--click <sel>] ...'`
  (wraps `fortisoar-widget-harness/scripts/widget-inspect.js`; `--help` lists the
  flags). Don't hand-roll Playwright except for a tiny screenshot script.
  The assistant's mock-state screenshots (quick actions, verdict, action card, offer)
  come from `widgets-src/fortiaiAgenticAssistant/tests/e2e/fortiaiAgenticAssistant.docsScreenshots.spec.js`:
  `DOCS_SHOTS=1 make test-e2e-spec SPEC=fortiaiAgenticAssistant.docsScreenshots` (rewrites
  that widget's docs/images; it lives in the widget's own repo, so grep there, not here).

## Chat widget (fortiaiAgenticAssistant)

- Connector identity has one source: the widget's `fsrPbAgent.service.js`. Test
  infra derives it through `fortisoar-widget-harness/tests/live/lib/connectorIdentity.js`.
  Never hardcode a copy.
- `widgetAssets/js/fsrPbRender.js` is compiled from `fsrPbRender.ts`. Edit both, or
  edit the `.ts` and regenerate. `tests/renderTsJsParity.test.js` enforces parity.
- Analyst-facing text never shows tool names, ids, enum values or JSON paths. It
  has no emoji and no em dashes. Icons are CSS-mask SVGs (`class="ic ic-*"`, since
  commit 15658c3). Cards are not restated in prose.
- The guard and approval rules live in the connector and framework, not here (see
  `fsr-playbook-framework/docs/GUARDS.md`).

## Harness and knowledge base

- `KNOWLEDGEBASE.md` is the first stop for any widget change. Platform gotchas you
  discover go into it in the same change (matching section, or
  `fortisoar-widget-harness/docs/kb/<topic>.md`). If the KB is wrong about something
  you touched, fix the KB text too.
- Dev server: `make dev` (port 14400); `make stop` kills dev and test servers. Harness
  details: `fortisoar-widget-harness/CLAUDE.md`.
- FortiSOAR schema and API questions: `soardocs <query>` first.

## Public-repo hygiene

No lab IPs, hostnames, box ports, credentials or capture dates in tracked files
(comments and test headers included). Use placeholders; box details go only in
gitignored `docs/plans/`, `scratch/`, `.env*` or memory.
