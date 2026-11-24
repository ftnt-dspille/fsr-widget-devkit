"use strict";
// scripts/door.sh: the two front doors (make check, make ship). Real throwaway git
// repos with a bare remote, a stub `make` that records what the door asked for, and
// the real promote classifier (.github/package-inputs). Nothing here touches a box.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync, execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const DOOR = process.env.DOOR_UNDER_TEST || path.join(ROOT, "scripts", "door.sh");
let T, ENV, LOG, W;

// A box.sh stand-in with the real one's surface the door uses: --list, --role, --lease, --leases, --need. Leases are files
// in $LEASE_DIR holding the holder; a lease is refused when another holder has it, as the real one does.
// FREE_AFTER=<n> frees every lease on the n-th --lease call (a box another agent gave back while we waited).
const BOX_STUB = [
  "#!/usr/bin/env bash",
  'L="${LEASE_DIR:-/nonexistent}"; mkdir -p "$L"; me="${FSR_LEASE_HOLDER:-}"',
  'echo "box.sh $* | holder=$me BOX=${BOX:-}" >> "$DOOR_LOG.box"',
  'take() { f="$L/$1"; if [ -s "$f" ] && [ "$(cat "$f")" != "$me" ]; then echo "box lease: BOX=$1 is held by $(cat "$f")" >&2; return 2; fi; echo "$me" > "$f"; }',
  'case "$1" in',
  '  --list) echo "159 mssp 92 soar-ga 81"; exit 0 ;;',
  '  --role) if [ -n "${NO_EXP:-}" ]; then echo stable; else case "$2" in 92|soar-ga|mssp) echo experimental ;; *) echo stable ;; esac; fi; exit 0 ;;',
  '  --lease) n=$(cat "$L/.tries" 2>/dev/null || echo 0); n=$((n+1)); echo $n > "$L/.tries"',
  '           if [ -n "${FREE_AFTER:-}" ] && [ "$n" -ge "$FREE_AFTER" ]; then for f in "$L"/*; do [ -f "$f" ] && rm -f "$f"; done; fi',
  '           take "$2"; exit $? ;;',
  '  --leases) for f in "$L"/*; do [ -s "$f" ] && echo "$(basename "$f")  held by $(cat "$f") until 12:00:00 (gen 1)"; done; exit 0 ;;',
  '  --need) [ "${BOX_RC:-0}" = 0 ] || { echo "box is stable" >&2; exit 2; }; [ -z "${BOX:-}" ] || take "$BOX" || exit 2; exit 0 ;;',
  "esac",
  "exit 0",
  "",
].join("\n");

const git = (dir, ...a) => execFileSync("git", ["-C", dir, ...a], { env: ENV, encoding: "utf8" }).trim();
const write = (dir, rel, body) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), body); };
const boxlog = () => { try { return fs.readFileSync(`${LOG}.box`, "utf8").split("\n").filter(Boolean); } catch { return []; } };
const log = () => (fs.existsSync(LOG) ? fs.readFileSync(LOG, "utf8").split("\n").filter(Boolean) : []);

// A repo named like the real one (the door and promote key on the main checkout's name).
function repo(name, files) {
  const dir = path.join(T, name);
  const bare = path.join(T, `${name}.remote.git`);
  fs.mkdirSync(dir, { recursive: true });
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", bare], { env: ENV });
  git(dir, "init", "-q", "-b", "main");
  for (const [f, b] of Object.entries(files)) write(dir, f, b);
  git(dir, "add", "-A"); git(dir, "commit", "-q", "-m", "base");
  git(dir, "remote", "add", "origin", bare); git(dir, "push", "-q", "-u", "origin", "main");
  return { dir, bare };
}
const branch = (dir, name, files, msg = "change") => {
  git(dir, "switch", "-q", "-c", name);
  for (const [f, b] of Object.entries(files)) write(dir, f, b);
  git(dir, "add", "-A"); git(dir, "commit", "-q", "-m", msg);
};
const remoteHas = (bare, br) => { try { execFileSync("git", ["-C", bare, "rev-parse", "--verify", "-q", `refs/heads/${br}`], { env: ENV }); return true; } catch { return false; } };

