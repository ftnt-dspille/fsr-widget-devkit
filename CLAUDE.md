# FSR all-widgets -- project instructions

New here? `ONBOARDING.md` (repos, `make setup`, compat matrix), then
`CONTRIBUTING.md` (build/test/ship). Each widget under `widgets-src/<name>/` is
its **own git repo** (check its branch with `git -C widgets-src/<name> branch --show-current`):
commit inside that repo, not here.

## Verify before you trust

- Docs, trackers and memory go stale. Before acting on "release owed", "X is
  broken" or "pin is Y", check git and code: `info.json` version, the connector's
  `requirements.txt` pin, `git log`.
- `make doctor` (~15s, `LOCAL=1` for no box) is the preflight: box, version, env, hooks, and
  warnings when a lap step trends over budget or a doc names a missing target or path.
  Run it before believing a live result. `make session-health` triages failing chat tools.
- One box knob: `BOX=<alias>` (pyfsr registry; the connector's `scripts/box.sh --list` shows the
  targetable aliases). No default box.
- If grep finds nothing in a file you know exists, use `/usr/bin/grep`: the
  interactive `grep` is a ugrep wrapper that skips big files.
- Find a repo: `bash scripts/repo_paths.sh <conn|framework|root|agenticAssistant|agenticAssistantMonitor>`.

## The product and where work is tracked

`agenticAssistant` and `agenticAssistantMonitor` are the surfaces of the
**FortiSOAR Agentic Assistant**: "AI finds the pattern. A playbook runs it forever."
Four promises: **P1** investigate with cited verdicts · **P2** tier-gated,
analyst-approved actions · **P3** reach on-prem targets · **P4** bottle each
investigation into a playbook. The widget is the window; the connector is the engine.

- **Roadmap:** `ROADMAP.md` in `~/PycharmProjects/agentic-assistant-tracker` (private) is
  the source: edit it there, commit, and push it like any other repo (the user owns
  releases, not pushes). §1-2 is the fastest context load.
- **Board:** https://github.com/users/ftnt-dspille/projects/1. **Claim a card before
  working it** (several agents run in parallel) and close or update it in the same
  session. Card ops: the framework's `scripts/tracker.sh`, never raw `gh issue`.
- **Local-only detail:** `docs/plans/` is gitignored because it carries box details.
  Index: `docs/plans/INDEX.md`.

## The dev loop: two commands

Work in a worktree off origin/main (one repo) or an agent tree (`make agent-tree NAME=<n>
REPOS="connector=new:fix/x ..."`, then `eval "$(bash scripts/agent_tree.sh env <n>)"`), never in
the shared checkouts: they hold other people's WIP, so never `git stash`, `pop` or rebase there.
Then:

1. **`make check`**: the tests for what you changed, no box. Root: the jest files the diff touches
   or names. Connector and framework: the pytest files it touches or imports. Widget: its unit
   tests. That per-change loop is unit + scoped tests + types. The slow parts run only in the batch
   gate, `FULL=1 make check`: widget e2e (when markup, CSS or a spec changed) and, when the diff
   touches the agent loop (framework `fsr_playbooks/llm` or `mcp_server`, or the connector package),
   `make local-chat` on a bundle (a sweep spec in the diff, else a default). Per change they are
   named as deferred in the output.
   Every step runs in a Linux container by default (jest, pytest, tool sweep, type gate, and at
   batch the Playwright e2e and local-chat, whose model is a network call: Frank first, else Haiku
   from the keychain); the host is the explicit fallback (`DOOR_DOCKER=0`, or no engine, said
   loudly). Only the box (deploy, stamp, `make stable`) stays on the host, at ship time. It covers uncommitted and untracked files.
   A part with no mapped test prints `NOT RUN`: that is not a pass, so add the test.
2. **`make ship [BOX=<alias>]`**: commit first (ship proves a commit). It pushes the branch (CI
   starts), classifies the diff with `.github/package-inputs`, and only when something ships
   (package dir, build and deploy scripts) puts the code on `BOX` and stamps the head (BOX is then
   required; a stable box is refused; a head already stamped is not redone). Then it runs
   `make promote` per repo in dependency order, and frees the box lease. `DRY_RUN=1` stops before
   the merge. In the connector repo the same two commands forward here.

