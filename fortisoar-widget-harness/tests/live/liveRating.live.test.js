// Live UI (Layer 2 against the REAL box): drive the deployed SOC Assistant
// drawer and exercise the header live-session rating control end-to-end.
//
// Proves the widget-side control introduced alongside the History-panel rating:
// after an assistant turn the header 👍/👎 surfaces, clicking it fires the real
// `rate_session` connector op (ok:true), the button latches active, and clicking
// the active rating clears it (toggle-off). We restore the session to unrated so
// the run leaves no residue on the box.
//
// Gated: FSRPB_LIVE=1. Needs FSR_BASE_URL / FSR_USERNAME / FSR_PASSWORD (source
// the box .env first) and a record uuid that mounts the drawer.
"use strict";

const { openWidgetDrawer } = require("../../lib/liveUiDriver");

const LIVE = process.env.FSRPB_LIVE === "1";
const d = LIVE ? describe : describe.skip;

// Default: the ztpf_devices record on 206 that reliably mounts the drawer
// (tests/live/scenarios.local.206.json). Override per box.
const RECORD = process.env.FSRPB_LIVE_RECORD || "5b23794a-a657-4169-97d3-98698126d59f";
const MODULE = process.env.FSRPB_LIVE_MODULE || "ztpf_devices";

// Watch the connector wire for the rate_session round-trip so we assert the
// SINK actually ran, not just that the button toggled a CSS class.
function captureRateSession(page) {
    const rates = [];
    page.on("response", async (r) => {
        if (!/\/integration\/execute/.test(r.url())) return;
        let reqBody = null;
        try { reqBody = JSON.parse(r.request().postData() || "null"); } catch (e) {}
        const op = reqBody && (reqBody.operation || (reqBody.params && reqBody.params.operation));
        if (op !== "rate_session") return;
        let body = null;
        try { body = await r.json(); } catch (e) {}
        rates.push({ status: r.status(), body, sent: reqBody });
    });
    return rates;
}

d("live SOC Assistant — session rating control", () => {
    jest.setTimeout(240000);
    let session;

    afterAll(async () => { if (session) await session.close(); });

    test("rating surfaces after a turn, persists via rate_session, and toggles off", async () => {
        session = await openWidgetDrawer({ module: MODULE, recordUuid: RECORD });
        expect(session.composerOpen).toBe(true);

        const { page } = session;
        const rates = captureRateSession(page);

        // No assistant output yet → the control is hidden (nothing to rate).
        expect(await page.$('[data-testid="live-rate"]')).toBeNull();

        // Produce one assistant turn so the control has something to judge.
        const res = await session.sendChat("What is the status of this device?");
        expect(res.submitConfirmed).toBe(true);

        // The header rating now appears.
        await page.waitForSelector('[data-testid="live-rate"]', { timeout: 20000 });
        const up = page.locator('[data-testid="live-rate-up"]');
        await up.waitFor({ state: "visible", timeout: 5000 });

        // Thumbs-up → the real rate_session op fires and the button latches active.
        const rateBefore = rates.length;
        await up.click();
        // Wait for the write to come back ok:true with rating "up".
        const deadline = Date.now() + 15000;
        while (Date.now() < deadline && rates.length === rateBefore) {
            await page.waitForTimeout(400);
        }
        expect(rates.length).toBeGreaterThan(rateBefore);
        const lastUp = rates[rates.length - 1];
        expect(lastUp.status).toBe(200);
        // Envelope: connector returns { data: { ok, rating: { rating } } }.
        const upData = (lastUp.body && (lastUp.body.data || lastUp.body)) || {};
        expect(upData.ok).toBe(true);
        expect(upData.rating && upData.rating.rating).toBe("up");
        await expect(up).toHaveClass(/is-active/);

        // Toggle off: clicking the active rating clears it (rating "" → null),
        // leaving the box session unrated as we found it.
        const rateBeforeClear = rates.length;
        await up.click();
        const clrDeadline = Date.now() + 15000;
        while (Date.now() < clrDeadline && rates.length === rateBeforeClear) {
            await page.waitForTimeout(400);
        }
        expect(rates.length).toBeGreaterThan(rateBeforeClear);
        const lastClr = rates[rates.length - 1];
        const clrData = (lastClr.body && (lastClr.body.data || lastClr.body)) || {};
        expect(clrData.rating).toBeNull();
        await expect(up).not.toHaveClass(/is-active/);
    });
});
