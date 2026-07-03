---
title: "FortiSOAR Widget Directives Catalog"
topics: [angularjs, forti soar, directives]
category: widget-dev
status: canonical
summary: "AngularJS directives the platform provides for widget templates (cs-markdown-editor, cs-grid, ui-select, etc.) with their scope contracts and usage gotchas."
---

## 9. Directives catalog

All FortiSOAR directives use the `cs-` prefix and the `data-` attribute form (required for HTML5 validation compliance).

### 9.1 `data-cs-field` — dynamic form field renderer

Renders an input bound to any FortiSOAR field definition.

```html
<div data-cs-field="field"
     data-ng-model="value"
     data-mode="'add'"
     data-size="'small'"
     data-use-placeholder="true"
     data-enable-jinja="true"
     data-enable-expression="enableExpression"
     data-change-method="onFieldChange"
     data-blur-method="onFieldBlur"
     data-focus-method="onFieldFocus"
     data-disabled="false"
     data-ignore-editable="true"
     data-allow-add-tag="true"
     data-fields-mapping="fieldsMapping"
     data-form-name="'myForm'"></div>
```

`field` is a `new Field({...})` object — see Appendix B for all `formType` values.

### 9.2 `data-cs-conditional` — filter builder

```html
<div data-cs-conditional
     data-fields="params.fields"          <!-- source: entity.getFormFields()+relationships -->
     data-ng-model="config.query"          <!-- sink: full { filters, logic, sort, limit } -->
     data-mode="'queryFilters'"           <!-- 'queryFilters' | 'trigger' | ... -->
     data-enable-nested-filter="true"
     data-enable-jinja="true"
     data-enable-expression="true"
     data-hide-related-fields="false"
     data-form-name="'myForm'"
     data-parent-form="myForm"
     data-reset-field="params.fields"     <!-- array watched for reset triggers -->
     data-reset-name="['fieldA']"></div>
```

The resulting model is:

```js
config.query = {
  sort: [{ field, direction }],
  limit: 30,
  logic: 'AND',
  filters: [
    { field, operator, value, _value: { display, itemValue, '@id' }, type: 'object' }
  ]
}
```

### 9.3 `data-cs-messages` — inline validation

```html
<div data-cs-messages="myForm.username"></div>
```

Pairs with standard AngularJS `required`, `ng-pattern`, `ng-minlength`.

### 9.4 `data-cs-grid` — ui-grid integration

```html
<div data-cs-grid
     data-grid-options="gridOptions"
     data-column-defs="columnDefs"
     data-paged-collection="pagedCollection"></div>
```

`gridOptions` accepts the usual ui-grid flags plus a `csOptions` bag:

```js
const defaultGridOptions = {
  csOptions: {
    allowAdd: true, addText: 'Add', allowLink: false, allowUnlink: false,
    allowDelete: true, allowClone: true, allowSync: false,
    allowGlobalFilter: true, allowModuleFilter: false, customRecordTypeFilter: false,
    allowDateFilter: false, allowUserFilter: false, allowGridFilter: false,
    allowCardView: false, auditLogView: false, viewType: '',
    allowActions: false, allowPlaybookActions: false,
    bulkButtons: [], showPagination: true,
    searchPlaceholder: 'Search', searchEnable: true,
    cloneRelationshipsByDefault: false, clone: cloneFn,
    contextMenu: contextMenuService.getConfig,
    isRelationship: false, searchMinLength: 0,
    enableSelectMenu: true, enableSavedFilters: true,
    wideSearchBar: false, unlinkButtonText: 'Remove Link',
    isFullScreenMode: false
  },
  rowTemplate: 'app/components/grid/clickableRow.html',
  paginationPageSizes: [5, 10, 30, 50, 100, 250],
  paginationPageSize: 30,
  onRegisterApi: scope._setGridApi,
  enableGrouping: false, enableFiltering: true,
  useExternalFiltering: true, useExternalSorting: true,
  enableGridMenu: true, enableColumnMenus: false,
  enableColumnResizing: true, enableColumnMoving: true,
  enableExpandable: false,
  exporterMenuCsv: false, exporterMenuPdf: false,
  expandableRowHeaderWidth: 0, expandableRowHeaderTitle: null
};
```

