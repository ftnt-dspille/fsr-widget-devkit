'use strict';
// Phase 4 enforcement: fail the run if the mock tier touched a non-snapshotted
// platform endpoint. Under FSR_HERMETIC the proxy fallthrough is disabled and
// every un-served path returns a loud 599 and is recorded in the server's
// `hermeticMisses` set (exposed at /_fsr/hermetic-misses). A 599 only fails a
// *test* if that test happens to depend on the asset; a miss on an incidental
// request would otherwise pass silently and let a real forticloud dependency
// creep back into the "hermetic" suite. This global teardown queries every
// per-worker server (ports 14401, 14402 — see _isolated.js / playwright.config
// webServer) AFTER the suite and throws if any miss was recorded, so CI /
// ship-verify go red on the leak instead of shipping a half-hermetic tier.
//
// No-op when hermetic is off (live runs set FSR_HERMETIC=0).
const PORTS = [14401, 14402];

module.exports = async () => {
  if (process.env.FSR_HERMETIC === '0' || process.env.E2E_LIVE) return;
  const all = [];
  for (const port of PORTS) {
    try {
      const res = await fetch(`http://localhost:${port}/_fsr/hermetic-misses`);
      if (!res.ok) continue;
      const body = await res.json();
      if (body && body.hermetic && Array.isArray(body.misses) && body.misses.length) {
        for (const m of body.misses) all.push(`:${port} ${m}`);
      }
    } catch (_e) {
      // Server already torn down or never booted — nothing to enforce.
    }
  }
  if (all.length) {
    const uniq = Array.from(new Set(all)).sort();
    throw new Error(
      `Hermetic e2e tier leaked ${uniq.length} un-snapshotted platform path(s) ` +
      `to the forticloud proxy:\n  ${uniq.join('\n  ')}\n` +
      `Snapshot them locally (scripts/fetch-soar-assets.sh) or stub them in ` +
      `server.js — the mock tier must never depend on a live box.`
    );
  }
};
