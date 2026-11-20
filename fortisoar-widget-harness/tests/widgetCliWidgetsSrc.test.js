"use strict";
// The widget CLI finds widgets through WIDGETS_SRC. It used to read only the
// harness/widgets-src symlink that `make setup` makes in the main checkout, so
// `make widget-push` from a worktree died with "widget not found" at deploy.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

test("info finds the widget under WIDGETS_SRC", () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), "wcli-"));
  try {
    const w = path.join(T, "zzProbeWidget", "widget");
    fs.mkdirSync(w, { recursive: true });
    fs.writeFileSync(path.join(w, "info.json"), JSON.stringify({ name: "zzProbeWidget", title: "Probe", version: "9.8.7" }));
    const r = spawnSync("node", [path.join(__dirname, "..", "scripts", "widget.js"), "info", "zzProbeWidget"],
      { env: { ...process.env, WIDGETS_SRC: T, HARNESS_URL: "http://127.0.0.1:9" }, encoding: "utf8" });
    const out = `${r.stdout}${r.stderr}`;
    // Found locally; it then stops at the (deliberately absent) server.
    expect(out).not.toMatch(/widget not found/);
    expect(out).toMatch(/harness not reachable/);
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});
