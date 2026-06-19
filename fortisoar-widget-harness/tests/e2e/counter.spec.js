'use strict';
// End-to-end test — boots the widget in the harness (headless Chromium) and
// exercises the real DOM. The complement to the jest unit test. Run with:
//
//   make test-e2e-widget WIDGET=counter   # from the dev-kit root

const { test, expect } = require('./_isolated');

// Resolve the mounted widget id (name-version) so the spec survives version
// bumps instead of hard-coding counter-1.0.0. Relative path follows the
// request fixture's per-worker baseURL (_isolated.js).
async function resolveId(request) {
  const resp = await request.get(`/_fsr/widgets`);
  const data = await resp.json();
  const w = (data.widgets || []).find((x) => x.name === 'counter');
  if (!w) throw new Error('counter not discovered by the harness');
  return w.id;
}

test.describe('counter', () => {
  let id;
  test.beforeAll(async ({ request }) => { id = await resolveId(request); });

  async function mount(page, config) {
    await page.addInitScript((args) => {
      localStorage.setItem('harness.widget', args.id);
      localStorage.setItem('harness.ctx', 'dashboard');
      localStorage.setItem('harness:config:' + args.id, JSON.stringify(args.config));
    }, { id, config });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
  }

  test('renders the configured title and start value', async ({ page }) => {
    await mount(page, { title: 'Hits', start: 5 });
    await expect(page.getByTestId('counter-title')).toHaveText('Hits');
    await expect(page.getByTestId('counter-value')).toHaveText('5');
  });

  test('increments, decrements and resets', async ({ page }) => {
    await mount(page, { title: 'Counter', start: 0, step: 2 });
    await expect(page.getByTestId('counter-value')).toHaveText('0');
    await page.getByTestId('counter-increment').click();
    await page.getByTestId('counter-increment').click();
    await expect(page.getByTestId('counter-value')).toHaveText('4');
    await page.getByTestId('counter-decrement').click();
    await expect(page.getByTestId('counter-value')).toHaveText('2');
    await page.getByTestId('counter-reset').click();
    await expect(page.getByTestId('counter-value')).toHaveText('0');
  });

  test('disables buttons at min/max bounds', async ({ page }) => {
    await mount(page, { start: 0, step: 1, min: 0, max: 1 });
    await expect(page.getByTestId('counter-decrement')).toBeDisabled();
    await page.getByTestId('counter-increment').click();
    await expect(page.getByTestId('counter-value')).toHaveText('1');
    await expect(page.getByTestId('counter-increment')).toBeDisabled();
  });
});
