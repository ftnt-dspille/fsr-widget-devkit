"use strict";
// make local-chat's sidecar: a fixture bundle serves the harness's reads (/world), and the
// model choice (fake | frank | auto) says which one it used. Spawns the real sidecar in
// hermetic mode against a bundle shipped in the connector repo. No box, no model call.
const fs = require("fs");
const net = require("net");
const path = require("path");
const { spawn, execFileSync } = require("child_process");
const { localDataDir } = require("../scripts/localData");

const HARNESS = path.resolve(__dirname, "..");
const ROOT = path.resolve(HARNESS, "..");
const PY = path.join(localDataDir(".venv-localdev"), "bin", "python");
const CONN = execFileSync("bash", [path.join(ROOT, "scripts", "repo_paths.sh"), "conn"],
  { encoding: "utf8" }).trim();
const BUNDLE = "ka_c2_beacon";
const ALERT = "5c1e2a90-1b7d-4c55-9a3e-7d0c2b1a4e01";
const haveEnv = fs.existsSync(PY) && fs.existsSync(path.join(CONN, "scripts", "eval_fixtures", "ztpf", `${BUNDLE}.json`));
const d = haveEnv ? describe : describe.skip; // not run: needs .venv-localdev and the connector checkout

const freePort = () => new Promise((res) => {
  const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); });
});

async function boot(env) {
  const port = await freePort();
  const child = spawn(PY, [path.join(HARNESS, "scripts", "local-connector-sidecar.py")], {
    env: { ...process.env, CONN_REPO: CONN, FSRPB_DEV: "1", FSRPB_SIDECAR_HERMETIC: "1",
      FSRPB_SIDECAR_PORT: String(port), FSRPB_SIDECAR_BUNDLE: BUNDLE, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = ""; child.stdout.on("data", (b) => { log += b; }); child.stderr.on("data", (b) => { log += b; });
  const exited = new Promise((r) => child.on("exit", (code) => r(code)));
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 120; i++) {
    const code = await Promise.race([exited, new Promise((r) => setTimeout(() => r(null), 500))]);
    if (code !== null) return { code, log, stop() {} };
    try { const r = await fetch(`${base}/health`); if (r.ok) return { base, health: await r.json(), log, stop: () => child.kill() }; } catch (_) { /* not up yet */ }
  }
  child.kill();
  throw new Error(`sidecar did not start:\n${log}`);
}

d("local-chat sidecar", () => {
  jest.setTimeout(90000);

  test("fake: reports its model and serves the bundle's record to the harness", async () => {
    const s = await boot({ FSRPB_SIDECAR_LLM: "fake" });
    try {
      expect(s.health.llm).toMatchObject({ kind: "fake", reason: "requested" });
      expect(s.health.bundle).toBe(BUNDLE);
      const w = async (url) => (await fetch(`${s.base}/world?url=${encodeURIComponent(url)}`)).json();
      const rec = await w(`/api/3/alerts/${ALERT}`);
      expect(rec.status).toBe(200);
      expect(rec.body.uuid).toBe(ALERT);
      // a record the bundle does not hold is a miss, not an invented scaffold
      expect((await w("/api/3/alerts/00000000-0000-0000-0000-000000000000")).status).toBe(404);
      // the widget's own connector identity comes from the connector's info.json
      const c = await w("/api/integration/connectors/?search=assistant");
      expect(c.body.data[0].name).toBe("connector-fsr-agentic-assistant");
      expect(c.body.data[0].configuration[0].default).toBe(true);
    } finally { s.stop(); }
  });

  test("auto: Frank down falls back to the fake and says why", async () => {
    const s = await boot({ FSRPB_SIDECAR_LLM: "auto", FSRPB_SIDECAR_FRANK_URL: "http://127.0.0.1:9/v1",
      FRANK_API_KEY: "sk-test-not-real" });
    try {
      expect(s.health.llm.kind).toBe("fake");
      expect(s.health.llm.reason).toMatch(/Frank not usable, fell back/);
    } finally { s.stop(); }
  });

  test("frank: asked for explicitly and down, it refuses instead of handing back the fake", async () => {
    const s = await boot({ FSRPB_SIDECAR_LLM: "frank", FSRPB_SIDECAR_FRANK_URL: "http://127.0.0.1:9/v1",
      FRANK_API_KEY: "sk-test-not-real" });
    try {
      expect(typeof s.code).toBe("number"); // it exited rather than serving
      expect(s.code).not.toBe(0);
      expect(s.log).toMatch(/Frank is not usable/);
    } finally { s.stop(); }
  });
});
