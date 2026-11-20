// The turns that are not a typed ask, driven through the real drawer:
// a quick-action chip, a follow-up that answers the assistant's own staged
// action, and a choice-card answer (a resume). Each used to skip the scope and
// language declaration; live they answered English asks in Spanish and re-ran
// a full investigation on "lets do 6 hours".
//
// Language is judged on everything the drawer rendered for the assistant,
// card text included. Runs against the record in FSRPB_LIVE_RECORD.
"use strict";
const { openWidgetDrawer } = require("../../lib/liveUiDriver");
const d = process.env.FSRPB_LIVE === "1" ? describe : describe.skip;
const RECORD = process.env.FSRPB_LIVE_RECORD;

function looksEnglish(t) {
  const s = ` ${String(t || "").toLowerCase()} `;
  const nonLatin = [...s].filter((ch) => /\p{L}/u.test(ch) && !/\p{Script=Latin}/u.test(ch)).length;
  if (nonLatin >= 3) return false;
  if (/[áéíóúñ¿¡äöüßàèâêîôûç]/.test(s)) return false;
  const words = [" el ", " la ", " los ", " las ", " está ", " para ", " con ", " una ", " nicht ", " und ",
    " sind ", " der ", " die ", " das ", " ist ", " wurde ", " keine ", " les ", " des ", " est ", " pas ",
    " pour ", " avec "];
  return words.reduce((n, w) => n + s.split(w).length - 1, 0) < 2;
}

const bubbles = (page) => page.$$eval('[data-testid^="chat-message-assistant"]', (ns) => ns.map((n) => n.innerText));
const count = (page, prefix) => page.locator(`[data-testid^="${prefix}"]`).count();

d("turns that are not a typed ask", () => {
  jest.setTimeout(900000);

  test("the attack-timeline quick action answers in English", async () => {
    const s = await openWidgetDrawer({ module: "alerts", recordUuid: RECORD });
    const r = await s.clickAndWait('[data-testid="quick-action-timeline"]', { timeoutMs: 600000 });
    expect(r.done).toBe(true);
    const all = (await bubbles(s.page)).join("\n");
    console.log(`[timeline chip] ${all.length} chars: ${all.slice(0, 240).replace(/\s+/g, " ")}`);
    expect(all.length).toBeGreaterThan(40);
    expect(looksEnglish(all)).toBe(true);
    await s.close();
  });

  test("a follow-up to a staged block stays on the block: no verdict, no hunt", async () => {
    const s = await openWidgetDrawer({ module: "alerts", recordUuid: RECORD });
    const r1 = await s.sendChat("Block ip 198.51.100.10", { timeoutMs: 300000 });
    expect(r1.done).toBe(true);
    await s.page.locator('[data-testid^="step-action_card-"]').last().waitFor({ state: "visible", timeout: 60000 });
    const verdictsBefore = await count(s.page, "step-verdict_card-");
    const actionsBefore = await count(s.page, "step-action_card-");
    const r2 = await s.sendChat("make it 6 hours", { timeoutMs: 300000 });
    expect(r2.done).toBe(true);
    expect(await count(s.page, "step-verdict_card-")).toBe(verdictsBefore);
    // The follow-up re-stages the block (live it was deferred behind a hunt).
    expect(await count(s.page, "step-action_card-")).toBeGreaterThan(actionsBefore);
    expect(looksEnglish((await bubbles(s.page)).join("\n"))).toBe(true);
    await s.close();
  });

  test("answering a choice card resumes in English", async () => {
    const s = await openWidgetDrawer({ module: "alerts", recordUuid: RECORD });
    const r1 = await s.sendChat("I want to create a new playbook that looks up an IP and opens a ticket if it is malicious.", { timeoutMs: 600000 });
    expect(r1.done).toBe(true);
    const choice = s.page.locator('[data-testid^="choice-card-"] button[data-testid^="choice-"]:not([data-testid$="-submit"]):not([data-testid$="-text-send"])');
    const n = await choice.count();
    if (!n) {
      // NOT RUN, not a pass: the model asked nothing this time.
      console.log("[choice resume] NOT RUN: the turn raised no choice card");
      await s.close();
      return;
    }
    const r2 = await s.clickAndWait('[data-testid^="choice-card-"] button[data-testid^="choice-"]:not([data-testid$="-submit"]):not([data-testid$="-text-send"])', { timeoutMs: 600000 });
    expect(r2.done).toBe(true);
    const all = (await bubbles(s.page)).join("\n");
    console.log(`[choice resume] ${all.slice(-240).replace(/\s+/g, " ")}`);
    expect(looksEnglish(all)).toBe(true);
    await s.close();
  });
});
