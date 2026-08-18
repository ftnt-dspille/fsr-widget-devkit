// Standalone SOAR client for live connector-integration tests.
//
// Deliberately does NOT depend on the running harness proxy -- it authenticates
// to FSR_BASE_URL directly with .env creds so the live suite is portable to
// CI. Mirrors the wire the widget uses: POST /api/integration/execute/ with
// {connector, version, config, operation, params}; the connector's response
// envelope is returned under `.data`.
//
// Usage:
//   const { makeClient } = require("./lib/soarClient");
//   const soar = await makeClient();              // authenticates, resolves connector + default config
//   const health = await soar.exec("health_check", {});
"use strict";

const https = require("https");
const { URL } = require("url");

// Connector identity is DERIVED from the widget's own service (single source of
// truth) -- never hardcode a second copy here; that is what drifted after the
// fsr-playbook-builder → connector-fsr-soc-assistant rename.
const _identity = require("./connectorIdentity");
const CONNECTOR_NAME = _identity.name;
// SOAR's connector search tokenizes oddly: the full hyphenated name matches 0
// rows, but a bare token matches. Search by the unique token, then filter by
// exact name client-side.
const CONNECTOR_SEARCH = _identity.search;

// One TLS-relaxed agent: SOAR dev appliances ship self-signed certs (same
// allowance the harness proxy and verify-remote already make).
const agent = new https.Agent({ rejectUnauthorized: false, keepAlive: true });

