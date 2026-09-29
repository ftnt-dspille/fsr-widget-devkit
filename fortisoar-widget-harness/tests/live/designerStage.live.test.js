"use strict";
// LIVE proof that an edit lands IN THE OPEN DESIGNER without a page reload.
//
// WHY THIS EXISTS. Every other staging test runs against a hand-built designer
// stand-in, and that is how two defects shipped: a staged `playbookOrigin: null`
// blanked the real canvas (the stand-in had no such key), and the header button
// PUT the playbook behind the canvas, so the analyst saw nothing until a reload
// and their next Save overwrote the edit. Neither is visible without the real
// designer. `enhancementOffer.live` stops at the card on purpose (Apply was a
// write); staging is not a write, so this spec clicks it.
//
// WHAT IT DOES -- deterministic, no LLM in the loop:
//   1. push a scratch playbook (Start -> Note A) into its own collection;
//   2. open it in the real designer, open the widget;
//   3. put the edited YAML (Start -> Note A -> Note B) where the agent's YAML
//      goes (`currentYaml`) -- the YAML pane is read-only, the agent is the only
//      writer, and this stands in for it;
//   4. click the header button, which must read "Apply to designer";
//   5. assert the canvas now holds Start -> Note A -> Note B with no reload,
//      Save is armed, no page error fired, and the SERVER copy still has two
//      steps (staged, not written behind the designer).
// Every run writes captures/designerStage.capture.json -- the payloads behind
// the widget's jest contract test (tests/designerStage.contract.test.js).
//
// Run: make test-designer-stage-live   (box env: LIVE_ENV=.env.<box>)

const fs = require("fs");
const path = require("path");
const { openWidgetDrawer } = require("../../lib/liveUiDriver");
const { makeClient } = require("./lib/soarClient");

const LIVE = process.env.E2E_LIVE === "1";
const d = LIVE ? describe : describe.skip;
const CAPTURE = path.join(__dirname, "captures", "designerStage.capture.json");

const COLLECTION = "zz Widget E2E Scratch";
const yamlFor = (extra) => `collection: ${COLLECTION}
playbooks:
  - name: Stage Target
    steps:
      - {name: Start, type: start, module: alerts, next: Note A}
      - {name: Note A, type: set_variable, vars: {a: "1"}${extra ? ", next: Note B" : ""}}
${extra ? '      - {name: Note B, type: set_variable, vars: {b: "2"}}\n' : ""}`;

if (!LIVE) {
  console.warn("[designerStage.live] SKIPPED -- set E2E_LIVE=1 and a box env "
    + "(make test-designer-stage-live). Staging into the real designer is UNVERIFIED in this run.");
}

// In-page helpers. The designer's `csDesignerDetail` directive has an isolated
// scope holding the entity the canvas draws (KB §18.9).
function designerState() {
  const el = document.querySelector("[data-cs-designer-detail]");
  const dd = el && window.angular.element(el).isolateScope();
  if (!dd || !dd.entity || !dd.entity.steps) return null;
  const steps = Object.values(dd.entity.steps).map((s) => s.name);
  const routes = (dd.entity.routes || []).map((r) =>
    `${r.sourceStep && r.sourceStep.name}->${r.targetStep && r.targetStep.name}`);
  return { steps, routes, origin: typeof dd.entity.playbookOrigin,
           originNull: dd.entity.playbookOrigin === null,
           dirty: !!(dd.details && dd.details.$dirty) };
}

