#!/usr/bin/env python3
"""Local connector sidecar -- runs the FortiSOAR SOC-Assistant connector on the
laptop so the dev harness can invoke its operations WITHOUT a deployed worker.

The harness forwards `POST /api/integration/execute/` here (when
FSR_LOCAL_CONNECTOR=1). This process:

  1. imports the connector (loaded as a synthetic package -- its folder name has
     a dash, so it isn't a legal module name and ships no __init__.py),
  2. resolves the widget's `config` (a config NAME like "fsrpb-live") into a
     real config dict (LLM gateway creds + provider) read from localdev.env,
  3. calls operations[operation](config, params) and returns the result in the
     `{status, data}` envelope FortiSOAR's execute endpoint uses.

LLM calls go to a local OpenAI-compatible LLM gateway. SOAR data tools (run_op, get_record,
search_module_records) reach the configured box via probes._env -> pyfsr; set
FSR_BASE_URL in localdev.env (or the probes .env) to point at it. No sim/mock --
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
    """Tiny .env loader (no python-dotenv dep needed at import time).

    THE FILE WINS over an ambient environment variable, and says so when it
    overrides one. This used to be `setdefault`, i.e. ambient-wins, which is the
    wrong precedence for this file and failed silently and expensively:

    a shell exporting `OPENAI_BASE_URL=https://api.openai.com/v1` (common -- the
    OpenAI SDK's own convention, and inherited by anything launched from that
    shell) made the sidecar ignore the gateway named in localdev.env and send
    every "local" turn to **real OpenAI**, using whatever key was ambient. The
    only visible symptom was `invalid model ID`, because OpenAI does not serve
    the gateway's model names -- which reads as "my model config is wrong", not
    "my traffic is going somewhere else entirely".

    This file exists precisely to name the local LLM gateway and the box; an
    ambient value silently outranking it defeats the whole point. For a one-off
    override, edit the file -- that keeps the effective config in one readable
    place instead of split between a file and an invisible export.
    """
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
        prior = os.environ.get(key)
        if prior is not None and prior != val:
            # Never print the value of a secret; the KEY name is the whole
            # point of the message.
            shown = "<redacted>" if any(
                s in key.upper() for s in ("KEY", "PASSWORD", "SECRET", "TOKEN")
            ) else f"{prior!r} -> {val!r}"
            print(f"[sidecar] {os.path.basename(path)} overrides ambient {key} ({shown})",
                  flush=True)
        os.environ[key] = val


_load_env(ENV_FILE)
# Dev mode: bypass the fsr_playbooks version-assert (editable install reports
# 0.0.0+unknown, not the production pin).
os.environ.setdefault("FSRPB_DEV", "1")

# Make probes._env find the framework's tooling dir (for run_op's box client)
# and ensure fsr_playbooks resolves -- editable install covers it, but this is
# belt-and-suspenders if the venv wasn't built editable.
_FRAMEWORK = "/Users/dylanspille/PycharmProjects/fsr-playbook-framework"
for p in (os.path.join(_FRAMEWORK, "tooling"), _FRAMEWORK):
    if p not in sys.path:
        sys.path.insert(0, p)

# ── --reload: restart on a source change ────────────────────────────────────
#
# The widget half of this loop already reflects an edit immediately (the harness
# watches widget dirs and broadcasts an SSE soft-remount). The connector half did
# not: every Python edit meant Ctrl-C and a manual restart, so the two halves of
# the same local loop had very different edit costs and the Python side quietly
# discouraged iteration.
#
# Supervisor + child rather than in-process module reloading, deliberately. The
# connector registers operations, binds ContextVars and holds module-level state
# at import; `importlib.reload` over that graph leaves a half-old half-new
# process whose bugs belong to neither version. A fresh interpreter is the only
# state that is honestly reproducible.
#
# NOTE: a restart drops whatever the running process held in memory -- an
# in-flight turn, and any parked/suspended session that is not persisted by the
# connector's own storage. Editing mid-approval will lose that park; finish the
# arc, then edit.
_WATCH_ROOTS = [
    CONNECTOR_DIR,
    os.path.join(_FRAMEWORK, "fsr_playbooks"),
]
_WATCH_SUFFIXES = (".py",)


def _source_stamp() -> float:
    """Newest mtime across the watched trees. Cheap enough to poll at 1Hz."""
    newest = 0.0
    for root in _WATCH_ROOTS:
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames
                           if d not in ("__pycache__", ".git", ".venv", "node_modules")]
            for name in filenames:
                if not name.endswith(_WATCH_SUFFIXES):
                    continue
                try:
                    m = os.stat(os.path.join(dirpath, name)).st_mtime
                except OSError:
                    continue
                if m > newest:
                    newest = m
    return newest


def _supervise() -> None:
    import signal
    import subprocess
    import time

    child_argv = [sys.executable, os.path.abspath(__file__)]
    print(f"[sidecar] --reload: watching {len(_WATCH_ROOTS)} trees for *.py changes",
          flush=True)
    proc = None
    try:
        while True:
            stamp = _source_stamp()
            proc = subprocess.Popen(child_argv, env={**os.environ, "FSRPB_SIDECAR_CHILD": "1"})
            while True:
                time.sleep(1.0)
                if proc.poll() is not None:
                    # The child died on its own (an import error in the edit you
                    # just made, most likely). Do NOT spin: wait for the next
                    # source change before trying again, so the traceback stays
                    # on screen instead of scrolling past in a restart loop.
                    print(f"[sidecar] child exited ({proc.returncode}); waiting for a source change",
                          flush=True)
                    while _source_stamp() <= stamp:
                        time.sleep(1.0)
                    break
                if _source_stamp() > stamp:
                    print("[sidecar] source changed -- restarting", flush=True)
                    proc.send_signal(signal.SIGTERM)
                    try:
                        proc.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        proc.kill()
                    break
    except KeyboardInterrupt:
        pass
    finally:
        if proc is not None and proc.poll() is None:
            proc.terminate()


# Dispatch BEFORE the connector import below. The supervisor's whole value is
# surviving an edit that does not import -- if it paid that import itself, the
# broken edit would take the supervisor down with the child and you would be
# back to restarting by hand at exactly the moment you need the loop most.
if __name__ == "__main__" and "--reload" in sys.argv and not os.environ.get("FSRPB_SIDECAR_CHILD"):
    _supervise()
    sys.exit(0)

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
# On a real FortiSOAR box the connector dir is put directly on sys.path, so
# operations.py's bare `import fsr_soc_triage` (a sibling-package import, not
# a relative one) resolves as a top-level module. The synthetic
# "fsrpb_connector" package above only covers RELATIVE imports
# (`from .storage import ...`); it does NOT make `fsr_soc_triage` importable
# as a top-level name. Without this, that bare import silently fails inside
# operations.py's broad `except Exception`, the triage system prompt falls
# back to a stub, and the triage tool registry (search_module_records,
# get_record, SIEM/FAZ/FMG tools) never gets injected -- the model then
# flails hunting for a nonexistent generic "search" connector op instead.
if CONNECTOR_DIR not in sys.path:
    sys.path.insert(0, CONNECTOR_DIR)
operations_mod = importlib.import_module("fsrpb_connector.operations")
OPERATIONS = operations_mod.operations  # {name: _sim_aware(_mock_aware(fn))}
print(f"[sidecar] loaded {len(OPERATIONS)} ops from {CONNECTOR_DIR}", flush=True)


def _build_config(config_name: str | None) -> dict:
    """Resolve a widget config NAME (e.g. 'fsrpb-live') into the config dict
    the connector ops read. Local dev has exactly one config -- the LLM gateway as the
    LLM -- so the name is advisory; the dict comes from localdev.env."""
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


# --------------------------------------------------------------------------
# Hermetic mode (Seam C -- stability plan Phase 0.4).
#
# FSRPB_SIDECAR_HERMETIC=1 swaps the two live seams for the box-free ones the
# connector's own `scripts/local_turn.py` already implements -- a FAKE LLM
# (deterministic, no gateway, no credits) and a CASSETTE FSR client (reads
# replayed in-process; any write raises). The result: the REAL widget
# controller drives the REAL operations.py with ZERO box/network dependency,
# so `make turn-hermetic` can gate the widget↔connector contract in CI.
#
# We REUSE the connector's helpers (never reimplement them) so the hermetic
# seams can't drift from what local_turn.py / the connector test suite already
# vet: `_install_fake_provider`, `_CassetteClient`, `_cassette_rules`.
# --------------------------------------------------------------------------
HERMETIC = str(os.environ.get("FSRPB_SIDECAR_HERMETIC", "")).strip().lower() in (
    "1", "true", "yes", "on")
_lt = None  # the connector's local_turn module, imported lazily in hermetic mode
_shared = None
_CASSETTE_READS: list = []  # shared-format read rules seeded from FSRPB_SIDECAR_CASSETTE


def _load_cassette(path: str) -> list:
    """Load a shared cassette JSON and return read rules in local_turn's rule
    shape -- `[(url_substring, body)]` -- so the SAME file feeds both the Python
    `local_turn` hub and this widget-facing sidecar (stability plan Phase 0.3).

    Format::

        { "reads": [ { "match": "/api/3/alerts/", "body": { ... } }, ... ] }

    A rule's `body` is served for any GET whose URL contains `match` (first hit
    wins), exactly as `_CassetteClient` replays it. These rules are appended
    after the persona fixture, so a cassette seeds the connector-internal reads
    (get_record / search_module_records) a scripted turn makes -- box-free.
    """
    if not path:
        return []
    try:
        with open(path, encoding="utf-8") as fh:
            doc = json.load(fh)
    except Exception as e:  # noqa: BLE001
        print(f"[sidecar] cassette load failed ({path}): {e}", flush=True)
        return []
    rules = []
    for r in (doc.get("reads") or []):
        match = r.get("match")
        if match:
            rules.append((match, r.get("body", {"hydra:member": [], "hydra:totalItems": 0})))
    print(f"[sidecar] cassette: {len(rules)} read rule(s) from {path}", flush=True)
    return rules


def _init_hermetic() -> None:
    """Import the connector's local_turn seam helpers and install the fake LLM
    provider once. Cassette reads are (re)wired per request from the mounted
    module's persona."""
    global _lt, _shared
    _CONN_SCRIPTS = os.path.join(os.path.dirname(CONNECTOR_DIR), "scripts")
    if _CONN_SCRIPTS not in sys.path:
        sys.path.insert(0, _CONN_SCRIPTS)
    import local_turn as lt  # noqa: E402 -- path just set up
    from fsr_playbooks.mcp_server import _shared as shared  # noqa: E402
    _lt, _shared = lt, shared
    # Install the fake provider onto the SAME operations module the sidecar
    # dispatches through (patches operations_mod._build_provider).
    _lt._install_fake_provider(operations_mod, "fake-1")
    global _CASSETTE_READS
    _CASSETTE_READS = _load_cassette(os.environ.get("FSRPB_SIDECAR_CASSETTE", ""))
    print("[sidecar] HERMETIC mode: fake LLM + cassette reads (box-free)", flush=True)


