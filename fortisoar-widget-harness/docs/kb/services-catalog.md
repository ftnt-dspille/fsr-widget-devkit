---
title: "FortiSOAR Widget Services Catalog"
topics: [angularjs, forti soar, services, dependency-injection]
category: widget-dev
status: canonical
summary: "Platform services available to widget controllers (FormEntityService, $state, websocketService, Query, etc.) and how to inject and use them."
---

## 8. Services catalog

All services below are injected by name (AngularJS DI). Function signatures are from the PDF; behaviours verified against widget source.

### 8.1 Core AngularJS services (pass-through)

Name | Use for
---|---
`$scope`, `$rootScope` | Template bindings, broadcast events
`$http` | Low-level REST calls against FortiSOAR APIs
`$resource` | Higher-level REST wrapper (preferred for `api/3/<module>/:id`)
`$q` | Promises (`$q.defer()`, `$q.all(...)`)
`$timeout`, `$interval` | Deferred execution, polling
`$filter` | Programmatic filter usage: `$filter('getEndPathName')(iri)`
`$state` | UI-Router state + params (`$state.params.module`, `$state.params.id`)
`$window` | Global `window` access (clipboard, open new tab, etc.)
`$uibModal` | Open Bootstrap modals (`$uibModal.open({ ... })`)
`$uibModalInstance` | **Only** in edit/modal controllers — pass config back via `.close(config)`
`$sce` | Sanitize/trust URLs: `$sce.trustAsResourceUrl(iframeUrl)`
`Toaster` / `toaster` | Notifications: `toaster.success({ body: 'OK' })`, `.error`, `.info`, `.warning`
`_` | Underscore.js utility library
`WizardHandler` | Multi-step forms (see §17)
`LocalStorageService` | Persistent key/value store
`PromiseQueue` | Serialize async work: `PromiseQueue.get('picklists')` / `.set(key, promise)`
`Constants` | `API.BASE`, `API.QUERY`, `PLAYBOOK_STEP_TYPES.API_TRIGGER`, etc. (see Appendix A)

### 8.2 FortiSOAR platform services

Name | Purpose | Key functions
---|---|---
`appModulesService` | Load the full module list; map module → UI-Router state | `load(force)`, `getState(module)`, `getListState(type)`
`Common Utils` / `CommonUtils` | Utility helpers | `copyToClipboard`, `generateUUID`, `isBase64Image`, `isJinja`, `isNumber`, `isObject`, `isUUID`, `isUndefined`, `isValidURL`, `parseJSON`, `searchInJSON`, `getIriApiPath`
`connectorService` | Connector management | `getConnector(name, version)`, `getDevelopedConnector`, `executeConnectorAction(name, version, action, configId, payload)`, `updateConnectorConfig`, `deleteConnector`
`currentPermissionsService` | ACL checks | `get()`, `getPermission(module)`, `getPermissions([modules])`, `availablePermission(module, action)`, `availableFieldPermission`, `isAdmin()`
`Entity` | Module metadata & entity persistence | `new Entity(moduleType)`, `loadFields()`, `getFormFields()`, `getFormFieldsArray()`, `getRelationshipFields()`, `get(id, { $relationships: true })`, `save()`, `delete()`, `evaluateAllFields()`, `applyDefaultValues()`, `evaluate()`
`exportService` | Playbook export helpers | `copyEntities`, `downloadJsonFile`, `exportGridRecords`, `getMacrosFromPlaybook`, `getReferencePlaybookForExport`, `loadCollectionNames`, `loadCollectionPlaybooks`, `changePlaybookAndStepsUuid`
`Field` | Single-field model | `evaluateRequired(entity)`, `evaluateVisible(entity)`, `getFormValue()`
`FormEntityService` | Bridge to the parent form's entity | `get()`, `set(entity)`, `submitField(fieldName)`
`licenseService` | License metadata | `getLicenseDetails()`, `getBrandingDetails()`
`modelMetadatasService` | Module metadata store | `loadAllModules`, `getModuleList()`, `getModuleNameByType(type, plural)`, `getIriByType(type)`, `getMetadataByModuleType(type)`, `getTenantModuleList`, `getTenantStagingModule`, `publishTenant`
`Modules` | Wrapper over `$resource` for record CRUD | `new Modules(...)`, `get({ module, id, __selectFields, $relationships })`, `save({ module, $relationships })`

