#!/usr/bin/env bash
# make test-e2e-docker SPEC=<files> | WIDGET=<name>: the widget e2e (Playwright) in a Linux container.
#
# Why: the host run takes ~9 minutes (process starts stall on the Mac host, a browser and two dev servers per run, and
# orphaned servers leak when a run dies). Here the harness dev servers AND the browser run inside one container
# (`--init`, `--rm`): when the run ends, passes, fails or is killed, the container and everything in it is gone, so
# nothing can be orphaned on the host. Specs build their URL from Playwright's baseURL (the run claims its own port
# inside the container), never a literal port.
#
# - Same engine handling as scripts/test_docker.sh (starts Colima when no engine answers; exit 2 = no engine).
# - The working tree streams in with tar (uncommitted work is tested); the widget's own repo rides along as a second
#   archive and lands at widgets-src/<name>. The gitignored app shell (fsr_src, ~200 MB) is cached in a docker volume
#   keyed by its listing, so it is copied once, not per run.
# - The harness's gitignored dev/cache rides along (see DEVDIR).
# - Linux node_modules live in a docker volume named by the lockfile hash.
# - Mock mode only: no box, no VPN. E2E_LIVE is forced empty.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="${TEST_DOCKER_SRC:-$ROOT}"
SPEC="${SPEC:-}"
WIDGET="${WIDGET:-}"
IMAGE="${E2E_DOCKER_IMAGE:-fsr-e2e}"
PLATFORM="${TEST_DOCKER_PLATFORM:-linux/arm64}"
[[ -n "$SPEC$WIDGET" ]] || { echo "usage: make test-e2e-docker SPEC=tests/e2e/<file>.spec.js   (or WIDGET=<widgetName>)" >&2; exit 2; }

engine_up() { docker info >/dev/null 2>&1; }
if ! engine_up; then
  case "${DOCKER_START:-colima}" in
    colima)
      command -v colima >/dev/null || { echo "test-e2e-docker: no docker engine and no colima (brew install colima docker)" >&2; exit 2; }
      echo "test-e2e-docker: no docker engine answering; starting colima"
      colima start >/dev/null 2>&1 || { echo "test-e2e-docker: colima start failed (run: colima start)" >&2; exit 2; }
      for _ in $(seq 60); do engine_up && break; sleep 2; done
      engine_up || { echo "test-e2e-docker: colima started but docker does not answer" >&2; exit 2; } ;;
    *) echo "test-e2e-docker: no docker engine answering (DOCKER_START=${DOCKER_START})" >&2; exit 2 ;;
  esac
fi

docker build -q --platform "$PLATFORM" -t "$IMAGE" -f "$ROOT/dev/e2e.Dockerfile" "$ROOT/dev" >/dev/null
lock="$(shasum "$SRC/fortisoar-widget-harness/pnpm-lock.yaml" | cut -c1-12)"

# The widget under test (the one a WIDGET= names; for SPEC= runs the widget whose folder the spec path names).
W="${TEST_DOCKER_WIDGET:-}"
if [[ -z "$W" ]]; then
  if [[ -n "$WIDGET" ]]; then W="$WIDGET"; elif [[ "$SPEC" =~ widgets-src/([^/]+)/ ]]; then W="${BASH_REMATCH[1]}"; fi
fi
WS="${TEST_DOCKER_WIDGETS_SRC:-$SRC/widgets-src}"

# The app shell: real files behind the tree's fsr_src links, cached in a volume named by their listing.
FS="$(cd "$SRC/fsr_src" 2>/dev/null && pwd -P || true)"
shell_vol=""
if [[ -n "$FS" && -d "$SRC/fsr_src" ]]; then
  shell_vol="fsr-shell-$( (cd "$SRC/fsr_src" && ls -lL . 2>/dev/null) | shasum | cut -c1-12)"
  if ! docker volume inspect "$shell_vol" >/dev/null 2>&1; then
    echo "test-e2e-docker: caching the app shell (fsr_src) in volume $shell_vol (once)"
    docker volume create "$shell_vol" >/dev/null
    COPYFILE_DISABLE=1 tar -chf - -C "$SRC/fsr_src" . | docker run --rm -i -v "$shell_vol:/shell" "$IMAGE" tar -xf - -C /shell \
      || { docker volume rm "$shell_vol" >/dev/null 2>&1; echo "test-e2e-docker: could not cache the app shell" >&2; exit 2; }
  fi
fi

# The harness's gitignored mock data (dev/cache: the model metadata and locale snapshots the hermetic tier serves). A
# worktree or agent tree does not carry it, so it comes from this tree, else from the shared checkout.
DEVDIR=""
for c in "$SRC/fortisoar-widget-harness" "$(bash "$ROOT/scripts/repo_paths.sh" root 2>/dev/null || true)/fortisoar-widget-harness"; do
  [[ -d "$c/dev/cache" ]] && { DEVDIR="$c"; break; }
done
pack() {
  bash "$(dirname "${BASH_SOURCE[0]}")/pack_tree.sh" "$SRC"
  [[ -z "$DEVDIR" ]] || COPYFILE_DISABLE=1 tar -chf - -C "$(dirname "$DEVDIR")" "$(basename "$DEVDIR")/dev"
  if [[ -n "$W" && -d "$WS/$W" ]]; then
    ( cd "$WS/$W" && git ls-files -z -co --exclude-standard | while IFS= read -r -d '' f; do
        [[ -e "$f" || -L "$f" ]] && printf '%s\0' "$W/$f"
      done ) | COPYFILE_DISABLE=1 tar --null -C "$WS" -T - -cf -
  fi
}

pack | docker run --rm -i --init --ipc=host --platform "$PLATFORM" -e SPEC="$SPEC" -e WIDGET="$WIDGET" -e W="$W" \
    -v "fsr-nm-e2e-$lock:/nm" ${shell_vol:+-v "$shell_vol:/shell:ro"} "$IMAGE" bash -c '
    set -e
    mkdir -p /w && tar -ixf - -C /w 2>/dev/null && cd /w
    if [ -n "$W" ] && [ -d "$W" ]; then mkdir -p widgets-src && rm -rf "widgets-src/$W" && mv "$W" "widgets-src/$W"; fi
    mkdir -p fsr_src
    if [ -d /shell ]; then for f in /shell/* /shell/.[!.]*; do b="fsr_src/$(basename "$f")"; [ -e "$f" ] || continue; if [ -e "$b" ] && [ ! -L "$b" ]; then continue; fi; rm -rf "$b"; ln -s "$f" "$b"; done; fi
    git init -q && git add -A >/dev/null 2>&1 && git commit -qm "e2e-docker source" >/dev/null 2>&1 || true
    cd fortisoar-widget-harness && ln -s /nm node_modules
    pnpm install --frozen-lockfile --silent >/dev/null
    pnpm -s build >/dev/null
    args=()
    if [ -n "$SPEC" ]; then for s in $(echo "$SPEC" | tr "," " "); do args+=("$s"); done; else args+=("/$WIDGET[./]"); fi
    VIA_MAKE=1 E2E_LIVE= WIDGETS_SRC=/w/widgets-src NODE_PATH=/w/fortisoar-widget-harness/node_modules \
      pnpm exec playwright test "${args[@]}" --reporter=list'
