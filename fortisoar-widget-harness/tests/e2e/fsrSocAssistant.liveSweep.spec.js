'use strict';
// ───────────────────────────────────────────────────────────────────────────
// LIVE forticloud UI bug-hunt sweep (gated, NON-destructive except the build
// test which auto-cleans). Drives the REAL widget against the REAL
// `connector-fsr-soc-assistant` on the box in .env (FSR_BASE_URL), through the
// UI only, across the four scenario classes that show the "sometimes errors /
// inconsistency" the user reported:
//   1. entity-context triage   (real incident, real alert, drawer re-open)
//   2. hunt chain              (seeded wendy.smith → C2 alert)
//   3. direct containment      ("block IP …" → action card + gating)
//   4. playbook build/save     (build → Create Playbook → verify on box → delete)
//
// Every test captures, per scenario: browser console errors, uncaught page
// exceptions, failing /api responses (>=400), the widget error-banner text, and
// the final view state. Each test prints a single  [[SWEEP]] {json}  line so the
// run can be triaged from the make output. Assertions are SOFT — a scenario that
// errors still finishes and reports, so one bug never masks the rest.
//
// Gated on FSRPB_LIVE_UI=1 (real agent runs on Dylan's OpenAI key + a real,
// auto-cleaned SOAR mutation in the build test). Run:
//   FSRPB_LIVE_UI=1 make test-e2e-spec SPEC="tests/e2e/fsrSocAssistant.liveSweep.spec.js"
// Needs FSR_BASE_URL/FSR_USERNAME/FSR_PASSWORD in the harness .env.

const { test, expect } = require('./_isolated');
const { resolveWidgetId, DEFAULT_ID } = require('./_widgetId');
const { makeClient } = require('../live/lib/soarClient');

const LIVE = process.env.FSRPB_LIVE_UI === '1';
const d = LIVE ? test.describe : test.describe.skip;

let WIDGET_ID = DEFAULT_ID;

// Gateway preflight (D): a HARD connector/LLM-backend outage (box down, health
// not ok, no LLM key) should read as an ENV-SKIP, not a wall of widget FAILs —
// so an upstream 502 storm isn't mistaken for a widget regression. Intermittent
// per-request blips are NOT gated here: the widget's poll-retry now survives
// those, and that resilience is exactly what we want the sweep to exercise.
let ENV_OK = true;
let ENV_MSG = '';
test.beforeAll(async ({ request }) => {
  if (!LIVE) return;
  WIDGET_ID = await resolveWidgetId(request);
  try {
    const soar = await makeClient();
    const h = await soar.exec('health_check', {}, { timeoutMs: 30000 });
    if (!h || h.ok === false || h.llm_key_configured === false) {
      ENV_OK = false;
      ENV_MSG = 'connector health_check not ok: ' + JSON.stringify(h).slice(0, 200);
    }
  } catch (e) {
    ENV_OK = false;
    ENV_MSG = 'connector health_check threw: ' + String((e && e.message) || e).slice(0, 200);
  }
  if (!ENV_OK) console.warn('[[SWEEP-ENV-SKIP]] ' + ENV_MSG);
});

// Skip (not fail) every scenario when the backend is hard-down.
test.beforeEach(() => {
  test.skip(LIVE && !ENV_OK, 'ENV: connector/LLM backend unavailable — ' + ENV_MSG);
});

// ── Real records confirmed present on forticloud (HTTP 200) ─────────────────
const C2_ALERT = {
  '@id': '/api/3/alerts/d39ecc9a-2968-42d5-948d-ce96fd76b227',
  module: 'alerts',
  name: 'Outbound C2 traffic - smithDesktop',
  severity: { itemValue: 'Critical' }, status: { itemValue: 'Open' },
  source: 'FortiSIEM', type: 'Exfiltration',
  description: 'smithDesktop (10.50.60.70 / wendy.smith) beaconing to 102.220.160.21 after 7ogger.exe drop. MITRE T1041.'
};
const CLEARTEXT_ALERT = {
  '@id': '/api/3/alerts/17206168-f927-4133-ad8e-9786574ef2e3',
  module: 'alerts',
  name: 'Outbound cleartext password usage from non guest host',
  severity: { itemValue: 'High' }, status: { itemValue: 'Open' },
  source: 'FortiSIEM', type: 'Credential Access',
  description: 'Cleartext credential egress observed from an internal host.'
};
const INTRUSION_INCIDENT = {
  '@id': '/api/3/incidents/527ed222-d9d1-4995-b03b-5cdc0ea4c7ea',
  module: 'incidents',
  name: 'Detected intrusion traffic attempts from 192.x',
  severity: { itemValue: 'High' }, status: { itemValue: 'Open' },
  source: 'FortiSIEM', type: 'Intrusion',
  description: 'Detected intrusion traffic attempts from an external source.'
};

