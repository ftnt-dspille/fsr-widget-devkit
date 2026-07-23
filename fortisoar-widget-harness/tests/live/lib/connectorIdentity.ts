"use strict";
// Single source of truth for the connector identity the fortiaiAgenticAssistant widget
// talks to — DERIVED from the widget's own service so test infra can never drift
// from what ships. The widget (`fsrPbAgent.service.js`) hardcodes the identity
// because it must ship self-contained to SOAR; everything in the harness/tests
// reads it from here instead of keeping a second copy. (The stale
// `fsr-playbook-builder` name in soarClient.js — which aborted the live build
// test after the rename — was exactly that second copy drifting.)
//
// Usage: const { name, search } = require("./connectorIdentity");
//
// NOTE: no `preferredConfig` -- the widget honors the connector DEFAULT config.

import fs = require("fs");
import path = require("path");

interface ConnectorIdentity {
  name: string;
  search: string;
  source: string;
  derived: boolean;
}

const WIDGET = process.env.FSRPB_WIDGET || "fortiaiAgenticAssistant";
const WIDGETS_SRC =
  process.env.WIDGETS_SRC || path.resolve(__dirname, "../../../../widgets-src");
const SERVICE = path.join(
  WIDGETS_SRC,
  WIDGET,
  "widget/widgetAssets/js/fsrPbAgent.service.js"
);

function pluck(src: string, varName: string, fallback: string): string {
  // Matches:  var CONNECTOR_NAME = 'connector-fsr-soc-assistant';
  const m = src.match(new RegExp(varName + "\\s*=\\s*['\"]([^'\"]+)['\"]"));
  return (m && m[1]) || fallback;
}

let identity: ConnectorIdentity;
try {
  const src = fs.readFileSync(SERVICE, "utf8");
  identity = {
    name: pluck(src, "CONNECTOR_NAME", "connector-fsr-soc-assistant"),
    search: pluck(src, "CONNECTOR_SEARCH", "assistant"),
    source: SERVICE,
    derived: true,
  };
} catch (_e) {
  // The widget source isn't readable (e.g. a sanitized dev-kit clone). Fall back
  // to the known-good values so live infra still works, but flag it.
  identity = {
    name: "connector-fsr-soc-assistant",
    search: "assistant",
    source: SERVICE,
    derived: false,
  };
}

export = identity;
