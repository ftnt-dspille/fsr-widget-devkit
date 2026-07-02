#!/usr/bin/env python3
"""Local connector sidecar — runs the FortiSOAR SOC-Assistant connector on the
laptop so the dev harness can invoke its operations WITHOUT a deployed worker.

The harness forwards `POST /api/integration/execute/` here (when
FSR_LOCAL_CONNECTOR=1). This process:

  1. imports the connector (loaded as a synthetic package — its folder name has
     a dash, so it isn't a legal module name and ships no __init__.py),
  2. resolves the widget's `config` (a config NAME like "fsrpb-live") into a
     real config dict (LLM gateway creds + provider) read from localdev.env,
  3. calls operations[operation](config, params) and returns the result in the
     `{status, data}` envelope FortiSOAR's execute endpoint uses.

LLM calls go to a local OpenAI-compatible LLM gateway. SOAR data tools (run_op, get_record,
search_module_records) reach the configured box via probes._env -> pyfsr; set
FSR_BASE_URL in localdev.env (or the probes .env) to point at it. No sim/mock —
the real chat_turn path.

Run:
  FSRPB_DEV=1 .venv-localdev/bin/python scripts/local-connector-sidecar.py

localhost-only, no auth ��� dev machine. See ../LOCAL_DEV.md.
"""
from __future__ import annotations

import importlib
import json
import os
import sys
import types
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# --- locations (keep in sync with setup-localdev-venv.sh) -------------------
HARNESS_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONNECTOR_DIR = (
    "/Users/dylanspille/PycharmProjects/ConnectorsV2/fsr-playbook-builder/"
    "connector-fsr-soc-assistant"
)
ENV_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "localdev.env")
PORT = int(os.environ.get("FSRPB_SIDECAR_PORT", "4771"))


def _load_env(path: str) -> None:
    """Tiny .env loader (no python-dotenv dep needed at import time)."""
    if not os.path.isfile(path):
        return
    for line in open(path, encoding="utf-8"):
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        key, val = key.strip(), val.strip()
        if val and val[0] in ('"', "'") and val[-1] == val[0]:
            val = val[1:-1]
        os.environ.setdefault(key, val)


_load_env(ENV_FILE)
# Dev mode: bypass the fsr_playbooks version-assert (editable install reports
# 0.0.0+unknown, not the production pin).
os.environ.setdefault("FSRPB_DEV", "1")

# Make probes._env find the framework's tooling dir (for run_op's box client)
# and ensure fsr_playbooks resolves — editable install covers it, but this is
# belt-and-suspenders if the venv wasn't built editable.
_FRAMEWORK = "/Users/dylanspille/PycharmProjects/fsr-playbook-framework"
for p in (os.path.join(_FRAMEWORK, "tooling"), _FRAMEWORK):
    if p not in sys.path:
        sys.path.insert(0, p)

# --- import the connector as a synthetic package ----------------------------
# The folder name "connector-fsr-soc-assistant" contains a dash (illegal as a
# module name) and the package ships no __init__.py. Register a module whose
# __path__ points at the dir so `from .storage import ...` (deferred inside the
# functions) resolves. The relative imports only fire when an op runs, so the
# package just needs a __path__ to anchor them.
if not os.path.isdir(CONNECTOR_DIR):
    sys.exit(f"connector dir not found: {CONNECTOR_DIR}")
_pkg = types.ModuleType("fsrpb_connector")
_pkg.__path__ = [CONNECTOR_DIR]
sys.modules["fsrpb_connector"] = _pkg
operations_mod = importlib.import_module("fsrpb_connector.operations")
OPERATIONS = operations_mod.operations  # {name: _sim_aware(_mock_aware(fn))}
print(f"[sidecar] loaded {len(OPERATIONS)} ops from {CONNECTOR_DIR}", flush=True)


def _build_config(config_name: str | None) -> dict:
    """Resolve a widget config NAME (e.g. 'fsrpb-live') into the config dict
    the connector ops read. Local dev has exactly one config — the LLM gateway as the
    LLM — so the name is advisory; the dict comes from localdev.env."""
    provider = (os.environ.get("LLM_PROVIDER") or "openai").strip().lower()
    cfg: dict = {"llm_provider": provider}
    if provider == "openai":
        cfg["openai_api_key"] = os.environ.get("OPENAI_API_KEY", "")
        cfg["openai_base_url"] = os.environ.get("OPENAI_BASE_URL", "")
        cfg["openai_model"] = os.environ.get("OPENAI_MODEL", "")
    else:
        cfg["anthropic_api_key"] = os.environ.get("ANTHROPIC_API_KEY", "")
        cfg["anthropic_base_url"] = os.environ.get("ANTHROPIC_BASE_URL", "")
        cfg["model"] = os.environ.get("ANTHROPIC_MODEL", "")
    return cfg


class Handler(BaseHTTPRequestHandler):
    def _send(self, status: int, payload) -> None:
        body = json.dumps(payload, default=str).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path in ("/", "/health"):
            self._send(200, {"ok": True, "ops": sorted(OPERATIONS)})
        else:
            self._send(404, {"ok": False, "error": "not found"})

    def do_POST(self):
        if self.path.rstrip("/") not in ("/execute", "/api/integration/execute"):
            self._send(404, {"ok": False, "error": f"unknown path: {self.path}"})
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
            req = json.loads(self.rfile.read(length) or b"{}")
        except Exception as e:
            self._send(400, {"status": "Failed", "data": {"ok": False,
                           "error": {"code": "bad_json", "message": str(e)}}})
            return
        op = req.get("operation")
        params = req.get("params") or {}
        config_name = req.get("config")  # a config NAME, not a dict
        print(f"[sidecar] → {op} (config={config_name!r})", flush=True)
        handler = OPERATIONS.get(op)
        if handler is None:
            self._send(200, {"status": "Failed", "data": {"ok": False,
                "error": {"code": "unknown_operation",
                          "message": f"{op!r} not in operations map"}}})
            return
        config = _build_config(config_name)
        try:
            result = handler(config, params)
            # Real FortiSOAR's execute endpoint returns {status:"Success"|"Failed",
            # data:{…connector payload…}} — status is a STRING, not an HTTP code.
            # The widget's _unwrapEnvelope only peels .data when typeof status ===
            # 'string'; sending a numeric status here silently defeats that check
            # and the widget sees the whole envelope where it expects the bare
            # connector payload (e.g. contract_version reads as undefined).
            self._send(200, {"status": "Success", "data": result})
            print(f"[sidecar]   ← {op} ok", flush=True)
        except Exception as e:  # noqa: BLE001 — never crash the sidecar
            import traceback
            tb = traceback.format_exc(limit=4)
            print(f"[sidecar]   ← {op} RAISED: {e}\n{tb}", flush=True)
            self._send(200, {"status": "Failed", "data": {"ok": False,
                "error": {"code": type(e).__name__, "message": str(e)}}})


if __name__ == "__main__":
    print(f"[sidecar] listening on http://127.0.0.1:{PORT} "
          f"(env={ENV_FILE})", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
