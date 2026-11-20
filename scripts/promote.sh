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
# none does. Then pushes main to its upstream (NO_PUSH=1 skips). Never releases.
#
# A failed push ROLLS BACK: when this run moved main and the push is refused (a
# pre-push guard, the repo's own pre-push tests, the remote, the network), main
# goes back to where this run found it, so a refused push never leaves a local
# main that only a human can reset. The branch is untouched; fix it, re-stamp,
# re-run. (A main this run did not move, e.g. a re-run that finds the branch
# already merged, is left as it is and the push is just retried.)
#
# CI gate: when the branch head carries .github/required-checks (one GitHub
# check-run name per line, # comments), every listed check must have COMPLETED
# with success on that exact sha (gh api .../commits/<sha>/check-runs). Pending,
# missing or failed refuses. A head GitHub has never seen is pushed as its branch
# (never main, never --force) so CI starts; re-run promote when it is done. Only
# listed checks count: a continue-on-error job reports "failure" as a check-run.
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
# --- push ---------------------------------------------------------------------
# Every push runs FROM A DETACHED WORKTREE AT THE COMMIT BEING PUSHED. A repo's
# own pre-push (the connector's: its full-suite gate) runs from the pushing
# checkout and sources files there; pushed from the shared checkout, that was
# whatever branch another session had out, not the code being pushed.
push_commit() {  # push_commit <remote> <sha> <dst ref> [git push flags...]
  local remote="$1" sha="$2" dst="$3" pw rc; shift 3
  pw="$(mktemp -d "${TMPDIR:-/tmp}/promote-push.XXXXXX")"
  if ! g worktree add -q --detach "$pw/t" "$sha" >/dev/null 2>&1; then
    rm -rf "$pw"; echo "promote: could not make a worktree at ${sha:0:9} to push from" >&2; return 1
  fi
  git -C "$pw/t" push "$@" "$remote" "$sha:$dst"; rc=$?
  g worktree remove --force "$pw/t" >/dev/null 2>&1 || true; g worktree prune >/dev/null 2>&1 || true
  rm -rf "$pw"
  return $rc
}
# A promoted main is verified, so it goes to its remote (the user still owns
# releases and tags; this pushes the branch only, never a tag, never --force).
# Also runs when BRANCH is already in main, so re-running finishes a failed push.
push_main() {
  if [ "${NO_PUSH:-0}" = "1" ]; then echo "promote: NO_PUSH=1, $MAIN not pushed"; return 0; fi
  local up remote rbranch
  up="$(g rev-parse --abbrev-ref "$MAIN@{upstream}" 2>/dev/null || true)"
  if [ -z "$up" ]; then echo "promote: $MAIN has no upstream, not pushed"; return 0; fi
  remote="${up%%/*}"; rbranch="${up#*/}"
  if [ "$(g rev-parse "$MAIN")" = "$(g rev-parse --verify -q "refs/remotes/$up" || true)" ]; then
    echo "promote: $up already at $MAIN"; return 0
  fi
  echo "promote: pushing $MAIN to $remote/$rbranch (runs that repo's pre-push gate)"
  if push_commit "$remote" "$(g rev-parse "refs/heads/$MAIN")" "refs/heads/$rbranch"; then return 0; fi
  if [ "${MOVED:-0}" = 1 ]; then
    rollback_main
    die "the push to $up was refused, so local $MAIN was put back to $old (where this run found it). $BRANCH is unchanged: fix it, re-stamp it, and re-run make promote."
  fi
  die "the push to $up failed; local $MAIN was already at this commit before this run, so it is left as is. Fix the cause and re-run make promote (it retries the push)."
}

# Put main back to $old after a refused push: the exact reverse of the update
# this run made, announced to the reference-transaction hook the same way.
rollback_main() {
  printf '%s %s\n' "$target" "$old" > "$allow"
  if [ -n "$main_wt" ]; then
    # --keep: refuses rather than touch uncommitted changes that overlap the
    # files the promoted commits changed; unrelated WIP survives.
    git -C "$main_wt" reset -q --keep "$old" \
      || die "push refused AND could not restore $MAIN in $main_wt (uncommitted changes overlap). $MAIN is at $target; restore it with: git -C $main_wt reset --keep $old"
  else
    g update-ref -m "promote: roll back $BRANCH (push refused)" "refs/heads/$MAIN" "$old" "$target" \
      || die "push refused AND could not restore $MAIN; it is at $target, was $old"
  fi
  [ "$(g rev-parse "refs/heads/$MAIN")" = "$old" ] \
    || die "push refused and $MAIN did not return to $old; check it by hand"
  echo "promote: push refused; rolled local $MAIN back to $old" >&2
}

if g merge-base --is-ancestor "$head" "$old"; then echo "promote: $BRANCH ($head) is already in $MAIN."; push_main; exit 0; fi

