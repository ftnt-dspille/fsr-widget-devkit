#!/usr/bin/env bash
# make promote REPO=<path|name> BRANCH=<branch>
#
# REPO is a path, or a name (framework, connector, root, agenticAssistant,
# agenticAssistantMonitor) resolved by scripts/repo_paths.sh to the copy of the
# tree the caller is in (an agent tree via AGENT_TREE, or a worktree of that repo),
# else the shared checkout. Ambiguous (inside a worktree of another repo): refuses
# and asks for a path.
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
# CI gate (runs first, before the stamp check): when the branch head carries .github/required-checks (one GitHub
# check-run name per line, # comments), every listed check must have COMPLETED
# with success on that exact sha (gh api .../commits/<sha>/check-runs). Pending,
# missing or failed refuses. A head GitHub has never seen is pushed as its branch
# (never main, never --force) so CI starts; re-run promote when it is done. Only
# listed checks count: a continue-on-error job reports "failure" as a check-run.
#
# ALLOW_UNVERIFIED=1 skips the stamp check; human only, refused under Claude Code.
# CLASSIFY_ONLY=1 prints the shipped/tooling classification and exits.
# PROMOTE_DRY_RUN=1 runs every check (classification, CI, stamp) and stops before the merge.
# The reference-transaction hook (scripts/githooks) refuses any other update of
# main under Claude Code; this script hands it a one-shot allow file.
set -euo pipefail

die() { echo "promote: $*" >&2; exit 2; }