// The ship pool: 92 and soar-ga carry ship_pool = true; "mssp" is experimental but not in the pool.
function REG() {
  const f = path.join(T, "instances.toml");
  if (!fs.existsSync(f)) fs.writeFileSync(f, '[instances.92]\nrole = "experimental"\nship_pool = true\n[instances.soar-ga]\nrole = "experimental"\nship_pool = true\n[instances.mssp]\nrole = "experimental"\n');
  return f;
}
function door(mode, env = {}) {
  const r = spawnSync("bash", [DOOR, mode], {
    cwd: T, encoding: "utf8", timeout: 60000,
    env: { ...ENV, FROM_TREE: "1", FSR_TOOL_HOME: ROOT, DOOR_MAKE: W.make, DOOR_LOG: LOG, FSR_LIVE_SANITY_DIR: path.join(T, "stamps"), PYFSR_INSTANCES: REG(),
           FSR_LAP_LEDGER: path.join(T, "laps.tsv"), LEASE_DIR: path.join(T, "leases"), CONN_REPO: W.conn.dir, FSR_FRAMEWORK_REPO: W.fw.dir, DOOR_REPO: W.conn.dir, ...env },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

beforeEach(() => {
  T = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "door-")));
  fs.writeFileSync(path.join(T, "gitconfig"), "[user]\n\tname = t\n\temail = t@example.com\n");
  ENV = { ...process.env, GIT_CONFIG_GLOBAL: path.join(T, "gitconfig"), GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "core.hooksPath", GIT_CONFIG_VALUE_0: "/dev/null" };
  for (const k of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "CLAUDECODE", "AGENT_TREE", "DOOR_REPO", "BOX", "DRY_RUN", "FSR_LEASE_HOLDER"]) delete ENV[k];
  LOG = path.join(T, "make.log");
  const make = path.join(T, "fakemake");
  fs.writeFileSync(make, `#!/usr/bin/env bash
echo "make $* | FSR_SRC=\${FSR_SRC:-} PROMOTE_DRY_RUN=\${PROMOTE_DRY_RUN:-} CONN_REPO=\${CONN_REPO:-} HOLDER=\${FSR_LEASE_HOLDER:-}" >> "$DOOR_LOG"
if [ -n "\${DOOR_FAIL:-}" ] && [[ "$*" == *"$DOOR_FAIL"* ]]; then exit "\${DOOR_FAIL_RC:-1}"; fi
# DOOR_FAIL_DRY / DOOR_FAIL_REAL: fail a promote of the matching repo only in its dry run / only when it really merges
if [ -n "\${DOOR_FAIL_DRY:-}" ] && [ -n "\${PROMOTE_DRY_RUN:-}" ] && [[ "$*" == *"promote"*"$DOOR_FAIL_DRY"* ]]; then exit 1; fi
if [ -n "\${DOOR_FAIL_REAL:-}" ] && [ -z "\${PROMOTE_DRY_RUN:-}" ] && [[ "$*" == *"promote"*"$DOOR_FAIL_REAL"* ]]; then exit 1; fi
if [[ "$*" == *local-chat* ]]; then   # the report local-chat-report.py prints; DOOR_CHAT picks what the model did
  case "\${DOOR_CHAT:-good}" in
    good) echo "local-chat: tools called: get_record, lookup"; T=400; echo "local-chat: verdict card: malicious; cards: ['verdict_card']" ;;
    silent) echo "local-chat: tools called: none"; T=0; echo "local-chat: verdict card: none; cards: []" ;;
    chatty) echo "local-chat: tools called: none"; T=300; echo "local-chat: verdict card: none; cards: []" ;;
    nocard) echo "local-chat: tools called: get_record"; T=300; echo "local-chat: verdict card: none; cards: []" ;;
    noreport) ;;
    leak) echo "local-chat: tools called: none"; T=0; echo "local-chat: verdict card: none; cards: []"
          ( exec sleep 100 ) & ;;   # a sidecar that outlives the turn and keeps the inherited stdout open
  esac
  if [ -n "\${OUT:-}" ]; then mkdir -p "$OUT"; { echo "**Assistant:**"; echo; [ "\${T:-0}" -gt 0 ] && echo "some answer"; echo; } > "$OUT/transcript.md"; fi
  echo "TIMEOUT=\${TIMEOUT:-unset}" >> "$DOOR_LOG"
fi
exit 0
`, { mode: 0o755 });
  fs.writeFileSync(path.join(T, "fakepy"), `#!/usr/bin/env bash\necho "python $* | PYTHONPATH=$PYTHONPATH | cwd=$PWD" >> "$DOOR_LOG"\nexit "\${PY_RC:-0}"\n`, { mode: 0o755 });
  const conn = repo("conn_main", {
    "connector-fsr-agentic-assistant/a.py": "A = 1\n", "scripts/dev_push_deps.sh": "#!/bin/sh\n", "README.md": "r\n",
    "connector-fsr-agentic-assistant/info.json": '{\n  "name": "connector-x",\n  "version": "0.6.23",\n  "category": "utilities"\n}\n',
    "connector-fsr-agentic-assistant/release_notes.md": "# Release notes\n\n## 0.6.23 (2026-01-01)\n\n- older\n",
    // stands in for the connector's scripts/preflight_version.py (the door reuses its apply_bump)
    "scripts/preflight_version.py": "def apply_bump(v, bump):\n    a, b, c = [int(x) for x in v.split('.')]\n    return {'major': f'{a+1}.0.0', 'minor': f'{a}.{b+1}.0', 'patch': f'{a}.{b}.{c+1}'}[bump]\n",
    "tests/test_a.py": "from a import A\n",
    // the connector's own selection is tested in the connector; here it only has to be called with the changed files on stdin
    "scripts/changed_tests.sh": "#!/usr/bin/env bash\ncat >/dev/null; echo tests/test_a.py\n",
    "scripts/dev_env.sh": `#!/usr/bin/env bash\necho "${path.join(T, "fakepy")}"\n`,
    "scripts/box.sh": BOX_STUB,
  });
  const fw = repo("fsr-playbook-framework", { "fsr_playbooks/llm/loop.py": "x = 1\n", "fsr_playbooks/tests/test_loop.py": "import loop\n", "README.md": "r\n" });
  W = { make, conn, fw };
});
afterEach(() => fs.rmSync(T, { recursive: true, force: true }));

describe("make check", () => {
  test("runs the connector's mapped tests (shell-heavy left to CI), the tool sweep, and local-chat when the agent loop changed", () => {
    branch(W.conn.dir, "feat/x", { "connector-fsr-agentic-assistant/a.py": "A = 2\n" });
    const r = door("check");
    expect(r.code).toBe(0);
    const l = log();
    expect(l.some((x) => /^make -C \S+ test PYTEST_ARGS=-m 'not shell' --disable-warnings tests\/test_a\.py/.test(x.split(" | ")[0]))).toBe(true);
    expect(l.some((x) => /^make -C \S+ tool-sweep/.test(x))).toBe(true);
    expect(l.some((x) => /local-chat BUNDLE=ka_c2_beacon/.test(x))).toBe(true);
  });

  describe("a local-chat that did nothing is never a pass", () => {
    const run = (chat, env = {}) => { branch(W.conn.dir, "feat/x", { "connector-fsr-agentic-assistant/a.py": "A = 2\n" }); return door("check", { DOOR_CHAT: chat, ...env }); };
    test("a good turn passes and the turn is bounded by a timeout well under local-chat's 600s default", () => {
      const r = run("good");
      expect(r.code).toBe(0);
      expect(r.out).not.toMatch(/NOT RUN: conn_main: local-chat/);
      const t = log().find((x) => /^TIMEOUT=/.test(x));
      expect(Number(t.split("=")[1])).toBeLessThanOrEqual(300);
    });
    test("no tools and no answer (timeout or dead gateway) is NOT RUN with the reason, not 'check passed'", () => {
      const r = run("silent");
      expect(r.out).toMatch(/NOT RUN: conn_main: local-chat ka_c2_beacon: the model gave no answer/);
      expect(r.out).toMatch(/NOT RUN/);
    });
    test("a model that answered but called no tools fails", () => {
      const r = run("chatty");
      expect(r.code).toBe(1);
      expect(r.out).toMatch(/FAILED conn_main local-chat ka_c2_beacon: the model answered but called no tools/);
    });
    test("tools ran but no verdict card on a triage bundle fails", () => {
      const r = run("nocard");
      expect(r.code).toBe(1);
      expect(r.out).toMatch(/no verdict card/);
    });
    test("no report at all is NOT RUN", () => {
      expect(run("noreport").out).toMatch(/NOT RUN: conn_main: local-chat ka_c2_beacon: no report was produced/);
    });
    test("a child that outlives local-chat and holds its stdout does not hang the door, and is killed", () => {
      const t0 = Date.now();
      const r = run("leak", { DOOR_CHAT_TIMEOUT: "5", DOOR_CHAT_GRACE: "5" });
      expect(Date.now() - t0).toBeLessThan(30000);
      expect(r.out).toMatch(/NOT RUN: conn_main: local-chat ka_c2_beacon: the model gave no answer/);
      expect(r.out).toMatch(/tools called: none/);
      const alive = spawnSync("pgrep", ["-f", "sleep 100"], { encoding: "utf8" }).stdout.trim();
      expect(alive).toBe("");
    });
    test("DOOR_CHAT_TIMEOUT overrides the bound", () => {
      run("good", { DOOR_CHAT_TIMEOUT: "77" });
      expect(log()).toContain("TIMEOUT=77");
    });
  });

  test("a diff outside the agent loop runs no local-chat, and a diff no test maps to is reported NOT RUN, not passed", () => {
    branch(W.conn.dir, "feat/x", { "README.md": "changed\n" });
    fs.writeFileSync(path.join(W.conn.dir, "scripts/changed_tests.sh"), "#!/usr/bin/env bash\ncat >/dev/null\n");
    git(W.conn.dir, "commit", "-qam", "no tests map");
    const r = door("check");
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/NOT RUN: conn_main: no pytest file maps to this diff/);
    expect(r.out).toMatch(/1 part\(s\) NOT RUN|part\(s\) NOT RUN/);
    expect(log().some((x) => /local-chat/.test(x))).toBe(false);
  });

  test("a failing test makes the door fail and names it", () => {
    branch(W.conn.dir, "feat/x", { "connector-fsr-agentic-assistant/a.py": "A = 2\n" });
    const r = door("check", { DOOR_FAIL: "PYTEST_ARGS" });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/check FAILED: conn_main pytest/);
  });

  test("a framework diff in the agent loop runs local-chat; a sweep spec in the diff picks its bundle", () => {
    branch(W.fw.dir, "feat/x", { "fsr_playbooks/llm/loop.py": "x = 2\n" });
    const r = door("check", { DOOR_REPO: W.fw.dir });
    expect(r.code).toBe(0);
    expect(log().some((x) => /local-chat BUNDLE=ka_c2_beacon/.test(x))).toBe(true);
    expect(log().some((x) => /^python -m pytest .*fsr_playbooks\/tests\/test_loop\.py/.test(x))).toBe(true);
    git(W.conn.dir, "switch", "-q", "-c", "feat/y");
    write(W.conn.dir, "scripts/conversations/sweep/my_row.json", "{}\n"); write(W.conn.dir, "connector-fsr-agentic-assistant/a.py", "A = 3\n");
    git(W.conn.dir, "add", "-A"); git(W.conn.dir, "commit", "-qm", "row");
    fs.writeFileSync(LOG, "");
    door("check");
    expect(log().some((x) => /local-chat BUNDLE=my_row/.test(x))).toBe(true);
  });

  test("a connector checked out under another name (its real main checkout is fsr-playbook-builder) is still the connector", () => {
    const moved = path.join(T, "fsr-playbook-builder");
    fs.renameSync(W.conn.dir, moved); W.conn.dir = moved;
    branch(moved, "feat/x", { "connector-fsr-agentic-assistant/a.py": "A = 2\n" });
    const r = door("check", { CONN_REPO: moved, DOOR_REPO: moved });
    expect(r.code).toBe(0);
    expect(r.out).not.toMatch(/no check is defined/);
    expect(log().some((x) => /tool-sweep/.test(x))).toBe(true);
  });

  test("uncommitted and untracked work is checked too, not only commits", () => {
    git(W.conn.dir, "switch", "-q", "-c", "feat/x");
    write(W.conn.dir, "connector-fsr-agentic-assistant/new_mod.py", "Z = 1\n");   // untracked, uncommitted
    const r = door("check");
    expect(r.out).toMatch(/1 file\(s\) changed/);
    expect(log().some((x) => /tool-sweep/.test(x))).toBe(true);
  });
});

