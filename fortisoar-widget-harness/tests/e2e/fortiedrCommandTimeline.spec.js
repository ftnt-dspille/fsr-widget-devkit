'use strict';
// End-to-end test -- boots the widget in the harness (headless Chromium) and
// exercises the real DOM. The complement to the jest unit test. Run with:
//
//   make test-e2e-spec WIDGET=fortiedrCommandTimeline   # from the dev-kit root
//
// The alert record is served hermetically by the NS1 default fixture layer
// (widgetAssets/fixtures/api3/record.json -- the live-proven 9-stage bash
// chain). Cytoscape draws nodes to <canvas>, so node-level shape assertions
// live in the unit tests (timelineGraph.test.js); here we assert the widget
// mounts the canvas, derives the 9-node spawn graph, and that tapping a node
// opens its stage detail card.

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

  async function mount(page, config) {
    await page.addInitScript((args) => {
      localStorage.setItem('harness.widget', args.widgetId);
      localStorage.setItem('harness.ctx', 'viewpanel');
      // NS1 fixture layer serves widgetAssets/fixtures/api3/record.json (an
      // alert whose sourcedata carries a command_timeline) for this module/id.
      localStorage.setItem('harness.module', 'alerts');
      localStorage.setItem('harness.id', 'seed-1');
      localStorage.setItem('harness:config:' + args.widgetId, JSON.stringify(args.config || {}));
    }, { widgetId: id, config: Object.assign({ defaultView: 'graph' }, config || {}) });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    // waitForRender awaits the render state machine (NS-P0/P1) and THROWS on a
    // swallowed controller/digest error -- no magic timeouts, no silent pass.
    await waitForRender(page);
    // The graph mounts on a deferred $timeout after the ready state paints.
    if ((config || {}).defaultView !== 'story') {
      await page.waitForFunction(() => window.__fctlCy && window.__fctlCy.nodes().length > 0);
    }
  }

  test('renders the spawn graph from the record fixture', async ({ page }) => {
    await mount(page);

    await expect(page.getByTestId('fortiedr-command-timeline-root')).toBeVisible();
    await expect(page.getByTestId('fortiedr-command-timeline-ready')).toBeVisible();
    // Host, destination and times live on the alert card, not repeated here.
    await expect(page.getByTestId('fortiedr-command-timeline-event'))
      .toContainText('Ubuntu 24.04.4 LTS');

    // The canvas drew (non-zero box) inside the bounded viewport.
    const canvas = page.locator('#fctl-cy canvas').first();
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    expect(box).toBeTruthy();
    expect(box.width).toBeGreaterThan(0);
    expect(box.height).toBeGreaterThan(0);

    // The derived graph opens with the early ancestry folded into one node:
    // fold + bash, timeout, reverse-shell bash + internet host.
    const snap = () => page.evaluate(() => {
      const cy = window.__fctlCy;
      return {
        nodes: cy.nodes().map((n) => n.data('label')),
        edges: cy.edges().map((e) => [e.data('source'), e.data('target'), !!e.data('net')]),
        netNode: (cy.nodes().filter((n) => n.data('net'))[0] || { data: () => ({}) }).data(),
        netEdges: cy.edges().filter((e) => e.data('net')).length,
      };
    });
    let graph = await snap();
    expect(graph.nodes).toHaveLength(5);
    expect(graph.nodes[0]).toMatch(/^6 earlier processes/);
    expect(graph.edges).toHaveLength(4);
    expect(graph.netEdges).toBe(1);                            // the dashed net edge
    expect(graph.netNode.label).toContain('1.1.1.1');
    expect(graph.netNode.label).toContain('AS 13335 CLOUDFLARENET');
    if (process.env.SHOTS_GRAPH) await page.getByTestId('fortiedr-command-timeline-graph').screenshot({ path: process.env.SHOTS_GRAPH + '-folded.png' });
    // No command text on the canvas: the story and the detail carry it.
    expect(graph.nodes.some((l) => l.includes('/dev/tcp'))).toBe(false);

    // Unfolded: the full chain, 9 process cards + the internet host.
    await page.getByTestId('fortiedr-command-timeline-graph-fold').click();
    await page.waitForFunction(() => window.__fctlCy && window.__fctlCy.nodes().length === 10);
    graph = await snap();
    if (process.env.SHOTS_GRAPH) await page.getByTestId('fortiedr-command-timeline-graph').screenshot({ path: process.env.SHOTS_GRAPH + '-full.png' });
    expect(graph.edges).toHaveLength(9);
    expect(graph.nodes.filter((l) => l.startsWith('sshd')).length).toBe(3);
    expect(graph.nodes.some((l) => l.startsWith('systemd'))).toBe(true);
    // Process cards carry their PID; the internet card carries the API's triple.
    expect(graph.nodes.filter((l) => !l.startsWith('Internet host'))
      .every((l) => /\nPID \d+/.test(l))).toBe(true);

    // Legend + interaction hint.
    await expect(page.getByTestId('fortiedr-command-timeline-legend')).toBeVisible();
    // No detail card until a node is tapped.
    await expect(page.getByTestId('fortiedr-command-timeline-detail')).toHaveCount(0);
  });

  test('tapping a node opens its stage detail card', async ({ page }) => {
    await mount(page);

    // Cytoscape renders nodes to <canvas>, so there's no DOM node to click.
    // Drive the controller's tap handler through the live cy instance (the
    // controller exposes it as window.__fctlCy) by emitting a 'tap' on the
    // reverse-shell node -- exactly what a real click dispatches.
    await page.evaluate(() => {
      const cy = window.__fctlCy;
      cy.nodes().filter((n) => n.data('pid') === '5346').emit('tap');
    });

    const detail = page.getByTestId('fortiedr-command-timeline-detail');
    await expect(detail).toBeVisible();
    await expect(page.getByTestId('fortiedr-command-timeline-detail-name'))
      .toContainText('bash');
    // The tapped process's own stage renders with its command line...
    await expect(page.getByTestId('fortiedr-command-timeline-stage')).toHaveCount(1);
    await expect(page.getByTestId('fortiedr-command-timeline-command').first())
      .toContainText('/dev/tcp/1.1.1.1/443');
    // ...its kind chip, and a real timestamp (this chain's stamps are epoch-ms).
    await expect(detail).toContainText('CONNECTION STACK');

    // The close button clears the card.
    await page.getByTestId('fortiedr-command-timeline-detail-close').click();
    await expect(page.getByTestId('fortiedr-command-timeline-detail')).toHaveCount(0);

    // The internet host card: the network facts, then the command that
    // reached out (its stages ARE the connection stages).
    await page.evaluate(() => {
      window.__fctlCy.nodes().filter((n) => n.data('net')).emit('tap');
    });
    await expect(page.getByTestId('fortiedr-command-timeline-net-facts'))
      .toContainText('IP 1.1.1.1');
    await expect(page.getByTestId('fortiedr-command-timeline-net-facts'))
      .toContainText('AS 13335 CLOUDFLARENET');
    await expect(page.getByTestId('fortiedr-command-timeline-command').first())
      .toContainText('/dev/tcp/1.1.1.1/443');

    // A background tap clears a re-opened card too.
    await page.evaluate(() => window.__fctlCy.emit('tap'));
    await expect(page.getByTestId('fortiedr-command-timeline-detail')).toHaveCount(0);
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

  test('story view: narrative, folded lead-in, highlighted command, inline detail', async ({ page }) => {
    await mount(page, { defaultView: 'story' });
    const story = page.getByTestId('fortiedr-command-timeline-story');
    await expect(story).toBeVisible();
    await expect(page.getByTestId('fortiedr-command-timeline-narrative'))
      .toContainText('started a chain of 9 processes');
    // The header repeats nothing the alert card already shows.
    const head = page.getByTestId('fortiedr-command-timeline-event');
    await expect(head).not.toContainText('lab-endpoint-01');
    await expect(head).toContainText('9 processes');
    // 8 plain-ancestry steps lead the chain: 6 fold, so 4 cards remain.
    await expect(page.getByTestId('fortiedr-command-timeline-lead')).toBeVisible();
    await expect(page.getByTestId('fortiedr-command-timeline-step')).toHaveCount(4);
    // The fold says in plain words what it hides and offers one labelled button.
    await expect(page.getByTestId('fortiedr-command-timeline-lead-text'))
      .toContainText('Showing the last 4 of 10 steps');
    await expect(page.getByTestId('fortiedr-command-timeline-lead').locator('button'))
      .toHaveText(/Show the earlier 6/);
    await page.getByTestId('fortiedr-command-timeline-lead').locator('button').click();
    await expect(page.getByTestId('fortiedr-command-timeline-lead-text'))
      .toContainText('Showing all 10 steps');
    await expect(page.getByTestId('fortiedr-command-timeline-step')).toHaveCount(10);
    // The reverse-shell step marks its socket path and shows the net host.
    await expect(page.locator('.fctl-tok-sock').first()).toContainText('/dev/tcp/1.1.1.1/443');
    await expect(page.getByTestId('fortiedr-command-timeline-net-facts'))
      .toContainText('AS 13335 CLOUDFLARENET');
    // The story is a bounded column, not the whole panel width.
    const w = await page.getByTestId('fortiedr-command-timeline-story').evaluate((el) => el.getBoundingClientRect().width);
    expect(w).toBeLessThanOrEqual(1281);
    // Detail expands inline, with no canvas on this tab.
    await expect(page.locator('#fctl-cy')).toHaveCount(0);
    await page.getByTestId('fortiedr-command-timeline-step').nth(1).click();
    await expect(page.getByTestId('fortiedr-command-timeline-detail')).toHaveCount(1);
    if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS, fullPage: true });
  });

  test('graph tab is one click away from the story', async ({ page }) => {
    await mount(page, { defaultView: 'story' });
    await page.getByTestId('fortiedr-command-timeline-tab-graph').click();
    await page.waitForFunction(() => window.__fctlCy && window.__fctlCy.nodes().length > 0);
    await page.getByTestId('fortiedr-command-timeline-tab-story').click();
    await expect(page.getByTestId('fortiedr-command-timeline-story')).toBeVisible();
  });
});