REPO="${REPO:-}"; BRANCH="${BRANCH:-}"; MAIN="${MAIN_BRANCH:-main}"
[ -n "$REPO" ] && [ -n "$BRANCH" ] || die "usage: make promote REPO=<path|name> BRANCH=<branch>"
if [ ! -d "$REPO" ] && [[ "$REPO" != */* ]]; then
  _rp="${FSR_TOOL_HOME:-}/scripts/repo_paths.sh"
  if [ "${FROM_TREE:-}" != 1 ] && [ -n "${FSR_TOOL_HOME:-}" ]; then   # policy from root main, like this script
    _rem="$(git -C "$FSR_TOOL_HOME" for-each-ref --format='%(upstream:remotename)' refs/heads/main)"; _rem="${_rem:-origin}"
    _rpt="$(mktemp "${TMPDIR:-/tmp}/repo_paths.XXXXXX")"; trap 'rm -f "$_rpt"' EXIT
    if git -C "$FSR_TOOL_HOME" show "refs/remotes/$_rem/main:scripts/repo_paths.sh" > "$_rpt" 2>/dev/null; then _rp="$_rpt"; fi
  fi
  [ -f "$_rp" ] || die "no such repo: $REPO (and no scripts/repo_paths.sh to resolve it as a name)"
  _resolved="$(bash "$_rp" resolve "$REPO")" || die "cannot resolve REPO=$REPO to one tree; pass the path: REPO=<path>"
  echo "promote: REPO=$REPO resolved to $_resolved"; REPO="$_resolved"
fi
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
# "shipped" means "changes what is installed on a box". For a repo with `ship`
# lines in .github/package-inputs (root main's copy: the ONE definition, also read
# by the connector's stable_guard.py) a path counts as shipped only when it is under
# one of them; everything else (dev scripts, tests, Makefile, docs) is tooling and
# its proof is CI. .github/ is always shipped: it is the policy itself. A repo with
# no `ship` line keeps the older rule: every path must be on tooling-paths.
tool_file() {  # tool_file <repo-relative path> -> contents, from root main (or the tree under FROM_TREE=1)
  local rel="$1" home="${FSR_TOOL_HOME:-}" rem
  if [ -z "$home" ]; then home="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"; fi
  if [ "${FROM_TREE:-}" = 1 ] || [ -z "${FSR_TOOL_HOME:-}" ]; then cat "$home/$rel" 2>/dev/null; return; fi
  rem="$(git -C "$home" for-each-ref --format='%(upstream:remotename)' refs/heads/main)"; rem="${rem:-origin}"
  git -C "$home" show "refs/remotes/$rem/main:$rel" 2>/dev/null
}
package_inputs() {  # package_inputs <repo name> -> `ship` paths, one per line
  tool_file .github/package-inputs | sed 's/#.*//' | awk -v r="$1" '$1==r && $2=="ship" {print $3}'
}
is_package_input() {  # is_package_input <path> <inputs...>
  local p="$1" i; shift
  case "$p" in .github/*) return 0 ;; esac
  for i in "$@"; do
    [ "$i" = . ] && return 0
    [[ "$p" == "$i" || "$p" == "$i"/* ]] && return 0
  done
  return 1
}
pkg_inputs="$(package_inputs "$name" || true)"
# The connector's main checkout is the bare-repo worktree "fsr-playbook-builder", but package-inputs names
# it conn_main (the name its stable guard and its path use): same repo, one set of lines.
[ -n "$pkg_inputs" ] || [ "$name" != fsr-playbook-builder ] || pkg_inputs="$(package_inputs conn_main || true)"
CLASS=shipped; class_why=""
tooling_globs="$(g show "$policy_ref:.github/tooling-paths" 2>/dev/null | sed 's/#.*//; s/^[[:space:]]*//; s/[[:space:]]*$//' | grep -v '^$' || true)"
if [ -n "$pkg_inputs" ]; then
  mb="$(g merge-base "$old" "$head")"
  off=""; n=0
  read -r -a _in <<< "$(printf '%s ' $pkg_inputs)"
  while IFS=$'\t' read -r st p1 p2; do
    [ -n "$st" ] || continue
    for p in "$p1" ${p2:+"$p2"}; do
      n=$((n+1))
      if is_package_input "$p" "${_in[@]}"; then off="$off $p"; fi
    done
  done < <(g diff --name-status -M "$mb" "$head")
  if [ "$n" -gt 0 ] && [ -z "$off" ]; then
    CLASS=tooling; class_why="all $n path(s) are outside $name's package inputs (${_in[*]})"
  else
    class_why="package input path(s):${off:- (empty diff)}"
  fi
elif [ -n "$tooling_globs" ]; then
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
[ "${CLASSIFY_ONLY:-}" = 1 ] && { echo "promote: CLASSIFY_ONLY=1, nothing merged"; exit 0; }

# --- CI gate (first) ----------------------------------------------------------
# CI comes BEFORE the stamp check: a required check that goes red on the branch
# head (the connector's 'test (bundled framework)' leg, which a local run does
# not mirror) used to surface only after the live proof was already spent.
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
  echo "promote: checking required CI first (before the stamp and merge checks): $(printf '%s' "$req" | paste -sd, -) on ${head:0:9}; waits for it to finish if it is still running"
  command -v gh >/dev/null || die "refusing: $BRANCH lists required CI checks but gh is not installed"
  up="$(g rev-parse --abbrev-ref "$MAIN@{upstream}" 2>/dev/null || true)"; remote="${up%%/*}"
  [ -n "$remote" ] || die "refusing: $BRANCH lists required CI checks but $MAIN tracks no remote"
  url="$(g remote get-url "$remote")"
  slug="$(printf '%s' "$url" | sed -E 's#^(https://github\.com/|git@github\.com:|ssh://git@github\.com/)##; s#\.git$##')"
  [ "$slug" != "$url" ] || die "refusing: $remote ($url) is not a GitHub remote; cannot read CI for $head"
  # Wait for CI here rather than refusing and asking for a re-run: poll the
  # check-runs until every required check has completed (PROMOTE_CI_WAIT
  # seconds, default 900; PROMOTE_CI_POLL between polls, default 15). A head
  # GitHub has not seen is pushed as its branch first, so CI starts.
  local wait_s="${PROMOTE_CI_WAIT:-900}" poll="${PROMOTE_CI_POLL:-15}" pushed=0 deadline said=""
  deadline=$((SECONDS + wait_s))
  local wait_t0=$SECONDS
  while :; do
    missing=""; bad=""
    if ! runs="$(gh api "repos/$slug/commits/$head/check-runs?per_page=100" --jq '.check_runs[] | [.name, .status, (.conclusion // "")] | @tsv' 2>&1)"; then
      if printf '%s' "$runs" | grep -qiE 'No commit found|HTTP 422|HTTP 404'; then
        if [ "$pushed" = 0 ]; then
          echo "promote: $head is not on GitHub yet; pushing $BRANCH so CI runs on it"
          push_commit "$remote" "$head" "refs/heads/$BRANCH" -q || die "refusing: could not push $BRANCH to start CI"
          pushed=1
        fi
        runs=""; missing=" (CI has not started on $head yet)"
      else
        die "refusing: could not read CI for $head: $runs"
      fi
    else
      while IFS= read -r name; do
        st="$(printf '%s\n' "$runs" | awk -F'\t' -v n="$name" '$1==n {print $2"\t"$3}' | tail -1)"
        if [ -z "$st" ]; then missing="$missing '$name'"; continue; fi
        co="${st#*	}"; st="${st%%	*}"
        if [ "$st" != completed ]; then missing="$missing '$name'($st)"; elif [ "$co" != success ]; then bad="$bad '$name'($co)"; fi
      done <<< "$req"
      [ -z "$bad" ] || die "refusing: required CI failed on $head:$bad"
      [ -n "$missing" ] || break
      if [ "$pushed" = 0 ] && ! printf '%s' "$runs" | grep -q .; then
        push_commit "$remote" "$head" "refs/heads/$BRANCH" -q 2>/dev/null || true; pushed=1
      fi
    fi
    [ "$SECONDS" -lt "$deadline" ] || die "refusing: required CI not finished on $head after ${wait_s}s:$missing (gh run watch -R $slug, then re-run make promote)"
    [ -n "$said" ] || { echo "promote: waiting for CI on ${head:0:9}:$missing (up to ${wait_s}s)"; said=1; }
    sleep "$poll"
  done
  # The wait is CI's time, not promote's: its own ledger line (300s budget).
  if (( SECONDS - wait_t0 > 0 )) && [ -n "$said" ]; then
    local ws=$((SECONDS - wait_t0)) wb="${PROMOTE_CI_WAIT_BUDGET:-300}" led="${FSR_LAP_LEDGER:-$HOME/.cache/fsr-laps.tsv}"
    (( ws > wb )) && echo "lap: WARNING promote ci-wait took ${ws}s, budget ${wb}s (a CI problem, not promote's)" >&2
    [ -n "${LAP_EXCLUDE_FILE:-}" ] && echo "$ws" >> "$LAP_EXCLUDE_FILE"   # off the enclosing promote lap
    mkdir -p "$(dirname "$led")" 2>/dev/null
    printf '%s\tpromote ci-wait\t%s\t0\t%s\t%s\t-\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$ws" "$wb" "$(basename "$REPO")" >> "$led" 2>/dev/null || true
    echo "promote: waited ${ws}s for CI"
  fi
  echo "promote: CI green on $head ($(printf '%s' "$req" | paste -sd, -))"
}
if [ "${ALLOW_UNVERIFIED:-}" = 1 ] && [ "$CLASS" != tooling ]; then echo "promote: WARNING CI gate skipped (ALLOW_UNVERIFIED=1, human)" >&2; else ci_gate; fi

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

if [ "${PROMOTE_DRY_RUN:-}" = 1 ]; then
  echo "promote: DRY RUN: $BRANCH (${head:0:9}) is ready to merge into $MAIN (CI and proof checked); nothing merged"
  exit 0
fi


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
