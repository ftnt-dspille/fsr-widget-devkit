---
title: "FortiSOAR Drawer / Non-Modal Widgets"
topics: [angularjs, forti soar, drawer, enable-for, standalone-widget]
category: widget-dev
status: canonical
summary: "Drawer and non-modal widget lifecycle: page contexts, enableFor mechanics, mounting, approval flows, and gotchas for standalone widgets (the most-consulted KB section)."
---

## 18. Drawer / non-modal widgets

A widget becomes a floating "drawer" icon (like FortiAI / Setup Guide) when:

```jsonc
"metadata": {
  "pages": [],
  "contexts": ["drawer"],
  "standalone": true,
  "windowClass": "Half Width",
  "view": {
    "popup": "custom",          // Interactive background (non-blocking)
    "draggable": true,          // User can drag the panel
    "activeBackground": true,
    "displayName": "FortiAI",   // Optional — shown next to logo
    "enableFor": [              // Where the drawer icon appears
      "main.dashboard",
      "viewPanel.modulesDetail",
      "main.playbookDetail",
      "main.modules.list"
    ]
  }
}
```

Without `popup: "custom"` the widget opens with a blurred/blocking background (classic modal behavior). `draggable` only has effect when `popup` is `"custom"`.

### 18.1 Drawer lifecycle hooks

The platform fires two extra events to a drawer controller:

```js
$scope.$on('popupOpened', () => { /* refresh, start polling, etc. */ });
$scope.$on('popupClosed', () => { /* pause timers, cancel pending requests */ });
```

Examples: `aiAssistant-4.0.1`, `playbookDeveloperAssistant-1.0.0`.

> **⚠️ Detect host-record context on events, NOT once at boot.** A drawer widget
> is **not torn down on navigation** — its controller/scope stay alive while the
> user moves between pages (§18.4). So reading the current record only in the
> controller constructor is a bug: at construct time `$state` may still be on the
> page you opened *from* (e.g. a module **list**), and the host record is **not**
> reliably on `$scope`. If you then navigate to a record **detail** page, your
> cached context is stale/empty and anything you send upstream goes out with no
> record. (Live regression: the FSR SOC Assistant triage drawer sent
> "Investigate this alert" with no `entity` block because it detected context
> once at boot.) The fix — re-derive on the drawer lifecycle:
>
> ```js
> // Re-detect when the drawer opens AND on every navigation while mounted.
> $scope.$on('popupOpened', _refreshContext);
> $scope.$on('$stateChangeSuccess', _refreshContext);
>
> function _refreshContext() {
>     // $state.params is now settled — read module/id off it.
>     var module = $state.params.module, id = $state.params.id;
>     if (!module || !id) return;                 // list/dashboard — keep last context
>     // Load the record authoritatively (same source the native drawer reads).
>     var entity = FormEntityService.get();
>     entity.loadFields().then(() => { /* update scope context, re-seed */ });
> }
> ```
>
> Guard the refresh on "no record ⇒ return early" so navigating back to a list
> doesn't *strip* a context you already have, and gate any auto-seed on an empty
> conversation so an in-progress chat isn't clobbered. `fortisocchatagent` is the
> canonical reference (`_updateContextFromState` + `_registerStateListener`);
> `fortiaiAgenticAssistant`'s `_refreshEntityContext` follows the same shape.
>
> **⚠️ The `popupOpened`/`$stateChangeSuccess` hooks are NOT enough on their own —
> also re-detect in the init `$timeout`.** Opening a drawer *directly onto* a
> record detail (e.g. clicking a case and the drawer mounts as part of the same
> navigation) can settle `$state` onto the detail *between* controller
> construction and the first digest, with **no** further `$stateChangeSuccess`
> broadcast reaching the live scope. If your one-time boot detect (line-1 of the
> ctor) ran on the still-empty `$state`, and your init/seed `$timeout` trusts that
> captured-null context, the summary/seed **never appears until the user
> navigates away and back** (which finally fires a nav event). Live regression:
> `fortiaiAgenticAssistant` 1.0.47 → the record-summary card was missing on a case
> until the analyst backed out to an incident detail and reopened the case. Fix
> (1.0.48): in the init `$timeout`, **re-run the detect** before seeding, and if
> it's still empty (state mid-transition at `$timeout(0)`), schedule one short
> retry (~300 ms) that calls `_refreshEntityContext`:
>
> ```js
> $timeout(function () {
>     if ($scope.messages.length > 0) return;
>     if (!($scope.entityContext && $scope.entityContext.iri)) {
>         var re = _detectEntity();
>         if (re && re.iri) $scope.entityContext = re;
>         else $timeout(function () {            // state still settling at t=0
>             if ($scope.messages.length === 0) _refreshEntityContext();
>         }, 300);
>     }
>     /* …chatHistory rehydrate / _seedFromEntity … */
> }, 0);
> ```
>
> Note the side effect: an entity-less mount (true dashboard/list) now schedules a
> stray 300 ms timer — harmless, but tests that assert "no pending `$timeout`
> tasks" via `expect(()=>$timeout.flush()).toThrow()` will break; assert the real
> intent (e.g. `pollSpy` not called) instead.

