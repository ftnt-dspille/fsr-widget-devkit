---
name: worktree-test-env
description: Use when running tests or probes from a git worktree or a shared clone, when a test result might be measuring the wrong source (stale wheel, other agent's branch, wrong venv), when e2e fails in a mass/uniform way, or when briefing a subagent on test environment setup.
---

# Worktrees, venvs and "am I testing the code I think I am"

## Shared state hazards
- Other agents share the checkouts. `git status` can look empty or foreign minutes after you wrote
  files (another session stashed/checked out). Commit your own paths early with
  `git commit --only <paths>` and fix forward in small commits. Never `git stash`/`pop`/rebase
  over unrelated WIP; use `git worktree add <scratch>/wt_<name> -b <branch> <base>`.
- Verify a commit in isolation: `git worktree add --detach <scratch>/verify <sha>` and run pytest with
  `PYTHONPATH=<worktree>` (beats the editable `.pth`). Run connector tests the same way.
- Dev-push only committed framework code: `FSR_SRC=<worktree> make loop BOX=<alias>`, otherwise another
  session's WIP rides to the box. A clean worktree also exposes tests that depended on the gitignored
  dev reference DB (use `default_db_path()`, never `data/fsr_reference.db`).
- There was a second stale clone of the framework with the same remote; work only in the canonical
  clone and check `git log` on both before concluding something "is not shipped".
- Worktrees under the OS temp dir vanish on reboot; only branches survive. `git worktree prune` first.

## Python env (connector repo)
- One declared env, one resolver: `scripts/dev_env.sh`. The venv is shared by all checkouts and
  stamped with a hash of `requirements.txt`/`pyproject.toml`. Running `make setup` from a worktree
  whose requirements differ re-stamps it and breaks other sessions' targets; re-run `make setup`
  from the main checkout straight after and say so.
- Never `uv run` (builds an env without `fsr_playbooks`); never system python. Use the venv python,
  `FSRPB_DEV=1`, and `uv pip install --python <venv>/bin/python ...` (plain pip fails here).
- A stale built `fsr_playbooks` wheel directory inside site-packages can shadow the editable install.
  If source edits have no effect, check `python -c "import fsr_playbooks; print(fsr_playbooks.__file__)"`.
- The editable framework tests against whatever branch is checked out in that clone, not `main` and not
  the pinned wheel. A green dev suite can measure stale source; the CI-mirror pre-push tier (temp venv
  from `requirements.txt`) is the real check.
- Frontend repo: `make install` after pulls (harness JS and `fsrPbRender.js` are gitignored build output).

## Probing an unmerged framework change through the connector
- `PYTHONPATH=<whole framework tree>` (it needs `tooling/`, not only `fsr_playbooks/`) in front of the make
  command, plus `FSRPB_DB=<path to the full dev reference DB>`: a worktree has only the slim shipped
  catalog (0 rows in `playbook_steps`), so lookups come back empty and look like regressions.
- To combine two fix branches without `git merge`: `git archive <a> | tar -x -C <dir>` then
  `git diff main <b> | patch -p1` in it.
- Frank `eco` is noisy (9 to 25 rounds on the same prompt). 3 runs a side prove nothing. Trust
  deterministic replay of recorded tool calls through old and new tool, and rates over many calls.
- `make local-turn LLM=frank MODEL=<slug> INTENT=build MSG="..."` prints a turn DIAGNOSIS; a dead gateway
  reads as "THE TURN ERRORED" (check VPN first). It needs `FRANK_MODEL` set.

## Test gates
- Connector `make test` is THE gate: parallel, shuffled (pytest-randomly), 120s per-test timeout, prints
  its seed. A test that fails once and passes on rerun is an order leak: rerun with
  `PYTEST_ARGS="-p randomly --randomly-seed=N"`; do not dismiss it.
- Never fork the pytest process in tests (fork inherits a live thread's sqlite lock; hung a run for
  hours). Spawn a fresh interpreter with a timeout.
- A collection error is not a failure: a test module once never ran for weeks. Check collected counts.
- Framework release gate is `make tests` (tooling/tests), NOT `fsr_playbooks/tests`; run both, in
  separate pytest processes. Tool-census count flakes when a global registry was mutated by a
  test; the fix is regenerating the connector tool manifest.
- zsh does not word-split `$FLAGS`; `FLAGS="--model x"; cmd $FLAGS` passes ONE argument and silently
  fakes a regression. Use arrays. In this shell `make` may be shadowed: use `command make`.
- Interactive `grep` is ugrep and skips big files: use `/usr/bin/grep` for any "not in the code" claim.

## Widget e2e environment
- Run only through make targets (`make test-e2e-spec SPEC=...`). Fixed harness ports were shared by
  concurrent runs; now the harness `scripts/reap-e2e-orphans.sh` and per-run ports exist, but still check
  `ps`/`lsof` for other runs before believing a burst of ERR_CONNECTION_REFUSED.
- A UNIFORM `waitForFunction` boot timeout across unrelated specs is machine load, not a regression
  (check `uptime`; rerun alone on a quiet machine). A real regression concentrates in few specs.
- Testing a widget worktree: see the project CLAUDE.md (`WIDGETS_SRC`, harness symlink).

Sources: memory notes make_setup_in_worktree, connector_fsr_playbooks_stale_wheel, probe_loop_how_to_run,
shared_framework_clone_stash_cycled, ci_mirror_tier, tests_must_not_fork, single_shuffled_test_gate,
framework_release_gate, tool_census_manifest_drift, zsh_no_word_split, harness_e2e_port_collision,
e2e_uniform_waitforfunction (conn_main CLAUDE.md confirms dev_env.sh, make test, shuffle).