#### 9.4.1 Gotchas (learned building jsonToGrid grid e2e)

- **`gridApi` only exists after ui-grid initializes.** `csOptions.onRegisterApi`
  (e.g. `setGridApi`) is invoked by ui-grid *during its own bootstrap*, not when
  the widget controller runs. Any code that reads `$scope.gridApi.<x>` before the
  grid has mounted throws `Cannot read properties of undefined (reading
  'selection')`. Classic footgun: a `getSelectedRows()` helper
  (`$scope.gridApi.selection.getSelectedRows()`) called from an `_init`
  execution chain — if the grid directive *failed to construct*, `onRegisterApi`
  never fires, `gridApi` stays undefined, and the throw is swallowed by an
  un-`.catch()`'d promise, so the symptom is a **stuck `loadProcessing=true`
  spinner**, not an error. When a grid widget hangs on "Fetching…", suspect the
  grid directive failed to build, not the data fetch.
- **`csGrid` injects `$stateParams`** (ui-router). It's a hard dependency of the
  directive itself (`$stateParamsProvider <- $stateParams <- csGridDirective`),
  so if ui-router isn't present the directive throws `$injector:unpr` at compile,
  ui-grid never initializes, and you hit the `gridApi`-undefined cascade above.
- **`uiGridConstants` etc. come from `angular-ui-grid`**, which `csGrid` wraps.
  Without `ui.grid` (and its feature modules) registered, `csGrid` throws
  `$injector:unpr uiGridConstants` and renders zero rows.
- **ui-grid renders the row set once per *render container*.** With pinning /
  multiple containers, `.ui-grid-row` appears N× per data row (e.g. a left/pinned
  container + the body container ⇒ 2× rows). To count true data rows in a test,
  scope to the body container:
  `.grid-widget-container .ui-grid-render-container-body .ui-grid-row`.
- **Do NOT write custom widget CSS to fix grid row theming.** SOAR's platform
  theme CSS (`css/themes/steel.5065a59f.css` on this box) already overrides
  ui-grid's default light-stripe backgrounds (`#fdfdfd`/`#f3f3f3`) to dark
  (`#121923`) for both odd and even rows. Adding widget CSS duplicates platform
  responsibility and will conflict when the platform theme changes. If rows look
  wrong in the harness, the problem is harness CSS ordering, not the widget.
- **Hermetic e2e tests have no SOAR theme CSS** (`/_fsr/stylesheets` returns `[]`
  under `FSR_HERMETIC=1`). Cell backgrounds in hermetic tests will always be the
  CDN ui-grid defaults (near-white). Do not assert on `backgroundColor` or
  `color` in hermetic e2e — those tests will always see the wrong values. Theme
  fidelity is a live-sweep concern.
- **Harness SOAR CSS injection order footgun (fixed, know for next time).**
  `injectFsrStylesheets()` must append sheets to `document.body`, not
  `document.head`. The vendor CSS `<link>` tags (CDN ui-grid, ui-bootstrap,
  etc.) live in `<body>` in `index.html`. CSS cascade orders body sheets after
  head sheets at equal specificity, so head-injected SOAR sheets lose to body
  CDN sheets. Symptom: grid rows stay light even with "Load FortiSOAR CSS"
  checked. Fix is in `public/index.html` `injectFsrStylesheets()` — already
  applied; do not revert to `document.head.appendChild`.

**Harness (dev + e2e) requirements to host *any* grid widget** — all stripped
from `app.unmin.js` and re-added in the harness:
- `public/index.html`: load `angular-ui-grid` (CDN script + css) **before**
  `app.unmin.js` so the modules exist when the `cybersponse` dep array is built.
- `server.js` `HARNESS_VENDOR_DEPS`: add `ui.grid` **and every feature module the
  bundle declares** — `ui.grid.selection`, `.resizeColumns`, `.pinning`,
  `.moveColumns`, `.exporter`, `.expandable`, `.cellNav`, `.autoResize` (grep
  `ui\.grid[a-zA-Z.]*` in `app.unmin.js`) so the injector can see them.
