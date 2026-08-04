#!/usr/bin/env node
"use strict";
// Sync the ONBOARDING.md compatibility-matrix widget version column from
// each widget's info.json. Run after `ship.sh --bump` so the table can't
// drift from info.json (tracker #85).
//
// Usage: node scripts/sync-compat-matrix.js
//   --connector 0.5.98   (optional: also stamp the connector column)
//   --framework 0.6.16   (optional: also stamp the framework pin)

const fs = require("fs");
const path = require("path");

const REPO = path.resolve(__dirname, "..");
const ONBOARDING = path.join(REPO, "ONBOARDING.md");
const WIDGETS_SRC = path.join(REPO, "widgets-src");

function infoVersion(dir) {
  const hits = [
    path.join(WIDGETS_SRC, dir, "widget", "info.json"),
    path.join(WIDGETS_SRC, dir, "info.json"),
  ].filter((p) => fs.existsSync(p));
  return hits.length ? JSON.parse(fs.readFileSync(hits[0], "utf8")).version : null;
}

const args = process.argv.slice(2);
const connectorVer = (args.indexOf("--connector") !== -1)
  ? args[args.indexOf("--connector") + 1] : null;
const frameworkVer = (args.indexOf("--framework") !== -1)
  ? args[args.indexOf("--framework") + 1] : null;

let md = fs.readFileSync(ONBOARDING, "utf8");
const lines = md.split("\n");

// Find the table header
const start = lines.findIndex((l) => /^\|\s*Widget\s*\|/.test(l));
if (start === -1) { console.error("no compatibility-matrix header"); process.exit(1); }

// Update each data row
for (let i = start + 2; i < lines.length; i++) {
  if (!lines[i].startsWith("|")) break;
  const cells = lines[i].split("|").slice(1, -1).map((c) => c.trim());
  const m = cells[0].match(/`([^`]+)`/);
  if (!m) continue;
  const dir = m[1];
  const ver = infoVersion(dir);
  if (ver && cells[1] !== ver) {
    cells[1] = ver;
    console.log(`  ${dir}: ${cells[1]} -> ${ver}`);
  }
  if (connectorVer && cells[2].includes("connector-fsr-soc-assistant")) {
    cells[2] = `\`connector-fsr-soc-assistant\` ${connectorVer}`;
  }
  lines[i] = "| " + cells.join(" | ") + " |";
}

// Update the framework pin line
if (frameworkVer) {
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes("currently `") && lines[i].includes("fsr-playbooks")) {
      lines[i] = lines[i].replace(/currently `[^`]+`/, `currently \`${frameworkVer}\``);
      break;
    }
  }
}

fs.writeFileSync(ONBOARDING, lines.join("\n"));
console.log("ONBOARDING.md compat matrix synced.");
