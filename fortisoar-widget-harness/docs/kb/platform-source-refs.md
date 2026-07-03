---
title: "Finding FortiSOAR Platform Source (Host UI Code)"
topics: [angularjs, forti soar, platform-source, reverse-engineering]
category: widget-dev
status: canonical
summary: "How to locate and read the host UI's templates, directives, and services when a widget needs to mirror or hook into platform behavior. Includes grep recipes for walking the stripped SOAR bundle."
---

## 29. Platform source references (host UI code)

FortiSOAR's web UI ships as a pre-bundled AngularJS app at `/opt/cyops-ui/` on the server. Two files hold everything you'd want to learn from:

| File | What's inside | Size |
|---|---|---|
| `app.unmin.js` | Every module, directive, controller, service, factory, filter, constant. Unminified — variable names still mangled (`a`, `e`, `i`, …) but structure is readable. | ~3.5 MB |
| `templates.min.<hash>.js` | Every HTML template packed as `$templateCache.put('path', '<html>')` entries. | ~2.6 MB |

Both files live at the repo root of this project (pulled from an install). Their content is **not installable** — this is reference material. Use it to mimic look-and-feel in widgets and to find scope contracts for built-in directives.

### 29.1 `templates-extracted/` — unpacked UI templates

**606 HTML files** extracted via `extract-templates.js` (in repo root), preserving the original `$templateCache` paths as directories. Run or re-run with:

```bash
node extract-templates.js                                    # defaults: templates.min.*.js → templates-extracted/
npx prettier --write 'templates-extracted/**/*.html'         # optional: pretty-print all
```

#### Top-level tree (most useful for widget work)

```
templates-extracted/app/
├── admin/               # Admin settings pages (users, roles, teams, SAML, tenants)
├── authentication/      # Login, forgot-password, SSO flows
├── collections/         # Playbook collections
├── components/          # ← All reusable UI widgets — start here
├── connector/           # Connector manager (list, configure, health)
├── customReporting/     # Report builder
├── dataIngestion/       # Threat-intel feed ingestion
├── editor/              # Picklist editor, SVT editor, module editor
├── errors/              # Error pages
├── global/              # App-shell, global modals
├── marketplace/         # Content Hub
├── multitenancy/        # MSSP tenant UI
├── playbooks/           # Playbook designer, step configs
├── queue/, queues/      # Task queues
├── recycleBin/          # Deleted records
├── rules/               # Rule engine
├── scheduler/           # Scheduled playbooks
├── search/              # Global search
├── security/            # Appliance, audit, SSL, backup
├── settings/            # User prefs
├── templates/           # View templates for modules
└── widget/              # Widget-host shell (how widgets mount)
```

#### `templates-extracted/app/components/` — the component library

These 32 folders are the main source of patterns for widgets. Each one corresponds to a `cs*` directive or a reusable controller:

| Folder | What it provides | When you'd copy it |
|---|---|---|
| `avatar/` | User avatar with tooltip | Showing people fields |
| `breadcrumb/` | Record breadcrumb + action buttons | Custom record navigation widgets |
| `chart/` | `cs-chart` template (c3 wrapper) | Any chart widget |
| `codeEditor/` | Monaco / CodeMirror editor templates | JSON/Jinja/Python editors |
| `comments/` | Comment threads, action logs | Comment-aware widgets |
| `connectorActions/` | The "Actions" popover on record detail (4 files) | Custom action launchers |
| `executeBar/` | Bulk-action bar | Grids with bulk ops |
| `exports/` | Export details modal | Custom exporters |
| `file/` | Attachment thumb, upload dropzone | File-handling widgets |
| `form/` | `csEditableField`, `csMessages`, `csJsonFormRow` | Any form widget |
| `fsrMultiSelect/` | Multi-select UI-select wrapper | Typeaheads / multi-pickers |
| `globalDrawer/` | Drawer shell (`drawer` context host) | Reference for drawer widgets |
| `grid/` | `cs-grid`, clickableRow, cardView, filters, expandableRow | Grid/list widgets |
| `header/` | Top navbar (password modal, right panel, app menu) | `header_navbar` context widgets |
| `iframe/` | Sandbox iframe wrapper | Embedded 3rd-party UI (like `vtAugment`) |
| `image/` | Image field renderer | Custom image widgets |
| `jinja/` | Jinja editor, generator, dynamic values/variables | Jinja-aware widgets |
| `jsonformatter/` | Pretty-printed JSON tree | JSON inspectors |
| `jsonutility/` | Json renderer with controls | JSON diff/edit widgets |
| `modals/` | 30+ modal templates (add, import, export, playbook versions, API keys, SSO, etc.) | Opening system modals from widgets |
| `navigation/` | Module nav sidebar | Listing-context widgets |
| `playbooks/` | Step configs, pending decision, manual input, designer | Playbook-interactive widgets |
| `spinner/` | `cs-spinner` | Loading states |
| `timeline/` | `cs-timeline` | Timeline widgets (see `incidentTimeline`) |
| `toasts/` | Toaster notification | Notifications |
| `tooltips/` | Tooltip variants | Rich hover states |
| `ui/` | Generic UI primitives | Buttons, chips |
| `viewTemplates/` | Dynamic form/detail templates | View-Panel widgets |