describe("make check: suites and worktrees", () => {
  test("the framework's tooling tests and fsr_playbooks tests run in separate pytest processes, never one", () => {
    git(W.fw.dir, "switch", "-q", "-c", "feat/x");
    write(W.fw.dir, "tooling/tests/test_t.py", "import loop\n");
    write(W.fw.dir, "fsr_playbooks/llm/loop.py", "x = 2\n");   // both suites import `loop`
    git(W.fw.dir, "add", "-A"); git(W.fw.dir, "commit", "-qm", "both suites");
    const r = door("check", { DOOR_REPO: W.fw.dir });
    expect(r.code).toBe(0);
    const runs = log().filter((x) => /^python -m pytest /.test(x));
    expect(runs).toHaveLength(2);
    expect(runs.filter((x) => /tooling\/tests\/test_t\.py/.test(x))).toHaveLength(1);
    expect(runs.filter((x) => /fsr_playbooks\/tests\/test_loop\.py/.test(x))).toHaveLength(1);
    for (const x of runs) expect(/tooling\/tests/.test(x) && /fsr_playbooks\/tests/.test(x)).toBe(false);
  });

  // A root worktree of a checkout whose harness is set up (node_modules, local-chat python).
  function rootWorktree({ shared = true, sameLock = true } = {}) {
    const main = path.join(T, "fsr_all_widgets"), wt = path.join(T, "root_wt");
    fs.mkdirSync(main, { recursive: true });
    git(main, "init", "-q", "-b", "main");
    write(main, "fortisoar-widget-harness/pnpm-lock.yaml", "lock: 1\n");
    write(main, "README.md", "r\n");
    git(main, "add", "-A"); git(main, "commit", "-qm", "base");
    git(main, "worktree", "add", "-q", wt, "-b", "wt");
    if (!sameLock) write(wt, "fortisoar-widget-harness/pnpm-lock.yaml", "lock: 2\n");
    if (shared) {
      fs.mkdirSync(path.join(main, "fortisoar-widget-harness/node_modules"), { recursive: true });
      fs.mkdirSync(path.join(main, "fortisoar-widget-harness/.venv-localdev"), { recursive: true });
    }
    fs.symlinkSync(path.join(ROOT, "scripts"), path.join(wt, "scripts"));
    return { main, wt };
  }
  const agentLoopBranch = () => branch(W.conn.dir, "feat/x", { "connector-fsr-agentic-assistant/a.py": "A = 2\n" });

  test("local-chat from a root worktree reuses the shared checkout's node_modules and local-chat python", () => {
    const { wt } = rootWorktree();
    agentLoopBranch();
    const r = door("check", { FSR_TOOL_HOME: wt });
    expect(r.code).toBe(0);
    expect(log().some((x) => /local-chat BUNDLE=/.test(x))).toBe(true);
    expect(fs.lstatSync(path.join(wt, "fortisoar-widget-harness/node_modules")).isSymbolicLink()).toBe(true);
    expect(fs.lstatSync(path.join(wt, "fortisoar-widget-harness/.venv-localdev")).isSymbolicLink()).toBe(true);
  });

  test.each([["the shared checkout has no node_modules", { shared: false }], ["the lockfile differs", { sameLock: false }]])(
    "a worktree that cannot be set up reports local-chat NOT RUN with the reason, and does not fail (%s)", (_n, opts) => {
      rootWorktree(opts);
      agentLoopBranch();
      const r = door("check", { FSR_TOOL_HOME: path.join(T, "root_wt") });
      expect(r.code).toBe(0);
      expect(r.out).toMatch(/NOT RUN: conn_main: local-chat ka_c2_beacon: the harness is not set up/);
      expect(log().some((x) => /local-chat/.test(x))).toBe(false);
    });
  describe("root jest selection", () => {
    const rootRepo = () => repo("root_main", {
      "fortisoar-widget-harness/jest.config.js": 'const TOOLING_SUITES = [\n  "promoteGate", "door",\n  // a comment\n  "cardKeyParity",\n];\n',
      "fortisoar-widget-harness/tests/promoteGate.test.js": "// mentions promote.sh\n",
      "fortisoar-widget-harness/tests/other.test.js": "// mentions promote.sh\n",
      "scripts/promote.sh": "#!/bin/sh\n",
    });
    const run = (env = {}) => { const r = rootRepo(); branch(r.dir, "feat/x", { "scripts/promote.sh": "#!/bin/sh\n# x\n" }); return door("check", { DOOR_REPO: r.dir, ...env }); };

    test("a tooling suite goes to the container, a non-tooling file stays on the host", () => {
      const r = run();
      expect(r.code).toBe(0);
      expect(log().some((x) => /make -C \S+ test-docker TESTS=promoteGate\.test\.js /.test(x))).toBe(true);
      expect(log().some((x) => /test-unit FULL=1 TESTS=other\.test\.js /.test(x))).toBe(true);
      expect(log().some((x) => /test-unit .*promoteGate/.test(x))).toBe(false);
    });

    test("no container engine (exit 2): the tooling suite runs on the host instead; DOOR_DOCKER=0 skips the container", () => {
      const r = run({ DOOR_FAIL: "test-docker", DOOR_FAIL_RC: "2" });
      expect(r.code).toBe(0);
      expect(log().some((x) => /test-unit FULL=1 TESTS=other\.test\.js promoteGate\.test\.js /.test(x) || /test-unit .*promoteGate\.test\.js/.test(x))).toBe(true);
    });

    test("a failing container run fails the door and names the files", () => {
      const r = run({ DOOR_FAIL: "test-docker", DOOR_FAIL_RC: "1" });
      expect(r.code).not.toBe(0);
      expect(r.out).toMatch(/FAILED .*jest \(container\): promoteGate\.test\.js/);
    });

    test("DOOR_DOCKER=0 runs everything on the host", () => {
      const r = run({ DOOR_DOCKER: "0" });
      expect(r.code).toBe(0);
      expect(log().some((x) => /test-docker/.test(x))).toBe(false);
    });
  });
});

