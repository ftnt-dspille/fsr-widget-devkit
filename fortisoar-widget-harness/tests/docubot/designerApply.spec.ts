// LIVE regression: Apply to designer -> designer Save -> Apply again, on a real box,
// with no model in the loop. Driven by docubot (the fsr-ui kit), run through
// `make test-designer-apply-live BOX=<name>`.
//
// WHY. Every staging test before this one stopped at the first Apply. The bug it
// guards shipped exactly in the sequence nobody drove: after the analyst clicked
// the designer's Save, the next "Apply change" was refused with "Save or discard
// your changes" on a clean canvas. The designer's Save marks its form pristine
// but keeps its undo history (previousChanges), and the widget read that history
// as unsaved edits.
//
// WHAT IT DOES (deterministic):
//   1. push a scratch playbook (Start -> Note A) into its own run-tagged collection;
//   2. open it in the real designer and open the assistant;
//   3. stand in for the agent: put Start -> A -> B where its YAML goes, click
//      "Apply to designer"; the canvas shows B, Save is armed, nothing is written;
//   4. click the designer's Save; the server now has B;
//   5. stand in for the agent again: an enhancement offer adding C, whose accepted
//      result the connector would stage (built by the widget's own staging call;
//      only the chat_resume reply is served, since no real offer exists);
//      "Apply change" must NOT be refused, the canvas shows C, nothing is written;
//   6. Save again; the server has C.
// Scratch objects are tagged with the run id and deleted (and verified gone) in
// teardown; a crashed run's leftovers go in the next run's sweep.
//
// Box credentials come from the env the Make target sources (.env.<box>), never
// from this file.
import * as fs from 'fs';
import * as path from 'path';
import { expect, test, ScratchRun, runTag } from 'docubot';
import {
  acceptEnhancementOffer, applyState, applyToDesigner, designerEntity, fsrScratchHandlers, getWorkflow,
  injectEnhancementOffer, launchSession, pushScratchPlaybook, routeOfferAcceptToStage, saveArmed,
  minimizeAgentic, savePlaybook, stageAgentYaml, stagedWorkflowFor, waitCanvasSteps, openAssistant,
} from 'docubot/products/fortisoar';
import type { DesignerEntity } from 'docubot/products/fortisoar';

const CAPTURE = path.join(__dirname, '..', 'live', 'captures', 'designerStage.capture.json');

const tag = runTag();
const COLLECTION = `zz Widget E2E Scratch ${tag}`;
const PLAYBOOK = `Stage Target ${tag}`;
const NOTES = ['Note A', 'Note B', 'Note C'] as const;

/** The playbook as the agent would write it, with the first `n` notes chained after Start. */
function yamlWith(n: number): string {
  const notes = NOTES.slice(0, n);
  const lines = notes.map((name, i) => {
    const next = i + 1 < notes.length ? `, next: ${notes[i + 1]}` : '';
    return `      - {name: ${name}, type: set_variable, vars: {v${i}: "${i}"}${next}}`;
  });
  return `collection: ${COLLECTION}\nplaybooks:\n  - name: ${PLAYBOOK}\n    steps:\n`
    + `      - {name: Start, type: start, module: alerts, next: ${notes[0]}}\n${lines.join('\n')}\n`;
}
const routesFor = (n: number): string[] => ['Start', ...NOTES.slice(0, n)].slice(1).map((t, i, a) => `${i === 0 ? 'Start' : a[i - 1]}->${t}`);
const stepsFor = (n: number): string[] => ['Start', ...NOTES.slice(0, n)];

test.describe.configure({ mode: 'serial' });

