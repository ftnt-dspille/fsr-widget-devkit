"use strict";

// NS1 default hermetic fixture layer (AGENT_NORTHSTAR.md roadmap #1).
// Verifies the harness serves a believable record + connector list in hermetic
// mode so record-context widgets mount without a box and without per-spec
// stubbing — while genuinely-novel platform calls still surface as a loud
// HERMETIC-MISS (599). Loaded in its OWN file so FSR_HERMETIC=1 is set before
// server.ts reads it at module load (jest isolates module registries per file).

process.env.FSR_HERMETIC = "1";
process.env.FSR_BASE_URL = "https://soar.test.invalid";
process.env.FSR_USERNAME = "admin";
process.env.FSR_PASSWORD = "testpass";

import request from "supertest";
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- server exports are dynamic
const { app, discoverWidgets } = require("../server") as any;

interface WidgetInfo { id: string; name: string; dir: string; [k: string]: unknown }

function findWidget(pred: (w: WidgetInfo) => boolean): WidgetInfo | undefined {
  return (discoverWidgets() as WidgetInfo[]).find(pred);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- supertest body is dynamic
const get = (p: string) => request(app).get(p) as any;

describe("NS1 default record fixture — /api/3/<module>/<id>", () => {
  beforeEach(async () => {
    // Reset the active-widget pointer so each case starts from the scaffold.
    await request(app).post("/_fsr/active-widget").send({ id: null });
  });

  test("serves a believable scaffold for an un-fixtured record-context module", async () => {
    const res = await get("/api/3/alerts/db7afbf7-56c8-4706-87b9-9a8ce2332d05?$relationships=true");
    expect(res.status).toBe(200);
    expect(res.body["@type"]).toBe("Alert");
    expect(res.body.uuid).toBe("db7afbf7-56c8-4706-87b9-9a8ce2332d05");
    expect(res.body["@id"]).toBe("/api/3/alerts/db7afbf7-56c8-4706-87b9-9a8ce2332d05");
    // The handful of fields a generic widget reads on mount.
    expect(typeof res.body.name).toBe("string");
    expect(Array.isArray(res.body.recordTags)).toBe(true);
  });

  test("derives a singular @type from a plural module head", async () => {
    const res = await get("/api/3/incidents/abc-123");
    expect(res.status).toBe(200);
    expect(res.body["@type"]).toBe("Incident");
  });

  test("a reserved platform head still surfaces as a loud HERMETIC-MISS (599)", async () => {
    // model_metadatas is a real platform call we must NOT mask as a record.
    const res = await get("/api/3/model_metadatas/abc");
    expect(res.status).toBe(599);
    expect(res.text).toMatch(/HERMETIC-MISS/);
  });

  test("resolves the active widget's record.json fixture when present", async () => {
    const ar = findWidget((w) => /action/i.test(w.id));
    if (!ar) return; // action-renderer not in this checkout
    await request(app).post("/_fsr/active-widget").send({ id: ar.id });
    const res = await get("/api/3/alerts/db7afbf7-56c8-4706-87b9-9a8ce2332d05");
    expect(res.status).toBe(200);
    // The seeded fixture carries the real dev alert's name + Critical severity,
    // not the synthesised scaffold name.
    expect(res.body.name).toBe(" Immediate Action Required: Password Reset Notice ");
    expect(res.body.severity?.itemValue).toBe("Critical");
  });
});

describe("NS1 default connector list — /api/integration/connectors/", () => {
  beforeEach(async () => {
    await request(app).post("/_fsr/active-widget").send({ id: null });
  });

  test("serves an empty-but-valid (non-hydra) envelope by default", async () => {
    const res = await get("/api/integration/connectors/?$search=anything");
    expect(res.status).toBe(200);
    // Real SOAR shape is {status,totalItems,…,data:[]}, NOT hydra:member.
    expect(res.body.status).toBe("success");
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data).toHaveLength(0);
  });

  test("resolves the active widget's connectors.json fixture when present", async () => {
    const ar = findWidget((w) => /action/i.test(w.id));
    if (!ar) return;
    await request(app).post("/_fsr/active-widget").send({ id: ar.id });
    const res = await get("/api/integration/connectors/?$search=x");
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data.map((c: { name: string }) => c.name)).toEqual(
      expect.arrayContaining(["imap", "smtp", "phishing-classifier"])
    );
  });
});
