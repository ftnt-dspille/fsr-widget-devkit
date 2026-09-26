// Test enhancement_offer deduplication: the card must render exactly once.
// Without the fix (enhancement_offer excluded from fallback ng-if), the card
// renders twice: once from the explicit handler + once from the fallback.
//   make test-e2e-spec SPEC="fortiaiAgenticAssistant.enhancementOfferDedup"

const { test, expect } = require("./_isolated");
const { resolveWidgetId, DEFAULT_ID } = require("./_widgetId");

let WIDGET_ID = DEFAULT_ID;
test.beforeAll(async ({ request }) => { WIDGET_ID = await resolveWidgetId(request); });

const CARD = '[data-testid="approval-card-ap-unrequested-1"]';
const OFFER = '[data-testid="enhancement-offer-enh-uc-1"]';

// Boot the widget with unrequested_change mock (contains enhancement_offer after approval)
async function boot(page) {
  await page.addInitScript((id) => {
    localStorage.setItem('harness:config:' + id, JSON.stringify({
      connectorName: 'fortinet-fsr-playbook-builder', maxTurns: 10
    }));
    localStorage.setItem('harness.widget', id);
    localStorage.setItem('harness.ctx', 'dashboard');
    localStorage.removeItem('fsrPbSession');
  }, WIDGET_ID);

  await page.goto(
    `/?widget=${WIDGET_ID}&context=Dashboard&mock=unrequested_change&fastmock=1&opener=1`,
    { waitUntil: 'domcontentloaded' });

  await page.waitForFunction(
    () => window.__fortiaiAgenticAssistant__ &&
          typeof window.__fortiaiAgenticAssistant__.state === 'string',
    null, { timeout: 30000 });

  await expect(page.locator('[data-testid="chat-input"]')).toBeEnabled({ timeout: 30000 });

  // Submit a message to trigger the turn
  await page.locator('[data-testid="chat-input"]').fill('Explique ce playbook.');
  await page.locator('[data-testid="chat-input"]').press('Enter');
  await page.locator(CARD).waitFor({ state: 'visible', timeout: 15000 });

  // Approve to get the enhancement_offer
  await page.locator('[data-testid="approval-approve"]').click();
  await page.locator(OFFER).waitFor({ state: 'visible', timeout: 15000 });
}

test.describe('enhancement_offer deduplication', () => {

  test('enhancement_offer card renders exactly once (not doubled by fallback)', async ({ page }) => {
    await boot(page);

    // The fix: enhancement_offer must appear exactly once
    // Without the fix (no enhancement_offer in fallback exclusion), this would be 2
    await expect(page.locator(OFFER)).toHaveCount(1);

    // Verify the card is actually visible and rendered
    await expect(page.locator(OFFER)).toBeVisible();
  });

  test('no fallback generic frame renders for enhancement_offer', async ({ page }) => {
    await boot(page);

    // Without the fix, the fallback ng-if would render a generic step-frame
    // with "enhancement_offer" as the type label in the step-head.
    // The fallback renders: <div class="step-frame"> <div class="step-head">
    // <span class="step-name">enhancement_offer</span>
    // This should NOT exist if the fix is in place.
    const fallbackFrames = await page.locator(
      '.step-frame:has(.step-name:has-text("enhancement_offer"))'
    ).count();

    // Should be 0 (the fix excludes enhancement_offer from fallback)
    // Without fix, it would be 1 (the generic fallback frame)
    expect(fallbackFrames).toBe(0);
  });
});
