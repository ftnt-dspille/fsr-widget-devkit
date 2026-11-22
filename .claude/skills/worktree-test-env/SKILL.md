---
name: worktree-test-env
description: Use when running tests or probes from a git worktree or a shared clone, when a test result might be measuring the wrong source (stale wheel, other agent's branch, wrong venv), when e2e fails in a mass/uniform way, or when briefing a subagent on test environment setup.
---

# Worktrees, venvs and "am I testing the code I think I am"

`make check` and `make ship` work from the shared checkout, an agent tree or a worktree and pick
the right trees themselves; this skill is for when a result still looks wrong.

## Shared state hazards
- Other agents share the checkouts. `git status` can look empty or foreign minutes after you wrote
  files. Commit your own paths early (`git commit --only <paths>`), fix forward in small commits.
  Never `git stash`/`pop`/rebase over unrelated WIP; use `git worktree add <scratch>/wt_<name> -b
  <branch> origin/main`, or `make agent-tree` for several repos.
- Verify a commit in isolation: `git worktree add --detach <scratch>/verify <sha>`.
- A clean worktree exposes tests that depended on the gitignored dev reference DB (use
  `default_db_path()`, never `data/fsr_reference.db`). A worktree of the framework has only the slim
  shipped catalog (0 rows in `playbook_steps`): lookups come back empty and look like regressions;
  point `FSRPB_DB` at the full dev DB when probing.
- Work only in the canonical clone of a repo; check `git log` on both before concluding something "is
  not shipped". Worktrees under the OS temp dir vanish on reboot (only branches survive): `git
  worktree prune` first.

## Python env (connector repo)
- One declared env, one resolver: `scripts/dev_env.sh`. The venv is shared by all checkouts and
  stamped with a hash of `requirements.txt`/`pyproject.toml`. `make setup` from a worktree whose
  requirements differ re-stamps it and breaks other sessions' targets: re-run it from the main
  checkout straight after and say so.
- Never `uv run` (builds an env without `fsr_playbooks`); never system python. Use the venv python,
  `FSRPB_DEV=1`, and `uv pip install --python <venv>/bin/python ...` (plain pip fails here).
- If source edits have no effect, a stale built `fsr_playbooks` wheel in site-packages may shadow the
  editable install: `python -c "import fsr_playbooks; print(fsr_playbooks.__file__)"`.
- A green dev suite can measure stale source (the editable framework follows whatever branch is out).
  CI runs the pinned wheel and the full suite; promote waits for it.
- Frontend repo: `make install` after pulls (harness JS and `fsrPbRender.js` are gitignored build output).
- Probing an unmerged framework change through the connector: `PYTHONPATH=<whole framework tree>` (it
  needs `tooling/`, not only `fsr_playbooks/`). To combine two fix branches without `git merge`:
  `git archive <a> | tar -x -C <dir>` then `git diff main <b> | patch -p1`.

## Test gates
- The connector's full suite is parallel, shuffled (pytest-randomly), 120s per test, and prints its
  seed. A test that fails once and passes on rerun is an order leak: replay with
  `PYTEST_ARGS="-p randomly --randomly-seed=N"`; do not dismiss it.
- Never fork the pytest process in tests (fork inherits a live thread's sqlite lock). Spawn a fresh
  interpreter with a timeout.
- A collection error is not a failure: a module once never ran for weeks. Check collected counts.
- Framework release gate is `make tests` (tooling/tests), NOT `fsr_playbooks/tests`; run both in
  separate pytest processes. A tool-census count flake means a global registry was mutated by a test.
- zsh does not word-split `$FLAGS`; `FLAGS="--model x"; cmd $FLAGS` passes ONE argument and fakes a
  regression. Use arrays. `make` may be shadowed: use `command make`.
- Interactive `grep` is ugrep and skips big files: use `/usr/bin/grep` for any "not in the code" claim.

## Widget e2e environment
- Run only through make (`make test-e2e-spec SPEC=...`). Check `ps`/`lsof` for other runs before
  believing a burst of ERR_CONNECTION_REFUSED.
- A UNIFORM `waitForFunction` boot timeout across unrelated specs is machine load, not a regression
  (check `uptime`, rerun alone). A real regression concentrates in few specs.
- A widget worktree goes at `<dir>/widgets-src/<name>` and the harness is linked beside it; the door
  does the link, and `WIDGETS_SRC` points at that dir. The specs `require("../../../../fortisoar-widget-harness/...")`.
