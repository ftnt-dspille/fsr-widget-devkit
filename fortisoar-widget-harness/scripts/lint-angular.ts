#!/usr/bin/env node
'use strict';
// Catches the AngularJS + FortiSOAR widget footguns we keep hitting. Run
// scoped to one widget (recommended for CI) or across every widget.
//
//   node scripts/lint-angular.js fsrPlaybookBuilder      # one widget
//   node scripts/lint-angular.js                          # all widgets
//
// Rule sources:
//   - Direct experience building the FortiSOC Action Assistant widget
//   - ${HOME}/WebstormProjects/fsr_all_widgets/KNOWLEDGEBASE.md
//   - FortiSOAR-7.6.5-Widget_Development guide
//
// Severity: 'error' fails the script (exit 1). 'warning' is printed but exit 0.

import fs = require('fs');
import path = require('path');

interface Violation {
  sev: 'error' | 'warning';
  file: string;
  line: number;
  rule: string;
  msg: string;
}

const ROOT = path.resolve(__dirname, '..', '..', 'widgets-src');
const scope = process.argv[2] || null;

const violations: Violation[] = [];

function record(sev: 'error' | 'warning', file: string, line: number, rule: string, msg: string): void {
  violations.push({ sev, file, line, rule, msg });
}

function relPath(p: string): string {
  return path.relative(process.cwd(), p);
}

