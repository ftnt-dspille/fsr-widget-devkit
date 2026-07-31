---
title: "FortiSOAR AngularJS Widget Development -- Knowledgebase"
topics: [angularjs, forti soar, widget, knowledgebase]
category: widget-dev
status: canonical
summary: "Index + conceptual core for building FortiSOAR 7.x AngularJS widgets. Deep reference topics (services, directives, drawer, connector-action-UI, platform-source) live in fortisoar-widget-harness/docs/kb/."
---

# FortiSOAR AngularJS Widget Development -- Knowledgebase

Comprehensive reference for building FortiSOAR 7.x widgets. Derived from:

- `FortiSOAR-7.6.5-Widget_Development.pdf` (authoritative guide)
- Deep analysis of 60 certified widgets in `widgets-extracted/`
- Online service API index: <https://fortisoar.contenthub.fortinet.com/widgetServiceAPI/>

> **Scope.** Widgets are AngularJS 1.x components rendered inside the FortiSOAR SPA (module `cybersponse`). You cannot use Angular 2+/React/Vue. You inherit the host's injectors, directives, filters, theme variables, CSS, and WebSocket channel.

---

## Table of Contents

1. [Mental model](#1-mental-model) -- Where widgets live: edit-time vs run-time, host module `cybersponse`.
2. [Widget anatomy](#2-widget-anatomy) -- Widget folder layout: info.json, view.html, view.controller.js, edit.*, assets.
3. [`info.json` schema](#3-infojson-schema) -- Complete info.json schema (config, enableFor, contexts, permissions, deps).
4. [Page contexts](#4-page-contexts) -- Page contexts: Dashboard, View Panel, Listing, Drawer -- where a widget can mount.
5. [Controllers](#5-controllers) -- View controller vs edit controller: roles, injection, lifecycle hooks.
6. [Edit form (`edit.html`) patterns](#6-edit-form-edithtml-patterns) -- edit.html form patterns: config collection, $uibModal close, validation.
7. [View template (`view.html`) patterns](#7-view-template-viewhtml-patterns) -- view.html template patterns: rendering config, host scope, common directives.
8. [Services catalog](#8-services-catalog) -- Platform services catalog. → full ref in docs/kb/services-catalog.md
9. [Directives catalog](#9-directives-catalog) -- Platform directives catalog. → full ref in docs/kb/directives-catalog.md
10. [Filters](#10-filters) -- AngularJS filters the platform provides.
11. [Querying data](#11-querying-data) -- Querying data: Query, PagedCollection, Entity, Modules.
12. [Current record (View Panel context)](#12-current-record-view-panel-context) -- Accessing the current record in View Panel context.
13. [`config.mapping` convention](#13-configmapping-convention) -- The config.mapping field-mapping convention.
14. [Theme awareness](#14-theme-awareness) -- Theme awareness ($rootScope.theme) + CSS variables.
15. [WebSocket subscriptions](#15-websocket-subscriptions) -- WebSocket subscriptions for real-time updates.
16. [AngularJS events](#16-angularjs-events) -- AngularJS events: $emit/$broadcast/$on contract.
17. [Wizards (`WizardHandler`)](#17-wizards-wizardhandler) -- Wizard / multi-step widgets (WizardHandler).
18. [Drawer / non-modal widgets](#18-drawer-non-modal-widgets) -- Drawer / non-modal widgets (contexts, enableFor). → full ref in docs/kb/drawer-widgets.md
19. [Triggering playbooks](#19-triggering-playbooks) -- Triggering playbooks from a widget.
20. [Connectors](#20-connectors) -- Connector-driven data: connectorService, modelMetadatasService.
21. [Permissions](#21-permissions) -- Permissions: currentPermissionsService.
22. [External assets](#22-external-assets) -- External CDN / JS / CSS loading.
23. [Internationalisation (7.5.0+)](#23-internationalisation-750) -- Internationalisation: widgetUtility.service.js + locales/.
24. [Widget-to-widget communication](#24-widget-to-widget-communication) -- Widget-to-widget communication (broadcast events).
25. [Recipes](#25-recipes) -- Recipes -- scaffolds per widget type.
26. [Widget catalog](#26-widget-catalog) -- Widget catalog (60 certified widgets).
27. [Cheatsheets](#27-cheatsheets) -- Cheatsheets: what to reach for.
28. [Pitfalls](#28-pitfalls) -- Common pitfalls.
29. [Platform source references (host UI code)](#29-platform-source-references-host-ui-code) -- Platform source references (host UI code). -> full ref in docs/kb/platform-source-refs.md
30. [Building widgets that reuse SOAR's connector-action UI](#30-building-widgets-that-reuse-soars-connector-action-ui) -- Reusing SOAR's connector-action UI. → full ref in docs/kb/connector-action-ui.md
31. [Adding a custom theme to the SOAR system-settings dropdown](#31-adding-a-custom-theme-to-the-soar-system-settings-dropdown) -- Adding a custom theme to the SOAR system-settings dropdown.
32. [Harness gaps from the stripped SOAR bundle](#32-harness-gaps-from-the-stripped-soar-bundle) -- Harness gaps from the stripped SOAR bundle.
33. [Harness surfaces widget render errors (view + edit modal)](#33-harness-surfaces-widget-render-errors-view-edit-modal) -- Harness surfaces widget render errors (view + edit modal).
34. [Diagnosing "edit.html (or the whole widget) won't render" -- checklist](#34-diagnosing-edithtml-or-the-whole-widget-wont-render-checklist) -- Diagnosing 'edit.html won't render' checklist.
35. [Releasing a widget (GitHub release flow)](#35-releasing-a-widget-github-release-flow) -- Releasing a widget (GitHub release flow).
36. [Troubleshooting widget mount & render (harness + e2e)](#troubleshooting-widget-mount--render) -- Troubleshooting widget mount & render (harness + e2e).

**Appendices:**
- [Appendix A -- `API` constants](#appendix-a-api-constants)
- [Appendix B -- Field `formType` values](#appendix-b-field-formtype-values)

---


--- 36 narrative entries + 2 appendices ---

## 1. Mental model

A FortiSOAR widget is a **registered AngularJS controller + HTML template pair** that the platform instantiates inside a configurable slot. There are two lifecycles:

- **Edit-time** (`edit.html` + `edit.controller.js`): opened as a `$uibModal` when a user adds/edits the widget on a dashboard, Report, Listing, View Panel, etc. Collects a `config` object and closes with `$uibModalInstance.close($scope.config)`.
  - **Dual-mode edit controllers** (widget also renders its settings as an inline ng-include overlay, not only a `$uibModal`) must NOT list `config` in the static `$inject` array -- the `config` local only exists under `$uibModal`, so a static inject throws `unknownProvider` in overlay mode. Pull the saved config dynamically instead: `try { var c = $injector.get('config'); if (c) $scope.config = c; } catch(e){}`. The harness `edit-config-inject` lint recognizes this `$injector.get('config')` form as satisfying the persist requirement (`lib/harnessUtils.ts`); a controller that binds `ng-model="config.…"` but neither statically injects nor dynamically-gets `config` is still (correctly) blocked.
- **Run-time** (`view.html` + `view.controller.js`): rendered in-place on the host page. Receives `config` via injection and has access to the host's `$state`, `$rootScope`, the parent form (`FormEntityService`), the WebSocket, and all platform services.

You are working inside the host module:

```js
angular.module("cybersponse").controller("myWidget101Ctrl", ...);
```

Every non-trivial widget version embeds the `version` in the controller name (`myWidget101Ctrl` for version 1.0.1) so multiple versions of the same widget can coexist in one install. **This is a hard convention -- follow it.**

The platform loads the widget via its name + version path:

```
widgets/installed/<name>-<version>/widgetAssets/...
```

Asset references in `view.html` must use this prefix (see §7).

> **Gotcha -- harness lint blocks bootstrap on ANY stale version-string literal in the controller, including comments.** After bumping `info.json` (e.g. 1.0.47→1.0.48), the dev/test harness runs a `stale-version-ref` lint and *refuses to mount the widget* if `view.controller.js` contains the old `M.m.p` string anywhere -- even an example URL in a code comment. Symptom: every Playwright e2e times out at `waitForFunction(() => window.__<widget>__)` because the controller never boots; the harness error panel shows `Lint blocked widget bootstrap … [stale-version-ref] references stale version(s): 1.0.47`. The jest bootstrap slug test (`fsrSocAssistant1048DevCtrl`) does NOT catch this -- it only checks `…NNNNCtrl` tokens, not literal `1.0.47` dotted strings. Fix: grep the controller for the old dotted version and update every hit (comments included) in the same bump. **Better: never write the dotted version in the controller at all** -- derive it from the served script URL (`fortiaiAgenticAssistant` does this via `WIDGET_VERSION`) and use a `<version>` placeholder in comments. A jest guard (`triageDraft.export.test.js`: "controller never hardcodes the info.json WIDGET version") asserts `info.json.version` never appears literally in `view.controller.js`, so the footgun can't recur.

---

## 2. Widget anatomy

Minimum files:

```
<widgetName>/
├── info.json                 # Metadata, pages, contexts, compatibility
├── view.html                 # Runtime template (required)
├── view.controller.js        # Runtime controller (required)
├── edit.html                 # Edit-time template (required; may be a stub)
├── edit.controller.js        # Edit-time controller (required; may just close modal)
├── release_notes.md          # Optional but strongly recommended
├── images/
│   ├── <widget>_view.png     # Used in content hub preview
│   └── <widget>_edit.png
└── widgetAssets/             # All non-core files go here
    ├── css/<widget>.css
    ├── js/
    │   ├── widgetUtility.service.js   # Required for localized widgets (see §23)
    │   └── <widget>.service.js        # Optional: pull logic out of the controller
    ├── html/
    │   └── <partial>.html
    ├── images/...             # SVGs, logos, static assets
    └── locales/               # i18n JSON (see §23)
        ├── en.json
        ├── fr_fr.json
        ├── ja.json
        ├── ko.json
        ├── zh_cn.json
        └── zh_tw.json
```

Packaging is a tar-gzip: `<widgetName>-<version>.tgz` built over that directory. Every `.js`, `.css`, `.html` must carry the MIT copyright header (see §25).

---

## 3. `info.json` schema

This file drives **everything** -- where the widget is shown, whether it's modal, what compatibility banner it gets, and which controller the platform registers. Every field seen across the 60 certified widgets:

```jsonc
{
  "name": "myWidget",              // Kebabless camelCase. Becomes the path prefix & controller basename.
  "title": "My Widget",            // Shown in widget catalogs
  "subTitle": "One-line pitch.",   // Short description (note casing: subTitle)
  "version": "1.0.0",              // MAJOR.MINOR.PATCH (drives controller suffix: myWidget100Ctrl)
  "published_date": 1706787666,    // Unix seconds. Integer or numeric string -- both are accepted
  "releaseNotes": "available",     // "available" | "unavailable" -- hints UI to show the tab
  "development": false,            // Set true while iterating in Content Hub; false when shipping

  "metadata": {
    // ── Display & catalog ──────────────────────────────────────────────
    "description": "Long HTML or markdown description.",
    "publisher":   "Fortinet",     // Organization shown in Content Hub
    "certified":   "Yes",          // "Yes" | "No"
    "compatibility": ["7.2.0", "7.4.1", "7.6.0"],  // Min FortiSOAR versions the widget runs on
    "help_online": "https://github.com/.../release/1.0.0/README.md",
    "snapshots":  [ "<absolute URL to PNG>", "..." ],   // Preview images
    "logo":       "data:image/png;base64,...",          // Drawer/icon representation
    "category":   ["Machine Learning", "Utilities", "FortiSOAR Essentials"],

    // ── Where the widget is embeddable ─────────────────────────────────
    // Any combination of: "Dashboard", "Reports", "View Panel", "Listing",
    // "Add Form", "Settings" (rare). Empty array means "not a page widget"
    // (usually because contexts is set instead).
    "pages": ["Dashboard", "View Panel"],

    // ── Widget sizing / modal behavior ─────────────────────────────────
    "standalone":  true,           // Can be launched on its own (not embedded in a dashboard cell)
    "windowClass": "Full Width",   // "Full Width" | "Half Width" -- modal/drawer size
    "size":        "lg",           // Legacy: large widget grid cell

    // ── Drawer / non-modal contexts ────────────────────────────────────
    // See §18. Declares the widget can float outside any page cell.
    "contexts": ["drawer", "pb_designer", "header_navbar", "launch_on_boot"],

    // ── Drawer/standalone rendering properties ─────────────────────────
    // (Only relevant when contexts includes "drawer" or standalone = true.)
    "view": {
      "popup":       "custom",     // "custom" makes background interactive (non-blocking)
      "draggable":   true,         // Allow user to drag the floating window
      "activeBackground": true,    // Background not blurred
      "displayName": "FortiAI",    // Label next to the drawer icon; omit to show logo only
      "enableFor": [               // UI-Router state names where the drawer icon appears
        "main.modules.list",
        "viewPanel.modulesDetail",
        "main.playbookDetail",
        "main.marketplace.workspace",
        "main.dashboard"
      ]
    }
  }
}
```

### Key rules & common mistakes

- **`pages` vs. `contexts`.** A widget is placed on a dashboard/Report/View Panel/Listing through `pages`. It floats as a drawer/launcher through `contexts`. A widget can use both (e.g., show on View Panel *and* have a drawer icon).
- **`compatibility`** is a *list*, not a range. Include each supported major.minor you've tested.
- **`subTitle`** -- note the capital `T`. A lowercase `subtitle` is silently ignored.
- **`published_date`** -- integer seconds. Some older widgets store it as a numeric string; both work.
- **`name`** must match the top-level folder name inside the tarball. The platform uses `name-version` as the path.
- **Controller suffix convention.** `name: "myWidget"`, `version: "1.0.0"` → register `myWidget100Ctrl` and `editMyWidget100Ctrl`. The platform expects this naming.
- **No `pages` at all** = widget isn't selectable in widget pickers. Settings-page widgets, drawer-only widgets, and widgets launched programmatically typically use `"pages": []`.
- **Snapshot URLs** must be absolute and publicly accessible. The Content Hub embeds them by URL.

### Minimal `info.json` for each common shape

```jsonc
// Dashboard chart
{ "name": "foo", "title": "Foo", "subTitle": "…", "version": "1.0.0",
  "published_date": 1700000000,
  "metadata": { "pages": ["Dashboard", "Reports"], "certified": "No", "publisher": "You",
                "compatibility": ["7.4.1"], "description": "…" } }

// View-Panel record widget
{ ..., "metadata": { "pages": ["View Panel"], ... } }

// Drawer / AI-assistant-style floating widget
{ ..., "metadata": { "pages": [],
                     "contexts": ["drawer"],
                     "standalone": true, "windowClass": "Half Width",
                     "view": { "popup": "custom", "draggable": true,
                               "displayName": "My Bot",
                               "enableFor": ["viewPanel.modulesDetail"] },
                     ... } }

// Full-screen standalone wizard (no page embedding)
{ ..., "metadata": { "pages": [], "standalone": true, "windowClass": "Full Width", ... } }
```

---

## 4. Page contexts

### 4.1 `pages` values

| Value | Where it appears | `config.module` meaning | Record access |
|---|---|---|---|
| `Dashboard` | Dashboard grid cell | Chosen by user at edit time | n/a -- widget loads its own data |
| `Reports` | Report templates | Chosen by user | n/a |
| `View Panel` | Record details pane | Record's own module (implicit) | `$state.params.module` / `$state.params.id` |
| `Listing` | Module list page header/footer | Module being listed | n/a (use PagedCollection on that module) |
| `Add Form` | Create-record dialog | Record being created | `FormEntityService.get()` |
| `Settings` | System Settings pane | -- | `$http`/`$resource` on system endpoints |

### 4.2 `contexts` values

| Value | Behavior |
|---|---|
| `drawer` | Icon in the right-hand drawer rail; opens as a floating non-modal panel |
| `pb_designer` | Icon inside the Playbook Designer's toolbar |
| `header_navbar` | Custom tile in the top-bar launcher (e.g., Setup Guide) |
| `launch_on_boot` | Launched automatically at app startup |

### 4.3 UI-Router state names (for `view.enableFor`)

| State | Page |
|---|---|
| `main.dashboard` | Dashboards |
| `main.modules.list` | Module listings (Alerts, Incidents, …) |
| `viewPanel.modulesDetail` | Record detail view |
| `main.playbookDetail` | Playbook designer detail |
| `main.marketplace.workspace` | Content Hub workspace |
| `main.reports` | Reports |

The widget's drawer icon is rendered on any state whose name **starts with** one of the values. `"main.modules.list"` matches both the listing and its child states.

### 4.4 Detecting the current context at runtime

```js
// Are we on the View Panel?
const isViewPanelPage = $state.current && $state.current.name.indexOf('viewPanel') !== -1;

// Are we on the Dashboard?
const page = $state.params.page;    // 'dashboard' | 'reporting' | …
// or
const isDashboard = $state.current.name === 'main.dashboard';
```

Chart widgets commonly branch their header CSS on `page === 'dashboard'` (see `recordCard-1.0.1/view.html:7-14`).

---

## 5. Controllers

### 5.1 Skeleton -- view controller

```js
/* Copyright start
   MIT License
   Copyright (c) 2025 Fortinet Inc
   Copyright end */
"use strict";
(function () {
  angular
    .module("cybersponse")
    .controller("myWidget100Ctrl", myWidget100Ctrl);

  // Explicit DI is mandatory -- minification will otherwise break the widget.
  myWidget100Ctrl.$inject = [
    '$scope', '$rootScope', '$state', '$timeout',
    'config', 'PagedCollection', 'Query',
    'appModulesService', 'currentPermissionsService'
  ];

  function myWidget100Ctrl(
    $scope, $rootScope, $state, $timeout,
    config, PagedCollection, Query,
    appModulesService, currentPermissionsService
  ) {
    $scope.config = config;       // Always keep config on $scope -- the template binds to it.
    $scope.processing = true;
    $scope.getList   = getList;   // Functions the template can call.

    function init() {
      const perms = currentPermissionsService.getPermission($scope.config.module);
      if (!perms.read) { $scope.unauthorized = true; return; }

      getList();
    }

    function getList() {
      const coll = new PagedCollection($scope.config.module, null,
                                       { $limit: $scope.config.query.limit });
      coll.query = new Query($scope.config.query);
      coll.loadGridRecord()
        .then(() => { $scope.fieldRows = coll.fieldRows; })
        .finally(() => { $scope.processing = false; });
    }

    $scope.$on('$destroy', function () { /* unsubscribe websockets, destroy charts, etc. */ });
    init();
  }
})();
```

### 5.2 Skeleton -- edit controller

```js
"use strict";
(function () {
  angular
    .module("cybersponse")
    .controller("editMyWidget100Ctrl", editMyWidget100Ctrl);

  editMyWidget100Ctrl.$inject = [
    '$scope', '$uibModalInstance', 'config',
    'appModulesService', 'Entity'
  ];

  function editMyWidget100Ctrl(
    $scope, $uibModalInstance, config,
    appModulesService, Entity
  ) {
    $scope.cancel = () => $uibModalInstance.dismiss('cancel');
    $scope.save   = save;
    $scope.loadAttributes = loadAttributes;

    function init() {
      const defaults = { mapping: { cardTitle: null, subtitle: null }, query: { limit: 10 } };
      $scope.config = angular.extend({}, defaults, config);

      appModulesService.load(true).then((mods) => {
        $scope.modules = mods;
        if ($scope.config.module) loadAttributes();
      });
    }

    function loadAttributes() {
      const entity = new Entity($scope.config.module);
      entity.loadFields().then(() => {
        $scope.fields       = entity.getFormFields();
        $scope.fieldsArray  = entity.getFormFieldsArray();
        $scope.pickListFields = Object.values(entity.fields)
                                      .filter(f => f.type === 'picklist');
      });
    }

    function save() {
      if ($scope.editMyWidgetForm.$invalid) {
        $scope.editMyWidgetForm.$setTouched();
        if ($scope.editMyWidgetForm.$focusOnFirstError) {
          $scope.editMyWidgetForm.$focusOnFirstError();
        }
        return;
      }
      $uibModalInstance.close($scope.config);
    }

    init();
  }
})();
```

> **⚠️ Gotcha -- the edit modal MUST inject `config`; `$scope.config` is not it.**
> The host passes the *saved* widget config into the edit modal as the **injected
> `config` dependency**, not via `$scope` inheritance. If the edit controller reads
> `$scope.config` (or `$scope.config = $scope.config || {}`) instead of injecting
> `config`, the bug is **silent**: the modal shows stale defaults every time it
> reopens, and `close($scope.config)` returns a fresh object -- so the user's saved
> choices never round-trip ("I changed the setting, saved, and it reverted").
> Always: inject `config` → `$scope.config = angular.extend({}, defaults, config || {})`
> → `close($scope.config)`. The harness lint rule **`edit-config-inject`** fails the
> ship if `edit.html` binds `config.*` but `edit.controller.js` doesn't inject `config`.

### 5.3 Injectables you will almost always want

Group | Typical for | Injectables
---|---|---
**Core** | Every widget | `$scope`, `config`, `$timeout`, `$rootScope`
**Edit modal** | `edit.controller.js` | `$uibModalInstance`, `appModulesService`, `Entity`
**Querying** | List/chart widgets | `PagedCollection`, `Query`, `API`, `$http`, `$resource`, `_` (underscore)
**View Panel** | Record widgets | `$state`, `Modules`, `FormEntityService`, `websocketService`
**Playbooks** | Button/CTA widgets | `playbookService`, `widgetService`
**Connectors** | Enrichment widgets | `connectorService`, `modelMetadatasService`
**UX** | Notifications | `toaster`, `ModalService`, `$uibModal`

### 5.4 Adding a service to an existing controller -- beware positional-locals tests

If a controller is invoked in jest with a **positional** locals array (some of
this repo's suites do `$controller(name, [a, b, c, …])` rather than a named
`{ $scope }` map), then changing the controller function's **parameter list**
shifts every later argument by one -- e.g. inserting `$interval` before `$window`
makes `$window` resolve to the old `$sce` slot, and construction throws a
baffling `Cannot read properties of undefined (reading 'search')` deep in
unrelated code. Symptom: one small DI add turns ~20 controller-instantiating
suites red at once, all at the same construct-time line.

**Fix:** don't widen the signature. Resolve the new service lazily through the
already-injected `$injector` instead:

```js
function myWidget120DevCtrl($scope, $timeout, $window, $sce, $injector, …) {
    var $interval = $injector.get('$interval');   // no arity change → tests unaffected
```

(fortiaiAgenticAssistant `view.controller.js`: the live PENDING tool-duration ticker
pulls `$interval` this way.)

---

## 6. Edit form (`edit.html`) patterns

Every edit form follows this scaffold. It's what the user sees when clicking the pencil icon on a dashboard cell.

```html
<!-- Copyright start | MIT License | Copyright (c) YYYY Fortinet Inc | Copyright end -->
<form data-ng-submit="save()" name="editMyWidgetForm"
      data-ng-class="{ 'state-wait': processing }" novalidate>

  <div class="modal-header">
    <h3 class="modal-title col-md-9">My Widget -- Edit View</h3>
    <button type="button" class="close" data-ng-click="cancel()" aria-label="Close"
            id="close-edit-widget-form-btn">
      <div aria-hidden="true" class="version-button">+</div>
    </button>
  </div>

  <div class="modal-body">

    <!-- Title (every widget has this) -->
    <div class="form-group"
         data-ng-class="{ 'has-error': editMyWidgetForm.title.$invalid &&
                                        editMyWidgetForm.title.$touched }">
      <label for="title" class="control-label">Title</label>
      <input id="title" name="title" type="text" class="form-control"
             data-ng-model="config.title">
    </div>

    <!-- Data source (module selector) -->
    <div class="form-group"
         data-ng-class="{ 'has-error': editMyWidgetForm.resource.$invalid &&
                                        editMyWidgetForm.resource.$touched }">
      <label>Data Source <span class="text-danger">*</span></label>
      <select name="resource" class="form-control"
              data-ng-options="m.type as m.name for m in modules | playbookModules"
              data-ng-model="config.module"
              data-ng-change="loadAttributes()" required>
        <option value="">Select an Option</option>
      </select>
      <div data-cs-messages="editMyWidgetForm.resource"></div>
    </div>

    <!-- Field mapping (repeat per field you need the user to pick) -->
    <div data-ng-if="config.module">
      <div class="form-group">
        <label>Card Title <span class="text-danger">*</span></label>
        <select name="cardTitle" class="form-control"
                data-ng-model="config.mapping.cardTitle"
                data-ng-options="f.name as f.title for f in fieldsArray | orderBy: 'title'"
                required>
          <option value="">Select a field</option>
        </select>
        <div data-cs-messages="editMyWidgetForm.cardTitle"></div>
      </div>

      <!-- Filter builder (drop-in) -->
      <div class="form-group">
        <h6>Filter Criteria</h6>
        <div data-cs-conditional name="filters"
             data-fields="fields"
             data-mode="'queryFilters'"
             data-ng-model="config.query"
             data-enable-nested-filter="true"
             data-enable-expression="(page==='dashboard' || page==='reporting')"
             data-parent-form="editMyWidgetForm"
             data-form-name="'editMyWidgetForm'"></div>
      </div>

      <!-- Sort -->
      <div class="form-group">
        <h6>Default Sort</h6>
        <div data-cs-default-sort name="sortBy"
             data-ng-model="config.query"
             data-fields-array="fieldsArray"></div>
      </div>
    </div>

  </div>

  <div class="modal-footer">
    <button type="submit" class="btn btn-sm btn-primary" id="edit-widget-save">
      <i class="icon icon-check margin-right-sm"></i>Save
    </button>
    <button type="button" class="btn btn-sm btn-default" data-ng-click="cancel()">
      <i class="icon icon-close margin-right-sm"></i>Close
    </button>
  </div>
</form>
```

### 6.1 Validation idioms

```html
<!-- Show red outline when invalid *and* touched -->
<div class="form-group"
     data-ng-class="{ 'has-error': form.field.$invalid && form.field.$touched }">

<!-- Auto-formatted error message (works with required, pattern, min, etc.) -->
<div data-cs-messages="form.field"></div>

<!-- Focus the first invalid input on submit -->
if ($scope.form.$invalid) {
  $scope.form.$setTouched();
  $scope.form.$focusOnFirstError && $scope.form.$focusOnFirstError();
  return;
}
```

### 6.2 Module list filters

- `modules | playbookModules` -- excludes system modules the user can't create workflows against.
- `fields | filter: { type: 'picklist' }` -- field-type filter.
- `fieldsArray | orderBy: 'title'` -- alphabetize the dropdown.

### 6.3 Stubbed edit for "no configuration" widgets

Many drawer/wizard widgets require no user configuration. Use this stub:

```html
<form data-ng-submit="save()" name="editMyWidgetForm" novalidate>
  <div class="modal-header"><h3 class="modal-title">My Widget</h3></div>
  <div class="modal-body">
    <p>This widget does not require a configuration input.</p>
  </div>
  <div class="modal-footer">
    <button type="submit" class="btn btn-sm btn-primary">OK</button>
    <button type="button" class="btn btn-sm btn-default" data-ng-click="cancel()">Close</button>
  </div>
</form>
```

Controller is minimal:

```js
$scope.cancel = () => $uibModalInstance.dismiss('cancel');
$scope.save   = () => $uibModalInstance.close(config || {});
```

---

## 7. View template (`view.html`) patterns

### 7.0 In-widget detail modal (self-contained overlay -- not `$uibModal`)

For a "click element → popup with details + an action button" flow, prefer a
**widget-scoped CSS overlay** over the platform's `$uibModal`/dialog service:
absolutely-positioned inside the widget root (`position: relative` on the root,
`.modal-backdrop { position: absolute; inset: 0; z-index: N }`), toggled by an
`ng-if="selected"` on a `$scope` field the click handler sets. Why: it stays
self-contained (no platform-service dependency, survives the sandboxed panel),
and it can't wedge the host on a blocking dialog (see the alert/dialog caveat).
Stop backdrop clicks from closing when the click is inside the card with
`data-ng-click="$event.stopPropagation()"`. An "Open" button then deep-links the
record (`$window.open("/modules/view-panel/<module>/<id>", "_blank")`), honoring
a `config.openInNewTab` toggle. Reference impl: `ztpAutomationGraph` view
(`onNodeTap` → `selectedStep` → modal markup; node tap shows step status/error/
run-group before navigating). **E2e note:** if the trigger is a `<canvas>`
(Cytoscape etc.) there's no DOM node to click -- expose the instance
(`$window.__ztpCy = cy`) and emit the event (`cy.nodes()[0].emit('tap')`); and
stub `window.open` in an init script to capture the URL instead of navigating a
real popup, or the hermetic tier flags the platform route as an un-snapshotted
leak.

**Stacking-context trap -- `backdrop-filter`/`filter`/`transform` on a header
TRAPS its descendant dropdowns.** A high `z-index` on an absolutely-positioned
menu only wins *within its nearest stacking-context ancestor*. If that ancestor
(e.g. a `.topbar` with `backdrop-filter: blur()`) is itself painted at
`z-index: auto`, a **later-in-DOM sibling** (the message feed / a card) paints on
top of the whole context -- so the "open" dropdown renders *behind* the card and
its items aren't clickable where they overlap (Playwright reports the click
intercepted). `backdrop-filter`/`filter`/`transform`/`opacity<1` all create a
stacking context AND (for filter/transform) a containing block that also breaks
`position:fixed` descendants (a full-widget backdrop shrinks to the header). Fix:
give the header its own `position: relative; z-index: N` above the feed but below
your modals -- or move the dropdown out of the filtered ancestor. Reference:
`fortiaiAgenticAssistant` `.topbar` overflow menu over a `manual-input-card`
(regression test `manualInputForm.spec.js` "overflow menu is clickable…").

### 7.1 Asset paths

Reference your own assets with the `<name>-<version>` prefix -- this is what the platform serves them under:

```html
<link rel="stylesheet" type="text/css"
      href="myWidget-1.0.0/widgetAssets/css/myWidget.css" />

<script src="widgets/installed/myWidget-1.0.0/widgetAssets/js/myWidget.service.js"></script>

<div ng-include="'widgets/installed/myWidget-1.0.0/widgetAssets/html/partial.html'"></div>
```

### 7.2 Widget frame skeleton

```html
<div class="widget-container chart">
  <div class="display-flex-space-between margin-chart">
    <div class="padding-right-0 padding-left-0"
         data-ng-class="(page === 'dashboard' || page === 'reporting')
                         ? 'widget-dashboard-title-width'
                         : 'widget-title-width'">
      <h5 class="padding-left-lg margin-top-0 margin-bottom-0 text-overflow"
          data-ng-if="config.title !== ''">{{ config.title }}</h5>
    </div>
  </div>

  <div class="padding-left-lg padding-bottom-xlg overflow-hidden">
    <div data-ng-if="!processing && records.length > 0">
      <!-- content -->
    </div>
    <div class="watermark"
         data-ng-if="!processing && (!records || records.length === 0)">
      No Records Found
    </div>
    <div class="padding-top-sm padding-bottom-sm" data-ng-if="processing">
      <cs-spinner data-show-background="true"></cs-spinner>
    </div>
  </div>

  <div data-ng-show="!processing && unauthorized" class="unauthorized-message">
    <h6 class="text-center padding-top-lg padding-bottom-lg">
      You do not have necessary permission for {{ config.module | titlecase }}.
    </h6>
  </div>
</div>
```

### 7.3 Rendering a module record's field inline

```html
<!-- Read-only display, honors field type (picklist chip, dates formatted, markdown, HTML-safe) -->
<div data-cs-view-field="record[config.mapping.cardTitle]"></div>

<!-- In a list, with tooltip -->
<div data-uib-tooltip-html="'{{ record[config.mapping.subtitle].value | stripTags }}'"
     data-tooltip-append-to-body="true"
     data-tooltip-placement="top">
  <span data-ng-bind-html="record[config.mapping.subtitle].value"></span>
</div>

<!-- Editable in a record form (fields of interest-style) -->
<div data-cs-editable-field
     data-field="field.fieldData"
     data-mode="'row'"
     data-change-method="notifyFieldChange"></div>
```

### 7.4 Grid

```html
<div class="col-md-12 collection-grid-container margin-top-lg fade-in-animation">
  <div data-cs-grid
       data-grid-options="gridOptions"
       data-paged-collection="pagedCollection"
       class="grid-widget-container"></div>
</div>
```

**Harness gotchas (csGrid wraps angular-ui-grid):**
- ui-grid 4.6.4 + its feature modules must be loaded (index.html / `HARNESS_VENDOR_DEPS`)
  or csGrid throws `$injector:unpr uiGridConstants` and renders zero rows.
- csGrid's link reads `settingsService.getSystem().publicValues.lightmode.enable`
  (and `overrideLightMode.enable`) **unconditionally** to set `gridOptions.lightMode`.
  A box that never configured those keys resolves a `publicValues` without them →
  `Cannot read properties of undefined (reading 'enable')`, and the grid renders
  un-themed (washed-out cell text). The harness backfills both keys via a
  `settingsService` decorator (`harness.module.js`), defaulting `lightmode.enable`
  to the harness theme. csGrid also calls `currentPermissionsService.isAdmin()`
  (see §21 harness-stub note).
- **csGrid renders rows from `pagedCollection.list`/`.keyPairs`, NOT from
  `.data['hydra:member']`.** Its link logic is:
  `if (isUndefined(pc.list) || pc.list.length===0) gridOptions.data=[]; else gridOptions.data=pc.keyPairs;`
  So if you build a static `PagedCollection` and set only
  `.data['hydra:member']`, csGrid takes the empty branch and renders the **column
  headers but zero body rows** (a very confusing symptom -- columns appear, data
  is "there", but no rows). The base `PagedCollection.convertToKeyPairs` iterates
  `this.list` (it never reads `data['hydra:member']`), and nothing calls it for a
  hand-built static collection. Fix: set `pc.list = rows`, `pc.keyPairs = rows`,
  and `pc.visited = true` directly (see `widget-json-to-grid`
  `view.controller.js`). Corollary: if your widget already renders rows via its
  own `gridOptions.data` (no pagedCollection), do **not** also attach a
  pagedCollection unless you populate `.list`/`.keyPairs` -- an empty-`list`
  collection will override `gridOptions.data` to `[]`.
- **csGrid sort/filter/column-order are SERVER-backed -- they do nothing for an
  in-memory (playbook-result) grid unless you intercept.** Concretely (verified
  in `app.unmin.js`):
  - `orderByColumnDefs` and `viewType:'staticGrid'` have **0 references** in the
    bundle -- both are dead/cosmetic flags. Don't rely on them.
  - `enableSorting` defaults to **false** at the grid level; you must set it
    explicitly or header sorting never turns on.
  - On sort, csGrid calls `pagedCollection.buildSortQuery(cols)` then
    `pagedCollection.loadGridRecord(...)` (an API reload). On filter,
    `filterChanged` builds `query.filters` from each column's `filters[0].field`
    expecting a **SOAR field-metadata object** (`.name`/`.type`); plain string
    `field`s yield no filters, then it still calls `loadGridRecord`.
  - ui-grid binds cells from `field`, not `name` -- copy `name`→`field`.
  - **Fix for static grids (verified live):** set
    `gridOptions.useExternalSorting = false` and
    `gridOptions.useExternalFiltering = false`. The widget's gridOptions win over
    csGrid's defaults -- the merge is
    `angular.extend(gridOptions, angular.extend(defaults, gridOptions))` -- so
    these stick, and ui-grid's NATIVE client-side engine sorts/filters
    `gridOptions.data` in memory (numeric-aware sort + per-column substring
    filter, no server query). Also set `enableSorting: true` (grid default is
    false). Belt-and-suspenders: stub the collection's `loadGridRecord` to
    `return $q.when()` so any stray csGrid reload can't query the dead endpoint.
    `viewType:'staticGrid'`/`orderByColumnDefs` do nothing -- don't rely on them.
    See `widget-json-to-grid` `view.controller.js` (`normalizeColumns`,
    `setGridOptions`).
  - **FortiSOAR-style per-column filters (custom `filterHeaderTemplate`):**
    ui-grid's native per-column filter is a plain text box -- and even its
    `SELECT` type is a bare dropdown, nothing like FortiSOAR's metadata-driven
    grid filters (picklist multi-select, boolean Not Set/Yes/No, datetime
    relative-range presets). A static widget grid (synthetic `dummy_module`, no
    field metadata) can't reuse csGrid's server-side filter UI, but you CAN
    replicate the look client-side: set `colDef.filterHeaderTemplate` to a custom
    template (a directive) per column, render the FortiSOAR-style dropdown, and
    write the chosen value into `col.filters[0].term`, then
    `grid.api.core.notifyDataChange(...COLUMN)` + `grid.refresh()`. ui-grid runs
    each colDef's `condition(term, cellValue)` over the in-memory rows, so the
    term can be any shape (a preset key, an array of picklist values, a tri-state
    string). The dropdown menu must `dropdown-append-to-body` (uib) to escape the
    clipped grid header -- style it with globally-unique classes since it lives
    outside `.widget`. **Infer the column type from the data** when
    `grid_columns` omits it (the platform's own "JSON to Grid" example emits NO
    `type`, so without inference every column falls back to plain text). Auto-
    detect enum = a low-cardinality, clearly-repeating string column. See
    `widget-json-to-grid` `decorateColumnFilter` + the `jtgColumnFilter`
    directive (`view.controller.js`). Number/string keep the native input; don't
    clobber an explicit `filter`/`filters`, and skip when `enableFiltering:false`.
    NOTE: if you still use `uiGridConstants` anywhere, resolve it as a **soft**
    dependency (`$injector.has('uiGridConstants') ? $injector.get(...) : null`),
    NOT a hard `$inject` entry -- the hermetic e2e harness loads ui-grid's CSS/JS
    but doesn't reliably register `uiGridConstants` as an injectable, so a hard
    dependency aborts controller instantiation and the whole widget fails to
    mount (zero `.widget h5`, no rows).
  - **Runtime column show/hide + width/order persistence:** for the END USER,
    turn on `enableGridMenu`/`gridMenuShowHideColumns` (ui-grid's hamburger gives
    a column chooser). Persist per-user width/order to `settingsService`
    (`jsonToGrid/columnWidths` via `colResizable.on.columnSizeChanged` using each
    column's `drawnWidth`; `jsonToGrid/columnOrder` via
    `colMovable.on.columnPositionChanged`) and re-apply on load. This mirrors how
    a native SOAR module grid POSTs column state (it uses
    `/api/views/1/grid_columns`, which is module-scoped and not available to a
    synthetic widget grid) -- POST on change, read from the settings cache, no GET
    afterward, and never re-run the data playbook on a column change.
  - **Discovering a playbook's output schema at CONFIG time:** the edit modal
    has no runtime result, but you can run the data-provider playbook *from
    edit.html* to discover its columns. Use the same chain the view uses:
    fetch the playbook (`$relationships:true`), ensure the
    `SystemWaitForCompletion` recordTag, POST to `API.ACTION_TRIGGER + route +
    '?force_debug=true'` with `records:[]` (record-less -- no selection in edit),
    then `playbookService.checkPlaybookExecutionCompletion` →
    `getExecutedPlaybookLogData` and read `data.result`. Gate on
    `currentPermissionsService.availablePermission(FIXED_MODULE.PLAYBOOK,'read')`
    (force_debug needs read). Persist the admin's choices as a config array and
    merge it at runtime BEFORE any per-user (settingsService) override, treating
    the runtime `grid_columns` as the source of truth for existence. See
    `widget-json-to-grid` `edit.controller.js` `runProviderForColumns` +
    `view.controller.js` `applyColumnPrefs`.

### 7.5 Widget CSS -- what to write, what to leave to the platform

Widget CSS is injected into the SOAR document AFTER platform CSS loads. Because of
this, widget selectors win over platform selectors at equal specificity -- which is
both the power and the footgun.

**Cascade order at runtime** (last loaded = highest priority for equal specificity):

```
[page load]   platform CSS: style.min.*.css, themes/steel.*.css
[page load]   CDN vendor CSS: ui-grid, bootstrap, etc.
[widget mount] widget CSS  ← arrives last; wins on equal specificity
```

**What belongs in widget CSS:**
- The widget's own layout and custom component structure
- Visual elements that exist nowhere else in the platform (custom cards, bespoke tables)
- Per-theme colour swaps for things the widget owns (backgrounds it draws, borders it controls)

**What does NOT belong in widget CSS:**
- `csGrid` / `csChart` / `csField` look and feel -- the platform theme CSS owns this.
  Writing widget CSS to fix grid row colours means your overrides break when the theme
  changes. If grid rows look wrong in the harness, the cause is harness CSS ordering,
  not the widget (see §9.4.1 gotchas).
- Dark/light mode body-level colours -- those come from the platform theme and the
  `settingsService` lightMode path.

**Two loading patterns used in the wild:**

```js
// Pattern A -- single file, theme-neutral layout rules
$scope.widgetCSS = widgetBasePath + 'widgetAssets/css/myWidget.css';
```
```html
<link rel="stylesheet" href="{{widgetCSS}}">
```

```js
// Pattern B -- per-theme file (controller picks based on current theme ID)
const themeMap = { dark: 'myWidget-dark.css', light: 'myWidget-light.css', steel: 'myWidget-steel.css' };
$scope.themeCSS = widgetBasePath + 'widgetAssets/css/' + themeMap[themeId];
// themeId comes from settingsService.getSystem().publicValues (same value csGrid reads)
```
```html
<link rel="stylesheet" href="{{themeCSS}}">
```
Pattern B is used when the widget draws its own backgrounds or text colours that must
track dark/light/steel themes. `configureIndicatorExtraction` and `multiTableView` are
canonical examples from the platform widget library.

**Scoping -- mandatory, enforced by lint:**

SOAR renders multiple widgets on the same dashboard page; there is no CSS isolation
between them. Every selector in a widget CSS file MUST be prefixed with the widget's
root class to prevent bleeding into sibling widgets:

```css
/* WRONG -- leaks to every widget on the page */
.card-title { color: red; }

/* RIGHT -- scoped to this widget's DOM subtree */
.widget.widget-container .card-title { color: red; }
```

The harness lint blocks a push if any selector lacks this prefix.

**Specificity cheat sheet:**

| Selector | Specificity | Beats? |
|---|---|---|
| `.widget.widget-container .my-el` | (0,2,0) | Most platform structural rules |
| `.widget.widget-container .parent .my-el` | (0,3,0) | Matches platform's (0,3,0) -- loads later so wins |
| Platform theme `.ui-grid-row:nth-child(odd) .ui-grid-cell` | (0,3,0) | Wins over widget selectors with < 3 classes |
| Anything `!important` | overrides specificity | Use only when the platform uses `!important` that you must counter |

### 7.6 Chart

```html
<div data-cs-chart="chartOptions"></div>
```

#### 7.6.1 Hand-rolled SVG charts: three gotchas that all render a *plausible lie*

From `socAssistantMonitor` 1.0.8 -- the widget drew a smooth week-long cost
decline that never happened. All three are silent: the chart looks fine.

**1. Zero-fill your buckets.** Aggregation endpoints (here the connector's
`get_usage_summary`) return only buckets that HAVE rows. A 7d range with
traffic on two days comes back as two points; index-to-x mapping then stretches
them across the full width and invents a trend over the five missing days.
Always expand the series to one bucket per interval across the *requested*
range before pathing, with `0` for the quiet ones -- and derive bucket keys in
the producer's exact format (`%Y-%m-%d` vs `%Y-%m-%dT%H:00:00`), in UTC.

**2. `preserveAspectRatio="none"` distorts `<text>`, not just the path.** A
`viewBox="0 0 400 140"` rendered into a ~1150px-wide box scales x by ~2.9x, so
axis labels render as `0 7 - 2 8` with the glyphs pulled apart. It's fine for
a pure area/line path; it is never fine for text. Put axis labels in **HTML**
positioned over the SVG (`position:absolute; left:<pct>%`), not in `<text>`.
Add `vector-effect="non-scaling-stroke"` so the line keeps an even weight too.

**3. Labels and path must share one x scale.** The old code inset the path by
`padX=8` on a 0..400 viewBox but positioned labels at `$index * (400/(n-1))` --
so labels never sat over their points, and the first/last were half-clipped by
the viewBox edge. Compute both from the same divisor (percentages are easiest),
and remember that thinning labels (`show 3 of 30`) must not change the spacing
of the ones you keep.

Bonus: scale sparklines from **0**, not from the observed min. `min..max`
scaling redraws `3,4,5` as a full-height climb identical to `0,50,100`.

#### 7.6.2 `ng-repeat` over a function that builds a fresh object trips `infdig`

`ng-repeat="(k,v) in someFn()"` re-invokes `someFn()` every digest; a new object
identity each time never stabilises -> `$rootScope:infdig`. Memoise on a cheap
key (`tab + JSON.stringify(state)`) and return the cached reference, the same
way `socAssistantMonitor`'s `users()` caches on the `$scope.usage` reference.

---

## 8. Services catalog

Platform services widget controllers can inject -- `FormEntityService`, `$state`, `$rootScope`, `websocketService`, `Query`, `Entity`, `Modules`, and the rest -- with inject names and usage notes.

> **Full reference:** [`docs/kb/services-catalog.md`](fortisoar-widget-harness/docs/kb/services-catalog.md)
## 9. Directives catalog

AngularJS directives the platform provides for widget templates (`cs-markdown-editor`, `cs-grid`, `ui-select`, `cs-connector-actions`, …) with each directive's scope contract and usage gotchas.

> **Full reference:** [`docs/kb/directives-catalog.md`](fortisoar-widget-harness/docs/kb/directives-catalog.md)
## 10. Filters

Filter | Usage | Result
---|---|---
Default Angular filters | `{{ x \| uppercase }}`, `date`, `currency`, `number`, `limitTo`, `orderBy`, `filter` | Stock AngularJS behavior
`getEndPathName` | `$filter('getEndPathName')('/api/3/alerts/80addd07-...')` | `80addd07-...` (UUID from IRI)
`getModuleTypeOfIri` | `$filter('getModuleTypeOfIri')('/api/3/alerts/80addd07-...')` | `alerts`
`isValidIRI` | `$filter('isValidIRI')(value)` | `true`/`false`
`truncateText` | `{{ 'Long...' \| truncateText }}` | Truncates > 55 chars with `...`
`playbookModules` | `modules \| playbookModules` | Filters out non-user modules
`picklistOptions` | `$filter('picklistOptions')(options)` | Only active, orderIndex-sorted picklist items
`unixToDate` | `$filter('unixToDate')(unixSeconds)` | JS Date (used by `slaCountDownClock`)
`stripTags` | `{{ html \| stripTags }}` | Strips HTML tags for tooltips
`titlecase` | `{{ 'alerts' \| titlecase }}` | "Alerts"

Register your own:

```js
angular.module('cybersponse')
  .filter('myCustomFilter', function () {
    return function (input) { return /* ... */; };
  });
```

---

## 11. Querying data

Three ways to talk to the FortiSOAR data plane. **Use `PagedCollection` for lists, `Entity` for single-record work with relationships, and raw `$http.post(API.QUERY + module)` for aggregates.**

### 11.1 `Query` -- the query object builder

```js
const q = new Query({
  sort:   [{ field: 'severity.orderIndex', direction: 'ASC' }],
  limit:  2147483647,         // "all"
  logic:  'AND',
  filters: [
    { field: 'severity', operator: 'eq',
      value: '/api/3/picklists/7efa2220-39bb-44e4-961f-ac368776e3b0',
      _value: { display: 'Critical', itemValue: 'Critical',
                '@id': '/api/3/picklists/7efa2220-...' },
      type: 'object' }
  ],
  aggregates: [
    { operator: 'countdistinct', field: '*',              alias: 'total' },
    { operator: 'groupby',       field: 'status.itemValue', alias: 'status' },
    { operator: 'groupby',       field: 'status.color',     alias: 'color' },
    { operator: 'groupby',       field: 'status.orderIndex',alias: 'orderIndex' }
  ],
  __selectFields: ['field1', 'field2']
});

q.getQuery(true);       // plain object ready for $http.post / PagedCollection
q.getFlatQuery();       // flat k=v form for URL
q.updateFilter(newFilterObject);
```

### 11.2 `PagedCollection` -- grids & card lists

```js
const coll = new PagedCollection(
  /* module */ $scope.config.module,
  /* columns */ null,                    // optional pre-defined columns
  /* options */ { $limit: $scope.config.query.limit }
);
coll.query = new Query($scope.config.query);

coll.loadGridRecord()                    // GET api/3/<module>?<query>
    .then(() => { $scope.fieldRows = coll.fieldRows; });

// Or for aggregates / custom bodies: POST /api/query/<module>
coll.loadByPost(queryObj);
```

Useful helpers: `gotoPage(n)`, `pageNext`, `pagePrevious`, `pageFirst`, `pageLast`, `setPage`, `sortColumnsByFieldName`, `extendFilter`, `loadDefaultColumns`, `convertToKeyPairs(collection)`.

### 11.3 `Entity` -- single records & relationships

```js
const entity = new Entity('alerts');

// Load metadata (needed once per module in an edit form)
entity.loadFields().then(() => {
  $scope.fields      = entity.getFormFields();
  $scope.fieldsArray = entity.getFormFieldsArray();
  // Relationship fields are separate
  angular.extend($scope.fields, entity.getRelationshipFields());
});

// Load an actual record
entity.get($state.params.id, { $relationships: true }).then(() => {
  console.log(entity.fields.severity.value);
  entity.fields.alerts.value;         // array of related records after $relationships=true
});

// Save back
entity.save();
```

### 11.4 `Modules` -- direct REST resource

```js
Modules.get({
  module: $state.params.module,
  id: $state.params.id,
  __selectFields: ['severity', 'status']
}).$promise.then(rec => {
  $scope.severity = rec.severity;
});

Modules.save({ module: 'alerts', $relationships: true }, payload).$promise;
```

### 11.5 Raw aggregate via `$http.post`

```js
const queryObj = new Query({ ...cfg }).getQuery(true);
$http.post(API.QUERY + $scope.config.resource, queryObj).then(r => {
  // r.data['hydra:member'] is the array of aggregate rows
});
```

### 11.6 Building an aggregate "group-by-picklist count" query

The most common chart pattern (see `c3Charts`, `funnelChart`, `topX`, `recordDistribution`):

```js
new Query({
  sort:    [{ field: 'total', direction: 'DESC' }],
  filters: config.filters,
  aggregates: [
    { operator: 'countdistinct', field: '*',               alias: 'total' },
    { operator: 'groupby',       field: 'severity.itemValue', alias: 'severity' },
    { operator: 'groupby',       field: 'severity.color',     alias: 'color' }
  ]
}).getQuery(true);
// Response: { 'hydra:member': [ { total: 12, severity: 'Critical', color: '#ff0000' }, ... ] }
```

### 11.7 Operators

`eq`, `neq`, `in`, `nin`, `contains`, `notcontains`, `startswith`, `endswith`, `gt`, `gte`, `lt`, `lte`, `between`, `isnull`, `isnotnull`, `tags_include`, `tags_exclude`. Expression operators supported when `data-enable-expression="true"` (Jinja).

---

## 12. Current record (View Panel context)

Four ways to get the viewed record -- pick based on what you need.

### 12.1 `$state.params` (always available on View Panel)

```js
$state.params.module   // 'alerts' | 'incidents' | etc.
$state.params.id       // UUID (NOT the IRI)
```

Use with any loader:

```js
// Via Entity (richest -- gives you fields, relationships, helpers)
const e = new Entity($state.params.module);
e.get($state.params.id, { $relationships: true }).then(() => { /* e.fields.* */ });

// Via Modules (leanest)
Modules.get({
  module: $state.params.module,
  id: $state.params.id,
  __selectFields: ['duedate', 'slapaused', 'createDate']
}).$promise.then(r => { /* r.duedate etc. */ });
```

### 12.2 `FormEntityService` (inside a record form, including Add Form)

```js
const entity = FormEntityService.get();
// entity.fields.*, entity.type, etc.
FormEntityService.submitField('description');   // persist a single field
```

Used by `accessControl`, `fieldsOfInterest`, `picklistAsPhases`.

### 12.3 Parent scope (when FortiSOAR nested you inside a record viewer)

```js
$scope.$parent.model    // the raw record object (common on old widgets)
```

### 12.4 Jinja-templated parameters

The platform interpolates widgets' config when rendered through templated routes. `$state.params.qparam` carries a JSON context:

```js
const ctx   = JSON.parse($state.params.qparam);           // e.g. { incident: { id: '...' } }
const resolved = $interpolate(config.entityId)(ctx);       // '{{ incident.id }}' → UUID
```

Used by `incidentCorrelations`, optionally by `incidentTimeline`.

### 12.5 Cross-reference

Widget | Method used
---|---
`fieldsOfInterest`, `picklistAsPhases`, `accessControl` | `FormEntityService.get()`
`recordSummary`, `customPicklistMessage`, `slaCountDownClock`, `vtAugment` | `$state.params.module` + `$state.params.id`
`incidentTimeline` | `$state.params.id` → `new Entity('incidents').get(id, {$relationships: true})`
`recordCard`, `cardTiles`, `cardView` | Not "current record" -- they query a module using `config.query`
`incidentCorrelations` | `$state.params.qparam` + `$interpolate`

---

## 13. `config.mapping` convention

Almost every "render-a-module's-fields" widget stores the user's field picks in a `config.mapping` object. The keys are your widget's semantic slots; the values are field *names* (strings).

```js
config.mapping = {
  cardTitle:      'name',
  subtitle:       'description',
  recordIcon:     'logoField',         // Rich-text field containing an <img>
  cardLeftBorder: 'severity',          // Picklist field → borrow its .color
  recordStatus:   'status',            // Picklist for badge
  showIcon:       true,
  cardIcon:       'icon-bell',
  image:          'imageField'
};
```

### 13.1 Select just the mapped fields

```js
// All values (strings) become the __selectFields list
$scope.config.query.__selectFields = _.values($scope.config.mapping);

// Or omit non-field flags
$scope.config.query.__selectFields = _.values(
  _.omit($scope.config.mapping, ['showIcon', 'cardIcon'])
);
```

### 13.2 Read a mapped field on a record

```html
<h4>{{ record[config.mapping.cardTitle].value }}</h4>
<span data-ng-bind-html="record[config.mapping.subtitle].value"></span>
<div data-uib-tooltip-html="'{{ record[config.mapping.subtitle].value | stripTags }}'">...</div>
```

### 13.3 Extract an image from a rich-text field

Rich-text `recordIcon` stores `<p><img src="URL" /></p>`:

```js
let img = item[config.mapping.recordIcon].value
  .replace('<p><img src="', '')
  .replace('" /></p>', '')
  .replace('"></p>', '');
item.image = img;   // bind to <img src="{{ item.image }}">
```

### 13.4 Navigate a nested JSON field

```js
let data = record[config.customModuleField].value;
(config.keyForCustomModule || '').split('.').forEach(k => { data = data[k]; });
```

---

## 14. Theme awareness

```js
const themeId = $rootScope.theme.id;    // 'light' | 'steel' | 'dark'

function setThemeColors() {
  const cfg = {};
  if (themeId === 'light') {
    cfg.background = '#eeeeee';  cfg.border = '#0D9BE3';
  } else if (themeId === 'steel') {
    cfg.background = '#29323e';  cfg.border = '#22a6af';
  } else { // dark (default)
    cfg.background = '#262626';  cfg.border = '#2cafc3';
  }
  return cfg;
}
$scope.colors = setThemeColors();
```

Template:

```html
<div data-ng-style="{'background': colors.background,
                     'border-left': '4px solid ' + colors.border}">
</div>

<!-- Or pick a theme-specific asset -->
<img data-ng-src="myWidget-1.0.0/widgetAssets/images/chevron_{{ themeId }}.svg">
```

When calling external services that need a theme name, **map `steel` → `steel`** (older connectors expect the literal `steel`).

---

## 15. WebSocket subscriptions

Use the websocket to update a widget in real-time when a record or module changes.

```js
function initWebsocket() {
  websocketService
    .subscribe($scope.config.module, onMessage)
    .then(sub => { subscription = sub; });
}
function onMessage(data) {
  // data.changeData is the list of fields that changed
  if (data.changeData.includes(config.watchedField)) reload();
}

$scope.$on('websocket:reconnect', initWebsocket);
$scope.$on('$destroy', () => {
  if (subscription) websocketService.unsubscribe(subscription);
});

initWebsocket();
```

### 15.1 Record-level subscription (View Panel widgets)

```js
websocketService.subscribe(
  `${$state.params.module}/${$state.params.id}`,
  data => { /* reload this specific record */ }
);
```

### 15.2 Relationship subscription

```js
websocketService.subscribe(
  `${$state.params.module}/${$state.params.id}/${relationshipModule}`,
  onRelatedChange
);
```

Observed in: `recordCtaBlock`, `recordSummary`, `customPicklistMessage`, `slaCountDownClock`, `picklistAsPhases`, `multiTableView`, `taskManagement`, `outbreakAlertConfiguration` (for playbook execution).

### 15.3 Playbook status channel

```js
// Subscribe to real-time playbook execution updates
websocketService.subscribe('runningworkflow', data => {
  // data.parent_wf_id, data.task_id, data.status ∈ {'running','failed','finished','finished_error'}
});
```

Used by `playbookExecutionWizard`.

---

## 16. AngularJS events

```js
// Up the scope tree (child → parent → root)
$scope.$emit('fieldChange', $scope.field);

// Down the scope tree (parent → all children)
$scope.$broadcast('updateConfigurationFields', $scope.field);

// App-wide
$rootScope.$broadcast('widget:' + eventName, payload);

// Listen
$scope.$on('fieldChange', (event, field) => { /* ... */ });
```

Events commonly emitted by the platform:

Event | When
---|---
`websocket:reconnect` | Socket re-established after a disconnect. Re-subscribe inside your handler.
`fieldChange` | A `cs-field` value changed.
`updateConfigurationFields` | Configuration field set was refreshed (connector forms).
`csFields:viewValueChange` | A field emitted its `ng-model` change; parent can resync.
`$destroy` | Always clean up (unsubscribe websockets, destroy chart instances, cancel intervals).

---

## 17. Wizards (`WizardHandler`)

```html
<wizard name="mySetupWizard" on-finish="finishedSetup()">
  <wz-step title="Step 1" can-exit="validateStep1">
    <!-- content -->
    <button type="button" wz-next>Next</button>
  </wz-step>

  <wz-step title="Step 2">
    <button type="button" wz-previous>Back</button>
    <button type="button" wz-next>Next</button>
  </wz-step>

  <wz-step title="Finish">
    <button type="button" wz-finish>Finish</button>
  </wz-step>
</wizard>
```

```js
WizardHandler.wizard('mySetupWizard').goTo(2);   // jump to step by index or title
WizardHandler.wizard('mySetupWizard').next();
WizardHandler.wizard('mySetupWizard').currentStep();
```

Many configuration widgets (`outbreakAlertConfiguration`, `fortiAIConfiguration`, `threatIntelManagementConfiguration`, `configureIndicatorExtraction`, `outbreak-response-framework-configuration-wizard`) use 3-6 `wz-step`s, often embedding `connectorConfig.html` via `ng-include` to render connector-specific form fields.

---

## 18. Drawer / non-modal widgets

Drawer / non-modal widget lifecycle: page contexts, `enableFor` mechanics, mounting, approval flows, and the standalone-widget gotchas. The most-consulted KB section.

> **Full reference:** [`docs/kb/drawer-widgets.md`](fortisoar-widget-harness/docs/kb/drawer-widgets.md)

> **Reference -- the connector's stateful debug walker (`start_debug_session` family).** `start_debug_session(yaml_text, breakpoints?, execute_safe_ops, …)` returns `{ok, status}` and allocates a `session_id` in the connector's SessionStore; `step_debug_session`/`continue_debug_session`/`stop_debug_session` then drive it by id. `status` = `{session_id, playbook, done, paused_at, steps_advanced, trace_len, first_error, breakpoints[], last_step, trace[]}`; each trace record = `{step_id, name, type, rendered_args, output, output_top_keys, output_shape, status, note}`. A widget can build a full step/continue/breakpoint debugger on this (`fortiaiAgenticAssistant`'s YAML-pane Debug panel does). **Gotchas:** (1) it's stateful and live-only -- route through `_executeReal('call_mcp_tool', {tool, args})`, never the mock track; (2) the session TTL-expires but a widget should `stop_debug_session` on close / on a YAML edit so stale sessions don't linger; (3) `continue` merges `add_breakpoints` but there's no remove -- dropping a breakpoint only takes effect on a fresh `start`.

> **Reference -- `validate_yaml`/`compile_yaml` return `corrected_yaml` + `auto_fixes[]`.** The FSR-playbook compiler auto-repairs known foot-guns (set_variable namespace refs, `vars.input.<p>` missing `.params.`, `stop`→`end`, …) and hands back the fully-corrected source text alongside a per-fix list (`[{code, line, message}]`) plus an `auto_fix_note`. This is a real, box-independent one-click apply-patch surface -- a widget can offer "adopt corrected_yaml" without reimplementing YAML mutation. `fortiaiAgenticAssistant`'s YAML-pane "Check & fix" (`checkAndFix()` → `validateYamlLive` → `applyPatch()`) is built on it. **Gotcha:** the compiler only runs on the LIVE connector, so route this through the always-live path (`_executeReal`, not `executeAction`) -- the mock track has no compiler and returns no fixes. Same reason `step_test`/`push_playbook` are live-only.

> **Gotcha -- a "record summary" composed for alerts/cases silently drops a record's nested collections, so a widget that *fetched* related rows can still ship none of them.** `fortiaiAgenticAssistant` resolved its entity with `GET <iri>?$relationships=true` -- so the open playbook's **steps really were on the record** -- and then rendered it through `_composeEntitySummary`, which reads a fixed alert/case-shaped field list (name/severity/status/source/type/description). Everything nested was dropped on the floor. The composer button was even labelled *"Pull in this playbook's steps"*: it pulled no steps. The mount looked correctly wired at every layer (state → iri → entityContext → `?$relationships=true` → summary), and the only symptom was the agent asking the analyst to paste in the record it already had. **Two rules.** (1) A summary composer written for one module is not reusable for another by default -- a `workflows` record's payload is its `steps[]`, a `cases` record's is its fields; assert what a mount actually *sends* (`entity` on the chat_turn payload), never that it *fetched*. (2) If the consumer needs a nested collection, ship it as its own key (`entity.playbook_yaml`) rather than hoping it survives a generic field-flattener -- and **do not truncate it** if the consumer edits and writes it back: the record-data block is capped (`_ENTITY_CONTEXT_MAX`), and a clipped playbook that gets edited and pushed returns as a playbook with the analyst's steps deleted. See `view.controller.js` `_seedPlaybookYaml()`/`_entityPayload()`, `fsrPbAgent.service.js#decompilePlaybook`, and `tests/playbook.yaml.seed.test.js`.

> **Gotcha -- one `localStorage` key is shared across every mount of the same widget.** The same widget can be mounted in several contexts at once (dashboard, a record drawer, the playbook designer), and they all share the browser's `localStorage`. A single un-namespaced key (e.g. `fsrPbSession`) therefore *bleeds state across contexts*: `fortiaiAgenticAssistant` persisted its active chat session under one `fsrPbSession` key, so opening the widget on the playbook designer (build mode) rehydrated the analyst's last *dashboard investigation/triage* chat onto the playbooks page. Fix: **scope any persisted per-mount state by the mount's context** -- key it by `uiIntent`/`inPlaybookEditor` (`fsrPbSession:build` vs `fsrPbSession:triage`), and migrate the legacy un-namespaced key into the default context only (never the other one). See `view.controller.js` `_sessionKey()`/`_ensureSessionId()` and `tests/sessionScope.controller.test.js`.

## 19. Triggering playbooks

### 19.1 From a button widget (contextual to a record)

```js
playbookService.triggerPlaybookAction($scope, /* fromWidget */ true, $scope.entity);
```

`$scope.entity` is typically pulled from `FormEntityService.get()`.

### 19.2 Attach to running-playbook websocket and clean up

```js
// In view.controller.js (buttons widget)
$scope.$on('$destroy', () => {
  playbookService.detachPaybookStatusWebsocket();
});
```

### 19.3 Direct trigger -- pick the endpoint by trigger TYPE (live-verified)

There are **three** trigger endpoints and they take **different identifiers**.
Using the wrong one is the classic `404 NotFoundHttpException "Resource Not
Found In Request"`. All three derive from the platform's own `playbookService` /
`SchedulesService` (`app.unmin.js`) and are verified against box 205.

| Use case | Endpoint (`API.*`) | Identifier in the URL | Body |
|---|---|---|---|
| **Run a playbook now, by UUID** (no record, designer "Run", scheduled, data-provider) | `MANUAL_TRIGGER` = `api/triggers/1/notrigger/` | the **playbook `@id` UUID** | `{}` or `{ input vars }` |
| **Record-context action** (Manual / `cybersponse.action` trigger fired from a record) | `ACTION_TRIGGER` = `api/triggers/1/action/` | the trigger step's **`arguments.route`** (NOT the playbook uuid) | `{ __uuid: <pbUuid>, __resource: <module>, records: [<iri>…] }`; `noRecordExecution:true` ⇒ `records: []` |
| **External API/HMAC trigger** (`cybersponse.api_call`) | `API_HMAC_TRIGGER_URL` = `api/triggers/1/` | the api_call **route** | per-trigger, HMAC-signed |

```js
// Universal "run this playbook" -- works regardless of trigger type or whether
// the manual-action route is registered. This is what to use for a data-provider
// playbook (e.g. jsonToGrid's grid source).
//   POST api/triggers/1/notrigger/<playbookUuid>  ->  { task_id }   (HTTP 200, verified)
$resource(API.MANUAL_TRIGGER + playbookUuid).save({}).$promise;

// Record-context action trigger -- needs the trigger step's ROUTE, not the uuid:
$resource(API.ACTION_TRIGGER + triggerStep.arguments.route)
  .save({ __uuid: playbookUuid, __resource: entity.module, records: [recordIri] });
```

**Gotcha that bit jsonToGrid (and the misleading old text here):**
`API.ACTION_TRIGGER + playbookUuid` is WRONG -- the action endpoint keys off the
registered **route**, so passing a playbook UUID 404s. Worse, even with the
correct route, `action/<route>` 404s when that manual-action route **isn't
registered** in the box's trigger registry -- which happens when the playbook
lives in an **unpublished / "Drafts" collection** (playbook-level `isActive:true`
is necessary but not sufficient; the *collection* must be active). For a
no-record data-provider playbook, prefer `notrigger/<uuid>` and the whole class
of problem disappears. `action-renderer` already encodes this split
(`triggerPlaybookHeadless`: `isManual = triggerType==='manual' || !route` →
`notrigger/<uuid>`, else `action/<route>`); **jsonToGrid does not yet** and so
404s on a Drafts/no-route data provider.

**Listing playbooks for a picker -- don't `GET /api/3/workflows`.** That endpoint
returns EVERY workflow with its **full step bodies** even without `$relationships`
(~700 playbooks → multiple MB → ~7 s), which a name/uuid dropdown doesn't need.
Use `POST /api/query/workflows?$limit=1000` with a trimmed body instead -- an
order-of-magnitude smaller/faster payload:
```js
{ logic: "AND",                                   // filters are SILENTLY dropped without explicit logic
  filters: [{ field: "isActive", operator: "eq", value: true }],
  __selectFields: ["uuid", "name"],               // server trims the response columns
  sort: [{ field: "name", direction: "asc" }] }
```
Drive it via `$resource("/api/query/workflows?$limit=1000").save(body)` (`$limit`
must be baked into the URL -- Angular's param serializer drops `$`-prefixed params).
The trimmed response may omit `@id`; reconstruct the IRI as `/api/3/workflows/<uuid>`.
Fetch the picked playbook's trigger step (type + input vars) on demand -- a ~5 KB,
sub-second `GET /api/3/workflows/<uuid>?$relationships=true&$triggerOnly=true` --
so no fidelity is lost. `action-renderer`'s "Show all playbooks" branch
(`loadAllPlaybooks`) does exactly this.

After triggering, poll for output with `task_id`(s):
`playbookService.checkPlaybookExecutionCompletion(taskIds, cb)` →
`getExecutedPlaybookLogData(instance_ids)` → `{ status:'finished', result }`.
See also the endpoint table in the "Two trigger endpoints -- by trigger TYPE"
note (§ API constants, ~L3270).

**The log payload also carries `data.env` -- a flat namespace of EVERY variable
set anywhere in the playbook, not just the final step's output.** Verified live
(`GET /api/wf/api/workflows/<inst>/?format=json`, force_debug run): top-level
keys are `{ result, env, steps, status, debug, … }`. A variable assigned in *any*
step (e.g. a "Set Variable" or connector step) appears as a top-level key in
`env` (alongside system keys `input`/`request`/`route`/`resources`/`task_id`/
`auth_info`/`currentUser`/…). `steps[]` carries only `name`/`status`/timing --
**no per-step `result`** -- so you cannot attribute a var to a step, but you don't
need to: `env` is the merged final variable space. `data.result` is only what the
playbook's output/Return-Output step populated. Practical consequence: a widget
can source two independent values (e.g. jsonToGrid's `grid_data` rows and
`grid_columns`) from *different* steps by reading `env`, instead of forcing the
playbook author to assemble both in one final step. jsonToGrid's
`resolveGridPayload` does exactly this with precedence `result.<x>` → named
`env.<x>` → shape-sniff of `env` (rows = longest array-of-objects; columns = a
`{columns:[…]}`-shaped value; system keys excluded). No extra API call -- `env` is
in the same response.

### 19.4 Conditional button display

Most button widgets evaluate each playbook's `displayConditions` (a `Query`-compatible filter) against the current record to decide which buttons to show. See `playbookButtons-1.1.1/view.controller.js:96-110`.

### 19.5 Exec wizard integration

```js
widgetService.launchStandaloneWidget('playbookExecutionWizard', '1.0.1', {
  // anything passed here is injectable into the launched controller as `$resolve`
});
```

---

## 20. Connectors

### 20.1 Module-metadata lookup → connector call

```js
modelMetadatasService.getMetadataByModuleType($scope.config.module).then(meta => {
  if (!meta.dataSource) return;                 // no connector integration
  const { connector, action } = meta.dataSource;
  connectorService.executeConnectorAction(
    connector.name, connector.version,
    action.operation,
    connector.configId,
    /* payload */ { indicator: iocValue }
  ).then(r => { $scope.data = r.data; });
});
```

Used by `speedometer`, `categoricalInsights`, `killchainphases`, `customTags`, `vtAugment`.

### 20.2 Managing connector configurations

```js
connectorService.getConnector(name, version).then(c => { /* c.data */ });
connectorService.getDevelopedConnector(name, version);
connectorService.updateConnectorConfig(name, version, configPayload);
connectorService.deleteConnector(id);
```

### 20.3 Agent-based connectors

If a connector runs on an agent, `executeConnectorAction` returns a job id; listen for its result on the websocket:

```js
websocketService.subscribe('runningworkflow', data => {
  if (data.task_id === myJobId && data.status === 'finished') { /* ... */ }
});
```

### 20.4 Shipping a connector -- stale in-memory workers (CRITICAL)

FortiSOAR runs each connector's `execute` calls across a pool of long-lived
integration-agent worker processes (gunicorn `fsr-integrations-agent`, ~7-10
procs). **A worker imports the connector module ONCE and caches it in
`sys.modules`; it only recycles onto new code when you publish with a NEWER
version.** Consequences:

- Copying new files into the on-disk connector dir (or reinstalling the *same*
  version) does **not** reload the running workers -- they keep executing the old
  bytecode. The live behavior is stale even though the disk is fresh.
- Symptom seen on 8.0/159: every agentic-triage hunt returned
  `no_fsr_configured: No module named 'probes'` because the crudhub/probes
  bridge (`operations._ensure_probes_bridge` → `fsr_soc_triage._live_crudhub`)
  lived only in the new on-disk code; the cached workers predated it. On-disk
  `lc.available()` was `True` the whole time -- the workers just never reloaded.
- **Always ship via a version-bumped publish.** For the agentic connector that
  is `make ship` in the connector repo (bump → build → install → `verify_workers`
  gate that asserts every pid reports the new version). Never hand-copy files or
  do a same-version reinstall and expect the change to be live.
- Diagnose in the *worker context* (cwd `/opt/cyops-integrations/integrations`,
  `DJANGO_SETTINGS_MODULE=integrations.settings`, the `integrations_env`
  interpreter) -- a bare `python` from the connector dir can't import
  `integrations.crudhub` and will falsely read `available() == False`. `make
  bridge-check` runs this correctly over SSH.

The standardized command set for connector/widget shipping + box diagnosis is
the connector-repo Makefile (`make ship` / `ship-widget` / `verify` /
`bridge-check` / `matrix`). Use it -- do not hand-run `deploy.sh`, `ssh`, or
ad-hoc `pyfsr`.

---

## 21. Permissions

```js
// Full permission bag for a module
const p = currentPermissionsService.getPermission('alerts');
// { read: true, update: true, delete: false, create: true, ... }

// Shortcut for a single action
if (currentPermissionsService.availablePermission('rules', 'read')) { /* ... */ }

// Field-level
currentPermissionsService.availableFieldPermission('alerts', 'severity', 'read');

// Admin?
if (currentPermissionsService.isAdmin()) { /* ... */ }
```

**Harness stub (gotcha):** the harness overrides `currentPermissionsService`
with a grant-all stub (`harness.module.js`). It must expose **every** method a
platform directive calls during `$digest`, not just the ones widgets use -- e.g.
`csGrid`'s link calls `isAdmin()` (to set `restrictPermanentDelete`). A missing
method throws `isAdmin is not a function` and the grid never links (jsonToGrid).
When a built-in directive errors with `<method> is not a function` on a stubbed
service, add that method to the stub.

Always guard the view with an `unauthorized` branch:

```html
<div data-ng-if="unauthorized" class="unauthorized-message">
  <h6>You do not have necessary permission for {{ config.module | titlecase }}.</h6>
</div>
```

---

## 22. External assets

### 22.1 Bundled -- ship inside the `.tgz`

```html
<script src="widgets/installed/myWidget-1.0.0/widgetAssets/js/lib.js"></script>
<link rel="stylesheet"
      href="widgets/installed/myWidget-1.0.0/widgetAssets/css/style.css">
```

### 22.2 CDN -- loaded on demand

```js
function loadJsAsync(src) {
  const d = $q.defer();
  const s = document.createElement('script');
  s.type = 'text/javascript';
  s.src = src;
  s.onload  = () => d.resolve();
  s.onerror = () => d.reject('Failed: ' + src);
  document.head.appendChild(s);
  return d.promise;
}

const scripts = [
  'https://cdnjs.cloudflare.com/ajax/libs/d3-sankey/0.12.3/d3-sankey.min.js',
  'https://unpkg.com/@hpcc-js/wasm@0.3.11/dist/index.min.js'
];
await $q.all(scripts.map(loadJsAsync));
```

### 22.3 Watch out: AMD conflicts

If you load a UMD library that registers itself through AMD (`d3-sankey`, `c3`), temporarily disable AMD:

```js
const amd = window.define && window.define.amd;
if (amd) delete window.define.amd;
loadJsAsync(url).finally(() => { if (amd) window.define.amd = amd; });
```

(Pattern used by `socOverviewSankey-2.1.1`.)

### 22.4 Static data files (geojson, SVG, JSON)

Place under `widgetAssets/`; reference via:

```js
$http.get('widgets/installed/myWidget-1.0.0/widgetAssets/country.geojson')
```

---

## 23. Internationalisation (7.5.0+)

The translation helper `widgetUtility.service.js` ships in every localized widget. Copy it verbatim:

```
widgetAssets/
  js/
    widgetUtility.service.js         # Provided by the platform (same file for every widget)
  locales/
    en.json
    fr_fr.json
    ja.json
    ko.json
    zh_cn.json
    zh_tw.json
```

`en.json` is a key tree keyed by the widget name:

```json
{
  "myWidget": {
    "TITLE_DEFAULT": "My Widget",
    "LABEL_SEVERITY": "Severity"
  }
}
```

In the controller:

```js
// Must run before bindings fire.
function _handleTranslations() {
  const widgetNameVersion = widgetUtilityService.getWidgetNameVersion(
    $scope.$resolve && $scope.$resolve.widget,
    $scope.$resolve && $scope.$resolve.widgetBasePath
  );
  if (!widgetNameVersion) return $timeout(() => $scope.cancel());

  widgetUtilityService.checkTranslationMode(widgetNameVersion).then(() => {
    $scope.viewWidgetVars = {
      TITLE_DEFAULT: widgetUtilityService.translate('myWidget.TITLE_DEFAULT'),
      LABEL_SEVERITY: widgetUtilityService.translate('myWidget.LABEL_SEVERITY')
    };
  });
}
```

In the template:

```html
<h5>{{ viewWidgetVars.TITLE_DEFAULT }}</h5>
```

Preview inside Content Hub only works on 7.4.1+ when locales are present.

---

## 23.1 Shared filter state across tabs: scope keys per panel

A multi-panel widget with one `activeFilters` bag will eventually send a filter
to a panel that means something else by it. In `socAssistantMonitor` a live
session's `status` is `active|waiting_approval|idle` while an audit row's
`status` is `success|error`; clicking the "Pending HITL" card set
`status=waiting_approval` globally, so switching to the Audit tab queried for a
status no LLM call can have and rendered "No LLM calls recorded yet" over 45
real turns. The query returns `[]`, not an error -- nothing surfaces.

Declare which keys each panel accepts and project the shared bag through it:

```js
var _PANEL_KEYS = {
  sessions: { session_status: "status", user_iri: "user_iri" }, // widget key -> op param
  audit:    { status: "status", intent: "intent", user_iri: "user_iri" }
};
// chips render only visibleFilters(); ops receive only _panelFilters(panel)
```

Two related rules:

* **Filter on identity, display the name.** `toggleFilter('user_iri', u.name)`
  sends `"CS Admin"` into an IRI-keyed param -> zero rows. Send
  `/api/3/people/<uuid>` and carry the label separately for the chip.
* **Never render a chip on a panel that ignores it.** A chip that can't affect
  what's on screen is a UI that lies about why the list looks the way it does.

Test the forwarding *per panel*. The original suite asserted `loadAudit` passed
filters through and passed green for months while `loadLiveSessions` dropped
them entirely -- see [[parallel_name_lists_drift_bug_class]]: the same concept
living in two code paths needs an assertion on each.

---

## 24. Widget-to-widget communication

Use `$rootScope.$broadcast` with a namespaced event when two widgets on the same page need to sync (e.g., a tile that emits "user clicked card X" and a chart that filters to X):

```js
// Emitter (widget A)
$rootScope.$broadcast('widget:' + config.broadcastEvent, { recordId });

// Listener (widget B, configured with the same eventName)
$rootScope.$on('widget:' + config.eventName, (evt, payload) => { /* refresh */ });
```

Wire the event name through each widget's edit form so users can pair them up (see `recordSummaryCard`, `funnelChart`, `topX`, `happinessQuotient`).

---

## 25. Recipes

Each recipe below is a self-contained minimum viable widget. Copy, rename controllers per §5, adjust `info.json`, and iterate.

### 25.1 Dashboard aggregate chart

Scenario: group Alerts by Severity, show a pie chart.

**`info.json`**

```jsonc
{ "name": "alertsBySeverity", "title": "Alerts by Severity",
  "subTitle": "Pie chart of open alerts.", "version": "1.0.0",
  "published_date": 1700000000,
  "metadata": { "pages": ["Dashboard", "Reports"], "certified": "No",
                "publisher": "You", "compatibility": ["7.4.1"],
                "description": "..." } }
```

**`view.html`**

```html
<link rel="stylesheet" href="alertsBySeverity-1.0.0/widgetAssets/css/widget.css">
<div class="widget-container">
  <h5 data-ng-if="config.title">{{ config.title }}</h5>
  <div data-ng-if="!processing" data-cs-chart="chartOptions"></div>
  <cs-spinner data-ng-show="processing"></cs-spinner>
</div>
```

**`view.controller.js`**

```js
"use strict";
(function () {
  angular.module("cybersponse").controller("alertsBySeverity100Ctrl", Ctrl);
  Ctrl.$inject = ['$scope', 'config', 'CommonUtils'];
  function Ctrl($scope, config, CommonUtils) {
    $scope.config = config;
    $scope.processing = false;
    $scope.chartOptions = {
      wid: CommonUtils.generateUUID(),
      widgetAlwaysDisplay: true,
      showTabularData: false,
      aggregate: true,
      assignedToSetting: 'onlyMe',
      chart: 'pie',
      mapping: { fieldName: 'severity' },
      resource: 'alerts',
      title: config.title,
      query: {
        sort: [{ field: 'severity.orderIndex', direction: 'ASC' }],
        limit: 2147483647, logic: 'AND',
        filters: config.query && config.query.filters || [],
        aggregates: [
          { operator: 'countdistinct', field: '*',                alias: 'total' },
          { operator: 'groupby',       field: 'severity.itemValue', alias: 'severity' },
          { operator: 'groupby',       field: 'severity.color',     alias: 'color' },
          { operator: 'groupby',       field: 'severity.orderIndex',alias: 'orderIndex' }
        ]
      }
    };
  }
})();
```

**`edit.html`** -- title + `cs-conditional` filter builder (see §6 skeleton).
**`edit.controller.js`** -- loads modules, fields, closes modal with config.

### 25.2 View-Panel "current record" widget

Scenario: Show a badge derived from one field of the record currently being viewed.

**`info.json`**

```jsonc
{ "name": "myRecordBadge", "version": "1.0.0", ...
  "metadata": { "pages": ["View Panel"], ... } }
```

**`view.controller.js`**

```js
Ctrl.$inject = ['$scope', '$state', 'Modules', 'websocketService'];
function Ctrl($scope, $state, Modules, websocketService) {
  let sub;
  function load() {
    Modules.get({
      module: $state.params.module,
      id: $state.params.id,
      __selectFields: [$scope.config.fieldName]
    }).$promise.then(r => { $scope.value = r[$scope.config.fieldName]; });
  }
  function subscribe() {
    websocketService
      .subscribe(`${$state.params.module}/${$state.params.id}`, () => load())
      .then(s => sub = s);
  }
  $scope.$on('websocket:reconnect', subscribe);
  $scope.$on('$destroy', () => sub && websocketService.unsubscribe(sub));
  load();
  subscribe();
}
```

### 25.3 Record listing widget (cards on View Panel)

Pick a module, filter, list. Reuse `PagedCollection + Query`.

```js
Ctrl.$inject = ['$scope', 'config', 'PagedCollection', 'Query',
                'currentPermissionsService', '_'];
function Ctrl($scope, config, PagedCollection, Query,
              currentPermissionsService, _) {
  $scope.config = config;
  if (!currentPermissionsService.getPermission(config.module).read) {
    $scope.unauthorized = true; return;
  }
  const coll = new PagedCollection(config.module, null,
                                   { $limit: config.query.limit || 10 });
  config.query.__selectFields = _.values(config.mapping);
  coll.query = new Query(config.query);
  $scope.processing = true;
  coll.loadGridRecord()
    .then(() => { $scope.fieldRows = coll.fieldRows; })
    .finally(() => { $scope.processing = false; });
}
```

### 25.4 Drawer (FortiAI-style) widget

**`info.json`** -- see §18.

**`view.html`** -- standard drawer chrome (search, refresh, content panel). Handle drawer lifecycle:

```js
$scope.$on('popupOpened', refresh);
$scope.$on('popupClosed', cancelInFlight);
```

**`edit.html`** -- "no configuration" stub (see §6.3).

### 25.5 Wizard configuration widget

`view.html`:

```html
<wizard name="myWizard" on-finish="complete()">
  <wz-step title="Basics">
    <form name="step1">...</form>
    <button wz-next data-ng-disabled="step1.$invalid">Next</button>
  </wz-step>
  <wz-step title="Connector">
    <div ng-include="'widgets/installed/myWidget-1.0.0/widgetAssets/html/connectorConfig.html'"></div>
  </wz-step>
  <wz-step title="Finish">
    <button wz-finish>Save</button>
  </wz-step>
</wizard>
```

### 25.6 Settings (admin) widget -- no edit form

`"pages": ["Listing"]` or `[]`; `edit.html` is a stub. Fetch system state via `$http` / `settingsService`, update via `$resource.update` / `settingsService.set`.

### 25.7 Playbook-button widget

`playbookService.triggerPlaybookAction($scope, true, FormEntityService.get())` wired to a button. Remember to detach the websocket listener on `$destroy`.

### 25.8 Minimum copyright header (apply to EVERY `.js`/`.css`/`.html`)

```
/* Copyright start
   MIT License
   Copyright (c) 2025 Fortinet Inc
   Copyright end */
```

---

## 26. Widget catalog

Concise purpose + pattern tag per certified widget. Use this to find a close cousin before building from scratch.

Widget | Pages / Contexts | Pattern tag | Purpose
---|---|---|---
**accessControl-2.1.0** | `[]` (inline in views) | Record-form | Record owner/team assignment.
**aiAssistant-4.0.1** | drawer, standalone Half Width, `enableFor` list/detail/playbook/marketplace | Drawer, chat | Generative-AI assistant bot.
**besImpactEvaluation-1.0.0** | Dashboard | Connector dashboard | Best Effort Score impact evaluation.
**c3Charts-1.1.0** | Dashboard, Reports | Chart (c3) | Render arbitrary C3 charts from a JSON field.
**cardTiles-1.0.0** | View Panel, Listing | List cards | Card tile list of records w/ delete, search, refresh.
**cardView-1.0.0** | Dashboard, Reports, Listing | List cards + filter | Card view with infinite scroll & filter panel.
**categoricalInsights-1.0.0** | View Panel | Connector breakdown | Distribution bars from connector + API query.
**cicdConfiguration-1.1.1** | `[]` | Wizard | CI/CD source-control config.
**cicdContentImport-1.0.0** | `[]` | Wizard | Import content packs via CI/CD.
**configureIndicatorExtraction-2.0.0** | `[]` | Wizard + file upload | IOC extraction & regex editor.
**connectorHealthMonitor-1.0.0** | Dashboard, Reports, View Panel, Listing | System status | Lists connectors and per-agent health.
**customPicklistMessage-1.1.2** | View Panel | Record banner | Show message based on a picklist value.
**customTags-1.1.0** | Dashboard, View Panel | Connector augment | Threat-intel tag/card display.
**cyberThreatWorldMap-1.0.0** | Dashboard, View Panel, Reports, Listing, Add Form | Map (d3) | IOC geo distribution.
**dataVisualization-1.0.0** | Dashboard, Reports | Chart (echarts) | Sunburst/treemap/bar/line/pie (multi-mode).
**exportTemplateWizard-1.0.0** | View Panel | Modal launcher | Open export-template wizard modal.
**feedConfigurationSettings-2.0.0** | `[]` | Wizard | Threat-intel feed config.
**fieldsOfInterest-1.0.2** | View Panel (size `lg`) | Record form | Show selected fields regardless of visibility constraints.
**fortiAIConfiguration-3.0.0** | `[]` | Wizard | LLM connector setup (5-step).
**fortiguardIocSearch-1.0.0** | Dashboard | Connector search | Search FortiGuard for IOCs.
**funnelChart-1.0.2** | Dashboard, Reports | Chart (svg) | Funnel stages from JSON field or across-modules query.
**globalVisibilityConfiguration-1.0.0** | `[]` | Wizard | Remote-FortiSOAR connector setup.
**gridSummary-1.0.0** | View Panel, Dashboard, Reports, Listing | Grid | Render JSON as ui-grid.
**happinessQuotient-1.0.0** | Dashboard, View Panel, Reports | Animated metric | % as an animated mug.
**incidentCorrelations-2.1.1** | Dashboard, Reports | Graph (vis-net) | Correlation graph with Jinja-resolved incident id.
**incidentTimeline-1.0.1** | View Panel, Reports | Timeline | Vertical timeline of related alerts+indicators.
**jsonToGrid-1.1.0** | View Panel, Listing, Dashboard | Grid + playbook | ui-grid from playbook output; add/delete rows.
**killchainphases-1.1.0** | View Panel | SVG infographic | Phase counts from connector.
**languagePack-2.1.0** | `[]` | Stub | Language-pack availability advertiser.
**manageDatasets-1.0.0** | `[]` | Admin | TAXII dataset CRUD.
**mitreAttackSpread-1.0.2** | Dashboard, View Panel | Matrix tables | MITRE ATT&CK spread of alerts+incidents.
**mobileSettings-2.0.1** | `[]` | Stub | Placeholder for mobile-only config.
**multiTableView-1.0.0** | View Panel | Accordion + 2-way JSON | Edit JSON arrays within a record.
**outbreak-response-framework-configuration-wizard-1.0.0** | `[]` | Wizard | ORF setup (4-step).
**outbreakAlertConfiguration-2.2.1** | `[]` | Wizard + tabs | Threat-hunt tools multi-connector config.
**picklistAsPhases-1.1.0** | View Panel | Record form | Picklist values as a phases chevron.
**playbookButtons-1.1.1** | View Panel | Playbook trigger | Per-playbook record actions w/ conditions.
**playbookDeveloperAssistant-1.0.0** | drawer (Full Width), `pb_designer` | Drawer graph | vis.js playbook reference graph.
**playbookExecutionWizard-1.0.1** | standalone Full Width | Wizard + websocket | Live playbook execution UI.
**recordCard-1.0.1** | Listing, View Panel | List cards | Card tiles with click-through to record detail.
**recordCtaBlock-1.0.1** | View Panel, Listing | List cards + CTA | Cards w/ CTA button & websocket live updates.
**recordDistribution-1.0.5** | Dashboard, View Panel, Reports | Graph (svg) | Force-style graph of records by picklist.
**recordSummary-2.0.0** | View Panel | Record blocks | Time-elapsed / related-count / field blocks.
**recordSummaryCard-1.0.0** | Dashboard | JSON tile | Summary card from JSON field + broadcast events.
**recordSummaryTile-1.0.0** | Dashboard | JSON tile | Small/large tile derived from JSON field.
**roiCalculator-1.0.1** | Dashboard, Reports | Metric | Automation ROI by playbook tags.
**securityPosture-1.0.0** | Dashboard, View Panel | SVG + connector | FortiAnalyzer outbreak posture.
**setupGuide-1.3.0** | `header_navbar`, `launch_on_boot` | Onboarding | Accordion task list, launches other widgets.
**slaCountDownClock-2.0.1** | View Panel | Timer | Count-down/up clock for SLA states.
**socManagement-2.1.2** | Dashboard | Dashboard SVG | SOC KPIs with SVG foreignObject.
**socOverviewSankey-2.1.1** | Dashboard, Reports | Sankey | Cross-module flow diagram.
**speedometer-1.1.0** | View Panel | Gauge | SVG arc gauge of risk/score.
**submitContentForm-1.0.0** | drawer (`marketplace.*`) | Wizard | Upload content to Content Hub.
**taskManagement-2.0.0** | View Panel | Kanban | Swim-lane kanban (drag-drop + websocket).
**taxiiServerConfiguration-1.1.0** | Listing | Admin | Toggle TAXII server, list datasets.
**threatIntelManagementConfiguration-1.1.0** | `[]` | Wizard + tabs | Multi-connector threat-intel config.
**timeSeriesCharts-1.0.0** | Reports, Dashboard, Listing | Chart (c3) | Time-series from custom `time_series_charts` module.
**topX-1.0.0** | Dashboard | Chart | Top 3/5 of a picklist/JSON aggregate.
**userAssignments-2.1.2** | Dashboard, Reports, View Panel, Listing, Add Form | Metric + avatar | Per-user assignment counts.
**vtAugment-1.0.0** | View Panel | iframe enrich | Embedded VT widget for indicator records.

---

## 27. Cheatsheets

### 27.1 "I want to …" → reach for

Goal | Tool
---|---
Count records grouped by a picklist | `$http.post(API.QUERY + module)` with `aggregates: [countdistinct *, groupby picklist.itemValue, groupby picklist.color]`
List records in a grid | `PagedCollection` + `data-cs-grid`
Fetch one record | `Modules.get({ module, id, __selectFields })`
Fetch record + relationships | `new Entity(module).get(id, { $relationships: true })`
Get the viewed record (View Panel) | `$state.params.module` + `$state.params.id`
Get the form's entity (inside a form) | `FormEntityService.get()`
Open a modal | `$uibModal.open({ templateUrl, controller, resolve })`
Navigate to a module record | `$state.go(appModulesService.getState(module), { module, id })`
Render a filter builder | `data-cs-conditional data-mode="'queryFilters'" data-ng-model="config.query"`
Render a dynamic field | `data-cs-field data-ng-model="x" data-field="field"`
Validation error message | `data-cs-messages="form.fieldName"`
Spinner | `<cs-spinner data-ng-show="processing">`
Subscribe to record changes | `websocketService.subscribe(module+'/'+id, cb)`
Fire notification | `toaster.success({ body: 'Saved' })`
Trigger a playbook | `playbookService.triggerPlaybookAction($scope, true, entity)`
Call a connector action | `connectoconnectorServicerService.executeConnectorAction(name, version, action, configId, payload)`
Theme color | `$rootScope.theme.id` ∈ `light | steel | dark`
Translate a key | `widgetUtilityService.translate('widgetName.KEY')`
Launch a drawer widget programmatically | `widgetService.launchStandaloneWidget(name, version, resolveObj)`
Copy to clipboard | `CommonUtils.copyToClipboard(text)`
Generate a UUID | `CommonUtils.generateUUID()`
Get IRI's UUID | `$filter('getEndPathName')(iri)`
Get module type from IRI | `$filter('getModuleTypeOfIri')(iri)`

### 27.2 Route / state cheat sheet

State name | URL-ish | Use for
---|---|---
`main.dashboard` | `/main/dashboard` | Dashboard host
`main.reports` | `/main/reports` | Reports
`main.modules.list` | `/main/modules/<type>` | Module listing
`viewPanel.modulesDetail` | `/main/modules/<type>/<id>` | Record detail
`main.playbookDetail` | `/main/playbooks/<id>` | Playbook designer
`main.marketplace.workspace` | `/main/marketplace/workspace` | Content Hub

### 27.3 Controller DI checklist

- [ ] `$scope`, `config` (always)
- [ ] `$state` (View-Panel widgets)
- [ ] `$rootScope` (theme, broadcasts)
- [ ] `$uibModalInstance` (edit controllers only)
- [ ] `Query` + `PagedCollection` (list widgets)
- [ ] `Entity` + `Modules` (record widgets)
- [ ] `currentPermissionsService` (anything touching module data)
- [ ] `websocketService` (real-time)
- [ ] `widgetUtilityService` (localized widgets)
- [ ] `appModulesService` (edit controllers needing module list)

### 27.4 `info.json` pages → implied features

`pages` includes … | Runtime gets …
---|---
`"View Panel"` | `$state.params.module` + `$state.params.id`, parent form's `FormEntityService`
`"Dashboard"` / `"Reports"` | `page === 'dashboard'/'reporting'` → wide header CSS
`"Listing"` | Module implied by `$state.params.module`, user's current list filter ignored
`"Add Form"` | `FormEntityService.get()` is a partially-populated new entity
`"Settings"` | Admin-only; use `currentPermissionsService.isAdmin()`
`[]` + `contexts: ["drawer"]` | Drawer icon; `popupOpened`/`popupClosed` events

---

## 28. Pitfalls

1. **Wrong controller name.** `name: "fooBar"` + `version: "1.0.0"` must register `fooBar100Ctrl` / `editFooBar100Ctrl`. Mismatched names = silent failure with a blank cell.
2. **Missing `$inject`.** Minification strips parameter names. Without the explicit `$inject` array, the widget breaks in production.
3. **Missing copyright header.** Content Hub submission linter rejects files without the MIT block.
4. **Forgetting `data-` prefixes.** Raw `cs-field` often works in dev but some HTML parsers strip unknown attributes -- always use `data-cs-*`.
5. **Absolute CSS paths.** Using `/widgetAssets/...` breaks when the platform mounts under a sub-path. Always use relative or `widgets/installed/<name>-<version>/...`.
6. **Destroying charts / websockets on `$destroy`.** Omit this and you leak across dashboard refreshes. `chart.destroy()`, `websocketService.unsubscribe`, `$interval.cancel`.
7. **Theme map uses three IDs.** `light`, `steel`, `dark`. Don't branch on just light/dark.
8. **`published_date` type drift.** Unix seconds. Integers are preferred; strings work but some tooling sorts them lexicographically.
9. **`subTitle` vs `subtitle`.** Capital T.
10. **AMD conflict on CDN libs.** d3-sankey, c3, cytoscape all detect AMD and refuse to attach to `window`. Temporarily null out `window.define.amd`.
11. **`__selectFields` is essential for big modules.** Without it every record comes back with its full payload -- your dashboard will crawl.
12. **Using `$state.params.id` for an IRI.** It's a UUID. Build IRIs with `/api/3/<module>/<id>`.
13. **Relying on the widget to run on every page.** The platform caches config. Write the controller idempotently -- re-entry must reset `processing`, unsubscribe old websockets, and destroy old chart instances.
14. **Stale file permissions in the tarball.** Content Hub rejects files not readable by other. Run `chmod -R a+r .` before packing.
15. **Missing `compatibility` entry for the target version.** If `compatibility` doesn't list the user's FortiSOAR version, Content Hub won't let them install it.
16. **Drawer widgets need `standalone: true`.** Without it the modal renders but can't be launched from the drawer rail.
17. **Localized widgets before 7.4.1.** Preview is silently broken in older versions -- degrade gracefully by falling back to English on translation errors.
18. **Validation bypass.** Remember to `$setTouched()` and return early in `save()` when `$invalid`; otherwise users submit empty configs.
19. **Circular `$broadcast`.** Widgets broadcasting events on `$rootScope` can cascade into infinite loops if two widgets subscribe to each other's events with the same namespace.
20. **Connector calls without `configId`.** `executeConnectorAction` silently picks a random config if you pass `null`. Always resolve the config first.
21. **Deploy "publish" that only registers a draft.** Shipping a widget is two
    steps: `POST /api/3/solutionpacks/install?$type=widget&$replace=true` (tgz
    upload) **then** `PUT /api/3/widgets/<uuid>` to publish. The PUT must send
    **`draft: false`** to actually publish -- `PUT … {draft:true}` returns **200
    yet leaves the widget a DRAFT** (stays out of widget pickers, the Dev-strip
    publish pipeline may not run), forcing a manual publish from the UI.
    Verified on 205: published built-ins are `draft:false`; dev-pushed drafts are
    `draft:true`. **A 2xx is NOT proof of publish** -- validate the PUT response
    (or a follow-up GET) shows `draft === false` before declaring success. The
    harness `POST /_fsr/install/:id` now does this (`server.ts` `widgetIsPublished`).
22. **A 2xx from a resume/execute call is NOT proof the action ran.** For any
    human-approved action, the HTTP response tells you the *request* was
    accepted, not that the backend executed the tool. `fortiaiAgenticAssistant`
    stamped `_resolved` and painted a green "Approved" in `.then()`, so an
    approved containment action whose tool never ran (the connector returned
    `{"error": "unknown tool: …"}` inside the transcript) read as a success while
    the tool chip sat forever on "awaiting result". Grade the **outcome** from
    the response body -- scan the transcript for the matching `tool_result` and
    branch on `ok === false` / `error` / `code === 'user_denied'` -- and keep a
    neutral "awaiting result" state for when no result has arrived yet. Absence
    of evidence must never render as success. (`view.controller.js`
    `_approvalOutcome`; tests `approve.outcome.test.js`.)
23. **Rendered event vocabulary ≠ wire event vocabulary.** `fsrPbRender` MERGES a
    wire `tool_result` into the preceding `tool_call` chip, so a rendered message
    has **no** `type === 'tool_result'` event. Any controller logic that scans
    `msg.events` for tool activity (e.g. "did this turn move past the approval
    gate?") must match `'tool_call'`, not the wire name -- a guard written
    against the wire vocabulary silently never fires on a replayed transcript.
    Check the renderer's output shape (`buildAssistantMessage`) before matching
    on `type`.
24. **Card state gated on a scope singleton dies on refresh.** The approval card's
    buttons were gated on `$scope.approvalRequest`, which was only ever set from
    a *live* turn result. The connector keeps the parked approval (TTL 10m), so
    after a browser refresh the card replayed from `chat_history` with **no
    Approve/Reject buttons** -- the analyst could see an action waiting on them
    and had no way to act. Any interactive card whose actionability depends on
    scope state outside the event itself needs an explicit rehydrate step that
    rebuilds that state from the replayed transcript (`_rehydrateApprovalState`,
    alongside `_rehydrateBuildState`), and must not re-arm a gate that already
    resolved. See §7 for the render-model contract.

---
25. **A box-built solution pack ships stale widgets, and its dashboard pins go
    stale too.** FortiSOAR's export engine (`export_config` /
    `SolutionPackBuilder`) does NOT read the installed-widget table -- it serves
    widget tarballs out of the appliance's `/tmp/solutionpacks/` cache. An export
    produced `fortiaiAgenticAssistant-1.2.47` while 1.2.48 was both installed and
    the source version, and `socAssistantMonitor-1.0.9` while 1.0.2 was
    installed. Neither matched the box. Worse, a dashboard references a widget as
    `"type": "<name>-<version>"`, so every widget bump silently breaks the pin and
    the imported dashboard renders **blank** -- no import error. A name-only
    guard (`wtype.rsplit("-", 1)[0]`) does not catch this. Build the pack
    **locally** from the artifacts you control and repin the dashboard by name to
    the version the pack carries:
    `scripts/build_soc_assistant_pack.py` (playbook-builder repo) -- offline,
    ~0.1s vs ~60s, and self-consistent by construction.

## 29. Platform source references (host UI code)

How to locate and read the host UI's templates, directives, and services when a widget must mirror platform behavior -- grep recipes for walking the stripped SOAR bundle.

> **Full reference:** [`docs/kb/platform-source-refs.md`](fortisoar-widget-harness/docs/kb/platform-source-refs.md)
## Appendix A -- `API` constants

Injected via the `API` / `Constants` provider (see §8.1). Verbatim from the PDF / source.

```js
API.BASE                    = 'api/3/'
API.API_3_BASE              = '/api/3/'
API.TEMPLATE                = 'api/3/template/'
API.WORKFLOW                = 'api/wf/'
API.WORKFLOW_HEALTH         = 'api/wf/workflow/healthcheck/job/'
API.INTEGRATIONS            = 'api/integration/'
API.SEALAB                  = 'wf/'
API.ETL                     = 'gateway/etl/'
API.AUDIT                   = 'api/gateway/audit/'
API.AUTH                    = 'api/auth/'
API.PUBLIC                  = 'api/public/'
API.QUERY                   = 'api/query/'
API.QUERIES                 = 'api/3/queries'
API.REPORTS                 = 'gateway/report/'
API.DAS                     = 'auth/'
API.POSTMAN                 = 'api/postman/'
API.SAML                    = 'api/saml/'
API.SEARCH                  = 'api/search/'
API.ARCHIVAL                = 'api/archival/'
API.PUBLISH                 = 'api/publish'
API.MANUAL_TRIGGER          = 'api/triggers/1/notrigger/'
API.WORKFLOW_STEPS          = 'workflow_steps/'
API.WORKFLOW_GROUPS         = 'workflow_groups/'
API.WORKFLOW_BLOCKS         = 'workflow_blocks/'
API.WORKFLOWS               = 'workflows/'
API.WORKFLOW_ACTION         = 'api/workflows/actions'
API.REVERT                  = 'api/publish/revert'
API.PUBLISH_ERROR           = 'api/publish/error'
API.ACTION_TRIGGER          = 'api/triggers/1/action/'
API.CURRENT_AVATAR          = 'avatars/current/'
API.CURRENT_ACTOR           = 'actors/current/'
API.AUTHENTICATION          = 'authentication/'
API.ROLES_TEAM_READ_ONLY    = 'api/userteam'
API.USER_PREF_PREFIX        = 'user/view/'
API.REMOTE_ACTION_EXECUTION = 'api/integration/remote-action-execution/'
API.API_HMAC_TRIGGER_URL    = 'api/triggers/1/'
API.IMPORT                  = 'api/import/'
API.EXPORT                  = 'api/export/'
API.SYSLOG_CONFIG           = 'api/gateway/config/syslog'
API.API                     = 'api'
API.WEBSOCKET               = 'websocket/cyops-websocket'
API.SYSTEM_MODULES          = 'api/system/fixtures'
API.RULE                    = 'api/rule/'
API.DELETE_WITH_QUERY       = 'api/3/delete-with-query/'
API.EXPORT_TEMPLATES        = 'api/3/export_templates/'
API.SOLUTION_PACKS          = 'api/3/solutionpacks/'
```

Playbook step types (constants):

```js
PLAYBOOK_STEP_TYPES.API_TRIGGER              = 'cybersponse.api_call'
PLAYBOOK_STEP_TYPES.ACTION_TRIGGER           = 'cybersponse.action'
PLAYBOOK_STEP_TYPES.ABSTRACT_TRIGGER         = 'cybersponse.abstract_trigger'
PLAYBOOK_STEP_TYPES.DECISION                 = 'Decision'
PLAYBOOK_STEP_TYPES.MANUAL_DECISION          = 'ManualDecision'
PLAYBOOK_STEP_TYPES.MANUAL_INPUT             = 'ManualInput'
PLAYBOOK_STEP_TYPES.APPROVAL_MANUAL_INPUT    = 'ApprovalManualInput'
PLAYBOOK_STEP_TYPES.SET_VARIABLE             = 'SetVariable'
PLAYBOOK_STEP_TYPES.INSERT_DATA              = 'InsertData'
PLAYBOOK_STEP_TYPES.UPDATE_DATA              = 'UpdateRecord'
PLAYBOOK_STEP_TYPES.REFERENCE_BLOCK          = 'ReferenceBlock'
PLAYBOOK_STEP_TYPES.TRIGGER_REFERENCE_BLOCK  = 'action.reference.block'
PLAYBOOK_STEP_TYPES.POST_DELETE_TRIGGER      = 'cybersponse.post_delete'
PLAYBOOK_STEP_TYPES.PRE_DELETE_TRIGGER       = 'cybersponse.pre_delete'
PLAYBOOK_STEP_TYPES.POST_CREATE_TRIGGER      = 'cybersponse.post_create'
PLAYBOOK_STEP_TYPES.PRE_CREATE_TRIGGER       = 'cybersponse.pre_create'
PLAYBOOK_STEP_TYPES.POST_UPDATE_TRIGGER      = 'cybersponse.post_update'
PLAYBOOK_STEP_TYPES.PRE_UPDATE_TRIGGER       = 'cybersponse.pre_update'
PLAYBOOK_STEP_TYPES.MANUAL_DECISION_STEP_TYPE= '/api/3/workflow_step_types/dc61b68b-4967-4e82-b4ed-a1315aa81998'
PLAYBOOK_STEP_TYPES.MANUAL_INPUT_STEP_TYPE   = '/api/3/workflow_step_types/fc04082a-d7dc-4299-96fb-6837b1baa0fe'
```

---

## Appendix B -- Field `formType` values

Supported by the `data-cs-field` directive (from PDF p. 34-36):

`password`, `text`, `checkbox`, `integer`, `checkbox.select`, `decimal`, `datetime`, `Datetime.advance`, `phone`, `email`, `DynamicList`, `multiselect`, `richtext`, `json`, `textarea`, `picklists`, `multiselectpicklist`, `lookup`, `ipv4`, `ipv6`, `domain`, `url`, `tags`.

Field constructor:

```js
const f = new Field({
  name:      'severity',           // Field name as stored on the module
  formType:  'picklists',
  title:     'Severity',
  writeable: true,
  validation: { required: true, pattern: /^.+$/ },
  // For lookups:
  dataSource: { module: 'people', fieldName: 'email' },
  // For picklists:
  picklistName: 'severity'
});
f.evaluateRequired(entity);
f.evaluateVisible(entity);
f.getFormValue();
```

Field-Options (passed via `data-field-options` on `cs-field`):

```js
{
  linky: true,              // Turn URLs into links
  readOnly: false,
  highlightMode: false,
  entity: { module: 'alerts', id: '...' }   // For multiselect lookups
}
```

---

## 30. Building widgets that reuse SOAR's connector-action UI

Reusing the platform's connector-action rendering (`cs-connector-actions`, `connectorActionListing`) inside a custom widget -- scope contract and how configured connectors are surfaced.

> **Full reference:** [`docs/kb/connector-action-ui.md`](fortisoar-widget-harness/docs/kb/connector-action-ui.md)
## 31. Adding a custom theme to the SOAR system-settings dropdown

This is a SOAR appliance modification, not a widget -- but it's grouped here
because the discovery path uses the same de-min / grep techniques as §29.

### How themes work in SOAR

- The list of selectable themes is a plain JSON registry on the appliance:
  `/opt/cyops-ui/app/settings/themes.json`. Each entry has
  `{id, name, path, type}`. `name` is an i18n key, `path` is the bundled CSS
  file under `css/themes/`, `type` is `dark` or `light` (used by components
  that branch on background luminance).
- `cindex.html` always loads `css/themes/steel.<hash>.css` as a baseline,
  then layers the selected theme on top via
  `<link rel="stylesheet" data-ng-href="{{theme.path}}">`. Switching themes
  just rebinds `theme.path` -- no reload required.
- `themesService` (factory in `app.unmin.js` ~ line 45470) loads
  `themes.json`, runs each `name` through `translationService.instantTranslate`,
  caches via `localStorageService` + `PromiseQueue`, and exposes
  `get()` / `applyTheme()`. **There is no filter** -- every entry in the JSON
  is shown. The three consumers (`GeneralCtrl` ~42377, `UserCtrl` ~41136,
  `UserPreferenceSettingsCtrl` ~64097) just bind the full array. If a theme
  appears in the JSON but not in the dropdown, it's stale browser/local
  storage cache; hard-refresh and clear local storage.
- Out of the box on 7.6.x, `themes.json` ships **four** themes
  (`dark`, `light`, `steel`/"Space", `deepSea`) even though older builds
  only surfaced three.

### Steps to add your own theme

1. **Copy a stock theme CSS as a starting point** (pick whichever palette
   is closest to what you want):

   ```bash
   sudo cp -p /opt/cyops-ui/css/themes/steel.4f959b81.css \
              /opt/cyops-ui/css/themes/mytheme.css
   ```

   Use an unhashed filename -- SOAR upgrades re-hash the stock files but
   leave unknown ones alone.

2. **Edit the colors.** A useful diff to see the surface area:

   ```bash
   diff <(sed 's/#[0-9a-fA-F]\{6\}/X/g' /opt/cyops-ui/css/themes/dark.*.css) \
        <(sed 's/#[0-9a-fA-F]\{6\}/X/g' /opt/cyops-ui/css/themes/steel.*.css)
   ```

   Most differences are color literals; that's what you're retheming.

3. **Register it in `themes.json`:**

   ```bash
   sudo cp -p /opt/cyops-ui/app/settings/themes.json \
              /opt/cyops-ui/app/settings/themes.json.bak
   ```

   Add an entry:

   ```json
   {"id":"mytheme","name":"My Theme","path":"css/themes/mytheme.css","type":"dark"}
   ```

   `name` can be a literal string -- angular-translate falls back to the
   key when no locale entry exists. If you want a real translation, add
   `"SETTINGS.GENERAL_CONFIG.THEME_MYTHEME": "My Theme"` to each
   `/opt/cyops-ui/locales/<lang>.json` you care about and use that key in
   `name` instead.

4. **Hard-refresh the browser** (cache + local storage). No `cyops-ui`
   service restart required -- `themes.json` is fetched at runtime and
   the CSS is loaded by the `<link>` swap.

5. **Verify** in DevTools: switching to your theme should change the
   `data-ng-href` of the second `<link>` in `<head>` to your CSS path.
   The `<body>` class continues to read `theme-<id>` for components that
   key off it directly (search the CSS for `.theme-steel` to see what
   does).

### Survival across upgrades

A SOAR upgrade rewrites `themes.json` and re-hashes the stock CSS
filenames; your `mytheme.css` survives but the JSON entry is wiped.
Wrap steps 1 and 3 in an idempotent post-upgrade script (check whether
the file/entry already exists before adding) and re-run after each
upgrade.

### Why this is not a widget

There is no widget hook for system-level theming -- themes are loaded
before the Angular app's widget system bootstraps. A widget can inject
its own `<link>` and toggle a class on `<body>`, but it can't add an
option to the system-settings dropdown. If you don't have shell access
to the appliance, the widget-injection workaround is the only path; with
shell access, edit `themes.json` directly as above.

---

## 32. Harness gaps from the stripped SOAR bundle

The harness loads `fsr_src/app.unmin.js` (the full SOAR app), but that bundle
has angular-ui-bootstrap and a few sibling vendor modules **stripped out** --
their directive/factory registrations live in separate vendor scripts in real
SOAR. Anything in SOAR templates that depends on those vendors (`uib-popover`,
`uib-tooltip`, `uib-popover-template`, `uib-modal`, `uib-typeahead`, etc.)
silently no-ops in the harness because the directive simply isn't registered.

### Symptom pattern

A SOAR-rendered control looks correct (button labels, placeholders, structure
all there) but **clicking does nothing** -- no popover, no dropdown, no modal,
no console error. The directive attribute (`data-uib-popover-template=...`)
sits inert on the element because Angular found no matching directive and
therefore wired up no event handler.

This is distinct from the "literal `{{ ... }}` in the DOM" symptom, which is
caused by translation strings missing param interpolation (see harness
`translate` filter -- must call `$interpolate(str)(params)` not just look up
the key).

### Diagnosis

1. `grep -c "directiveName" fsr_src/app.unmin.js` -- if matches are only
   *usages* (`uib-popover-template="..."`) and zero *registrations*
   (`directive("uibPopoverTemplate", ...)` or
   `module("ui.bootstrap").directive(...)`), the vendor module is stripped.
2. Cross-check by grepping the harness for that vendor module's name in
   `HARNESS_VENDOR_DEPS` (server.js) -- if it's not listed, cybersponse
   doesn't pull it in either.

### Fix recipe (the picklist popover case, applies generally)

The cs-conditional value picker (Status, Severity, etc.) uses
`uib-popover-template` referencing `app/components/form/typeahead/lookupPopover.html`.
Three things were missing in the harness:

1. **The `ui.bootstrap` module itself.** Loaded `angular-ui-bootstrap-tpls@2.5.6`
   from CDN in `public/index.html` *before* `/_fsr/app.unmin.js`, and added
   `"ui.bootstrap"` to `HARNESS_VENDOR_DEPS` in `server.js` so cybersponse
   declares it as a dep.
2. **The popup template.** SOAR's templates live in
   `fsr_src/templates.min.a64ddbd8.js` (one big `cybersponse.run()` block of
   `$templateCache.put(...)` calls). Added a `/_fsr/templates.min.js` route
   in `server.js` and a `<script>` tag in `public/index.html` to load it
   between `app.unmin.js` and `harness.module.js`.
3. **Removed colliding shims.** harness.module.js had hand-rolled
   `uibDropdown` / `uibDropdownToggle` / `uibDropdownMenu` shims that double-
   registered against the now-real ones. Deleted the shims; kept the
   `$uibModal` stub for now (real `$uibModal` could open unwanted modals;
   revisit per-call-site).

After: clicking the value button opens the real popover, picklistsService
(which was always in app.unmin.js) fetches values, and selection persists
into `$scope.config.customFilters` with the correct `<module>.uuid in [...]`
shape.

### Known stripped vendors (load these in the harness)

Loaded from CDN + listed in `HARNESS_VENDOR_DEPS` (server.js):
- `ui.bootstrap` -- uib-popover, uib-tooltip, uib-modal, uib-dropdown,
  uib-tabset, uib-accordion, uib-collapse, uib-progressbar, uib-pagination,
  uib-btn-checkbox/radio, etc. (~1000 attribute uses across SOAR templates)
- `ui.select` -- the `<ui-select>` element used by csMultiselect for
  `in`/`nin` operators (~150 uses)
- `ngSanitize` -- `$sanitize` for `ng-bind-html` safe content
- `angularMoment` -- `amTimeAgo` etc. date filters (requires `moment` first)
- `ngFileUpload` -- `Upload` service injected by file-picker controllers

Skipped on purpose (would clash with harness stubs or need extra setup;
add only if a feature actually requires the real implementation):
- `angular-local-storage` -- `localStorageService` is stubbed in
  harness.module.js
- `angular-toaster` -- `toaster` is stubbed; real one needs a
  `<toaster-container>` mount point
- `angular-ui-router` -- `$state` is stubbed; real one would try to route
  away from the harness shell

Expect more discoveries -- every `grep -c 'directive("X"' fsr_src/app.unmin.js`
that returns 0 for a directive used in stock SOAR templates is a candidate.

### Bonus gotcha: SOAR's templates bundle has broken expressions

`fsr_src/templates.min.a64ddbd8.js` ships at least one malformed ng-show
expression: `ng-show="($select.items.length > 0) ||"` (dangling `||`) on
the `ui-select-choices` element of the multiselect template (5 occurrences
across templates that use ui-select). `$parse` throws `ueoe` (Unexpected
End Of Expression), which aborts compilation of cs-conditional's value
cell when the operator is `in` / `nin`, so the multiselect picker silently
never renders. Real SOAR loads more vendor scripts that may swallow it.
The harness patches the bundle on serve in `server.js`'s
`/_fsr/templates.min.js` route by string-replacing the trailing `||"` with
`"`. When you add/upgrade the templates bundle, re-run
`grep -c 'items.length > 0) ||"' templates.min.*.js` and update the patch
match if SOAR fixed it upstream.

### When you hit a similar gap

Suspect a stripped vendor any time SOAR's stock UI renders but doesn't react.
The fix is almost always: declare the missing module in `HARNESS_VENDOR_DEPS`,
load the vendor lib + any required templates before bootstrap, and remove
manual shims that are now redundant. Plan B (when loading the real lib is too
disruptive) is a one-directive shim -- only worth it for tightly-scoped
features.

---

## 33. Harness surfaces widget render errors (view + edit modal)

A widget controller that throws synchronously during construction or its first
`$digest` (e.g. dereferencing an unconfigured config field like
`config.actionButtons[0].uuid`) is routed to AngularJS's `$exceptionHandler`,
which **swallows it** -- `angular.bootstrap` never rejects. The result is a
**blank/empty render** (`#widget-host` shows the bare `ng-controller` div, or the
edit-config modal is empty) with the error visible only in DevTools.

The harness now closes that hole. During the mount window it sets
`window.__HARNESS_MOUNTING` around `angular.bootstrap`; `harness.module.js`'s
`$exceptionHandler` stashes the **first** error on `window.__HARNESS_RENDER_ERROR`
(`{controller, message, stack}`), and `public/index.html` renders a visible red
panel (controller name + message + stack) into the host -- for **both** the view
mount and the edit-config modal. The global is also a machine-readable signal for
e2e/automation, mirroring `window.__HARNESS_LINT_BLOCKED__`.

So: if a widget mounts blank in the harness, you'll now see the throw inline. The
full error (with `$q` creation stack) is also in the Debug drawer → Errors tab.

## 34. Diagnosing "edit.html (or the whole widget) won't render" -- checklist

Blank modal / empty widget with no obvious error. Causes, ordered by where they
bite:

1. **Controller ↔ `info.json` version desync (real box AND harness).** The #1
   box cause. SOAR derives the expected controller name `<name><digits>DevCtrl`
   (and `edit<Name><digits>DevCtrl`) from `info.json.version` at install time;
   the numeric version (`1.3.1`→`131`) must match the suffix registered in
   `view.controller.js` **and** `edit.controller.js` (plus any `ng-controller`/CSS
   href in templates). Mismatch → SOAR can't instantiate → **blank, no error.**
   **Never hand-edit `info.json` version** -- only the CLI bump rewrites the names
   in lockstep (`node scripts/widget.js push <id> --bump patch`, which fast-fails
   on desync). A blank modal on the box with *consistent source* almost always
   means the **installed** package predates the sync -- just re-push.
2. **`moduleAttribute` registry empty (harness only).** Field value inputs render
   as empty `<div>`s. Not a box cause. See "moduleAttribute registry" memory.
3. **csField `$parent.value` misbind (harness only).** Inputs show
   `[object Object]`. Not a box cause.
4. **cs-conditional dropdown empty (both).** A *dropdown* (not the whole form)
   stays empty until the controller `$broadcast('conditional:fieldListChanged')`
   after an async field load.
5. **Stripped `uib-*` vendors (harness only).** `uib-*` directives no-op silently
   -- see "Harness gaps from the stripped SOAR bundle" above.

Note the **bump now also rewrites the widget's sibling `tests/` tree** (controller
names + versioned IDs, skipping `node_modules`), so a version bump no longer reds
the widget's own unit/e2e suite with a stale hardcoded controller name.

## 35. Releasing a widget (GitHub release flow)

Each widget lives in **its own git repo** (e.g. `ftnt-dspille/widget-json-to-grid`),
with a single GitHub Actions workflow that publishes a downloadable `.tgz` on
every version bump. The flow is **bump → commit → push to `develop`** -- nothing
else. No manual tagging, no manual `gh release`.

### 30.1 How to cut a release

1. **Bump the version through the CLI/packager -- never hand-edit `info.json`.**
   The controller name embeds the numeric version (`jsonToGrid131DevCtrl` →
   `jsonToGrid132DevCtrl`); hand-editing desyncs it and trips the stale-version
   lint. Use `widget bump <id> --bump patch`, or call the packager's
   `syncSourceToInfoJson(<widgetDir>, <name>, <newVersion>)` against the **inner
   `widget/` dir** (it joins `view.controller.js` etc. directly and sweeps the
   sibling `tests/` tree). It rewrites `info.json` + every controller name +
   versioned path/ID refs in source **and** tests atomically.
2. **Verify locally what CI runs:** `npm test` (jest) and `npm run package`
   (must emit `dist/<name>-<version>.tgz`).
3. **Commit and push to `develop`.** If you split into multiple commits, the
   commit that bumps `info.json` must be **HEAD** (or at least the version at
   HEAD must differ from HEAD~1) -- the workflow compares `HEAD` vs `HEAD~1`
   `info.json` and skips if unchanged.

The workflow then tags `v<version>`, packages, and publishes a GitHub Release
with two assets:
- `<name>-<version>.tgz` -- the versioned artifact
- `<name>-latest.tgz` -- a version-agnostic copy, so there is a **permanent
  latest-download URL**:
  `https://github.com/<owner>/<repo>/releases/latest/download/<name>-latest.tgz`

### 30.2 Two hazards the pipeline design avoids (don't reintroduce them)

- **One workflow, not two.** A tag pushed by a separate job using the default
  `GITHUB_TOKEN` does **not** trigger a tag-keyed workflow -- GitHub suppresses
  workflow runs from `GITHUB_TOKEN` events to prevent recursion. A split
  `tag.yml` (push tag) → `release.yml` (on `v*` tag) chain therefore never hands
  off and silently produces zero releases. Keep tagging + releasing in the
  **same** job (branch-triggered), or push the tag with a PAT.
- **Trigger on the real default branch.** This repo's default branch is
  `develop` (there is no `main`); release branches are `release/*` and legacy
  tags are `release-*`. A workflow keyed on `main` never fires. Confirm the
  branch name (`git remote show origin` / `remotes/origin/HEAD`) before keying a
  workflow to it.

The canonical example is `widget-json-to-grid/.github/workflows/release.yml`
(`on: push: branches:[develop], paths:[widget/info.json]` + `workflow_dispatch`;
detect version change → install → test → package + latest copy → tag → release).

(Deploying to a live FortiSOAR box is a **separate** path -- see §19.3 and the
harness `make ship-verify` / `widget push` flow, which uploads the tgz via
`solutionpacks/install` then publishes with `draft:false`. GitHub release ≠ box
deploy.)

## License

All files in this knowledgebase that you copy into new widgets must carry:

```
MIT License
Copyright (c) <year> Fortinet Inc
```

Third-party libraries (d3, c3, echarts, vis, etc.) retain their original licenses -- ship them under `widgetAssets/js/` or load from a CDN as described in §22.

---

## 36. Troubleshooting widget mount & render (harness + e2e) {#troubleshooting-widget-mount--render}

Distilled from building `ztpAutomationGraph` -- a Cytoscape.js node-graph panel
widget on `ztpf_devices` (`widgets-src/ztpAutomationGraph/`). Most of these are
non-obvious and cost real debugging time; check here before grepping.

### 32.0 Three e2e failure modes that are NOT widget bugs

Chased on `socAssistantMonitor`. All three present as "random test fails, a
different one each run" -- the trap is treating them as a widget defect.

**a) Another e2e run is on the same ports.** The mock servers are per-worker on
`14401 + parallelIndex` with `reuseExistingServer: true`, so a second `make
test-e2e-*` (yours, another agent's, a flake-detection loop) silently shares
them and both runs go dirty. ALWAYS check before believing a failure:
```
pgrep -fl "test-e2e|playwright.*test " | grep -v grep
```
`E2E_BASE_PORT=14501 make test-e2e-spec SPEC=...` runs a second invocation
without contending.

**b) `ECONNRESET` on `GET /_fsr/widgets`.** Playwright's request context reuses
keep-alive sockets; Node closes an idle one on its own timeout, so a request
issued in that instant is reset by a perfectly healthy server -- before the
widget ever mounts. `mountWidget` now replays it (`fetchWidgetList`,
`_widgetHarness.js`). This is not a test retry: the request never reached a
handler, and any HTTP response including 5xx is still returned as-is.

**c) A DIFFERENT widget's lint banner is what you're looking at.**
`public/index.html` falls back to `widgets[0]` when `localStorage['harness.widget']`
is empty -- which it always is in a fresh Playwright context -- and
`_widgetHarness.js`'s settle check accepts an error panel as terminal content
(`if (!ctrl) return true`). So a lint-broken widget earlier in the list (today:
`counter`, `edit-config-inject`) settles the mount and your spec times out
blaming your widget. Seed the selection before first paint:
```js
await page.addInitScript(([id]) => {
  localStorage.setItem('harness.widget', id);
  localStorage.setItem('harness.ctx', 'dashboard');
}, [WIDGET_ID]);
```
`mountWidget`/`resolveWidgetId` also match by NAME first, so several packaged
builds sharing one name are ambiguous -- pin the id from the widget's own
`info.json` rather than resolving it.

### 32.1 The render-state machine -- read it first
The harness exposes `window.__HARNESS_RENDER_STATE = { phase, lastError, ... }`.
`phase` cycles `idle → mounting → rendered | error`. `waitForRender()`
(`fortisoar-widget-harness/tests/e2e/_render.js`) waits for `rendered`/`error`
and THROWS on `lastError` (a swallowed controller/digest throw the harness
captured). A `waitForRender` TIMEOUT means phase is stuck at `mounting` -- the
widget didn't finish booting (usually a settle block, §32.4 -- NOT a throw).

Diagnostic that won't itself time out -- add a temporary test that `page.route`s
+ `addInitScript`s (seed `harness.widget`/`ctx`/`module`/`id`) + `goto('/')` +
`waitForTimeout(3000)` + `page.evaluate(() => ({ renderState, renderError,
libsLoaded, rootCount, cyCanvasCount, ... }))` (do NOT call `waitForRender`):
```js
page.on('console', m => { if (m.type()==='error') console.log('[PAGE]', m.text()); });
page.on('pageerror', e => console.log('[PAGEERROR]', e.message));
page.on('requestfailed', r => console.log('[REQFAIL]', r.url(), r.failure()?.errorText));
```
The swallowed digest error may not surface on the console, but library/cytoscape
errors do.

### 32.2 Widget discovered but won't mount (`widget: --` in the harness UI)
- A `<script src>` in view.html that 404s or throws during parse aborts mount.
  Check `requestfailed` + the in-page Debug panel.
- A controller throw in the synchronous `init()` body → captured as
  `__HARNESS_RENDER_ERROR` → phase `error` → `waitForRender` THROWS (with the
  message), it does NOT time out. **A timeout (stuck `mounting`) is almost never
  a controller throw** -- it's a settle block (§32.4) or an unsatisfied $http.

### 32.3 Vendored JS library load order (Cytoscape / dagre / extensions)
The harness auto-injects EVERY `widgetAssets/**/*.js` in **lexical (filesystem)
order** -- NOT the order of `<script>` tags in view.html (Angular `$compile`
doesn't execute `<script>` tags in templates). So `cytoscape-dagre.js` (c) loads
before `cytoscape.min.js` + `dagre.min.js` → the extension fails to register →
`Error: No such layout `dagre` found` at render time.
Harness-only fix: numeric-prefix rename so lexical order = dependency order
(`1-dagre.min.js`, `2-cytoscape.min.js`, `3-cytoscape-dagre.js`). A dep-free
module like `ztpGraph.js` sorts after and is fine anywhere. Also register
defensively and fall back to a built-in layout if the extension didn't load:
```js
function layoutFor(els) {
  var C = $window.cytoscape;
  if (C && C.use && $window.cytoscapeDagre && !C._ztpDagreRegistered) {
    try { C.use($window.cytoscapeDagre); } catch (e) { /* already registered */ }
    C._ztpDagreRegistered = true;
  }
  return $window.cytoscapeDagre
    ? { name: "dagre", rankDir: "LR", nodeSep: 36, rankSep: 70, animate: false }
    : { name: "breadthfirst", directed: true, circle: false,
        roots: els.nodes.length ? [els.nodes[0].data.id] : undefined };
}
```

#### 32.3.1 SOAR (the real box) loads widgetAssets JS in ARRIVAL order, not lexical -- and it is an AMD/RequireJS env
**The numeric-prefix fix above is a harness-only fix. On the real box it does
NOT work**, and applying it blindly (as `ztpAutomationGraph` first did) produces
"Cytoscape failed to load." with no other clue. Two platform facts, both
confirmed live on FortiSOAR 7.6.5 (box 168) by driving the page with Playwright
and probing `window`:

1. **SOAR auto-injects `widgetAssets/**/*.js` in PARALLEL and executes each on
   arrival -- NOT document/`<script>` order, NOT lexical order.** Six files with
   `1-`/`2-`/`3-` prefixes were observed executing in network-arrival order
   (`0-noamd → 3-cytoscape-dagre → 9-restore → ztpGraph → 1-dagre → 2-cytoscape`).
   The `<script src>` tags in view.html are ignored on SOAR (Angular `$compile`
   doesn't run them) -- certified widgets like `cyberThreatWorldMap` ship NO
   `<script>` tags and still get `d3` as a bare global, proving auto-injection.
   So per-file prefix ordering is meaningless on SOAR; it only helps the harness.
2. **SOAR's app shell is an AMD/RequireJS environment** (`typeof window.define
   === 'function' && define.amd === true`, `define` writable). A vendored **UMD**
   lib loaded via auto-injection sees `define.amd`, takes its AMD branch, and
   calls anonymous `define([...], factory)`. RequireJS rejects that -- page error
   **"Can only have one anonymous define call per script file"** (once per UMD
   file) -- and the lib **never attaches its global** (`window.cytoscape` stays
   `undefined`). The widget then hits its own `if (!window.cytoscape)` guard and
   shows "Cytoscape failed to load." `dagre` happens to set `window.dagre` from
   both branches so it survives; `cytoscape` and `cytoscape-dagre` do not.

**Fix that works on BOTH harness and box: bundle the UMD libs into ONE file**
so load order is intrinsic to a single script (one file = one execution, order
guaranteed by concatenation). Put an AMD-disable prelude at the top and a
restore postlude at the bottom so every UMD wrapper inside takes its **global
branch** (attaches to `window`) instead of calling `define()`:
```js
// graph-bundle.js = prelude + dagre + cytoscape + cytoscape-dagre + postlude
(function(){ // prelude: force UMD global branch
  if (typeof window !== "undefined") {
    window.__ztpRealDefine = window.define;
    window.define = undefined;
  }
})();
;<dagre.min.js> ;<cytoscape.min.js> ;<cytoscape-dagre.js>
;(function(){ // postlude: restore AMD for the rest of the app
  if (typeof window !== "undefined" && "__ztpRealDefine" in window) {
    window.define = window.__ztpRealDefine;
    try { delete window.__ztpRealDefine; } catch (e) { window.__ztpRealDefine = undefined; }
  }
})();
```
Keep the bundle + the dep-free `ztpGraph.js` as the only `widgetAssets/js`
files (delete the loose `1-/2-/3-` UMD files so they aren't auto-injected
separately and re-conflicted). In the harness (no AMD) the prelude/postlude are
no-ops and lexical order still works; on SOAR the single-file execution makes
order deterministic. The bundle is idempotent, so it's safe if the platform
loads it more than once. Assemble with a tiny node script (cat prelude + `;\n` +
files + `;\n` + postlude); the min.js files end in `});` so `;` joins are safe.
**Do not try to "shim" with separate `0-noamd.js` / `9-restore.js` files** --
because of fact (1) they execute in arrival order, so `9-restore` can run before
`2-cytoscape` arrives and re-enable AMD mid-load (observed). One file, or
nothing.

### 32.4 Polling blocks render-state settle
A live-update poll via Angular `$timeout(refresh, ms)` chains forever (each
refresh reschedules) → the harness `settle()` (drains digests/$http/$timeout to
quiescence) never reaches idle → phase stuck at `mounting` → `waitForRender`
timeout. Symptom: widget renders fine (rootText has your data) but the test times
out at `waitForFunction`.
Fix: poll with **raw `setTimeout`** (outside Angular's `$timeout` queue -- settle
ignores it) + `$scope.$applyAsync(refresh)` to re-enter a digest:
```js
function schedulePoll(seconds) {
  cancelPoll();
  var ms = Math.max(2, Number(seconds) || 6) * 1000;
  pollTimer = $window.setTimeout(function () { $scope.$applyAsync(refresh); }, ms);
}
function cancelPoll() { if (pollTimer) { $window.clearTimeout(pollTimer); pollTimer = null; } }
// $scope.$on("$destroy", cancelPoll) -- also stops pulse animations + cy.destroy()
```
In jest, mock `$window.setTimeout`/`clearTimeout` (delegate to the globals) and
call `$scope.$destroy()` at the end of the success test to cancel the open timer
(otherwise jest hangs on an open handle).

### 32.4.1 Inline-SVG node icons squash on zoom -- give the SVG intrinsic width/height
A cytoscape node `background-image` set to an inline `data:image/svg+xml` glyph
with only a `viewBox="0 0 24 24"` and **no `width`/`height` attributes** has no
intrinsic size. Browsers rasterize such an SVG at the CSS default replaced-element
size of **300×150** (a 2:1 aspect). `background-fit: contain` masks it at rest,
but as you zoom in cytoscape redraws the raster and the 2:1 intrinsic ratio bleeds
through -- the glyph gets horizontally **squashed** (observed in `ztpAutomationGraph`).
Fix: add explicit square `width="24" height="24"` (matching the viewBox) to each
SVG root so the intrinsic aspect is locked 1:1:
```js
svgUri('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">…</svg>')
```

### 32.4.2 cytoscape `.animation()` has NO loop/alternate -- chain on the completion promise
`ele.animation({ style, duration, alternate: true, loop: true })` looks like it
pulses, but **cytoscape silently ignores `alternate`/`loop`** -- the animation runs
ONCE (e.g. border-width 5→10) and freezes at the end frame. Symptom: a "blinking
current step" ring that grows once and never breathes (hit in `ztpAutomationGraph`).
Drive a real loop by chaining grow→shrink on each animation's completion promise,
with a stop flag so re-render / `$destroy` can halt it:
```js
var stopped = false, anims = [];
function pulse(n) {
  function step(w, next) {
    if (stopped) return;
    var a = n.animation({ style: { "border-width": w }, duration: 700, easing: "ease-in-out-sine" });
    anims.push(a);
    a.play().promise("complete").then(function () { if (!stopped) next(); });
  }
  var grow = function () { step(12, shrink); }, shrink = function () { step(5, grow); };
  grow();
}
// stop: stopped = true; anims.forEach(a => a.stop()); anims = [];
```

### 32.4.3 In-place poll re-render must update classes AND repaint mapped colors
An in-place graph refresh (poll on the SAME topology, updating node status without
re-layout so pan/zoom is preserved) has two traps, both hit in `ztpAutomationGraph`
where a live run's ring color + "current" highlight stayed frozen at the first
render (all "Added") while the queueStatus grid advanced:
1. **Update the class list, not just `data`.** Status lives in BOTH `node.data`
   (e.g. `border-color: data(color)`) AND the class string (`status-running`,
   `current`, mode). `node.data(nd.data)` alone leaves classes frozen -- the pulse
   and any class-keyed style stick to whichever node was current at first render.
   Re-apply: `node.classes(nd.classes)` (replaces the whole set).
2. **A mapped style may not re-run on a whole-object `.data()` swap.** Replacing a
   node's entire data object doesn't reliably re-evaluate a `data(color)` mapper on
   the live cytoscape build, so the ring keeps its old color. Force it with a
   direct per-element **bypass**, applied AFTER `cy.style().json(...)` so the sheet
   reset can't clear it: `node.style("border-color", nd.data.color)`.
Also note: `deviceArtifact` (used to pick the run group) is read ONCE at init -- a
poll reuses it, so it can't chase a brand-new run group without a re-read.

### 32.5 CSS isn't auto-loaded -- inline it
The harness auto-injects `widgetAssets/**/*.js` only, **not `.css`**. A
`<link rel=stylesheet>` in view.html is NOT applied (Angular `$compile` doesn't
load `<link>` in templates; c3charts works around it by injecting a `<link>`
from JS at runtime). A 0-height cytoscape container → canvas at 0 size →
`toBeVisible` fails.
Fix: inline the CSS in a `<style>` tag in view.html -- the browser applies
`<style>` in the DOM. Keep an external `widgetAssets/css/*.css` too if you want
a `<link>` path for SOAR, but the inline `<style>` is what makes the harness
render correctly. (Lint `unscoped-generic-css` wants it scoped -- prefix classes,
e.g. `.ztp-ag`.)

### 32.6 ng-if container + $timeout render race
A graph/div container inside `data-ng-if="state==='ready'"` may not be linked
into the DOM when a `$timeout(renderGraph, 0)` fires → `document.getElementById`
returns null → render silently no-ops (and with no poll, never retries).
Fix: use `data-ng-show` (element always in DOM, `display:none` until ready) for
the graph host, AND/OR a bounded retry so a too-early render catches the element:
```js
function renderGraph(steps, mode, retries) {
  retries = retries || 0;
  var c = document.getElementById("ztp-cy");
  if (!c) { if (retries < 40) { $timeout(function () { renderGraph(steps, mode, retries + 1); }, 50); } return; }
  // ... cytoscape init ...
}
```

### 32.7 Cytoscape renders to `<canvas>` -- assert node DATA in jest, not Playwright
Cytoscape draws nodes/edges to a `<canvas>`; they are NOT DOM elements, so
`getByTestId`/CSS selectors can't reach individual nodes. Split the assertions:
- **jest (pure logic):** test the element-builder (`ztpGraph.toElements(steps)`)
  -- node color/icon/`isCurrent`, edge chaining, `grabbable` per mode.
- **e2e (Playwright):** assert the widget mounts, `#ztp-cy canvas` exists with a
  non-zero boundingBox, the mode-badge class, legend item count, run-group text.
Cytoscape creates **multiple** canvases (data/user/viewer) -- use
`page.locator('#ztp-cy canvas').first()` to avoid strict-mode violations.

### 32.8 Related-record COLLECTION fetch has no harness route
The NS1 layer serves `GET /api/3/<module>/<id>` (single record, from
`widgetAssets/fixtures/api3/record.json`) but has **no route** for
`GET /api/3/<module>?<filter>` (collection) → it 599s `HERMETIC-MISS` and
`globalTeardown` fails the run.
Fix: `page.route('**/api/3/<related_module>**', r => r.fulfill({ json: fixture }))`
in the e2e spec (NS1 philosophy: stub only what's unique to your scenario).
Also: crudhub rejects unknown query params as field filters -- `?_limit=` and
`?itemsPerPage=` both 400 (`Field:X does not exist in module definition`).
Filter by the relation field instead: `?ztpfDevices=<deviceUuid>`. The
related-collection path `/api/3/<parent>/<id>/<related>` also 400s.

### 32.9 Stale embedded summary vs. canonical records
A parent record's embedded relationship summary (e.g.
`ztpf_devices.ztpfArtifact.steps[].ztpf_status`) is a **denormalized snapshot**
-- it goes stale and won't reflect live state (observed: summary said `Pending`
while the canonical record was `Failed` + `stepDone:true`). Always fetch the
canonical child records (the real `queueStatus` on the full record) separately
and poll THEM. Don't trust the embedded summary for anything that changes.

### 32.10 TypeScript for widget logic (max typing, build-enforced)
Two layers, both build-honored:
- **Controller (`view.controller.js`)** with `// @ts-check` + JSDoc `@param`.
  The `typecheck:widgets` gate (`scripts/typecheck-widgets.js`) runs `tsc
  --checkJs`, auto-splices `@param {Soar.<Iface>}` for known injected platform
  services, and blocks ship-verify on SOAR-contract type errors. Run:
  `node scripts/typecheck-widgets.js <Widget>`.
- **Typed logic module** (`widgetAssets/js/<name>.ts` → `.js`). Author as a
  `namespace` + compile with `module:"none"` + `declaration:true`. UMD's browser
  branch never runs the factory for named exports (no global is created) and
  CommonJS breaks `<script>` loading -- `module:"none"` + a `namespace` + an
  in-source footer `if (typeof module !== "undefined" && module.exports)
  module.exports = <ns>;` gives BOTH a browser global AND a `require()`-able
  object for jest. Compile with
  `node ../fortisoar-widget-harness/node_modules/typescript/bin/tsc -p tsconfig.json`
  (the `.bin/tsc` is the `tsc` trap package that prints "this is not the tsc
  command you are looking for" -- NOT the compiler).
Avoid the fortiai trap: don't hand-patch the emitted `.js` and then re-emit over
it -- keep the `.ts` the sole source and re-emit cleanly.

### 32.11 Lint/gate checklist before shipping a widget
From the dev-kit root:
- `make test-unit WIDGET=<name>` -- jest (controller + pure logic).
- `make test-e2e-widget WIDGET=<name>` -- Playwright hermetic.
- `cd fortisoar-widget-harness && node scripts/typecheck-widgets.js <name>` --
  tsc checkJs gate.
- `node scripts/lint-angular.js <name>` -- AngularJS lint (ng-model-dot,
  websocket-no-destroy, missing-inject, ...).
- `npx oxlint -c .oxlintrc.json <abs paths to widget .js>` -- JS lint
  (excludes `*.min.js`; pass absolute paths -- oxlint rejects `..`).
The full `make ship-verify WIDGET=<name> [BUMP=patch]` runs
lint→unit→mock-e2e→deploy→live-sweep.

### 32.12 Python closure variables and the silent `try/except: pass` trap (connector-side)

**The bug**: a counter declared in an outer function and modified inside a
nested callback (`_on_event`) silently breaks if the nested function reads
the counter before it's assigned:

```python
def chat_turn(config, params):
    _approval_count = 0
    def _on_event(ev):
        # _approval_count += 1  <-- makes Python treat this as a LOCAL var
        if isinstance(ev, ApprovalRequestEvent):
            _approval_count += 1       # UnboundLocalError!
        if isinstance(ev, UsageEvent):
            record = {"approvals_count": _approval_count}  # reads local -> BOOM
    # ...
```

`_approval_count += 1` anywhere in `_on_event` makes Python scope
`_approval_count` as local to `_on_event`. The first read (in the
UsageEvent branch) raises `UnboundLocalError: cannot access local variable
'_approval_count'` -- but the surrounding `try: ... except: pass` (best-effort
telemetry) silently swallows it, so `log_llm_activity` never executes and
**no `agent_usage` rows are written**. The symptom is a dashboard that
shows stale data only -- no error, no traceback.

**Fix**: `nonlocal _approval_count` at the top of `_on_event`.

**Lesson**: any connector callback that mutates an outer-scope variable
needs `nonlocal`. And `try/except: pass` is a **telemetry black hole** --
when the except is the only error path, a bug in the try block is invisible.
For diagnostic builds, temporarily replace `except: pass` with
`except Exception as e: print(...); raise` or accumulate into a module-level
list exposed through a read op (`list_usage` returned `"_diag": [...]`) so
the error surfaces without box SSH access.

**Widget-side parallel**: AngularJS `$rootScope:infdig` (infinite digest) is
the JS equivalent of a silent failure. A function that returns a NEW array
every call (`$scope.users = function() { return [...]; }`) trips the 10-iter
digest limit when the template binds it via `ng-repeat`. Fix: cache the
result keyed on the source array's reference so AngularJS sees a stable
value across digest cycles.

- Connector: `operations.py:3923` (`_on_event` / `nonlocal _approval_count`)
- Widget: `view.controller.js:217` (`users()` caching)