describe("make ship", () => {
  test("a tooling-only branch is pushed and promoted with no box, no dev-push, no BOX needed", () => {
    branch(W.conn.dir, "feat/x", { "tests/test_a.py": "from a import A\n# more\n" });
    const r = door("ship");
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/conn_main \(feat\/x\): tooling/);
    expect(remoteHas(W.conn.bare, "feat/x")).toBe(true);
    const l = log();
    expect(l.some((x) => /dev-push|widget-push|doctor/.test(x))).toBe(false);
    expect(l.some((x) => x.startsWith(`make -C ${ROOT} promote REPO=${W.conn.dir} BRANCH=feat/x`) || /promote REPO=.* BRANCH=feat\/x/.test(x))).toBe(true);
  });

  test("no BOX and no experimental box in the registry is refused before anything is pushed", () => {
    branch(W.conn.dir, "feat/x", { "connector-fsr-agentic-assistant/a.py": "A = 2\n" });
    const r = door("ship", { NO_EXP: "1" });
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/no experimental box in the ship pool/);
    expect(remoteHas(W.conn.bare, "feat/x")).toBe(false);
    expect(log()).toEqual([]);
  });

  test("a stable box is refused before anything is pushed", () => {
    branch(W.conn.dir, "feat/x", { "connector-fsr-agentic-assistant/a.py": "A = 2\n" });
    const r = door("ship", { BOX: "demo", BOX_RC: "2" });
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/cannot take code/);
    expect(remoteHas(W.conn.bare, "feat/x")).toBe(false);
  });

  test("a shipped diff pushes the branch, puts the code on the box (which stamps it), then promotes, in that order", () => {
    branch(W.conn.dir, "feat/x", { "connector-fsr-agentic-assistant/a.py": "A = 2\n" });
    const r = door("ship", { BOX: "92" });
    expect(r.code).toBe(0);
    expect(remoteHas(W.conn.bare, "feat/x")).toBe(true);
    const l = log().map((x) => x.split(" | ")[0]);
    const dev = l.findIndex((x) => /dev-push BOX=92/.test(x));
    const pro = l.findIndex((x) => /promote REPO=.* BRANCH=feat\/x/.test(x));
    expect(dev).toBeGreaterThanOrEqual(0);
    expect(pro).toBeGreaterThan(dev);
    expect(l[l.length - 1]).toMatch(/box-release BOX=92/);   // the lease the pushes took is freed at the end
  });

  test("the box lease is freed when the ship stops early, too", () => {
    branch(W.conn.dir, "feat/x", { "connector-fsr-agentic-assistant/a.py": "A = 2\n" });
    door("ship", { BOX: "92", DOOR_FAIL: "dev-push" });
    expect(log().some((x) => /box-release BOX=92/.test(x))).toBe(true);
  });

  test("a head that already has a VERIFIED clean stamp is not put on the box again", () => {
    branch(W.conn.dir, "feat/x", { "connector-fsr-agentic-assistant/a.py": "A = 2\n" });
    const sha = git(W.conn.dir, "rev-parse", "HEAD");
    write(path.join(T, "stamps"), `conn_main/${sha}.json`, JSON.stringify({ sha, verdict: "VERIFIED", dirty: false }));
    const r = door("ship", { BOX: "92" });
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/head already stamped VERIFIED/);
    expect(log().some((x) => /dev-push|doctor/.test(x))).toBe(false);
  });

  test("a stamp for a dirty tree does not count", () => {
    branch(W.conn.dir, "feat/x", { "connector-fsr-agentic-assistant/a.py": "A = 2\n" });
    const sha = git(W.conn.dir, "rev-parse", "HEAD");
    write(path.join(T, "stamps"), `conn_main/${sha}.json`, JSON.stringify({ sha, verdict: "VERIFIED", dirty: true }));
    door("ship", { BOX: "92" });
    expect(log().some((x) => /dev-push/.test(x))).toBe(true);
  });

  test("DRY_RUN=1 hands promote the dry-run switch, so nothing merges", () => {
    branch(W.conn.dir, "feat/x", { "tests/test_a.py": "# x\n" });
    const r = door("ship", { DRY_RUN: "1" });
    expect(r.code).toBe(0);
    expect(log().some((x) => /promote REPO=/.test(x) && /PROMOTE_DRY_RUN=1/.test(x))).toBe(true);
  });

  test("refuses a dirty tree, main, and a detached HEAD", () => {
    branch(W.conn.dir, "feat/x", { "tests/test_a.py": "# x\n" });
    write(W.conn.dir, "README.md", "dirty\n");
    expect(door("ship").out).toMatch(/uncommitted changes to tracked files/);
    git(W.conn.dir, "checkout", "-q", "--", "README.md");
    git(W.conn.dir, "switch", "-q", "main");
    expect(door("ship").out).toMatch(/is on main/);
    git(W.conn.dir, "checkout", "-q", "--detach", "feat/x");
    const r = door("ship");
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/detached HEAD/);
    expect(remoteHas(W.conn.bare, "feat/x")).toBe(false);
  });

  test("a branch with nothing ahead of main ships nothing", () => {
    git(W.conn.dir, "switch", "-q", "-c", "feat/x");
    const r = door("ship");
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/nothing to ship|nothing ahead|nothing in the tree/);
    expect(log()).toEqual([]);
  });

  test("BUMP on a branch with nothing ahead of main makes exactly one version-only commit and ships it", () => {
    git(W.conn.dir, "switch", "-q", "-c", "release/x");
    const before = git(W.conn.dir, "rev-parse", "HEAD");
    const r = door("ship", { BOX: "92", BUMP: "patch" });
    expect(r.code).toBe(0);
    expect(git(W.conn.dir, "rev-list", "--count", `${before}..HEAD`)).toBe("1");
    expect(git(W.conn.dir, "show", "-s", "--format=%s", "HEAD")).toBe("Bump to 0.6.24");
    expect(git(W.conn.dir, "diff", "--name-only", `${before}..HEAD`).split("\n").sort()).toEqual(
      ["connector-fsr-agentic-assistant/info.json", "connector-fsr-agentic-assistant/release_notes.md"]);
    expect(git(W.conn.dir, "show", "HEAD:connector-fsr-agentic-assistant/info.json")).toBe(
      '{\n  "name": "connector-x",\n  "version": "0.6.24",\n  "category": "utilities"\n}');
    expect(git(W.conn.dir, "show", "HEAD:connector-fsr-agentic-assistant/release_notes.md")).toMatch(/## 0\.6\.24\n[\s\S]*## 0\.6\.23/);
    expect(remoteHas(W.conn.bare, "release/x")).toBe(true);
    const l = log();
    expect(l.some((x) => /dev-push/.test(x))).toBe(true);
    expect(l.some((x) => /promote REPO=.* BRANCH=release\/x/.test(x))).toBe(true);
  });

  test("without BUMP (or with BUMP=none) the same empty branch still ships nothing and commits nothing", () => {
    git(W.conn.dir, "switch", "-q", "-c", "release/x");
    const before = git(W.conn.dir, "rev-parse", "HEAD");
    for (const env of [{}, { BUMP: "none" }]) {
      const r = door("ship", { BOX: "92", ...env });
      expect(r.code).toBe(0);
      expect(r.out).toMatch(/nothing ahead of main/);
      expect(git(W.conn.dir, "rev-parse", "HEAD")).toBe(before);
    }
    expect(log()).toEqual([]);
  });

  test("a failing box step stops before promote", () => {
    branch(W.conn.dir, "feat/x", { "connector-fsr-agentic-assistant/a.py": "A = 2\n" });
    const r = door("ship", { BOX: "92", DOOR_FAIL: "dev-push" });
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/stopped before promote/);
    expect(log().some((x) => /promote REPO=/.test(x))).toBe(false);
  });

  test("in an agent tree it ships every changed repo, framework before connector, and only the changed ones", () => {
    const tree = path.join(T, "tree");
    fs.mkdirSync(path.join(tree, "root"), { recursive: true });
    git(W.conn.dir, "worktree", "add", "-q", "-b", "feat/c", path.join(tree, "connector"), "main");
    git(W.fw.dir, "worktree", "add", "-q", "-b", "feat/f", path.join(tree, "framework"), "main");
    fs.writeFileSync(path.join(tree, "agent-tree.json"), "{}");
    write(path.join(tree, "connector"), "tests/test_a.py", "# c\n"); git(path.join(tree, "connector"), "add", "-A"); git(path.join(tree, "connector"), "commit", "-qm", "c");
    write(path.join(tree, "framework"), "README.md", "# f\n"); git(path.join(tree, "framework"), "add", "-A"); git(path.join(tree, "framework"), "commit", "-qm", "f");
    const r = door("ship", { AGENT_TREE: tree, DOOR_REPO: "" });
    expect(r.code).toBe(0);
    const pro = log().filter((x) => /promote REPO=/.test(x) && !/PROMOTE_DRY_RUN=1/.test(x)).map((x) => x.split(" | ")[0]);
    expect(pro.length).toBe(2);
    expect(pro[0]).toMatch(/fsr-playbook-framework|framework/);
    expect(pro[1]).toMatch(/connector/);
  });
});

