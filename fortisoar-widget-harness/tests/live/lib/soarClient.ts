// Standalone SOAR client for live connector-integration tests.
//
// Deliberately does NOT depend on the running harness proxy — it authenticates
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

import https = require("https");
import { URL } = require("url");
import identity = require("./connectorIdentity");

// Connector identity is DERIVED from the widget's own service (single source of
// truth) — never hardcode a second copy here; that is what drifted after the
// fsr-playbook-builder → connector-fsr-soc-assistant rename.
const CONNECTOR_NAME = identity.name;
// SOAR's connector search tokenizes oddly: the full hyphenated name matches 0
// rows, but a bare token matches. Search by the unique token, then filter by
// exact name client-side.
const CONNECTOR_SEARCH = identity.search;

// One TLS-relaxed agent: SOAR dev appliances ship self-signed certs (same
// allowance the harness proxy and verify-remote already make).
const agent = new https.Agent({ rejectUnauthorized: false, keepAlive: true });

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name} (set it in .env for live tests)`);
  return v;
}

interface RequestOptions {
  token?: string;
  body?: unknown;
  timeoutMs?: number;
}

interface RequestResult {
  status?: number;
  json?: unknown;
  text: string;
}

// Low-level JSON request with a bounded timeout. Returns {status, json, text}.
function request(
  method: string,
  urlStr: string,
  { token, body, timeoutMs = 120000 }: RequestOptions = {}
): Promise<RequestResult> {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const payload =
      body == null
        ? null
        : typeof body === "string"
          ? body
          : JSON.stringify(body);
    const headers: Record<string, string> = { Accept: "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (payload != null) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = String(Buffer.byteLength(payload));
    }
    const req = https.request(
      {
        method,
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        headers,
        agent,
      },
      (res) => {
        let data = "";
        res.on("data", (c: Buffer) => (data += c));
        res.on("end", () => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- json parse result is dynamic
          let json: any = null;
          try {
            json = JSON.parse(data);
          } catch (_) {
            /* non-JSON */
          }
          resolve({ status: res.statusCode, json, text: data });
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(timeoutMs, () =>
      req.destroy(
        new Error(
          `request timeout after ${timeoutMs}ms: ${method} ${u.pathname}`
        )
      )
    );
    if (payload != null) req.write(payload);
    req.end();
  });
}

interface RetryError extends Error {
  retryable?: boolean;
}

interface WithRetryOptions {
  attempts?: number;
  label?: string;
}

// Retry wrapper for transient failures (network blips, SOAR 5xx). CI-shaped:
// bounded attempts, linear backoff. Does NOT retry 4xx (those are real bugs).
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- fn result is dynamic
async function withRetry(fn: () => Promise<any>, { attempts = 3, label = "op" }: WithRetryOptions = {}): Promise<any> {
  let last: Error | undefined;
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fn();
      if (
        res &&
        typeof res.status === "number" &&
        res.status >= 500 &&
        i < attempts
      ) {
        last = new Error(
          `${label}: HTTP ${res.status} (attempt ${i}/${attempts})`
        );
      } else {
        return res;
      }
    } catch (e) {
      const err = e as RetryError;
      last = err;
      if (err && err.retryable === false) throw err; // real client error — fail fast
      if (i >= attempts) break;
    }
    await new Promise((r) => setTimeout(r, 1000 * i));
  }
  throw last || new Error(`${label}: exhausted ${attempts} attempts`);
}

interface ConnectorMeta {
  host: string;
  connector: string;
  version: string;
  configId: string;
  configName: string;
  agent: string;
}

interface SoarClient {
  meta: ConnectorMeta;
  exec: (operation: string, params?: Record<string, unknown>, opts?: {timeoutMs?: number}) => Promise<unknown>;
  get: (pathAndQuery: string) => Promise<unknown>;
  del: (pathAndQuery: string) => Promise<{status?: number; json?: unknown}>;
  token: string;
}

async function makeClient(): Promise<SoarClient> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- soarEnv exports are dynamic
  const { resolveSoarEnv } = require("../../../lib/soarEnv") as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- soar object is dynamic
  const soar = resolveSoarEnv() as any;
  if (!soar.host)
    throw new Error("missing FSR_BASE_URL (set it in .env for live tests)");
  if (!soar.user || !soar.pass)
    throw new Error(
      "missing FSR_USERNAME/FSR_PASSWORD (set them in .env for live tests)"
    );
  const host = soar.host.replace(/\/+$/, "");
  const user = soar.user;
  const pass = soar.pass;

  // ── authenticate ─────────────────────────────────────────────────────
  const auth = await withRetry(
    () =>
      request("POST", `${host}/auth/authenticate`, {
        body: { credentials: { loginid: user, password: pass } },
      }),
    { label: "authenticate" }
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- auth result is dynamic
  if (
    auth.status! < 200 ||
    auth.status! >= 300 ||
    !auth.json ||
    !(auth.json as any).token
  ) {
    throw new Error(
      `authenticate failed: HTTP ${auth.status} ${auth.text.slice(0, 200)}`
    );
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- auth result is dynamic
  const token = (auth.json as any).token as string;

  // ── resolve connector + default config (never hardcode the config id) ──
  // The connector is redeployed frequently on this demo SOAR; during a reinstall
  // window it briefly de-registers (search returns 0 rows). Treat "not yet
  // present / no config" as retryable so the suite waits out the deploy window
  // instead of failing the whole run.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- connector search result is dynamic
  const rec: any = await withRetry(
    async () => {
      const search = await request(
        "GET",
        `${host}/api/integration/connectors/?search=${encodeURIComponent(
          CONNECTOR_SEARCH
        )}`,
        { token }
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- search result is dynamic
      const found = (search.json as any)?.data?.find(
        (c: any) => c.name === CONNECTOR_NAME
      );
      if (!found || !(found.configuration || []).length) {
        const e = new Error(
          `connector ${CONNECTOR_NAME} not present/configured (likely mid-deploy)`
        ) as RetryError;
        e.retryable = true;
        throw e;
      }
      return found;
    },
    { label: "resolve-connector", attempts: 8 }
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- config list is dynamic
  const configs = rec.configuration || [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- config item is dynamic
  const chosen: any = configs.find((c: any) => c.default) || configs[0];

  const meta: ConnectorMeta = {
    host,
    connector: CONNECTOR_NAME,
    version: rec.version,
    configId: chosen.config_id,
    configName: chosen.name,
    agent: rec.agent,
  };

  // ── exec: call a connector operation, return the connector's payload ───
  // Throws on transport/SOAR error. Returns the `.data` envelope verbatim so
  // callers assert on the connector's own contract shape.
  async function exec(
    operation: string,
    params: Record<string, unknown> = {},
    { timeoutMs = 120000 }: { timeoutMs?: number } = {}
  ): Promise<unknown> {
    // The connector on this demo SOAR is redeployed frequently; during a deploy
    // window an op can briefly return HTTP 5xx, an empty body, or a Success
    // envelope with null `data`. All three are transient — retry them so the
    // suite is repeatable against a churning connector. A 4xx (bad params) is a
    // real bug and is NOT retried.
    return withRetry(
      async () => {
        const res = await request(
          "POST",
          `${host}/api/integration/execute/?format=json`,
          {
            token,
            timeoutMs,
            body: {
              connector: CONNECTOR_NAME,
              version: meta.version,
              config: meta.configId,
              operation,
              params,
            },
          }
        );
        if (res.status! >= 400 && res.status! < 500) {
          const e = new Error(
            `exec ${operation}: HTTP ${res.status} ${res.text.slice(0, 300)}`
          ) as RetryError;
          e.retryable = false;
          throw e; // real client error, no retry
        }
        if (res.status! < 200 || res.status! >= 300) {
          const e = new Error(`exec ${operation}: HTTP ${res.status}`) as RetryError;
          e.retryable = true;
          throw e;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- response is dynamic
        if ((res.json as any)?.status && (res.json as any).status !== "Success") {
          throw new Error(
            `exec ${operation}: connector status=${(res.json as any).status} message=${(res.json as any).message || ""}`
          );
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- response data is dynamic
        const data = (res.json as any)?.data || null;
        if (data == null) {
          const e = new Error(
            `exec ${operation}: empty data (connector likely mid-deploy)`
          ) as RetryError;
          e.retryable = true;
          throw e;
        }
        return data;
      },
      { label: `exec:${operation}`, attempts: 5 }
    );
  }

  // Generic platform GET/DELETE for side-effect verification (e.g. confirm a
  // pushed workflow exists, then clean it up).
  async function get(pathAndQuery: string): Promise<unknown> {
    const res = await withRetry(
      () => request("GET", `${host}${pathAndQuery}`, { token }),
      { label: `get ${pathAndQuery}` }
    );
    return res.json;
  }
  async function del(
    pathAndQuery: string
  ): Promise<{ status?: number; json?: unknown }> {
    const res = await request("DELETE", `${host}${pathAndQuery}`, { token });
    return { status: res.status, json: res.json };
  }

  return { meta, exec, get, del, token };
}

export { makeClient, CONNECTOR_NAME };
