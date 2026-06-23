# Harness TypeScript / static-analysis plan

**Goal:** make the harness catch more widget bugs *before the box* by turning
TypeScript into a real analysis engine — AST-accurate lint, authored SOAR
platform types, and an opt-in type-check of widget source. Tracking doc; check
boxes as phases land.

> Run tests only through the parent Makefile (`make test-unit WIDGET=…`,
> `make test-e2e-spec SPEC=…`). The lint that this plan extends runs in the
> harness server at widget boot (`lib/harnessUtils.ts` `lintWidget`) and in the
> CLI (`scripts/lint-angular.ts`).

---

## 1. Why — current state (recon)

- **Two regex linters with divergent rule sets:**
  - `lib/harnessUtils.ts` → `lintWidget()` (runs at widget boot in the harness
    server; 12 codes: `controller-mismatch`, `edit-controller-mismatch`,
    `stale-version-ref`, `root-ng-controller`, `html-tag-imbalance`,
    `harness-only-stub`, `unknown-dependency`, `trigger-endpoint-misuse`,
    `dollar-param-drop`, `query-filter-no-logic`, `broken-asset-path`,
    `absolute-host-url`, plus `file-missing`).
  - `scripts/lint-angular.ts` → CLI batch (~12 *different* codes:
    `ng-model-dot-rule`, `config-defaults-missing`, `uibModal-in-view-controller`,
    `ng-controller-unregistered`, `missing-inject`, edit-modal contract trio,
    `websocket-no-destroy-cleanup`, `cs-directive-needs-data-prefix`,
    `unscoped-generic-css`, `widget-root-height-*`, `composer-not-sticky`,
    `connector-null-configid`, info.json sanity checks).
  - Overlap but no shared source of truth → rules drift; a gotcha caught in one
    isn't caught in the other.
- **Regex-only parsing, no AST.** `extractInjectedDependencies` reads function
  param names, so a helper `function getRecords(Query, module)` mis-flags its
  params as unknown DI. Known false-positive class.
- **No SOAR platform types.** `ANGULAR_BUILTINS` (`harnessUtils.ts:386`) is a
  hand-maintained `Set<string>`; `FormEntityService`, `connectorService`,
  `executeConnectorAction`, `PagedCollection`, `Query`, `Entity`, `config` are
  untyped folklore.
- **Widget source is never type-checked.** `tsconfig.json` includes only the
  harness's own `lib/`+`scripts/`; `widgets-src/**/*.js` gets zero TS analysis.

---

## 2. Sources of truth (all three have value, used for different aspects)

| Source | On hand? | Best for | Weakness |
|---|---|---|---|
| **contenthub `widgetServiceAPI`** (`fortisoar.contenthub.fortinet.com/widgetServiceAPI`) | fetchable (dgeni/ngdoc: `js/docs-setup.js` manifest + `partials/api/fortisoar.<svc>.html`) | **discovering which services exist and what their methods are** — typed params + return types | can lag / be partial (`FormEntityService` doc showed only `get`/`set`) |
| **8.0 Widget Dev Guide** (`docs.fortinet.com/.../8.0.0/widget-development-guide/673410/widget-dependencies`) | fetched | the legal **injectable set** + correct casing (`Config`,`Toaster`,`WizardHandler`,`LocalStorageService`,`PromiseQueue`,`Constants`,`CommonUtils`,`_`, core `$*`) | prose, no signatures |
| **`fsr_src/app.unmin.js`** (shipped bundle) | yes — already parsed for names at `server.ts:105` | **ground truth for what actually exists at runtime**: service existence, method names, arity | minified → param *names* mangled; no types; **proprietary, not redistributable** |

**Authority split:** contenthub is the *primary* source for the service +
method surface and types. The bundle is the *cross-check* for "does this method
actually exist in the running code, at this arity." The dev guide fixes the
injectable universe + casing.

**Canonical contenthub inventory (26 services):**
appModulesService, AuthenticationConfig, AuthenticationService, CommonUtils,
connectorService, currentPermissionsService, editorLanguageService, Entity,
exportService, Field, FormEntityService, licenseService, modelMetadatasService,
Modules, picklistsService, playbookService, PromiseQueue, Query,
queryCollectionService, PagedCollection, settingsService, tokenService,
usersService, ViewTemplateService, websocketService, widgetTemplateService.