// A tree with a framework branch and a connector branch, each one commit ahead (tooling paths: no box, CI is the proof).
function jointTree() {
  const tree = path.join(T, "tree");
  fs.mkdirSync(path.join(tree, "root"), { recursive: true });
  git(W.conn.dir, "worktree", "add", "-q", "-b", "feat/c", path.join(tree, "connector"), "main");
  git(W.fw.dir, "worktree", "add", "-q", "-b", "feat/f", path.join(tree, "framework"), "main");
  fs.writeFileSync(path.join(tree, "agent-tree.json"), "{}");
  for (const [d, f] of [["connector", "tests/test_a.py"], ["framework", "README.md"]]) { write(path.join(tree, d), f, "# c\n"); git(path.join(tree, d), "add", "-A"); git(path.join(tree, d), "commit", "-qm", d); }
  return tree;
}
const promotes = () => log().filter((x) => /promote REPO=/.test(x)).map((x) => ({ kind: /fsr-playbook-framework|framework/.test(x.split(" | ")[0]) ? "fw" : "conn", dry: /PROMOTE_DRY_RUN=1/.test(x) }));

describe("make ship: framework and connector land together", () => {
  test("both are checked (dry run: CI, proof, merge) before either is merged, then merged back to back, framework first", () => {
    const r = door("ship", { AGENT_TREE: jointTree(), DOOR_REPO: "" });
    expect(r.code).toBe(0);
    expect(promotes()).toEqual([{ kind: "fw", dry: true }, { kind: "conn", dry: true }, { kind: "fw", dry: false }, { kind: "conn", dry: false }]);
  });
  test("a connector that is not ready stops the ship with NOTHING merged, framework included", () => {
    const r = door("ship", { AGENT_TREE: jointTree(), DOOR_REPO: "", DOOR_FAIL_DRY: "connector" });
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/NOTHING was merged/);
    expect(promotes().some((p) => !p.dry)).toBe(false);
  });
  test("a framework that is not ready stops the ship before the connector is even tried", () => {
    const r = door("ship", { AGENT_TREE: jointTree(), DOOR_REPO: "", DOOR_FAIL_DRY: "framework" });
    expect(r.code).toBe(2);
    expect(promotes()).toEqual([{ kind: "fw", dry: true }]);
  });
  test("when the second promote fails after the first merged, it is loud, names the recovery, and reverts or forces nothing", () => {
    const tree = jointTree();
    const r = door("ship", { AGENT_TREE: tree, DOOR_REPO: "", DOOR_FAIL_REAL: "connector" });
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/HALF LANDED: fsr-playbook-framework main was promoted, but conn_main \(feat\/c\) was NOT/);
    expect(r.out).toContain(`make promote REPO=${path.join(tree, "connector")} BRANCH=feat/c`);
    expect(r.out).toMatch(/Do not force-push or reset main/);
    expect(log().some((x) => /push -f|--force|reset|update-ref/.test(x))).toBe(false);
  });
  test("a framework-only ship has no joint pre-check (one repo: unchanged)", () => {
    branch(W.fw.dir, "feat/f", { "README.md": "# f\n" });
    const r = door("ship", { DOOR_REPO: W.fw.dir });
    expect(r.code).toBe(0);
    expect(promotes()).toEqual([{ kind: "fw", dry: false }]);
  });
});