// ── Per-test error capture ──────────────────────────────────────────────────
function attachCapture(page) {
  const cap = { consoleErrors: [], pageErrors: [], apiFailures: [] };
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const t = msg.text();
      // Ignore the benign favicon / ResizeObserver noise the SOAR shell emits.
      if (/favicon|ResizeObserver loop/i.test(t)) return;
      cap.consoleErrors.push(t.slice(0, 400));
    }
  });
  page.on('pageerror', (err) => cap.pageErrors.push(String(err && err.message || err).slice(0, 400)));
  page.on('response', (resp) => {
    try {
      const u = resp.url();
      const s = resp.status();
      if (s >= 400 && /\/api\//.test(u)) {
        cap.apiFailures.push(s + ' ' + u.replace(/https?:\/\/[^/]+/, '').slice(0, 160));
      }
    } catch (_) { /* ignore */ }
  });
  return cap;
}

async function boot(page, opts) {
  opts = opts || {};
  await page.addInitScript((args) => {
    const { id, entity, intent } = args;
    localStorage.setItem('harness:config:' + id, JSON.stringify({
      connectorName: 'connector-fsr-soc-assistant',
      defaultIntent: intent || 'triage',
      maxTurns: 14, showUsage: true,
      seedFromEntity: !!entity, mockMode: 'real',
      detachedTimeoutMs: 480000
    }));
    localStorage.setItem('harness.widget', id);
    localStorage.setItem('harness.ctx', entity ? 'drawer' : 'dashboard');
    localStorage.removeItem('fsrPbSession');
    if (entity) window.__fsrPbEntity__ = entity;
  }, { id: WIDGET_ID, entity: opts.entity || null, intent: opts.intent || null });

  await page.goto(`/?widget=${WIDGET_ID}&context=Dashboard&mode=live${opts.extra || ''}`,
    { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => window.__fsrSocAssistant__ && typeof window.__fsrSocAssistant__.state === 'string',
    null, { timeout: 45000 });
}

async function probe(page) {
  return page.evaluate(() => {
    const p = window.__fsrSocAssistant__;
    return p ? {
      state: p.state, intent: p.intent, msgCount: p.messageCount,
      yamlLen: (p.currentYaml || '').length, push: p.pushResult || null,
      lastTurnRole: p.lastTurn && p.lastTurn.role,
      lastTurnText: (p.lastTurn && (p.lastTurn.content || p.lastTurn.text) || '').slice(0, 240),
      entityIri: p.entity && p.entity.iri
    } : null;
  });
}

// Wait for the widget to return to idle (turn settled) OR until timeout.
async function waitIdle(page, timeoutMs, minMsgs) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await probe(page);
    if (last && last.state === 'idle' && (!minMsgs || last.msgCount >= minMsgs)) return last;
    await page.waitForTimeout(2500);
  }
  return last; // soft — caller records the (possibly stuck) state
}

async function send(page, text) {
  await page.locator('[data-testid="chat-input"]').fill(text);
  await page.locator('[data-testid="chat-send"]').click();
}

async function errorBannerText(page) {
  return page.locator('[data-testid="error-banner"]').textContent({ timeout: 1000 })
    .then(t => (t || '').trim()).catch(() => '');
}

function report(label, cap, extra) {
  const summary = Object.assign({
    scenario: label,
    consoleErrors: cap.consoleErrors,
    pageErrors: cap.pageErrors,
    apiFailures: cap.apiFailures.slice(0, 12)
  }, extra || {});
  console.log('[[SWEEP]] ' + JSON.stringify(summary));
  return summary;
}

