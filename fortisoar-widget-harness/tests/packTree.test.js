"use strict";
// scripts/pack_tree.sh: the tree the container suites run. A tracked file deleted in the working
// tree used to fail the whole pack ("tar: <file>: Cannot stat"), which refused a connector push.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync, execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const SCRIPT = path.join(ROOT, "scripts", "pack_tree.sh");

test("a tracked file deleted in the working tree is left out, and the pack succeeds", () => {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pack-tree-")));
  const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com",
                GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" };
  const g = (...a) => execFileSync("git", ["-C", d, ...a], { env });
  try {
    g("init", "-q");
    fs.writeFileSync(path.join(d, "keep.py"), "A = 1\n");
    fs.writeFileSync(path.join(d, "gone.py"), "B = 1\n");
    fs.writeFileSync(path.join(d, ".gitignore"), "ignored.txt\n");
    g("add", "-A"); g("commit", "-qm", "1");
    fs.rmSync(path.join(d, "gone.py"));
    fs.writeFileSync(path.join(d, "new.py"), "C = 1\n");
    fs.writeFileSync(path.join(d, "ignored.txt"), "x\n");
    const r = spawnSync("bash", [SCRIPT, d], { env, maxBuffer: 1 << 24 });
    expect(r.status).toBe(0);
    const out = path.join(d, "..", path.basename(d) + ".tar");
    fs.writeFileSync(out, r.stdout);
    const names = execFileSync("tar", ["-tf", out], { encoding: "utf8" }).trim().split("\n").sort();
    fs.rmSync(out);
    expect(names).toEqual([".gitignore", "keep.py", "new.py"]);
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

test("both container runners pack through it", () => {
  for (const f of ["devloop_docker_py.sh", "test_docker.sh"]) {
    expect(fs.readFileSync(path.join(ROOT, "scripts", f), "utf8")).toMatch(/pack_tree\.sh/);
  }
});
