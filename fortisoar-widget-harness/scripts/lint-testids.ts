#!/usr/bin/env node
'use strict';
// Fails if any element in widgets-src/**/*.html has ng-click / ng-submit
// without a data-testid (or ng-attr-data-testid) on the same element.
//
// Pass one or more widget names to scope the scan, e.g.
//   node scripts/lint-testids.js fortiaiAgenticAssistant socAssistantMonitor
// otherwise every widget under widgets-src/ is scanned.
// An empty set (no widget dir, a missing scope name, or zero .html files) exits
// 1: a lint that scans nothing must never print "ok".

import fs = require('fs');
import path = require('path');

interface Violation {
  file: string;
  line: number;
  tag: string;
}

// Honour WIDGETS_SRC (the same override lint-angular and the Makefile pass) so
// the linter can be pointed at a fixture tree; falls back to the sibling
// widgets-src checkout.
const ROOT = process.env.WIDGETS_SRC
  ? path.resolve(process.env.WIDGETS_SRC)
  : path.resolve(__dirname, '..', '..', 'widgets-src');
const scopes = process.argv.slice(2);

function fail(msg: string): never {
  console.error('lint-testids: ' + msg);
  process.exit(1);
}

function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch (e) {
    return false;
  }
}

function walk(dir: string, out: string[]): string[] {
  if (!fs.existsSync(dir)) return out;
  let st: fs.Stats;
  try {
    st = fs.statSync(dir);
  } catch (e) {
    return out;
  }
  if (!st.isDirectory()) return out;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    let cst: fs.Stats;
    try {
      cst = fs.statSync(p);
    } catch (e) {
      continue;
    }
    if (cst.isDirectory()) {
      walk(p, out);
    } else if (p.endsWith('.html')) {
      out.push(p);
    }
  }
  return out;
}

let roots: string[];
if (scopes.length) {
  roots = scopes.map((s) => path.join(ROOT, s));
  const missing = scopes.filter((s) => !isDir(path.join(ROOT, s)));
  if (missing.length) fail('no widget dir under ' + ROOT + ' for: ' + missing.join(', '));
} else {
  roots = fs.existsSync(ROOT)
    ? fs.readdirSync(ROOT).map((d) => path.join(ROOT, d)).filter(isDir)
    : [];
  if (roots.length === 0) fail('no widgets found under ' + ROOT + ' (is widgets-src checked out? run make setup)');
}
const files = roots.flatMap((r) => walk(r, []));
if (files.length === 0) fail('0 .html files under ' + roots.join(', ') + '; refusing to report ok on an empty set');

const TAG_RE = /<([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)>/g;
const violations: Violation[] = [];

for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  let m: RegExpExecArray | null;
  while ((m = TAG_RE.exec(text)) !== null) {
    const attrs = m[2];
    const hasHandler = /\bng-(click|submit)\s*=/.test(attrs);
    if (!hasHandler) continue;
    const hasTestId = /\b(data-testid|ng-attr-data-testid)\s*=/.test(attrs);
    if (hasTestId) continue;
    const line = text.slice(0, m.index).split('\n').length;
    violations.push({ file: path.relative(process.cwd(), file), line, tag: m[1] });
  }
}

if (violations.length) {
  console.error('lint-testids: elements with ng-click/ng-submit missing data-testid:');
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  <${v.tag}>`);
  }
  process.exit(1);
}

console.log(`lint-testids: ok (${files.length} html files scanned across ${roots.length} widget(s))`);
