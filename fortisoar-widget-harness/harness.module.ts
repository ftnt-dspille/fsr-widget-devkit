/* Harness module: creates `cybersponse` (the module widgets register against)
   and registers minimal stand-ins for the platform services our widgets inject.
   Add more stubs here as you pull in new widgets. */
"use strict";

(function () {
  // Initialize the stub-hit counter global. Each time a stub factory/service
  // is instantiated by the Angular injector, we increment the counter for that
  // stub name. The introspection rig reads this to determine which stubs are
  // actually exercised vs dead.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- window augmentation for harness globals
  const w = window as any;
  w.__HARNESS_STUB_HITS = w.__HARNESS_STUB_HITS || ({} as Record<string, number>);
  w.__HARNESS_STUB_NAMES = w.__HARNESS_STUB_NAMES || ([] as string[]);

  // Helper to register a stub factory with hit counting. When the injector
  // instantiates the factory, the hit counter increments.
  function regFactory(
    app: angular.IModule,
    name: string,
    deps: string[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- AngularJS DI factory callback
    fn: (...args: any[]) => any
  ): void {
    w.__HARNESS_STUB_NAMES.push(name);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- AngularJS DI wrapper callback
    const wrappedFn = function (...args: any[]): any {
      w.__HARNESS_STUB_HITS[name] = (w.__HARNESS_STUB_HITS[name] || 0) + 1;
      return fn(...args);
    };
    const depsAndFn = deps.slice();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- AngularJS DI array format requires any
    (depsAndFn as any[]).push(wrappedFn);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- AngularJS DI array requires any
    app.factory(name, depsAndFn as any);
  }

  // Helper to register a stub service with hit counting.
  function regService(
    app: angular.IModule,
    name: string,
    deps: string[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- AngularJS DI service callback
    fn: (...args: any[]) => any
  ): void {
    w.__HARNESS_STUB_NAMES.push(name);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- AngularJS DI wrapper callback
    const wrappedFn = function (...args: any[]): any {
      w.__HARNESS_STUB_HITS[name] = (w.__HARNESS_STUB_HITS[name] || 0) + 1;
      return fn(...args);
    };
    const depsAndFn = deps.slice();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- AngularJS DI array format requires any
    (depsAndFn as any[]).push(wrappedFn);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- AngularJS DI array requires any
    app.service(name, depsAndFn as any);
  }

  // The SOAR bundle (/_fsr/app.unmin.js) creates the cybersponse module
  // upstream of this script with its dep array stripped. We just reference
  // it here and layer harness-specific factories/directives on top. If the
  // bundle failed to load (or ran before us), bail loudly rather than
  // silently masking SOAR's real services with empty stubs.
  let app: angular.IModule;
  try {
    app = angular.module("cybersponse");
  } catch (e: unknown) {
    console.error("[harness.module.js] cybersponse module not found — did /_fsr/app.unmin.js load?", e);
    throw e;
  }

  // Real SOAR ships DOMPurify (loaded ahead of app.unmin.js) and uses it to
  // pre-clean HTML before handing it to $sce.trustAsHtml. The harness
  // provides a pass-through DOMPurify shim, so the same string reaches
  // ng-bind-html as a plain (untrusted) value and Angular throws
  // [$sce:unsafe]. Relaxing $sce to "off" in dev preview mirrors what real
  // SOAR effectively does post-DOMPurify and avoids forcing the harness to
  // ship a real DOMPurify build. This only affects the dev page; nothing
  // ships to SOAR.
  app.config(["$sceProvider", function ($sceProvider: angular.ISCEProvider) {
    $sceProvider.enabled(false);
  }]);

  // $stomp provider stub. SOAR's websocketService factory injects $stomp
  // (provided by the angular-stomp vendor module), and websocketService is
  // a transitive dependency of playbookService. Without this stub, any
  // controller that injects playbookService — directly or via lazy
  // $injector.get — fails with `Unknown provider: $stompProvider <- $stomp`,
  // which prevents widgets like the action-renderer from running their
  // playbook source path locally.
  //
  // The stub never opens a real socket: connect() returns a never-resolving
  // promise so $rootScope.websocketConnected stays false, and the rest of
  // SOAR's playbook polling code path (checkPlaybookExecutionCompletion's
  // polling fallback at app.unmin.js:38201) takes over. That path uses
  // /api/wf/api/workflows/log_list so it works through the harness proxy.
  interface StompService {
    setDebug(): void;
    connect(): angular.IPromise<unknown>;
    subscribe(): { unsubscribe(): void };
    disconnect(): angular.IPromise<unknown>;
    send(): void;
  }

  // NOTE: a provider's constructor runs in the CONFIG phase, where only other
  // providers (e.g. $qProvider) are injectable — NOT instance services like $q.
  // So $q must be injected into $get (which runs in the instance phase), never
  // into the provider function itself. (A prior typing pass moved $q up here and
  // broke bootstrap with `$injector:unpr <- $q`.)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- AngularJS provider-constructor idiom: $get is attached via `this`, which @types/angular's IServiceProvider overload can't express
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- AngularJS provider-constructor idiom: $get is attached via `this`, which @types/angular's IServiceProvider overload can't express
  app.provider("$stomp", function (this: any): void {
    this.$get = ["$q", function ($q: angular.IQService): StompService {
      function neverResolves(): angular.IPromise<unknown> { return $q.defer().promise; }
      function noopSubscription(): { unsubscribe(): void } { return { unsubscribe: function (): void {} }; }
      return {
        setDebug: function (): void {},
        connect: function (): angular.IPromise<unknown> { return neverResolves(); },
        subscribe: function (): { unsubscribe(): void } { return noopSubscription(); },
        disconnect: function (): angular.IPromise<unknown> { return neverResolves(); },
        send: function (): void {},
      };
    }];
  } as any); // eslint-disable-line @typescript-eslint/no-explicit-any -- AngularJS provider registration

  // Pipe Angular's exception channel into the harness debug drawer. Without
  // this override, controller/digest errors only land in DevTools — the
  // whole point of the drawer is to keep that information visible without
  // needing to keep the console open. Also re-throws so DevTools breakpoints
  // still fire on `Pause on caught exceptions`.
  regFactory(app, "$exceptionHandler", ["$log"], function ($log: angular.ILogService): angular.IExceptionHandlerService {
    return function (exception: unknown, cause: unknown) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- window augmentation for harness globals
        const w = window as any;
        if (w.__harnessReportError) {
          // For "Possibly unhandled rejection" the `exception` is the
          // raw rejection reason (often `undefined` from old AngularJS
          // code that swallowed the error). Look up the creation-site
          // stack we stashed when the promise was made; otherwise fall
          // back to whatever stack the exception itself carries.
          let creationStack: string | null = null;
          try {
            if (w.__harnessQ && exception !== undefined && exception !== null) {
              creationStack = w.__harnessQ.lookup(exception);
            }
          } catch (_: unknown) {}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- exception type is unknown at runtime
          const message = (exception && (exception as any).message) || String(exception);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- exception type is unknown at runtime
          const stack = (exception && (exception as any).stack) || null;
          w.__harnessReportError({
            source: "angular",
            message: message,
            stack: stack,
            creationStack: creationStack,
            cause: cause || null,
          });
          // While the harness is bootstrapping a widget (index.html sets
          // __HARNESS_MOUNTING around angular.bootstrap), a synchronous throw
          // in the widget's controller constructor or its init $digest routes
          // here — AngularJS does not surface it in the DOM, so the widget host
          // would otherwise render an empty/broken shell with the error visible
          // only in DevTools or the debug drawer. Stash the FIRST such error so
          // index.html can render a visible render-error panel in #widget-host
          // (and so automation can read a machine-readable signal). First write
          // wins: the original throw is the root cause; later cascade errors are
          // noise.
          if (w.__HARNESS_MOUNTING && !w.__HARNESS_RENDER_ERROR) {
            w.__HARNESS_RENDER_ERROR = {
              controller: w.__HARNESS_MOUNTING_CTRL || null,
              message: message,
              stack: stack,
            };
          }
        }
      } catch (_: unknown) {}
      $log.error.apply($log, Array.prototype.slice.call(arguments));
    };
  });

  // $q rejection-site tracing. AngularJS 1.x has no long stack traces, and
  // its "Possibly unhandled rejection: undefined" log is useless on its own
  // — you can't tell which deferred created the leaked promise. We decorate
  // $q.defer / $q.reject so every promise gets a creation-time stack stashed
  // in a WeakMap; $exceptionHandler above looks that up when an unhandled
  // rejection fires. Async-stack-trace flags don't help here because $q
  // isn't a native Promise.
  app.config(["$provide", function ($provide: angular.auto.IProvideService) {
    $provide.decorator("$q", ["$delegate", function ($delegate: angular.IQService): angular.IQService {
      const stacks: WeakMap<object, string> | null = (typeof WeakMap === "function") ? new WeakMap() : null;
      function captureStack(skipFn: Function): string | undefined {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- stack capture object
        const e: any = {};
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Error constructor has optional method
        const errorCtor = Error as any;
        if (errorCtor.captureStackTrace) errorCtor.captureStackTrace(e, skipFn);
        else { try { throw new Error(); } catch (x: unknown) { e.stack = (x as Error).stack; } }
        return e.stack;
      }
      function tag(promise: unknown, stack: string | undefined): unknown {
        if (!promise || !stack) return promise;
        try {
          if (stacks && typeof promise === "object") stacks.set(promise as object, stack);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- fallback property assignment for promise tracking
          else if (typeof promise === "object") (promise as any).__creationStack = stack;
        } catch (_: unknown) {}
        return promise;
      }

      const origDefer = $delegate.defer.bind($delegate);
      $delegate.defer = function harnessDefer<T>(): angular.IDeferred<T> {
        const d = origDefer() as angular.IDeferred<T>;
        const stack = captureStack(harnessDefer);
        tag(d.promise, stack);
        return d;
      };

      const origReject = $delegate.reject.bind($delegate);
      $delegate.reject = function harnessReject(reason: unknown): angular.IPromise<never> {
        const p = origReject(reason);
        const stack = captureStack(harnessReject);
        tag(p, stack);
        // Also key by the rejection reason so $exceptionHandler can find it
        // when AngularJS later reports the unhandled rejection.
        try {
          if (stacks && reason && typeof reason === "object" && stack) stacks.set(reason as object, stack);
        } catch (_: unknown) {}
        return p;
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- window augmentation for harness globals
      const w = window as any;
      w.__harnessQ = {
        lookup: function (key: unknown): string | null {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- fallback property access for promise tracking
          if (!stacks) return (key && (key as any).__creationStack) || null;
          try { return (typeof key === "object" && key ? stacks.get(key as object) : null) || null; } catch (_: unknown) { return null; }
        },
      };

      return $delegate;
    }]);

    // Backfill system-settings lightmode flags. csGrid reads
    // `settingsService.getSystem()` then UNCONDITIONALLY dereferences
    // `publicValues.lightmode.enable` (and `overrideLightMode.enable`) to set
    // `gridOptions.lightMode`. A box that never configured those keys (e.g. the
    // local dev box) resolves a publicValues WITHOUT them, so every grid widget
    // throws "Cannot read properties of undefined (reading 'enable')" and never
    // gets a lightMode → cells render un-themed (washed-out text). Inject the
    // keys when absent so the grid themes itself to match the harness chrome
    // (light theme => lightMode; dark/navy => dark mode).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- $delegate is opaque SOAR service
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- $delegate is opaque SOAR service
    $provide.decorator("settingsService", ["$delegate", function ($delegate: any): any {
      const orig = $delegate.getSystem;
      if (typeof orig !== "function") return $delegate;
      $delegate.getSystem = function () {
        const p = orig.apply($delegate, arguments);
        if (!p || typeof p.then !== "function") return p;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- SOAR API response is unknown
        return p.then(function (res: any): any {
          const pv = res && res.publicValues;
          if (pv) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- window augmentation for harness globals
            const w = window as any;
            const lightChrome = (w.__HARNESS_THEME_ID || "dark") === "light";
            if (!pv.lightmode) pv.lightmode = { enable: lightChrome };
            if (!pv.overrideLightMode) pv.overrideLightMode = { enable: false };
          }
          return res;
        });
      };
      return $delegate;
    }]);
  }]);

  // `config` is normally provided by the widget template service on the host
  // page. In the harness it's read from window.__HARNESS_CONFIG, which the
  // boot page rewrites before each angular.bootstrap (initial mount, edit
  // modal open, post-save remount). Registered as a factory so each injector
  // pulls the current global instead of the snapshot at module load.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic config object
  regFactory(app, "config", [], function (): any {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- window augmentation for harness globals
    const w = window as any;
    return w.__HARNESS_CONFIG || { title: "(harness)", defaultTemplate: "" };
  });

  // Seed $rootScope.theme so widgets that read it at init time (before the
  // dropdown's post-bootstrap change event fires) get the right value.
  // window.__HARNESS_THEME_ID is set by index.html just before loadScript.
  // Preload module metadata so widgets that call modelMetadatasService.getMetadataByModuleType
  // (Entity, csChart, csCardCount, etc.) find "alerts", "incidents", etc. in localStorage.
  // SOAR's appInitializeService normally drives this on login; the harness skips that path,
  // so we trigger it directly. Failures are logged but non-fatal — widgets that don't need
  // metadata still work.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- modelMetadatasService is SOAR service with dynamic metadata
  app.run(["modelMetadatasService", "$log", function (modelMetadatasService: any, $log: angular.ILogService): void {
    try {
      modelMetadatasService.loadAllModules(true).then(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- window augmentation for harness globals
        function (): void { const w = window as any; w.__HARNESS_MMD_LOADED = true; },
        function (e: unknown): void { $log.warn("[harness] loadAllModules failed", e); }
      );
    } catch (e: unknown) { $log.warn("[harness] loadAllModules threw", e); }
  }]);

  // SOAR's app/components/form/fields/input.html uses interpolation in
  // attribute values (`placeholder="{{ ::placeholder }}"`,
  // `class="... {{ value.length>0 ? ... : '' }} ..."`). When that template is
  // fetched at runtime in the harness and compiled into a cs-field instance
  // through cs-connector-field-renderer, the {{}}/`::` binds end up frozen
  // as literal text in the rendered DOM (the input shows "{{ ::placeholder }}"
  // verbatim). Real SOAR ships these templates pre-compiled into
  // $templateCache, sidestepping the timing issue. Mirror that by stuffing a
  // clean variant into the cache before any cs-field directive resolves it.
  app.run(["$templateCache", function ($templateCache: angular.ITemplateCacheService): void {
    const cleanInput = [
      '<div class="display-flex">',
      '  <input',
      '    type="text"',
      '    class="form-control"',
      '    data-ng-attr-id="{{formName + \'-\' + field.name}}"',
      '    data-ng-attr-name="{{field.name}}"',
      // Bind to the csField isolate scope's `value` directly. SOAR's real
      // template uses `$parent.value`, which works there because of how
      // SOAR's csField host element is wrapped — inside cs-conditional in
      // the harness, `$parent.value` resolves up to cs-conditional's own
      // ngModel (the whole customFilters object), so the input renders
      // "[object Object]". `value` (the local isolate-scope binding) is
      // always the per-row value regardless of nesting.
      '    data-ng-model="value"',
      '    data-ng-required="field.required"',
      '    data-ng-readonly="disabled"',
      '    data-ng-attr-placeholder="{{placeholder}}"',
      '    data-ng-change="changeMethod(value, field)"',
      '    data-ng-blur="blurMethod(value)"',
      '    autocomplete="off"',
      '    spellcheck="false" />',
      '</div>',
    ].join("");
    // Cover both keying conventions; $templateRequest normalizes against
    // <base href> but the lookup key is the raw URL passed in.
    $templateCache.put("app/components/form/fields/input.html", cleanInput);
    $templateCache.put("/app/components/form/fields/input.html", cleanInput);
  }]);

  app.run(["$rootScope", function ($rootScope: angular.IRootScopeService): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- window augmentation for harness globals
    const w = window as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic theme assignment
    ($rootScope as any).theme = { id: w.__HARNESS_THEME_ID || "dark" };
    // window.__HARNESS_RECORD is the current View Panel / Drawer record, set
    // by index.html before bootstrap. Exposed on $rootScope so widgets that
    // walk parent scopes for `record` find it the same way they do in SOAR.
    if (w.__HARNESS_RECORD) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic record assignment
      ($rootScope as any).record = w.__HARNESS_RECORD;
    }
    // SOAR view-panel / dashboard hosts pass a `model` to the widget mount
    // — chart widgets read `$scope.$parent.model.type` to pick translation
    // scope. In the harness the widget is mounted with no wrapping
    // controller, so $parent IS $rootScope; expose `model` there. Prefer
    // the loaded record (it carries `.type`); fall back to a minimal stub
    // built from the module selector so dashboard context still works.
    const moduleType: string =
      (w.__HARNESS_RECORD && w.__HARNESS_RECORD.type) ||
      (w.__HARNESS_STATE && w.__HARNESS_STATE.params && w.__HARNESS_STATE.params.module) ||
      w.__HARNESS_MODULE ||
      "alerts";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic model assignment
    ($rootScope as any).model = w.__HARNESS_RECORD || { type: moduleType };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic model type assignment
    if (!($rootScope as any).model.type) ($rootScope as any).model.type = moduleType;
    // Most widget controllers inject `config` (counter, actionRenderer …), but
    // some read `$scope.config` directly — in SOAR the widget directive sets it
    // on the widget scope before the controller runs. The harness mounts via a
    // bare ng-controller/ng-include, so expose config on $rootScope; the
    // widget's child scope inherits it down the prototype chain. Without this,
    // such controllers throw "Cannot read properties of undefined" at init
    // (e.g. jsonToGrid's loadGriOptions reads $scope.config on boot).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic config assignment
    ($rootScope as any).config = w.__HARNESS_CONFIG || ($rootScope as any).config;
    // Mimic the resolve map that $uibModal.open populates on a modal's scope.
    // SOAR widget edit controllers read `$scope.$resolve.widget` (and the
    // matching widgetBasePath) to derive the `<name>-<version>` slug for
    // translation/asset lookups. Without this, controllers throw
    // "Cannot read properties of undefined (reading 'widget')" at boot.
    if (w.__HARNESS_WIDGET) {
      const widgetRef = w.__HARNESS_WIDGET;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic resolve map assignment
      ($rootScope as any).$resolve = {
        widget: { name: widgetRef.name, version: widgetRef.version },
        widgetBasePath: "widgets/installed/" + widgetRef.name + "-" + widgetRef.version + "/",
      };
    }
  }]);

  // Wrap translationService.instantTranslate so widget-local keys (loaded into
  // window.__HARNESS_TRANSLATIONS by the harness before bootstrap) resolve
  // even when the real SOAR translation tables don't know about them. The
  // widget's widgetUtilityService.translate() delegates to translationService
  // when present, so without this it returns the raw key string.
  app.run(["$injector", function ($injector: angular.auto.IInjectorService): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- translationService is optional SOAR service
    let ts: any; // eslint-disable-line @typescript-eslint/no-explicit-any -- optional service handle
    try { ts = $injector.get("translationService"); } catch (_: unknown) { return; }
    if (!ts || typeof ts.instantTranslate !== "function" || ts.__harnessWrapped) return;
    const orig = ts.instantTranslate.bind(ts);
    ts.instantTranslate = function (key: unknown, params: unknown): unknown {
      const hit = harnessTranslateLookup(key);
      if (typeof hit === "string" && hit !== key) {
        if (params && hit.indexOf("{{") !== -1) {
          try { return $injector.get("$interpolate")(hit)(params); } catch (_: unknown) { return hit; }
        }
        return hit;
      }
      return orig(key, params);
    };
    ts.__harnessWrapped = true;
  }]);

  // widgetUtilityService — SOAR ships this as part of the widget loader
  // pipeline (slug derivation + per-widget translation bundle loading).
  // The harness merges widget locales globally in index.html, so
  // checkTranslationMode just needs to resolve.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic service return type
  regFactory(app, "widgetUtilityService", ["$q"], function ($q: angular.IQService): any {
    return {
      getWidgetNameVersion: function (widget: unknown, _basePath: unknown): string | null {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- widget parameter is dynamically typed
        if (!widget || !(widget as any).name || !(widget as any).version) return null;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- widget parameter is dynamically typed
        return (widget as any).name + "-" + (widget as any).version;
      },
      checkTranslationMode: function (): angular.IPromise<boolean> { return $q.when(true); },
      translate: function (key: unknown): unknown { return harnessTranslateLookup(key); },
    };
  });

  // widgetBasePath — SOAR injects this into VIEW widget controllers as the
  // per-widget asset root ("widgets/installed/<name>-<version>/"), used to
  // build templateUrls for widgetAssets/ HTML (e.g. jsonToGrid's expandable
  // row + input-variables modals). Edit controllers get it via the modal
  // $resolve map above; view controllers inject it directly, so register it
  // as a factory too. Resolves off the mounted widget; falls back to the
  // bare install root before a widget is selected.
  regFactory(app, "widgetBasePath", [], function (): string {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- window augmentation for harness globals
    const w = window as any;
    const widget = w.__HARNESS_WIDGET;
    return widget && widget.name && widget.version
      ? "widgets/installed/" + widget.name + "-" + widget.version + "/"
      : "widgets/installed/";
  });

  // ui.router is NOT bundled in app.unmin.js (it's a vendor dep we stripped),
  // so $state has no real source. Stub it for the harness.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic $state stub
  regFactory(app, "$state", [], function (): any {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- window augmentation for harness globals
    const w = window as any;
    // SOAR's csChart link passes $state.params.page through $interpolate,
    // which throws on undefined. Provide a default page name; the harness
    // page selector can override via window.__HARNESS_STATE.
    return (
      w.__HARNESS_STATE || {
        current: { name: "main.dashboard" },
        params: { page: "dashboard" },
        go: function (): void {},
      }
    );
  });

  // $stateParams is also ui.router's (stripped). csGrid injects it directly
  // (`$stateParamsProvider <- $stateParams <- csGridDirective`); without a stub
  // every grid widget fails to construct the directive ($injector:unpr) so
  // ui-grid never initializes and gridApi is never registered. Mirror the
  // params from the $state stub so the two stay consistent.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic $stateParams stub
  regFactory(app, "$stateParams", [], function (): any {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- window augmentation for harness globals
    const w = window as any;
    return (w.__HARNESS_STATE && w.__HARNESS_STATE.params) || { page: "dashboard" };
  });

  // Entity and CommonUtils ARE provided by app.unmin.js (registered against
  // cybersponse via .factory) — don't stub here.

  // angular-clipboard — vendor stripped. CommonUtils injects `clipboard`.
  interface ClipboardService {
    supported: boolean;
    copyText(text: string): void;
    toClipboard(text: string): void;
  }

  regFactory(app, "clipboard", ["$window"], function ($window: angular.IWindowService): ClipboardService {
    return {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- navigator.clipboard is not in AngularJS types
      supported: !!($window.navigator && ($window.navigator as any).clipboard),
      copyText: function (text: string): void {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- navigator.clipboard is not in AngularJS types
        if ($window.navigator && ($window.navigator as any).clipboard) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- navigator.clipboard is not in AngularJS types
          ($window.navigator as any).clipboard.writeText(text);
        }
      },
      toClipboard: function (text: string): void { this.copyText(text); },
    };
  });

  // ui.bootstrap ($uibModal) — vendor module stripped. Stub returns a
  // never-resolving modal; widgets that try to .open one in the harness
  // will silently no-op (acceptable for our mount-and-render scope).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic $uibModal stub
  regFactory(app, "$uibModal", ["$q"], function ($q: angular.IQService): any {
    return {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- promise-like stub return
      open: function (): any {
        const d = $q.defer();
        return { result: d.promise, opened: $q.when(true), rendered: $q.when(true), closed: d.promise, dismiss: function(){}, close: function(){} };
      },
    };
  });

  // angular-translate `translate` filter — used heavily in SOAR templates
  // (`{{ "APP.LABEL.X" | translate }}` and `'K' | translate: { p: v }`).
  // Looks up the dotted/flat key in __HARNESS_TRANSLATIONS, then interpolates
  // any `{{paramName}}` placeholders in the resolved string against the
  // supplied params map. Without param interpolation, strings like
  // COMPONENTS.FORM.TYPEAHEAD.MULTI_SELECT_DROPDOWN render literal `{{ ... }}`
  // through ng-bind-html (which does not compile expressions).
  function harnessTranslateLookup(key: unknown): unknown {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- window augmentation for harness globals
    const w = window as any;
    const dict = w.__HARNESS_TRANSLATIONS || {};
    let keyStr: unknown = key;
    if (Array.isArray(keyStr)) keyStr = keyStr[0];
    if (typeof keyStr !== "string") return keyStr;
    if (typeof dict[keyStr] === "string") return dict[keyStr];
    let node: unknown = dict;
    const parts = keyStr.split(".");
    for (let i = 0; i < parts.length; i++) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic property access
      if (node && typeof node === "object" && parts[i] in (node as any)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic property access
        node = (node as any)[parts[i]];
      } else { return keyStr; }
    }
    return (typeof node === "string") ? node : keyStr;
  }
  // Resolve `{{ expr }}` placeholders against a params map. Uses Angular's
  // own `$interpolate` so semantics match SOAR exactly — most notably,
  // undefined sub-expressions (e.g. `value.display` when value is empty)
  // coerce to "" instead of the JS string "undefined" that Function-eval
  // produces. Falls back to "" on any parse error.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic translate filter
  app.filter("translate", ["$interpolate", function ($interpolate: angular.IInterpolateService): any {
    const f = function (key: unknown, params: unknown): unknown {
      const str = harnessTranslateLookup(key);
      if (typeof str !== "string" || str.indexOf("{{") === -1) return str;
      try { return $interpolate(str)(params || {}); } catch (_: unknown) { return ""; }
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Angular filter metadata
    (f as any).$stateful = false;
    return f;
  }]);

  // angular-translate ($translate) — vendor module stripped. SOAR's
  // translationService -> statusCodeService -> Entity -> CommonUtils chain
  // injects it. Identity stub: returns the key (or first element if array).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic $translate stub
  regFactory(app, "$translate", ["$q", "$interpolate"], function ($q: angular.IQService, $interpolate: angular.IInterpolateService): any {
    // Same lookup + Angular-semantics param interpolation as the filter above.
    function id(k: unknown, params: unknown): unknown {
      const str = harnessTranslateLookup(k);
      if (typeof str !== "string" || str.indexOf("{{") === -1) return str;
      try { return $interpolate(str)(params || {}); } catch (_: unknown) { return ""; }
    }
    function translate(k: unknown, params: unknown): angular.IPromise<unknown> { return $q.when(id(k, params)); }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic method attachment
    (translate as any).instant = function (k: unknown, params: unknown): unknown { return id(k, params); };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic method attachment
    (translate as any).use = function (): string { return "en"; };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic method attachment
    (translate as any).refresh = function (): angular.IPromise<boolean> { return $q.when(true); };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic method attachment
    (translate as any).proposedLanguage = function (): null { return null; };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic method attachment
    (translate as any).preferredLanguage = function (): string { return "en"; };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic method attachment
    (translate as any).fallbackLanguage = function (): string { return "en"; };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic method attachment
    (translate as any).storageKey = function (): string { return "NG_TRANSLATE_LANG_KEY"; };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic method attachment
    (translate as any).onReady = function (): angular.IPromise<boolean> { return $q.when(true); };
    return translate;
  });

  // LocalStorageModule (vendor) was stripped from the dep array, so its
  // localStorageService isn't registered. SOAR's CommonUtils -> appModulesService
  // injects it. Back it with window.localStorage.
  interface LocalStorageServiceInterface {
    get(k: string): unknown;
    set(k: string, v: unknown): boolean;
    remove(k: string): boolean;
    clearAll(): void;
    keys(): string[];
    length(): number;
    isSupported: boolean;
    getStorageType(): string;
    setStorageType(): string;
    cookie: { isSupported: boolean; set(): void; get(): void; remove(): void };
    deriveKey(k: string): string;
  }

  regFactory(app, "localStorageService", ["$window"], function ($window: angular.IWindowService): LocalStorageServiceInterface {
    const ls = $window.localStorage;
    const prefix = "cs.";
    function key(k: string): string { return prefix + k; }
    return {
      get: function (k: string): unknown { try { const v = ls.getItem(key(k)); return JSON.parse(v || ""); } catch { return ls.getItem(key(k)); } },
      set: function (k: string, v: unknown): boolean { ls.setItem(key(k), typeof v === "string" ? v : JSON.stringify(v)); return true; },
      remove: function (k: string): boolean { ls.removeItem(key(k)); return true; },
      clearAll: function (): void { /* harness no-op: avoid nuking unrelated keys */ },
      keys: function (): string[] {
        const out: string[] = [];
        for (let i = 0; i < ls.length; i++) {
          const n = ls.key(i);
          if (n && n.indexOf(prefix) === 0) out.push(n.slice(prefix.length));
        }
        return out;
      },
      length: function (): number { return this.keys().length; },
      isSupported: true,
      getStorageType: function (): string { return "localStorage"; },
      setStorageType: function (): string { return "localStorage"; },
      cookie: { isSupported: false, set: function(){}, get: function(){}, remove: function(){} },
      deriveKey: key,
    };
  });

  // Cryptography eagerly reads $window.CryptoJS.enc.Hex.parse(...) at factory
  // instantiation (app.unmin.js:46952), so any service that injects it —
  // tokenService -> websocketService -> playbookService — fails to instantiate
  // in the harness with "Cannot read properties of undefined (reading 'enc')".
  // We don't need real crypto in the harness (the proxy handles auth), so
  // override with a passthrough stub. The TOKEN cache in localStorage is
  // irrelevant here.
  interface CryptographyService {
    encrypt(v: unknown): unknown;
    decrypt(v: unknown): unknown;
    setAuthToken(v: unknown): void;
    getAuthToken(): unknown;
    updateAuthToken(): void;
  }

  regFactory(app, "Cryptography", [], function (): CryptographyService {
    let t: unknown;
    const api: CryptographyService = {
      encrypt: function (v: unknown): unknown { return v; },
      decrypt: function (v: unknown): unknown { return v; },
      setAuthToken: function (v: unknown): void { t = v; },
      getAuthToken: function (): unknown { return t; },
      updateAuthToken: function (): void {},
    };
    return api;
  });

  interface ToasterService {
    success(o: unknown): void;
    error(o: unknown): void;
    warning(o: unknown): void;
    info(o: unknown): void;
  }

  regFactory(app, "toaster", [
    "$document",
  ], function ($document: any): ToasterService { // eslint-disable-line @typescript-eslint/no-explicit-any -- $document is AngularJS service
    function pop(kind: string, opts: unknown): void {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- opts is dynamically typed
      const body = (opts && (opts as any).body) || "";
      console.log(`[toaster.${kind}] ${body}`);
      const doc = ($document[0] || $document) as Document;
      const tray = doc.getElementById("harness-toasts");
      if (!tray) return;
      const el = doc.createElement("div");
      el.className = `harness-toast harness-toast-${kind}`;
      el.textContent = `${kind.toUpperCase()}: ${body}`;
      tray.appendChild(el);
      setTimeout(() => el.remove(), 3500);
    }
    return {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- toast message can be any type
      success: (o: unknown): void => pop("success", o),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- toast message can be any type
      error: (o: unknown): void => pop("error", o),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- toast message can be any type
      warning: (o: unknown): void => pop("warning", o),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- toast message can be any type
      info: (o: unknown): void => pop("info", o),
    };
  });

  // Stub for the angular-ui-bootstrap modal instance. In SOAR, edit forms run
  // inside a $uibModal, so their controllers inject $uibModalInstance and
  // call .close()/.dismiss() to wire up the bootstrap modal Save/Cancel
  // buttons. The harness exposes its own Save/Cancel in the modal chrome,
  // so these stubs are no-ops — Save/Cancel in the harness toolbar drives
  // the persist + remount path instead.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic $uibModalInstance stub
  regFactory(app, "$uibModalInstance", [], function (): any {
    return {
      close: function (): void {},
      dismiss: function (): void {},
      result: { then: function (): void {}, catch: function (): void {} },
    };
  });

  // Entity and CommonUtils intentionally NOT stubbed — SOAR's app.unmin.js
  // registers the real implementations. Re-add stubs only if a specific
  // method is missing and we don't want to load the upstream source.

  // Override SOAR's currentPermissionsService — the real one walks loaded user
  // RBAC data we don't bootstrap in the harness, so every availablePermission()
  // returns false and widgets toast "necessary permission" errors. Grant all.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic currentPermissionsService stub
  regFactory(app, "currentPermissionsService", [], function (): any {
    return {
      availablePermission: function (): boolean { return true; },
      availableFieldPermission: function (): boolean { return true; },
      // csGrid's link() calls isAdmin() during $digest; the real service derives
      // it from loaded RBAC the harness doesn't bootstrap. Grant admin to match
      // the "all permissions" stance above (else jsonToGrid throws
      // "isAdmin is not a function" and the grid never links).
      isAdmin: function (): boolean { return true; },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- promise-like stub return
      load: function (): any { return { then: function (cb: unknown): any { cb && (cb as Function)(); return this; }, catch: function(): any { return this; } }; },
      get: function (): object { return {}; },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- promise-like stub return
      loadCurrentUser: function (): any { return { then: function (cb: unknown): any { cb && (cb as Function)(); return this; }, catch: function(): any { return this; } }; },
      getPermissions: function (): object { return {}; },
      // csGrid's link() also calls getPermission(module, action) (singular) to
      // decide whether to show row actions; the real service reads unloaded
      // RBAC. Match the grant-all stance so the grid links instead of throwing
      // "getPermission is not a function" (surfaced by jsonToGrid once it
      // mounts and renders cs-grid).
      getPermission: function (): boolean { return true; },
    };
  });

  // Modules: provided by SOAR's app.unmin.js (real $resource-backed factory).
  // Earlier harness builds defined a hand-rolled $http stub here — removed
  // because it shadowed the real one and broke modelMetadatasService.

  // $resource: provided by the ngResource vendor module loaded in index.html
  // and listed in HARNESS_VENDOR_DEPS. Don't stub here — would shadow the
  // real implementation and break $resource(API.QUERY+...).save() calls.

  // chartService: real implementation lives in the c3charts widgetAssets/
  // bundle that SOAR loads at runtime; the harness doesn't load widget
  // assets, so register a stub that satisfies the injector.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic chartService stub
  regFactory(app, "chartService", ["$q"], function ($q: angular.IQService): any {
    return {
      buildAggregationQuery: function (): object { return {}; },
      formatChartData: function (): object { return { data: { columns: [], type: "pie" } }; },
      getRelatedModules: function (): angular.IPromise<unknown[]> { return $q.resolve([]); },
      getFieldMetadata: function (): angular.IPromise<null> { return $q.resolve(null); },
    };
  });

  regFactory(app, "dynamicValueService", [
    "$http",
  ], function ($http: angular.IHttpService): any { // eslint-disable-line @typescript-eslint/no-explicit-any -- dynamic dynamicValueService stub
    return {
      evaluateJinja(jinja: unknown): angular.IPromise<unknown> {
        return $http
          .post("/api/wf/api/jinja-editor/?format=json", jinja)
          .then((r: angular.IHttpResponse<unknown>): unknown => r.data);
      },
      // Real SOAR's dynamicValueService exposes these jinja helpers; the
      // cs-typeahead directive (used by the cs-conditional value picker)
      // calls isJinjaConvertibleToTag during link, so without the stub
      // every typeahead-backed field throws "isJinjaConvertibleToTag is
      // not a function" and won't render its value picker. Returning
      // false means "not jinja-convertible" — same default behavior as
      // when the user hasn't enabled jinja-to-tag globally.
      isJinjaConvertibleToTag(_value: unknown): boolean { return false; },
      isJinja(value: unknown): boolean {
        return typeof value === "string" &&
          (value.indexOf("vars.") !== -1 || value.indexOf("globalVars.") !== -1 ||
           value.indexOf("{{") !== -1 || value.indexOf("{%") !== -1);
      },
    };
  });

  // csJsonEditor, csSpinner, monacoEditor directives intentionally NOT
  // registered here — they are all defined by app.unmin.js and registering
  // them again triggers $compile:multidir on isolated-scope directives.
  // Use SOAR\'s real implementations instead (more realistic anyway).

  // DEPRECATED: ui.bootstrap (loaded from CDN) provides real uibDropdown,
  // uibDropdownToggle, uibDropdownMenu directives + uibPopover. Removing the
  // harness shims here so the real implementations take over. The ui-bootstrap
  // CSS + JS are loaded in index.html and ui.bootstrap is listed in
  // HARNESS_VENDOR_DEPS so cybersponse can inject its providers.

  // Stand-in for SOAR's `dynamicValueChooser` directive, used heavily in
  // edit forms to let users pick fields off the current record. Real SOAR
  // pops a tree picker; the harness gives a textarea bound two-way to the
  // model so dev users can type Jinja-style expressions like
  // {{vars.input.records[0].source.host}} and exercise the round-trip.

  // moduleAttribute provider: SOAR's bundle calls .attribute(name, def) for
  // ~45 field types via .config() blocks on cybersponse. In the harness those
  // config blocks aren't running (likely because of how we patch the dep
  // array), leaving the registry empty — csField then can't resolve any
  // field type and renders nothing for filter values, etc. Re-populate the
  // `types` map post-bootstrap; the service hands out the same reference,
  // so mutating it is enough.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- moduleAttribute is SOAR service with dynamic registry
  app.run(["moduleAttribute", function (moduleAttribute: any): void {
    if (!moduleAttribute || !moduleAttribute.types) return;
    if (Object.keys(moduleAttribute.types).length > 0) return; // real config ran
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- FIELD_DEFS is array of tuple arrays from dynamic SOAR field registry
    const FIELD_DEFS: any[] = [
      ["text",                    "text",            "string",   "app/components/form/fields/input.html"],
      ["password",                "password",        "string",   "app/components/form/fields/password.html"],
      ["checkbox",                "checkbox",        "boolean",  "app/components/form/fields/checkbox.html"],
      ["checkbox.select",         "",                "",         "app/components/form/fields/checkbox.select.html"],
      ["integer",                 "integer",         "integer",  "app/components/form/fields/integer.html"],
      ["decimal",                 "decimal",         "number",   "app/components/form/fields/number.html"],
      ["datetime",                "datetime",        "integer",  "app/components/form/fields/datetime.html"],
      ["datetime.advance",        "",                "",         "app/components/form/fields/datetime.advance.html"],
      ["datetime.quick",          "",                "",         "app/components/form/fields/datetime.quick.html"],
      ["datetime.grid",           "",                "",         "app/components/form/fields/datetime.grid.html"],
      ["datetime.defaultValue",   "",                "",         "app/components/form/fields/datetime.defaultValue.html"],
      ["datetime.playbook",       "",                "",         "app/components/form/fields/datetime.playbook.html"],
      ["phone",                   "phone",           "string",   "app/components/form/fields/phone.html"],
      ["email",                   "email",           "string",   "app/components/form/fields/email.html"],
      ["dynamicList",             "dynamicList",     "array",    "app/components/form/fields/dynamicList.html"],
      ["select",                  "select",          "select",   "app/components/form/fields/select.html"],
      ["select.input",            "select",          "string",   "app/components/form/fields/selectInput.html"],
      ["jinja.input",             "text",            "string",   "app/components/form/fields/input.html"],
      ["array",                   "text",            "string",   "app/components/form/fields/input.html"],
      ["multiselect",             "multiselect",     "string",   "app/components/form/fields/multiselect.html"],
      ["file",                    "file",            "string",   "app/components/form/fields/file.html"],
      ["richtext",                "richtext",        "string",   "app/components/form/fields/markdownEditor.html"],
      ["html",                    "html",            "string",   "app/components/form/fields/htmlEditor.html"],
      ["json",                    "textarea",        "string",   "app/components/form/fields/json.html"],
      ["object",                  "object",          "object",   "app/components/form/fields/json.html"],
      ["textarea",                "textarea",        "string",   "app/components/form/fields/textarea.html"],
      ["image",                   "image",           "",         "app/components/form/fields/image.html"],
      ["picklist",                "picklist",        "picklists","app/components/form/fields/typeahead.html"],
      ["multiselectpicklist",     "multiselectpicklist","picklists","app/components/form/fields/typeahead.multiselect.html"],
      ["picklist.multi",          "",                "",         "app/components/form/fields/picklist.multi.html"],
      ["lookup",                  "lookup",          "",         "app/components/form/fields/typeahead.html"],
      ["oneToMany",               "oneToMany",       "",         ""],
      ["manyToMany",              "manyToMany",      "",         "app/components/form/fields/typeahead.multiselect.html"],
      ["toManyList",              "manyToMany",      "",         "app/components/form/fields/typeahead.multiselect.html"],
      ["relationshipFields.playbook","",             "",         "app/components/form/fields/input.html"],
      ["label",                   "label",           "string",   "app/components/form/fields/label.html"],
      ["domain",                  "domain",          "string",   "app/components/form/fields/webAddress.html"],
      ["url",                     "url",             "string",   "app/components/form/fields/url.html"],
      ["filehash",                "filehash",        "string",   "app/components/form/fields/fileHash.html"],
      ["livesync",                "livesync",        "",         "app/components/form/fields/livesync.html"],
      ["tags",                    "tags",            "tags",     "app/components/form/tags/tags.html"],
      ["certificate",             "certificate",     "string",   "app/components/form/fields/certificate.html"],
      ["date",                    "date",            "integer",  "app/components/form/fields/date.html"],
      ["codeEditor",              "codeEditor",      "codeEditor","app/components/form/fields/codeEditor.html"],
      ["emailTemplate",           "emailTemplate",   "string",   "app/components/form/fields/emailTemplate.html"],
    ];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- field definition tuples
    FIELD_DEFS.forEach(function (def: any): void {
      moduleAttribute.types[def[0]] = {
        formType: def[1] || def[0],
        type: def[2],
        templateUrl: def[3],
        usable: true,
        mmdUpdate: true,
      };
    });
    console.log("[harness.module.js] populated moduleAttribute.types with", FIELD_DEFS.length, "field defs");
  }]);

  app.directive("dynamicValueChooser", function (): angular.IDirective {
    return {
      restrict: "EA",
      scope: { ngModel: "=", placeholder: "@?" },
      template:
        '<textarea class="harness-dvc form-control" rows="2" ' +
        '          ng-model="ngModel" ' +
        '          placeholder="{{ placeholder || \'{{ jinja or record.path }}\' }}">' +
        "</textarea>",
    };
  });

})();
