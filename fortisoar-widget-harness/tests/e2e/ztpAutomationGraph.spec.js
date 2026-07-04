'use strict';
// End-to-end test — boots the widget in the harness (headless Chromium) and
// exercises the real DOM. The complement to the jest unit test. Run with:
//
//   make test-e2e-widget WIDGET=ztpAutomationGraph   # from the dev-kit root
//
// The device record is served hermetically by the NS1 default fixture layer
// (widgetAssets/fixtures/api3/record.json). The canonical step-records
// COLLECTION (/api/3/ztpf_device_automation_steps?ztpfDevices=...) has no
// dedicated harness route, so this spec page.route-fulfills it from
// widgetAssets/fixtures/api3/ztpf_device_automation_steps.json (NS1 philosophy:
// stub only what's unique to the scenario). Cytoscape draws nodes to <canvas>,
// so node-level color/edge assertions live in the unit tests (ztpGraph.test.js);
// here we assert the widget mounts, renders the canvas, and shows the right
// mode/legend/badges with no controller error.

const path = require('path');
const fs = require('fs');
const { test, expect } = require('@playwright/test');
const { waitForRender } = require('./_render');

const HARNESS = 'http://localhost:14401';
const STEPS_FIXTURE = JSON.parse(fs.readFileSync(path.resolve(
  __dirname, '../../../widgets-src/ztpAutomationGraph/widget/widgetAssets/fixtures/api3/ztpf_device_automation_steps.json'
), 'utf8'));

async function resolveId(request) {
  const resp = await request.get(`${HARNESS}/_fsr/widgets`);
  const data = await resp.json();
  const w = (data.widgets || []).find((x) => x.name === 'ztpAutomationGraph');
  if (!w) throw new Error('ztpAutomationGraph not discovered by the harness');
  return w.id;
}

test.describe('ztpAutomationGraph', () => {
  let id;
  test.beforeAll(async ({ request }) => { id = await resolveId(request); });

  async function mount(page) {
    // Serve the canonical step-records collection from the fixture (the harness
    // has no route for filtered collection GETs; without this the request 599s
    // a HERMETIC-MISS and the run fails in globalTeardown).
    await page.route('**/api/3/ztpf_device_automation_steps**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(STEPS_FIXTURE) }));
    await page.addInitScript((widgetId) => {
      localStorage.setItem('harness.widget', widgetId);
      localStorage.setItem('harness.ctx', 'viewpanel');
      localStorage.setItem('harness.module', 'ztpf_devices');
      localStorage.setItem('harness.id', 'seed-ztp-device-1');
      localStorage.setItem('harness:config:' + widgetId, JSON.stringify({}));
    }, id);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await waitForRender(page);
  }

  test('mounts and renders the graph with no controller error', async ({ page }) => {
    await mount(page);
    await expect(page.getByTestId('ztp-automation-graph-root')).toBeVisible();
    // The running scenario fixture -> mode badge "running", device + run-group.
    await expect(page.getByTestId('ztp-ag-mode')).toHaveClass(/\bztp-ag__mode--running\b/);
    await expect(page.getByTestId('ztp-ag-device')).toBeVisible();
    await expect(page.getByTestId('ztp-ag-rungrp')).toHaveText('ztpf-9000000001');
  });

  test('renders the cytoscape canvas (graph is non-empty)', async ({ page }) => {
    await mount(page);
    // Cytoscape inits multiple <canvas> inside #ztp-cy; the first is the
    // renderer. A non-zero box means it drew.
    const canvas = page.locator('#ztp-cy canvas').first();
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    expect(box).toBeTruthy();
    expect(box.width).toBeGreaterThan(0);
    expect(box.height).toBeGreaterThan(0);
  });

  test('renders the status legend with all 5 queue statuses', async ({ page }) => {
    await mount(page);
    const legend = page.getByTestId('ztp-ag-legend');
    await expect(legend).toBeVisible();
    await expect(legend.locator('.ztp-ag__legend-item')).toHaveCount(5);
  });

  test('does not show the queued reorder hint in running mode', async ({ page }) => {
    await mount(page);
    await expect(page.getByTestId('ztp-ag-graph')).toBeVisible();
    expect(await page.locator('.ztp-ag__hint').count()).toBe(0);
  });
});
