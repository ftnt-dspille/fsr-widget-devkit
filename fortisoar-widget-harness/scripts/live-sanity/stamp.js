"use strict";
// Machine-checkable proof of a live-sanity run, one stamp per repo commit that
// was live on the box. Local only, never tracked:
//
//   ${FSR_LIVE_SANITY_DIR:-~/.cache/fsr-live-sanity}/<repo>/<sha>.json
//   { repo, path, branch, sha, dirty, box, verdict, checks:[{name,status,detail}], timestamp }
//
// Every verdict writes a stamp (VERIFIED, PARTIAL, FAIL); a later run for the
// same sha overwrites it. A dirty tree is recorded as dirty: what ran on the box
// was not that commit, so a dirty stamp never proves it.
//
// Reader (internal; the promote gate calls it):
//   node scripts/live-sanity/stamp.js status --repo <name> --sha <sha>
//   exits 0 only for a VERIFIED, clean stamp; prints the stamp JSON either way.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

function stampDir() {
  return process.env.FSR_LIVE_SANITY_DIR || path.join(os.homedir(), ".cache", "fsr-live-sanity");
}

function git(dir, args) {
  return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

function repoState(dir) {
  const top = git(dir, ["rev-parse", "--show-toplevel"]);
  // A worktree's toplevel is its own dir; name the repo by its main checkout.
  const common = path.resolve(top, git(dir, ["rev-parse", "--git-common-dir"]));
  const repo = path.basename(path.basename(common) === ".git" ? path.dirname(common) : common);
  return {
    repo, path: top,
    branch: git(dir, ["rev-parse", "--abbrev-ref", "HEAD"]),
    sha: git(dir, ["rev-parse", "HEAD"]),
    dirty: isDirty(dir),
  };
}

// A connector deploy bumps its version (info.json "version", a new release-notes
// entry) in the tree before the live sanity runs, so what ran IS the commit plus
// a version string. The deploy names those files in LIVE_SANITY_VERSION_BUMP_FILES
// (colon list, repo-relative); a change there counts as clean ONLY when it is a
// pure version bump: info.json changes nothing but "version" lines, release notes
// only gain lines. Any other edit, anywhere, is dirty.
function isVersionOnlyDiff(dir, file) {
  const diff = git(dir, ["diff", "-U0", "HEAD", "--", file]);
  const changed = diff.split("\n").filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---) /.test(l));
  if (!changed.length) return true;
  if (/(^|\/)info\.json$/.test(file)) return changed.every((l) => /^[+-]\s*"version"\s*:/.test(l));
  if (/release_notes\.md$/i.test(file)) return changed.every((l) => l.startsWith("+"));
  return false;
}

function isDirty(dir) {
  const bump = (process.env.LIVE_SANITY_VERSION_BUMP_FILES || "").split(":").filter(Boolean);
  // Tracked changes, staged or not (untracked files never ran on the box).
  const files = git(dir, ["diff", "--name-only", "HEAD"]).split("\n").filter(Boolean);
  return files.some((f) => !(bump.includes(f) && isVersionOnlyDiff(dir, f)));
}

function writeStamps(repoDirs, { box, verdict, results, now = new Date() }) {
  const written = [];
  const seen = new Set();
  for (const d of repoDirs) {
    if (!d || !fs.existsSync(d)) continue;
    let st;
    try { st = repoState(d); } catch (_) { continue; }
    if (seen.has(st.path)) continue;
    seen.add(st.path);
    const stamp = { ...st, box, verdict,
      checks: results.map((r) => ({ name: r.name, status: r.status, detail: r.detail || "" })),
      timestamp: now.toISOString() };
    const file = path.join(stampDir(), st.repo, `${st.sha}.json`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(stamp, null, 2) + "\n");
    written.push(file);
  }
  return written;
}

function readStamp(repo, sha) {
  const dir = path.join(stampDir(), repo);
  if (!fs.existsSync(dir)) return null;
  // Accept an abbreviated sha.
  const f = fs.readdirSync(dir).find((n) => n.startsWith(sha) && n.endsWith(".json"));
  return f ? JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) : null;
}

// Pure: does this stamp prove the commit? VERIFIED and clean only.
function proves(stamp) {
  return !!(stamp && stamp.verdict === "VERIFIED" && stamp.dirty === false);
}

if (require.main === module) {
  const a = process.argv.slice(2);
  const arg = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
  if (a[0] !== "status" || !arg("--repo") || !arg("--sha")) {
    console.error("usage: stamp.js status --repo <name> --sha <sha>");
    process.exit(2);
  }
  const s = readStamp(arg("--repo"), arg("--sha"));
  console.log(JSON.stringify(s));
  if (!s) { console.error(`no live-sanity stamp for ${arg("--repo")}@${arg("--sha")}`); process.exit(1); }
  if (!proves(s)) { console.error(`stamp does not prove the commit: verdict=${s.verdict} dirty=${s.dirty}`); process.exit(1); }
  process.exit(0);
}

module.exports = { writeStamps, readStamp, proves, repoState, stampDir };
