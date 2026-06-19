'use strict';
// Per-tool wall-time rendering (Phase 2). The multi_tool fixture's tool_result
// frames carry server-side `duration_ms` (1.2s / 47s / 3.4s). This spec drives
// the mocked chat turn end-to-end and asserts the DOM the jest layer can't:
//   - each completed tool chip shows its frozen duration label
//   - the assistant footer rolls up the total + flags the slowest tool
// (The live PENDING ticker is exercised by the controller jest tests; here the
//  mock turn resolves instantly so every tool lands already-completed.)

const { test, expect } = require('./_isolated');
const { resolveWidgetId, DEFAULT_ID } = require('./_widgetId');

let WIDGET_ID = DEFAULT_ID;
test.beforeAll(async ({ request }) => { WIDGET_ID = await resolveWidgetId(request); });

async function gotoMultiTool(page) {
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  await page.addInitScript((id) => {
    localStorage.setItem('harness:config:' + id, JSON.stringify({
      connectorName: 'fortinet-fsr-playbook-builder',
      defaultIntent: 'build', maxTurns: 10, showUsage: true
    }));
    localStorage.setItem('harness.widget', id);
    localStorage.setItem('harness.ctx', 'dashboard');
  }, WIDGET_ID);
  await page.goto(`/?widget=${WIDGET_ID}&context=Dashboard&mock=multi_tool`,
    { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => window.__fsrSocAssistant__ && typeof window.__fsrSocAssistant__.state === 'string',
    null, { timeout: 30000 });
  return errors;
}

test('completed tools show frozen durations + turn footer rolls up total & slowest', async ({ page }) => {
  const errors = await gotoMultiTool(page);

  await page.locator('[data-testid="chat-input"]').fill('Build me a ping playbook');
  await page.locator('[data-testid="chat-send"]').click();

  // Wait for the turn to settle (tool chips render their frozen labels).
  await page.waitForFunction(
    () => window.__fsrSocAssistant__ && window.__fsrSocAssistant__.state === 'idle',
    null, { timeout: 15000 });

  // At least one tool chip shows a duration label; the 47s tool must be present.
  const durations = page.locator('[data-testid^="tool-call-duration-"]');
  await expect(durations.first()).toBeVisible();
  await expect(page.locator('[data-testid^="tool-call-duration-"]')
    .filter({ hasText: '47s' }).first()).toBeVisible();

  // Turn-level footer: total time + slowest-tool callout naming get_op_schema.
  const timing = page.locator('[data-testid^="turn-timing-"]').last();
  await expect(timing).toBeVisible();
  await expect(timing).toContainText('in tools');
  await expect(timing.locator('[data-testid^="turn-slowest-"]')).toContainText('get_op_schema');

  expect(errors, 'no console errors: ' + errors.join(' | ')).toEqual([]);
});
