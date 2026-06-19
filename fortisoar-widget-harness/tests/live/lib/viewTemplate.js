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

const https = require("https");
const { URL } = require("url");

const agent = new https.Agent({ rejectUnauthorized: false, keepAlive: true });

function request(method, urlStr, { token, body, timeoutMs = 60000 } = {}) {
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
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`timeout ${method} ${u.pathname}`)));
    if (payload != null) req.write(payload);
    req.end();
  });
}

// Walk a rows-layout config and yield every widgets[] array (the insertion
// points), including those nested inside tab widgets' own config.rows.
function eachWidgetsArray(config, fn) {
  function walk(node) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (Array.isArray(node.widgets)) fn(node.widgets);
    Object.keys(node).forEach((k) => walk(node[k]));
  }
  walk(config);
}

function isActionRendererCell(w) {
  return w && typeof w.type === "string" && /^actionRendererWidget(-|$)/.test(w.type);
}

// Choose where to insert a custom widget cell so it actually RENDERS on the
// record page. The detail layout's TOP-LEVEL widgets[] array holds only the
// platform layout widgets (`primaryDetail`, `tabs`); the renderer ignores any
// custom widget placed there. Custom widgets must live inside a tab's content:
//   tabs(config.tabs[]) -> tab.widget(type:"rows").config.rows[].columns[].widgets[]
// So: find the tabs widget, pick the primary/first tab, and return the first
// nested widgets[] array within it. Falls back to the very first widgets[] array
// if the layout has no tabs widget (a flat detail view).
function pickInsertionTarget(config) {
  let tabsWidget = null;
  (function find(n) {
    if (!n || typeof n !== "object" || tabsWidget) return;
    if (Array.isArray(n)) { n.forEach(find); return; }
    if (n.type === "tabs" && n.config) { tabsWidget = n; return; }
    Object.keys(n).forEach((k) => find(n[k]));
  })(config);

  if (tabsWidget) {
    const tabs = (tabsWidget.config && tabsWidget.config.tabs) || [];
    // Prefer the primary/active tab; else the first tab.
    const tab = tabs.find((t) => t && t.active === 0) || tabs[0];
    if (tab) {
      let target = null;
      eachWidgetsArray(tab.widget || tab, (arr) => { if (!target) target = arr; });
      if (target) return target;
    }
  }
  // Flat layout fallback.
  let target = null;
  eachWidgetsArray(config, (arr) => { if (!target) target = arr; });
  return target;
}

