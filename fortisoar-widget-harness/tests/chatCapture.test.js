// The live wire capture is a diagnostic, so nothing it does is ever asserted on
// during a live run -- which is exactly how it shipped for months missing the
// end of the last turn. These tests are the only thing that can notice.
//
// Each one pairs the fixed behavior with the behavior it replaced, so a change
// that quietly reintroduces the tail-drop cannot leave this file green.

const { createChatCapture } = require("./live/lib/chatCapture");

// A Playwright page stand-in: one `on` registration, and responses whose bodies
// resolve only when the test says so. The deferred body IS the bug -- a body
// that resolves synchronously hides it completely.
function fakePage() {
  const handlers = [];
  return {
    on(evt, fn) {
      if (evt === "response") handlers.push(fn);
    },
    emit(op, body, { url = "https://box/api/integration/execute/", params = null } = {}) {
      let release;
      const gate = new Promise((res) => { release = res; });
      const r = {
        url: () => url,
        request: () => ({ postDataJSON: () => ({ operation: op, params }) }),
        json: async () => { await gate; return body; },
      };
      handlers.forEach((h) => h(r));
      return release;
    },
  };
}

const tick = () => new Promise((res) => setImmediate(res));

describe("createChatCapture", () => {
  test("records the op, params and response body of each chat_* call", async () => {
    const page = fakePage();
    const cap = createChatCapture(page);
    page.emit("chat_turn", { ok: true, frames: [1] }, { params: { message: "hi" } })();
    await cap.settle();
    expect(cap.payloads).toEqual([
      { op: "chat_turn", params: { message: "hi" }, response: { ok: true, frames: [1] } },
    ]);
  });

  test("settle() waits for a body that has not resolved yet -- the tail-drop", async () => {
    const page = fakePage();
    const cap = createChatCapture(page);

    const releaseTurn = page.emit("chat_turn", { ok: true });
    const releasePoll = page.emit("chat_poll", { frames: ["the tail"] });
    await tick();

    // THE BUG, reproduced: writing here -- which is what the spec used to do --
    // captures an empty file while two responses are mid-flight.
    expect(cap.payloads).toHaveLength(0);
    expect(cap.pending()).toBe(2);

    releaseTurn();
    releasePoll();
    const settled = await cap.settle();
    expect(settled.map((p) => p.op)).toEqual(["chat_turn", "chat_poll"]);
    expect(cap.pending()).toBe(0);
  });

  test("settle() also drains a response that lands while it is draining", async () => {
    const page = fakePage();
    const cap = createChatCapture(page);
    const releaseFirst = page.emit("chat_turn", { ok: true });

    let releaseLate;
    setTimeout(() => {
      releaseFirst();
      releaseLate = page.emit("chat_poll", { frames: ["late"] });
      setTimeout(() => releaseLate(), 10);
    }, 10);

    const settled = await cap.settle(2000);
    expect(settled.map((p) => p.op)).toEqual(["chat_turn", "chat_poll"]);
  });

  test("a settle timeout says the capture is incomplete instead of pretending", async () => {
    const page = fakePage();
    const cap = createChatCapture(page);
    page.emit("chat_turn", { ok: true }); // never released
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const settled = await cap.settle(60);
    expect(settled).toHaveLength(0);
    expect(warn.mock.calls.join(" ")).toMatch(/INCOMPLETE/);
    warn.mockRestore();
  });

  test("ignores non-chat operations and non-execute URLs", async () => {
    const page = fakePage();
    const cap = createChatCapture(page);
    page.emit("health_check", { ok: true })();
    page.emit("chat_turn", { ok: true }, { url: "https://box/api/3/alerts" })();
    await cap.settle(200);
    expect(cap.payloads).toEqual([]);
  });

  test("a non-JSON body is recorded as such, not dropped", async () => {
    const page = fakePage();
    const cap = createChatCapture(page);
    page.emit("chat_poll", null)();
    await cap.settle();
    expect(cap.payloads[0].response).toBeNull();

    // A body that rejects -- an HTML error page from the box. The frame must
    // still appear, or "the connector answered garbage" and "the connector
    // never answered" become the same capture.
    const bad = {
      url: () => "https://box/api/integration/execute/",
      request: () => ({ postDataJSON: () => ({ operation: "chat_poll" }) }),
      json: async () => { throw new Error("Unexpected token <"); },
    };
    const capBad = createChatCapture({ on: (_evt, fn) => fn(bad) });
    await capBad.settle();
    expect(capBad.payloads).toEqual([
      { op: "chat_poll", params: null, response: { _nonJson: true } },
    ]);
  });
});
