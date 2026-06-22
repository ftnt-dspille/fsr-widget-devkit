#!/usr/bin/env node
// Extract every template from templates.min.*.js into ./templates-extracted/<original path>

import fs = require('fs');
import path = require('path');
import vm = require('vm');

const SRC = process.argv[2] || 'templates.min.a64ddbd8.js';
const OUT = process.argv[3] || 'templates-extracted';

const src = fs.readFileSync(SRC, 'utf8');

// Stub just enough of Angular for the file to run.
const templates: Record<string, string> = {};
const $templateCache = { put: (k: string, v: string) => (templates[k] = v) };
const angular: Record<string, unknown> = {
  module: () => angular,
  run: (arr: unknown[]) => {
    const fn = arr[arr.length - 1];
    if (typeof fn === 'function') {
      fn($templateCache);
    }
    return angular;
  },
};

vm.runInNewContext(src, { angular });

const keys = Object.keys(templates);
console.log(`Parsed ${keys.length} templates from ${SRC}`);

for (const k of keys) {
  const dest = path.join(OUT, k);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, templates[k]);
}
console.log(`Wrote → ${OUT}/`);