def _hermetic_config(op: str, params: dict) -> dict:
    """Rewire the cassette FSR client for this request's mounted module and
    return the fake LLM config. Mirrors local_turn.run_turn's seam setup."""
    entity = params.get("entity") if isinstance(params.get("entity"), dict) else None
    module = (params.get("module")
              or (entity.get("module") if entity else None))
    # Fresh cassette per request: persona fixture + any shared-format cassette
    # reads (extra_reads), then a 200-empty miss so read tools "find nothing"
    # rather than error-flail (behavioral-grade semantics).
    rules = _lt._cassette_rules(module, "fixture", None, _CASSETTE_READS or None)
    cassette = _lt._CassetteClient(
        base_url=os.environ.get("FSR_BASE_URL", "https://fsr.local"),
        rules=rules, miss_status=200)
    _shared._LIVE_CLIENT_CACHE["client"] = cassette
    _shared._live_client = lambda: cassette
    _shared._invalidate_live_client = lambda: None
    # Persona cache is process-global; clear so this request's fixture applies.
    try:
        operations_mod._PROFILE_CACHE.clear()
        operations_mod._PROFILE_NEG_TS.clear()
    except Exception:
        pass
    return {"anthropic_api_key": "sk-local-not-real", "model": "fake-1"}


if HERMETIC:
    _init_hermetic()


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
        config = _hermetic_config(op, params) if HERMETIC else _build_config(config_name)
        try:
            result = handler(config, params)
            # Real FortiSOAR's execute endpoint returns {status:"Success"|"Failed",
            # data:{…connector payload…}} -- status is a STRING, not an HTTP code.
            # The widget's _unwrapEnvelope only peels .data when typeof status ===
            # 'string'; sending a numeric status here silently defeats that check
            # and the widget sees the whole envelope where it expects the bare
            # connector payload (e.g. contract_version reads as undefined).
            self._send(200, {"status": "Success", "data": result})
            print(f"[sidecar]   ← {op} ok", flush=True)
        except Exception as e:  # noqa: BLE001 -- never crash the sidecar
            import traceback
            tb = traceback.format_exc(limit=4)
            print(f"[sidecar]   ← {op} RAISED: {e}\n{tb}", flush=True)
            self._send(200, {"status": "Failed", "data": {"ok": False,
                "error": {"code": type(e).__name__, "message": str(e)}}})


if __name__ == "__main__":
    print(f"[sidecar] listening on http://127.0.0.1:{PORT} "
          f"(env={ENV_FILE})", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