Quick recipes:

```bash
# Find the template for an observed directive (e.g. the popover you're staring at)
grep -rln 'conn-actions-menu\|loadingConnList' templates-extracted/
# → templates-extracted/app/components/connectorActions/connectorActionListing.html

# Find every modal in the app
ls templates-extracted/app/components/modals/

# Find templates that use a specific scope variable
grep -rln 'ng-model="config\.query"' templates-extracted/
grep -rln 'cs-conditional' templates-extracted/
```

### 29.2 `app.unmin.js` — the platform JS

Not minified, but **variable names are still mangled** (single letters). The `$inject` array at the bottom of each directive/controller is the Rosetta stone.

#### Inventory (mechanical counts from grep)

| Kind | Count | Grep pattern |
|---|---|---|
| `directive("cs*"`) | **122** | `grep -oE 'directive\("[a-zA-Z]+"' app.unmin.js \| sort -u` |
| `controller(...Ctrl`) | **223** | `grep -oE '\.controller\("[a-zA-Z]+Ctrl"' app.unmin.js \| sort -u` |
| `factory(...)` / `service(...)` | **100+** | `grep -oE '\.(factory\|service)\("[a-zA-Z_]+"' app.unmin.js \| sort -u` |
| `filter(...)` | **57** | `grep -oE '\.filter\("[a-zA-Z]+"' app.unmin.js \| sort -u` |
| `constant(...)` | **99** | `grep -oE '\.constant\("[A-Z_]+"' app.unmin.js \| sort -u` |

#### 122 platform directives (all confirmed present)

Read-only sampler (full list is `grep -oE 'directive\("[a-zA-Z]+"' app.unmin.js \| sort -u`):

```
csAttachmentThumb   csAuditLog           csBulkButtons        csBulkLookup
csButtonGroup       csCard               csCardCount          csCardView
csChart             csCodeEditor         csCommentInput       csCompareTo
csCondition         csConditional        csConnectorActions   csConnectorFieldRenderer
csConnectorFields   csCorrelationGraph   csDatetimeCustom     csDatetimeDifference
csDatetimeGrid      csDefaultSort        csDesignerDetail     csDetailTooltip
csDictionary        csDiffTable          csDrawerWidgetGroup  csDynamicList
csEditGridForm      csEditableField      csEmail              csEmailTemplate
csExecuteBar        csFeed               csField              csFieldDropdown
csFieldSelect       csFieldSort          csFile               csFileUpload
csFocus             csGrid               csHtmlEditor         csIcons
csIframe            csImage              csInputVariablesPrompt
csInternationalPhone csJinjaEditorLog    csJinjaGenerator     csJsonEditor
csJsonFormRow       csJsonUtility        csLineItem           csListCount
csMarkdownEditor    csMessages           csMultiselect        csPagination
csPendingDecision   csPercentageLoader   csPhone              csPicklistEditor
csPlaybookActions   csPlaybookDesigner   csQueryHeader        csReadOnlyTagsView
csReferenceCard     csReservedFields     csRightClick         csRightPanel
csRunningPlaybookDesigner csSearchCard    csServerValidator   csSpinner
csStepArguments     csTags               csTimeValidator      csTimeline
csTrigger           csTypeahead          csUnique             csUpdateOwners
csViewField         csViewTemplate       csWebAddressValidator csWidget
csWidgetContent     csWidgetGroup        csWidgetPreview      csWindowTitle
```

**All of these are injectable by attribute in a widget's `view.html`** — they inherit from the parent scope, which means whatever `config`, `$state`, `$rootScope` state you have is visible to them.

#### 100+ factories / services

Platform heavy-hitters (verified present):

