# Harness typing: eliminate `any` plan

**Status:** in progress — Phases 0–4 done (324→115), Phase 5 pending
**Created:** 2026-06-22
**Goal:** Drive the harness TypeScript from "compiles under strict with honest `any`s" to near-zero `any`, enforced, without contorting code at genuinely-dynamic boundaries.

## Progress (2026-06-22)

Total explicit `any`s: **324 → 144** (and **144 − 102 = ~42** outside `harness.module.ts`, which Phase 4 is converting now). Each landed phase ended green: full `tsc -p tsconfig.json --noEmit` exit 0 + 164/164 jest tests passing + browser-safe emit intact.

| Phase | Scope | Status | Result |
|---|---|---|---|
| 0 | `@types/express@4`, `lib/types.ts` | ✅ done | shared types module created; express types pinned to v4 |
| 1 | `server.ts` express handlers | ✅ done | folded into Phase 2 server pass |
| 2 | `server.ts` domain + IO | ✅ done | **151 → 2** (2 allowlisted: proxy header deletes) |
| 3 | `lib/*` + `scripts/*` | ✅ done | soarBrowser/liveUiDriver **20→0**; packager **9→1**; scripts **38→21** (allowlisted) |
| 4 | `harness.module.ts` | ✅ done | `@types/angular` + `angular.*` DI types; **102 → 73** (≈28 of the 73 are `window as any` for `__HARNESS_*` globals — an effective floor without a `declare global`, which is forbidden in this browser-safe non-module file) |
| 5 | ESLint `no-explicit-any` enforcement | ⬜ pending | not started |

Total now: **324 → 115**.

**⚠ Phase 4 regression caught & fixed:** the agent moved `$q` from `$stomp`'s `$get` annotation up to the provider-constructor annotation. A provider constructor runs in AngularJS's **config phase**, where only *providers* (`$qProvider`) are injectable — not instance services like `$q` — so bootstrap died with `$injector:unpr <- $q` and **no widget mounted**. Compiled clean + browser-safe, but broke at runtime — caught only by the introspection rig's mount check. Restored the `$get`-injection structure (now with an explanatory comment) and allowlisted the provider-constructor `as any` (the `IServiceProvider` overload can't express `$get`-via-`this`). Lesson: **typing passes on Angular DI must be runtime-verified, not just type-checked.**

Notes / debt:
- `scripts/widget.ts` rose 16→18: the agent converted loose shapes to explicit `as any` allowlists (same safety, more honest) — a follow-up pass could turn some into real types.
- `useUnknownInCatchVariables` (planned in Phase 0) was **not** enabled; catch-narrowing was done per-file instead. Enable it in Phase 5 to enforce going forward.
- Phase 4 installs `@types/angular` (deferred from Phase 0 to avoid the `declare const angular` collision); the agent removes that ambient declaration.

---

## Current state (measured)

After the JS→TS migration, **324 explicit `any`s** remain. They cluster heavily:

| Cluster | Count | Nature | Fix |
|---|---|---|---|
| `server.ts` express handlers | ~40 | `(req: any, res: any)` | install `@types/express` → `Request`/`Response` |
| `server.ts` domain/JSON/http | ~110 | widget records, `info.json`, SOAR API responses, http opts, SSE payloads, `catch(e:any)` | shared domain types + `unknown`+narrow |
| `harness.module.ts` | 102 | AngularJS DI stubs (`$q`, `$log`, `app`, …) | install `@types/angular` → `ng.*` types |
| `lib/*` + `scripts/*` | ~70 | playwright eval results, `info.json`, HTTP, flags | shared types + per-file narrowing |

Per-file (top): `server.ts` 151, `harness.module.ts` 102, `scripts/widget.ts` 16, `lib/soarBrowser.ts` 11, `packager.ts` 9, `lib/liveUiDriver.ts` 9.

Missing type packages: **`@types/express`**, **`@types/angular`** (node + playwright already typed).

---

## Target (confirm before executing)

Drive to **zero implicit and near-zero explicit `any`**, enforced by ESLint `no-explicit-any`. A small **named-and-justified allowlist** (inline `eslint-disable-next-line` + reason) is permitted only for genuinely dynamic boundaries — `catch` clauses and `page.evaluate()` DOM results. Recommend **~95% real types + justified remainder** over dogmatic literal-zero (the last ~5% costs a lot and tends to produce worse code). *Literal-zero is an option; it changes Phase 5.*

---

## Plan

