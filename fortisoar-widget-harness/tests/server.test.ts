"use strict";

// Set stub env vars before loading server so it doesn't call process.exit(1).
process.env.FSR_BASE_URL = "https://soar.test.invalid";
process.env.FSR_USERNAME = "admin";
process.env.FSR_PASSWORD = "testpass";

import request from "supertest";
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- server exports are dynamic
const { app, isLocalPath, discoverWidgets, decodeJwtExpiryMs } = require("../server") as any;

interface JwtPayload {
  sub?: string;
  exp?: number;
  [key: string]: unknown;
}

interface WidgetInfo {
  id: string;
  name: string;
  version: string;
  dir: string;
  pages: string[];
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// isLocalPath
// ---------------------------------------------------------------------------
describe("isLocalPath", () => {
  test.each(["/", "/index.html", "/harness.module.js", "/lib/harnessUtils.js", "/_fsr/widgets", "/_fsr/package/foo/info"])(
    "returns true for local path %s",
    (p: string) => expect(isLocalPath(p)).toBe(true)
  );

  test.each(["/api/v1/alerts", "/api/3/incidents/123", "/node_modules/foo"])(
    "returns false for proxy path %s",
    (p: string) => expect(isLocalPath(p)).toBe(false)
  );

  test("returns true for discovered widget asset paths", () => {
    const widgets: WidgetInfo[] = discoverWidgets();
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
  function makeToken(payload: JwtPayload): string {
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
// discoverWidgets
// ---------------------------------------------------------------------------
describe("discoverWidgets", () => {
  test("returns an array", () => {
    const widgets: WidgetInfo[] = discoverWidgets();
    expect(Array.isArray(widgets)).toBe(true);
  });

  test("each widget has required fields", () => {
    const widgets: WidgetInfo[] = discoverWidgets();
    for (const w of widgets) {
      expect(typeof w.id).toBe("string");
      expect(typeof w.name).toBe("string");
      expect(typeof w.version).toBe("string");
      expect(typeof w.dir).toBe("string");
      expect(Array.isArray(w.pages)).toBe(true);
    }
  });

  test("discovers helloCounter", () => {
    const widgets: WidgetInfo[] = discoverWidgets();
    const jinja = widgets.find((w: WidgetInfo) => w.name === "helloCounter");
    expect(jinja).toBeDefined();
    expect(jinja?.version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

// ---------------------------------------------------------------------------
// GET /_fsr/widgets
// ---------------------------------------------------------------------------
describe("GET /_fsr/widgets", () => {
  test("returns 200 with widgets array", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- response body is dynamic
    const res = await request(app).get("/_fsr/widgets") as any;
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.widgets)).toBe(true);
  });

  test("includes helloCounter in widget list", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- response body is dynamic
    const res = await request(app).get("/_fsr/widgets") as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- widget items are dynamic
    const names = res.body.widgets.map((w: any) => w.name);
    expect(names).toContain("helloCounter");
  });

  test("widget entries have expected shape", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- response body is dynamic
    const res = await request(app).get("/_fsr/widgets") as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- widget items are dynamic
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
  let widgetId: string | undefined;

  beforeAll(() => {
    const widgets: WidgetInfo[] = discoverWidgets();
    const jinja = widgets.find((w: WidgetInfo) => w.name === "helloCounter");
    widgetId = jinja?.id;
  });

  test("returns name and version for a known widget", async () => {
    if (!widgetId) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- response body is dynamic
    const res = await request(app).get(`/_fsr/package/${widgetId}/info`) as any;
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("helloCounter");
    expect(typeof res.body.version).toBe("string");
  });

  test("returns 404 for unknown widget id", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- response body is dynamic
    const res = await request(app).get("/_fsr/package/no-such-widget-9.9.9/info") as any;
    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Static files — harness and widget assets
// ---------------------------------------------------------------------------
describe("Static file serving", () => {
  test("GET / serves the harness HTML page", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- response is dynamic
    const res = await request(app).get("/") as any;
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/html/);
  });

  test("GET /harness.module.js serves the harness module", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- response is dynamic
    const res = await request(app).get("/harness.module.js") as any;
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/javascript/);
    expect(res.text).toContain("cybersponse");
  });

  test("GET /lib/harnessUtils.js serves the browser-side utilities", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- response is dynamic
    const res = await request(app).get("/lib/harnessUtils.js") as any;
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/javascript/);
    expect(res.text).toContain("HarnessUtils");
  });

  test("GET /<widget-id>/view.html serves the widget view template", async () => {
    const widgets: WidgetInfo[] = discoverWidgets();
    const jinja = widgets.find((w: WidgetInfo) => w.name === "helloCounter");
    if (!jinja) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- response is dynamic
    const res = await request(app).get(`/${jinja.id}/view.html`) as any;
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/html/);
    expect(res.text).toContain("helloCounter");
  });

  test("GET /<widget-id>/info.json serves the widget manifest", async () => {
    const widgets: WidgetInfo[] = discoverWidgets();
    const jinja = widgets.find((w: WidgetInfo) => w.name === "helloCounter");
    if (!jinja) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- response is dynamic
    const res = await request(app).get(`/${jinja.id}/info.json`) as any;
    expect(res.status).toBe(200);
    const body = JSON.parse(res.text);
    expect(body.name).toBe("helloCounter");
  });

  test("GET /<widget-id>/nonexistent returns 404", async () => {
    const widgets: WidgetInfo[] = discoverWidgets();
    const jinja = widgets.find((w: WidgetInfo) => w.name === "helloCounter");
    if (!jinja) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- response is dynamic
    const res = await request(app).get(`/${jinja.id}/does-not-exist.js`) as any;
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// POST /_fsr/package/:id — version validation (no real packaging)
// ---------------------------------------------------------------------------
describe("POST /_fsr/package/:id — input validation", () => {
  let widgetId: string | undefined;

  beforeAll(() => {
    const widgets: WidgetInfo[] = discoverWidgets();
    const jinja = widgets.find((w: WidgetInfo) => w.name === "helloCounter");
    widgetId = jinja?.id;
  });

  test("returns 404 for unknown widget", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- response is dynamic
    const res = await request(app)
      .post("/_fsr/package/no-such-widget-9.9.9")
      .send({ bump: "patch" }) as any;
    expect(res.status).toBe(404);
  });

  test("returns 400 for invalid bump value", async () => {
    if (!widgetId) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- response is dynamic
    const res = await request(app)
      .post(`/_fsr/package/${widgetId}`)
      .send({ bump: "nano" }) as any;
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid bump/);
  });

  test("returns 400 for invalid version string", async () => {
    if (!widgetId) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- response is dynamic
    const res = await request(app)
      .post(`/_fsr/package/${widgetId}`)
      .send({ version: "not-semver" }) as any;
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid version/);
  });
});
