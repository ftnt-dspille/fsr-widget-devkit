---
title: "Building Widgets That Reuse SOAR's Connector-Action UI"
topics: [angularjs, forti soar, connector-actions, cs-connector-actions]
category: widget-dev
status: canonical
summary: "Reusing the platform's connector-action rendering (cs-connector-actions, connectorActionListing) inside a custom widget, including the scope contract and how configured connectors are surfaced."
---

## Building widgets that reuse SOAR's connector-action UI

Notes captured while building `widget-action-renderer`. These apply to any
widget that embeds `cs-connector-field-renderer` or wires up its own
connector → operation → params → run flow.

### Triggering a playbook by API

`playbookService.triggerPlaybookAction({ __uuid, __resource, records })` —
**`__uuid` must be the playbook's UUID, not the record's**. Sending the
record UUID gives `404 /api/triggers/1/action/<uuid>`. `records` is the
list of record IRIs (e.g. `/api/3/alerts/<uuid>`), `__resource` is the
module name. The widget needs to track the result task ID itself if it
wants to poll for the playbook output — `triggerPlaybookAction` only
fires the trigger.

**Two trigger endpoints — by trigger TYPE (action-renderer, 2026-06-16e).**
Not every playbook is a record-context "action" trigger. The platform `API`
constant exposes both endpoints:
- `API.ACTION_TRIGGER` = `api/triggers/1/action/<route>` — record-context
  **action** triggers. Body `{__uuid, __resource, records}`. The trigger step's
  `arguments.route` is the identifier. This is what `/api/workflows/actions`
  returns (~210 on 205).
- `API.MANUAL_TRIGGER` = `api/triggers/1/notrigger/<playbookUuid>` — **generic /
  referenced / manual** playbooks (a plain *Start* trigger step with
  `triggerOnSource`/`triggerOnReplicate` and **no** `route`, e.g. "query critical").
  Body is just the params (`{}` works); returns `{task_id}`. Mirrors the platform's
  own "Run" → `MANUAL_TRIGGER + getEndPathName(playbook["@id"])` (= the uuid).

So **list all playbooks** (action + manual + referenced + scheduled, ~691 on 205),
NOT just `/api/workflows/actions` (action-only, ~210). Perf: the full list WITH
step bodies (`$relationships=true&$triggerOnly=true`) is ~3.7MB/15.7s — too heavy
for a dropdown and it busts a proxied poll window. Instead **list lightweight**
(`/api/3/workflows?$limit=1000&isActive=true`, no `$relationships` → no steps,
~2MB/8.6s) and **fetch the picked playbook's trigger step on select**
(`/api/3/workflows/<uuid>?$relationships=true&$triggerOnly=true`, ~5KB/0.36s) to
derive `triggerType` + `inputVariables`. Detect type: `arguments.route` present →
`triggerType:"action"`; else `"manual"`. Route the fire by `triggerType` (fall
back to `route` presence for legacy saved configs). Because the pick now fetches,
`onPlaybookPicked` is async (returns a promise) — await it before reading
`config.source`. The poll/log half (`checkPlaybookExecutionCompletion` →
`getExecutedPlaybookLogData`) is identical for both trigger types and needs
`playbookService`, so it only runs in the real app, not the harness.

**Live-spec gating gotcha:** `playwright.config.js` `testIgnore` drops any
`*[Ll]ive*.spec.js` unless **`E2E_LIVE=1`** (which also flips `FSR_HERMETIC=0` so
the proxy reaches the box). `FSRPB_LIVE_UI=1` alone → "No tests found" for
`actionRenderer.liveTemplate.spec.js`. Set both for the real-UI live blocks.

### cs-field placeholder leak in the harness (`{{ ::placeholder }}`)

SOAR's `app/components/form/fields/input.html` template uses interpolation
in attributes (`placeholder="{{ ::placeholder }}"`). Real SOAR ships these
templates pre-compiled into `$templateCache` at build time. When the
harness lets `$templateRequest` fetch the template at runtime, the
one-time `::` bind freezes as literal text in the rendered DOM —
the input shows `{{ ::placeholder }}` verbatim.

**Fix**: pre-load a clean template into `$templateCache` before any
`cs-field` resolves it. Use `data-ng-attr-placeholder="{{placeholder}}"`
instead of the brittle `::` form, and **keep the original `ng-change`
and `ng-blur` bindings** — `ng-change="changeMethod(value, field)"` is
what propagates user input up through `cs-field` →
`cs-connector-field-renderer.onChange` into the parent `params` map.
Drop it and selects look fine but typed text never reaches `config.params`.

