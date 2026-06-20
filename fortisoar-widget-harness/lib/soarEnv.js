"use strict";
/**
 * Single source of truth for SOAR connection details.
 *
 * Standardized on the fsr_core project's .env convention so one .env can drive
 * both projects:
 *   FSR_BASE_URL   host, scheme optional, no trailing slash (e.g. foo.forticloud.com)
 *   FSR_PORT       optional non-standard port (overrides any port in the URL)
 *   FSR_USERNAME   login id
 *   FSR_PASSWORD   password (exchanged for a JWT)
 *   FSR_API_KEY    optional API key (preferred over user/pass where supported)
 *
 * Legacy FORTISOAR_HOST / FORTISOAR_USERNAME / FORTISOAR_PASSWORD are still read
 * as a fallback so nothing breaks mid-transition.
 *
 * SECRET PRECEDENCE (password + api key): real environment variable  >  OS
 * keychain  >  .env file. So CI/Docker keep using exported env vars, interactive
 * machines read from the OS keychain (no plaintext on disk), and a plain .env
 * still works for anyone who hasn't set up the keychain. Store a secret in the
 * keychain with `node scripts/widget.js login` (see KEYRING_SERVICE).
 */

const fs = require("fs");
const path = require("path");

const KEYRING_SERVICE = process.env.FSR_KEYRING_SERVICE || "fsr-widget-harness";

// Read a secret from the OS keychain via the OPTIONAL @napi-rs/keyring dep.
// Returns "" on any failure — not installed, no stored entry, or a headless
// host with no desktop keyring (CI/Docker) — so resolution falls through to the
// next tier instead of throwing.
function keyringSecret(account, service) {
  if (!account) return "";
  try {
    const { Entry } = require("@napi-rs/keyring");
    return new Entry(service || KEYRING_SERVICE, account).getPassword() || "";
  } catch (_) {
    return "";
  }
}

// Parse the .env FILE itself (not process.env) so it can act as the lowest
// precedence tier even though dotenv has already copied it into process.env.
// Comparing a process.env value against the file value tells us whether the
// former is a *real* exported override or merely the .env copy.
function parseDotenvFile() {
  try {
    const dotenv = require("dotenv");
    const p = path.resolve(__dirname, "..", ".env");
    if (!fs.existsSync(p)) return {};
    return dotenv.parse(fs.readFileSync(p));
  } catch (_) {
    return {};
  }
}

// Normalize a FSR_BASE_URL (+ optional FSR_PORT) into a full origin. Scheme is
// optional in the env value (defaults to https); an explicit port overrides any
// port already in the URL.
function normalizeHost(raw, port) {
  raw = (raw || "").trim();
  port = (port || "").trim();
  if (!raw) return "";
  if (!/^https?:\/\//i.test(raw)) raw = "https://" + raw;
  raw = raw.replace(/\/+$/, "");
  if (!port) return raw;
  try {
    const u = new URL(raw);
    u.port = port;
    return u.origin;
  } catch (_) {
    return raw;
  }
}

function resolveSoarEnv(env, opts) {
  const useDefaultEnv = !env; // explicit env (tests) => don't touch the .env file
  env = env || process.env;
  const fileEnv = useDefaultEnv ? parseDotenvFile() : {};
  const service = (opts && opts.service) || KEYRING_SERVICE;

  // Three-tier secret: real exported env var > keychain > .env file value.
  function tieredSecret(envVal, fileVal, account) {
    const real = envVal && envVal !== fileVal ? envVal : ""; // exported override
    return real || keyringSecret(account, service) || fileVal || "";
  }

  const host = normalizeHost(
    env.FSR_BASE_URL || env.FORTISOAR_HOST || fileEnv.FSR_BASE_URL || "",
    env.FSR_PORT || fileEnv.FSR_PORT || ""
  );

  const user = (env.FSR_USERNAME || env.FORTISOAR_USERNAME || fileEnv.FSR_USERNAME || "").trim();

  const pass = tieredSecret(
    env.FSR_PASSWORD || env.FORTISOAR_PASSWORD || "",
    fileEnv.FSR_PASSWORD || fileEnv.FORTISOAR_PASSWORD || "",
    user
  );

  const apiKey = tieredSecret(
    (env.FSR_API_KEY || "").trim(),
    (fileEnv.FSR_API_KEY || "").trim(),
    user ? `${user}:apikey` : ""
  );

  return { host, user, pass, apiKey, service };
}

// Resolve SOAR connection details from ONE explicitly-chosen .env file (used by
// the harness UI's "FortiSOAR target" picker). Unlike resolveSoarEnv, the file
// is the intent, so file values win; the OS keychain only backfills a secret the
// file omits. The ambient process.env (the startup .env dotenv already copied in)
// is deliberately ignored so picking .env.box can't inherit .env's host/creds.
function resolveSoarEnvFile(envPath, opts) {
  const dotenv = require("dotenv");
  const fileEnv = dotenv.parse(fs.readFileSync(envPath));
  const service = (opts && opts.service) || KEYRING_SERVICE;
  const host = normalizeHost(
    fileEnv.FSR_BASE_URL || fileEnv.FORTISOAR_HOST || "",
    fileEnv.FSR_PORT || ""
  );
  const user = (fileEnv.FSR_USERNAME || fileEnv.FORTISOAR_USERNAME || "").trim();
  const pass =
    (fileEnv.FSR_PASSWORD || fileEnv.FORTISOAR_PASSWORD || "").trim() ||
    keyringSecret(user, service);
  const apiKey =
    (fileEnv.FSR_API_KEY || "").trim() ||
    keyringSecret(user ? `${user}:apikey` : "", service);
  return { host, user, pass, apiKey, service, file: path.basename(envPath) };
}

// Discover selectable env files in the harness root: `.env` plus every `.env.*`
// EXCEPT templates/backups (`.example`, `.bak`). Returns a light summary (no
// secrets) for the picker — file basename, derived host, and login id.
function listEnvFiles(dir) {
  dir = dir || path.resolve(__dirname, "..");
  const dotenv = require("dotenv");
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch (_) {
    return [];
  }
  return names
    .filter((n) => n === ".env" || (n.startsWith(".env.") && !/\.(example|bak)$/.test(n)))
    .sort((a, b) => (a === ".env" ? -1 : b === ".env" ? 1 : a.localeCompare(b)))
    .map((file) => {
      try {
        const fe = dotenv.parse(fs.readFileSync(path.join(dir, file)));
        return {
          file,
          host: normalizeHost(fe.FSR_BASE_URL || fe.FORTISOAR_HOST || "", fe.FSR_PORT || ""),
          user: (fe.FSR_USERNAME || fe.FORTISOAR_USERNAME || "").trim(),
        };
      } catch (_) {
        return { file, host: "", user: "" };
      }
    })
    .filter((e) => e.host); // a file with no FSR_BASE_URL isn't a usable target
}

module.exports = { resolveSoarEnv, resolveSoarEnvFile, listEnvFiles, normalizeHost, KEYRING_SERVICE };
