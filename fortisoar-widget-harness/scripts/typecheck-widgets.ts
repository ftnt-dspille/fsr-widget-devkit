/* typecheck-widgets.ts — Phase 3 CLI: type-check real widget controllers against
   the SOAR platform types. Strict + blocking: exits non-zero if any widget has a
   SOAR-contract type error (misused service, null-where-string, wrong arity).

   Usage:
     pnpm typecheck:widgets            # all widgets under widgets-src/
     pnpm typecheck:widgets <name>     # one widget (folder name)
   Runs in ship-verify's lint step and on demand. The jest fixtures in
   tests/widgetTypecheck.test.js prove the checker itself works; this points it at
   live widget source. See TYPESCRIPT_STATIC_ANALYSIS_PLAN.md Phase 3. */

import fs = require("fs");
import path = require("path");
import TC = require("../lib/widgetTypecheck");

const CONTROLLERS = ["view.controller.js", "edit.controller.js"];

function widgetRoots(): string[] {
  const roots: string[] = [];
  if (process.env.WIDGETS_SRC) roots.push(path.resolve(process.env.WIDGETS_SRC));
  for (const d of [path.resolve(__dirname, "..", "..", "widgets-src"), path.resolve(__dirname, "..", "widgets-src")]) {
    if (fs.existsSync(d)) roots.push(d);
  }
  return Array.from(new Set(roots));
}

function listWidgets(filter?: string): Array<{ name: string; dir: string }> {
  const out: Array<{ name: string; dir: string }> = [];
  const seen = new Set<string>();
  for (const root of widgetRoots()) {
    let folders: string[];
    try { folders = fs.readdirSync(root); } catch { continue; }
    for (const folder of folders) {
      if (filter && folder !== filter) continue;
      const dir = path.join(root, folder, "widget");
      if (seen.has(folder) || !fs.existsSync(path.join(dir, "info.json"))) continue;
      seen.add(folder);
      out.push({ name: folder, dir });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function main(): void {
  const filter = process.argv[2];
  const widgets = listWidgets(filter);
  if (widgets.length === 0) {
    console.error(filter ? `no widget named '${filter}' found` : "no widgets found under widgets-src/");
    process.exit(2);
  }
  const map = TC.buildServiceTypeMap();
  let totalErrors = 0;
  let checked = 0;

  for (const w of widgets) {
    for (const file of CONTROLLERS) {
      const p = path.join(w.dir, file);
      if (!fs.existsSync(p)) continue;
      checked++;
      let diags;
      try {
        diags = TC.typecheckWidget({ source: fs.readFileSync(p, "utf8"), fileName: `${w.name}/${file}`, serviceTypeMap: map });
      } catch (e) {
        console.error(`✗ ${w.name}/${file}: type-check crashed: ${(e as Error).message}`);
        totalErrors++;
        continue;
      }
      if (diags.length) {
        totalErrors += diags.length;
        console.log(`\n✗ ${w.name}/${file}`);
        for (const d of diags) console.log(`    L${d.line} [TS${d.code}] ${d.message}`);
      }
    }
  }

  console.log(`\n${"─".repeat(50)}`);
  if (totalErrors === 0) {
    console.log(`✓ ${checked} controllers across ${widgets.length} widget(s) — no SOAR-contract type errors`);
    process.exit(0);
  }
  console.log(`✗ ${totalErrors} SOAR-contract type error(s) across ${widgets.length} widget(s)`);
  process.exit(1);
}

main();
