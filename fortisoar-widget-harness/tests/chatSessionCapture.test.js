// `session.saveCapture()` -- the recorder promoted out of one live spec into
// the session handle every live spec and matrix row already holds (Phase 2.1).
//
// Nothing during a live run asserts on the capture: it is the artifact the
// fixture audit is diffed AGAINST. That makes it the same hazard as the
// tail-drop it descends from -- a capture that recorded nothing, or that wrote
// before the last turn's bodies resolved, looks exactly like a clean one. So
// the two claims worth pinning are: it drains before writing, and it never
// reports a path for a file it did not write.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { makeChatSession } = require("../lib/chatSession");

function stubArgs(capture) {
  return {
    page: { on() {} },
    browser: { close: async () => {} },
    context: {},
    base: "https://box",
    feed: { polls: [], turns: [] },
    composerOpen: true,
    closesBrowser: () => false,
    capture,
  };
}

// The recorder's contract, as chatCapture.js implements it: settle() drains
// in-flight bodies and only then returns the payloads.
function fakeCapture() {
  const payloads = [{ op: "chat_turn", params: null, response: { ok: true } }];
  let settled = false;
  return {
    payloads,
    pending: () => (settled ? 0 : 1),
    async settle() {
      // The tail lands DURING settle -- exactly the frames a write-first
      // implementation would lose.
      payloads.push({ op: "chat_poll", params: null, response: { done: true } });
      settled = true;
      return payloads;
    },
    wasSettled: () => settled,
  };
}

describe("chatSession.saveCapture", () => {
  const outDir = path.join(__dirname, "..", "test-results", "live");
  const written = [];
  afterAll(() => {
    written.forEach((f) => { try { fs.unlinkSync(f); } catch (_) { /* gone */ } });
  });

  test("returns null when nothing was recording", async () => {
    const s = makeChatSession(stubArgs(null));
    await expect(s.saveCapture("no-recorder")).resolves.toBeNull();
  });

  test("drains in-flight bodies BEFORE writing, so the tail is in the file", async () => {
    const cap = fakeCapture();
    const s = makeChatSession(stubArgs(cap));
    const file = await s.saveCapture("unit-tail");
    written.push(file);

    expect(cap.wasSettled()).toBe(true);
    const onDisk = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(onDisk.map((p) => p.op)).toEqual(["chat_turn", "chat_poll"]);
  });

  test("the label names the file and cannot escape the capture dir", async () => {
    const s = makeChatSession(stubArgs(fakeCapture()));
    const file = await s.saveCapture("../../etc/pass wd");
    written.push(file);
    expect(path.dirname(path.resolve(file))).toBe(path.resolve(outDir));
    // Separators and spaces are flattened; dots survive but cannot traverse
    // because the basename is joined onto the capture dir.
    expect(path.basename(file)).toBe("..-..-etc-pass-wd.payloads.json");
  });

  test("writes under test-results/live with a .payloads.json suffix", async () => {
    const s = makeChatSession(stubArgs(fakeCapture()));
    const file = await s.saveCapture("approval_resume");
    written.push(file);
    expect(path.resolve(file)).toBe(path.resolve(outDir, "approval_resume.payloads.json"));
    expect(fs.existsSync(file)).toBe(true);
  });

  test("a temp-dir HOME cannot redirect the write (path is module-relative)", async () => {
    const prev = process.env.HOME;
    process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), "cap-"));
    try {
      const s = makeChatSession(stubArgs(fakeCapture()));
      const file = await s.saveCapture("home-independent");
      written.push(file);
      expect(path.resolve(file)).toBe(path.resolve(outDir, "home-independent.payloads.json"));
    } finally {
      process.env.HOME = prev;
    }
  });
});
