'use strict';
// End-to-end test -- boots the widget in the harness (headless Chromium) and
// exercises the real DOM. The complement to the jest unit test. Run with:
//
//   make test-e2e-spec WIDGET=fortiedrCommandTimeline   # from the dev-kit root

const { test, expect } = require('@playwright/test');
const { waitForRender } = require('./_render');

const HARNESS = `http://localhost:${Number(process.env.E2E_BASE_PORT) || 14401}`;

// Resolve the mounted widget id (name-version) so the spec survives version
// bumps instead of hard-coding fortiedrCommandTimeline-1.0.0.
async function resolveId(request) {
  const resp = await request.get(`${HARNESS}/_fsr/widgets`);
  const data = await resp.json();
  const w = (data.widgets || []).find((x) => x.name === 'fortiedrCommandTimeline');
  if (!w) throw new Error('fortiedrCommandTimeline not discovered by the harness');
  return w.id;
}

test.describe('fortiedrCommandTimeline', () => {
  let id;
  test.beforeAll(async ({ request }) => { id = await resolveId(request); });

  test('renders the chronological command timeline from the record fixture', async ({ page }) => {
    await page.addInitScript((widgetId) => {
      localStorage.setItem('harness.widget', widgetId);
      localStorage.setItem('harness.ctx', 'viewpanel');
      // NS1 fixture layer serves widgetAssets/fixtures/api3/record.json (an
      // alert whose sourcedata carries a command_timeline) for this module/id.
      localStorage.setItem('harness.module', 'alerts');
      localStorage.setItem('harness.id', 'seed-1');
      localStorage.setItem('harness:config:' + widgetId, JSON.stringify({}));
    }, id);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    // waitForRender awaits the render state machine (NS-P0/P1) and THROWS on a
    // swallowed controller/digest error -- no magic timeouts, no silent pass.
    await waitForRender(page);

    await expect(page.getByTestId('fortiedr-command-timeline-root')).toBeVisible();
    await expect(page.getByTestId('fortiedr-command-timeline-ready')).toBeVisible();
    await expect(page.getByTestId('fortiedr-command-timeline-record-name'))
      .toContainText('bash - Malicious Application');

    // Three stages, oldest first (two parent-creation stages share a stamp;
    // the tie keeps the console's own order).
    const stages = page.getByTestId('fortiedr-command-timeline-stage');
    await expect(stages).toHaveCount(3);
    await expect(stages.first()).toContainText('PARENT PROCESS CREATION');

    // The command lines render verbatim.
    await expect(page.getByTestId('fortiedr-command-timeline-command').first())
      .toContainText('bash /tmp/edr_lab.sh all');
  });

  test('shows the enable-the-flag hint when the record has no timeline', async ({ page }) => {
    // The record fixture is widget-keyed, so a second scenario stubs the
    // record fetch in the browser: a bare alert whose sourcedata predates
    // the timeline flag (or a pre-1.1.12 row) renders the empty state.
    await page.route('**/api/3/alerts/no-timeline-seed*', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        '@id': '/api/3/alerts/no-timeline-seed',
        '@type': 'Alert',
        uuid: 'no-timeline-seed',
        name: 'old alert without a timeline',
        sourcedata: JSON.stringify({
          name: 'old alert without a timeline',
          external_id: '111',
          card: { description: '<table>rich-text card</table>' },
        }),
      }),
    }));
    await page.addInitScript((widgetId) => {
      localStorage.setItem('harness.widget', widgetId);
      localStorage.setItem('harness.ctx', 'viewpanel');
      localStorage.setItem('harness.module', 'alerts');
      localStorage.setItem('harness.id', 'no-timeline-seed');
      localStorage.setItem('harness:config:' + widgetId, JSON.stringify({}));
    }, id);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await waitForRender(page);

    await expect(page.getByTestId('fortiedr-command-timeline-empty')).toBeVisible();
    await expect(page.getByTestId('fortiedr-command-timeline-empty'))
      .toContainText('Include Command Timeline');
  });
});
