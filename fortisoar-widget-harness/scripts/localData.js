"use strict";
// Gitignored local data (live captures, introspection reports) lives only in the
// main checkout: a worktree never has it. Read the worktree's own copy when it
// has one, else the main checkout's, the same rule WIDGETS_SRC follows (D10).
// Without this every harness test that reads captures failed in any worktree,
// so a widget push from a worktree could never pass its unit gate.
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const HARNESS = path.resolve(__dirname, "..");

function mainCheckout(dir) {
  try {
    const c = execFileSync("git", ["-C", dir, "rev-parse", "--path-format=absolute", "--git-common-dir"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return path.basename(c) === ".git" ? path.dirname(c) : null;
  } catch (_) { return null; }
}

function hasEntries(d) {
  try { return fs.readdirSync(d).some((n) => !n.startsWith(".")); } catch (_) { return false; }
}

// rel is relative to the harness dir, e.g. "tests/live/captures".
function localDataDir(rel, harness = HARNESS) {
  const own = path.join(harness, rel);
  if (hasEntries(own)) return own;
  const top = mainCheckout(harness);
  if (!top) return own;
  const inMain = path.join(top, path.relative(topOf(harness), harness), rel);
  return hasEntries(inMain) ? inMain : own;
}

function topOf(dir) {
  try {
    return execFileSync("git", ["-C", dir, "rev-parse", "--show-toplevel"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch (_) { return dir; }
}

module.exports = { localDataDir };