**Gating is per change, then per batch.** One small change never runs the full suite or waits for
full CI: `make ship` runs only the tests the diff touches (check's selection, no local-chat), the
box stamp for what ships, and promotes without the wait for GitHub CI, the cross-repo full
connector suite or the connector pre-push's full suite. CI still runs on main after the push and
the doors flag a red main. `FULL=1 make ship` is the old full gate for one ship. The full proof is
at the batch point: `make release-check` runs the full connector suite in the container, the
framework suites and waits for green CI on every main, and records those heads; `make stable`
refuses unless it passed on the exact mains it installs (`ARGS=--build-only` needs no record).

CI is never out of sight: `make doctor` and both doors print each repo's latest main CI (root,
connector, framework, the two widgets) and flag a red main with its failing job. `make ship`
refuses a repo whose main is red unless the branch is green on those same checks (it pushes the
branch and waits for its CI: it may be the fix). Under `FULL=1` a framework ship also runs the
connector suite against the new framework head before promote (the connector's required leg clones
framework main); a per-change ship leaves that to `make release-check`.

That is the whole loop. Everything else (`push`, `dev-push`, `widget-push`, `loop`, `ship-dev`,
`promote`, `stamp-tree`, `promote-tree`, `doctor SANITY=1 STAMP=`, box leases, `framework-path`)
is internal: the doors call it, so do not type it. Drill-downs while iterating:
`make test-unit WIDGET=<n>` or `TESTS=<file>`, `make test-e2e-spec SPEC=<file>`,
`make local-chat BUNDLE=<name> [ASK=...]` (box-free: real widget, real connector, Frank or fake, a
fixture bundle; read the saved png), `make widget-inspect ARGS='--widget <n> ...'` for DOM facts.
`make test-docker TESTS="<pattern>"` runs the shell-heavy tooling suites in seconds in a Linux
container (a local check, not proof). A widget worktree goes at `<dir>/widgets-src/<name>` (the
harness finds widgets through its real path; the door links the harness beside it). `make bench
BOX=<alias>` times the loop on a throwaway branch (never promoted) against the 11-22 baseline;
`make laps` shows step timings.

## Rules

- **The only thing off limits is publishing a release**: GitHub tags and release objects, and the PyPI
  publish they trigger (`make release`, `make release-ship`, `make deploy FW=...`). Never force-push or push
  an unpromoted `main`. Everything else on the lab boxes is the agent's to run without asking: `make ship`,
  box deploys, installs, `make stable`, staged faults, approving action cards in a test.
- **A stable-role box (the customer demo) takes code only through `make stable BOX=<alias>`**
  (Import Wizard over REST). Every ssh path refuses it, with no override; do not
  look for one. `make stable` refuses unless each repo is clean, on remote main, and VERIFIED on an
  experimental box.
- Main moves only through promote (inside `make ship`); a hook refuses any other update of main.
  Never loop `make promote` in the shell: `ship` does it, one call per repo.
- Bumps: `BUMP=patch` on the CLI. Never hand-edit `info.json` version or releaseNotes (a hand edit
  desyncs the controller name). Rename with the `widget rename` CLI.
- Commits: author as the user, no AI attribution lines. A global hook rejects en and em dashes;
  the connector is latin-1 on the box, so write hyphens. Never skip git hooks.
- Never hand-start a server, never run `pnpm exec playwright` or `pnpm jest` directly (refused
  under Claude Code; go through make). Specs build URLs from `baseURL`, never a literal port.
  Headed targets only when the user is at the machine.
- **A test for a fix must be shown red without the fix**: remove the fix in a scratch worktree, see
  it fail, restore. **A skip is not a pass**: report skipped tests as not run, with the reason.
- Every widget change ships with a test (controller logic: jest; DOM/CSS: e2e). Card tests assert
  content, not shape. Verify the write, not the card: check the effect on the box.
- Models: Frank (free gateway, at most 3 concurrent turns) first when reachable; otherwise paid
  Haiku without asking; live Sonnet for verification only. Routine verification is small: the fast
  tiers plus a deterministic sample, 2 runs. Full sims are for sprint gates.
- To verify a finished widget change, delegate to the `widget-change-verifier` agent.
- Briefs for subagents repeat these rules, point at the exact file section to read, give a time
  budget and sample size, say "run anything over ~2 min in the background and wait for its notice;
  never poll with sleep loops", and default to Sonnet. Default scope: one widget or the assistant
  solution pack, never every widget.
- Procedures live in skills: box-live-runs, worktree-test-env, session-diagnosis-regrade,
  connector-dev-deploy, fortisoar-platform-gotchas, agentic-eval-method.

## Chat widget (agenticAssistant)

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