```js
// harness.module.js
app.run(["$templateCache", function ($templateCache) {
  var clean = [
    '<div class="display-flex">',
    '  <input type="text" class="form-control"',
    '    data-ng-attr-id="{{formName + \'-\' + field.name}}"',
    '    data-ng-attr-name="{{field.name}}"',
    '    data-ng-model="$parent.value"',
    '    data-ng-required="field.required"',
    '    data-ng-readonly="disabled"',
    '    data-ng-attr-placeholder="{{placeholder}}"',
    '    data-ng-change="changeMethod(value, field)"',
    '    data-ng-blur="blurMethod(value)"',
    '    autocomplete="off" spellcheck="false" />',
    '</div>',
  ].join("");
  $templateCache.put("app/components/form/fields/input.html", clean);
  $templateCache.put("/app/components/form/fields/input.html", clean);
}]);
```

### Text fields render as empty thin bars (the "jinja-tag-view" bug)

The `cs-field` directive's link cycle (`app.unmin.js:9794`) sets
`field.jinjaExpressionView = isJinjaConvertibleToTag(value) || jinjaDefaultView==='edit'`.
For empty values with `enableJinjaToTag=true` and no `jinja-default-view`
attribute, this lands `false` → the field renders the read-only
`.jinja-tag-view-container` div (an empty grey bar) instead of an
`<input>`. Pre-seeding `field.jinjaExpressionView=true` on the field
object is overwritten by the directive's link.

You **cannot** simply pass `data-jinja-default-view="'edit'"` on
`cs-connector-field-renderer` to fix it — `app.unmin.js:9868` checks
`"edit" === jinjaDefaultView && "text" !== field.type` and flips
non-text fields (selects, picklists) into `jinja.input` mode (a text
input with a back-arrow toggle).

**Fix**: re-assert `jinjaExpressionView=true` on text-style field
types *after* the directive's link, via `$timeout`. Re-run on
`csFields:fieldVisibleChange` so onchange-revealed children get the
same treatment.

```js
var TEXT_TYPES = { text:1, password:1, integer:1, number:1, json:1, "jinja.input":1 };
function forceInputView(arr) {
  (arr || []).forEach(function (p) {
    if (p && TEXT_TYPES[p.type]) p.jinjaExpressionView = true;
    if (p && Array.isArray(p.parameters)) forceInputView(p.parameters);
    if (p && p.onchange) Object.keys(p.onchange).forEach(function (k) {
      if (Array.isArray(p.onchange[k])) forceInputView(p.onchange[k]);
    });
  });
}
$timeout(function () { forceInputView($scope.connectorParamFields); }, 50);
$timeout(function () { forceInputView($scope.connectorParamFields); }, 250);
$scope.$on("csFields:fieldVisibleChange", function () {
  $timeout(function () { forceInputView($scope.connectorParamFields); }, 50);
});
```

Also seed each field with a sane `placeholder` (use `description` or
a default), `value=""` (`undefined` blows up
`field.value.includes('resolveVault')` in the input template), and skip
`multiselect/select/checkbox/picklist` when forcing input view.

### cs-field input sizing

SOAR's `form-control` sizing rules sometimes don't reach widget DOM
(theme stylesheet load order). Inputs render as 5-px-tall slivers.
Add a hard CSS guard in the widget's own CSS:

```css
.your-cs-fields-wrapper input.form-control,
.your-cs-fields-wrapper select.form-control,
.your-cs-fields-wrapper textarea.form-control {
  min-height: 32px;
  padding: 6px 10px;
  line-height: 1.4;
}
```

### Auto-growing a textarea that's also filled programmatically

A composer textarea that grows with its content (`height:auto` →
`scrollHeight`) must re-fit on **both** paths: the analyst typing (the
`input` DOM event) **and** code that sets `ng-model` directly (e.g. a
"Case context" / paste-summary button). A programmatic `ng-model` change
does **not** fire `input`, so an `input`-only handler leaves the field
pinned at its one-line height with an internal scrollbar. Use a small
attribute directive that listens to `input` *and* `$watch`es the element's
`.value`:

```js
.directive('fsrPbAutosize', function () {
  return { restrict: 'A', link: function (scope, element) {
    var ta = element[0];
    function fit() { ta.style.height = 'auto';
                     ta.style.height = Math.min(ta.scrollHeight, 160) + 'px'; }
    element.on('input', fit);
    scope.$watch(function () { return ta.value; }, fit);  // catches ng-model fills
  }};
})
```
(fortiaiAgenticAssistant `view.controller.js`; cap matches the CSS `max-height`.)

### Custom-overlay modals: flex-column to avoid a double scrollbar

A widget-built modal (own `.overlay`/`.panel`, not `$uibModal`) that puts
`overflow:auto` on the whole panel scrolls the header along with the body,
and the panel scrollbar overlaps the rounded corners — visually a *second*
scrollbar next to the host page's. Make the panel a flex column and let
**only the body** scroll:

```css
.panel       { display:flex; flex-direction:column; overflow:hidden; max-height:90%; }
.modal-header,
.modal-footer{ flex:0 0 auto; }
.modal-body  { flex:1 1 auto; min-height:0; overflow-y:auto; }
/* if a <form> wraps header+body+footer, it needs the same flex column + min-height:0 */
```
Also neutralize Bootstrap's `.close` leakage (`float:none; opacity:1;
text-shadow:none`) so the × sits where flex puts it, not floated.
(fortiaiAgenticAssistant settings/history/export modals.)

### Edit-modal chrome strip — keep stepper/nav INSIDE `.modal-body`, and mind a stray `</div>`

SOAR's "Edit widget config" wraps your `edit.html` with its OWN modal-header and
Cancel/Save footer, **stripping** any `modal-header`/`modal-footer` you ship. So
a multi-step wizard's stepper and its Back/Next nav must live **inside
`.modal-body`** to survive (see `action-renderer/edit.html` top comment).

Corollary, learned the hard way: a single **unbalanced `</div>`** that closes
`.modal-body` *before* the nav makes the browser's HTML parser **reparent** the
nav out of the body. On a tall step (e.g. the Output step) the floated/normal-flow
nav then **overlaps** the form controls below it (Back/Next sitting on top of the
Table-Mode select; the nav's `border-top` separator landing mid-form). It renders
fine on short steps, so it's easy to miss. Guard it cheaply offline: count
`<div>` vs `</div>` in the stripped template and assert the nav sits between
`.modal-body` open and `</form>` (`action-renderer/tests/edit.template.test.js`).

Second corollary — **the Save button vanishes on tall steps.** SOAR's edit
modal is a fixed flex column (`header + body + Cancel/Save footer`). When the
widget ships its **own `.modal-body` wrapped in a `<form>`**, the platform's flex
height chain stops at the `<form>` (it never reaches `.modal-body`), so a tall
step grows the body unbounded, the modal exceeds the viewport, and the injected
**Save/Cancel footer is pushed off the bottom edge — no visible Save button**.
Renders fine on short steps. Fix: cap the widget body so it scrolls internally —
`max-height: calc(100vh - 240px); overflow-y:auto` on `.action-renderer-body`
(`action-renderer` v1.0.7, live-verified on 205; guard in
`tests/edit.css.test.js`). Safe here because the Output-step dropdowns are native
`<select>`; if a step has a **ui-select**, `overflow:auto` would clip its popup —
scope `overflow:visible` while open (see §ui-select clip note).

### Harness gotcha — `el.style.display = ""` falls back to a `display:none` stylesheet rule

When an element is hidden by a **stylesheet** rule (`#x { display:none }`), setting
`el.style.display = ""` only clears the *inline* style — it falls back to the CSS
rule and stays hidden. To reveal it you must set an explicit value
(`"block"`/`"flex"`). This bit the harness edit-modal **JSON switcher**: the
Form/JSON toggle hid the form and set the JSON textarea's inline display to `""`,
but the textarea's stylesheet default was `display:none`, so JSON mode showed a
blank modal. Fixed by setting `"block"` (harness `public/index.html`).

### Hello World connector for tests

The "Hello World" test connector on the SOAR test host registers as
**`hello-world`** (hyphenated), not `hello world`. A regex `/hello world/i`
will not match it; use `/hello[- ]world/i`. Confirmed operations:

| Title         | Param              | Type    | Required |
|---------------|--------------------|---------|----------|
| Say Hello     | name               | text    | yes      |
| Add Numbers   | number_a, number_b | integer | yes      |
| Reverse Text  | input_text         | text    | yes      |

Good baseline for connector-flow integration tests — small, deterministic,
and exercises the text-style param path that breaks first when
`cs-field`/template wiring regresses.

### Driving cs-connector-field-renderer from a test

The directive is gated by an `ng-if` (e.g. `connectorParamFields.length`),
so the element is in the DOM but its **isolate scope only attaches after
the next digest**. Two pitfalls:

1. There can be 2+ `<cs-connector-field-renderer>` elements in DOM (the
   recursive child-template clone is hidden). Use the visible one with
   the `.ng-isolate-scope` class inside your widget-specific wrapper.
2. To exercise the user-typing path without dispatching real DOM input
   events, call the renderer's `onChange(value, field)` directly on its
   isolate scope — that's the same callback `cs-field` invokes from its
   internal `ng-change`. After that, `config.params[field.name]` will
   reflect the value.

```js
await page.waitForFunction(() =>
  !!document.querySelector(".my-wrapper cs-connector-field-renderer.ng-isolate-scope"));
await page.evaluate(() => {
  const el = document.querySelector(".my-wrapper cs-connector-field-renderer.ng-isolate-scope");
  const rsc = window.angular.element(el).isolateScope();
  const target = rsc.jsonData.find(p => p.type === "text");
  rsc.onChange("PROBE_VALUE", target);
  rsc.$apply();
});
```

### Wizard-style edit modals: gating Next/Save

For multi-step edit modals (Source → Params → Run sample → Output) gate
progress on data, not just clicks:

- `canAdvance(step)` returns a boolean per step. For connector params,
  walk `connectorParamFields` recursively and require non-empty `value`
  on every `required && editable && visible !== false` field. Jinja
  expressions count as filled (they resolve at runtime — you can't
  validate them client-side).
- Track `maxStepReached` in `gotoStep()` and refuse `save()` until
  `maxStepReached >= lastStep && canAdvance(1..N-1)`. Otherwise users
  can save with empty required params or an unconfigured Output.
- Bind `data-ng-disabled` on the Next/Save buttons; on premature Save,
  toast + jump back to the first incomplete step instead of silently
  closing.

### Don't put `data-ng-controller` on a SOAR view.html root

SOAR's publish step strips the `Dev` suffix from the controller name
**inside the file** but leaves the `data-ng-controller` attribute alone.
Result: a parallel dead scope (the harness's wrapping ng-controller
works, the inner one doesn't), showing up as text-interpolation that
"should work" silently failing. Wrap with the harness's own
ng-controller; don't add one to the widget template root.

### Test invariants worth pinning

When wiring up integration tests against the harness:

- Assert `audit.literalInDom === 0` for `{{ ::placeholder }}` — catches
  the `$templateCache` regression directly.
- Sweep `[data-cs-field]` rows: if a row has a
  `.jinja-tag-view-container` and **no usable**
  `input/select/textarea`, that's the empty-bar bug — a height check
  alone misses it because the bar is a `<div>`, not an `<input>`.
- Assert at least one input/select has `height >= 20px` (the
  squished-input regression).
- Assert `canAdvance(2) === false` after wiping required values, then
  `=== true` after filling them.
- Assert `canSave() === false` on Step 1, then `=== true` after walking
  to Step N — and that calling `save()` prematurely doesn't close the
  modal.

#### Angular drops query params whose name starts with `$`

`$http`/`$resource`'s param serializer treats any key beginning with `$` as
private and **silently omits it from the request**. So
`$resource("/api/workflows/actions").get({ $triggerOnly:true, $relationships:true, $limit:500, isActive:true })`
sent ONLY `?isActive=true` — the `$`-filters never reached the server. For the
action-renderer "Show all playbooks" list this returned an unfiltered/odd page
that rendered blank. Fix: bake `$`-params into the URL template
(`$resource("/api/workflows/actions?$triggerOnly=true&$relationships=true&$limit=500&isActive=true")`)
where the serializer can't touch them. (Verified live: the endpoint returns 105
action playbooks; the bug was client-side param loss + the next item.)

#### Feed ui-select plain objects, not `$resource` instances