```
ActorPagedCollection      AggregateAreaChartBuilder   AggregateBarChartBuilder
AggregatePieChartBuilder  AggregateTimeseriesChartBuilder  AreaChartBuilder
AuditLogPagedCollection   AuthenticationInterceptor   AuthenticationService
BarChartBuilder           BulkUpdate                  ChartBuilder
ChartBuilderFactory       CommonUtils                 ConnectorPagedCollection
Cryptography              DjangoPagedCollection       Entity
Field                     FormEntityService           GatewayPagedCollection
GridSelection             GridUtility                 JsPlumb
LdapSearchPagedCollection ModalService                Modules
PagedCollection           PieChartBuilder             PlaybookConditions
PlaybookDesigner          PromiseQueue                PublishInterceptor
QueueService              RecursionHelper             ReportsPagedCollection
SchedulesService          SearchPagedCollection       StaticPagedCollection
TimeZoneServices          TimeseriesChartBuilder      User
ViewTemplateService       _ (underscore)              appInitializeService
appModulesService         approvalService             auditService
bpmnToPlaybooksService    chartFilter                 chartListService
commentsService           commonService               configurationsService
connectorService          contextMenuService          correlationGraphService
countriesService          currentPermissionsService   fieldEntityDataService
fieldOperatorService      fsrExtensionService         gridColumns
htmlEditorService         iconService                 licenseService
manualInputService        markdownEditorService       marketplaceService
modelMetadatasService     moduleDiffService           nfaService
notificationService       pdfExportService            permissionService
phoneFormat               picklistsService            playbookMappingService
playbookService           playbookVariableService     preProcessingRulesService
Query                     queryCollectionService      queuesService
recommendationService     referenceBlockService       settingsService
sharedUserSettings        stateService                statusCodeService
stepTypeService           teamsService                themesService
tokenService              traitFieldsService          translationLoader
translationService        usersService                versionService
websocketService          widgetService               widgetTemplateService
```

#### Platform filters (57)

The §10 cheatsheet captures the obviously useful ones. Some extras worth knowing exist:

```
arrayToTagCollection   availableModules       availablePages
camelCaseToHuman       connectorFields        convertTagsToVar
convertToCamelCase     convertToLowerCase     convertVarsToTag
countFilter            csSanitizeHTML         dataSharingModules
dateToUnix             dateToUnixInMilliSeconds  dayToDisplay
dayToSeconds           decodeURIFilter        defaultValue
displayLicenseEdition  displayLicenseRole     domPurifySanitize
editNavigationModules  filterFieldsBySearch   filterObject
filterZone             getEndPathName         getKeyFromJinja
getModuleName          getModuleTypeOfIri     getVocabId
hex                    highlightText          humanize
isHexColorLight        isValidIRI             jinjaToTag
multiselectDisplay     numberToDisplay        picklistOptions
playbookFields         playbookModules        playbookModulesFindRecord
preProcessingModules   prependIri             ruleModules
sanitize               splitCamelCase         stripTags
stripTagsWithContent   substract              timeAgoExact
timeStampToExpiry      titlecase              transformSVGLink
truncateText           unixToDate
```

Notable ones missing from §10:

- `prependIri` — `$filter('prependIri')('alerts/abc-123')` → `/api/3/alerts/abc-123`. Saves an `'/api/3/' + module + '/' + id` concatenation (used by `csConnectorActions` on line 52964).
- `availableModules` / `availablePages` — filters module lists by current user's permissions.
- `playbookModules` — the "user modules" filter you've already seen in `edit.html` selectors.
- `picklistOptions` — returns active, `orderIndex`-sorted picklist options.
- `csSanitizeHTML` / `domPurifySanitize` — safer than `ng-bind-html` with `$sce.trustAsHtml`.

#### 99 platform constants

Injectable by name just like services. Examples (full list: `grep -oE '\.constant\("[A-Z_]+"' app.unmin.js | sort -u`):