test('Apply to designer, Save, Apply again: never blocked by a saved canvas, and each Save writes', async () => {
  test.setTimeout(600_000);
  const s = await launchSession({});
  const { page } = s;
  const scratch = new ScratchRun(fsrScratchHandlers(page, []));
  try {
    await scratch.sweep();
    const pushed = await pushScratchPlaybook(page, {
      collection: COLLECTION, name: PLAYBOOK,
      steps: [{ name: 'Note A', vars: { v0: '0' } }], scratch,
    });
    const wfUuid = pushed.workflow.uuid;

    // --- open the designer + the assistant ---------------------------------
    await page.goto(`${s.base}/playbooks/${wfUuid}`, { waitUntil: 'domcontentloaded' });
    const before = await waitCanvasSteps(page, stepsFor(1));
    expect(before.routes).toEqual(routesFor(1));
    await page.evaluate(`(function(){ var dd = window.angular.element(document.querySelector('[data-cs-designer-detail]')).isolateScope(); window.__stageBefore = window.angular.copy(dd.entity); return true; })()`);
    await openAssistant(page, 'agentic');
    await expect.poll(async () => stageAgentYaml(page, ''), { timeout: 60_000 }).toEqual({ open: true, state: 'idle' });

    // --- Apply #1 (header button): B lands on the canvas, unsaved ----------
    // Page errors count from here: the app's own boot (RequireJS "anonymous
    // define") is not what this test grades.
    const errorsBefore = s.errors.pageErrors.length;
    expect(await stageAgentYaml(page, yamlWith(2))).toEqual({ open: true, state: 'idle' });
    expect(await applyState(page)).toBe('enabled');
    await applyToDesigner(page);
    let canvas: DesignerEntity = await waitCanvasSteps(page, stepsFor(2));
    expect(canvas.routes).toEqual(routesFor(2));
    expect(canvas.originNull).toBe(false);
    expect(canvas.dirty).toBe(true);
    expect(await saveArmed(page)).toBe(true);
    expect((await getWorkflow(page, wfUuid)).steps.sort()).toEqual(stepsFor(1).sort());   // staged, not written
    writeCapture(await page.evaluate(CAPTURE_SCRIPT));

    // --- the analyst saves in the designer: B is written --------------------
    await minimizeAgentic(page);
    expect(await savePlaybook(page)).toBe(true);
    await expect.poll(async () => (await getWorkflow(page, wfUuid)).steps.sort(), { timeout: 60_000 }).toEqual(stepsFor(2).sort());
    canvas = (await designerEntity(page)) as DesignerEntity;
    expect(canvas.dirty).toBe(false);
    expect(canvas.changes).toBeGreaterThan(0);   // the undo history the old check misread

    // --- Apply #2 (an accepted offer) over the SAVED canvas: must not be refused
    const yamlC = yamlWith(3);
    const staged = await stagedWorkflowFor(page, yamlC, pushed.workflow.iri);
    const offerId = `docubot-${tag}`;
    const sent = await routeOfferAcceptToStage(page, { offerId, workflow: staged, yaml: yamlC });
    await openAssistant(page, 'agentic').catch(() => undefined);
    await injectEnhancementOffer(page, { offerId, summary: 'Add Note C after Note B', finalYaml: yamlC });
    const outcome = await acceptEnhancementOffer(page, offerId);
    expect(outcome.blocked, 'Apply was refused over a canvas the analyst had just saved').toBeNull();
    await expect.poll(() => sent.length, { timeout: 30_000 }).toBe(1);
    expect(sent[0]).toMatchObject({ offer_id: offerId, decision: 'accept', apply_to: 'canvas', workflow_iri: pushed.workflow.iri });
    canvas = await waitCanvasSteps(page, stepsFor(3));
    expect(canvas.routes).toEqual(routesFor(3));
    expect(canvas.originNull).toBe(false);
    expect(await saveArmed(page)).toBe(true);
    expect((await getWorkflow(page, wfUuid)).steps.sort()).toEqual(stepsFor(2).sort());   // staged, not written

    // --- Save again: C is written ------------------------------------------
    await minimizeAgentic(page);
    expect(await savePlaybook(page)).toBe(true);
    await expect.poll(async () => (await getWorkflow(page, wfUuid)).steps.sort(), { timeout: 60_000 }).toEqual(stepsFor(3).sort());
    expect((await getWorkflow(page, wfUuid)).routes.sort()).toEqual(routesFor(3).sort());

    expect(s.errors.pageErrors.slice(errorsBefore)).toEqual([]);
  } finally {
    try {
      await scratch.teardown();
    } finally {
      await s.close().catch(() => undefined);
    }
  }
});

// The payloads behind the widget's jest contract test (tests/designerStage.contract.test.js).
// Gitignored: a raw capture carries box uuids.
const CAPTURE_SCRIPT = `(function(){
  var dd = window.angular.element(document.querySelector('[data-cs-designer-detail]')).isolateScope();
  var drop = ['createUser', 'modifyUser', 'owners', 'versions'];
  var scrub = function(o){ return JSON.parse(JSON.stringify(o, function(k, v){ return drop.indexOf(k) >= 0 ? undefined : v; })); };
  var flat = function(e){
    var c = scrub(Object.assign({}, e, { steps: undefined, routes: undefined }));
    c.steps = {};
    Object.keys(e.steps).forEach(function(k){ c.steps[k] = scrub(e.steps[k]); });
    c.routes = e.routes.map(function(r){
      return Object.assign(scrub(Object.assign({}, r, { sourceStep: undefined, targetStep: undefined })),
        { sourceStep: { $ref: r.sourceStep && r.sourceStep['@id'] }, targetStep: { $ref: r.targetStep && r.targetStep['@id'] } });
    });
    return c;
  };
  var ws = null, els = document.querySelectorAll('.ng-scope');
  for (var i = 0; i < els.length; i++) { var sc = window.angular.element(els[i]).scope(); if (sc && sc._lastPushResult) { ws = sc; break; } }
  return { before: flat(window.__stageBefore), staged: ws ? scrub(ws._lastPushResult.workflow) : null, after: flat(dd.entity) };
})()`;

function writeCapture(capture: unknown): void {
  fs.mkdirSync(path.dirname(CAPTURE), { recursive: true });
  fs.writeFileSync(CAPTURE, JSON.stringify(capture, null, 1));
}