async function makeViewTemplateClient() {
  const { resolveSoarEnv } = require("../../../lib/soarEnv");
  const soar = resolveSoarEnv();
  if (!soar.host) throw new Error("missing FSR_BASE_URL (set it in .env for live tests)");
  if (!soar.user || !soar.pass) throw new Error("missing FSR_USERNAME/FSR_PASSWORD (.env)");
  const host = soar.host.replace(/\/+$/, "");

  const auth = await request("POST", `${host}/auth/authenticate`, {
    body: { credentials: { loginid: soar.user, password: soar.pass } },
  });
  if (auth.status < 200 || auth.status >= 300 || !auth.json || !auth.json.token) {
    throw new Error(`authenticate failed: HTTP ${auth.status} ${auth.text.slice(0, 200)}`);
  }
  const token = auth.json.token;

  // The ACTIVE detail (rows) SVT for a module. There can be several "Base
  // Template" rows SVTs for one module (duplicates/imports), so we don't guess
  // by name — /api/views/1/modules-<module>-detail returns the one the record
  // page actually renders; its uuid is the authoritative target to GET/PUT.
  async function resolveActiveDetailUuid(module) {
    const alias = await request("GET", `${host}/api/views/1/modules-${module}-detail`, { token });
    if (alias.status === 200 && alias.json && alias.json.uuid) return alias.json.uuid;
    // Fallback: query system_view_templates and take the default rows SVT.
    const q = await request("POST", `${host}/api/query/system_view_templates`, {
      token,
      body: { logic: "AND", filters: [
        { field: "module", operator: "eq", value: module },
        { field: "type", operator: "eq", value: "rows" },
      ] },
    });
    const list = (q.json && (q.json["hydra:member"] || q.json)) || [];
    const chosen = (Array.isArray(list) && (list.find((v) => v.isDefault) || list.find((v) => v.name === "Base Template") || list[0])) || null;
    if (!chosen) throw new Error(`no rows SVT for module ${module} (HTTP ${q.status})`);
    return chosen.uuid || (chosen["@id"] || "").split("/").pop();
  }

  // Resolve the installed action-renderer widget's version straight off the box
  // (/api/3/widgets) so a live spec never hardcodes a version that drifts on the
  // next --bump. Returns e.g. "1.0.3", or null if it isn't installed.
  // NOTE: /api/3/widgets 500s on $orderby — do not add one.
  async function resolveInstalledActionRendererVersion() {
    const res = await request("GET", `${host}/api/3/widgets?$limit=500`, { token });
    const list = (res.json && (res.json["hydra:member"] || res.json)) || [];
    if (!Array.isArray(list)) return null;
    const w = list.find((x) => /^actionRendererWidget$/i.test(x && (x.name || x.template || "")));
    return (w && (w.version || w.widgetVersion)) || null;
  }

  async function getDetailTemplate(module) {
    const uuid = await resolveActiveDetailUuid(module);
    const full = await request("GET", `${host}/api/3/system_view_templates/${uuid}`, { token });
    if (full.status !== 200 || !full.json) {
      throw new Error(`GET svt ${uuid}: HTTP ${full.status}`);
    }
    return full.json;
  }

  async function save(svt) {
    const uuid = svt.uuid || (svt["@id"] || "").split("/").pop();
    const res = await request("PUT", `${host}/api/3/system_view_templates/${uuid}`, { token, body: svt });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`PUT svt ${uuid}: HTTP ${res.status} ${res.text.slice(0, 300)}`);
    }
    return res.json;
  }

  function countActionRendererCells(svt) {
    let n = 0;
    eachWidgetsArray(svt.config, (arr) => arr.forEach((w) => { if (isActionRendererCell(w)) n++; }));
    return n;
  }

  // Idempotent: strip any existing action-renderer cells, then insert one fresh
  // cell at the TOP of the first widgets[] array (so it's visible without
  // scrolling). Returns { uuid, version, insertedInto, removedFirst }.
  async function addActionRendererWidget(module, { version, config = {} } = {}) {
    if (!version) throw new Error("addActionRendererWidget requires { version } (e.g. '1.0.3')");
    const svt = await getDetailTemplate(module);
    let removed = 0;
    eachWidgetsArray(svt.config, (arr) => {
      for (let i = arr.length - 1; i >= 0; i--) if (isActionRendererCell(arr[i])) { arr.splice(i, 1); removed++; }
    });
    const target = pickInsertionTarget(svt.config);
    if (!target) throw new Error(`no widgets[] insertion point in ${module} detail template`);
    // Every widget cell needs a unique instance id (config.wid); the renderer
    // skips a cell without one (that's why an AR cell with only {type,config}
    // silently didn't render).
    const cell = {
      type: `actionRendererWidget-${version}`,
      config: { wid: require("crypto").randomUUID(), ...config },
    };
    target.unshift(cell);
    await save(svt);
    return {
      uuid: svt.uuid || (svt["@id"] || "").split("/").pop(),
      version,
      removedFirst: removed,
      cells: countActionRendererCells(svt),
    };
  }

  async function removeActionRendererWidget(module) {
    const svt = await getDetailTemplate(module);
    let removed = 0;
    eachWidgetsArray(svt.config, (arr) => {
      for (let i = arr.length - 1; i >= 0; i--) if (isActionRendererCell(arr[i])) { arr.splice(i, 1); removed++; }
    });
    if (removed) await save(svt);
    return { removed };
  }

  async function hasActionRendererWidget(module) {
    const svt = await getDetailTemplate(module);
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

module.exports = { makeViewTemplateClient, eachWidgetsArray, isActionRendererCell };
