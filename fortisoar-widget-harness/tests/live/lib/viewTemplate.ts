// Live SOAR detail-view-template editor.
//
// FortiSOAR stores a module's record-detail layout as a "system view template"
// (SVT) of type "rows": GET/PUT /api/3/system_view_templates/<uuid>. The layout
// is config.rows[].columns[].widgets[], where each widget cell is simply
//   { "type": "<widgetTemplate>-<version>", "config": { ...widget config... } }
// (e.g. "actionRendererWidget-1.0.3"). The Application Editor → module → detail
// view writes the same structure. The read alias /api/views/1/modules-<m>-detail
// returns the active rows SVT for a module.
//
// This helper authenticates directly to FSR_BASE_URL (no harness proxy) and
// can idempotently ADD / REMOVE the action-renderer widget cell on a module's
// detail template so a live UI test can place the widget on a real record page
// and then configure it through the real SOAR editor. Add is idempotent
// (removes any existing action-renderer cell first); remove strips them all —
// so a crashed run self-heals on the next add/remove.
//
// Usage:
//   const { makeViewTemplateClient } = require("./lib/viewTemplate");
//   const vt = await makeViewTemplateClient();
//   const before = await vt.addActionRendererWidget("alerts", { version: "1.0.3" });
//   // ... drive the UI ...
//   await vt.removeActionRendererWidget("alerts");      // cleanup
"use strict";

import https = require("https");
import { URL } = require("url");
import { randomUUID } = require("crypto");

const agent = new https.Agent({ rejectUnauthorized: false, keepAlive: true });

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

function request(
  method: string,
  urlStr: string,
  { token, body, timeoutMs = 60000 }: RequestOptions = {}
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
      req.destroy(new Error(`timeout ${method} ${u.pathname}`))
    );
    if (payload != null) req.write(payload);
    req.end();
  });
}

// Walk a rows-layout config and yield every widgets[] array (the insertion
// points), including those nested inside tab widgets' own config.rows.
export function eachWidgetsArray(
  config: unknown,
  fn: (arr: unknown[]) => void
): void {
  function walk(node: unknown): void {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- config structure is dynamic
    if (Array.isArray((node as any).widgets)) fn((node as any).widgets);
    Object.keys(node as Record<string, unknown>).forEach((k) =>
      walk((node as Record<string, unknown>)[k])
    );
  }
  walk(config);
}

export function isActionRendererCell(w: unknown): boolean {
  return (
    w &&
    typeof (w as Record<string, unknown>).type === "string" &&
    /^actionRendererWidget(-|$)/.test((w as Record<string, unknown>).type as string)
  );
}

// Choose where to insert a custom widget cell so it actually RENDERS on the
// record page. The detail layout's TOP-LEVEL widgets[] array holds only the
// platform layout widgets (`primaryDetail`, `tabs`); the renderer ignores any
// custom widget placed there. Custom widgets must live inside a tab's content:
//   tabs(config.tabs[]) -> tab.widget(type:"rows").config.rows[].columns[].widgets[]
// So: find the tabs widget, pick the primary/first tab, and return the first
// nested widgets[] array within it. Falls back to the very first widgets[] array
// if the layout has no tabs widget (a flat detail view).
function pickInsertionTarget(config: unknown): unknown[] | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- config structure is dynamic
  let tabsWidget: any = null;
  (function find(n: unknown): void {
    if (!n || typeof n !== "object" || tabsWidget) return;
    if (Array.isArray(n)) {
      n.forEach(find);
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- widget type check
    if ((n as any).type === "tabs" && (n as any).config) {
      tabsWidget = n;
      return;
    }
    Object.keys(n as Record<string, unknown>).forEach((k) =>
      find((n as Record<string, unknown>)[k])
    );
  })(config);

  if (tabsWidget) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tab structure is dynamic
    const tabs: any[] = (tabsWidget.config && tabsWidget.config.tabs) || [];
    // Prefer the primary/active tab; else the first tab.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tab item type
    const tab: any = tabs.find((t: any) => t && t.active === 0) || tabs[0];
    if (tab) {
      let target: unknown[] | null = null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- widget structure
      eachWidgetsArray(tab.widget || tab, (arr: unknown[]) => {
        if (!target) target = arr;
      });
      if (target) return target;
    }
  }
  // Flat layout fallback.
  let target: unknown[] | null = null;
  eachWidgetsArray(config, (arr: unknown[]) => {
    if (!target) target = arr;
  });
  return target;
}

