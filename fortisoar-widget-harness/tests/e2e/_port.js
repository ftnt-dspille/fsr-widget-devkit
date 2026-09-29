"use strict";
// Pick the e2e server ports for THIS run, so concurrent runs never share them.
//
// Every run used to default to 14401/14402 with reuseExistingServer:true. A
// second run (another session, the IDE) then ADOPTED the first run's servers,
// and when the first run finished its servers went away mid-test: a burst of
// `net::ERR_CONNECTION_REFUSED` that reads like 60 widget regressions. Orphaned
// `node server.js` processes were silently reused the same way, with whatever
// env (FSR_HERMETIC, creds) they were booted with.
//
// Now: an explicit E2E_BASE_PORT still wins. Otherwise the runner claims the
// first free pair from 14401 upward, holding a lock dir (with its pid) under
// the OS tmpdir so two runs starting at the same moment cannot pick the same
// pair; a lock whose pid is dead is stale and reclaimed. The chosen base is
// written to process.env, which the workers inherit -- so the config, the
// per-worker fixtures (_isolated / _widgetId) and the hermetic teardown agree.
//
// Plain CommonJS on purpose: both playwright.config.ts and .js require it, so
// there is ONE copy of this logic.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const FIRST = 14401;
const LAST = 14499;
const LOCK_DIR = path.join(os.tmpdir(), "fsr-e2e-ports");

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
}

// Synchronous "can I bind this port" -- the config is evaluated synchronously,
// so the probe runs in a short-lived child.
function portFree(port) {
  const probe =
    "const s=require('net').createServer();" +
    "s.once('error',()=>process.exit(1));" +
    `s.listen(${port},()=>s.close(()=>process.exit(0)))`;
  try {
    execFileSync(process.execPath, ["-e", probe], { stdio: "ignore", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

function claim(base) {
  fs.mkdirSync(LOCK_DIR, { recursive: true });
  const lock = path.join(LOCK_DIR, String(base));
  try {
    fs.mkdirSync(lock);                    // atomic: exactly one claimant wins
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
    let pid = 0;
    try {
      pid = Number(fs.readFileSync(path.join(lock, "pid"), "utf8"));
    } catch {
      // A lock with no pid yet is being written by its claimant right now.
      return false;
    }
    if (pid && alive(pid)) return false;
    fs.rmSync(lock, { recursive: true, force: true });   // stale: owner is gone
    try {
      fs.mkdirSync(lock);
    } catch {
      return false;
    }
  }
  fs.writeFileSync(path.join(lock, "pid"), String(process.pid));
  return true;
}

function release(base) {
  fs.rmSync(path.join(LOCK_DIR, String(base)), { recursive: true, force: true });
}

function resolveBasePort() {
  if (process.env.E2E_BASE_PORT) return Number(process.env.E2E_BASE_PORT);
  // Opting into server reuse (a watch session) means the fixed legacy pair.
  if (process.env.E2E_REUSE === "1") return FIRST;
  for (let base = FIRST; base < LAST; base += 2) {
    if (!claim(base)) continue;
    if (portFree(base) && portFree(base + 1)) {
      process.env.E2E_BASE_PORT = String(base);
      return base;
    }
    release(base);                           // held by something else (an orphan)
  }
  throw new Error(`no free e2e port pair in ${FIRST}-${LAST}; ` +
                  `stale servers? see \`lsof -iTCP:${FIRST} -sTCP:LISTEN\``);
}

module.exports = { resolveBasePort, LOCK_DIR, FIRST };
