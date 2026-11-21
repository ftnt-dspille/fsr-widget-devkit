"use strict";
// A monorepo worktree holds only the tracked _template widget. It must still
// fall back to the main checkout's widgets-src: _template once counted as
// "this checkout has widgets", so live sanity from a worktree read no widgets
// and failed widget_versions on every run.
const fs = require("fs");
const path = require("path");
const { spawnSync, execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");

test("make resolves WIDGETS_SRC past a _template-only widgets-src", () => {
  const env = { ...process.env };
  delete env.WIDGETS_SRC; delete env.MAKEFLAGS; delete env.MAKELEVEL;
  // macOS ships make 3.81 (no --eval): a second makefile prints the variable.
  const extra = path.join(require("os").tmpdir(), `wsrc-${process.pid}.mk`);
  fs.writeFileSync(extra, "zz-print-wsrc:\n\t@echo WSRC=$(WIDGETS_SRC)\n");
  const r = spawnSync("make", ["-s", "-C", ROOT, "-f", "Makefile", "-f", extra, "zz-print-wsrc"],
    { env, encoding: "utf8" });
  fs.rmSync(extra, { force: true });
  const m = `${r.stdout}`.match(/WSRC=(\S+)/);
  expect(m).toBeTruthy();
  const got = m[1];
  expect(path.isAbsolute(got)).toBe(true);
  const real = fs.readdirSync(path.join(ROOT, "widgets-src")).filter((n) => !n.startsWith("_") && !n.startsWith("."))
    .some((n) => fs.existsSync(path.join(ROOT, "widgets-src", n, "widget", "info.json")));
  // The main checkout of ROOT (ROOT itself in CI, where it is no worktree).
  const common = execFileSync("git", ["-C", ROOT, "rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8" }).trim();
  const main = path.dirname(common);
  expect(got).toBe(real ? path.join(ROOT, "widgets-src") : path.join(main, "widgets-src"));
});

test("live-sanity.sh ignores _template when choosing widgets-src", () => {
  const src = fs.readFileSync(path.join(ROOT, "scripts", "live-sanity.sh"), "utf8");
  expect(src).toMatch(/compgen -G "\$1\/\[!_\]\*\/widget\/info\.json"/);
});
