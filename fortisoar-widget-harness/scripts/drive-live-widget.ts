#!/usr/bin/env node
"use strict";
/**
 * Drive the live SOC Assistant widget end-to-end on the real forticloud box and
 * print whether live messages stream. Repeatable manual/CI smoke for the
 * chat-poll turn-counter fix (connector 0.3.134) and the streaming UX in general.
 *
 *   node scripts/drive-live-widget.js \
 *       --record <alert-uuid> [--module alerts] \
 *       [--message "What is the severity of this alert?"] \
 *       [--headed] [--shot /tmp/live-widget.png]
 *
 * Needs FSR_BASE_URL / FSR_USERNAME / FSR_PASSWORD (.env, env, or keychain).
 * Exits non-zero if no streaming turn was observed (the bug's signature).
 */
require("dotenv").config();
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic require
import liveUiDriver = require("../lib/liveUiDriver");

function arg(name: string, def?: string | boolean): string | boolean {
  const i = process.argv.indexOf("--" + name);
  if (i === -1) return def !== undefined ? def : "";
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : true;
}

(async () => {
  const recordUuidVal = arg("record");
  const recordUuid = typeof recordUuidVal === "string" ? recordUuidVal : "";
  if (!recordUuid) {
    console.error("error: --record <uuid> is required");
    process.exit(2);
  }
  const moduleVal = arg("module", "alerts");
  const module = typeof moduleVal === "string" ? moduleVal : "alerts";
  const messageVal = arg("message", "What is the severity of this alert?");
  const message = typeof messageVal === "string" ? messageVal : "What is the severity of this alert?";
  const headlessVal = arg("headed", false);
  const headless = !headlessVal;
  const shotVal = arg("shot", "/tmp/live-widget.png");
  const shot = typeof shotVal === "string" ? shotVal : "/tmp/live-widget.png";

  console.log(`[drive] module=${module} record=${recordUuid} headless=${headless}`);
  const s = await liveUiDriver.openWidgetDrawer({ module, recordUuid, headless });
  console.log(`[drive] drawer composer open: ${s.composerOpen}`);
  if (!s.composerOpen) {
    await s.screenshot(shot, true);
    await s.close();
    console.error(`[drive] FAIL: assistant drawer never opened (screenshot: ${shot})`);
    process.exit(1);
  }

  console.log(`[drive] sending: ${message}`);
  const res = await s.sendChat(message);
  await s.screenshot(shot);
  await s.close();

  console.log("[drive] poll feed:", JSON.stringify(res.polls));
  console.log(`[drive] sawStreamingTurn=${res.sawStreamingTurn} maxFrames=${res.maxFrames} done=${res.done}`);
  if (res.sawStreamingTurn) {
    console.log(`[drive] PASS: live messages streamed (screenshot: ${shot})`);
    process.exit(0);
  }
  console.error(`[drive] FAIL: no streaming turn — chat_poll returned turn:null/0 frames (the desync bug). screenshot: ${shot}`);
  process.exit(1);
})().catch((e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e);
  console.error("[drive] error:", msg);
  process.exit(1);
});