- `harness.module.js`: stub `$stateParams` (ui-router is stripped; `$state` was
  already stubbed) — mirror `window.__HARNESS_STATE.params`.
- Hermetic stubs in `server.js` (the grid's full render path reads these; an
  empty stub leaks a `599 HERMETIC-MISS`): `/api/system/fixtures` must return the
  real **SYSTEM_MODULES** list (it seeds `metadata.<type>` for system modules —
  see §below on `loadFields`), `/api/3/picklists` (option values;
  `{hydra:member:[]}` is fine for JSON-data grids that render their own columns),
  and `/api/3/system_settings` (timezone / date / pagination defaults). Real
  snapshots live per-dev in `fsr_src/` (gitignored, fetched by
  `scripts/fetch-soar-assets.sh`).

#### 9.4.2 `Entity.loadFields(module)` ↔ system fixtures + picklists

`new Entity(module).loadFields()` resolves the module's field metadata before a
playbook trigger. It reads `metadata.<module>` synchronously from the
modelMetadatasService store. Two sources populate that store at boot:
`/api/3/model_metadatas` (user modules: alerts, incidents…) and
**`/api/system/fixtures`** (the SYSTEM_MODULES list → seeds `metadata.picklists`,
`metadata.workflows`, …). If `metadata.<module>` is missing, `loadFields()`
**rejects** with `"<module> module metadata not found"`. Once metadata resolves,
`loadFields` fetches each picklist-typed field's option list
(`GET /api/3/picklists?…&listName__name=<List>`, one per list). A grid that
renders its own JSON (`grid_data`/`grid_columns`) doesn't need real picklist
values — empty responses let the field-load chain resolve. **Footgun:** widgets
often call `loadFields().then(success)` with *no* error handler; a rejection (or
a metadata-load race at mount) silently stalls the whole trigger chain.

#### 9.4.3 `grid_columns` playbook contract (jsonToGrid widget)

The `grid_columns` variable returned by the data-provider playbook is a JSON object
with a `columns` array that drives `$scope.columnDefs` (bound to `data-column-defs`
in the template). Each entry maps to a ui-grid `columnDef` object.

```json
{
  "columns": [
    { "name": "severity", "displayName": "Severity", "width": 120 },
    { "name": "name",     "displayName": "Name" }
  ]
}
```

**Columns render in array order** — `orderByColumnDefs: true` enforces this regardless
of property order in `grid_data` objects.

**Supported keywords** (all optional except `name`):

| Key | Type | Effect |
|-----|------|--------|
| `name` | string | **Required.** Field key in `grid_data` objects. |
| `displayName` | string | Column header. Defaults to `name`. |
| `width` | number | Fixed column width in pixels. |
| `minWidth` / `maxWidth` | number | Width constraints in pixels. |
| `type` | string | `string` (default), `number`, `date`, `boolean`, `object` — affects sort and filter behaviour. |
| `cellFilter` | string | AngularJS filter applied before display: `"date:'MM/dd/yyyy'"`, `"number:2"`, `"uppercase"`. |
| `cellTemplate` | string | Custom cell HTML; `row.entity[col.field]` is the value. |
| `enableSorting` | boolean | Per-column sort toggle. Grid default: `true`. |
| `enableFiltering` | boolean | Per-column filter toggle. Grid default: `true`. |
| `visible` | boolean | Initial visibility. Default: `true`. |
| `pinnedLeft` / `pinnedRight` | boolean | Pin column to grid edge. |

**Footgun — `enableFiltering: false` at grid level overrides per-column settings.**
Prior to v1.3.0, `setGridOptions()` set `enableFiltering: false` which silently
disabled all column filters regardless of what `grid_columns` specified. Fixed in
v1.3.0 — the grid now sets `enableFiltering: true` and `useExternalFiltering` is
removed.

**Detail-view context** — when `$state.params.module` and `$state.params.id` are
set (widget placed on a record detail page), the controller fetches that record and
passes it to the playbook as `records[0]`, so the playbook can scope `grid_data` to
data relevant to the current record without the user selecting a row.