describe("make ship: the cross-repo gate tests connector MAIN for a framework-only ship", () => {
  test("the connector suite runs on a checkout of the connector's remote main, not on a branch the shared connector checkout has out", () => {
    // the shared connector checkout sits on an unmerged branch with a commit main does not have
    branch(W.conn.dir, "feat/wip", { "connector-fsr-agentic-assistant/a.py": "A = 99\n" });
    git(W.conn.dir, "switch", "-q", "main"); git(W.conn.dir, "switch", "-q", "feat/wip");
    const mainSha = git(W.conn.dir, "rev-parse", "refs/remotes/origin/main");
    fs.writeFileSync(path.join(T, "fakepy"), `#!/usr/bin/env bash\necho "python $* | head=$(git rev-parse HEAD) | cwd=$PWD" >> "$DOOR_LOG"\nexit "\${PY_RC:-0}"\n`, { mode: 0o755 });
    branch(W.fw.dir, "feat/f", { "README.md": "# f\n" });
    const r = door("ship", { DOOR_REPO: W.fw.dir, DOOR_DOCKER: "0" });
    expect(r.code).toBe(0);
    const py = log().find((x) => /^python -m pytest/.test(x));
    expect(py).toContain(`head=${mainSha}`);
  });
  test("a connector main that the framework change would break refuses the ship; nothing is promoted", () => {
    branch(W.fw.dir, "feat/f", { "README.md": "# f\n" });
    const r = door("ship", { DOOR_REPO: W.fw.dir, DOOR_DOCKER: "0", PY_RC: "1" });
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/connector's suite is RED against this framework head, so connector main would go red/);
    expect(promotes()).toEqual([]);
  });
});

describe("make ship: BOX unset picks a free experimental box", () => {
  const ship = (env = {}) => { branch(W.conn.dir, "feat/x", { "connector-fsr-agentic-assistant/a.py": "A = 2\n" }); return door("ship", { DOOR_BOX_POLL: "0.1", ...env }); };
  const lease = (box, holder) => write(path.join(T, "leases"), box, `${holder}\n`);
  const devPush = () => log().map((x) => x.split(" | ")[0]).find((x) => /dev-push BOX=/.test(x));
  test("takes a free experimental box, never a stable one (stable 159 is listed first and free)", () => {
    const r = ship();
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/took the lease on experimental box 92/);
    expect(devPush()).toMatch(/BOX=92/);
    expect(boxlog().some((x) => /--lease (159|81)/.test(x))).toBe(false);
    expect(log().some((x) => /box-release BOX=92/.test(x))).toBe(true);
  });
  test("skips a box another agent holds", () => {
    lease("92", "tree:other");
    const r = ship();
    expect(r.code).toBe(0);
    expect(devPush()).toMatch(/BOX=soar-ga/);
    expect(fs.readFileSync(path.join(T, "leases", "92"), "utf8").trim()).toBe("tree:other");
  });
  test("prefers the box that last ran this tree's code (the newest stamp on the branch names it)", () => {
    branch(W.conn.dir, "feat/x", { "connector-fsr-agentic-assistant/a.py": "A = 2\n" });
    const sha = git(W.conn.dir, "rev-parse", "HEAD");
    write(path.join(T, "stamps"), `conn_main/${sha}.json`, JSON.stringify({ sha, verdict: "VERIFIED", dirty: true, box: "soar-ga" }));
    const r = door("ship", { DOOR_BOX_POLL: "0.1" });
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/took the lease on experimental box soar-ga \(last ran this code: soar-ga\)/);
    expect(devPush()).toMatch(/BOX=soar-ga/);
  });
  test("an experimental box outside the ship pool is never picked, even with the pool leased", () => {
    lease("92", "tree:a"); lease("soar-ga", "tree:b");
    const r = ship({ DOOR_BOX_WAIT: "1" });
    expect(boxlog().some((x) => /--lease mssp/.test(x))).toBe(false);
    expect(r.out).not.toMatch(/took the lease on experimental box mssp/);
  });
  test("all leased: waits, prints who holds what, and goes ahead when one frees", () => {
    lease("92", "tree:a"); lease("soar-ga", "tree:b");
    const r = ship({ FREE_AFTER: "5", DOOR_BOX_WAIT: "30" });
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/every experimental box is leased; waiting/);
    expect(r.out).toMatch(/92 {2}held by tree:a/);
    expect(r.out).toMatch(/soar-ga {2}held by tree:b/);
    expect(devPush()).toMatch(/BOX=(92|soar-ga)/);
  });
  test("all leased past the bound: refused naming the holders, and nothing is pushed", () => {
    lease("92", "tree:a"); lease("soar-ga", "tree:b");
    const r = ship({ DOOR_BOX_WAIT: "1" });
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/stayed leased for 1s/);
    expect(r.out).toMatch(/92 {2}held by tree:a/);
    expect(remoteHas(W.conn.bare, "feat/x")).toBe(false);
    expect(log()).toEqual([]);
  });
  test("BOX= still pins: no search, and a held pinned box is refused, not swapped", () => {
    lease("92", "tree:other");
    const r = ship({ BOX: "92" });
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/cannot take code/);
    expect(boxlog().some((x) => /--list|--lease/.test(x))).toBe(false);
  });
  test("a tooling-only diff picks no box at all", () => {
    branch(W.conn.dir, "feat/x", { "tests/test_a.py": "from a import A\n# more\n" });
    expect(door("ship").code).toBe(0);
    expect(boxlog()).toEqual([]);
  });
});

