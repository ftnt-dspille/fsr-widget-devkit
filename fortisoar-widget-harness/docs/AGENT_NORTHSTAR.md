# North star: an agent-automatable widget harness

**One sentence:** an agent should go from *intent* → *working, tested, shipped
FortiSOAR widget* in a single closed loop where **every check is deterministic
and box-independent**, **every failure is loud, located, and machine-readable**,
and **the agent never needs to read the platform source to know if the widget
is correct.**

The test: a capable agent, given only this harness and a one-paragraph widget
spec, produces a green-on-mock, green-on-live widget **without a human
untangling a flake, a silent no-op, a benign console error, or a missing stub.**

---

## Why this doc exists

Everything below is distilled from real friction hit while building/testing
widgets (jsonToGrid, action-renderer) in one session. Each principle has a
scar behind it.

| Scar (this session) | Principle it proves |
|---|---|
| `$uibModal` was a no-op stub → modal "mounted" but did nothing | **No silent stubs** |
| Renders settled only on a widget-initiated digest → flakes, `scope().$apply()` pokes | **Deterministic, observable rendering** |
| `module is not defined` on every page broke clean-error probes | **Zero benign noise** |
| Record-context specs hang: no record fixture, fetch 599s in hermetic mode | **Hermetic = complete, not just blocked** |
| `_probe.js` waited for a now-hidden `#widget-select` | **Helpers can't drift from chrome** |
| `action/<route>` vs `notrigger/<uuid>` → opaque 404 | **Platform contracts are encoded, not folklore** |
| A stray version bump rewrote source but not tests | **One source of truth per fact** |
| A dead box hung `/_fsr/stylesheets` for minutes | **No unbounded waits, ever** |

---

## The three pillars

### 1. Deterministic & observable runtime
The agent must be able to *await* a render and *read* its outcome — never poll
with magic timeouts or guess.

- **Render is a state machine.** `window.__HARNESS_RENDER_STATE`
  `{phase, mountId, lastError}` + `window.__harness.settle()` + `waitForRender()`
  test helper. *(shipped — P0/P1.)*
- **No silent stubs.** A stubbed platform service is either *faithful* (renders
  like the real thing — e.g. the real `$uibModal` now) or *loud* (a visible
  panel/console error the moment it's invoked). A green mount must never hide a
  dead feature. (`__HARNESS_STUB_HITS` already tracks usage — surface it.)
- **Zero benign noise.** Console/error channels carry only real problems, so an
  agent can treat "any error == failure". (Fixed `module is not defined`.)
- **No unbounded waits.** Every upstream/proxy call is time-bounded so a dead
  box degrades to a fast, legible error. (Fixed `upstreamRequest` timeout.)

### 2. Hermetic by default, *complete* by default
The mock tier must need **zero box and zero per-spec stubbing** for the common
platform surface. Today every record-context spec re-stubs `/api/3/<module>/<id>`,
`/api/integration/connectors/`, metadata, triggers — and forgets one, and leaks.

- **A default fixture layer** serves the platform calls every widget makes:
  the seeded record (so `__HARNESS_RECORD` is set and viewpanel widgets mount),
  connector list, module metadata, picklists, playbook trigger/poll. A spec only
  stubs what's *unique* to its scenario.
- **Record fixtures are first-class.** Seeding `harness.id`/`module` should serve
  a believable record locally — no proxy, no 599. (This single gap currently
  reds the whole action-renderer mock e2e suite.)
- **The leak gate stays**, but with a complete default layer it fires only on
  genuinely novel calls — a *signal*, not a chore.

### 3. Scaffolding & contracts for *creation*
Testing is half the loop; the agent also has to *create* correctly.

- **Generate, don't hand-assemble.** A widget generator emits a correct skeleton
  from a spec: `info.json` (category, version), controller-name convention,
  `view`/`edit` templates, jest+e2e scaffolds wired to the harness helpers. The
  naming/versioning rules that cause desync (controller digits ↔ version) are the
  generator's job, never the agent's.
- **One source of truth per fact, enforced.** Version lives in `info.json`;
  bumps run through the CLI and rewrite source **and tests** atomically. The
  auto-fix that rewrites controller names must rewrite the matching test
  references too (the desync that broke jest this session).
- **Contracts are encoded, not folklore.** The platform's real rules — playbook
  trigger endpoints (`notrigger/<uuid>` vs `action/<route>`), csGrid's
  `list/keyPairs` render path, drawer `enableFor` — live as harness affordances
  and lint rules, so an agent can't pick the wrong one. (KB §19.3 documents the
  trigger split; the next step is a helper widgets call so they *can't* get it
  wrong.)
- **Introspection answers "is this widget correct?"** without reading
  `app.unmin.js`: does it mount, render non-empty, satisfy the contract, leak
  nothing, throw nothing. (The introspect gate is the seed.)

---

## The single surface an agent should need to know

Keep the agent's required vocabulary tiny and stable:

- **Create:** `make new-widget SPEC=…` → correct skeleton + passing stub tests.
- **Run/observe:** `pnpm dev`; `window.__harness.settle()` / `.renderState()` /
  `.dump()`.
- **Test:** `make test-unit WIDGET=…`, `make test-e2e-widget WIDGET=…` (hermetic,
  complete-by-default), `make test-…-live` (the only box-touching tier).
- **Ship:** `make ship-verify WIDGET=…` (lint → unit → mock → deploy → live).

Everything else is an implementation detail the agent should never have to learn.

---

## Roadmap (each item retires a scar)

1. ✅ **Default hermetic fixture layer** incl. a real record fixture — *unblocks all
   record-context widgets in the mock tier; biggest single win.* **DONE
   (2026-06-23).** `server.ts` serves `/api/3/<module>/<id>` (per-widget
   `widgetAssets/fixtures/api3/record.json` else a synthesised scaffold) +
   `/api/integration/connectors/` (fixture else empty `{…,data:[]}` envelope) under
   `FSR_HERMETIC`; the page declares the mounting widget via `POST /_fsr/active-widget`
   so handlers resolve the right fixtures. Reserved platform heads still
   `HERMETIC-MISS`. Fixtures captured faithfully from the live box (10.99.249.205) —
   action-renderer seeded. 6 jest regressions (`tests/hermeticFixtures.test.ts`),
   171 harness jest green. Doc: `TESTING.md` → "Default fixture layer".
2. **Stub policy: faithful-or-loud** + introspect check for no-op stub hits on
   mount.
3. **Versioning single-source**: bump rewrites tests with source; remove the
   hand-bump footgun.
4. **Contract helpers**: a `triggerPlaybook(playbook)` the widgets share so the
   endpoint choice is impossible to get wrong; same for csGrid wiring.
5. **Generator** (`make new-widget`) emitting harness-wired tests.
6. **Agent-facing docs**: `HARNESS_RENDERING.md` + this north star, kept short.

Done already this session: P0/P1 render-settle + state, real `$uibModal`,
`module is not defined` removal, upstream timeout, trigger-endpoint contract
(KB §19.3 + action-renderer/jsonToGrid fixes), `_probe` robustness.

**Definition of done for the north star:** a fresh agent scaffolds a
record-context widget, runs `make test-e2e-widget`, and it is green on the first
try with no hand-written platform stubs — and `make …-live` confirms it against
the box.
