#!/usr/bin/env node
'use strict';

// Grade a downloaded widget `.events.json` chat export from the CLI.
//   node tests/live/scripts/gradeExport.js <path-to-export.events.json>
//   make grade-export EXPORT=~/Downloads/fsrpb-chat-...events.json
// Prints a JSON report and exits non-zero on a FAIL verdict, so it can gate.

const fs = require('fs');
const { gradeExport } = require('../lib/exportGrader');

const p = process.argv[2];
if (!p) {
  console.error('usage: node gradeExport.js <export.events.json>');
  process.exit(2);
}
let exp;
try {
  exp = JSON.parse(fs.readFileSync(p, 'utf8'));
} catch (e) {
  console.error('could not read/parse export: ' + e.message);
  process.exit(2);
}
const report = gradeExport(exp);
console.log(JSON.stringify(report, null, 2));
if (report.redFlags.length) {
  console.error('\n' + report.verdict + ' — ' + report.redFlags.length + ' red flag(s):');
  report.redFlags.forEach((f) => console.error('  • [' + f.code + '] ' + f.detail));
}
process.exit(String(report.verdict).indexOf('FAIL') === 0 ? 1 : 0);