describe("make ship: one lease holder identity for every step", () => {
  const holders = () => [...log().filter((x) => /^make /.test(x)).map((x) => (x.match(/HOLDER=(.*)$/) || [])[1]), ...boxlog().map((x) => (x.match(/holder=(\S*)/) || [])[1])];
  test("from a plain shell, the door's lease calls, dev-push and the release all carry the same holder", () => {
    branch(W.conn.dir, "feat/x", { "connector-fsr-agentic-assistant/a.py": "A = 2\n" });
    expect(door("ship", { USER: "dev" }).code).toBe(0);
    const h = holders();
    expect(h.length).toBeGreaterThan(3);
    expect(new Set(h)).toEqual(new Set(["manual:dev"]));
  });
  test("in an agent tree the holder is tree:<name> for the door and for the dev-push it runs from the tree", () => {
    const tree = jointTree(); write(path.join(tree, "connector"), "connector-fsr-agentic-assistant/a.py", "A = 3\n");
    git(path.join(tree, "connector"), "add", "-A"); git(path.join(tree, "connector"), "commit", "-qm", "code");
    const r = door("ship", { AGENT_TREE: tree, DOOR_REPO: "", BOX: "92" });
    expect(r.code).toBe(0);
    expect(new Set(holders())).toEqual(new Set(["tree:tree"]));
  });
  test("an exported FSR_LEASE_HOLDER wins", () => {
    branch(W.conn.dir, "feat/x", { "connector-fsr-agentic-assistant/a.py": "A = 2\n" });
    expect(door("ship", { BOX: "92", FSR_LEASE_HOLDER: "tree:mine" }).code).toBe(0);
    expect(new Set(holders())).toEqual(new Set(["tree:mine"]));
  });
});

