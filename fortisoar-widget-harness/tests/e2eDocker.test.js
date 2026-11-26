"use strict";
// make test-e2e-docker (scripts/e2e_docker.sh) with a fake docker on PATH: the Playwright image is pinned to the
// version the lockfile pins, the tree and the widget's own repo stream in, the dev servers and browser run inside ONE
// --rm --init container (so nothing is orphaned on the host), and no literal port is passed in.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
let T, bin;
beforeEach(() => {
  T = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-docker-"));
  bin = path.join(T, "bin"); fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "docker"), `#!/bin/sh
case "$1" in
  info) exit 0 ;;
  build) echo "build $*" >> "${T}/calls" ;;
  volume) [ "$2" = inspect ] && exit 1; echo "volume $*" >> "${T}/calls" ;;
  run) echo "run $*" >> "${T}/calls"; case "$*" in *" tar -xf - -C /shell"*) cat >/dev/null ;; *) cat > "${T}/stdin.tar"; env | grep -E '^(SPEC|WIDGET|W)=' >> "${T}/calls" ;; esac ;;
esac
`, { mode: 0o755 });
});
afterEach(() => fs.rmSync(T, { recursive: true, force: true }));

function tree() {
  const d = path.join(T, "src");
  fs.mkdirSync(path.join(d, "fortisoar-widget-harness"), { recursive: true });
  fs.writeFileSync(path.join(d, "fortisoar-widget-harness", "pnpm-lock.yaml"), "lock\n");
  fs.mkdirSync(path.join(d, "fsr_src"), { recursive: true });
  fs.writeFileSync(path.join(d, "fsr_src", "templates.min.x.js"), "x\n");
  const ws = path.join(T, "ws", "mywidget", "tests", "e2e");
  fs.mkdirSync(ws, { recursive: true });
  fs.writeFileSync(path.join(ws, "a.spec.js"), "// spec\n");
  spawnSync("git", ["-C", d, "init", "-q"]);
  spawnSync("git", ["-C", path.join(T, "ws", "mywidget"), "init", "-q"]);
  return { d, ws: path.join(T, "ws") };
}
const run = (env = {}) => {
  const { d, ws } = tree();
  return spawnSync("bash", [path.join(ROOT, "scripts", "e2e_docker.sh")],
    { env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, TEST_DOCKER_SRC: d, TEST_DOCKER_WIDGETS_SRC: ws, WIDGET: "mywidget", ...env }, encoding: "utf8" });
};
const names = () => spawnSync("python3", ["-c", "import sys,tarfile;print('\\n'.join(tarfile.open(sys.argv[1],ignore_zeros=True).getnames()))", path.join(T, "stdin.tar")], { encoding: "utf8" }).stdout;

test("the Playwright image is pinned to the lockfile's @playwright/test version", () => {
  const df = fs.readFileSync(path.join(ROOT, "dev", "e2e.Dockerfile"), "utf8");
  const lock = fs.readFileSync(path.join(ROOT, "fortisoar-widget-harness", "pnpm-lock.yaml"), "utf8");
  const v = /'@playwright\/test':\s*\n\s*specifier:[^\n]*\n\s*version: ([0-9.]+)/.exec(lock) || /@playwright\/test@([0-9.]+)/.exec(lock);
  expect(df).toMatch(new RegExp(`^FROM mcr\\.microsoft\\.com/playwright:v${v[1].replace(/\./g, "\\.")}-`, "m"));
});

test("one --rm --init container gets the tree and the widget repo; the shell is cached once; the spec filter and the widget go in as env, never a port", () => {
  const r = run();
  expect(r.status).toBe(0);
  const calls = fs.readFileSync(path.join(T, "calls"), "utf8");
  expect(calls).toMatch(/build .*-f \S*dev\/e2e\.Dockerfile/);
  expect(calls).toMatch(/volume create fsr-shell-[0-9a-f]{12}/);
  expect(calls).toMatch(/run --rm -i --init --ipc=host .* -v fsr-nm-e2e-[0-9a-f]{12}:\/nm -v fsr-shell-[0-9a-f]{12}:\/shell:ro/);
  expect(calls).toMatch(/^WIDGET=mywidget$/m);
  expect(calls).not.toMatch(/\b1440[0-9]\b|PORT=/);
  const list = names();
  expect(list).toMatch(/^fortisoar-widget-harness\/pnpm-lock\.yaml$/m);
  expect(list).toMatch(/^mywidget\/tests\/e2e\/a\.spec\.js$/m);
});

test("a spec path under widgets-src/<name>/ picks that widget's repo", () => {
  const r = run({ WIDGET: "", SPEC: "../widgets-src/mywidget/tests/e2e/a.spec.js" });
  expect(r.status).toBe(0);
  expect(names()).toMatch(/^mywidget\/tests\/e2e\/a\.spec\.js$/m);
});

test("neither SPEC nor WIDGET is a usage error; no engine with DOCKER_START=none exits 2 (the door falls back to the host)", () => {
  expect(run({ WIDGET: "", SPEC: "" }).status).toBe(2);
  fs.writeFileSync(path.join(bin, "docker"), "#!/bin/sh\n[ \"$1\" = info ] && exit 1\nexit 0\n", { mode: 0o755 });
  const r = run({ DOCKER_START: "none" });
  expect(r.status).toBe(2);
  expect(r.stderr).toMatch(/no docker engine answering/);
});
