// Live: the model badge and "Save summary to comments" against a REAL box.
//
// The mock e2e tier stubs the comment POST and the module-metadata probe, so it
// cannot prove the comment lands on the record. This drives the deployed drawer:
// a block ask stages an action card (the act scope), the badge names the model
// the turn was sent to, the summary preview carries the action, and Save writes
// a comment that reads back LINKED TO THE RECORD (verify the write, not the
// card). The comment is deleted afterwards.
//
// The block is staged, never approved: nothing is sent to a firewall.
//
// Gated: FSRPB_LIVE=1. Needs FSR_BASE_URL / FSR_USERNAME / FSR_PASSWORD and a
// record uuid (FSRPB_LIVE_RECORD) of a module that has comments.
"use strict";

const { openWidgetDrawer } = require("../../lib/liveUiDriver");
const { makeClient } = require("./lib/soarClient");

const LIVE = process.env.FSRPB_LIVE === "1";
const d = LIVE ? describe : describe.skip;

const RECORD = process.env.FSRPB_LIVE_RECORD;
const MODULE = process.env.FSRPB_LIVE_MODULE || "alerts";
// A documentation-range address: never a real host.
const TARGET_IP = "198.51.100.23";

d("live model badge and comment summary", () => {
  jest.setTimeout(300000);
  let session;
  const created = [];

  let soar;

  afterAll(async () => {
    for (const iri of created) await soar.del(iri).catch(() => {});
    if (session) await session.close();
  });

  test("a block ask stages an action, the badge names the model, and Save writes a linked comment", async () => {
    if (!RECORD) throw new Error("set FSRPB_LIVE_RECORD to a record uuid of a module with comments");
    soar = await makeClient();
    session = await openWidgetDrawer({ module: MODULE, recordUuid: RECORD });
    expect(session.composerOpen).toBe(true);
    const page = session.page;

    // Capture the widget's own comment POST: its response carries the new iri.
    const posted = [];
    page.on("response", async (r) => {
      if (r.request().method() === "POST" && /\/api\/3\/comments(\?|$)/.test(r.url())) {
        try { posted.push(await r.json()); } catch (_) { posted.push({}); }
      }
    });

    // Diagnosis on failure: every frame type the widget polled, and its errors.
    const polled = [];
    const errors = [];
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 300)); });
    page.on("pageerror", (e) => errors.push(String(e).slice(0, 300)));
    page.on("response", async (r) => {
      if (!/\/api\/integration\/execute/.test(r.url())) return;
      try {
        const j = await r.json();
        const data = (j && j.data) || j || {};
        for (const f of data.frames || data.transcript || []) polled.push(f && f.type);
      } catch (_) { /* not json */ }
    });

    const res = await session.sendChat(`block ip ${TARGET_IP}`);
    expect(res.done).toBe(true);

    // The act scope stages the block on a card; it does not end on a verdict.
    const action = page.locator('[data-testid^="step-action_card-"]').first();
    await action.waitFor({ state: "visible", timeout: 60000 }).catch(async (e) => {
      const seen = await page.evaluate(() => ({
        testids: [...new Set([...document.querySelectorAll("[data-testid]")]
          .map((n) => n.getAttribute("data-testid")))].filter((t) => /card|verdict|action|badge|summary/.test(t)),
        ip: [...document.querySelectorAll("*")].filter((n) => n.children.length === 0
          && (n.textContent || "").includes("198.51.100.23"))
          .slice(0, 5).map((n) => {
            const c = n.closest("[data-testid],[class*=card]");
            return { tag: n.tagName, cls: c ? c.className : "", tid: c ? c.getAttribute("data-testid") : "" };
          }),
        cardClasses: [...new Set([...document.querySelectorAll("[class*=card]")].map((n) => n.className))].slice(0, 15),
      }));
      await page.screenshot({ path: require("path").join(__dirname, "_artifacts", "commentSummary-no-action.png") }).catch(() => {});
      throw new Error(`no action card. polled: ${JSON.stringify(polled)} errors: ${JSON.stringify(errors)} rendered: ${JSON.stringify(seen)}\n${e.message}`);
    });
    expect(await page.locator('[data-testid^="step-verdict_card-"]').count()).toBe(0);

    // The badge names the model this turn was sent to.
    const badge = page.locator('[data-testid="model-badge-label"]');
    await badge.waitFor({ state: "visible", timeout: 15000 });
    expect(await badge.innerText()).toMatch(/^Model: \S+/);

    // The summary preview carries the staged action.
    const strip = page.locator('[data-testid="comment-summary"]');
    await strip.waitFor({ state: "visible", timeout: 15000 });
    await page.locator('[data-testid="comment-summary-open"]').click();
    const text = await page.locator('[data-testid="comment-summary-text"]').inputValue();
    expect(text).toContain(TARGET_IP);
    expect(text).not.toMatch(/emit_card|run_op|card_type|—|–/);

    await page.locator('[data-testid="comment-summary-save"]').click();
    await page.locator('[data-testid="comment-summary-saved"]').waitFor({ state: "visible", timeout: 20000 });
    expect(posted.length).toBe(1);
    const iri = posted[0] && posted[0]["@id"];
    expect(iri).toMatch(/^\/api\/3\/comments\//);
    created.push(iri);

    // Read the write back from the box: the comment exists, holds the summary,
    // and is linked to THIS record.
    const back = await soar.get(`${iri}?$relationships=true`);
    expect(String(back.content || "")).toContain(TARGET_IP);
    const linked = (back[MODULE] || []).map((x) => (typeof x === "string" ? x : x["@id"]));
    expect(linked).toContain(`/api/3/${MODULE}/${RECORD}`);
  });
});