// CI of main: a fake `gh` answers `repos/<owner>/<repo>/commits/<ref>/check-runs` from files named
// <repo>__<ref> holding the post-jq rows (id, sha, name, status, conclusion). No file = GitHub unreadable.
describe("CI of main is never out of sight", () => {
  let GH;
  const rows = (...r) => r.map(([id, name, st, co, sha = "aaaaaaaa11111111"]) => [id, sha, name, st, co || ""].join("\t")).join("\n") + "\n";
  const ci = (repoName, ref, body) => fs.writeFileSync(path.join(GH, `${repoName}__${ref}`), body);
  const onGithub = (r, name) => git(r.dir, "remote", "add", "github", `https://github.com/o/${name}.git`);
  const run = (mode, args, env = {}) => {
    const r = spawnSync("bash", [DOOR, mode, ...args], { cwd: T, encoding: "utf8", timeout: 60000,
      env: { ...ENV, FROM_TREE: "1", FSR_TOOL_HOME: ROOT, DOOR_MAKE: W.make, DOOR_LOG: LOG, FSR_LIVE_SANITY_DIR: path.join(T, "stamps"), PYFSR_INSTANCES: REG(),
             FSR_LAP_LEDGER: path.join(T, "laps.tsv"), CONN_REPO: W.conn.dir, FSR_FRAMEWORK_REPO: W.fw.dir, DOOR_REPO: W.conn.dir,
             DOOR_RED_WAIT: "0", DOOR_RED_POLL: "0", DOOR_DOCKER: "0", PATH: `${path.join(T, "bin")}:${process.env.PATH}`, ...env } });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  };
  beforeEach(() => {
    GH = path.join(T, "ghdata"); fs.mkdirSync(GH);
    fs.mkdirSync(path.join(T, "bin"));
    fs.writeFileSync(path.join(T, "bin", "gh"), `#!/usr/bin/env bash
slug="\${2#repos/}"; ref="\${slug#*/commits/}"; ref="\${ref%%/*}"; repo="\${slug#*/}"; repo="\${repo%%/*}"
f="${GH}/\${repo}__\${ref}"; [ -f "$f" ] || exit 1; cat "$f"
`, { mode: 0o755 });
    onGithub(W.conn, "conn_main"); onGithub(W.fw, "fsr-playbook-framework");
  });

  test("status names the repo, says green, and says unknown (never green) when GitHub cannot be read or there is no GitHub remote", () => {
    ci("conn_main", "main", rows([1, "test (bundled framework)", "completed", "success"]));
    expect(run("ci", ["status", W.conn.dir]).out).toMatch(/ci main: conn_main \(o\/conn_main\) green at aaaaaaaa/);
    fs.rmSync(path.join(GH, "conn_main__main"));
    const r = run("ci", ["status", W.conn.dir]);
    expect(r.code).toBe(3);
    expect(r.out).toMatch(/unknown/);
    expect(run("ci", ["status", T]).out).toMatch(/unknown/);
  });

  test("a red main is flagged loudly with the failing job name; the newest run of a name wins", () => {
    ci("conn_main", "main", rows([1, "test (bundled framework)", "completed", "failure"], [2, "lint", "completed", "success"]));
    const r = run("ci", ["status", W.conn.dir]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/RED at aaaaaaaa: failing test \(bundled framework\)/);
    ci("conn_main", "main", rows([1, "test (bundled framework)", "completed", "failure"], [3, "test (bundled framework)", "completed", "success"]));
    expect(run("ci", ["status", W.conn.dir]).code).toBe(0);
  });

  test("only the repo's required checks make main red: an allowed-to-fail leg does not", () => {
    write(W.conn.dir, ".github/required-checks", "test (bundled framework)\n");
    git(W.conn.dir, "add", "-A"); git(W.conn.dir, "commit", "-qm", "req"); git(W.conn.dir, "push", "-q", "origin", "main");
    ci("conn_main", "main", rows([1, "test (bundled framework)", "completed", "success"], [2, "test (pinned framework)", "completed", "failure"]));
    expect(run("ci", ["status", W.conn.dir]).code).toBe(0);
    ci("conn_main", "main", rows([1, "test (bundled framework)", "in_progress"]));
    expect(run("ci", ["status", W.conn.dir]).out).toMatch(/pending/);
  });

  test("make doctor's drift check (drift_check.py) prints every repo's main CI line and flags a red one", () => {
    ci("conn_main", "main", rows([1, "test (bundled framework)", "completed", "failure"]));
    const r = spawnSync("python3", [path.join(ROOT, "scripts/drift_check.py"), "--root", ROOT, "--ledger", path.join(T, "laps.tsv")],
      { encoding: "utf8", env: { ...ENV, CONN_REPO: W.conn.dir, FSR_FRAMEWORK_REPO: W.fw.dir, PATH: `${path.join(T, "bin")}:${process.env.PATH}` } });
    const out = r.stdout.split("\n").filter((l) => !/doc drift/.test(l)).join("\n");
    expect(out).toMatch(/ci main: connector \(o\/conn_main\) RED at aaaaaaaa: failing test \(bundled framework\)/);
    expect(out).toMatch(/WARN CI RED ON MAIN/);
    expect(r.status).toBe(0);
  });

  describe("ship while main is red", () => {
    const ship = () => { branch(W.conn.dir, "feat/x", { "tests/test_a.py": "# x\n" }); return run("ship", []); };
    const promoted = () => log().some((x) => /promote REPO=/.test(x));
    beforeEach(() => ci("conn_main", "main", rows([1, "test (bundled framework)", "completed", "failure"])));

    test("both doors print the main CI line at the start", () => {
      branch(W.conn.dir, "feat/x", { "tests/test_a.py": "# x\n" });
      expect(run("check", []).out).toMatch(/door: ci main: conn_main .* RED/);
    });

    test("refused when the branch has no green CI on the failing check yet; main is untouched and the branch was pushed to read its CI", () => {
      const r = ship();
      expect(r.code).toBe(2);
      expect(r.out).toMatch(/main is red on: test \(bundled framework\)/);
      expect(r.out).toMatch(/not finished or has not started/);
      expect(promoted()).toBe(false);
      expect(remoteHas(W.conn.bare, "feat/x")).toBe(true);
    });

    test("refused when the branch is red on it too", () => {
      branch(W.conn.dir, "feat/x", { "tests/test_a.py": "# x\n" });
      ci(`conn_main`, git(W.conn.dir, "rev-parse", "HEAD"), rows([9, "test (bundled framework)", "completed", "failure"]));
      const r = run("ship", []);
      expect(r.code).toBe(2);
      expect(r.out).toMatch(/red on the same checks too/);
      expect(promoted()).toBe(false);
    });

    test("allowed when the branch is green on the failing check: it may be the fix", () => {
      branch(W.conn.dir, "feat/x", { "tests/test_a.py": "# x\n" });
      ci("conn_main", git(W.conn.dir, "rev-parse", "HEAD"), rows([9, "test (bundled framework)", "completed", "success"]));
      const r = run("ship", []);
      expect(r.code).toBe(0);
      expect(r.out).toMatch(/green on the checks main fails/);
      expect(promoted()).toBe(true);
    });

    test("a green main does not wait on anything", () => {
      ci("conn_main", "main", rows([1, "test (bundled framework)", "completed", "success"]));
      expect(ship().code).toBe(0);
      expect(promoted()).toBe(true);
    });
  });

  describe("a framework ship runs the connector suite against the new framework head first", () => {
    const fwShip = (env = {}) => { branch(W.fw.dir, "feat/f", { "README.md": "# f\n" }); return run("ship", [], { DOOR_REPO: W.fw.dir, ...env }); };
    test("a red connector suite refuses the framework promote", () => {
      const r = fwShip({ PY_RC: "1" });
      expect(r.code).toBe(2);
      expect(r.out).toMatch(/cross-repo gate: the connector's suite is RED against this framework head/);
      expect(log().some((x) => /promote REPO=/.test(x))).toBe(false);
    });
    test("green: the connector's main is tested with PYTHONPATH on the framework head, then promote goes ahead", () => {
      const r = fwShip();
      expect(r.code).toBe(0);
      const py = log().find((x) => /^python -m pytest/.test(x));
      expect(py).toContain(`PYTHONPATH=${W.fw.dir}:${W.fw.dir}/tooling`);
      expect(py).not.toContain(`cwd=${W.conn.dir}\n`);   // a throwaway worktree of the connector's main, not the shared checkout
      expect(log().some((x) => /promote REPO=/.test(x))).toBe(true);
      expect(git(W.conn.dir, "worktree", "list").split("\n").length).toBe(1);   // and it is removed again
    });
    describe("the connector suite runs in the Linux container when an engine answers", () => {
      let PYD;
      beforeEach(() => {
        PYD = path.join(T, "fakepydock");
        fs.writeFileSync(PYD, `#!/usr/bin/env bash\necho "pydocker $* | FW=$DEVLOOP_FRAMEWORK_DIR" >> "$DOOR_LOG"\nexit "\${PYD_RC:-0}"\n`, { mode: 0o755 });
      });
      const viaBox = (env = {}) => fwShip({ DOOR_DOCKER: "1", DOOR_PY_DOCKER: PYD, ...env });
      test("the gate goes to the container with the framework head and never starts the host pytest", () => {
        const r = viaBox();
        expect(r.code).toBe(0);
        const l = log();
        const c = l.find((x) => /^pydocker connector /.test(x));
        expect(c).toBeDefined();
        expect(c).toContain(`FW=${W.fw.dir}`);
        expect(l.some((x) => /^python -m pytest/.test(x))).toBe(false);
        expect(l.some((x) => /promote REPO=/.test(x))).toBe(true);
      });
      test("a red container run refuses the framework promote, same as a red host run", () => {
        const r = viaBox({ PYD_RC: "1" });
        expect(r.code).toBe(2);
        expect(r.out).toMatch(/cross-repo gate: the connector's suite is RED against this framework head/);
        expect(log().some((x) => /^python -m pytest/.test(x))).toBe(false);
        expect(log().some((x) => /promote REPO=/.test(x))).toBe(false);
      });
      test("no container engine (exit 75): the same suite runs on the host instead", () => {
        const r = viaBox({ PYD_RC: "75" });
        expect(r.code).toBe(0);
        expect(r.out).toMatch(/no container engine; running the connector suite on the host/);
        expect(log().some((x) => /^python -m pytest/.test(x))).toBe(true);
      });
      test("a pytest exit of 2 (interrupted) is a failure, not 'no engine'", () => {
        const r = viaBox({ PYD_RC: "2" });
        expect(r.code).toBe(2);
        expect(log().some((x) => /^python -m pytest/.test(x))).toBe(false);
      });
      test("DOOR_DOCKER=0 forces the host", () => {
        const r = viaBox({ DOOR_DOCKER: "0" });
        expect(r.code).toBe(0);
        expect(log().some((x) => /^pydocker/.test(x))).toBe(false);
        expect(log().some((x) => /^python -m pytest/.test(x))).toBe(true);
      });
    });
    test("a connector change shipped in the same tree is the one tested (its branch, not main)", () => {
      const tree = path.join(T, "tree");
      fs.mkdirSync(path.join(tree, "root"), { recursive: true });
      git(W.conn.dir, "worktree", "add", "-q", "-b", "feat/c", path.join(tree, "connector"), "main");
      git(W.fw.dir, "worktree", "add", "-q", "-b", "feat/f", path.join(tree, "framework"), "main");
      fs.writeFileSync(path.join(tree, "agent-tree.json"), "{}");
      for (const [d, f] of [["connector", "tests/test_a.py"], ["framework", "README.md"]]) { write(path.join(tree, d), f, "# c\n"); git(path.join(tree, d), "add", "-A"); git(path.join(tree, d), "commit", "-qm", d); }
      const r = run("ship", [], { AGENT_TREE: tree, DOOR_REPO: "" });
      expect(r.code).toBe(0);
      expect(log().find((x) => /^python -m pytest/.test(x))).toContain(`cwd=${path.join(tree, "connector")}`);
    });
  });
});
