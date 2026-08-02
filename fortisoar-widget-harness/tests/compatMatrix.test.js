"use strict";
// Guard for ONBOARDING.md's "Compatibility matrix". The table drifted until it
// was wrong on EVERY row (tracker #8) because nothing read it back. This asserts
// the columns this repo can actually see: each widget's `info.json` version, and
// the contract version baked into fortiaiAgenticAssistant's controller.
//
// The connector / fsr-playbooks columns live in a different checkout, so they
// are deliberately NOT checked here -- a test that resolves a path outside this
// repo would either be machine-specific or silently skip. They stay hand-stamped
// (see the note under the table).

const fs = require("fs");
const path = require("path");

const REPO = path.resolve(__dirname, "..", "..");
const ONBOARDING = path.join(REPO, "ONBOARDING.md");
const WIDGETS_SRC = process.env.WIDGETS_SRC
  ? path.resolve(process.env.WIDGETS_SRC)
  : path.join(REPO, "widgets-src");

// Parse the matrix rows: | `dirName` (…) | version | connector | contract | notes |
function parseMatrix(md) {
  const lines = md.split("\n");
  const start = lines.findIndex((l) => /^\|\s*Widget\s*\|/.test(l));
  if (start === -1) throw new Error("ONBOARDING.md: no compatibility-matrix header row");
  const rows = [];
  for (let i = start + 2; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith("|")) break;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    const m = cells[0].match(/`([^`]+)`/);
    if (!m) continue;
    rows.push({ dir: m[1], version: cells[1], connector: cells[2], contract: cells[3] });
  }
  return rows;
}

function infoJson(dir) {
  const hits = [
    path.join(WIDGETS_SRC, dir, "widget", "info.json"),
    path.join(WIDGETS_SRC, dir, "info.json"),
  ].filter((p) => fs.existsSync(p));
  return hits.length ? JSON.parse(fs.readFileSync(hits[0], "utf8")) : null;
}

const rows = parseMatrix(fs.readFileSync(ONBOARDING, "utf8"));

describe("ONBOARDING.md compatibility matrix", () => {
  test("the table is non-empty and lists the assistant surfaces", () => {
    expect(rows.length).toBeGreaterThan(0);
    const dirs = rows.map((r) => r.dir);
    expect(dirs).toContain("fortiaiAgenticAssistant");
    expect(dirs).toContain("socAssistantMonitor");
  });

  test("every row names a widget directory that exists", () => {
    const missing = rows.filter((r) => !infoJson(r.dir)).map((r) => r.dir);
    // A widget cloned-out of this checkout has no info.json -- only fail on rows
    // whose directory is present but unreadable, not on an un-cloned sibling.
    const present = missing.filter((d) => fs.existsSync(path.join(WIDGETS_SRC, d)));
    expect(present).toEqual([]);
  });

  test("each row's version matches that widget's info.json", () => {
    const drift = [];
    for (const r of rows) {
      const info = infoJson(r.dir);
      if (!info) continue; // not cloned in this checkout
      if (r.version !== info.version) {
        drift.push(`${r.dir}: table says ${r.version}, info.json says ${info.version}`);
      }
    }
    expect(drift).toEqual([]);
  });

  test("the contract column matches WIDGET_CONTRACT_VERSION in the controller", () => {
    const ctrl = path.join(WIDGETS_SRC, "fortiaiAgenticAssistant", "widget", "view.controller.js");
    if (!fs.existsSync(ctrl)) return; // not cloned here
    const m = fs.readFileSync(ctrl, "utf8").match(/WIDGET_CONTRACT_VERSION\s*=\s*['"]([^'"]+)['"]/);
    expect(m).toBeTruthy();
    const row = rows.find((r) => r.dir === "fortiaiAgenticAssistant");
    expect(row.contract).toBe(m[1]);
  });

  test("no row still cites a retired name", () => {
    // fsrSocAssistant -> fortiaiAgenticAssistant; fsr_core -> fsr_playbooks;
    // fortinet-fsr-playbook-builder -> connector-fsr-soc-assistant.
    const table = rows.map((r) => Object.values(r).join(" ")).join("\n");
    for (const dead of ["fsrSocAssistant", "fsr_core", "fortinet-fsr-playbook-builder"]) {
      expect(table).not.toContain(dead);
    }
  });
});