interface ViewTemplateClient {
  host: string;
  token: string;
  resolveInstalledActionRendererVersion: () => Promise<string | null>;
  getDetailTemplate: (module: string) => Promise<unknown>;
  addActionRendererWidget: (
    module: string,
    opts?: { version?: string; config?: Record<string, unknown> }
  ) => Promise<{
    uuid: string;
    version: string;
    removedFirst: number;
    cells: number;
  }>;
  removeActionRendererWidget: (module: string) => Promise<{ removed: number }>;
  hasActionRendererWidget: (module: string) => Promise<boolean>;
}

export async function makeViewTemplateClient(): Promise<ViewTemplateClient> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- soarEnv exports are dynamic
  const { resolveSoarEnv } = require("../../../lib/soarEnv") as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- soar object is dynamic
  const soar = resolveSoarEnv() as any;
  if (!soar.host)
    throw new Error("missing FSR_BASE_URL (set it in .env for live tests)");
  if (!soar.user || !soar.pass)
    throw new Error("missing FSR_USERNAME/FSR_PASSWORD (.env)");
  const host = soar.host.replace(/\/+$/, "");

  const auth = await request("POST", `${host}/auth/authenticate`, {
    body: { credentials: { loginid: soar.user, password: soar.pass } },
  });
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

  // The ACTIVE detail (rows) SVT for a module. There can be several "Base
  // Template" rows SVTs for one module (duplicates/imports), so we don't guess
  // by name — /api/views/1/modules-<module>-detail returns the one the record
  // page actually renders; its uuid is the authoritative target to GET/PUT.
  async function resolveActiveDetailUuid(module: string): Promise<string> {
    const alias = await request(
      "GET",
      `${host}/api/views/1/modules-${module}-detail`,
      { token }
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- response is dynamic
    if (alias.status === 200 && alias.json && (alias.json as any).uuid)
      return (alias.json as any).uuid;
    // Fallback: query system_view_templates and take the default rows SVT.
    const q = await request("POST", `${host}/api/query/system_view_templates`, {
      token,
      body: {
        logic: "AND",
        filters: [
          { field: "module", operator: "eq", value: module },
          { field: "type", operator: "eq", value: "rows" },
        ],
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- response structure is dynamic
    const list =
      ((q.json as any)?.["hydra:member"] ||
        (q.json as any[])) || [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- item structure is dynamic
    const chosen =
      (Array.isArray(list) &&
        (list.find((v: any) => v.isDefault) ||
          list.find((v: any) => v.name === "Base Template") ||
          list[0])) ||
      null;
    if (!chosen)
      throw new Error(
        `no rows SVT for module ${module} (HTTP ${q.status})`
      );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- item structure is dynamic
    return (chosen as any).uuid || ((chosen as any)["@id"] || "").split("/").pop();
  }

  // Resolve the installed action-renderer widget's version straight off the box
  // (/api/3/widgets) so a live spec never hardcodes a version that drifts on the
  // next --bump. Returns e.g. "1.0.3", or null if it isn't installed.
  // NOTE: /api/3/widgets 500s on $orderby — do not add one.
  async function resolveInstalledActionRendererVersion(): Promise<
    string | null
  > {
    const res = await request("GET", `${host}/api/3/widgets?$limit=500`, {
      token,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- response structure is dynamic
    const list =
      ((res.json as any)?.["hydra:member"] ||
        (res.json as any[])) || [];
    if (!Array.isArray(list)) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- item structure is dynamic
    const w = list.find(
      (x: any) =>
        /^actionRendererWidget$/i.test(x && (x.name || x.template || ""))
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- item structure is dynamic
    return (w && ((w as any).version || (w as any).widgetVersion)) || null;
  }

  async function getDetailTemplate(module: string): Promise<unknown> {
    const uuid = await resolveActiveDetailUuid(module);
    const full = await request(
      "GET",
      `${host}/api/3/system_view_templates/${uuid}`,
      { token }
    );
    if (full.status !== 200 || !full.json) {
      throw new Error(`GET svt ${uuid}: HTTP ${full.status}`);
    }
    return full.json;
  }

  async function save(svt: unknown): Promise<unknown> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- svt structure is dynamic
    const uuid =
      (svt as any).uuid ||
      (((svt as any)["@id"] || "").split("/").pop() as string);
    const res = await request(
      "PUT",
      `${host}/api/3/system_view_templates/${uuid}`,
      { token, body: svt }
    );
    if (res.status! < 200 || res.status! >= 300) {
      throw new Error(
        `PUT svt ${uuid}: HTTP ${res.status} ${res.text.slice(0, 300)}`
      );
    }
    return res.json;
  }

  function countActionRendererCells(svt: unknown): number {
    let n = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- svt structure is dynamic
    eachWidgetsArray((svt as any).config, (arr: unknown[]) =>
      arr.forEach((w) => {
        if (isActionRendererCell(w)) n++;
      })
    );
    return n;
  }

  // Idempotent: strip any existing action-renderer cells, then insert one fresh
  // cell at the TOP of the first widgets[] array (so it's visible without
  // scrolling). Returns { uuid, version, insertedInto, removedFirst }.
  async function addActionRendererWidget(
    module: string,
    { version, config = {} }: { version?: string; config?: Record<string, unknown> } = {}
  ): Promise<{
    uuid: string;
    version: string;
    removedFirst: number;
    cells: number;
  }> {
    if (!version)
      throw new Error(
        "addActionRendererWidget requires { version } (e.g. '1.0.3')"
      );
    const svt = (await getDetailTemplate(module)) as Record<string, unknown>;
    let removed = 0;
    eachWidgetsArray(svt.config, (arr: unknown[]) => {
      for (let i = arr.length - 1; i >= 0; i--)
        if (isActionRendererCell(arr[i])) {
          arr.splice(i, 1);
          removed++;
        }
    });
    const target = pickInsertionTarget(svt.config);
    if (!target)
      throw new Error(
        `no widgets[] insertion point in ${module} detail template`
      );
    // Every widget cell needs a unique instance id (config.wid); the renderer
    // skips a cell without one (that's why an AR cell with only {type,config}
    // silently didn't render).
    const cell = {
      type: `actionRendererWidget-${version}`,
      config: { wid: randomUUID(), ...config },
    };
    target.unshift(cell);
    await save(svt);
    return {
      uuid: svt.uuid || ((svt["@id"] || "").split("/").pop() as string),
      version,
      removedFirst: removed,
      cells: countActionRendererCells(svt),
    };
  }

  async function removeActionRendererWidget(
    module: string
  ): Promise<{ removed: number }> {
    const svt = (await getDetailTemplate(module)) as Record<string, unknown>;
    let removed = 0;
    eachWidgetsArray(svt.config, (arr: unknown[]) => {
      for (let i = arr.length - 1; i >= 0; i--)
        if (isActionRendererCell(arr[i])) {
          arr.splice(i, 1);
          removed++;
        }
    });
    if (removed) await save(svt);
    return { removed };
  }

  async function hasActionRendererWidget(module: string): Promise<boolean> {
    const svt = (await getDetailTemplate(module)) as Record<string, unknown>;
    return countActionRendererCells(svt) > 0;
  }

  return {
    host,
    token,
    resolveInstalledActionRendererVersion,
    getDetailTemplate,
    addActionRendererWidget,
    removeActionRendererWidget,
    hasActionRendererWidget,
  };
}
