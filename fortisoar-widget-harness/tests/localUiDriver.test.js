'use strict';
// Guards on lib/localUiDriver's PREFLIGHT -- the checks that decide whether a
// local matrix row means what it claims.
//
// Every assertion here covers a failure whose natural symptom is a SILENT GREEN
// rather than an error, which is the only reason preflight exists at all:
//
//   - a harness without FSR_LOCAL_CONNECTOR=1 proxies /api/integration/execute/
//     to the DEPLOYED connector, so a "local" row would grade shipped code and
//     pass while your working-tree change was never executed;
//   - a `visitFirst` row expresses a stale-entity (D1) bug that the harness
//     mount structurally cannot exhibit, so running it locally would report a
//     clean pass for a bug that was never given a chance to appear.
//
// These run offline: preflight happens BEFORE any browser launch, so a stub
// HTTP server is enough and no Playwright browser is ever started.

const http = require('http');
const { openWidgetDrawer } = require('../lib/localUiDriver');

// Minimal stand-in for the harness's /_fsr/info + /_fsr/widgets surface.
function stubHarness(info, widgets) {
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url.startsWith('/_fsr/info')) return res.end(JSON.stringify(info));
    if (req.url.startsWith('/_fsr/widgets')) return res.end(JSON.stringify({ widgets: widgets || [] }));
    res.statusCode = 404;
    res.end('{}');
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, base: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

describe('localUiDriver preflight', () => {
  let stub = null;
  afterEach(async () => {
    if (stub) await new Promise((r) => stub.server.close(r));
    stub = null;
  });

  test('refuses a harness that would proxy to the deployed connector', async () => {
    stub = await stubHarness({ localConnector: false, proxyHost: 'box.example.com' });
    await expect(openWidgetDrawer({ base: stub.base, recordUuid: 'u-1' }))
      .rejects.toThrow(/WITHOUT FSR_LOCAL_CONNECTOR=1/);
  });

  test('names the box it would have graded instead, so the error is actionable', async () => {
    stub = await stubHarness({ localConnector: false, proxyHost: 'box.example.com' });
    await expect(openWidgetDrawer({ base: stub.base, recordUuid: 'u-1' }))
      .rejects.toThrow(/box\.example\.com/);
  });

  test('refuses a visitFirst row instead of passing it vacuously', async () => {
    // Rejected before any network call -- no stub needed, which is itself the
    // point: the row is impossible here regardless of harness state.
    await expect(openWidgetDrawer({ recordUuid: 'u-1', visitFirst: '/modules/keys/abc' }))
      .rejects.toThrow(/visitFirst` is not supported/);
  });

  test('reports an unreachable harness with the command that starts it', async () => {
    // Port 1 is reserved and never listening.
    await expect(openWidgetDrawer({ base: 'http://127.0.0.1:1', recordUuid: 'u-1' }))
      .rejects.toThrow(/FSR_LOCAL_CONNECTOR=1 PORT=4401 node server\.js/);
  });

  test('refuses when the widget is not installed in the harness', async () => {
    stub = await stubHarness({ localConnector: true }, [{ name: 'somethingElse', id: 'somethingElse-1.0.0' }]);
    await expect(openWidgetDrawer({ base: stub.base, recordUuid: 'u-1' }))
      .rejects.toThrow(/is not installed in the harness/);
  });

  test('the viewpanel context requires a record to mount against', async () => {
    stub = await stubHarness({ localConnector: true },
      [{ name: 'fortiaiAgenticAssistant', id: 'fortiaiAgenticAssistant-1.0.29' }]);
    await expect(openWidgetDrawer({ base: stub.base, context: 'viewpanel' }))
      .rejects.toThrow(/needs a recordUuid/);
  });
});