`ui-select-choices repeat="x in list | filter:{ $: $select.search }"` deep-
recurses every choice. A raw `$resource` instance carries `$promise`/`$resolved`
and nested hydra refs that can make the `{ $: … }` comparator throw or match
nothing → an empty dropdown even though `list.length > 0`. Map results to lean
plain objects (only the fields the match/template + on-select read) before
binding. action-renderer's `decorateForDropdown` does this for both the module-
scoped and "all" playbook lists.

#### cs-connector-field-renderer flashes when its `connector-data` ref changes

The directive re-initializes (fields visibly flash/reset) whenever the object
passed to `data-connector-data` changes by **reference**. Picking a different
*configuration* only needs the new `config_id`, not a teardown — so mutate the
existing object in place (`cur.config = …`) and keep the reference stable; swap
the reference only on a genuine connector/version switch. Recreating it on every
`onConfigPicked` was the "fields and dropdowns flashing" customer report.

#### Persist cs-field values into your own config at save/run

`cs-connector-field-renderer` binds to a `params` object, but a renderer re-init
(config switch, onchange subfield reveal) can repopulate the field objects from
schema defaults without writing through — so user input survives on the field
objects but not in your bound `params`, and is **lost on save** ("loses the
configuration when switching fields"). Walk the field tree (incl. visible
`onchange` children + nested `parameters`) and copy `field.value → params[name]`
right before you read params (save + run-sample). Don't trust the renderer's
write-through.

#### Colocated widget e2e specs under the `widgets-src` symlink aren't discovered