**Card-view toggle is gated on `allowGlobalFilter`, not `allowCardView`.** The
`#grid-card-view-btn` / `#grid-list-view-btn` toggle in `grid.html` is
`data-ng-show="csOptions.allowGlobalFilter && csOptions.allowCardView"`. Setting
`allowCardView:true` alone does nothing if `allowGlobalFilter:false` — the toggle
stays hidden and the grid is list-only. (jsonToGrid disables global filter, so its
card view is intentionally unreachable; `cardView.html` also binds
`record.name`/`record.image`, a collection shape, not arbitrary `grid_data`.)

**Expandable rows: detail height binds to `row.expandedRowHeight`, not
`gridOptions.expandableRowHeight`.** With `enableExpandable:true` +
`expandableRowTemplate`, ui-grid renders a per-row `i.ui-grid-icon-plus-squared`
toggle inside `.ui-grid-expandable-buttons-cell` (flips to `minus-squared` on
expand) and mounts a `.expandableRow` sub-row container. The expanded height comes
from the per-row `row.expandedRowHeight`, so setting `gridOptions.expandableRowHeight`
does **not** drive it. **Harness caveat:** if the expandable template
(`widgetAssets/html/*.html`) uses `cs-markdown-editor`/`cs-html-editor`, the harness
will NOT vendor toastui for it — its editor detection scans only `view.html` /
`edit.html`, not `widgetAssets/` sub-templates — so the detail body stays empty in
the hermetic e2e tier. Verify the rendered detail content + height live on the box;
the toggle + expand/collapse state is what the hermetic tier can lock.

### 9.5 `data-cs-chart`

```html
<div data-cs-chart="chartOptions"></div>
```

```js
$scope.chartOptions = {
  wid: CommonUtils.generateUUID(), widgetAlwaysDisplay: true,
  showTabularData: false, aggregate: true, assignedToSetting: 'onlyMe',
  chart: 'pie',
  mapping: { assignedToPerson: 'assignedTo', fieldName: 'severity' },
  query: { sort: [...], limit: ..., logic: 'AND', filters: [...], aggregates: [...] },
  resource: 'alerts', title: 'Open Alerts By Severity'
};
```

### 9.6 `data-cs-focus`

Auto-focus on render:

```html
<input type="text" data-ng-model="x" data-cs-focus>
```

### 9.7 `data-cs-card`

```html
<div data-cs-card
     data-ng-model="record"
     data-size="config.size"
     data-mapping="config.mapping"
     data-actions="actions"></div>
```

### 9.8 `data-cs-pagination`

```html
<div class="search-pagination"
     data-cs-pagination data-ng-model="pagedCollection"
     data-ng-hide="pagedCollection.filters.q.length === 0 && pagedCollection.filters.index.length === 0"></div>
```

### 9.9 `data-cs-datetime-grid`

Attaches datetime sort/filter cell on a grid column:

```html
<div data-cs-datetime-grid="::field"></div>
```

### 9.10 `data-cs-tags`

```html
<div class="cs-tags-container">
  <div data-cs-tags="tagsField"
       data-cs-allow-add-tag="false"
       data-change-method="tagsChanged"
       data-ng-model="item.value.tags"
       data-placeholder="tagsPlaceholder"></div>
</div>
```

### 9.11 `data-cs-markdown-editor`

```html
<div data-cs-markdown-editor
     data-mode="'view'"        <!-- 'view' | 'edit' -->
     data-ng-model="task.description"
     data-form-name="'task-' + $index"></div>
```

### 9.12 `cs-spinner`

```html
<cs-spinner data-ng-show="processing" data-show-background="true"></cs-spinner>
```

### 9.13 `data-cs-unique`

Validates the bound value is not present in a list:

```html
<input type="text" data-ng-model="dynamicVariable.name"
       data-cs-unique="dynamicVariablesNameList"
       data-ng-pattern="varRegex" required>
```

### 9.14 Edit-form helpers observed in the wild

