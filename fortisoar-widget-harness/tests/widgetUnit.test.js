"use strict";
// scripts/widget_unit.sh: the widget jest run of widget-push, ship-verify and the version bump goes through the Linux
// container by default; the host is a loud fallback only when no engine answers. A red container run never falls back.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
let T;
beforeEach(() => {
  T = fs.mkdtempSync(path.join(os.tmpdir(), "widget-unit-"));
  // a fake make that logs its target, and fails the container target when asked
  fs.writeFileSync(path.join(T, "fakemake"), `#!/bin/sh
echo "$*" >> "${T}/calls"
case "$*" in *test-docker*) [ -z "$FAKE_RED" ] || exit 2 ;; esac
exit 0
`, { mode: 0o755 });
});
afterEach(() => fs.rmSync(T, { recursive: true, force: true }));
const run = (env = {}) => spawnSync("bash", [path.join(ROOT, "scripts", "widget_unit.sh"), "/ws", "agenticAssistantMonitor"],
  { env: { ...process.env, MAKE: path.join(T, "fakemake"), FSR_TOOL_HOME: ROOT, DOCKER_START: "none", ...env }, encoding: "utf8" });
const calls = () => (fs.existsSync(path.join(T, "calls")) ? fs.readFileSync(path.join(T, "calls"), "utf8") : "");

test("an engine is up: the widget's unit run is the container target, never the host one", () => {
  const r = run({ DOOR_ENGINE: "up" });
  expect(r.status).toBe(0);
  expect(calls()).toMatch(/test-docker WIDGET=agenticAssistantMonitor WIDGETS_SRC=\/ws/);
  expect(calls()).not.toMatch(/test-unit/);
});

test("no engine: the host runs it and says so loudly", () => {
  const r = run({ DOOR_ENGINE: "down" });
  expect(r.status).toBe(0);
  expect(calls()).toMatch(/test-unit WIDGET=agenticAssistantMonitor/);
  expect(r.stderr).toMatch(/WARNING no container engine.*HOST/);
});

test("DOOR_DOCKER=0 is the explicit host opt-out", () => {
  expect(run({ DOOR_ENGINE: "up", DOOR_DOCKER: "0" }).status).toBe(0);
  expect(calls()).toMatch(/test-unit/);
  expect(calls()).not.toMatch(/test-docker/);
});

test("a red container run is red: no silent host rerun that could hide it", () => {
  const r = run({ DOOR_ENGINE: "up", FAKE_RED: "1" });
  expect(r.status).not.toBe(0);
  expect(calls()).not.toMatch(/test-unit/);
});

test("the ship paths call it: widget-push and ship-verify no longer run jest on the host", () => {
  const mk = fs.readFileSync(path.join(ROOT, "Makefile"), "utf8");
  expect(mk).toMatch(/unit-pass-cache\.sh \$\(WIDGETS_SRC\) \$\(WIDGET\) -- \$\(RFM\) widget_unit\.sh/);
  expect(mk).toMatch(/\$\(RFM\) widget_unit\.sh \$\(WIDGETS_SRC\) \$\(WIDGET\)\n\t@echo "▶ 3\/6/);
  expect(mk).not.toMatch(/--no-print-directory test-unit WIDGET=\$\(WIDGET\)/);
});
