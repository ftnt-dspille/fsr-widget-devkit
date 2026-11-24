#!/usr/bin/env bash
# make test-docker TESTS=<pattern>: run harness jest suites in a Linux container.
#
# Why: on the Mac host process starts stall (endpoint protection), so the
# shell-heavy tooling suites take minutes; in a container they take seconds
# (promoteGate ~200s on the host, 3s in the container). A fast local check, not
# proof: promote still requires CI, and nothing here writes a stamp.
#
# - Starts Colima when no docker engine answers (DOCKER_START=colima default;
#   none disables it).
# - Streams the working tree in with tar (tracked + untracked, not ignored), so
#   uncommitted work is tested; no host mount, no Colima file-sharing config.
# - Linux node_modules live in a docker volume named by the lockfile hash.
# - Box-free tests only: no box, VPN, gateway or machine-local captures inside.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="${TEST_DOCKER_SRC:-$ROOT}"   # the tree whose files go in (tests point it at a fixture)
TESTS="${TESTS:-}"
IMAGE="${TEST_DOCKER_IMAGE:-fsr-test}"
PLATFORM="${TEST_DOCKER_PLATFORM:-linux/arm64}"

engine_up() { docker info >/dev/null 2>&1; }
if ! engine_up; then
  case "${DOCKER_START:-colima}" in
    colima)
      command -v colima >/dev/null || { echo "test-docker: no docker engine and no colima (brew install colima docker)" >&2; exit 2; }
      echo "test-docker: no docker engine answering; starting colima"
      colima start >/dev/null 2>&1 || { echo "test-docker: colima start failed (run: colima start)" >&2; exit 2; }
      for _ in $(seq 60); do engine_up && break; sleep 2; done
      engine_up || { echo "test-docker: colima started but docker does not answer" >&2; exit 2; } ;;
    *) echo "test-docker: no docker engine answering (DOCKER_START=${DOCKER_START})" >&2; exit 2 ;;
  esac
fi

docker build -q --platform "$PLATFORM" -t "$IMAGE" -f "$ROOT/dev/test.Dockerfile" "$ROOT/dev" >/dev/null
lock="$(shasum "$SRC/fortisoar-widget-harness/pnpm-lock.yaml" | cut -c1-12)"

# The working tree as git sees it: tracked and untracked files, not ignored ones.
( cd "$SRC" && git ls-files -z -co --exclude-standard | COPYFILE_DISABLE=1 tar --null -T - -cf - ) \
| docker run --rm -i --platform "$PLATFORM" -e TESTS="$TESTS" -v "fsr-nm-$lock:/nm" "$IMAGE" bash -c '
    set -e
    mkdir -p /w && tar -xf - -C /w && cd /w
    git init -q -b main && git add -A && git commit -qm "test-docker source" && git update-ref refs/remotes/origin/main HEAD
    cd fortisoar-widget-harness && ln -s /nm node_modules
    pnpm install --frozen-lockfile --silent >/dev/null
    pnpm -s build >/dev/null
    SKIP_TOOLING_TESTS=0 pnpm exec jest --ci ${TESTS}'