### Phase 0 — Foundations (low effort, unblocks everything) ✅ DONE
1. `pnpm add -D @types/express` now. **Defer `@types/angular` to Phase 4** — it provides a global `angular: IAngularStatic` that collides with the `declare const angular: any` in `harness.module.ts` and would break the green build until that file is retyped. Install it as the first step of Phase 4.
2. Create **`lib/types.ts`** — shared domain types (pure interfaces, no runtime):
   - `InfoJson`, `WidgetRecord`, `WidgetPage`
   - `SoarAuthResponse`, thin `SoarApiEnvelope<T>` for proxied responses
   - `UpstreamRequestOpts` / `UpstreamResponse` (move from `server.ts`)
   - `SseEvent` union for `broadcast()`
   - Re-export the lint types already in `harnessUtils.ts` (one home).
3. Add `"useUnknownInCatchVariables": true` so `catch` defaults to `unknown` and forces narrowing.

### Phase 1 — `server.ts` express layer (~40 anys, highest ROI) ✅ DONE
With `@types/express`: type every handler `(req: Request, res: Response)`. Type `req.body` per-route (small body interfaces or `Request<{}, {}, BodyShape>`). Riskiest code, biggest single win.

### Phase 2 — `server.ts` domain + IO (~110 anys) ✅ DONE (151→2)
- Replace `any[]`/`any` on widget records, `lint`, `staleVersionRefs`, `info` with `lib/types.ts` interfaces.
- Type `JSON.parse` sites by annotating the target (`const info: InfoJson = JSON.parse(...)`) — validate-then-trust.
- `headers?: any` → `http.OutgoingHttpHeaders`; `broadcast(obj: any)` → `SseEvent`.
- `catch (e: unknown)` + `e instanceof Error` narrowing (mechanical).

### Phase 3 — `lib/*` and `scripts/*` (~70 anys) ✅ DONE
- `soarBrowser.ts` / `liveUiDriver.ts`: most anys are `page.evaluate()` returns — type the **return generic** (`page.evaluate<T>()`); in-browser callback stays loose (allowlisted).
- `packager.ts`: `InfoJson` from `lib/types.ts`.
- `widget.ts`: type the HTTP helper (`HttpResponse` exists); replace `Record<string,string|boolean>` flag bags with per-command option interfaces.

### Phase 4 — `harness.module.ts` (102 anys — the judgment call) ✅ DONE (102→73)
With `@types/angular`: `angular: ng.IAngularStatic`, `app: ng.IModule`, `$q: ng.IQService`, `$log: ng.ILogService`, etc.
- **(a)** Fully type it (~1–2 hrs of `ng.*` lookups), OR
- **(b, recommended)** Type the *structural* parts — `window.__HARNESS_*` globals via a real `declare global` in a `.d.ts`, the field-def tables, the translate helpers — and allowlist the bare injector callbacks. Most value, fraction of the effort.
  - Note: a `declare global` lives in a `.d.ts` (not `harness.module.ts` itself, which must stay a browser-safe non-module script — no top-level import/export).

### Phase 5 — Enforcement (locks the gains in) ⬜ PENDING
- Add `@typescript-eslint/no-explicit-any: error` scoped to harness `.ts`.
- Each remaining `any` carries an inline disable + one-line reason — allowlist stays auditable, can't silently grow.
- Wire `pnpm typecheck` into lint/CI so regressions fail.

---

## Sequencing & invariants
- Phases 0→3 are mechanical + high-value — can run as a parallel-agent fan-out per file (like the JS→TS migration), then central `tsc -p tsconfig.json --noEmit`.
- Phase 4 is the only real decision (a vs b).
- Each phase ends **green**: `tsc` exit 0 + `jest` unit suite passing.
- Browser-safe emit invariant holds throughout: `harness.module.ts` and `lib/harnessDrawer.ts` must keep emitting plain scripts (no CommonJS wrapper) — verified by grepping the emitted `.js` for `Object.defineProperty(exports` / `require(`.

## Open decisions
1. **Target:** ~95% + justified allowlist (rec) or literal zero?
2. **`harness.module.ts` (Phase 4):** full Angular typing (a) or structural-only + allowlist (b, rec)?

## Related
- Folds into the introspection work: the Phase 1 introspection rig's data structures are a natural home for real interfaces. See `docs/INTROSPECTION_OPTIMIZATION_PLAN.md` (Phase 5).
- Build workflow: edit `.ts` → `pnpm build` regenerates the committed `.js`. Canonical recipe lives in `tsconfig.json` `include`.