function env(name) {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name} (set it in .env for live tests)`);
  return v;
}

// Low-level JSON request with a bounded timeout. Returns {status, json, text}.
function request(method, urlStr, { token, body, timeoutMs = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const payload = body == null ? null : (typeof body === "string" ? body : JSON.stringify(body));
    const headers = { Accept: "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (payload != null) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(payload);
    }
    const req = https.request(
      { method, hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, headers, agent },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          let json = null;
          try { json = JSON.parse(data); } catch (_) { /* non-JSON */ }
          resolve({ status: res.statusCode, json, text: data });
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`request timeout after ${timeoutMs}ms: ${method} ${u.pathname}`)));
    if (payload != null) req.write(payload);
    req.end();
  });
}

// Retry wrapper for transient failures (network blips, SOAR 5xx). CI-shaped:
// bounded attempts, linear backoff. Does NOT retry 4xx (those are real bugs).
async function withRetry(fn, { attempts = 3, label = "op" } = {}) {
  let last;
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fn();
      if (res && typeof res.status === "number" && res.status >= 500 && i < attempts) {
        last = new Error(`${label}: HTTP ${res.status} (attempt ${i}/${attempts})`);
      } else {
        return res;
      }
    } catch (e) {
      last = e;
      if (e && e.retryable === false) throw e; // real client error -- fail fast
      if (i >= attempts) break;
    }
    await new Promise((r) => setTimeout(r, 1000 * i));
  }
  throw last || new Error(`${label}: exhausted ${attempts} attempts`);
}

async function makeClient() {
  const { resolveSoarEnv } = require("../../../lib/soarEnv");
  const soar = resolveSoarEnv();
  if (!soar.host) throw new Error("missing FSR_BASE_URL (set it in .env for live tests)");
  if (!soar.user || !soar.pass) throw new Error("missing FSR_USERNAME/FSR_PASSWORD (set them in .env for live tests)");
  const host = soar.host.replace(/\/+$/, "");
  const user = soar.user;
  const pass = soar.pass;

  // ── authenticate ─────────────────────────────────────────────────────
  const auth = await withRetry(
    () => request("POST", `${host}/auth/authenticate`, { body: { credentials: { loginid: user, password: pass } } }),
    { label: "authenticate" }
  );
  if (auth.status < 200 || auth.status >= 300 || !auth.json || !auth.json.token) {
    throw new Error(`authenticate failed: HTTP ${auth.status} ${auth.text.slice(0, 200)}`);
  }
  const token = auth.json.token;

  // ── resolve connector + default config (never hardcode the config id) ──
  // The connector is redeployed frequently on this demo SOAR; during a reinstall
  // window it briefly de-registers (search returns 0 rows). Treat "not yet
  // present / no config" as retryable so the suite waits out the deploy window
  // instead of failing the whole run.
  const rec = await withRetry(
    async () => {
      const search = await request("GET", `${host}/api/integration/connectors/?search=${encodeURIComponent(CONNECTOR_SEARCH)}`, { token });
      const found = search.json && search.json.data && search.json.data.find((c) => c.name === CONNECTOR_NAME);
      if (!found || !(found.configuration || []).length) {
        const e = new Error(`connector ${CONNECTOR_NAME} not present/configured (likely mid-deploy)`); e.retryable = true; throw e;
      }
      return found;
    },
    { label: "resolve-connector", attempts: 8 }
  );
  const configs = rec.configuration || [];
  const chosen = configs.find((c) => c.default) || configs[0];

  const meta = { host, connector: CONNECTOR_NAME, version: rec.version, configId: chosen.config_id, configName: chosen.name, agent: rec.agent };

  // ── exec: call a connector operation, return the connector's payload ───
  // Throws on transport/SOAR error. Returns the `.data` envelope verbatim so
  // callers assert on the connector's own contract shape.
  async function exec(operation, params = {}, { timeoutMs = 120000 } = {}) {
    // The connector on this demo SOAR is redeployed frequently; during a deploy
    // window an op can briefly return HTTP 5xx, an empty body, or a Success
    // envelope with null `data`. All three are transient -- retry them so the
    // suite is repeatable against a churning connector. A 4xx (bad params) is a
    // real bug and is NOT retried.
    return withRetry(
      async () => {
        const res = await request("POST", `${host}/api/integration/execute/?format=json`, {
          token,
          timeoutMs,
          body: { connector: CONNECTOR_NAME, version: meta.version, config: meta.configId, operation, params },
        });
        if (res.status >= 400 && res.status < 500) {
          { const e = new Error(`exec ${operation}: HTTP ${res.status} ${res.text.slice(0, 300)}`); e.retryable = false; throw e; } // real client error, no retry
        }
        if (res.status < 200 || res.status >= 300) {
          const e = new Error(`exec ${operation}: HTTP ${res.status}`); e.retryable = true; throw e;
        }
        if (res.json && res.json.status && res.json.status !== "Success") {
          throw new Error(`exec ${operation}: connector status=${res.json.status} message=${res.json.message || ""}`);
        }
        const data = res.json ? res.json.data : null;
        if (data == null) { const e = new Error(`exec ${operation}: empty data (connector likely mid-deploy)`); e.retryable = true; throw e; }
        return data;
      },
      { label: `exec:${operation}`, attempts: 5 }
    );
  }

  // Generic platform GET/DELETE for side-effect verification (e.g. confirm a
  // pushed workflow exists, then clean it up).
  async function get(pathAndQuery) {
    const res = await withRetry(() => request("GET", `${host}${pathAndQuery}`, { token }), { label: `get ${pathAndQuery}` });
    return res.json;
  }
  async function del(pathAndQuery) {
    const res = await request("DELETE", `${host}${pathAndQuery}`, { token });
    return { status: res.status, json: res.json };
  }

  // Is a THIRD-PARTY connector present AND configured on this box?
  //
  // Some live scenarios need a capability the widget does not provide: you
  // cannot grade "containment surfaces an action card" on a box with no
  // firewall connector, because the agent's correct behaviour there is to ask
  // for the missing config rather than invent a card. Absence of the
  // integration is an ENVIRONMENT gap, not a widget regression, and the sweep
  // previously had no way to tell those apart -- so an unconfigured FortiGate
  // was reported as "[[SWEEP-FAIL]] ... widget regression".
  //
  // Three-valued ON PURPOSE. `null` means "could not determine", and callers
  // must treat that as PROCEED, never as skip: a probe that fails open into a
  // skip would silently disarm the very assertion it guards, which is the
  // no-silent-caps rule. Only a definite "absent" earns a skip.
  // Accepts ONE name or a list of equivalent ones. The list matters: the
  // capability a row needs ("some firewall that can block an IP") is not the
  // same thing as one vendor's package name, and the package name is not
  // guessable -- this box installs the FortiGate connector as
  // `fortigate-firewall`, so probing the obvious `fortigate` matched nothing
  // and ENV-SKIPped a containment row the box could in fact have graded. A
  // FALSE skip is the worse direction of this bug: the run stays green-ish
  // while quietly covering less.
  async function connectorConfigured(nameOrNames) {
    const names = Array.isArray(nameOrNames) ? nameOrNames : [nameOrNames];
    let res;
    try {
      // No `search=` filter: fetch the installed set once and decide locally.
      // Server-side search is a substring match whose paging could drop the row
      // we care about, and one list is cheaper than N searches anyway.
      res = await request("GET",
        `${host}/api/integration/connectors/?$limit=300`, { token });
    } catch (_) {
      return null;                       // transport failure -- indeterminate
    }
    return combineConfigured(names.map(
      (n) => classifyConnectorConfigured(res.json, n)));
  }

  return { meta, exec, get, del, token, connectorConfigured };
}

// Fold the per-name verdicts of an EQUIVALENCE set into one, preserving the
// three-valued contract: any definite yes wins (the capability exists); with no
// yes, a single indeterminate makes the whole answer indeterminate, because
// "everything I could check says no, and one I could not check" is not evidence
// of absence -- and only definite absence is allowed to skip a live gate.
function combineConfigured(verdicts) {
  if (verdicts.some((v) => v === true)) return true;
  if (verdicts.some((v) => v === null)) return null;
  return false;
}

// The DECISION half of connectorConfigured(), split out so it is testable
// without a box. Pure: search-response JSON in, three-valued verdict out.
//   true  -- present with >=1 configuration (an action can actually run)
//   false -- definitely absent, or present with zero configurations
//   null  -- indeterminate (no/!malformed payload); callers must PROCEED on
//            null, never skip, so a broken probe cannot disarm a live gate.
function classifyConnectorConfigured(json, name) {
  if (!json || !Array.isArray(json.data)) return null;
  const found = json.data.find((c) => c && c.name === name);
  // Present but unconfigured counts as absent: the connector is installed, yet
  // nothing on this box can actually execute one of its actions.
  return !!(found && (found.configuration || []).length);
}

// The connectors that can satisfy "block an IP on a firewall". Names are the
// INSTALLED package names, which differ from the vendor word: FortiGate ships
// as `fortigate-firewall`. Add rather than replace when another box carries a
// different firewall.
const FIREWALL_CONNECTORS = ["fortigate-firewall", "fortigate"];

module.exports = {
  makeClient,
  CONNECTOR_NAME,
  FIREWALL_CONNECTORS,
  classifyConnectorConfigured,
  combineConfigured,
};