**Two signatures already pulled (anchor cases):**
```ts
// connectorService — note configuration is a REQUIRED string (the KB null-configId
// gotcha is therefore a checkJs type error, no bespoke rule needed):
executeConnectorAction(connectorName: string, connectorVersion: string,
  operation: string, configuration: string, params: object,
  audit?: boolean, auditInfo?: object, agent?: string): Promise<unknown>;
// appModulesService:
load(excludeSystemModule?: boolean, forceReload?: boolean): Promise<unknown>;
getState(moduleName: string): string;
getModules(modules: unknown[]): unknown[];
// FormEntityService: get(): object; set(newEntity: object): void;
```

---

## 3. Phases

### Phase 0 — Unify the two linters *(prerequisite, no behavior change)*
- [ ] Define one `LintRule` interface + registry in `lib/`; tag each rule
      `runtime`/`cli`/`both` and `error`/`warning`.
- [ ] Port the existing ~24 checks behind it; `lintWidget()` and
      `lint-angular.ts` both consume the registry.
- [ ] Regression: run across all `widgets-src/` widgets, assert identical
      findings to today (zero diff). *Effort: M.*

### Phase 1 — AST backbone (`lib/widgetAst.ts`)
- [ ] `ts.createSourceFile()` over each widget `.js`; expose real controller/
      factory registrations, accurate `$inject` vs param lists, and call-sites
      (`executeConnectorAction`, `$http`/`$resource` config objects,
      `/api/query` bodies).
- [ ] Re-point `extractInjectedDependencies`, `controller-mismatch`,
      `dollar-param-drop`, `trigger-endpoint-misuse` at it.
- [ ] Kills the DI false-positive class; rules become robust against
      comments/strings/formatting. *Effort: M–L.*

### Phase 2 — SOAR platform types (`lib/soar-platform.d.ts`) — **primary source: contenthub** — IN PROGRESS
- [x] `scripts/gen-soar-types.ts` (run: `pnpm gen-types`):
  1. [x] Fetch contenthub `js/docs-setup.js` → 26-service inventory; fetch each
     `partials/api/fortisoar.<svc>.html` → method names (real casing from the
     signature, not the lowercased ngdoc id), param names+types, optional
     markers, return types. **Primary generator input.** (NB: PagedCollection's
     partial filename swaps the `:` for `.`.)
  2. [~] Cross-check vs local `app.unmin.js` at the **name** level (reuses
     `HU.parseRegisteredServices`; 26/26 matched). *TODO: deepen to method
     existence + arity via an AST walk of the bundle.*
  3. [~] Reconcile/log doc-only names. *TODO: method-level reconciliation once
     the AST walk lands.*
- [x] Emit `lib/soar-platform.d.ts` (committed, contenthub-derived only —
      redistributable) + `lib/soar-services.generated.json` (machine model for
      lint rules). Added to `tsconfig.json`; `pnpm typecheck` validates it.
      13 jest cases in `tests/genSoarTypes.test.js`.
- [ ] Version-pin: URLs carry `8.0.0`; add `make refresh-soar-types` (parent
      Makefile) to re-pull per box version. (`pnpm gen-types` exists.)
