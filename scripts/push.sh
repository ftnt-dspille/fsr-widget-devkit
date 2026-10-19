#!/usr/bin/env bash
# make push -- ONE idempotent command to put your working trees on a box.
#
# WHAT IT DOES
#   1. connector + framework  -> conn_main scripts/dev_push.sh (seconds; also
#      auto-escalates to a bumped install when info.json adds a new op, so a new
#      operation registers without a release).
#   2. every CHANGED widget   -> the harness ship.sh, gated by a content hash
#      kept per box, so an unchanged widget is skipped. This is loop.sh's
#      single-widget trick generalized to all of widgets-src/.
#
# IDEMPOTENT
#   A widget whose tree has not changed since its last successful push to THIS
#   box is skipped (per-box stamp in ~/.cache/fsr-push). Re-running with nothing
#   changed pushes no widget. The connector step converges the box to your tree
#   (dev_push.sh verifies every worker reports this build), so it is safe to
#   re-run. DRY_RUN=1 prints the plan and changes nothing.
#
# NOT A RELEASE, NO GATES
#   No tests, lint or live smoke -- that is `make loop` (iterate) and
#   `make ship-verify` / `make release-ship` (release). This just deploys.
#
# USAGE
#   make push                                  # .env.159 / fsr159, changed widgets
#   make push ENV=.env.81 SSH_HOST=fsr81       # another box
#   make push WIDGETS=all                      # force every widget
#   make push WIDGETS=socAssistantMonitor      # only these (comma-separated)
#   make push CONNECTOR=0                       # widgets only, skip connector
#   make push DRY_RUN=1                         # show the plan, touch nothing
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # fsr_all_widgets
HARNESS="$ROOT/fortisoar-widget-harness"
CONN_REPO="${CONN_REPO:-$HOME/PycharmProjects/ConnectorsV2/conn_main}"
SSH_HOST="${SSH_HOST:-fsr159}"
ENV="${ENV:-.env.159}"
# ENV may be a bare name (.env.159) or a path; resolve to an absolute file under
# the harness, and keep the basename for the widget ship step.
case "$ENV" in
    /*) ENV_ABS="$ENV" ;;
    */*) ENV_ABS="$ROOT/$ENV" ;;
    *) ENV_ABS="$HARNESS/$ENV" ;;
esac
ENV_BASE="$(basename "$ENV_ABS")"
WIDGETS_SEL="${WIDGETS:-auto}"     # auto | all | name1,name2
CONNECTOR="${CONNECTOR:-1}"
DEV_PORT="${DEV_PORT:-14400}"
DRY_RUN="${DRY_RUN:-}"
STAMP_DIR="$HOME/.cache/fsr-push"
mkdir -p "$STAMP_DIR"

t_all=$SECONDS
summary=()
note() { summary+=("$(printf '%-7s %s' "$1" "$2")"); }
say()  { echo ">> $*"; }

[[ -f "$ENV_ABS" ]] || { echo "!! env file not found: $ENV_ABS" >&2; exit 2; }

# ----------------------------------------------------------------- 1 connector
if [[ "$CONNECTOR" != "0" ]]; then
    say "connector + framework -> $SSH_HOST (via dev_push.sh)"
    if [[ -n "$DRY_RUN" ]]; then
        note PLAN "connector + framework (dev_push.sh)"
    else
        SSH_HOST="$SSH_HOST" ENV="$ENV_ABS" bash "$CONN_REPO/scripts/dev_push.sh"
        note PASS "connector + framework"
    fi
else
    note SKIP "connector (CONNECTOR=0)"
fi

# ----------------------------------------------------------------- 2 widgets
# A widget is a dir under widgets-src/ that has a widget/ subtree to ship.
all_widgets() {
    for d in "$ROOT"/widgets-src/*/; do
        [[ -d "$d/widget" ]] || continue
        basename "$d"
    done
}
hash_widget() {  # content hash of a widget's shippable tree
    ( cd "$ROOT/widgets-src/$1/widget" && \
      find . -type f ! -name '.DS_Store' -print0 | sort -z \
      | xargs -0 shasum | shasum | cut -c1-12 )
}

case "$WIDGETS_SEL" in
    all)  mapfile -t selected < <(all_widgets) ;;
    auto) mapfile -t selected < <(all_widgets) ;;
    *)    IFS=',' read -r -a selected <<< "$WIDGETS_SEL" ;;
esac
force_all=0; [[ "$WIDGETS_SEL" == "all" || "$WIDGETS_SEL" != "auto" ]] && force_all=1

for name in "${selected[@]}"; do
    name="$(echo "$name" | tr -d '[:space:]')"
    [[ -n "$name" ]] || continue
    if [[ ! -d "$ROOT/widgets-src/$name/widget" ]]; then
        note SKIP "widget $name (not found)"; continue
    fi
    whash="$(hash_widget "$name")"
    wstamp="$STAMP_DIR/$name.$SSH_HOST"
    if [[ "$force_all" == "0" && "$(cat "$wstamp" 2>/dev/null)" == "$whash" ]]; then
        note SKIP "widget $name (unchanged $whash)"
        continue
    fi
    if [[ -n "$DRY_RUN" ]]; then
        note PLAN "widget $name ($whash)"
        continue
    fi
    say "widget $name -> $SSH_HOST:$ENV_BASE ($whash)"
    ( cd "$HARNESS" && FSR_ENV_FILE="$ENV_ABS" PORT="$DEV_PORT" \
        WIDGETS_SRC="$ROOT/widgets-src" scripts/ship.sh "$name" )
    echo "$whash" > "$wstamp"
    note PASS "widget $name ($whash)"
done

echo
printf '%s\n' "${summary[@]}"
echo "[[PUSH-${DRY_RUN:+DRY-}OK]] $SSH_HOST in $((SECONDS - t_all))s"