### 18.2 Multi-context drawer

```jsonc
"contexts": ["drawer", "pb_designer"]
```

Shows the widget in the general drawer rail **and** as a tool inside the Playbook Designer toolbar.

### 18.3 Header / boot context

```jsonc
"contexts": ["header_navbar", "launch_on_boot"]
```

Used by `setupGuide` — adds an icon to the top bar and auto-launches on first login.

### 18.4 How `enableFor` actually works (and what state names mean)

`metadata.view.enableFor` is the **only mechanism** that lets a widget render on a SOAR page that isn't one of the marketplace wizard's five hardcoded `pages` values (`View Panel`, `Dashboard`, `Reports`, `Listing`, `Add Form`). It is read by the `csDrawerWidgetGroup` directive (`fsr_src/app.unmin.js:26220–26236`).

On every Angular UI-Router `$stateChangeSuccess`, the directive walks every drawer widget and toggles `metadata.drawerVisibility` based on whether `$state.current.name` appears in that widget's `enableFor` array. Empty/missing `enableFor` ⇒ always visible.

**The state-name format.** SOAR uses Angular UI-Router with dot-separated parent/child state names:

- `main` is the post-auth app shell (`app.unmin.js:46127`). Sticky state, mounts `app/templates/main.html` into the `content` view, deep-redirects to `main.dashboard`. Every authenticated page is a child.
- `main.playbookDetail` (`app.unmin.js:32540`) — URL `/playbooks/:id`, controller `PlaybookDesignerCtrl`, template `app/playbooks/designer/designer.html`. The playbook editor.
- Other useful child states visible in the bundle: `main.dashboard`, `main.editor`, `main.workflow`, `main.rules`, `main.search`, `main.security`, `main.profile`, `main.system`. To enumerate, grep `app.unmin.js` for `.state("main.`.

**The matcher uses `_.contains` on the exact `current.name`** — so `main.playbookDetail.subview` does **not** match `main.playbookDetail`. List each nested state explicitly.

### 18.5 Capabilities this unlocks

Drawer widgets are the most general extension primitive in SOAR. A few things that follow:

