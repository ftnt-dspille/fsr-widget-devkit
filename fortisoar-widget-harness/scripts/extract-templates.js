#!/usr/bin/env node
"use strict";
// Extract every template from templates.min.*.js into ./templates-extracted/<original path>
Object.defineProperty(exports, "__esModule", { value: true });
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const SRC = process.argv[2] || 'templates.min.a64ddbd8.js';
const OUT = process.argv[3] || 'templates-extracted';
const src = fs.readFileSync(SRC, 'utf8');
// Stub just enough of Angular for the file to run.
const templates = {};
const $templateCache = { put: (k, v) => (templates[k] = v) };
const angular = {
    module: () => angular,
    run: (arr) => {
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