d("live: an edit is staged into the open designer, visible without a reload", () => {
  jest.setTimeout(300000);
  let soar, session, wfUuid, collUuid;
  const pageErrors = [];

  beforeAll(async () => {
    soar = await makeClient();
    const compiled = await soar.exec("compile_yaml", { yaml: yamlFor(false) });
    if (!compiled || !compiled.ok) throw new Error("scratch compile failed: " + JSON.stringify(compiled).slice(0, 300));
    // overwrite (default) purges the previous run's copy, recycle bin included.
    const pushed = await soar.exec("push_playbook", { workflow_json: compiled.workflow_json }, { timeoutMs: 115000 });
    if (!pushed || !pushed.ok) throw new Error("scratch push failed: " + JSON.stringify(pushed).slice(0, 300));
    wfUuid = pushed.workflow_uuids[0];
    collUuid = pushed.collection_uuid;
  });

  afterAll(async () => {
    if (session) await session.close();
    if (soar && collUuid) await soar.del(`/api/3/workflow_collections/${collUuid}`).catch(() => {});
  });

  test("Apply to designer puts the change on the canvas, unsaved, and writes nothing", async () => {
    session = await openWidgetDrawer({ mountPath: `/playbooks/${wfUuid}` });
    const page = session.page;
    page.on("pageerror", (e) => pageErrors.push(e.message));

    await page.waitForFunction(() => {
      const el = document.querySelector("[data-cs-designer-detail]");
      const dd = el && window.angular.element(el).isolateScope();
      return !!(dd && dd.entity && dd.entity.steps && Object.keys(dd.entity.steps).length === 2);
    }, null, { timeout: 60000 });
    const before = await page.evaluate(designerState);
    expect(before.routes).toEqual(["Start->Note A"]);
    const beforeEntity = await page.evaluate(() => {
      const dd = window.angular.element(document.querySelector("[data-cs-designer-detail]")).isolateScope();
      window.__stageBefore = window.angular.copy(dd.entity);
      return true;
    });
    expect(beforeEntity).toBe(true);

    // Stand in for the agent: the edited YAML goes where its YAML goes.
    const set = await page.evaluate((yaml) => {
      for (const el of document.querySelectorAll(".ng-scope")) {
        const s = window.angular.element(el).scope();
        if (s && typeof s.pushPlaybook === "function" && typeof s.hasOpenPlaybook === "function") {
          s.$apply(() => { s.currentYaml = yaml; });
          return { open: s.hasOpenPlaybook(), state: s.viewState };
        }
      }
      return null;
    }, yamlFor(true));
    expect(set).toEqual({ open: true, state: "idle" });

    const button = page.locator('[data-testid="topbar-create"]:visible, [data-testid="yaml-push"]:visible').first();
    await expect(button.textContent()).resolves.toMatch(/Apply to designer/);
    await button.click();

    // No reload anywhere below: the canvas has to change in place.
    await page.waitForFunction(() => {
      const el = document.querySelector("[data-cs-designer-detail]");
      const dd = el && window.angular.element(el).isolateScope();
      return !!(dd && dd.entity && dd.entity.steps && Object.keys(dd.entity.steps).length === 3);
    }, null, { timeout: 90000 });
    const after = await page.evaluate(designerState);
    expect(after.steps.sort()).toEqual(["Note A", "Note B", "Start"]);
    expect(after.routes).toEqual(["Start->Note A", "Note A->Note B"]);
    expect(after.originNull).toBe(false);
    expect(after.origin).toBe("object");
    expect(after.dirty).toBe(true);                       // the analyst's Save is armed
    await page.locator("text=The change is in the designer").first()
      .waitFor({ state: "visible", timeout: 15000 });
    expect(pageErrors).toEqual([]);

    // Staged, not written: the server copy is untouched until the analyst saves.
    const server = await soar.get(`/api/3/workflows/${wfUuid}?$relationships=true`);
    expect((server.steps || []).map((s) => s.name).sort()).toEqual(["Note A", "Start"]);

    // Refresh the payloads behind the jest contract test.
    const capture = await page.evaluate(() => {
      const dd = window.angular.element(document.querySelector("[data-cs-designer-detail]")).isolateScope();
      const drop = ["createUser", "modifyUser", "owners", "versions"];
      const scrub = (o) => JSON.parse(JSON.stringify(o, (k, v) => (drop.includes(k) ? undefined : v)));
      const flat = (e) => {
        const c = scrub(Object.assign({}, e, { steps: undefined, routes: undefined }));
        c.steps = Object.fromEntries(Object.entries(e.steps).map(([k, s]) => [k, scrub(s)]));
        c.routes = e.routes.map((r) => Object.assign(
          scrub(Object.assign({}, r, { sourceStep: undefined, targetStep: undefined })),
          { sourceStep: { $ref: r.sourceStep && r.sourceStep["@id"] },
            targetStep: { $ref: r.targetStep && r.targetStep["@id"] } }));
        return c;
      };
      let ws = null;
      for (const el of document.querySelectorAll(".ng-scope")) {
        const s = window.angular.element(el).scope();
        if (s && s._lastPushResult) { ws = s; break; }
      }
      return { before: flat(window.__stageBefore), staged: scrub(ws._lastPushResult.workflow),
               after: flat(dd.entity) };
    });
    fs.mkdirSync(path.dirname(CAPTURE), { recursive: true });
    fs.writeFileSync(CAPTURE, JSON.stringify(capture, null, 1));
  });
});