- **Target any UI-Router state, not just the five "pages".** Workflow editor, rule editor, system-settings — anywhere SOAR has a state, you can scope a widget to it. The marketplace wizard's pages list is just the dashboard-picker UX; `enableFor` ignores it.
- **Persistent floating tools across navigation.** Drawer widgets aren't torn down on route change — they keep their controller/scope alive and just toggle visibility. So a Jinja editor with `enableFor: ["main.playbookDetail", "main.editor"]` stays open with its template/input intact while the user flips between records and playbooks. Not achievable with a normal page widget.
- **Cross-page context via the `payload` binding.** `csDrawerWidgetGroup` passes a `payload` two-way binding into each widget. Combined with walking `$rootScope.record` (current viewpanel record) or reading `$state.params`, the drawer widget can react to whatever the user is currently looking at *behind* the popup.
- **Popup event bus.** `$broadcast("popupOpened", widgetKey)` and `$broadcast("popupClosed", widgetKey)` fire on every drawer-widget open/close (`app.unmin.js:26248`). Widgets can listen to coordinate — e.g. close-self when another opens, refresh on return.
- **Override / wrap SOAR UX without forking.** Because `popup: "custom"` renders into the shared `#custom-modal` as a fixed overlay, a drawer widget can effectively be an alternate UI for any state. Useful for: custom record viewer scoped to one module, debug console only on `main.system`, "convert to Jinja" helper button on the playbook editor.

**Gotchas.**
- Drawer widgets are not picker-installable — they appear in the drawer rail on install and have no "Add to dashboard" UX. There is no edit-modal flow either; per-user config has to live in user prefs, the current record, or hardcoded.
- The drawer rail itself must be enabled by the SOAR shell. It is in standard SOAR, but a customer admin who has hidden it leaves nothing to render into.
- For per-record gating beyond state-name matching (e.g. "only when editing alerts module playbooks"), you still need the drawer widget to mount, then a `$watch` on `$state.params` to hide its UI internally.

The mental shift: **widgets aren't just dashboard tiles** — they're a sanctioned plugin extension point with a stable rendering surface and event bus. The dashboard/listing picker is the documented use; `enableFor` + `popup: "custom"` is the more general primitive.

### 18.6 Streaming chat-drawer gotchas (fortiaiAgenticAssistant)

A drawer widget that streams an agentic run (poll a `chat_poll` feed while a
blocking `chat_turn` is in flight) hit four non-obvious failure modes. All four
are now fixed in `fortiaiAgenticAssistant` and worth copying:

- **Rebuilding the live preview resets per-tool UI state.** If each poll rebuilds
  `streamingMessage` through the same renderer (`FsrPbRender.buildAssistantMessage`),
  the renderer reseeds every `tool_call`'s `{_open,_inputOpen,_resultOpen}` to
  collapsed — so anything the analyst expanded snaps shut on the next ~700 ms poll.
  Carry the prior preview's expand state forward (`_mergeUiState`, keyed by
  `_toolUseId` with positional fallback) **before** assigning the new preview, and
  make the step `ng-repeat` `track by (ev._toolUseId || $index)` so AngularJS
  doesn't recycle DOM by position.

- **Gateway error bodies leak secrets and overflow the widget.** An nginx 404 / 5xx
  echoes the *request* back — including the live `Authorization: Bearer <JWT>` and
  `Websocket-SessionID`. Never show `err.message` raw: map HTML/4xx/5xx bodies to a
  friendly bounded string, scrub `Bearer`/JWT/token/session before anything is
  stored **or exported** (a downloaded `.md` is a leak vector too), and cap the
  banner CSS (`max-height/overflow/word-break/pre-wrap`).