# --- classify: tooling-only or shipped -----------------------------------------
# .github/tooling-paths (globs, one per line, # comments) lists paths whose
# proof is CI alone, with no box stamp. It is read from MAIN (the upstream main,
# else local main), never from the branch, so a branch cannot widen it for
# itself. Every path in the diff from the merge base counts, both sides of a
# rename or copy, deletes included; one path off the list makes it shipped.
policy_ref="$(g rev-parse -q --verify "refs/remotes/$(g rev-parse --abbrev-ref "$MAIN@{upstream}" 2>/dev/null || echo none)" 2>/dev/null || echo "$old")"
CLASS=shipped; class_why=""
tooling_globs="$(g show "$policy_ref:.github/tooling-paths" 2>/dev/null | sed 's/#.*//; s/^[[:space:]]*//; s/[[:space:]]*$//' | grep -v '^$' || true)"
if [ -n "$tooling_globs" ]; then
  mb="$(g merge-base "$old" "$head")"
  off=""; n=0
  while IFS=$'\t' read -r st p1 p2; do
    [ -n "$st" ] || continue
    for p in "$p1" ${p2:+"$p2"}; do
      n=$((n+1)); hit=""
      while IFS= read -r glob; do [[ "$p" == $glob ]] && { hit=1; break; }; done <<< "$tooling_globs"
      [ -n "$hit" ] || off="$off $p"
    done
  done < <(g diff --name-status -M "$mb" "$head")
  if [ "$n" -gt 0 ] && [ -z "$off" ]; then
    CLASS=tooling; class_why="all $n path(s) are on main's .github/tooling-paths"
  else
    class_why="shipped path(s):${off:- (empty diff)}"
  fi
else
  class_why="main has no .github/tooling-paths"
fi
echo "promote: classified $CLASS ($class_why)"

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
if [ -z "$proof" ] && [ "$CLASS" = tooling ]; then
  echo "promote: tooling-only: no box stamp needed; the proof is main's required CI on $head"
elif [ -z "$proof" ]; then
  if [ "${ALLOW_UNVERIFIED:-}" = 1 ]; then
    echo "promote: WARNING no live proof ($why); ALLOW_UNVERIFIED=1 given by a human." >&2
  else
    die "refusing: $why. Run a push target (widget-push / deploy / ship-dev) or make doctor BOX=<box> SANITY=1 STAMP=<repo dir> with $BRANCH checked out clean at $head, then retry."
  fi
fi

# --- CI gate ------------------------------------------------------------------
ci_gate() {
  local req up remote url slug runs missing="" bad="" name st co src="$head"
  # A tooling-only promote has no box stamp, so its CI list comes from main
  # (a branch could otherwise delete the checks that are its only proof).
  [ "$CLASS" = tooling ] && src="$policy_ref"
  req="$(g show "$src:.github/required-checks" 2>/dev/null | sed 's/#.*//; s/^[[:space:]]*//; s/[[:space:]]*$//' | grep -v '^$' || true)"
  if [ -z "$req" ]; then
    [ "$CLASS" = tooling ] && die "refusing: tooling-only needs CI, and main lists no .github/required-checks"
    return 0
  fi
  command -v gh >/dev/null || die "refusing: $BRANCH lists required CI checks but gh is not installed"
  up="$(g rev-parse --abbrev-ref "$MAIN@{upstream}" 2>/dev/null || true)"; remote="${up%%/*}"
  [ -n "$remote" ] || die "refusing: $BRANCH lists required CI checks but $MAIN tracks no remote"
  url="$(g remote get-url "$remote")"
  slug="$(printf '%s' "$url" | sed -E 's#^(https://github\.com/|git@github\.com:|ssh://git@github\.com/)##; s#\.git$##')"
  [ "$slug" != "$url" ] || die "refusing: $remote ($url) is not a GitHub remote; cannot read CI for $head"
  if ! runs="$(gh api "repos/$slug/commits/$head/check-runs?per_page=100" --jq '.check_runs[] | [.name, .status, (.conclusion // "")] | @tsv' 2>&1)"; then
    if printf '%s' "$runs" | grep -qiE 'No commit found|HTTP 422|HTTP 404'; then
      echo "promote: $head is not on GitHub yet; pushing $BRANCH so CI runs on it"
      push_commit "$remote" "$head" "refs/heads/$BRANCH" -q || die "refusing: could not push $BRANCH to start CI"
      die "refusing: CI has just started on $head. Re-run make promote once it finishes (gh run watch -R $slug)."
    fi
    die "refusing: could not read CI for $head: $runs"
  fi
  while IFS= read -r name; do
    st="$(printf '%s\n' "$runs" | awk -F'\t' -v n="$name" '$1==n {print $2"\t"$3}' | tail -1)"
    if [ -z "$st" ]; then missing="$missing '$name'"; continue; fi
    co="${st#*	}"; st="${st%%	*}"
    if [ "$st" != completed ]; then missing="$missing '$name'($st)"; elif [ "$co" != success ]; then bad="$bad '$name'($co)"; fi
  done <<< "$req"
  [ -z "$bad" ] || die "refusing: required CI failed on $head:$bad"
  if [ -n "$missing" ]; then
    printf '%s' "$runs" | grep -q . || { push_commit "$remote" "$head" "refs/heads/$BRANCH" -q 2>/dev/null || true; }
    die "refusing: required CI not finished on $head:$missing. Re-run make promote when it completes (gh run watch -R $slug)."
  fi
  echo "promote: CI green on $head ($(printf '%s' "$req" | paste -sd, -))"
}
if [ "${ALLOW_UNVERIFIED:-}" = 1 ] && [ "$CLASS" != tooling ]; then echo "promote: WARNING CI gate skipped (ALLOW_UNVERIFIED=1, human)" >&2; else ci_gate; fi

tmp=""; wt=""; allow=""; MOVED=0; main_wt=""; target=""
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
MOVED=1

echo "promote: $name: merged $BRANCH ($head) into local $MAIN as $kind -> $target"
if [ -n "$proof" ]; then
  echo "promote: proof $(jq -r '"box=\(.box) verdict=\(.verdict) ts=\(.timestamp // .ts) sha=\(.sha)"' "$proof")"
  [ "$PROOF_SHA" = "$head" ] || echo "promote: (stamp is for $PROOF_SHA, identical tree to $head)"
fi
push_main
