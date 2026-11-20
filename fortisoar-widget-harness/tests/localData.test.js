"use strict";
// Gitignored data a worktree lacks is read from the main checkout (scripts/localData.js).
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { localDataDir } = require("../scripts/localData");

let T, main, wt;
const g = (d, ...a) => execFileSync("git", ["-C", d, ...a], { encoding: "utf8",
  env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t",
    GIT_COMMITTER_EMAIL: "t@example.com", GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "core.hooksPath",
    GIT_CONFIG_VALUE_0: "/dev/null" } });
beforeEach(() => {
  T = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "localdata-")));
  main = path.join(T, "repo");
  fs.mkdirSync(path.join(main, "h"), { recursive: true });
  fs.writeFileSync(path.join(main, ".gitignore"), "h/data/\n");
  fs.writeFileSync(path.join(main, "h", "x"), "x\n");
  g(main, "init", "-q", "-b", "main"); g(main, "add", "-A"); g(main, "commit", "-q", "-m", "x");
  fs.mkdirSync(path.join(main, "h", "data")); fs.writeFileSync(path.join(main, "h", "data", "c.json"), "{}");
  wt = path.join(T, "wt"); g(main, "worktree", "add", "-q", "--detach", wt);
});
afterEach(() => fs.rmSync(T, { recursive: true, force: true }));

test("a worktree without the data reads the main checkout's", () => {
  expect(localDataDir("data", path.join(wt, "h"))).toBe(path.join(main, "h", "data"));
});
test("a worktree with its own data keeps it", () => {
  fs.mkdirSync(path.join(wt, "h", "data")); fs.writeFileSync(path.join(wt, "h", "data", "mine.json"), "{}");
  expect(localDataDir("data", path.join(wt, "h"))).toBe(path.join(wt, "h", "data"));
});
test("the main checkout reads its own", () => {
  expect(localDataDir("data", path.join(main, "h"))).toBe(path.join(main, "h", "data"));
});