> **`$`-prefixed query params (`$relationships`, `$limit`, `$export`) as object keys are SAFE.** Verified against the shipped app's `$httpParamSerializer`/`$httpParamSerializerJQLike`: `{$relationships:true,$export:true}` serializes to `$relationships=true&$export=true` — single-`$` keys are **not** dropped (only **double**-`$$` keys are stripped, by `angular.toJson`, in request *bodies*). So `Modules.get({ $relationships:true })` / `$resource(url).get({ '$relationships':true })` work; you may bake them into the URL string for clarity but you don't have to. (The harness `dollar-param-drop` lint is therefore an advisory warning, not a bootstrap-blocking error.)
`picklistsService` | Picklist CRUD | `getPicklistByIri(iri)`, `getPicklistByItemValue(fieldName, itemValue)`, `loadAllPicklists()`, `loadPicklistsByParams(name)`
`playbookService` | Playbook metadata & execution | `getPlaybooksData()`, `triggerPlaybookAction($scope, true, entity)`, `detachPaybookStatusWebsocket()`, `getPlaybookExecutionCount(query)`, `getRunningPlaybooks(query)`, `getRunningPlaybookDetails`, `getStepRunningDetails`
`Query` | Build a `queryObject` | `new Query({ sort, limit, logic, filters, aggregates, __selectFields })` → `getQuery(true)` / `getFlatQuery()` / `updateFilter()` / `updateFilters()` / `getQueryModifiers()`
`queryCollectionService` | Load module query collections | `load(moduleName)`, `loadQueryFilterValues`, `loadResource(iri)`
`PagedCollection` | Paginated grid source | `new PagedCollection(module, cfg, extra)`, `.query = new Query(...)`, `loadGridRecord()`, `loadByPost(queryObj)`, `buildSortQuery`, `loadDefaultColumns`, `extendFilter`, `gotoPage`, `pageNext/Prev/First/Last`, `sortColumnsByFieldName`, `convertToKeyPairs`
`settingsService` | Per-user and system settings | `get(key)`, `getSystem()` (cached), `set(key, value)`, `save(key, value)` (depending on host version)
`tokenService` | JWT token management | `get()`, `set(token)`
`usersService` | Current-user helpers | `getAvatar(iri)`, `getCurrentAvatar()`, `getCurrentUser()`, `getUserByIri(iri)`, `loadCurrentUser()`
`ViewTemplateService` | System view templates | `get('app' \| 'dashboard' \| …)`, `changeStructure`, `getConfigInputs`, `getConditionalVisibilityFilteredData`, `populateConditionalFields`
`widgetTemplateService` | Generate widget render metadata | `generateWidgetDefinition(widget)`
`widgetService` | Launch a widget programmatically | `launchStandaloneWidget(name, version, resolveObj?)`
`websocketService` | Channel subscriptions | `subscribe(channel, callback)` → promise resolving to a subscription id; `unsubscribe(id)`

#### 8.2.1 Persisting per-user widget preferences with `settingsService`

`settingsService.get(key)` / `.set(key, value)` round-trips to the SOAR backend and
is **per-user, persisted across sessions and devices**.

**How it works under the hood (confirmed by probing the live box + reading `app.unmin.js`):**

- `get(key)` reads synchronously from a cached copy of `actor['@settings']` (fetched
  at login). It walks the key split on `/`: `get('jsonToGrid/columnOrder')` returns
  `@settings.jsonToGrid.columnOrder`.