d('LIVE forticloud UI sweep', () => {
  test.describe.configure({ mode: 'serial' });

  // 1a — entity-context triage on a real INCIDENT
  test('1a triage seeds on a real incident + follow-up answers', async ({ page }) => {
    test.setTimeout(300000);
    const cap = attachCapture(page);
    await boot(page, { entity: INTRUSION_INCIDENT, intent: 'triage' });
    await expect(page.locator('[data-testid="chat-input"]')).toBeEnabled({ timeout: 45000 });

    // Triage card should auto-seed (a turn appears without the user typing).
    const seeded = await waitIdle(page, 180000, 1);
    const bannerAfterSeed = await errorBannerText(page);

    // Follow-up question through the UI.
    await send(page, 'What is the severity and what should I check first?');
    const afterAsk = await waitIdle(page, 180000, (seeded ? seeded.msgCount : 0) + 1);
    const banner = await errorBannerText(page);

    const r = report('1a-incident-triage', cap, {
      seededState: seeded && seeded.state, seededMsgs: seeded && seeded.msgCount,
      finalState: afterAsk && afterAsk.state, finalMsgs: afterAsk && afterAsk.msgCount,
      entityIri: afterAsk && afterAsk.entityIri, bannerAfterSeed, banner
    });
    expect.soft(r.pageErrors, 'no uncaught JS').toEqual([]);
    expect.soft(banner, 'no error banner').toBe('');
    expect.soft(afterAsk && afterAsk.msgCount, 'chat advanced').toBeGreaterThan(seeded ? seeded.msgCount : 0);
  });

  // 1b — entity-context triage on a real ALERT + drawer RE-OPEN (the dead-chat race)
  test('1b triage on a real alert, then re-open (entity re-detect)', async ({ page }) => {
    test.setTimeout(300000);
    const cap = attachCapture(page);
    await boot(page, { entity: CLEARTEXT_ALERT, intent: 'triage' });
    await expect(page.locator('[data-testid="chat-input"]')).toBeEnabled({ timeout: 45000 });
    const firstSeed = await waitIdle(page, 180000, 1);

    // Simulate a drawer re-open: reload with the same entity (the path where the
    // triage card sometimes failed to re-seed → dead chat).
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () => window.__fsrSocAssistant__ && typeof window.__fsrSocAssistant__.state === 'string',
      null, { timeout: 45000 });
    await expect(page.locator('[data-testid="chat-input"]')).toBeEnabled({ timeout: 45000 });
    const afterReopen = await waitIdle(page, 120000, 0);
    const banner = await errorBannerText(page);

    const r = report('1b-alert-triage-reopen', cap, {
      firstSeedMsgs: firstSeed && firstSeed.msgCount, firstState: firstSeed && firstSeed.state,
      reopenState: afterReopen && afterReopen.state, reopenMsgs: afterReopen && afterReopen.msgCount,
      entityIri: afterReopen && afterReopen.entityIri, banner
    });
    expect.soft(r.pageErrors, 'no uncaught JS').toEqual([]);
    expect.soft(afterReopen && afterReopen.entityIri, 'entity re-detected after reopen')
      .toBe(CLEARTEXT_ALERT['@id']);
    // Composer must be usable after reopen (not dead).
    await expect(page.locator('[data-testid="chat-input"]')).toBeEnabled();
  });

  // 2 — hunt chain on the seeded C2 alert
  test('2 hunt chain pivots across the seeded C2 indicators', async ({ page }) => {
    test.setTimeout(360000);
    const cap = attachCapture(page);
    await boot(page, { entity: C2_ALERT, intent: 'triage' });
    await expect(page.locator('[data-testid="chat-input"]')).toBeEnabled({ timeout: 45000 });
    await waitIdle(page, 120000, 0);

    await send(page, 'Investigate this alert end to end: pivot on the host, the user, '
      + 'and the destination IP, and tell me if this is a real C2 beacon.');
    const done = await waitIdle(page, 300000, 2);
    const banner = await errorBannerText(page);

    // Count tool calls rendered in the transcript (the hunt actually did work).
    const toolCalls = await page.locator('[data-testid^="tool-call-head-"]').count().catch(() => 0);
    const messagesText = await page.locator('[data-testid="messages"]').innerText().catch(() => '');

    const r = report('2-hunt-chain', cap, {
      finalState: done && done.state, finalMsgs: done && done.msgCount,
      toolCalls, banner,
      mentionsIp: /102\.220\.160\.21/.test(messagesText),
      mentionsHost: /smithDesktop|wendy\.smith/i.test(messagesText)
    });
    expect.soft(r.pageErrors, 'no uncaught JS').toEqual([]);
    expect.soft(banner, 'no error banner').toBe('');
    expect.soft(toolCalls, 'hunt invoked at least one tool').toBeGreaterThan(0);
  });

  // 3 — direct containment → action card + gating
  test('3 direct containment emits an action card (not a silent run_op)', async ({ page }) => {
    test.setTimeout(300000);
    const cap = attachCapture(page);
    await boot(page, { intent: 'triage' });
    await expect(page.locator('[data-testid="chat-input"]')).toBeEnabled({ timeout: 45000 });

    await send(page, 'Block the IP 102.220.160.21 on FortiGate.');
    const done = await waitIdle(page, 240000, 2);
    const banner = await errorBannerText(page);

    const actionCards = await page.locator('[data-testid^="action-card-"]').count().catch(() => 0);
    const approvalModal = await page.locator('[data-testid="approval-modal"]').count().catch(() => 0);
    const messagesText = await page.locator('[data-testid="messages"]').innerText().catch(() => '');

    const r = report('3-direct-containment', cap, {
      finalState: done && done.state, finalMsgs: done && done.msgCount,
      actionCards, approvalModal, banner,
      mentionsBlock: /block|fortigate|isolat/i.test(messagesText)
    });
    expect.soft(r.pageErrors, 'no uncaught JS').toEqual([]);
    expect.soft(banner, 'no error banner').toBe('');
    // Either an action card or an approval gate must appear — never a silent end.
    expect.soft(actionCards + approvalModal, 'a containment card/gate surfaced').toBeGreaterThan(0);
  });

  // 4 — playbook build / save (mutating, auto-cleanup)
  test('4 build a playbook → Create Playbook → verify on box → delete', async ({ page }) => {
    test.setTimeout(420000);
    const cap = attachCapture(page);
    await boot(page, { intent: 'build' });
    await expect(page.locator('[data-testid="chat-input"]')).toBeEnabled({ timeout: 45000 });

    await send(page, 'Build a simple playbook that blocks a malicious IP address using '
      + 'FortiGate. One block-IP action is enough. Produce the playbook YAML.');

    // Wait for authored YAML.
    const deadline = Date.now() + 300000;
    let withYaml = null;
    while (Date.now() < deadline) {
      const s = await probe(page);
      if (s && s.state === 'idle' && s.yamlLen > 0) { withYaml = s; break; }
      await page.waitForTimeout(3000);
    }
    const banner1 = await errorBannerText(page);

    let pushRes = null, verified = null, cleanup = null;
    if (withYaml) {
      const createBtn = page.locator('[data-testid="yaml-push"]');
      if (await createBtn.isVisible().catch(() => false)) {
        await createBtn.click();
        const pd = Date.now() + 120000;
        while (Date.now() < pd) {
          const s = await probe(page);
          if (s && s.push) { pushRes = s.push; break; }
          await page.waitForTimeout(2500);
        }
      }
    }

    // Independent verify + cleanup on the box.
    if (pushRes) {
      const wfUuid = (pushRes.workflow_uuids && pushRes.workflow_uuids[0])
        || (pushRes.workflows && pushRes.workflows[0] && pushRes.workflows[0].uuid) || null;
      const collUuid = pushRes.collection_uuid
        || (pushRes.collection_iri ? String(pushRes.collection_iri).split('/').pop() : null);
      const soar = await makeClient();
      try {
        if (wfUuid) { const rec = await soar.get(`/api/3/workflows/${wfUuid}`); verified = !!(rec && (rec.uuid === wfUuid || rec['@id'])); }
        else if (collUuid) { const rec = await soar.get(`/api/3/workflow_collections/${collUuid}`); verified = !!(rec && (rec.uuid === collUuid || rec['@id'])); }
      } catch (e) { verified = 'verify-error:' + e.message; }
      try {
        if (collUuid) { const dd = await soar.del(`/api/3/workflow_collections/${collUuid}`); cleanup = 'coll ' + dd.status; }
        else if (wfUuid) { const dd = await soar.del(`/api/3/workflows/${wfUuid}`); cleanup = 'wf ' + dd.status; }
        else cleanup = 'NO-UUID-CHECK-BOX';
      } catch (e) { cleanup = 'cleanup-error:' + e.message; }
    }

    const r = report('4-playbook-build', cap, {
      yamlLen: withYaml && withYaml.yamlLen, banner1,
      pushOk: pushRes && pushRes.ok, verified, cleanup,
      pushKeys: pushRes ? Object.keys(pushRes) : null
    });
    expect.soft(r.pageErrors, 'no uncaught JS').toEqual([]);
    expect.soft(withYaml, 'agent authored YAML').toBeTruthy();
    expect.soft(pushRes && pushRes.ok, 'push succeeded').not.toBe(false);
    expect.soft(verified, 'workflow verified on box').toBe(true);
  });
});
