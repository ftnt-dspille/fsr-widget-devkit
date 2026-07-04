#!/usr/bin/env bash
# setup-localdev-venv.sh — build the unified local-dev venv.
#
# Creates .venv-localdev with: editable fsr-playbooks + pyfsr (local-first,
# always-fresh source), the FortiSOAR connectors SDK engine wheel (provides
# connectors.core.connector), and the PyPI deps our connector needs (the
# OpenAI-compatible LLM provider, .env loader, the sidecar).
#
# Run once; re-run to refresh. See ../LOCAL_DEV.md (repo root).
set -euo pipefail

HARNESS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_DIR="$HARNESS_DIR/.venv-localdev"

# --- repo roots (adjust here if your layout differs) -----------------------
FSR_ALL_WIDGETS="/Users/dylanspille/WebstormProjects/fsr_all_widgets"
CONNECTORS_V2="/Users/dylanspille/PycharmProjects/ConnectorsV2"
FRAMEWORK="/Users/dylanspille/PycharmProjects/fsr-playbook-framework"
PYFSR="/Users/dylanspille/PycharmProjects/pyfsr"
VSCODE_EXT="$HOME/.vscode/extensions/fortisoar.fortisoar-connector-0.0.1"
ENGINE_WHEEL="$VSCODE_EXT/resources/wheels/fortisoar_connector_engine-3.0.0.3-py3-none-any.whl"

fail() { echo "✗ $*" >&2; exit 1; }

[ -d "$FRAMEWORK" ]     || fail "framework not found: $FRAMEWORK"
[ -d "$PYFSR" ]        || fail "pyfsr not found: $PYFSR"
[ -f "$ENGINE_WHEEL" ] || fail "connectors engine wheel not found: $ENGINE_WHEEL (VS Code FortiSOAR Connector extension installed?)"

command -v uv >/dev/null || fail "uv not on PATH (brew install uv)"

echo "▶ creating venv at $VENV_DIR (python 3.13)"
uv venv "$VENV_DIR" --python 3.13 --clear
PY="$VENV_DIR/bin/python"

echo "▶ installing editable fsr-playbooks + pyfsr, connectors engine, PyPI deps"
uv pip install --python "$PY" \
  -e "$FRAMEWORK" \
  -e "$PYFSR" \
  "$ENGINE_WHEEL" \
  openai httpx python-dotenv requests pytest

echo "▶ verifying imports"
"$PY" - <<'EOF'
import connectors.core.connector as c
import fsr_playbooks, pyfsr, openai, httpx, dotenv
print(f"  connectors.core.connector : {c.ConnectorError.__module__}.{c.ConnectorError.__name__}")
print(f"  fsr_playbooks              : {fsr_playbooks.__file__}")
print(f"  pyfsr                      : {pyfsr.__file__}")
print(f"  openai                     : {openai.__version__}")
print("✓ localdev venv ready:", "$VENV_DIR")
EOF

echo
echo "Next: copy scripts/localdev.env.example -> scripts/localdev.env and fill in the LLM gateway + 159 creds."
echo "Then: FSRPB_DEV=1 $PY scripts/local-connector-sidecar.py"
