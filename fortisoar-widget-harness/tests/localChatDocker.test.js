"use strict";
// make local-chat-docker (scripts/local_chat_docker.sh) with a fake docker and a fake `security` on PATH: the
// connector, the framework and the widget stream into ONE container, the model credentials go in by NAME only (never a
// value on a command line), the keychain key is fetched only when the model may be paid, and the turn's files come back.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
let T, bin;
beforeEach(() => {
  T = fs.mkdtempSync(path.join(os.tmpdir(), "chat-docker-"));
  bin = path.join(T, "bin"); fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "docker"), `#!/bin/sh
case "$1" in
  info) exit 0 ;;
  build) echo "build $*" >> "${T}/calls" ;;
  volume) [ "$2" = inspect ] && exit 1; echo "volume $*" >> "${T}/calls" ;;
  cp) echo "cp $*" >> "${T}/calls"; mkdir -p "$3"; echo "turn" > "$3/transcript.md" ;;
  rm) echo "rm $*" >> "${T}/calls" ;;
  run) echo "run $*" >> "${T}/calls"; case "$*" in *" tar -xf - -C /shell"*) cat >/dev/null ;; *) cat > "${T}/stdin.tar"; env | grep -E '^(ANTHROPIC_API_KEY|FRANK_API_KEY)=' | sed 's/=.*/=<set>/' >> "${T}/calls"; exit "\${RUN_RC:-0}" ;; esac ;;
esac
`, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, "security"), `#!/bin/sh\necho "security $*" >> "${T}/calls"\necho sk-from-keychain\n`, { mode: 0o755 });
});
afterEach(() => fs.rmSync(T, { recursive: true, force: true }));

function trees() {
  const mk = (n, files) => {
    const d = path.join(T, n); fs.mkdirSync(d, { recursive: true });
    for (const [f, b] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.writeFileSync(path.join(d, f), b); }
    spawnSync("git", ["-C", d, "init", "-q"]); return d;
  };
  const src = mk("src", { "fortisoar-widget-harness/pnpm-lock.yaml": "lock\n", "fsr_src/x.js": "x\n" });
  const conn = mk("conn", { "connector-fsr-agentic-assistant/requirements.txt": "fsr-playbooks==0.1.0\nopenai\n", "scripts/local_turn.py": "# t\n" });
  const fw = mk("fw", { "pyproject.toml": "[project]\nname='f'\n", "fsr_playbooks/__init__.py": "" });
  const ws = path.join(T, "ws"); mk("ws/agenticAssistant", { "widget/info.json": "{}\n" });
  return { src, conn, fw, ws };
}
const run = (env = {}) => {
  const t = trees();
  const base = { ...process.env, PATH: `${bin}:${process.env.PATH}`, TEST_DOCKER_SRC: t.src, CONN_REPO: t.conn, FSR_SRC: t.fw, TEST_DOCKER_WIDGETS_SRC: t.ws, OUT: path.join(T, "out"), BUNDLE: "ka_c2_beacon" };
  for (const k of ["ANTHROPIC_API_KEY", "FRANK_API_KEY", "FRANK_BASE_URL", "FRANK_MODEL"]) delete base[k];
  return spawnSync("bash", [path.join(ROOT, "scripts", "local_chat_docker.sh")], { env: { ...base, ...env }, encoding: "utf8" });
};

test("the connector, framework, widget and root tree stream into one container; the turn's files come back; the container is removed", () => {
  const r = run({ FRANK_BASE_URL: "https://gw.example.com/v1", FRANK_API_KEY: "frank-secret" });
  expect(r.status).toBe(0);
  const calls = fs.readFileSync(path.join(T, "calls"), "utf8");
  expect(calls).toMatch(/build .*-f \S*dev\/chat\.Dockerfile/);
  expect(calls).toMatch(/^run run --name fsr-chat-\d+-\d+ -i --init --ipc=host /m);
  expect(calls).toMatch(/^cp cp fsr-chat-\d+-\d+:\/out\/\. \S+\/out\/$/m);
  expect(calls).toMatch(/^rm rm -f fsr-chat-/m);
  expect(fs.readFileSync(path.join(T, "out", "transcript.md"), "utf8")).toMatch(/turn/);
  const outer = spawnSync("python3", ["-c", "import sys,tarfile;print('\\n'.join(tarfile.open(sys.argv[1]).getnames()))", path.join(T, "stdin.tar")], { encoding: "utf8" }).stdout;
  for (const n of ["root.tar", "conn.tar", "fw.tar", "widget.tar", "dev.tar"]) expect(outer).toContain(n);
});

test("credentials go in by name only: no value is ever on the docker command line", () => {
  const r = run({ FRANK_BASE_URL: "https://gw.example.com/v1", FRANK_API_KEY: "frank-secret", FRANK_MODEL: "m" });
  expect(r.status).toBe(0);
  const calls = fs.readFileSync(path.join(T, "calls"), "utf8");
  expect(calls).toMatch(/ -e FRANK_BASE_URL -e FRANK_API_KEY -e FRANK_MODEL /);
  expect(calls).not.toMatch(/frank-secret|gw\.example\.com/);
  expect(r.stdout + r.stderr).not.toMatch(/frank-secret|sk-from-keychain/);
});

test("the keychain key backs the paid fallback and is never printed; a fake-model run never reads it", () => {
  let r = run();
  expect(r.status).toBe(0);
  let calls = fs.readFileSync(path.join(T, "calls"), "utf8");
  expect(calls).toMatch(/^security find-generic-password -s fsr-studio -a anthropic_api_key -w$/m);
  expect(calls).toMatch(/ -e ANTHROPIC_API_KEY /);
  expect(calls).not.toMatch(/sk-from-keychain/);
  expect(r.stdout + r.stderr).not.toMatch(/sk-from-keychain/);
  fs.rmSync(path.join(T, "calls"));
  r = run({ LLM: "fake" });
  calls = fs.readFileSync(path.join(T, "calls"), "utf8");
  expect(calls).not.toMatch(/security find-generic-password/);
  expect(calls).not.toMatch(/-e ANTHROPIC_API_KEY/);
});

test("the container's exit code is the turn's exit code", () => {
  expect(run({ RUN_RC: "3" }).status).toBe(3);
});

test("no bundle is a usage error; no engine with DOCKER_START=none exits 2", () => {
  expect(run({ BUNDLE: "" }).status).toBe(2);
  fs.writeFileSync(path.join(bin, "docker"), "#!/bin/sh\n[ \"$1\" = info ] && exit 1\nexit 0\n", { mode: 0o755 });
  const r = run({ DOCKER_START: "none" });
  expect(r.status).toBe(2);
  expect(r.stderr).toMatch(/no docker engine answering/);
});
