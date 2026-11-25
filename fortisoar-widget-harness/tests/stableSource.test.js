"use strict";
// make stable builds from the promoted commits, never from the shared checkouts
// (scripts/stable_source.sh). Live, a fully promoted install was refused because
// other sessions had every shared checkout on their own branch, and the widget
// packer it would have used was compiled from someone's uncommitted edit.
//
// Five throwaway repos, each with a bare remote whose main is AHEAD of the
// shared checkout's, the shared checkouts on another branch with WIP. The trees
// the script makes must sit at remote main, leave the shared checkouts alone,
// and vanish on exit, on failure too.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const LIB = path.join(ROOT, "scripts", "stable_source.sh");
const ENV = {
  ...process.env,
  GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "core.hooksPath", GIT_CONFIG_VALUE_0: "/dev/null",
  GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com",
};
for (const k of Object.keys(ENV)) if (/^GIT_(DIR|WORK_TREE|INDEX_FILE)$/.test(k)) delete ENV[k];

let T;
const sh = (cmd, cwd, env = {}) => spawnSync("bash", ["-c", cmd], { cwd, env: { ...ENV, ...env }, encoding: "utf8" });
const git = (cwd, ...a) => {
  const r = spawnSync("git", a, { cwd, env: ENV, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${a.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
};

function repo(dir, remoteName = "origin") {
  const bare = `${dir}.remote.git`;
  fs.mkdirSync(dir, { recursive: true });
  git(T, "init", "-q", "--bare", "-b", "main", bare);
  git(dir, "init", "-q", "-b", "main");
  fs.writeFileSync(path.join(dir, "v.txt"), "promoted 1\n");
  git(dir, "add", "-A"); git(dir, "commit", "-q", "-m", "one");
  git(dir, "remote", "add", remoteName, bare);
  git(dir, "push", "-q", "-u", remoteName, "main");
  // The remote moves ahead (a promote from elsewhere), then this checkout goes
  // onto someone's branch with uncommitted work.
  fs.writeFileSync(path.join(dir, "v.txt"), "promoted 2\n");
  git(dir, "commit", "-q", "-am", "two"); git(dir, "push", "-q", remoteName, "main");
  git(dir, "reset", "-q", "--hard", "HEAD~1");
  git(dir, "checkout", "-q", "-b", "someone/else");
  fs.writeFileSync(path.join(dir, "v.txt"), "someone's WIP\n");
  return { dir, remote: git(bare, "rev-parse", "main") };
}

function world() {
  const mono = repo(path.join(T, "fsr_all_widgets"));
  fs.mkdirSync(path.join(mono.dir, "fortisoar-widget-harness"), { recursive: true });
  fs.writeFileSync(path.join(mono.dir, ".gitignore"), "widgets-src/*/\n");
  const w = {
    mono,
    fw: repo(path.join(T, "fsr-playbook-framework"), "github"),   // main tracks a non-origin remote
    conn: repo(path.join(T, "conn_main")),
    a: repo(path.join(mono.dir, "widgets-src", "agenticAssistant")),
    m: repo(path.join(mono.dir, "widgets-src", "agenticAssistantMonitor")),
  };
  // The root tree's harness must hold a dir to `cd` into; the remote's tip has
  // none, so give main one (pushed) and keep the WIP story intact.
  git(mono.dir, "stash", "-q");
  git(mono.dir, "checkout", "-q", "main"); git(mono.dir, "pull", "-q");
  fs.mkdirSync(path.join(mono.dir, "fortisoar-widget-harness"), { recursive: true });
  fs.writeFileSync(path.join(mono.dir, "fortisoar-widget-harness", "package.json"), "{}\n");
  git(mono.dir, "add", "-A"); git(mono.dir, "commit", "-q", "-m", "harness");
  git(mono.dir, "push", "-q", "origin", "main");
  mono.remote = git(mono.dir, "rev-parse", "HEAD");
  git(mono.dir, "checkout", "-q", "someone/else"); git(mono.dir, "stash", "pop", "-q");
  return w;
}

// A stub pnpm on PATH: records where it ran, fails on demand.
function stubPnpm(fail = false) {
  const bin = path.join(T, "bin");
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, "pnpm"),
    `#!/bin/sh\npwd >> "${T}/pnpm.log"\n${fail ? "exit 9" : "exit 0"}\n`, { mode: 0o755 });
  return `${bin}:${process.env.PATH}`;
}

function prepare(w, { failPnpm = false, after = "" } = {}) {
  const script = `
    set -u
    source "${LIB}"
    stable_source_prepare "${w.mono.dir}" "${w.fw.dir}" "${w.conn.dir}" || exit 7
    for d in "$SRC_ROOT" "$SRC_FW" "$SRC_CONN" "$SRC_ROOT/widgets-src/agenticAssistant" "$SRC_ROOT/widgets-src/agenticAssistantMonitor"; do
      printf '%s %s %s\\n' "$d" "$(git -C "$d" rev-parse HEAD)" "$(git -C "$d" symbolic-ref -q --short HEAD || echo detached)"
    done
    echo "BASE=$_SS_BASE"
    ${after}`;
  return sh(script, T, { PATH: stubPnpm(failPnpm), TMPDIR: T });
}

beforeEach(() => { T = fs.mkdtempSync(path.join(os.tmpdir(), "stable-source-")); });
afterEach(() => { fs.rmSync(T, { recursive: true, force: true }); });

jest.setTimeout(120000);

test("every tree is detached at its remote's main; the shared checkouts are untouched", () => {
  const w = world();
  const r = prepare(w);
  expect(r.status).toBe(0);
  const rows = r.stdout.split("\n").filter((l) => l.startsWith("/")).map((l) => l.split(" "));
  expect(rows).toHaveLength(5);
  const want = [w.mono, w.fw, w.conn, w.a, w.m].map((x) => x.remote);
  rows.forEach(([, head, br], i) => { expect(head).toBe(want[i]); expect(br).toBe("detached"); });
  for (const x of [w.mono, w.fw, w.conn, w.a, w.m]) {
    expect(git(x.dir, "branch", "--show-current")).toBe("someone/else");
    expect(fs.readFileSync(path.join(x.dir, "v.txt"), "utf8")).toBe("someone's WIP\n");
  }
  // The harness was compiled inside the promoted tree, not the shared one.
  const ran = fs.readFileSync(path.join(T, "pnpm.log"), "utf8").trim();
  expect(ran).toMatch(/fsr-stable-src\.[^/]+\/fsr_all_widgets\/fortisoar-widget-harness$/);
});

test("the trees and their worktree entries are gone after exit", () => {
  const w = world();
  const r = prepare(w);
  const base = r.stdout.match(/BASE=(.*)/)[1];
  expect(fs.existsSync(base)).toBe(false);
  for (const x of [w.mono, w.fw, w.conn, w.a, w.m]) {
    expect(git(x.dir, "worktree", "list").split("\n")).toHaveLength(1);
  }
});

test("a failed step still removes everything it created", () => {
  const w = world();
  const r = prepare(w, { failPnpm: true });
  expect(r.status).toBe(7);
  expect(r.stderr).toMatch(/harness install\/compile failed/);
  for (const x of [w.mono, w.fw, w.conn, w.a, w.m]) {
    expect(git(x.dir, "worktree", "list").split("\n")).toHaveLength(1);
  }
  expect(fs.readdirSync(T).filter((n) => n.startsWith("fsr-stable-src."))).toEqual([]);
});

// Live: make exports WIDGETS_SRC (the shared checkout's widgets), and the build
// packed the Monitor from someone's release branch. Every step gets the tree's.
test("stable.sh hands the promoted widgets to the build and the live check", () => {
  const src = fs.readFileSync(path.join(ROOT, "scripts", "stable.sh"), "utf8");
  const uses = src.split("\n").filter((l) => /stable_install\.py|live-sanity\.sh/.test(l) && !/^\s*#/.test(l));
  expect(uses.length).toBeGreaterThanOrEqual(2);
  const calls = src.split(/\n(?=\S)/).filter((b) => /stable_install\.py"|live-sanity\.sh"/.test(b));
  for (const b of calls) expect(b).toMatch(/WIDGETS_SRC="\$SRC_ROOT\/widgets-src"/);
  expect(src).toMatch(/unset WIDGETS_SRC/);
});

// Live: make stable run from a monorepo worktree (no widget repos in it) died
// with "main tracks no remote". The widgets come from the main checkout.
test("a monorepo worktree takes the widgets from the main checkout", () => {
  const w = world();
  const wt = path.join(T, "mono-wt");
  git(w.mono.dir, "worktree", "add", "-q", "--detach", wt, "main");
  const script = `set -u; source "${LIB}"
    stable_source_prepare "${wt}" "${w.fw.dir}" "${w.conn.dir}" || exit 7
    git -C "$SRC_ROOT/widgets-src/agenticAssistant" rev-parse HEAD`;
  const r = sh(script, T, { PATH: stubPnpm(), TMPDIR: T });
  expect(r.stderr).not.toMatch(/tracks no remote/);
  expect(r.status).toBe(0);
  expect(r.stdout.trim().split("\n").pop()).toBe(w.a.remote);
});

// Live: the install record (dist/stable/installed-<box>.json) was written into the
// temporary promoted tree, removed on exit, so every re-run saw "no record" and
// refused a version the last run had installed. The record goes in CONN_REPO.
test("stable.sh writes the install record into the connector checkout, not the temporary tree", () => {
  const src = fs.readFileSync(path.join(ROOT, "scripts", "stable.sh"), "utf8");
  const start = src.indexOf('echo ">> build and import');
  const end = src.indexOf("|| exit $?", start);
  expect(start).toBeGreaterThan(-1);
  const block = src.slice(start, end).replace(/"\$PY" "\$SRC_CONN\/scripts\/stable_install\.py" \$\{ARGS:-\}/,
    'bash -c \'echo "DIST=$DIST_STABLE"\'');
  const r = sh(`set -u; unset DIST_STABLE; CONN_REPO=/shared/conn; SRC_CONN=/tmp/src/conn; SRC_ROOT=/tmp/src/root; SRC_FW=/tmp/src/fw; BOX=b; BOX_ENV=e\n${block}`, T);
  expect(r.stdout).toMatch(/^DIST=\/shared\/conn\/dist\/stable$/m);
});

// Live: the post-install sanity ran the harness of the INVOKING checkout (live-sanity
// takes ROOT from FSR_TOOL_HOME), a worktree with no node_modules: "tsc: command not
// found". It must run the promoted tree's harness, which stable_source_prepare compiled.
test("stable.sh runs the live sanity from the promoted tree, not the invoking checkout", () => {
  const src = fs.readFileSync(path.join(ROOT, "scripts", "stable.sh"), "utf8");
  const call = src.split("\n").find((l) => /live-sanity\.sh"/.test(l) && !/^\s*#/.test(l));
  expect(call).toMatch(/FSR_TOOL_HOME="\$SRC_ROOT"/);
});
