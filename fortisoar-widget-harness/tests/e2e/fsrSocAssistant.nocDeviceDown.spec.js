'use strict';
// NOC device-down hunt (Phase C). Drives the noc_device_down fixture end to end
// and asserts the DOM the jest render layer can't: the FortiManager + FortiAnalyzer
// tool chips render as completed, and the diagnosis info_card shows the WAN1
// outage timeline. Read-only scenario → no action card.

const { test, expect } = require('./_isolated');
const { resolveWidgetId, DEFAULT_ID } = require('./_widgetId');

let WIDGET_ID = DEFAULT_ID;
test.beforeAll(async ({ request }) => { WIDGET_ID = await resolveWidgetId(request); });

async function gotoNoc(page) {
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  await page.addInitScript((id) => {
    localStorage.setItem('harness:config:' + id, JSON.stringify({
      connectorName: 'fortinet-fsr-playbook-builder',
      defaultIntent: 'triage', maxTurns: 10, showUsage: true
    }));
    localStorage.setItem('harness.widget', id);
    localStorage.setItem('harness.ctx', 'dashboard');
  }, WIDGET_ID);
  await page.goto(`/?widget=${WIDGET_ID}&context=Dashboard&mock=noc_device_down`,
    { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => window.__fsrSocAssistant__ && typeof window.__fsrSocAssistant__.state === 'string',
    null, { timeout: 30000 });
  return errors;
}

test('FMG + FAZ tool chips render and the device-down diagnosis card shows the WAN1 timeline', async ({ page }) => {
  const errors = await gotoNoc(page);

  await page.locator('[data-testid="chat-input"]').fill('FGT-BRANCH-04 stopped reporting — what happened?');
  await page.locator('[data-testid="chat-send"]').click();

  await page.waitForFunction(
    () => window.__fsrSocAssistant__ && window.__fsrSocAssistant__.state === 'idle',
    null, { timeout: 15000 });

  // The NOC toolset surfaced as completed tool chips.
  const chips = page.locator('[data-testid^="tool-call-status-"]');
  await expect(chips.first()).toBeVisible();
  for (const name of ['fmg_get_device_status', 'fmg_get_ha_status',
                      'faz_search_device_events', 'fmg_get_policy_package_status']) {
    await expect(page.getByText(name, { exact: false }).first()).toBeVisible();
  }

  // The diagnosis info_card with the upstream-WAN1 root cause + timeline.
  const card = page.locator('[data-testid="info-card-noc-findings-fgt-branch-04"]');
  await expect(card).toBeVisible();
  await expect(card).toContainText('WAN1');
  await expect(card).toContainText('Upstream WAN1 circuit / power');

  // Read-only scenario: no action card was staged.
  await expect(page.locator('[data-testid^="action-card-"]')).toHaveCount(0);

  expect(errors, 'no console errors: ' + errors.join(' | ')).toEqual([]);
});