`fortisoar-widget-harness/widgets-src` is a symlink to `../widgets-src`.
Playwright canonicalizes symlinks, sees the real path is OUTSIDE `testDir` (the
harness), and silently drops every `widgets-src/*/tests/e2e/**` spec — `--list`
shows 0 files, no error. So `make ship-verify`'s mock-e2e step finds nothing for
a widget whose specs live only under `widgets-src/`. Workaround until the config
is fixed: put live/smoke specs that must run under the harness's own
`tests/e2e/` (gated by `E2E_LIVE` via a `*[Ll]ive*` filename) so they're
discoverable. (`examples/*` and the harness's own `tests/e2e/` ARE discovered.)

#### Driving the real SOAR app from Playwright — the WAF/UA/login invariants

To test a widget against the **deployed** FortiSOAR app (not the harness mock —
e.g. to exercise the real `cs-connector-field-renderer`, which the harness
stubs), use the shared primitive `fortisoar-widget-harness/lib/soarBrowser.js`
rather than re-deriving these quirks per spec:

- `launchSoarSession({ headless, env }) → { browser, context, page, base, soar, errors, close }`
  — launches desktop-UA Chrome, logs in, returns a ready authenticated page.
- `openRecord(page, base, module, uuid)` — deep-links `/modules/<m>/<uuid>`.
- `captureApiErrors(page) → { …, meaningful() }` — ≥400 `/api` + console + pageerror.

Hard invariants it owns (each silently breaks naive automation):

- **FortiGuard inline IPS blocks the default headless UA** (Attack ID 20000051 —
  "Web Page Blocked!"), even though authenticated API POSTs pass. Present a real
  desktop Chrome UA (`DESKTOP_UA`, single source of truth here — `liveUiDriver`
  re-exports it; don't fork) + `Accept-Language`. This — not SSO — is why the UI
  was historically "un-driveable" on forticloud.
- **`csadmin` is a LOCAL login, not SSO** — form `#username` + `#login_password`,
  submit `button[type=submit]`; then ~8s app-shell boot.
- **Record deep-links are `/modules/<module>/<uuid>`** (ui-router
  `main.modulesDetail`); a bare `/<module>/<uuid>` silently redirects to login.
- **TLS**: dev appliances present distrusted certs → `ignoreHTTPSErrors` +
  `--ignore-certificate-errors`.

**Placing a widget on a detail template so it actually RENDERS** (two gotchas that
each make a programmatically-added cell silently vanish — found driving the
action-renderer live test):

- **A cell needs a unique `config.wid`.** A cell of just `{type, config}` is
  silently skipped by the renderer. Every real cell carries `config.wid` (a
  widget-instance UUID); inject `config.wid = crypto.randomUUID()` on insert.
- **Custom widgets must go INSIDE a tab, not at the top level.** A detail
  template's TOP-LEVEL `widgets[]` holds only the platform layout widgets
  (`primaryDetail`, `tabs`); a custom widget placed there is ignored. Custom
  widgets live at `tabs(config.tabs[]) → tab.widget(type:"rows").config.rows[].columns[].widgets[]`.
  Insert into the primary/first tab's nested widgets array (see
  `viewTemplate.js::pickInsertionTarget`).
- A module can have **two `isDefault:true` "Base Template" rows SVTs** — resolve
  the live one via `/api/views/1/modules-<m>-detail` (don't pick by name/flag).
- Published SOAR mounts a widget WITHOUT an `ng-controller` attribute in the DOM
  (it strips the dev `…DevCtrl`). To assert "the controller is live" on a real
  page, check scope-driven OUTPUT (e.g. the `v{{ widgetVersion }}` binding
  interpolated, the unconfigured banner rendered), not the controller name.

`liveUiDriver.js` (SOC-Assistant drawer flow) is now a thin layer on top of
`soarBrowser`. To place a widget on a real record's detail view for such a test,
use `tests/live/lib/viewTemplate.js` (`addActionRendererWidget` /
`removeActionRendererWidget` — idempotent; cleanup is mandatory since it mutates
the production SVT) and `resolveInstalledActionRendererVersion()` so the version
never drifts on a `--bump`. Example: `tests/e2e/actionRenderer.liveTemplate.spec.js`
(gated `FSRPB_LIVE_UI=1`). The SVT API: a module's detail layout is a `type:"rows"`
system view template; the ACTIVE one's uuid comes from
`GET /api/views/1/modules-<module>-detail` (don't pick by name — duplicates exist).

**Harness-shell EDIT-modal limits (two things the harness can't drive — found
working out the action-renderer playbook-listing live test, fix #4):**

- **`playbookService` won't init in the harness** — `getPlaybookService()` logs
  `lazyService failed for playbookService … reading 'generate'` and returns null,
  because it transitively needs websocket/`$stomp` platform deps the harness
  stubs don't provide. So any edit path that calls `playbookService.*` (e.g. the
  action-renderer's MODULE-SCOPED playbook list `getActionPlaybooks`) yields an
  empty result in the harness shell — that path is only verifiable in the real
  **Application Editor**. The "Show all" branch uses a plain
  `/api/workflows/actions` `$resource` and DOES work against the live box
  (`E2E_LIVE=1` → `FSR_HERMETIC=0` → proxy reaches the box).
- **AngularJS checkbox `ng-model` doesn't bind in the harness** — clicking a
  `<input type=checkbox data-ng-model=…>` flips the DOM `checked` but NOT the
  scope var (the input directive's change listener isn't wired in the harness's
  vendored Angular; `ng-click` on buttons works fine). To drive a checkbox's
  `ng-change` in a harness-shell test, fire the handler via scope
  (`sc.flag = true; sc.onToggle(); sc.$apply()`) — same approach the
  `playbook-dropdown-contrast` spec uses — and assert the checkbox is merely
  visible for affordance fidelity. (In the full platform the binding works.)

Live playbook-listing test: `tests/e2e/actionRenderer.playbookListingLive.spec.js`
(gated by `Live` in the filename → needs `E2E_LIVE=1`). Run it against the box
that HAS playbooks via `make test-ar-playbook-live` (exports `.env.box` = 205).
It proves the "Show all" branch loads the real global action-trigger list (210 on
205 vs alerts-scoped 44), the ui-select renders + filters it, AND a real playbook
SELECT populates `config.source` + param rows.

**Playbook SELECT must NOT hard-depend on `playbookService` (action-renderer bug
fixed 2026-06-16).** `onPlaybookPicked` originally did
`if (!getPlaybookService()) return;` then `playbookService.getTriggerStep(pb)` —
so in any environment where `playbookService` isn't registered (the harness, and
notably the *exact* "Show all" path which serves environments without it) picking
a playbook silently NO-OP'd: `config.source` never populated. Fix: derive the
trigger step locally when the service is absent — `getTriggerStepFor(pb)` prefers
`playbookService.getTriggerStep` but falls back to scanning `pb.steps[]` for the
step carrying `arguments.route`/`arguments.inputVariables` (action-trigger
playbooks from `/api/workflows/actions?$triggerOnly=true` expose route +
inputVariables on `steps[0].arguments`). The decorated dropdown objects already
keep `steps`, so the fallback has what it needs.

**Two playbook param-gating bugs (same fix):** (1) playbook param rows are bound
in `edit.html` to `config.params[row.name]`, but `requiredParamsFilled()` read
`row.value` — a dead mismatch, so playbook required-param gating never worked.
Read `config.params[r.name]`. (2) `rebuildParamRows` built rows without a
`required` flag and ignored the inputVariable's `defaultValue`; the live
inputVariable shape carries both (`{name,type,label,required,defaultValue,…}`).
Propagate `required` onto the row and seed a non-empty `defaultValue` into
`config.params` so a defaulted param doesn't read as unfilled.

#### Controller-name drift silently dead-letters the whole suite

A bump that renames the controller (e.g. `…Widget100DevCtrl` →
`…Widget101DevCtrl` on a 1.0.0→1.0.1 version bump) must be mirrored in the
test's `CTRL_NAME` constant. `$controller(name)` throws `ctrlreg` ("controller
… is not registered") for **every** test in the file, so the suite goes 100%
red at once — easy to misread as "the controller is broken" when it's just the
test name lagging the version. The widget-action-renderer suite sat fully red
this way (both `view`/`edit` test files pinned to `…100DevCtrl`). Grep
`grep -rn "DevCtrl" widget/*.controller.js tests/*.js` after any version bump.

#### Single-primitive table root rendered the wrapper object, not the value

In `view.controller.js buildTable()`, a table whose `rootPath` resolves to a
bare primitive was normalized as `rows=[{value: rooted}]`, but the auto-mode
"value" column calls `formatCell(row)` on the **whole row** — so a primitive
`7` rendered as the cell text `{"value":7}` (an array-of-primitives root
rendered correctly because its rows are the primitives themselves). Fix: keep a
primitive root as `rows=[rooted]` so the "value" column formats it directly.
Pin it: assert a `{n:7}` result with `rootPath:"n"` yields `tableRows=[["7"]]`.

#### `resolvePath` auto-descends single-element wrapper arrays

Many FortiGate/generic-playbook responses wrap the real payload in a 1-element
array — e.g. `gui_response.result` is `[{data:[…]}]` rather than `{data:[…]}`.
`resolvePath` in both `view.controller.js` and `edit.controller.js` handles this:
when traversing a dotted-key segment it checks whether the current value is a
length-1 array and, if so, descends into `v[0]` automatically before looking up
the next key. This means `rootPath:"data.gui_response.result.data"` reaches
`result[0].data` without requiring an explicit `[0]` in the path.

- **Only safe for length-1.** A multi-element array is ambiguous and is NOT
  auto-descended — the path resolves to `undefined`/`{found:false}`. Use an
  explicit index (`result[2].data`) for multi-element arrays.
- **Explicit `[0]` is always equivalent and preferred when the shape is known**
  (`result[0].data` and `result.data` both work; be explicit in static configs
  to make intent clear).
- Tested in `edit.controller.test.js` ("resolvePath auto-descends…") and
  `view.controller.test.js` ("rootPath auto-descends…") — `widget-action-renderer`.

### The harness hot-reload watcher corrupts concurrent e2e — disable it under `FSR_HERMETIC`

The dev harness (`server.js`) watches each widget dir + `harness.module.js` and
broadcasts a **soft-remount** over SSE (`/_fsr/events`) on any file event;
`public/index.html` reacts by calling `mountWidget()` again, which
**re-instantiates the widget controller** (its in-memory state — `messages`,
`events`, in-flight turns — resets to empty). Great for live iteration, silently
destructive under e2e: with 2 Playwright workers a stray FS event (a lint
refresh, macOS FSEvents noise, a sibling spec that writes a widget asset) during
one test's idle window remounts that test's widget mid-run. Symptom seen: the
`slow_turn` Stop test deterministically failed under 2 workers (probe showed a
**fresh** widget — `events:[]`, `msgs:0`, empty console — with no second page
navigation), while passing solo or with `--workers=1`. Tests never edit source
mid-run, so gate every watcher off in test mode: `if (!HERMETIC) fs.watch(…)` /
`if (!HERMETIC) for (const w of WIDGETS) attachWatcher(w)` (`HERMETIC =
process.env.FSR_HERMETIC === "1"`, which `playwright.config.js` sets by default
for the mock tier). Lesson: any harness "hot-reload" / soft-remount must be off
under e2e — a mid-test controller re-mount is an un-debuggable state wipe.

---
