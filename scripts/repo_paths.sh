#!/usr/bin/env bash
# The ONE place the connector and framework repo locations are decided for this
# repo (Makefile, live-sanity, push, the widget harness sidecar, the agreement
# check). Nothing else carries a `PycharmProjects/...` default.
#
#   bash scripts/repo_paths.sh conn        # connector repo root   (CONN_REPO)
#   bash scripts/repo_paths.sh framework   # framework repo root   (FSR_FRAMEWORK_REPO)
#
# Precedence, per name: the explicit env var, then FSR_MONOREPO (<mono>/connector
# and <mono>/framework once the two repos are one), then today's sibling clones.
set -u
what="${1:-}"
case "$what" in
  conn)
    if [ -n "${CONN_REPO:-}" ]; then printf '%s\n' "$CONN_REPO"
    elif [ -n "${FSR_MONOREPO:-}" ]; then printf '%s\n' "$FSR_MONOREPO/connector"
    else printf '%s\n' "$HOME/PycharmProjects/ConnectorsV2/conn_main"; fi ;;
  framework)
    if [ -n "${FSR_FRAMEWORK_REPO:-}" ]; then printf '%s\n' "$FSR_FRAMEWORK_REPO"
    elif [ -n "${FSR_MONOREPO:-}" ]; then printf '%s\n' "$FSR_MONOREPO/framework"
    else printf '%s\n' "$HOME/PycharmProjects/fsr-playbook-framework"; fi ;;
  *) echo "usage: repo_paths.sh conn|framework" >&2; exit 2 ;;
esac
