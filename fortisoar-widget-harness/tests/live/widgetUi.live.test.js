// Live UI parity (Layer 2 against the REAL box): drive the deployed SOC
// Assistant drawer in a real browser and assert that chat_poll streams live
// frames. This is the end-to-end guard for the chat-poll turn-counter desync
// (connector 0.3.134): the symptom was chat_poll returning turn:null / 0 frames
// forever, so the analyst saw no live messages. A healthy turn yields at least
// one poll with a non-null turn and frames>0.
//
// Unlike the other *.live.test.js (which hit /api/integration/execute directly),
// this drives the actual AngularJS widget through Playwright via lib/liveUiDriver
// — proving the WIDGET renders the stream, not just that the connector returns it.
//
// Gated: FSRPB_LIVE=1. Needs FSR_BASE_URL / FSR_USERNAME / FSR_PASSWORD and a
// record uuid (FSRPB_LIVE_RECORD, default = the seeded demo alert) that mounts
// the assistant drawer.
"use strict";

const { openWidgetDrawer } = require("../../lib/liveUiDriver");

const LIVE = process.env.FSRPB_LIVE === "1";
const d = LIVE ? describe : describe.skip;

const RECORD = process.env.FSRPB_LIVE_RECORD || "8f28e5f4-9991-4289-825c-0614a1781b24";
const MODULE = process.env.FSRPB_LIVE_MODULE || "alerts";

d("live SOC Assistant widget UI", () => {
  jest.setTimeout(180000);
  let session;

  afterAll(async () => { if (session) await session.close(); });

  test("chat_poll streams live frames into the open drawer", async () => {
    session = await openWidgetDrawer({ module: MODULE, recordUuid: RECORD });
    expect(session.composerOpen).toBe(true);

    const res = await session.sendChat("What is the severity of this alert?");

    // The fix's acceptance signal: at least one poll latched a real turn with
    // frames (the desync bug made every poll return turn:null / frames:0).
    expect(res.sawStreamingTurn).toBe(true);
    expect(res.maxFrames).toBeGreaterThan(0);
    // And the feed converged on done (no lost-producer hang).
    expect(res.done).toBe(true);
  });
});
