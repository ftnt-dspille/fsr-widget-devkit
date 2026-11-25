#!/usr/bin/env bash
# The connector's or the framework's pytest suites in a Linux container. Internal to the doors (door.sh
# check and ship, release_check.sh); there is no make target for it.
#
#   devloop_docker_py.sh connector <connector dir> [pytest args...]
#     DEVLOOP_FRAMEWORK_DIR  the framework checkout the suite runs against (the bundled leg)
#   devloop_docker_py.sh framework <framework dir> [pytest args...]
#     one suite per call (tooling/tests or fsr_playbooks/tests: the framework refuses a process that mixes them)
#
# Why: the suite spawns git/bash/make in bulk and process starts stall on the Mac host: ~290-520s
# there, 110-150s here, same tests, same markers, same verdict. Exit 75 = no container engine (the
# caller falls back to the host); otherwise pytest's rc. Coverage equals CI's: the widget checkouts
# are not in the container, so the parity checks that need them skip, as they do in CI.
#
# Mechanics mirror scripts/test_docker.sh: the working tree streams in as tar (tracked and
# untracked, not ignored: uncommitted work is tested), no host mount. The Python env lives in a
# docker volume named by the hash of the dependency inputs, so a warm run installs nothing.
# Test hooks: DEVLOOP_PY_IMAGE, DEVLOOP_PY_PLATFORM, DOCKER_START (as test_docker.sh).
set -euo pipefail
suite="${1:-}"; repo="${2:-}"; shift 2 || true
[[ "$suite" == connector || "$suite" == framework ]] || { echo "usage: $0 connector|framework <repo dir> [pytest args]" >&2; exit 64; }
[[ -d "$repo" ]] || { echo "devloop_docker_py: no such repo dir: $repo" >&2; exit 64; }
repo="$(cd "$repo" && pwd)"
fw="${DEVLOOP_FRAMEWORK_DIR:-}"
IMAGE="${DEVLOOP_PY_IMAGE:-fsr-test-py}"
PLATFORM="${DEVLOOP_PY_PLATFORM:-linux/arm64}"

engine_up() { docker info >/dev/null 2>&1; }
if ! engine_up; then
  case "${DOCKER_START:-colima}" in
    colima)
      command -v colima >/dev/null || { echo "devloop_docker_py: no docker engine and no colima" >&2; exit 75; }
      echo "devloop_docker_py: no docker engine answering; starting colima"
      colima start >/dev/null 2>&1 || { echo "devloop_docker_py: colima start failed" >&2; exit 75; }
      for _ in $(seq 60); do engine_up && break; sleep 2; done
      engine_up || { echo "devloop_docker_py: colima started but docker does not answer" >&2; exit 75; } ;;
    *) echo "devloop_docker_py: no docker engine answering (DOCKER_START=${DOCKER_START:-})" >&2; exit 75 ;;
  esac
fi

# The image: Python, git (the suites spawn it), uv. Built from stdin, so no file to keep in sync.
docker build -q --platform "$PLATFORM" -t "$IMAGE" - >/dev/null <<'DOCKERFILE'
FROM python:3.12-bookworm
RUN apt-get update -qq && apt-get install -y -qq git make jq rsync >/dev/null \
 && pip install -q uv \
 && git config --system user.email t@example.com && git config --system user.name t \
 && git config --system --add safe.directory '*'
DOCKERFILE

# The environment, as CI builds it, keyed by what it is built from.
if [[ "$suite" == connector ]]; then
  reqs="$(cat "$repo"/connector-*/requirements.txt | grep -v '^fsr-playbooks==' ; cat "$repo/pyproject.toml")"
else
  reqs="$(cat "$repo/pyproject.toml")"
fi
key="$suite-v2-$(printf '%s' "$reqs" | shasum | cut -c1-12)"

# Tree(s) in: repo at /w/repo, framework (when given) at /w/fw.
pack() { bash "$(dirname "${BASH_SOURCE[0]}")/pack_tree.sh" "$1"; }
stage="$(mktemp -d "${TMPDIR:-/tmp}/devloop-py.XXXXXX")"; trap 'rm -rf "$stage"' EXIT
pack "$repo" > "$stage/repo.tar"
if [[ -n "$fw" ]]; then pack "$fw" > "$stage/fw.tar"; else : > "$stage/fw.tar"; fi
tar -cf "$stage/in.tar" -C "$stage" repo.tar fw.tar

docker run --rm -i --platform "$PLATFORM" -e HAS_FW="${fw:+1}" -e SUITE="$suite" -v "fsr-pyenv-$key:/venv" "$IMAGE" bash -c '
    set -e
    mkdir -p /in /w/repo /w/fw && tar -xf - -C /in
    tar -xf /in/repo.tar -C /w/repo
    [ -n "$HAS_FW" ] && tar -xf /in/fw.tar -C /w/fw
    for d in /w/repo /w/fw; do ( cd $d && git init -q && git add -A && git commit -qm src ) >/dev/null 2>&1 || true; done
    if [ ! -x /venv/bin/python ] || [ ! -f /venv/.ok ]; then
      uv venv -q --clear --python 3.12 /venv
      if [ "$SUITE" = connector ]; then
        cat /w/repo/connector-*/requirements.txt | grep -v "^fsr-playbooks==" > /tmp/req.txt
      else
        # the dependency list only: pyproject [tool.uv.sources] points at a sibling checkout the container does not have
        python3 -c "import tomllib; print(chr(10).join(tomllib.load(open(\"/w/repo/pyproject.toml\", \"rb\"))[\"project\"][\"dependencies\"]))" > /tmp/req.txt
      fi
      uv pip install -q --python /venv/bin/python -r /tmp/req.txt \
        "pytest>=7" "pytest-randomly>=3" "pytest-timeout>=2" "pytest-xdist>=3" "python-dotenv>=1" "ruff==0.15.20"
      touch /venv/.ok
    fi
    PY=/venv/bin/python; export PATH=/venv/bin:$PATH
    cd /w/repo
    export FSRPB_DEV=1
    if [ "$SUITE" = framework ]; then export PYTHONPATH=/w/repo; fi
    if [ -n "$HAS_FW" ]; then export FSRPB_FRAMEWORK_DIR=/w/fw PYTHONPATH=/w/fw:/w/fw/tooling; fi
    exec $PY -m pytest -q --no-header -n auto -p no:randomly "$@"' _ "$@" < "$stage/in.tar"
