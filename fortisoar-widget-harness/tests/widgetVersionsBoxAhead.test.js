"use strict";
// widget_versions live-sanity check: a box AHEAD of the tree (a prior per-change
// or stable deploy bumped the box past main) is tolerated, so a tooling stamp is
// not blocked by version drift it does not ship. A box BEHIND or MISSING the
// wanted version is still a real stale-deploy FAIL. Mirrors the connector version
// check's box-ahead tolerance in doctor.py.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { REGISTRY } = require("../scripts/live-sanity/checks.js");

const check = REGISTRY.find((c) => c.name === "widget_versions");

let tmp;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wvba-")); });
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

// Lay down widgets-src/<w>/widget/info.json at the version the tree "wants".
function widgetsSrc(want) {
  const d = path.join(tmp, "agenticAssistant", "widget");
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, "info.json"), JSON.stringify({ version: want }));
  return tmp;
}

// ctx whose box reports agenticAssistant at boxVersion.
function ctx(want, boxVersion) {
  return {
    widgets: ["agenticAssistant"],
    widgetsSrc: widgetsSrc(want),
    soar: { get: async () => ({ "hydra:member": [{ name: "agenticAssistant", version: boxVersion }] }) },
  };
}

test("box AHEAD of the tree is tolerated (PASS, noted), not a failure", async () => {
  const r = await check.run(ctx("1.4.9", "1.4.10"));
  expect(r.status).toBe("PASS");
  expect(r.detail).toMatch(/box ahead/);
  expect(r.detail).toMatch(/1\.4\.10 ahead of tree 1\.4\.9/);
});

test("box BEHIND the tree is still a FAIL (stale deploy)", async () => {
  const r = await check.run(ctx("1.4.9", "1.4.8"));
  expect(r.status).toBe("FAIL");
  expect(r.detail).toMatch(/box has 1\.4\.8, expected 1\.4\.9/);
});

test("box MISSING the widget is still a FAIL", async () => {
  const c = ctx("1.4.9", "1.4.9");
  c.soar.get = async () => ({ "hydra:member": [] });
  const r = await check.run(c);
  expect(r.status).toBe("FAIL");
  expect(r.detail).toMatch(/box has none, expected 1\.4\.9/);
});

test("box EQUAL to the tree passes clean (no box-ahead note)", async () => {
  const r = await check.run(ctx("1.4.9", "1.4.9"));
  expect(r.status).toBe("PASS");
  expect(r.detail).not.toMatch(/box ahead/);
});

test("the ahead compare is numeric, not lexical (1.4.10 > 1.4.9)", async () => {
  // Lexical string compare would rank "1.4.10" < "1.4.9" and mis-FAIL this.
  const r = await check.run(ctx("1.4.9", "1.4.10"));
  expect(r.status).toBe("PASS");
});
