'use strict';
// End-to-end test -- boots the widget in the harness (headless Chromium) and
// exercises the real DOM. The complement to the jest unit test. Run with:
//
//   make test-e2e-widget WIDGET=ztpGroupTimer   # from the dev-kit root

const { test, expect } = require('@playwright/test');
const { waitForRender } = require('./_render');

const HARNESS = `http://localhost:${Number(process.env.E2E_BASE_PORT) || 14401}`;

// Resolve the mounted widget id (name-version) so the spec survives version
// bumps instead of hard-coding ztpGroupTimer-1.0.0.
async function resolveId(request) {
  const resp = await request.get(`${HARNESS}/_fsr/widgets`);
  const data = await resp.json();
  const w = (data.widgets || []).find((x) => x.name === 'ztpGroupTimer');
  if (!w) throw new Error('ztpGroupTimer not discovered by the harness');
  return w.id;
}

test.describe('ztpGroupTimer', () => {
  let id;
  test.beforeAll(async ({ request }) => { id = await resolveId(request); });

  test('renders without errors and is non-empty', async ({ page }) => {
    await page.addInitScript((widgetId) => {
      localStorage.setItem('harness.widget', widgetId);
      localStorage.setItem('harness.ctx', 'viewpanel');
      // NS1 default fixture layer serves /api/3/<module>/<id> hermetically -- no
      // per-spec record stub needed. Seed the module/id the fixture is keyed to.
      localStorage.setItem('harness.module', 'alerts');
      localStorage.setItem('harness.id', 'seed-1');
      localStorage.setItem('harness:config:' + widgetId, JSON.stringify({}));
    }, id);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    // waitForRender awaits the render state machine (NS-P0/P1) and THROWS on a
    // swallowed controller/digest error -- no magic timeouts, no silent pass.
    await waitForRender(page);

    // The default fixture serves a believable record, so the record branch
    // renders without any hand-written platform stub (the NS1/NS2 guarantee).
    await expect(page.getByTestId('ztp-group-timer-root')).toBeVisible();
  });
});
