# Prompt + flow test plan — FortiAI Agentic Assistant (triage & playbook creation)

_Status: plan authored. Matrix infra BUILT + executed (runs 1–N):
`make matrix` drives the rows in `tests/live/scenarios.local.json` (gitignored; template
`scenarios.local.example.json`). Live state + per-run verdicts: `../../STATUS.md` + memory
`matrix_run1_findings`. T1 + T11 PASS; T2/T4/T7 are box-env-limited, P1 is the one
real defect found (see RUN 9)._

## Why this exists

On an earlier pass the widget was proven live on the FortiSOAR 8.0 box
(`fortiaiAgenticAssistant-1.2.7` + connector `0.4.12`): the drawer renders and
**one** triage chat turn streams to `done` with frames (9 polls, 7 frames, no
API/page errors). That proves the **plumbing** (mount → login → drawer →
`chat_turn`/`chat_poll` → `stream_end`) — not that every prompt and flow behaves
correctly end-to-end. This is the backlog of "various kinds of testing" to run
later, with the acceptance signal for each. STATUS.md holds the one-line index;
this doc holds the matrix.

## Prerequisites (do first)

1. **Commit the 3 uncommitted 8.0 harness fixes** — required for *any* live 8.0
   Playwright run; currently only in the working tree (deferred TS-migration pass):
   - `lib/soarBrowser.js` — login submit selector adds "SIGN IN"/"Sign In" (8.0).
   - `lib/liveUiDriver.js` — `openWidgetDrawer` targets the drawer icon by widget
     title (8.0 renders multiple drawer icons; blind click-loop opened the wrong one).
   - `public/index.html` — Monaco↔Toast-UI `define.amd` falsification (pageerror guard).
2. **Live path is proven** — no further seeding needed; the 8.0 box has 25k+ real
   alerts. `fortisoar-soc-simulator` (`create_simulated_alert`) is available for a
   clean known record if a real one is too noisy.

## How to run

> **Prereq — workers must be fresh.** The connector runs on cached in-memory
> workers that only recycle on a **version-bumped publish** (KNOWLEDGEBASE §20.4).
> If triage returns `no_fsr_configured`, the workers are stale — re-ship with
> `make ship` (connector-repo Makefile) and confirm with `make bridge-check`
> BEFORE blaming a prompt/flow. Ship + box diagnosis is standardized on that
> Makefile (`make ship` / `ship-widget` / `verify` / `bridge-check` / `matrix`);
> never hand-run `deploy.sh` / `ssh` / ad-hoc `pyfsr`.

All live runs go through the WAF-safe infra (real desktop Chrome UA — FortiGuard
IPS blocks headless; 8.0 login is the local admin form, no SSO). Three options:

- **The matrix, one command** (preferred): `make test-matrix-live` (or
  `make matrix` from the connector repo) runs every
  runnable row of the matrix below serially through the deployed widget and
  prints a per-scenario transcript digest + a summary table.
  - Scenario rows (prompts + **box-specific record UUIDs**) live in the
    gitignored `tests/live/scenarios.local.json` — copy
    `tests/live/scenarios.local.example.json` and fill in real UUIDs from your
    box (public-repo hygiene: never commit them). Missing file ⇒
    `[[MATRIX-ENV-SKIP]]`, not a failure. `MATRIX_ENV=<envfile>` overrides the
    creds file.
  - Evaluation (in `tests/live/lib/matrixDriver.js`): the health axis is **tool
    errors**, not call count (`errBudget`, default 1); `minTools` guards against
    a 0-tool "summarizer" run (hard FAIL); repeated identical errors dedupe to
    one root cause; verdict ladder `FAIL (no-investigation)` > `FAIL` >
    `DEGRADED` > `PASS (minor errors)` > `PASS`. **Only hard-FAIL verdicts fail
    the jest run** — DEGRADED rows are fix-me signals in the summary table.
    The pure eval engine is unit-tested offline in `tests/matrixEval.test.js`.

- **Ad-hoc** (fastest, per `feedback_visual_validation_speed`): a small script
  using `lib/liveUiDriver.js` `openWidgetDrawer({recordUuid, widgetTitle})` →
  `session.sendChat(text)` → assert on `session.polls`/`turns` + transcript cards.
  Pattern proven on an earlier live pass.
- **Spec**: `FSRPB_LIVE_UI=1 FSR_ENV_FILE=.env.<box> make test-e2e-spec
  SPEC="../widgets-src/fortiaiAgenticAssistant/tests/e2e/fortiaiAgenticAssistant.liveSweep.spec.js"`. Note: the canned
  `liveSweep.spec.js` is bound to the forticloud wendy.smith C2 scenario — adapt
  or write a 8.0-box variant rather than forcing the forticloud golden onto 8.0.

