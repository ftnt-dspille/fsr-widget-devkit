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
# TEST_DOCKER_WIDGET=<name> TEST_DOCKER_WIDGETS_SRC=<dir> (the widget unit loop): that widget's own repo rides along as a second archive
# (it is a separate git repo, so the root pack does not carry it) and is moved to widgets-src/<name> in the container.
WIDGET="${TEST_DOCKER_WIDGET:-}"
# Harness tests read the assistant widget's source (render parity, verdict vocabulary, card coverage) whichever widget
# is under test, so it rides along as support (never run: the WIDGET filter opts widgets in). Override: TEST_DOCKER_SUPPORT.
SUPPORT="${TEST_DOCKER_SUPPORT-agenticAssistant}"
WIDGETS_PACK=""
if [[ -n "$WIDGET" ]]; then
  WIDGETS_PACK="$WIDGET"
  IFS=',' read -r -a _tl <<< "$WIDGET"; WIDGETS_PACK="${_tl[*]}"
  for s in $SUPPORT; do case " $WIDGETS_PACK " in *" $s "*) ;; *) WIDGETS_PACK="$WIDGETS_PACK $s" ;; esac; done
fi
pack_widget() {  # pack_widget <name>: one widget repo (a separate git repo, so the root pack does not carry it)
  local ws="${TEST_DOCKER_WIDGETS_SRC:-$SRC/widgets-src}" w="$1"
  ( cd "$ws/$w" && git ls-files -z -co --exclude-standard | while IFS= read -r -d '' f; do
      [[ -e "$f" || -L "$f" ]] && printf '%s\0' "$w/$f"
    done ) | COPYFILE_DISABLE=1 tar --null -C "$ws" -T - -cf -
}
pack() {
  bash "$(dirname "${BASH_SOURCE[0]}")/pack_tree.sh" "$SRC"
  local ws="${TEST_DOCKER_WIDGETS_SRC:-$SRC/widgets-src}" w
  for w in $WIDGETS_PACK; do
    if [[ -d "$ws/$w" ]]; then pack_widget "$w"
    elif [[ " $WIDGET " == *" $w "* || ",$WIDGET," == *",$w,"* ]]; then echo "test-docker: no widget checkout at $ws/$w" >&2; exit 2
    fi
  done
}
pack \
| docker run --rm -i --platform "$PLATFORM" -e TESTS="$TESTS" -e WIDGET="$WIDGET" -e WIDGETS_PACK="$WIDGETS_PACK" -v "fsr-nm-$lock:/nm" "$IMAGE" bash -c '
    set -e
    mkdir -p /w && tar -ixf - -C /w && cd /w
    if [ -n "$WIDGET" ]; then mkdir -p widgets-src; for w in $WIDGETS_PACK; do if [ -d "$w" ]; then rm -rf "widgets-src/$w" && mv "$w" "widgets-src/$w"; fi; done; fi
    git init -q && git add -A && git commit -qm "test-docker source"
    cd fortisoar-widget-harness && ln -s /nm node_modules
    pnpm install --frozen-lockfile --silent >/dev/null
    pnpm -s build >/dev/null
    if [ -n "$WIDGET" ]; then NODE_PATH=/w/fortisoar-widget-harness/node_modules WIDGETS_SRC=/w/widgets-src SKIP_TOOLING_TESTS=1 pnpm exec jest --ci ${TESTS}; else SKIP_TOOLING_TESTS=0 pnpm exec jest --ci ${TESTS}; fi'
