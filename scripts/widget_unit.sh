#!/usr/bin/env bash
# The widget jest unit run of the ship paths (widget-push, ship-verify, the version bump): `widget_unit.sh <widgets_src> <widget>`.
# In the Linux container by default (the same suites take ~30s there against 5-13 min on the Mac host, where process
# starts stall); the host only when no engine answers or DOOR_DOCKER=0, and that is said loudly because it is the slow path.
# A red container run is a red run: only "no engine" falls back, never a test failure.
set -uo pipefail
ROOT="${FSR_TOOL_HOME:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
WS="$1"; W="$2"
MAKE="${MAKE:-make}"
engine_ready() {
    case "${DOOR_ENGINE:-}" in up) return 0 ;; down) return 1 ;; esac
    docker info >/dev/null 2>&1 && return 0
    [[ "${DOCKER_START:-colima}" == colima ]] && command -v colima >/dev/null 2>&1 || return 1
    echo "unit: no docker engine answering; starting colima" >&2
    colima start >/dev/null 2>&1 || return 1
    for _ in $(seq 60); do docker info >/dev/null 2>&1 && return 0; sleep 2; done
    return 1
}
if [[ "${DOOR_DOCKER:-1}" != 0 ]] && engine_ready; then
    echo ">> unit: $W in the Linux container"
    exec $MAKE --no-print-directory -C "$ROOT" test-docker WIDGET="$W" WIDGETS_SRC="$WS"
fi
echo ">> unit: WARNING no container engine (or DOOR_DOCKER=0): running $W unit tests on the HOST, several times slower (colima start)" >&2
exec $MAKE --no-print-directory -C "$ROOT" test-unit WIDGET="$W" WIDGETS_SRC="$WS"