- **`renderMarkdown` must cover block markdown.** A bold/italic/code/links-only
  mini-parser renders LLM `## headings`, `| pipe tables |`, `---`, and `- lists`
  literally. Parse them escape-first (extract fenced code to placeholders before
  block parsing so `|`/`#` inside code isn't mangled), and keep links restricted to
  root-relative/`http(s)` (no `javascript:`/`data:`).

- **`chat_turn` can't be the sole long-lived request for long agentic runs.** A
  "build" turn is one blocking POST; a >5-min agentic run dies against the ~300 s
  gateway ceiling regardless of streaming quality. Durable answer: trim the re-sent
  prior `tool_result`s (they ride verbatim each turn — ~30 KB of records) and commit
  **poll-to-completion** — when the `chat_poll` `stream_end` frame carries the
  transcript, build a result from it (+ the stream's turn #) and run it through the
  *same* `_handleTurnResult` path as the POST return. For this to be safe the commit
  path must be **idempotent per turn** (`_committedTurns[turn]`, first writer wins)
  and `_handleTurnResult` must treat a fast `{accepted}`-with-no-transcript POST
  reply as a no-op (latch the turn #, keep the stream alive). That combination lets
  the connector return an immediate ack and stream the real work to the terminal —
  no blocking POST, no 300 s ceiling — while sync mode (POST returns the full
  transcript) still works because the duplicate is deduped. In the contract this is
  **2.7.0 "detached mode"**: the widget opts in by sending `detached: true` on the
  live `chat_turn` payload (not `chat_resume`), the connector runs the agent on a
  daemon thread (under uwsgi the per-request `harakiri` ceiling ~5 min SIGKILLs a
  blocking worker, losing the terminal frame), and the terminal `stream_end` frame
  carries the **full** envelope (`transcript`, `turn_id`, `contract_version`,
  `last_assistant_yaml`, `tags`) so it stands in for the blocking return. The ack's
  `stop_reason` is the literal `"accepted"` — detect it (or `accepted:true`) +
  no-transcript as the no-op.

- **`stop_reason` is an Anthropic-native vocabulary — switching the connector's
  LLM provider to OpenAI silently broke it.** The contract's terminal value for a
  normal turn is `"end_turn"` (plus `awaiting_*` / `max_turns` / `error`). The
  AnthropicProvider satisfies this *natively* because Anthropic's own
  `stop_reason` already returns `"end_turn"` — there is **no normalization layer**
  between provider and contract. So when the box connector was repointed to
  OpenAI (`gpt-4o-mini`), the provider leaked OpenAI's raw chat-completions
  `finish_reason` (`"stop"`, `"length"`, …) straight into `stop_reason`, and a
  normal turn started ending on `stop_reason:"stop"`. The widget *tolerates* it
  only by accident (its `view.controller` branches on `awaiting_*`/`error`/
  `approval_*` and lets everything else fall through to idle), but the live
  contract test `tests/live/chat.live.test.js` T3 asserts `=== "end_turn"` and
  any strict consumer breaks. Fix is in `fsr_playbooks/llm/openai_provider.py`
  (`_contract_stop_reason()`: `stop→end_turn`, `length→max_turns`,
  `content_filter→error`, empty→`end_turn`) — normalize at the provider so OpenAI
  emits the same vocabulary Anthropic does. **Lesson: any provider added behind
  this connector must map its native finish/stop tokens onto the contract
  vocabulary; the contract is not provider-agnostic by construction.**

- **The stale-replay race: a concurrent `chat_poll` can be served the PREVIOUS,
  already-terminal turn and commit it as the new one.** The widget starts
  polling the moment it fires `chat_turn` (poll at delay 0), and the connector's
  `chat_turn` does health-check + warmup *before* it writes the new turn's
  `turn_start`. If the first poll wins that race, the feed's "current turn"
  (scoped to `MAX(turn)`) is still the *completed* prior turn — whose
  `stream_end` reports `done:true` with its transcript. The widget commits that
  old transcript as the new turn and the new turn produces nothing (export
  `sess-ei6esw96`: a "build playbook" turn replayed the prior enrichment, same
  `tool_use` ids, `finalYaml:false`). The widget's own `minTurn = _lastTurn + 1`
  frame-gate normally drops it — but **`_lastTurn` stays 0 after a history-open**
  (`_replayTurns` rehydrated turns without advancing it), so `minTurn=1` failed
  to exclude turn 1. Fixes, layered:
  - **Connector (root cause):** `chat_poll`/`read_turn_progress` take a
    `since_turn` fence and return only a turn **strictly greater** than it, so a
    completed prior turn is never served. The widget passes `s.minTurn - 1`.
  - **Widget:** `_replayTurns` advances `_lastTurn` to the rehydrated turn count
    (one assistant transcript == one connector turn; never over-count → never
    hang the next poll).
  - **Widget commit guard (defense-in-depth):** latch `_detachedActive` for the
    in-flight detached turn so `_handleTurnResult` treats **any** synchronous
    return (`!fromPoll`) as an ack and never commits its transcript — only the
    `chat_poll` `stream_end` (tagged `_fromPoll`) may commit; plus an
    `_isStaleReplay` drop of any transcript whose `tool_use` ids are **all**
    already on screen. Set the latch *after* `_startStreaming()` (it calls
    `_stopStreaming`, which clears the flag). NB: the detached `chat_turn`
    *return itself is clean* (`{accepted:true}`, no transcript) — the leak was
    the poll feed, not the ack.

- **The other half of the `since_turn` fence: the connector's turn counter must
  increment on EVERY turn, or live messages silently vanish.** The fence above
  (`chat_poll` returns only a turn **strictly greater** than `since_turn`) is only
  safe if the connector's `turn_idx` and the widget's `_lastTurn` advance in
  lockstep. The connector originally derived `turn_idx = MAX(chat_turns.turn) + 1`,
  but a `chat_turns` row is written **only on a `UsageEvent`**. A turn that fails
  *before* usage — LLM gateway down/502, an error in the prologue — writes a
  `turn_start` frame but no `chat_turns` row, so the **next** turn reuses the same
  `turn_idx`. Meanwhile the widget's `_lastTurn` advanced (it committed the failed
  turn's error terminal), so its poll fence (`since_turn = minTurn - 1`) is now one
  ahead of the connector's numbering and `read_turn_progress` (`turn > since_turn`)
  excludes **every** subsequent live turn forever → `chat_poll` returns
  `turn:null`, empty frames, `done:false`, and the analyst sees no live messages.
  Fix (connector `0.3.134`): derive the next turn from `MAX(turn)` across **both**
  `chat_turns` AND `turn_progress` (`Storage.next_turn_idx()`) — `turn_progress`
  gets a `turn_start` row for every turn, so the counter increments
  unconditionally. Lesson: never key a monotonic turn counter off a table written
  conditionally (usage/success-gated); key it off one written for every turn.
  Diagnostic fingerprint in a bug report: a `chat_poll` request with `since_turn:N`
  where the connector returns `turn:null` (it has no turn > N).

- **Classifying a poll error: never match the bare operation name — a transient
  transport blip echoes it.** The `chat_poll` `.catch` must decide "connector
  can't stream this op" (stand the loop down, show "Streaming this build is
  unavailable… Please retry.") vs. "transient blip" (reschedule the same cursor).
  The original test matched `/chat_poll|unknown operation|…/` against
  `JSON.stringify(err)` — but a rejected `$http` error carries `config.data`,
  which still holds `operation:'chat_poll'`. So an intermittent upstream **502 /
  `ERR_EMPTY_RESPONSE`** (common on the forticloud→OpenAI gateway path) matched the
  bare token and **stranded the turn with a dead banner — the source of the
  "sometimes the widget just errors" inconsistency**. Same scenario, run twice:
  once 3 tool calls + answer, once dead banner + 0 tool calls. Fix
  (`view.controller.js` `_pollOnce.catch`): treat `status <= 0 || status >= 500`
  (or `ERR_EMPTY_RESPONSE`/`Bad Gateway`/`timeout`/`ECONNRESET`…) as **transient →
  retry**; only a structured `unknown/no such/invalid/unsupported operation` (or
  `operation … not found`) on a non-5xx rejection counts as **unsupported**.
  Regression-tested in `tests/streaming.test.js` (transient 502 whose blob echoes
  `chat_poll` must retry; a 400 `unknown operation` must still stand down). General
  rule: classify transport failures by **HTTP status/transport code**, not by
  substring-matching the payload, which contains the request you sent.

- **The legacy `approval_required` modal must resume by `approval_id`, and the
  `approval_request` event has no `args`.** A tier-3 op (e.g. `push_playbook`)
  routed through the connector's `SuspendedSession` gate ends the turn with
  `stop_reason:"approval_required"` and an `approval_request` transcript event.
  That event carries `{approval_id, tool, tier, preview:{tool,args}, args_hash,
  summary, requires_step_up}` — **no top-level `args` field**. Two traps:
  (1) Rendering `ar.args` in the dialog always shows an empty `{}` (the field
  doesn't exist); show `ar.summary`, falling back to a non-empty `ar.preview.args`
  or a plain explanation. (2) The connector's `chat_resume` pops the suspended
  session **by `approval_id`** (`_resume_suspended` → re-enters the provider loop
  with `_approved:True` so the op actually executes). Resuming with only
  `turn_id` falls through to the generic *conversational* resume, the op never
  runs, no playbook is created, and the turn dead-ends ("stuck after Approve").
  Always send `approval_id` on the resume payload. (`preview.args` for
  `push_playbook` is itself `{}` because the compiled YAML isn't echoed into the
  preview — the full args live server-side in the `SuspendedSession`.) This is
  distinct from the `action_card` path, which resumes by `card_id`.

- **A detached turn commits ONLY via the poll terminal, so EVERY poll-teardown
  path must guarantee `viewState` leaves `'sending'` — else the composer hangs on
  the typing bubbles.** In detached mode the `chat_turn` ack carries no
  transcript, so the turn is committed exclusively by the `chat_poll` `stream_end`
  frame (`_fromPoll`). Each way `_pollOnce` can call `_stopStreaming()` *without*
  committing then strands `viewState==='sending'` forever (ng-if of the
  `typing-indicator`) — the exact "click Build playbook → just see the chat
  bubbles" report. The four strand paths and the fix (`_settleDetachedIfStranded`,
  a single chokepoint that degrade-commits the streamed `s.frames` as an
  `end_turn`, or surfaces an error — no-op once committed or in non-detached mode
  where the blocking return is still authoritative):
  - **Signal-only terminal** — `stream_end` with `done:true` but **no transcript**
    (`_absorbPoll`'s "defer to chat_turn return" branch). In detached mode there
    *is* no blocking return to defer to → settle (degrade-commit the frames).
  - **Lost producer / never-terminal** — `chat_poll` is unreachable or `done`
    never flips, so the loop polls forever. The connector's own lost-producer
    guard (writes an error terminal after `STREAM_TIMEOUT_SECS=300`) doesn't help
    if `chat_poll` itself is down. Add a widget wall-clock watchdog
    (`DETACHED_WATCHDOG_MS`, default 6 min, `config.detachedTimeoutMs` override)
    that settles with an error past the cap.
  - **Capability gate / unknown-op** — `chat_poll` answers below `STREAM_MIN_CONTRACT`
    or rejects as an unknown op. The old code set `s.supported=false` and "degraded
    to the blocking response" — but a *detached* turn has no blocking response, so
    that degrade silently hung. Settle with an error.
  - **Render throw during commit** — if `_appendAssistantMessage`/`buildAssistantMessage`
    throws (e.g. a `tool_result` with `null` content — `JSON.stringify(undefined)`
    returns `undefined`, then `.length` throws), the poll `.then` rejects into a
    `.catch` that sees the stream already stopped and bails → strand. Hardened the
    renderer to coerce `tool_result` content to a string, and the settle helper is
    wrapped in try/catch that forces an error state as a last resort.
  Mock-mode turns are synchronous (return the full transcript inline, write no
  feed) so **none of the mock e2e specs exercise this path** — the live detached
  poll loop had zero frontend coverage. Probe it by forcing `?mode=live` and
  `page.route`-stubbing the connector HTTP layer (`POST /api/integration/execute/`,
  `GET /api/integration/connectors/`) to script the detached contract: ack →
  `turn_start` → frames → terminal. See `fortiaiAgenticAssistant.liveDetached.spec.js`.
  Two gotchas building that probe: Playwright **regex** route patterns match here
  where `**/…` glob strings silently don't; and the `__fortiaiAgenticAssistant__` test
  probe was previously exposed only in mock mode — broadened to any harness
  (localhost) mount so live-path state is introspectable.

- **The build-vs-triage UI mode is NOT on the wire, so a refresh-rehydrate must
  RECONSTRUCT it from the transcript — otherwise an already-built playbook comes
  back hidden.** `chat_history` returns only `{user}` / `{transcript}` turns; the
  `uiIntent` the analyst was in (and `currentYaml`, `playbookLink`) is pure client
  state that a reload drops. On a record-mounted drawer `uiIntent` defaults to
  `'triage'`, and the YAML pane + the `▦ Show/Hide YAML` toggle + the `✚ Create`
  shortcut are all gated on `uiIntent !== 'triage'` (`hasYamlPane()`), while the
  "Ready to automate this?" handoff CTA is gated on `uiIntent === 'triage'`
  (`canBuildFromTriage()`). So after building a playbook and refreshing, the
  analyst saw: no YAML toggle, no created-playbook link, and a confusing
  "Build playbook" CTA re-offering work already done (export `sess-rur4yvdd`).
  Fix in `_replayTurns` → `_rehydrateBuildState()`:
  - **Scan ALL assistant turns for the last `​```yaml` fence, not just the last
    transcript.** A later push/confirm turn carries no fence, so the old
    `_extractYaml(_lastTranscript())` missed an earlier draft. Worse,
    `_lastTranscript()` mapped committed text events to `{text: e.display}` — but
    committed text events store the body on **`.text`** (`{type:'text', text}`),
    so `.display` was `undefined` and YAML never restored at all on reload. Read
    `ev.text` off the committed events directly and `_lastTranscript()` is gone.
  - **Restore `playbookLink`/`playbookName` from a persisted `playbook_pushed`
    `info_card`.** The offer-accept path (`_resume_playbook_offer_accept`)
    persists that card (with a `kind:'link'` block) into the transcript, so the
    "Open in Playbook Designer" link survives a refresh — but the *client* push
    path (`pushPlaybook` → `_appendSystemMessage`) only writes a live system
    message that is NOT persisted, so that link is still lost on reload (would
    need a connector-side transcript-persist on `push_playbook` to fix durably).
  - **Flip `uiIntent` to `'build'` when YAML or a pushed card is present**, so the
    pane/toggle render and the redundant build-from-triage CTA is suppressed. A
    plain triage session (no YAML) correctly stays in triage. Drive the path in
    e2e via the test-only `__fortiaiAgenticAssistant__.replayTurns(turns)` probe
    (`fortiaiAgenticAssistant.rehydrateBuild.spec.js`); note `link` is a real
    `normalizeBlocks` kind — the render-pipeline fixture validator's `BLOCK_KINDS`
    set was missing it.

- **The entity summary (seed) card silently fails to render under three race/IO
  conditions — over a *real* record the analyst sees the entity-aware hero
  ("Triaging incident…") but NO summary card and a dead chat.** The seed is
  pushed once, gated on `messages.length === 0`, from the init flow (after a
  bounded `_resolveEntityContextWithRetry`, ~2 s) or a `popupOpened` /
  `$stateChangeSuccess` reseed. That left three gaps, all fixed in `fortiaiAgenticAssistant`:
  - **Late entity, no follow-up event.** If `$state` settles onto the
    record-detail page *after* the 2 s init retry gave up and no further
    navigation event fires, neither reseed path runs. Fix: a `$watch` on
    `entityContext.iri` that seeds whenever an entity is present and the timeline
    is still empty — the durable backstop that doesn't depend on event timing.
  - **A non-record HTTP body clobbers the `{@id}` stub.** `_resolveEntityRecord`'s
    fallback `GET <iri>?$relationships=true` adopted `resp.data` unconditionally;
    a proxy error page / 200-with-junk overwrote the stub so the card render
    (which needs `@id`) bailed *and* every later reseed failed. Fix: only adopt
    the response if it looks like a record (`_recordHasFields(r) || r['@id'] ||
    r.iri`), else keep the stub.
  - **No card when resolution yields nothing.** `_seedFromEntity` now ALWAYS
    renders a card when an IRI is known (composer falls back to the IRI for the
    name), and is idempotent via a `_seedInFlight` latch + the `messages.length`
    recheck so the watch + init + a state event racing during an in-flight fetch
    push exactly one card. Lesson: a drawer's auto-seed must be event-independent
    (watch the resolved value, not the event) and must degrade to a stub card
    rather than rendering nothing.

- **That auto-seed `$watch` then SUPPRESSED the opener — fast entity ⇒ seed card
  ⇒ init bails ⇒ no opening `chat_turn`, dead chat.** The init `$timeout` was
  guarded `if ($scope.messages.length > 0) return;` (meant to skip when a session
  is already rehydrated). But the seed backstop above fires the `$watch` *first*
  when the entity is immediately available (a drawer mount, or an injected
  `__fsrPbEntity__` in e2e), pushing the summary card before init runs — so
  `messages.length === 1` and the block bails, skipping `chat_history` **and**
  `_runOpener()`. Over a real record you then see the seed card but the opener
  turn (empty-`messages[]` `chat_turn` that surfaces "Immediate action vs Build
  playbook") never fires: `lastPayload` stays null, no `action_card`. At mount the
  *only* thing that can have populated `messages` is the seed card (history loads
  *inside* this block), so the count-based guard is wrong. Fix: gate on a real
  (non-seed) message instead — the seed push tags its message `_seeded: true`:
  `if ($scope.messages.some(m => !m._seeded)) return;`. A lone seed card now lets
  init proceed; `_seedFromEntity`'s own `messages.length`/`_seedInFlight` latch
  prevents a double card, and `_shouldRunOpener()` still gates the opener.
  Covered by `fortiaiAgenticAssistant.incident.spec.js` ("seeds the record summary, runs
  intel hops, …", `&opener=1`).

### 18.7 Driving a drawer widget live in Playwright on 8.0 (WAF box)

Two platform behaviors bite any live-UI Playwright drive against a FortiSOAR 8.0
box behind FortiGuard inline IPS (learned driving box 159; fixes in
`fortisoar-widget-harness/lib/{soarBrowser,liveUiDriver}.{ts,js}`):

- **Headless Chromium is fingerprinted and blocked at login.** The `/login` page
  loads, but its "Sign In" `button[type=submit]` **never leaves `disabled:true`**,
  so `page.click(submit)` times out. Running **headed** (`FSRPB_HEADED=1` →
  `headless:false`) the same button enables after fill and login succeeds. A
  desktop UA alone is enough for the *API* login (`soarClient.js` POST
  `/auth/authenticate` works in node; plain `curl` gets 405 on UA) but **not** for
  the browser UI login. 8.0's button label is **"Sign In"** (not "Login").
- **8.0 renders multiple drawer icons; open yours by title.** The right-edge
  drawer toggles are `img.logo-sm[title="…"]` — a record shows the native "AI
  Assistant", "Playbook Developer Assistant", and your widget's title all at once.
  A blind `.sub-block` click-loop opens the wrong drawer and the composer never
  mounts. Target `img.logo-sm[title="<widget title>"]` first, fall back to the
  loop.

---
