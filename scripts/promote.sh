#!/usr/bin/env bash
# make promote REPO=<path> BRANCH=<branch>
#
# Merge a feature branch into LOCAL main only after live confirmation: a
# VERIFIED, clean live-sanity stamp for the branch head sha (written by
# a push target, or `make doctor BOX=<box> SANITY=1 STAMP=<repo dir>`):
#
#   ${FSR_LIVE_SANITY_DIR:-~/.cache/fsr-live-sanity}/<repo>/<sha>.json
#   { repo, path, branch, sha, dirty, box, verdict, checks, timestamp }
#
# <repo> is the basename of the main checkout (a worktree resolves to it).
# Tree rule (kept simple): a stamp for a DIFFERENT sha also proves the branch
# head when its commit has the identical tree (same content, e.g. a re-commit
# or an amend of the message). Nothing else is inferred.
#
# Merge: fast-forward when main is an ancestor of the branch, else a merge commit
# built in a temporary worktree (authored as the configured git user). main is
# then moved with `git merge --ff-only` inside whatever checkout has main checked
# out (git keeps unrelated WIP and refuses on overlap), or with update-ref when
# none does. Never pushes, never releases.
#
# ALLOW_UNVERIFIED=1 skips the stamp check; human only, refused under Claude Code.
# The reference-transaction hook (scripts/githooks) refuses any other update of
# main under Claude Code; this script hands it a one-shot allow file.
set -euo pipefail

die() { echo "promote: $*" >&2; exit 2; }

REPO="${REPO:-}"; BRANCH="${BRANCH:-}"; MAIN="${MAIN_BRANCH:-main}"
[ -n "$REPO" ] && [ -n "$BRANCH" ] || die "usage: make promote REPO=<path> BRANCH=<branch>"
[ -d "$REPO" ] || die "no such repo: $REPO"
command -v jq >/dev/null || die "jq is required"

if [ "${ALLOW_UNVERIFIED:-}" = 1 ] && [ -n "${CLAUDECODE:-}" ]; then
  die "ALLOW_UNVERIFIED=1 is a human-only override; refused under Claude Code. Run make doctor BOX=<box> SANITY=1 STAMP=<repo dir> first."
fi

g() { git -C "$REPO" "$@"; }
g rev-parse --git-dir >/dev/null 2>&1 || die "not a git repo: $REPO"
common="$(cd "$REPO" && cd "$(git rev-parse --git-common-dir)" && pwd)"
if [ "$(basename "$common")" = .git ]; then name="$(basename "$(dirname "$common")")"; else name="$(basename "$common")"; fi

head="$(g rev-parse --verify -q "refs/heads/$BRANCH^{commit}")" || die "no local branch '$BRANCH' in $REPO"
old="$(g rev-parse --verify -q "refs/heads/$MAIN^{commit}")" || die "no local '$MAIN' in $REPO"
[ "$BRANCH" != "$MAIN" ] || die "BRANCH is $MAIN"
if g merge-base --is-ancestor "$head" "$old"; then echo "promote: $BRANCH ($head) is already in $MAIN; nothing to do."; exit 0; fi

# --- proof --------------------------------------------------------------------
sdir="${FSR_LIVE_SANITY_DIR:-$HOME/.cache/fsr-live-sanity}/$name"
proof=""; why="no stamp for $head in $sdir"
check_stamp() {  # $1 = stamp file; sets proof or why
  local f="$1" v d s
  v="$(jq -r '.verdict // ""' "$f" 2>/dev/null)"; d="$(jq -r '.dirty' "$f" 2>/dev/null)"; s="$(jq -r '.sha // ""' "$f" 2>/dev/null)"
  if [ "$v" != VERIFIED ]; then why="stamp $(basename "$f") verdict is '${v:-?}', not VERIFIED"; return 1; fi
  if [ "$d" != false ]; then why="stamp $(basename "$f") was taken on a dirty tree (what ran was not that commit)"; return 1; fi
  proof="$f"; PROOF_SHA="$s"
}
PROOF_SHA=""
if [ -f "$sdir/$head.json" ]; then check_stamp "$sdir/$head.json" || true; fi
if [ -z "$proof" ] && [ -d "$sdir" ]; then
  tree="$(g rev-parse "$head^{tree}")"
  for f in "$sdir"/*.json; do
    [ -f "$f" ] || continue
    s="$(jq -r '.sha // ""' "$f" 2>/dev/null)"; [ -n "$s" ] && [ "$s" != "$head" ] || continue
    t="$(g rev-parse -q --verify "$s^{tree}" 2>/dev/null)" || continue
    [ "$t" = "$tree" ] || continue
    keep="$why"; check_stamp "$f" && break; why="$keep"
  done
fi
if [ -z "$proof" ]; then
  if [ "${ALLOW_UNVERIFIED:-}" = 1 ]; then
    echo "promote: WARNING no live proof ($why); ALLOW_UNVERIFIED=1 given by a human." >&2
  else
    die "refusing: $why. Run a push target (widget-push / deploy / ship-dev) or make doctor BOX=<box> SANITY=1 STAMP=<repo dir> with $BRANCH checked out clean at $head, then retry."
  fi
fi

tmp=""; wt=""; allow=""
cleanup() {
  [ -n "$allow" ] && rm -f "$allow"
  if [ -n "$wt" ]; then git -C "$REPO" worktree remove --force "$wt" >/dev/null 2>&1 || true; fi
  [ -n "$tmp" ] && rm -rf "$tmp"
  return 0
}
trap cleanup EXIT

# --- merge --------------------------------------------------------------------
if g merge-base --is-ancestor "$old" "$head"; then
  target="$head"; kind="fast-forward"
else
  tmp="$(mktemp -d "${TMPDIR:-/tmp}/promote.XXXXXX")"; wt="$tmp/wt"
  g worktree add --detach "$wt" "$old" >/dev/null 2>&1 || die "could not create a temp worktree of $MAIN"
  git -C "$wt" merge --no-ff --no-edit -m "Merge branch '$BRANCH'" "$head" >/dev/null \
    || { git -C "$wt" merge --abort >/dev/null 2>&1 || true; die "merge of $BRANCH into $MAIN conflicts; merge $MAIN into $BRANCH, re-run live-sanity, retry."; }
  target="$(git -C "$wt" rev-parse HEAD)"; kind="merge commit"
fi

# One-shot allow for the reference-transaction hook: exactly this main update.
allow="$common/fsr-promote-allow"
printf '%s %s\n' "$old" "$target" > "$allow"

# Where is main checked out (if anywhere)?
main_wt=""
while IFS= read -r line; do
  case "$line" in
    "worktree "*) cur="${line#worktree }" ;;
    "branch refs/heads/$MAIN") main_wt="$cur" ;;
  esac
done < <(g worktree list --porcelain)

if [ -n "$main_wt" ]; then
  git -C "$main_wt" merge --ff-only -q "$target" \
    || die "could not move $MAIN in $main_wt (uncommitted changes there overlap the merge). Nothing changed."
else
  g update-ref -m "promote: $BRANCH" "refs/heads/$MAIN" "$target" "$old"
fi

echo "promote: $name: merged $BRANCH ($head) into local $MAIN as $kind -> $target (not pushed)"
if [ -n "$proof" ]; then
  echo "promote: proof $(jq -r '"box=\(.box) verdict=\(.verdict) ts=\(.timestamp // .ts) sha=\(.sha)"' "$proof")"
  [ "$PROOF_SHA" = "$head" ] || echo "promote: (stamp is for $PROOF_SHA, identical tree to $head)"
fi