- `data-cs-default-sort` — the sort picker shown in most edit modals (`recordCard/edit.html:114`).
- `data-cs-icons` — icon picker.
- `data-cs-view-field` — read-only display of any module field (`recordCard/view.html:19-46` uses similar pattern).
- `data-cs-editable-field` — inline editing (used by `fieldsOfInterest`).
- `cs-connector-field-renderer` — dynamic connector-config form renderer (used by `outbreakAlertConfiguration`, `fortiAIConfiguration`, etc.).
- `cs-typeahead` — people/IRI typeahead (used by `userAssignments`).
- `as-sortable` / `as-sortable-item` / `as-sortable-item-handle` — drag-and-drop lists and kanban (`taskManagement`, `playbookButtons`).
- `ngf-select`, `ngf-drop` — `ng-file-upload` for file attachments (`configureIndicatorExtraction`, `submitContentForm`).

### 9.15 `ui-select` — dropdown clipped inside modals / scroll containers

An in-place `ui-select` opens its `.ui-select-choices` list as a normal child of
`.ui-select-container`. Any ancestor with `overflow:auto|hidden|scroll` (a modal
body, a scrollable card) **clips the open dropdown** — symptom: only 2–3 rows show
even though `max-height` allows more, the rest cut off at the container edge. (Same
class as the uib grid-header dropdown clipping in §7.4 — `dropdown-append-to-body`.)

Two fixes, with a real trade-off:

- **`data-append-to-body="true"`** escapes the clip, but ui-select 0.20.0 moves the
  **whole `.ui-select-container`** (match button included) into `<body>`, not just the
  choices. That detaches it from its form scope — in `widget-action-renderer` this
  broke the connector-config param renderer and dropped the match input, so that widget
  deliberately keeps the dropdown **in-place**. Test before relying on it.
- **Keep in-place, un-clip the ancestor only while open.** Let the dropdown spill:
  ```css
  .my-modal:has(.ui-select-container.open) { overflow: visible; }
  /* and lift it above sibling stacking contexts */
  .my-modal .ui-select-bootstrap > .ui-select-choices { z-index: 1100; }
  ```
  `:has()` scopes the overflow-visible to *only* when a dropdown is open, so the
  container still scrolls normally otherwise. This is what the harness edit modal uses
  for the action-renderer connector picker (`fortisoar-widget-harness/public/index.html`).
  See `widget-action-renderer/widget/widgetAssets/css/actionRenderer.css` (the
  `.ui-select-bootstrap` rules) for the in-place z-index/contrast handling.

### 9.16 `ui-select` match — custom `<span>`s get forced to `inline-block; width:~50%`

When you put two custom spans in a `ui-select-match` (e.g. a name `.ar-match-label`
+ a version `.ar-match-meta`), the **`ui-select-bootstrap` / SOAR theme forces the
match-text's children to `display:inline-block; width:~50%`**. Symptom: the second
span (version) drifts to the far right / off-screen, ellipsized to "…"; naively
pinning the label with `flex:0 1 auto; overflow:hidden` instead **clips the name to
nothing** (label shrinks to 0). Fix — lay the match text out as a plain inline flow
and beat the themed rule with `!important`:
```css
.my-edit .ui-select-bootstrap .ui-select-match-text { display:block; overflow:hidden;
  text-overflow:ellipsis; white-space:nowrap; }
.my-edit .ui-select-bootstrap .ui-select-match-text .ar-match-label,
.my-edit .ui-select-bootstrap .ui-select-match-text .ar-match-meta {
  display:inline !important; width:auto !important; float:none !important; }
```
(`action-renderer` v1.0.8, harness-verified.)

Two related interaction fixes shipped with it:
- **Force-close on pick.** SOAR doesn't always auto-close a `ui-select` after a
  selection — append `; $select.close()` to the `data-on-select` expression.
- **Label click → focus the search.** A native `<label for=>` can't target
  ui-select's generated search input. Use a directive on the label that, on click,
  clicks the `.ui-select-toggle` and focuses `.ui-select-search` — but **defer both
  to `setTimeout(…,0)`**: the label's own click is still bubbling and ui-select's
  document-level outside-click handler will close the just-opened dropdown otherwise.
  (`actionRendererPickerLabel` directive in `directives.js`.)

---