Probe note: `window.__fortiaiAgenticAssistant__` is **mock/harness-only by
design** (`view.controller.js:594`, `if (_mockActive || _isHarness)`). Don't use
its presence as a live-render signal — use the composer opening + `chat_poll`
frames, as on the earlier live pass.

## Matrix

Acceptance signal per item: **card/transcript shape** = assert the widget emitted
the named card type(s) in its transcript; **terminal** = turn reaches
`stop_reason` `end_turn`/`awaiting_action_card` and `viewState` returns to idle
(typing indicator stops); **no-leak** = no ≥400 `/api/` response, no `pageerror`.

### Triage flows

| # | Flow | Input / scenario | Acceptance | Notes |
|---|---|---|---|---|
| T1 | Single-alert triage summary | "Triage this alert: summarize severity, indicators, next steps." | `info_card` summary; **terminal** idle; **no-leak** | proven on an earlier live pass (render+stream); re-run with card-shape assertions |
| T2 | Hunt chain (multi-pivot) | A real alert with indicators (file hash + dest IP) | `get_record` → `search_module_records` (indicator SEARCH, not relationship traversal) → enrich → consolidated `ioc_card`; **terminal** | `c2_hunt.json` is the mock golden; need a live equivalent |
| T3 | RFC1918 negative case | Alert whose only indicator is an internal IP | internal IP deliberately NOT enriched externally; enrichment limited to external dest | from `c2_hunt.json` contract |
| T4 | Direct-containment ask | "Block the C2 IP at the edge" | emits `action_card` (not a silent `run_op`); `editable_fields`/`required_fields` populated | mirrors `liveSweep` test-3 |
| T5 | Approval → execute | approve the T4 action card | `execute_action` tool_use → tool_result → `end_turn` summary naming the object id | FortiGate lab config is DOWN → `execute_action` will env-skip; the offer+approve path still asserts |
| T6 | Approval → reject | reject the T4 action card | decision logged; no `execute_action`; `end_turn` | |
| T7 | Tier gating | a tier-≥3 mutating op without `_approved` | dispatch tier returns `pending_approval` (not auto-run) | gate lives at dispatch tier, NOT `run_op` — don't add a second gate (memory `agent_mutating_op_approval_gate`) |
| T8 | Render-path races | empty-opener / late-entity / bad-fetch fixtures | widget settles to idle, no stuck typing indicator | render path, not prompt; drive live since the harness can't |
| T9 | Triage prompt steering | fetch-by-IRI phrasing | goes to `get_record`; never invents a connector/op name | connector 0.4.11 steering (`692f554`) |
| T10 | Provider parity | repeat T1–T2 on the openai config (gpt-4o-mini) | hunt depth doesn't collapse on phrasing; TriageDiscipline guard holds | connector 0.4.10 guard; run live ONLY on the openai-config box per user |

### Playbook-creation flows

| # | Flow | Input / scenario | Acceptance | Notes |
|---|---|---|---|---|
| P1 | Build from investigation | "Save this investigation as a playbook" | `playbook_offer` → Create Playbook → compiled playbook exists on box → delete it | `liveSweep.spec.js` test-4 pattern |
| P2 | Draft branching | a draft with branch points | branches render correctly in the designer | `playbook_draft_branching` fixture |
| P3 | Offer decline | decline the `playbook_offer` | logged; no playbook created; `end_turn` | `playbook_offer_decline` fixture |
| P4 | `manual_input` stage | a playbook with a manual_input step | stage hoists + renders input prompt correctly | framework 0.4.10 manual_input hoist |
| P5 | Rehydrate build | resume a saved draft | draft rehydrates; build resumes without re-prompting | `rehydrateBuild` spec pattern |

### Build / authoring flows (from-scratch, `intent:build`)

P1–P5 all build *from an investigation trace*. P6 covers the other half — authoring
from nothing — which is where the real failure happened
(`docs/plans/live-chat-eval-and-build-flow-fixes.md`). The **mount** is the variable,
because the mount is what broke it: the drawer is persistent, so where it was opened
decides the entity context the connector sees.

| # | Flow | Input / scenario | Acceptance | Notes |
|---|---|---|---|---|
| P6a | From-scratch build, no record context | mount on `/dashboard?module=<uuid>` (`mountPath`), "create a new playbook to block an ip and create an alert" | no triage/containment guard in a build turn; no `build_playbook_from_trace` without a trace; "create an alert" authored as a native `create_record` step on `alerts`, not a connector hunt or an invented HTTP POST | `gate:"xfail"` until the D2 connector fixes land |
| P6b | From-scratch build, stale record context | `visitFirst` a Key Store key → drawer captures `module:keys` → navigate to `/playbooks/<collection-uuid>`, same prompt | as P6a, **plus** the mounted module must NOT reach the authored playbook (`forbidRedFlags:["mount_module_leaked_into_start"]`) | the **D1 regression guard** — D1 was fixed in widget 1.2.21; this is the row that keeps it fixed |

