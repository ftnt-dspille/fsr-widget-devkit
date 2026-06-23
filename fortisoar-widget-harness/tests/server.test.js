"use strict";

// Set stub env vars before loading server so it doesn't call process.exit(1).
process.env.FSR_BASE_URL = "https://soar.test.invalid";
process.env.FSR_USERNAME = "admin";
process.env.FSR_PASSWORD = "testpass";

const request = require("supertest");
const { app, isLocalPath, discoverWidgets, decodeJwtExpiryMs, widgetIsPublished } = require("../server");

// ---------------------------------------------------------------------------
// isLocalPath
// ---------------------------------------------------------------------------
describe("isLocalPath", () => {
  test.each(["/", "/index.html", "/harness.module.js", "/lib/harnessUtils.js", "/_fsr/widgets", "/_fsr/package/foo/info"])(
    "returns true for local path %s",
    (p) => expect(isLocalPath(p)).toBe(true)
  );

  test.each(["/api/v1/alerts", "/api/3/incidents/123", "/node_modules/foo"])(
    "returns false for proxy path %s",
    (p) => expect(isLocalPath(p)).toBe(false)
  );

  test("returns true for discovered widget asset paths", () => {
    const widgets = discoverWidgets();
    if (widgets.length === 0) return;
    const w = widgets[0];
    expect(isLocalPath(`/${w.id}/view.html`)).toBe(true);
    expect(isLocalPath(`/${w.id}/view.controller.js`)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// decodeJwtExpiryMs
// ---------------------------------------------------------------------------
describe("decodeJwtExpiryMs", () => {
  function makeToken(payload) {
    const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
    return `header.${encoded}.signature`;
  }

  test("extracts exp claim as milliseconds", () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = makeToken({ sub: "user", exp });
    expect(decodeJwtExpiryMs(token)).toBe(exp * 1000);
  });

  test("returns null when exp is missing", () => {
    const token = makeToken({ sub: "user" });
    expect(decodeJwtExpiryMs(token)).toBeNull();
  });

  test("returns null for malformed token", () => {
    expect(decodeJwtExpiryMs("notavalidtoken")).toBeNull();
    expect(decodeJwtExpiryMs("a.b")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// widgetIsPublished — the publish-response validation gate. A 2xx PUT is not
// proof of publish; only `draft === false` is. This is why a draft:true PUT
// "succeeded" yet forced a manual publish in the UI.
// ---------------------------------------------------------------------------
describe("widgetIsPublished", () => {
  test("draft:false → published (true)", () => {
    expect(widgetIsPublished(JSON.stringify({ name: "w", draft: false }))).toBe(true);
  });

  test("draft:true → still a draft (false), even with a 2xx body", () => {
    expect(widgetIsPublished(JSON.stringify({ name: "w", draft: true }))).toBe(false);
  });

  test("draft field absent → inconclusive (null)", () => {
    expect(widgetIsPublished(JSON.stringify({ name: "w", installed: true }))).toBeNull();
  });

  test("unparseable body → inconclusive (null)", () => {
    expect(widgetIsPublished("<html>502 Bad Gateway</html>")).toBeNull();
    expect(widgetIsPublished("")).toBeNull();
  });

  test("truthy non-boolean draft is not treated as published", () => {
    // only an explicit boolean false counts as published
    expect(widgetIsPublished(JSON.stringify({ draft: "false" }))).toBeNull();
    expect(widgetIsPublished(JSON.stringify({ draft: 0 }))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// discoverWidgets
// ---------------------------------------------------------------------------
describe("discoverWidgets", () => {
  test("returns an array", () => {
    const widgets = discoverWidgets();
    expect(Array.isArray(widgets)).toBe(true);
  });

  test("each widget has required fields", () => {
    const widgets = discoverWidgets();
    for (const w of widgets) {
      expect(typeof w.id).toBe("string");
      expect(typeof w.name).toBe("string");
      expect(typeof w.version).toBe("string");
      expect(typeof w.dir).toBe("string");
      expect(Array.isArray(w.pages)).toBe(true);
    }
  });

  test("discovers helloCounter", () => {
    const widgets = discoverWidgets();
    const jinja = widgets.find((w) => w.name === "helloCounter");
    expect(jinja).toBeDefined();
    expect(jinja.version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

// ---------------------------------------------------------------------------
// GET /_fsr/widgets
// ---------------------------------------------------------------------------
describe("GET /_fsr/widgets", () => {
  test("returns 200 with widgets array", async () => {
    const res = await request(app).get("/_fsr/widgets");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.widgets)).toBe(true);
  });

  test("includes helloCounter in widget list", async () => {
    const res = await request(app).get("/_fsr/widgets");
    const names = res.body.widgets.map((w) => w.name);
    expect(names).toContain("helloCounter");
  });

  test("widget entries have expected shape", async () => {
    const res = await request(app).get("/_fsr/widgets");
    for (const w of res.body.widgets) {
      expect(typeof w.id).toBe("string");
      expect(typeof w.name).toBe("string");
      expect(typeof w.version).toBe("string");
      expect(typeof w.title).toBe("string");
      expect(Array.isArray(w.pages)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// GET /_fsr/package/:id/info
// ---------------------------------------------------------------------------
describe("GET /_fsr/package/:id/info", () => {
  let widgetId;

  beforeAll(() => {
    const widgets = discoverWidgets();
    const jinja = widgets.find((w) => w.name === "helloCounter");
    widgetId = jinja && jinja.id;
  });

  test("returns name and version for a known widget", async () => {
    if (!widgetId) return;
    const res = await request(app).get(`/_fsr/package/${widgetId}/info`);
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("helloCounter");
    expect(typeof res.body.version).toBe("string");
  });

  test("returns 404 for unknown widget id", async () => {
    const res = await request(app).get("/_fsr/package/no-such-widget-9.9.9/info");
    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Static files — harness and widget assets
// ---------------------------------------------------------------------------
describe("Static file serving", () => {
  test("GET / serves the harness HTML page", async () => {
    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/html/);
  });

  test("GET /harness.module.js serves the harness module", async () => {
    const res = await request(app).get("/harness.module.js");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/javascript/);
    expect(res.text).toContain("cybersponse");
  });

  test("GET /lib/harnessUtils.js serves the browser-side utilities", async () => {
    const res = await request(app).get("/lib/harnessUtils.js");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/javascript/);
    expect(res.text).toContain("HarnessUtils");
  });

  test("GET /<widget-id>/view.html serves the widget view template", async () => {
    const widgets = discoverWidgets();
    const jinja = widgets.find((w) => w.name === "helloCounter");
    if (!jinja) return;
    const res = await request(app).get(`/${jinja.id}/view.html`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/html/);
    expect(res.text).toContain("helloCounter");
  });

  test("GET /<widget-id>/info.json serves the widget manifest", async () => {
    const widgets = discoverWidgets();
    const jinja = widgets.find((w) => w.name === "helloCounter");
    if (!jinja) return;
    const res = await request(app).get(`/${jinja.id}/info.json`);
    expect(res.status).toBe(200);
    const body = JSON.parse(res.text);
    expect(body.name).toBe("helloCounter");
  });

  test("GET /<widget-id>/nonexistent returns 404", async () => {
    const widgets = discoverWidgets();
    const jinja = widgets.find((w) => w.name === "helloCounter");
    if (!jinja) return;
    const res = await request(app).get(`/${jinja.id}/does-not-exist.js`);
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// POST /_fsr/package/:id — version validation (no real packaging)
// ---------------------------------------------------------------------------
describe("POST /_fsr/package/:id — input validation", () => {
  let widgetId;

  beforeAll(() => {
    const widgets = discoverWidgets();
    const jinja = widgets.find((w) => w.name === "helloCounter");
    widgetId = jinja && jinja.id;
  });

  test("returns 404 for unknown widget", async () => {
    const res = await request(app)
      .post("/_fsr/package/no-such-widget-9.9.9")
      .send({ bump: "patch" });
    expect(res.status).toBe(404);
  });

  test("returns 400 for invalid bump value", async () => {
    if (!widgetId) return;
    const res = await request(app)
      .post(`/_fsr/package/${widgetId}`)
      .send({ bump: "nano" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid bump/);
  });

  test("returns 400 for invalid version string", async () => {
    if (!widgetId) return;
    const res = await request(app)
      .post(`/_fsr/package/${widgetId}`)
      .send({ version: "not-semver" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid version/);
  });
});