- [x] Derive the `unknown-dependency` allow-set floor from
      `soar-services.generated.json` (`HU.generatedServiceNames`) +
      `HU.SOAR_DEV_GUIDE_INJECTABLES` (dev-guide names not in the catalog, real
      casing verified vs bundle). Wired into `server.ts` `PLATFORM_SERVICES` as a
      floor so the rule stays accurate without `fsr_src/app.unmin.js` on disk.
      4 jest cases; 271 green. (`ANGULAR_BUILTINS` stays the hand-maintained set
      for the `$*`/$controller-locals — those aren't in the service catalog.)
- [x] `make refresh-soar-types` (parent Makefile) → `pnpm build && pnpm gen-types`.
- [ ] Deepen bundle cross-check from name-level to method existence + arity
      (AST walk of `app.unmin.js`). *Effort remaining: S–M.* — last Phase-2 item.

Anchor signature emitted correctly (proves Phase 3 payoff):
`executeConnectorAction(connectorName: string, connectorVersion: string, operation: string, configuration: string, params: object, audit?: boolean, auditInfo?: object, agent?: string): Promise<unknown>` — `configuration` required, so passing `null` is a type error under checkJs.

### Phase 3 — Opt-in type-check of widget source (`checkJs`) — the headline win — IN PROGRESS
- [x] Engine `lib/widgetTypecheck.ts`: parses a controller, **auto-annotates
      injected params** with their `Soar.*` types (JSDoc `@param`, non-destructive,
      back-to-front splice), runs `checkJs` with `strictNullChecks` on but
      `noImplicitAny` off so only SOAR-contract misuse surfaces, not AngularJS
      boilerplate. Diagnostics scoped to the widget file.
- [x] **Automatic surface (no step to remember):** `tests/widgetTypecheck.test.js`
      — known-broken-widget fixtures assert each planted bug is caught
      (null-config → TS2345, bad method → TS2551, wrong arity → TS2554) + clean /
      no-false-positive guards. Runs in `make test-unit` (jest). 8 cases green.
- [x] On-demand CLI `scripts/typecheck-widgets.ts` (`pnpm typecheck:widgets [name]`)
      — strict, exits non-zero on any error. **Not yet wired to block** anything.
- [ ] **Noise-scoping (the gate-blocker):** full-strict on the 13 real widgets is
      ~85% noise — `TS2339` on `window`/monkey-patched fns, `TS2304` on 3rd-party
      globals (`echarts`/`c3`), null-inference on untyped locals. None involve a
      SOAR service. To make the CLI a clean blocking gate: walk each diagnostic to
      its AST node, keep it ONLY if the expression's type resolves to a `Soar.*`
      interface (use the TypeChecker). Then wire the scoped CLI into `ship-verify`
      step 1 (lint), blocking per shipped widget.
- [ ] **Model gap:** ~15 `TS2351` "Type 'Entity'/'Query' has no construct
      signatures" — widgets use `new Entity()`/`new Query()`. Add a small curated
      overlay marking `Entity`/`Query`/`PagedCollection` constructable (merged
      onto the generated `.d.ts`, since the generator can't infer it from docs).
- [ ] Triage the residual real signal (a few `TS2554`/`TS2345`) once noise-scoped.

### Phase 4 — Port remaining KB gotchas onto the unified engine
- [ ] AST-accurate where applicable: copyright-header-missing (KB §2/§28.3),
      drawer-needs-`standalone`/`enableFor` state matching (KB §18),
      websocket-`$destroy`-cleanup, edit-modal contract
      (`$uibModalInstance`/`save`/`cancel`), unscoped CSS, `cs-*` `data-` prefix.
- [ ] **Drop `connector-null-configid`** — Phase 3's type system covers it.
- [ ] Templates stay regex/parse5 (HTML isn't TS). *Effort: M.*

### Phase 5 — Wire + harden
- [ ] Jest cases per rule; false-positive baseline sweep across all ~60 widgets
      (zero-FP gate, as done for the last lint batch).
- [ ] Hook the type-check tier into `make ship-verify`. *Effort: S–M.*

---

## 4. Sequencing

Foundation in order: **0 → 1 → 2**. Fastest visible payoff: **0 + 2 + 3**
(unify, generate types, turn on `checkJs` as warnings) — that alone makes the
connector-`configuration` and service-typo gotchas compile errors with no new
regex. Phase 1's AST refactor can follow to harden the legacy rules.

**Recommended first slice:** Phase 2 generator, starting with the **contenthub
scraper** (manifest → 26 partials → typed methods), then the `app.unmin.js` AST
cross-check (extend `parseRegisteredServices` into a method+arity walker).

## 5. Risks / caveats
- `checkJs` on hand-written AngularJS is noisy initially — needs a tuning pass
  (targeted `// @ts-expect-error` or rule-level suppression) before it can block.
- Phase 0 touches both linters → full-widget regression sweep before merge.
- Bundle is proprietary: only the contenthub-derived `.d.ts` is committed; bundle
  is a local-only cross-check.
- contenthub partials are JS-rendered ngdoc — the scraper hits the static
  `partials/api/*.html` + `js/docs-setup.js`, not the `#/`-fragment SPA.

## 6. Statically-detectable KB gotchas not yet caught (Phase 4 backlog)
config-defaults-missing, uibModal-in-view-controller, ng-controller-unregistered,
missing-`$inject` (AST-accurate), edit-modal contract trio,
websocket-no-destroy-cleanup, cs-directive-`data-`-prefix, unscoped-generic-css,
widget-root-height/sticky-composer, copyright-header-missing,
drawer-needs-standalone / enableFor state match, version-not-semver,
published_date type drift, subTitle capitalization.
(Several already exist in `lint-angular.ts`; Phase 0 folds them into the one
registry so `lintWidget` gets them too.)