```
API                         ALL_RECORDS_SIZE        APP_SETTINGS
AGENT_CONFIG_HEALTH         AGENT_TYPE              AGENT_UPDATE_STATE
AUTH_ERRORS                 AUTH_STRATEGIES         BRANDING_FALLBACK
CHANNEL_UUIDS               COMMENT_TYPES           COMMON_CURRENCIES
CONDITIONS                  CONFIG_HEALTH           CONFIG_IMPORT_ORDER
CONFIG_STATUS               CONNECTOR_CATEGORIES    CONNECTOR_FIELD_SUB_TYPE
CONNECTOR_REGEX             CRUD_HUB                CS_USER_TYPE
CURRENT_CONTEXT             CUSTOM_RECORD_TYPES     DEFAULT_DATE_FORMAT
DEFAULT_EXPORT_TEMPLATE     EDITOR_TYPES            EXCLUDED_FIELDS
EXCLUDED_MODULES            FIXED_MODULE            IMAGE_MIME_TYPES_MAP
LICENSE_TYPES               MARKETPLACE             MAX_PLAYBOOK_RECORDS
MAX_RECORD_EXPORT_LIMIT     MAX_TAB_MEMORY          MAX_TEXT_LENGTH
NFA_STATUS                  NFA_TRAITS              PAGE_SIZE
PB_EXEC_LOG_STATUS          PICKLIST                PLAYBOOK_EXECUTION_PRIORITY
PLAYBOOK_STATUS             PLAYBOOK_STEPS_UUID     PLAYBOOK_STEP_TYPES
PLAYBOOK_STEP_TYPES_TRIGGERS PLAYBOOK_STORAGE_TYPES PURGE_PLAYBOOKS
RECORD_TAGS_REGX            REGEX                   REPORT
RESERVED_KEYWORDS           SKIP_JINJA_BRACKETS     SORT_ORDER
SYSTEM_SETTINGS_KEY         SYSTEM_USERS            TAGS
THEMES_TYPES                TIMEZONES               USER_ACCESS_TYPE
UUID_REGX                   VIEW_TEMPLATES          WIDGET_BASE_PATH
WIDGET_CONTEXTS             WIDGET_PAGE_MAPPING     WIDGET_TEMPLATES
```

Three are especially widget-relevant:

- `WIDGET_BASE_PATH` — `{ INSTALLED: 'widgets/installed/' }` — the URL prefix you use when loading widget assets.
- `WIDGET_CONTEXTS` — the platform's master list of legal `contexts[]` values for `info.json`.
- `WIDGET_PAGE_MAPPING` — the master list of legal `pages[]` values (and their internal mapping).
- `ALL_RECORDS_SIZE` — the sentinel limit (e.g. `2147483647`) used when "all records" is wanted.
- `PLAYBOOK_STEP_TYPES` / `PLAYBOOK_STATUS` / `PLAYBOOK_EXECUTION_PRIORITY` — all the magic strings for playbook work.

Dump any one of them:

```bash
grep -A 50 'constant("WIDGET_PAGE_MAPPING"' app.unmin.js | head -60
```

### 29.3 De-minification: reading `app.unmin.js` fluently

The file is structurally readable but identifiers are single letters. Three reliable tricks.

#### Trick 1 — use the `$inject` array as a Rosetta stone

Every controller/directive ends with its `$inject` array. Walk that array left-to-right — the order matches the function parameters inside the directive factory. For `csConnectorActions`:

```js
e.$inject = [
  "connectorService", "_", "CommonUtils", "$filter", "Modules", "toaster",
  "$timeout", "usersService", "$rootScope", "licenseService",
  "FormEntityService", "COMMENT_TYPES", "TAGS", "$q", "websocketService",
  "currentPermissionsService", "Field", "DEFAULT_DATE_FORMAT", "translationService"
];
```

So inside that directive's link function, the single-letter locals (top-down in declaration order) decode as:

```
f → connectorService    g → _ (underscore)     h → CommonUtils      y → $filter
E → Modules            T → toaster            v → $timeout         (next usersService)
b → $rootScope         (licenseService)       C → FormEntityService
D → translationService (constants inlined)    O → $q                P → websocketService
I → currentPermissionsService   R → Field     N → DEFAULT_DATE_FORMAT
```

Cross-reference by reading the **uses** — e.g. `v(function(){...}, 1e3)` is unambiguously `$timeout`. `f.getConfiguredConnectors()` is `connectorService.getConfiguredConnectors()`.

#### Trick 2 — pretty-print once, then symbol-search

```bash
npx prettier --print-width 120 --parser babel --write app.unmin.js
```

This rewrites the file in place with line breaks and indentation. Prettier **does not** rename variables — the single letters stay — but line-per-statement formatting makes the `$inject` array and the directive body visible side-by-side. Pair with WebStorm/VS Code's "Go to Symbol" (Cmd-Shift-O) to jump between directives.

#### Trick 3 — Reserve full-name lookups for things the minifier couldn't touch

Angular DI names, HTML attribute names, and string literals are **never** minified. So these stay greppable:

```bash
grep -n "connectorService\." app.unmin.js | head -20           # all usages of the real-name service
grep -n "getConfiguredConnectors" app.unmin.js                  # method calls survive
grep -n "templateUrl:" app.unmin.js | head -20                 # find every templateUrl → template path
grep -n "'app/components/connectorActions/" app.unmin.js        # template cache keys survive
grep -n '"POST",' app.unmin.js | head                          # all $http POSTs
grep -n 'api/integration/' app.unmin.js | head                 # all calls to a given endpoint
```

### 29.4 Grep recipes (use these first when debugging widget questions)

When a user describes a UI behavior or pastes an HTML snippet:

```bash
# 1. Find the template producing those classes/bindings
grep -rln 'class-or-binding-from-snippet' templates-extracted/

# 2. Find the directive that renders through that template
grep -n "templateUrl.*template-path" app.unmin.js

# 3. Find the scope contract by searching the directive body
grep -n 'directive("csXxx"' app.unmin.js
# then awk that line range

# 4. Find which API endpoints are hit from the feature
grep -n "'api/..." app.unmin.js | grep -i <keyword>

# 5. Find every controller that injects a given service
grep -B 2 '"connectorService"' app.unmin.js | grep -oE '"[A-Z][a-zA-Z]+Ctrl"' | sort -u

# 6. Find where a constant is defined and where it's used
grep -n 'PLAYBOOK_STEP_TYPES' app.unmin.js | head -20
```

When a user asks "how do I replicate X from the platform?":

```bash
# 1. Locate the platform component's files
ls templates-extracted/app/components/<folder>/
grep -n 'directive("cs<Name>"' app.unmin.js

# 2. Read the HTML contract to understand what scope vars it expects
cat templates-extracted/app/components/<folder>/<file>.html

# 3. Read the directive body to understand what services it pulls
awk 'NR>=<dir-start> && NR<=<dir-end>' app.unmin.js

# 4. Look for an existing widget that uses the same service
grep -rln 'connectorService\|modelMetadatasService' widgets-extracted/
```

### 29.5 When to look at platform code vs. widget code

| Question type | Start in |
|---|---|
| "Why does *my* widget render X?" | `widgets-extracted/<yourWidget>/` |
| "How does FortiSOAR's action popover work?" | `templates-extracted/app/components/connectorActions/` → `app.unmin.js` |
| "What's the scope contract of `cs-conditional`?" | `app.unmin.js` — search `directive("csConditional"` |
| "What URL is called when I click Save on X?" | `app.unmin.js` — search the DOM's `ng-click` handler name |
| "Is there a platform filter to format an IRI?" | §10 cheatsheet → full list in 29.2 |
| "Can I open the platform's Import dialog from my widget?" | `templates-extracted/app/components/modals/import.html` + search `"import.html"` in `app.unmin.js` |
| "Does FortiSOAR expose a service for X?" | 29.2 service list + grep `app.unmin.js` for the verb |
| "What's the shape of X's `config`?" | §13 + widgets that use the feature |

### 29.6 Worked example: `csConnectorActions`

Full trace of how the Actions popover on a record works — use this as a template for debugging any platform UI:

```bash
# 1. DOM shows class "conn-actions-menu" + ng-repeat="connector in connectors"
$ grep -rln 'conn-actions-menu' templates-extracted/
templates-extracted/app/components/connectorActions/connectorActionListing.html

# 2. DOM also shows cs-connector-actions attribute → the directive
$ grep -n 'directive("csConnectorActions"' app.unmin.js
53016:  angular.module("cybersponse").directive("csConnectorActions", e), e.$inject = [...]

# 3. Walk back to find where `connectors` is assigned
$ grep -n 'a.connectors\s*=' app.unmin.js
53005:  ...a.connectors = i...
53007:  ...a.connectors = angular.copy(i)...

# 4. Read the $watch — we see `f.getConfiguredConnectors()`
# 5. Find that in the service
$ grep -n 'getConfiguredConnectors' app.unmin.js
# returns the function body showing the HTTP call
```

### 29.7 Safe vs. unsafe coupling

What's **safe** to rely on in widgets:

- Any `factory`/`service` listed in 29.2 — they're the platform's public surface.
- Any `cs*` directive — the `data-cs-*` attributes are the documented contract.
- Constants (`API`, `PLAYBOOK_STEP_TYPES`, etc.).
- Template paths like `app/components/modals/add.html` referenced through platform services (`ModalService.open(...)`).

What's **unsafe** (prefer to avoid, but understand for debugging):

- Minified variable names — they change every release.
- `templateUrl` strings as absolute references in your own code — they can move.
- `$scope.$parent.$parent` chains — fragile across UI-Router state nesting.
- Private-looking helper functions (`_handleSomething`) — unexported internals.

---