- `set(key, value)` issues `PUT /api/3/user_settings/current/<key>` with the value
  as the JSON body. The backend deep-merges the value at that key path and returns
  the updated `@settings` object. **Verified working** — a `PUT` to
  `/api/3/user_settings/current/jsonToGrid/columnOrder` with body `["name","severity"]`
  persisted and came back on the next `GET /api/3/actors/current`.

The platform uses `user/view/<key>` for its own UI prefs (theme, language, subtabs).
Widgets should use a **widget-name-prefixed key** to avoid collisions:

```js
// Save column order after the user drags columns.
// Key is stable across widget versions — never include the version number.
gridApi.colMovable.on.columnPositionChanged($scope, function () {
  var order = gridApi.grid.columns.map(function (c) { return c.field; });
  settingsService.set('jsonToGrid/columnOrder', order);
});

// Restore on init — apply before setting gridOptions.data so the render
// uses the saved order. Reconcile against current grid_columns (saved
// fields may be stale if the playbook added/removed columns).
settingsService.get('jsonToGrid/columnOrder');  // returns value synchronously
var saved = settingsService.get('jsonToGrid/columnOrder');
if (saved && saved.length) {
  var reordered = _.filter(
    saved.map(function (field) { return _.find($scope.columnDefs, { name: field }); }),
    Boolean
  );
  var unseen = _.reject($scope.columnDefs, function (c) { return saved.indexOf(c.name) !== -1; });
  $scope.columnDefs = reordered.concat(unseen);
}
```

**Key design notes:**
- Key must be **stable across widget versions** (`jsonToGrid/columnOrder` not
  `jsonToGrid130/columnOrder`).
- `settingsService.get` returns the value **synchronously** from the cached
  `@settings` — no promise, no `.then()`.
- `settingsService.set` is fire-and-forget (no need to await it per column move).
- `PUT /api/3/user_settings/current/<key>` is the actual REST call. DO NOT use
  `PUT /api/3/user_settings/<uuid>` (returns 500) or `PATCH` (405). The `/current/`
  variant is the only working write path.

**Endpoints that do NOT work (probed):**
- `GET /api/3/settings` → 404
- `PATCH /api/3/user_settings/<uuid>` → 405
- `PUT /api/3/user_settings/<uuid>` → 500 (internal error)
- `PUT /api/3/actors/current` with `@settings` → 200 but does not persist

**Why `PagedCollection.contextId` column-save does NOT apply here:**

The native module-list grids (Alerts, Incidents) save column visibility/width
per-user via a `contextId` keyed to the `PagedCollection`. This mechanism requires
the grid to be backed by a **real SOAR module collection** whose
`loadDefaultColumns` round-trips to the `GRID_COLUMNS` settings store. The
jsonToGrid widget hand-builds a synthetic `PagedCollection('dummy_module')` whose
`loadGridRecord` is overridden to never hit an API (see §7 csGrid gotcha below),
so `loadDefaultColumns` never runs and `contextId`-based column saving is
**not available** — use `settingsService` with a widget-prefixed, version-stable
key (`jsonToGrid/columnOrder`) instead.

### 8.3 Your own widget-local service

Pattern observed across certified widgets (e.g., `outbreakAlertConfiguration`, `socManagement`, `configureIndicatorExtraction`):

```js
// widgetAssets/js/myWidget.service.js
(function () {
  angular.module('cybersponse').factory('myWidgetService', myWidgetService);
  myWidgetService.$inject = ['$q', '$http', 'API', 'connectorService'];

  function myWidgetService($q, $http, API, connectorService) {
    return { fetchThings, saveThings };

    function fetchThings() {
      return $http.get(API.QUERY + 'my_module').then(r => r.data['hydra:member']);
    }
    function saveThings(payload) { /* ... */ }
  }
})();
```

Include it by adding a `<script>` tag at the top of your `view.html`.

---
