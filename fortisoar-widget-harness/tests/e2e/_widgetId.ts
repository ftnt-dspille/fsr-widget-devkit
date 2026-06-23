"use strict";
// Resolve the installed fsrSocAssistant widget id from the running harness,
// so e2e specs survive version bumps instead of hard-coding e.g. -1.0.0.
// Usage in a spec:
//   const { resolveWidgetId, DEFAULT_ID } = require('./_widgetId');
//   let WIDGET_ID = DEFAULT_ID;
//   test.beforeAll(async ({ request }) => { WIDGET_ID = await resolveWidgetId(request); });

import { APIRequestContext } from "@playwright/test";

// Kept for back-compat with any caller that still imports HARNESS, but the
// resolver below uses a RELATIVE path so it follows the `request` fixture's
// per-worker baseURL (14401 + parallelIndex, set by _isolated.js) instead of
// pinning worker 1's port. Under per-worker servers a hardcoded origin would
// query the wrong worker's harness.
const HARNESS = "http://localhost:14401";
const DEFAULT_ID = "fsrSocAssistant-1.0.29";

export async function resolveWidgetId(
  request: APIRequestContext,
  name?: string
): Promise<string> {
  const widgetName = name || "fsrSocAssistant";
  try {
    const resp = await request.get("/_fsr/widgets");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- response json is dynamic
    const data = (await resp.json()) as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- list structure is dynamic
    const list = data.widgets || data as any[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- widget items are dynamic
    const w = (list || []).find((x: any) => x.name === widgetName);
    if (w && w.id) return w.id;
  } catch (_e) {
    /* harness unreachable — fall back to the default */
  }
  return DEFAULT_ID;
}

export { DEFAULT_ID, HARNESS };