**Mount paths are box-specific and easy to get wrong** — and a wrong one is worse
than a hard error, because FortiSOAR renders the drawer icons on its `/not-found`
page too: the composer opens, the turn runs, and the row passes with **no entity
context**. `liveUiDriver.goto()` therefore throws on `/not-found`. Verified shapes
(8.0): dashboard `/dashboard?module=<uuid>` (a bare `/dashboard` 404s), designer
`/playbooks/<collection-uuid>`, record `/modules/<module>/<uuid>`. See
`docs/kb/drawer-widgets.md` §18.8.

**Scenario rows are per-box.** Real record UUIDs only exist on their own box, so
`MATRIX_ENV=.env.206` auto-selects `tests/live/scenarios.local.206.json`
(gitignored), falling back to `scenarios.local.json`. Box 159 holds the triage
T-rows; box 206 holds the P6 build rows. `MATRIX_SCENARIOS=<path>` overrides.

## Gating (what reds the run)

Per row, via `gate` (`tests/live/lib/matrixDriver.js` → `gateRow`, unit-tested in
`tests/matrixEval.test.js`). The matrix has to hold known-good rows and rows that
document an open bug at the same time — a suite that goes perma-red on a known bug
gets ignored, and one that only blocks on hard-FAIL ships DEGRADED regressions silently.

| gate | blocks on |
|---|---|
| `soft` (default) | hard-FAIL only — the original contract |
| `strict` | hard-FAIL, DEGRADED, or any red flag. For known-good rows that must stay clean (T1/T3/T7). |
| `xfail` | **nothing** — the row documents an open bug. It reports `XFAIL (expected)` when the bug shows and `XPASS (promote?)` when it doesn't. `expectRedFlags[]` names the codes that count as still-broken (ANY one suffices). |

**Why `xfail` never blocks on a clean run.** It used to, on the theory that clean
⇒ fixed ⇒ promote. Every row is an LLM turn, so a defect is only observable when
the model happens to *exercise* it: across four live 206 runs of one prompt against
an unchanged, still-broken connector, P6b tripped the triage toolset three times
and not at all the fourth. "Clean" and "the model didn't try" are indistinguishable
from a single run, so blocking there both flakes and — far worse — announces that a
live bug is fixed when it isn't. Promotion is a human call on repeated evidence.

**Corollary: key `expectRedFlags` on a DETERMINISTIC code.** Grade the defect, not
a symptom. `triage_guard_in_build` (the hunt-floor guard happening to trip) fires
only sometimes; `triage_tool_in_build` (a triage-only tool being callable in a build
turn at all) fires whenever the model touches it. The former produced a false
"promote".

Two things override every gate, xfail included:
- `forbidRedFlags[]` — how a row parked for one open bug still hard-blocks if an
  already-fixed bug regresses on the same turn (P6b guards D1).
- **drive errors** — login/mount/drawer/timeout means the row never sent a prompt.
  Infrastructure is never an "expected bug"; an xfail that swallowed it reported
  `XPASS (promote?)` for a scenario that never ran.

**What does NOT belong here:** "tool X must not be exposed for intent Y" is a
property of the connector's tool registration. Asserting it through a stochastic
LLM turn is inherently probabilistic — put that gate connector-side, deterministically.

Every row is **also** graded by the `exportGrader` red-flag rules — the same rules
that grade a downloaded `.events.json` export (`make grade-export`). One rule set,
both halves of the loop: a signature caught once offline gates the live matrix
forever after. A red flag can hard-fail a row the frame metrics call clean (the
derailed build turn emitted its offer with 0 tool errors while authoring a playbook
that POSTs to an invented endpoint).

Run: `make test-matrix-live` (all rows) / `make test-matrix-gate` (gating rows only).
Deliberately **not** wired into `ship-verify` — each row is a headed box turn (~2–4 min).

## Env constraints

- **8.0 box**: FortiSOAR 8.0, local admin login (no SSO), 25k+ real
  alerts. Config writes need pyfsr (HMAC); raw JWT bearer 403s. See the
  local-only memory notes for the full 8.0 quirks catalog.
- **FortiGate lab config is down** ("invalid endpoint or credentials") — env, not
  a bug. Containment `action_card` can still be offered/approved (T4/T6 pass);
  only T5's `execute_action` env-skips.
- **Provider parity (T10)**: run only on the openai-config box per user (the
  internal LLM gateway is gateway-502 on the gpu box; see local-only memory).
- **Public-repo hygiene**: no box IPs/creds/dates in tracked files. Real box
  details live in the local-only memory dir.

## Recording results

As each item runs, mark it ✅/❌ in this matrix with the date + a one-line finding
(generic — "live-verified on 8.0.0", no box IP). Surface any prompt-behavior bug
as a new defect row in STATUS.md (not here) so it gets tracked like any other.
