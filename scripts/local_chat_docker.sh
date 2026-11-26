#!/usr/bin/env bash
# make local-chat-docker BUNDLE=<bundle> [ASK=...] [LLM=auto|frank|fake|anthropic] [MODEL=<id>]: one box-free chat turn
# (fortisoar-widget-harness/scripts/local-chat.sh, unchanged) with the real widget, the real connector and the
# browser all inside one Linux container; only the model is a network call out of it.
#
# The model: Frank (FRANK_BASE_URL / FRANK_API_KEY / FRANK_MODEL from the caller's environment) first; when Frank is
# not usable, paid Haiku with the key from the macOS keychain (service fsr-studio, account anthropic_api_key). Secrets
# reach the container as `-e NAME` (the value is read from this process's environment by docker, never put on a command
# line, never printed, never written to a file). LLM=fake needs neither.
#
# Inputs (env): CONN_REPO (connector tree), FSR_SRC (framework tree), OUT (where the turn's files land on the host),
# TIMEOUT (model-turn bound, seconds), plus the BUNDLE / ASK / RECORD / MODULE / LLM / MODEL local-chat.sh takes.
# Exit 2 = no container engine (the door falls back to the host). The container is --rm via a trap, so a killed run
# leaves nothing behind.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="${TEST_DOCKER_SRC:-$ROOT}"
BUNDLE="${BUNDLE:-}"
[[ -n "$BUNDLE" ]] || { echo "usage: make local-chat-docker BUNDLE=<bundle> [ASK=\"...\"] [LLM=auto|frank|fake|anthropic] [MODEL=<id>]" >&2; exit 2; }
CONN="${CONN_REPO:-$(bash "$ROOT/scripts/repo_paths.sh" conn)}"
FW="${FSR_SRC:-$(bash "$ROOT/scripts/repo_paths.sh" framework)}"
OUT="${OUT:-$ROOT/scratch/local-chat/${BUNDLE##*/}-$(date +%H%M%S)}"
IMAGE="${CHAT_DOCKER_IMAGE:-fsr-chat}"
PLATFORM="${TEST_DOCKER_PLATFORM:-linux/arm64}"
W="${TEST_DOCKER_WIDGET:-agenticAssistant}"
WS="${TEST_DOCKER_WIDGETS_SRC:-$SRC/widgets-src}"
LLM="${LLM:-auto}"
mkdir -p "$OUT"

engine_up() { docker info >/dev/null 2>&1; }
if ! engine_up; then
  case "${DOCKER_START:-colima}" in
    colima)
      command -v colima >/dev/null || { echo "local-chat-docker: no docker engine and no colima (brew install colima docker)" >&2; exit 2; }
      echo "local-chat-docker: no docker engine answering; starting colima"
      colima start >/dev/null 2>&1 || { echo "local-chat-docker: colima start failed (run: colima start)" >&2; exit 2; }
      for _ in $(seq 60); do engine_up && break; sleep 2; done
      engine_up || { echo "local-chat-docker: colima started but docker does not answer" >&2; exit 2; } ;;
    *) echo "local-chat-docker: no docker engine answering (DOCKER_START=${DOCKER_START})" >&2; exit 2 ;;
  esac
fi

docker build -q --platform "$PLATFORM" -t "$IMAGE" -f "$ROOT/dev/chat.Dockerfile" "$ROOT/dev" >/dev/null
lock="$(shasum "$SRC/fortisoar-widget-harness/pnpm-lock.yaml" | cut -c1-12)"
reqs="$(cat "$CONN"/connector-*/requirements.txt | grep -v '^fsr-playbooks==' ; cat "$FW/pyproject.toml")"
pykey="chat-v2-$(printf '%s' "$reqs" | shasum | cut -c1-12)"

# The app shell and the harness's gitignored dev/cache: same handling as scripts/e2e_docker.sh.
shell_vol=""
if [[ -d "$SRC/fsr_src" ]]; then
  shell_vol="fsr-shell-$( (cd "$SRC/fsr_src" && ls -lL . 2>/dev/null) | shasum | cut -c1-12)"
  if ! docker volume inspect "$shell_vol" >/dev/null 2>&1; then
    echo "local-chat-docker: caching the app shell (fsr_src) in volume $shell_vol (once)"
    docker volume create "$shell_vol" >/dev/null
    COPYFILE_DISABLE=1 tar -chf - -C "$SRC/fsr_src" . | docker run --rm -i -v "$shell_vol:/shell" "$IMAGE" tar -xf - -C /shell \
      || { docker volume rm "$shell_vol" >/dev/null 2>&1; echo "local-chat-docker: could not cache the app shell" >&2; exit 2; }
  fi
fi
DEVDIR=""
for c in "$SRC/fortisoar-widget-harness" "$(bash "$ROOT/scripts/repo_paths.sh" root 2>/dev/null || true)/fortisoar-widget-harness"; do
  [[ -d "$c/dev/cache" ]] && { DEVDIR="$c"; break; }
done

# The model's credentials, by name only. Paid Haiku is the fallback when Frank is down (the sidecar decides; this
# only makes the key available, from the keychain, to the docker child process and nowhere else).
if [[ "$LLM" != fake && -z "${ANTHROPIC_API_KEY:-}" ]] && command -v security >/dev/null 2>&1; then
  k="$(security find-generic-password -s fsr-studio -a anthropic_api_key -w 2>/dev/null || true)"
  [[ -z "$k" ]] || export ANTHROPIC_API_KEY="$k"
  unset k
fi
envs=()
for n in FRANK_BASE_URL FRANK_API_KEY FRANK_MODEL ANTHROPIC_API_KEY; do [[ -n "${!n:-}" ]] && envs+=(-e "$n"); done