function readLines(file: string): string[] | null {
  try {
    return fs.readFileSync(file, 'utf8').split('\n');
  } catch (e) {
    return null;
  }
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

// ─── Rules ────────────────────────────────────────────────────────────────

// R1: ng-model="<bareword>"  → primitive on a possibly-child scope. The
// ng-include / ng-if / ng-repeat scope-shadowing trap. The single most common
// time-sink in this codebase.
function checkNgModelDotRule(file: string, lines: string[]): void {
  const re = /ng-model\s*=\s*"([^"]+)"/g;
  lines.forEach((line, i) => {
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      const expr = m[1].trim();
      // Allowed: any expression containing `.`, `[`, or `()`. Bare words
      // (identifiers) are the trap. Empty string skips.
      if (!expr) continue;
      if (/[.\[(]/.test(expr)) continue;
      // Numeric/string literals don't make sense here but technically
      // wouldn't be a scope-shadow issue either; skip.
      if (/^['"\d]/.test(expr)) continue;
      record('warning', file, i + 1, 'ng-model-dot-rule',
        'ng-model="' + expr + '" binds to a primitive. ng-include / ng-if / ng-repeat ' +
        'creates a child scope and writes shadow the parent. Wrap in an object, ' +
        'e.g. ng-model="form.' + expr + '" or ng-model="cfg.' + expr + '".');
    }
  });
}

// R2: $scope.config.X read in controller before defaults are applied. Causes
// "Cannot read properties of undefined" when widget mounts with no config.
function checkConfigDefaultsBeforeAccess(file: string, lines: string[]): void {
  // Find the first line that GUARDS config (`if (!$scope.config) $scope.config = {}`
  // or similar). Any read above that line is a risk.
  let guardLine = -1;
  const accessLines: number[] = [];
  lines.forEach((line, i) => {
    if (/if\s*\(\s*!?\s*\$scope\.config\s*[)|=]/.test(line)
      || /\$scope\.config\s*=\s*(\$scope\.config\s*\|\|\s*\{\}|\{\})/.test(line)
      || /\$scope\.config\s*\|\|\s*\(\s*\$scope\.config\s*=\s*\{\}/.test(line)
      // angular.extend({}, defaults, config || {}) is a valid defaults guard.
      || /\$scope\.config\s*=\s*angular\.extend\(/.test(line)) {
      if (guardLine === -1) guardLine = i;
    }
    if (/\$scope\.config\.\w+/.test(line) && !/^\s*(?:\/\/|\*)/.test(line)) {
      accessLines.push(i);
    }
  });
  if (guardLine === -1 && accessLines.length > 0) {
    record('warning', file, accessLines[0] + 1, 'config-defaults-missing',
      'controller reads $scope.config.X but never guards $scope.config = $scope.config || {}. ' +
      'Cold-mount in a drawer crashes here.');
  } else if (guardLine !== -1) {
    accessLines.forEach((i) => {
      if (i < guardLine) {
        record('warning', file, i + 1, 'config-access-before-defaults',
          'reads $scope.config before the defaults guard on line ' + (guardLine + 1) + '.');
      }
    });
  }
}

// R3: $uibModal used inside view.controller.js. Harness stubs $uibModal to a
// no-op factory; the modal silently never opens. Wasted ~30 min on this.
function checkUibModalInView(file: string, lines: string[]): void {
  lines.forEach((line, i) => {
    if (/\$uibModal\.open\s*\(/.test(line)) {
      record('warning', file, i + 1, 'uibModal-in-view-controller',
        '$uibModal.open in the view controller is stubbed to a no-op in the harness. ' +
        'For in-widget modals, render an overlay with ng-if instead.');
    }
  });
}

// R4: ng-controller="<name>" in a template where <name> is not the widget's
// own view controller. The harness only loads view.controller.js at boot; any
// other controller name fails [$controller:ctrlreg].
function checkNgControllerRegistered(file: string, lines: string[], widgetDir: string): void {
  const registeredControllers = _scanControllersInDir(widgetDir);
  const re = /ng-controller\s*=\s*"([\w]+)/g;
  lines.forEach((line, i) => {
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      const name = m[1];
      if (registeredControllers.indexOf(name) < 0) {
        record('error', file, i + 1, 'ng-controller-unregistered',
          'ng-controller="' + name + '" but no .controller("' + name + '") found in ' +
          'this widget. The harness only auto-loads view.controller.js; edit.controller.js ' +
          'only loads when the host opens Edit Config. Inline the logic into the view ' +
          'controller, or register the controller manually.');
      }
    }
  });
}

function _scanControllersInDir(dir: string): string[] {
  const out: string[] = [];
  function walk(d: string): void {
    if (!fs.existsSync(d)) return;
    let st: fs.Stats;
    try {
      st = fs.statSync(d);
    } catch (e) {
      return;
    }
    if (!st.isDirectory()) return;
    const names = fs.readdirSync(d);
    for (const n of names) {
      const p = path.join(d, n);
      let s: fs.Stats;
      try {
        s = fs.statSync(p);
      } catch (e) {
        continue;
      }
      if (s.isDirectory()) {
        walk(p);
      } else if (p.endsWith('.controller.js') || /\.service\.js$/.test(p) || /\.js$/.test(p)) {
        const src = fs.readFileSync(p, 'utf8');
        const re = /\.controller\s*\(\s*['"]([\w]+)['"]/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(src)) !== null) {
          out.push(m[1]);
        }
      }
    }
  }
  walk(dir);
  return out;
}

// R5: Missing $inject array. AngularJS minification breaks without it. Most
// other widgets in this codebase follow the convention rigorously.
function checkInjectArray(file: string, lines: string[]): void {
  const src = lines.join('\n');
  const hasController = /\.controller\s*\(\s*['"][\w]+['"]/.test(src);
  if (!hasController) return;
  if (!/\.\$inject\s*=\s*\[/.test(src) && !/\.factory\s*\(\s*['"][\w]+['"]\s*,\s*\[/.test(src)) {
    record('warning', file, 1, 'missing-inject',
      'controller/factory in this file has no $inject array. Minified builds will fail.');
  }
}

// R6: edit.controller.js missing $uibModalInstance + close/dismiss. Even
// though our overlay path doesn't need it, the same controller is opened as a
// modal by the SOAR shell — must wire both paths.
function checkEditModalContract(file: string, lines: string[]): void {
  if (!file.endsWith('edit.controller.js')) return;
  const src = lines.join('\n');
  if (!/\$uibModalInstance/.test(src)) {
    record('warning', file, 1, 'edit-modal-instance-missing',
      'edit.controller.js does not reference $uibModalInstance. When opened by SOAR shell ' +
      'as a $uibModal, save/cancel will not close the modal.');
  }
  if (!/save\s*=\s*function|\$scope\.save\s*=/.test(src)) {
    record('warning', file, 1, 'edit-save-missing',
      'edit.controller.js does not define a save() handler.');
  }
  if (!/cancel\s*=\s*function|\$scope\.cancel\s*=/.test(src)) {
    record('warning', file, 1, 'edit-cancel-missing',
      'edit.controller.js does not define a cancel() handler.');
  }
}

// R7: websocketService.subscribe without $destroy unsubscribe → leaks
// connection + handlers across widget re-mounts.
function checkWebsocketCleanup(file: string, lines: string[]): void {
  const src = lines.join('\n');
  if (!/websocketService\.subscribe/.test(src)) return;
  if (!/\$scope\.\$on\s*\(\s*['"]\$destroy['"]/.test(src)) {
    record('warning', file, 1, 'websocket-no-destroy-cleanup',
      'websocketService.subscribe() called but no $scope.$on("$destroy", ...) cleanup. ' +
      'KB §15: websocket subscriptions leak across re-mounts.');
  }
}

// R8: Raw `cs-*` directive without `data-` prefix. Breaks under strict HTML5.
function checkDataPrefixOnCsDirectives(file: string, lines: string[]): void {
  const re = /\s(cs-(?:field|conditional|grid|chart|messages|view-field|action-bar))=/g;
  lines.forEach((line, i) => {
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      // Allow if the leading char IS 'data-' — check the preceding bytes
      // before the matched space. The space-prefix in our regex already
      // excludes `data-cs-`. Confirm.
      const before = line.slice(0, m.index);
      if (/data-$/.test(before)) continue;
      record('warning', file, i + 1, 'cs-directive-needs-data-prefix',
        'use data-' + m[1] + '= instead of bare ' + m[1] + '=. KB §28.4.');
    }
  });
}

// R9: info.json sanity. subTitle capitalization, published_date numeric,
// version triple, drawer requires standalone:true.
function checkInfoJson(file: string, json: unknown): void {
  // Narrow to object for property access
  const obj = json && typeof json === 'object' ? json as Record<string, unknown> : {};
  if ('subtitle' in obj && !('subTitle' in obj)) {
    record('error', file, 1, 'subtitle-capitalization',
      '"subtitle" should be "subTitle" (capital T). KB §28.9.');
  }
  if ('version' in obj && !/^\d+\.\d+\.\d+$/.test(String(obj.version))) {
    record('warning', file, 1, 'version-not-semver',
      'version "' + obj.version + '" is not x.y.z. KB §3.0.');
  }
  if ('published_date' in obj) {
    const pd = obj.published_date;
    if (typeof pd === 'string' && /[-:T]/.test(pd)) {
      record('warning', file, 1, 'published-date-iso',
        'published_date "' + pd + '" looks like ISO8601. Should be a Unix-seconds integer. KB §28.8.');
    }
  }
  const meta = obj.metadata && typeof obj.metadata === 'object' ? obj.metadata as Record<string, unknown> : {};
  const contexts = Array.isArray(meta.contexts) ? meta.contexts : [];
  if (contexts.indexOf('drawer') >= 0 && meta.standalone !== true) {
    record('error', file, 1, 'drawer-needs-standalone',
      'metadata.contexts includes "drawer" but metadata.standalone is not true. KB §18.0.');
  }
  const metaView = meta.view && typeof meta.view === 'object' ? meta.view as Record<string, unknown> : null;
  if (metaView && metaView.views) {
    record('error', file, 1, 'view-views-typo',
      'metadata.view.views is not a real field. Did you mean metadata.view.enableFor? KB §18.1.');
  }
  // metadata.pages is required for dashboard / view-panel widgets but
  // legitimately empty for drawer widgets (their `enableFor` array drives
  // where the action button appears instead). Only flag empty pages when
  // the widget is NOT a drawer.
  const isDrawer = (Array.isArray(meta.contexts) ? meta.contexts : []).indexOf('drawer') >= 0;
  if (!isDrawer && (!Array.isArray(meta.pages) || meta.pages.length === 0)) {
    record('warning', file, 1, 'metadata-pages-empty',
      'metadata.pages is empty and this widget is not a drawer. SOAR may block install. ' +
      'Add the contexts the widget supports, e.g. ["Dashboard", "View Panel"].');
  }
}

// R10: connector call with explicit null configId (not from a real picker).
// Often masks a missing edit-config step.
function checkConnectorConfigId(file: string, lines: string[]): void {
  lines.forEach((line, i) => {
    // Match executeConnectorAction(name, version, action, null, ...)
    if (/executeConnectorAction\s*\([^)]*,\s*null\s*,/.test(line)) {
      record('warning', file, i + 1, 'connector-null-configid',
        'executeConnectorAction called with configId=null. The connector will run against ' +
        'an arbitrary fallback configuration. Pipe config.configId from edit.html. KB §28.20.');
    }
  });
}

// R11: Generic CSS class selector with no widget-root prefix. SOAR doesn't
// scope per-widget CSS — `.card { height: 70px }` from one widget leaks
// into every other widget that uses the same class. Caught us when
// `fortiguardIocSearch`'s `.card { width: 100px; height: 70px }` clamped
// our choice cards. Flag any rule in <style> blocks or asset CSS whose
// leftmost selector is a bare generic class.
function checkUnscopedGenericSelectors(file: string, lines: string[]): void {
  // Class names that have global meaning across SOAR / Bootstrap / other
  // widgets — restyling these without a widget-root prefix leaks out.
  const GENERIC = ['card', 'chip', 'step', 'role', 'message', 'messages',
    'content', 'title', 'subtitle', 'actions', 'body', 'header',
    'footer', 'panel', 'btn', 'button', 'modal', 'tag', 'badge',
    'icon', 'item', 'row', 'col', 'container', 'wrapper'];
  let inStyle = file.endsWith('.css');
  lines.forEach((line, i) => {
    if (file.endsWith('.html')) {
      if (/<style/i.test(line)) inStyle = true;
      if (/<\/style/i.test(line)) {
        inStyle = false;
        return;
      }
      if (!inStyle) return;
    }
    // Only the selector portion before `{`.
    const brace = line.indexOf('{');
    if (brace < 0) return;
    const sel = line.slice(0, brace);
    // Split on `,` for grouped selectors so we flag the offender exactly.
    sel.split(',').forEach((one) => {
      const trimmed = one.trim();
      if (!trimmed) return;
      // Leftmost token of the selector chain.
      const leftmost = trimmed.split(/\s+|>|~|\+/)[0];
      // Pattern: `.classname` or `.classname:pseudo`, no element prefix.
      const m = leftmost.match(/^\.([A-Za-z0-9_-]+)(?::[^.\s]*)?$/);
      if (!m) return;
      if (GENERIC.indexOf(m[1]) < 0) return;
      record('warning', file, i + 1, 'unscoped-generic-css',
        'CSS selector "' + trimmed + '" is a generic class with no widget-root prefix. ' +
        "SOAR doesn't scope widget CSS — this rule will leak into other widgets and theirs " +
        'into yours. Prefix with your widget root (e.g. ".fsr-pb-widget .' + m[1] + '").');
    });
  });
}

// R12: widget root must use viewport-based height AND composer must be
// sticky. `height: 100%` collapses in SOAR's drawer; raw `height: 100vh`
// overflows when there's chrome above the widget — the composer falls
// below the visible viewport. The proven pattern (fortisocchatagent):
// `height: calc(100vh - <px>)` on the root + `position: sticky; bottom:0`
// on the bottom input row.
function checkWidgetHeightStickyComposer(file: string, lines: string[]): void {
  if (!file.endsWith('view.html')) return;
  const src = lines.join('\n');
  const hasCalcVh = /height\s*:\s*calc\s*\(\s*100vh/.test(src);
  const hasBareVh = /height\s*:\s*100vh\s*;/.test(src);
  const hasBare100 = /height\s*:\s*100%\s*;/.test(src) && !/min-height|max-height/.test(src);
  if (hasBareVh && !hasCalcVh) {
    const ln = lines.findIndex((l) => /height\s*:\s*100vh\s*;/.test(l));
    record('warning', file, ln + 1, 'widget-root-height-100vh',
      '`height: 100vh` on the widget root overflows the visible area when the host has ' +
      'chrome above the widget (drawer drag bar, dashboard grid header). The composer ends ' +
      'up below the viewport bottom. Use `height: calc(100vh - 32px)` like fortisocchatagent ' +
      'and make the composer `position: sticky; bottom: 0`.');
  }
  if (hasBare100 && !hasCalcVh && !hasBareVh) {
    record('warning', file, 1, 'widget-root-height-100pct',
      '`height: 100%` on the widget root collapses to content-height in the SOAR drawer ' +
      "(parent doesn't propagate a height). Use `height: calc(100vh - 32px)` instead.");
  }
  // Composer-style class is by convention `.composer` or `chat-input-row`.
  // Find any rule that styles it and verify it includes sticky positioning.
  const composerBlock = src.match(/\.(?:composer|chat-input-row|input-row)\s*\{[^}]*\}/);
  if (composerBlock && !/position\s*:\s*sticky/.test(composerBlock[0])) {
    const ln2 = lines.findIndex((l) => /\.(?:composer|chat-input-row|input-row)\s*\{/.test(l));
    record('warning', file, ln2 + 1, 'composer-not-sticky',
      'composer/input row has no `position: sticky; bottom: 0`. Without it, the input falls ' +
      'below the viewport whenever the host adds chrome that pushes the widget past 100vh.');
  }
}

// ─── Driver ───────────────────────────────────────────────────────────────

function lintWidget(widgetDir: string): void {
  let widgetRoot = path.join(widgetDir, 'widget');
  if (!fs.existsSync(widgetRoot)) widgetRoot = widgetDir;

  const info = path.join(widgetRoot, 'info.json');
  if (fs.existsSync(info)) {
    const json = readJson(info);
    if (json) checkInfoJson(info, json);
  }

  const htmlFiles = ['view.html', 'edit.html'].map((n) => path.join(widgetRoot, n))
    .filter((p) => fs.existsSync(p));
  const ctlFiles = ['view.controller.js', 'edit.controller.js'].map((n) => path.join(widgetRoot, n))
    .filter((p) => fs.existsSync(p));
  const assetJs = _walkJs(path.join(widgetRoot, 'widgetAssets'));

  htmlFiles.forEach((f) => {
    const lines = readLines(f) || [];
    checkNgModelDotRule(f, lines);
    checkNgControllerRegistered(f, lines, widgetRoot);
    checkDataPrefixOnCsDirectives(f, lines);
    checkUnscopedGenericSelectors(f, lines);
    checkWidgetHeightStickyComposer(f, lines);
  });
  // Standalone widgetAssets/css/*.css files also need the unscoped-class check.
  const cssFiles = ((): string[] => {
    const dir = path.join(widgetRoot, 'widgetAssets', 'css');
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter((n) => n.endsWith('.css'))
      .map((n) => path.join(dir, n));
  })();
  cssFiles.forEach((f) => {
    const lines = readLines(f) || [];
    checkUnscopedGenericSelectors(f, lines);
  });
  ctlFiles.concat(assetJs).forEach((f) => {
    const lines = readLines(f) || [];
    checkInjectArray(f, lines);
    checkWebsocketCleanup(f, lines);
    checkConnectorConfigId(f, lines);
    if (f.endsWith('view.controller.js')) {
      checkConfigDefaultsBeforeAccess(f, lines);
      checkUibModalInView(f, lines);
    }
    if (f.endsWith('edit.controller.js')) {
      checkEditModalContract(f, lines);
    }
  });
}

function _walkJs(root: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(root)) return out;
  const stack: string[] = [root];
  while (stack.length) {
    const d = stack.pop()!;
    let st: fs.Stats;
    try {
      st = fs.statSync(d);
    } catch (e) {
      continue;
    }
    if (!st.isDirectory()) continue;
    const ns = fs.readdirSync(d);
    for (const n of ns) {
      const p = path.join(d, n);
      let s: fs.Stats;
      try {
        s = fs.statSync(p);
      } catch (e) {
        continue;
      }
      if (s.isDirectory()) {
        stack.push(p);
      } else if (p.endsWith('.js')) {
        out.push(p);
      }
    }
  }
  return out;
}

const widgetDirs = scope
  ? [path.join(ROOT, scope)]
  : (fs.existsSync(ROOT) ? fs.readdirSync(ROOT)
    .filter((n) => {
      const p = path.join(ROOT, n);
      try {
        return fs.statSync(p).isDirectory();
      } catch (e) {
        return false;
      }
    })
    .map((n) => path.join(ROOT, n)) : []);

widgetDirs.forEach(lintWidget);

if (violations.length === 0) {
  console.log('lint-angular: ok (' + widgetDirs.length + ' widget' + (widgetDirs.length === 1 ? '' : 's') + ' scanned)');
  process.exit(0);
}

const errors = violations.filter((v) => v.sev === 'error');
const warns = violations.filter((v) => v.sev === 'warning');

violations.forEach((v) => {
  console.log('[' + v.sev + '] ' + relPath(v.file) + ':' + v.line + '  ' + v.rule);
  console.log('         ' + v.msg);
});
console.log('\nlint-angular: ' + errors.length + ' error(s), ' + warns.length + ' warning(s).');
process.exit(errors.length > 0 ? 1 : 0);
