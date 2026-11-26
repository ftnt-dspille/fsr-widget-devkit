"use strict";
// make test-docker (scripts/test_docker.sh) with fake docker/colima on PATH:
// it starts Colima when no engine answers, streams the working tree in, and
// names the node_modules volume by the lockfile hash. No real container runs.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
let T, bin;
beforeEach(() => {
  T = fs.mkdtempSync(path.join(os.tmpdir(), "test-docker-"));
  bin = path.join(T, "bin"); fs.mkdirSync(bin);
  // docker: `info` fails until colima has "started"; `run` saves stdin and its args.
  fs.writeFileSync(path.join(bin, "docker"), `#!/bin/sh
case "$1" in
  info) [ -f "${T}/started" ] ;;
  build) echo "build $*" >> "${T}/calls" ;;
  run) echo "run $*" >> "${T}/calls"; cat > "${T}/stdin.tar"; env | grep '^TESTS=' >> "${T}/calls" ;;
esac
`, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, "colima"), `#!/bin/sh\necho "colima $*" >> "${T}/calls"\n[ "$1" = start ] && touch "${T}/started"\nexit 0\n`, { mode: 0o755 });
});
afterEach(() => fs.rmSync(T, { recursive: true, force: true }));

// A source tree with one file carrying an extended attribute: macOS tar turns
// such files into extra ._<name> AppleDouble entries unless told not to.
function srcTree() {
  const d = path.join(T, "src");
  fs.mkdirSync(path.join(d, "fortisoar-widget-harness", "tests"), { recursive: true });
  fs.writeFileSync(path.join(d, "fortisoar-widget-harness", "pnpm-lock.yaml"), "lock\n");
  const f = path.join(d, "fortisoar-widget-harness", "tests", "a.test.js");
  fs.writeFileSync(f, "test('a', () => {});\n");
  spawnSync("xattr", ["-w", "com.example.tag", "x", f]);
  spawnSync("git", ["-C", d, "init", "-q"]);
  return d;
}
const run = (env = {}) => spawnSync("bash", [path.join(ROOT, "scripts", "test_docker.sh")],
  { env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, TESTS: "promoteGate", TEST_DOCKER_SRC: srcTree(), ...env }, encoding: "utf8" });

test("no engine: starts colima, then builds and runs with the tree, the tests and the lockfile volume", () => {
  const r = run();
  expect(r.status).toBe(0);
  const calls = fs.readFileSync(path.join(T, "calls"), "utf8");
  expect(calls).toMatch(/^colima start/m);
  expect(calls.indexOf("colima start")).toBeLessThan(calls.indexOf("build "));
  expect(calls).toMatch(/run --rm -i .* -v fsr-nm-[0-9a-f]{12}:\/nm/);
  expect(calls).toMatch(/^TESTS=promoteGate$/m);
  // Raw entry names: macOS tar folds ._ entries back into xattrs when IT reads
  // the archive, so only a non-Apple reader (Linux tar in the container) sees them.
  const list = spawnSync("python3", ["-c", "import sys,tarfile;print('\\n'.join(tarfile.open(sys.argv[1]).getnames()))",
    path.join(T, "stdin.tar")], { encoding: "utf8" }).stdout;
  expect(list).toMatch(/^fortisoar-widget-harness\/tests\/a\.test\.js$/m);   // untracked work goes in
  expect(list).not.toMatch(/node_modules\//);
  expect(list).not.toMatch(/(^|\/)\._/m);   // macOS AppleDouble files became broken jest suites
});

test("an engine already up: colima is not touched", () => {
  fs.writeFileSync(path.join(T, "started"), "");
  expect(run().status).toBe(0);
  expect(fs.readFileSync(path.join(T, "calls"), "utf8")).not.toMatch(/colima/);
});

test("DOCKER_START=none with no engine fails loud, never starts colima", () => {
  const r = run({ DOCKER_START: "none" });
  expect(r.status).toBe(2);
  expect(r.stderr).toMatch(/no docker engine answering/);
  expect(fs.existsSync(path.join(T, "calls"))).toBe(false);
});

test("a widget run streams the widget's own repo in as a second archive and tells the container which widget", () => {
  const src = srcTree();
  const ws = path.join(T, "ws"), w = path.join(ws, "mywidget");
  fs.mkdirSync(path.join(w, "tests"), { recursive: true });
  fs.writeFileSync(path.join(w, "tests", "w.test.js"), "test('w', () => {});\n");
  fs.writeFileSync(path.join(w, "ignored.log"), "x\n"); fs.writeFileSync(path.join(w, ".gitignore"), "ignored.log\n");
  spawnSync("git", ["-C", w, "init", "-q"]);
  fs.writeFileSync(path.join(T, "started"), "");
  const r = run({ TEST_DOCKER_SRC: src, TEST_DOCKER_WIDGET: "mywidget", TEST_DOCKER_WIDGETS_SRC: ws });
  expect(r.status).toBe(0);
  expect(fs.readFileSync(path.join(T, "calls"), "utf8")).toMatch(/-e WIDGET=mywidget /);
  const list = spawnSync("python3", ["-c", "import sys,tarfile;print('\\n'.join(tarfile.open(sys.argv[1],ignore_zeros=True).getnames()))", path.join(T, "stdin.tar")], { encoding: "utf8" }).stdout;
  expect(list).toMatch(/^fortisoar-widget-harness\/tests\/a\.test\.js$/m);   // the root tree is still there
  expect(list).toMatch(/^mywidget\/tests\/w\.test\.js$/m);                   // the widget's repo rides along
  expect(list).not.toMatch(/ignored\.log/);
});

test("a widget that is not checked out fails loud", () => {
  fs.writeFileSync(path.join(T, "started"), "");
  const r = run({ TEST_DOCKER_WIDGET: "nope", TEST_DOCKER_WIDGETS_SRC: path.join(T, "ws") });
  expect(r.status).not.toBe(0);
  expect(r.stderr).toMatch(/no widget checkout/);
});