pack_one() { bash "$ROOT/scripts/pack_tree.sh" "$1"; }
stage="$(mktemp -d "${TMPDIR:-/tmp}/local-chat-docker.XXXXXX")"
name="fsr-chat-$$-$RANDOM"
cleanup() { docker rm -f "$name" >/dev/null 2>&1 || true; rm -rf "$stage"; }
trap cleanup EXIT
pack_one "$SRC" > "$stage/root.tar"
pack_one "$CONN" > "$stage/conn.tar"
pack_one "$FW" > "$stage/fw.tar"
if [[ -d "$WS/$W" ]]; then
  ( cd "$WS/$W" && git ls-files -z -co --exclude-standard | while IFS= read -r -d '' f; do
      [[ -e "$f" || -L "$f" ]] && printf '%s\0' "$W/$f"
    done ) | COPYFILE_DISABLE=1 tar --null -C "$WS" -T - -cf - > "$stage/widget.tar"
else : > "$stage/widget.tar"; fi
if [[ -n "$DEVDIR" ]]; then COPYFILE_DISABLE=1 tar -chf "$stage/dev.tar" -C "$(dirname "$DEVDIR")" "$(basename "$DEVDIR")/dev"; else : > "$stage/dev.tar"; fi
tar -cf "$stage/in.tar" -C "$stage" root.tar conn.tar fw.tar widget.tar dev.tar

set +e
docker run --name "$name" -i --init --ipc=host --platform "$PLATFORM" \
    -e BUNDLE="$BUNDLE" -e ASK="${ASK:-}" -e RECORD="${RECORD:-}" -e MODULE="${MODULE:-}" -e LLM="$LLM" -e MODEL="${MODEL:-}" \
    -e TIMEOUT="${TIMEOUT:-600}" -e W="$W" \
    ${envs[@]+"${envs[@]}"} \
    -v "fsr-nm-e2e-$lock:/nm" -v "fsr-pyenv-$pykey:/venv" ${shell_vol:+-v "$shell_vol:/shell:ro"} "$IMAGE" bash -c '
    set -e
    mkdir -p /in /w/connector /w/framework && tar -xf - -C /in
    tar -xf /in/root.tar -C /w 2>/dev/null
    tar -xf /in/conn.tar -C /w/connector 2>/dev/null
    tar -xf /in/fw.tar -C /w/framework 2>/dev/null
    [ -s /in/dev.tar ] && tar -xf /in/dev.tar -C /w 2>/dev/null
    cd /w
    if [ -s /in/widget.tar ]; then tar -xf /in/widget.tar -C /w 2>/dev/null; mkdir -p widgets-src; rm -rf "widgets-src/$W"; mv "$W" "widgets-src/$W"; fi
    mkdir -p fsr_src
    if [ -d /shell ]; then for f in /shell/* /shell/.[!.]*; do b="fsr_src/$(basename "$f")"; [ -e "$f" ] || continue; if [ -e "$b" ] && [ ! -L "$b" ]; then continue; fi; rm -rf "$b"; ln -s "$f" "$b"; done; fi
    for d in /w/connector /w/framework; do ( cd $d && git init -q && git add -A && git commit -qm src ) >/dev/null 2>&1 || true; done
    if [ ! -f /venv/.ok ]; then
      uv venv -q --clear --python 3.12 /venv
      cat /w/connector/connector-*/requirements.txt | grep -v "^fsr-playbooks==" > /tmp/req.txt
      python3 -c "import tomllib; print(chr(10).join(tomllib.load(open(\"/w/framework/pyproject.toml\", \"rb\"))[\"project\"][\"dependencies\"]))" >> /tmp/req.txt
      printf "%s\n" python-dotenv requests pytest >> /tmp/req.txt
      uv pip install -q --python /venv/bin/python -r /tmp/req.txt
      touch /venv/.ok
    fi
    # The platform engine is not on PyPI: the same three-name stub the connector suites use, so the connector imports.
    sp="$(/venv/bin/python -c "import sysconfig;print(sysconfig.get_paths()[\"purelib\"])")"
    mkdir -p "$sp/connectors/core"; : > "$sp/connectors/__init__.py"; : > "$sp/connectors/core/__init__.py"
    printf "import logging\nclass Connector:\n    pass\nclass ConnectorError(Exception):\n    pass\ndef get_logger(name):\n    return logging.getLogger(name)\n" > "$sp/connectors/core/connector.py"
    uv pip install -q --python /venv/bin/python --no-deps -e /w/framework/packaging/fsr_playbooks >/dev/null
    cd fortisoar-widget-harness
    ln -s /nm node_modules; ln -sfn /venv .venv-localdev
    pnpm install --frozen-lockfile --silent >/dev/null
    pnpm -s build >/dev/null
    # The widget ships compiled assets (fsrPbRender.js from its .ts) that are gitignored build output: compile them,
    # as the e2e config and jest do, or the widget cannot render the turn.
    WIDGETS_SRC=/w/widgets-src node -e "const a=require(\"./lib/widgetAssets\");a.buildAllWidgetAssets(a.widgetRoots())" >/dev/null
    export CONN_REPO=/w/connector FSR_SRC=/w/framework FSRPB_DEV=1 OUT=/out WIDGETS_SRC=/w/widgets-src
    export PYTHONPATH=/w/framework:/w/framework/tooling NODE_PATH=/w/fortisoar-widget-harness/node_modules
    export FSRPB_SIDECAR_ANTHROPIC_FALLBACK=1
    mkdir -p /out
    set +e; bash scripts/local-chat.sh; rc=$?
    exit $rc' < "$stage/in.tar"
rc=$?
set -e
docker cp "$name:/out/." "$OUT/" >/dev/null 2>&1 || true
exit "$rc"
