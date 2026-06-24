"use strict";
// soarEnv credential resolution. @napi-rs/keyring is a committed dependency, so
// it is always installed — we mock it (NOT as a virtual module: with the real
// package present, a `virtual: true` mock is registered under the literal
// string and the real module wins once it's in the warm multi-file registry,
// making these tests pass alone but fail in the full `pnpm test` run). A plain
// jest.mock reliably replaces it. resolveSoarEnv is called with an explicit env
// object throughout, which keeps it hermetic (the .env file tier is only read
// on the default-process.env path, never in tests).

interface KeychainEntry {
  account: string;
  getPassword(): string | null;
  setPassword(v: string): void;
  deletePassword(): boolean;
}

const KEYCHAIN: Record<string, string> = {}; // account -> stored secret
jest.mock("@napi-rs/keyring", () => ({
  Entry: class {
    account: string;
    constructor(_service: string, account: string) {
      this.account = account;
    }
    getPassword(): string | null {
      return KEYCHAIN[this.account] || null;
    }
    setPassword(v: string): void {
      KEYCHAIN[this.account] = v;
    }
    deletePassword(): boolean {
      const had = this.account in KEYCHAIN;
      delete KEYCHAIN[this.account];
      return had;
    }
  },
}));

const { resolveSoarEnv, isExplicitHostOverride } = require("../lib/soarEnv");

beforeEach(() => {
  for (const k of Object.keys(KEYCHAIN)) delete KEYCHAIN[k];
});

describe("host / port parsing (unchanged behavior)", () => {
  test("adds https scheme and strips trailing slash", () => {
    const { host } = resolveSoarEnv({ FSR_BASE_URL: "soar.example.com/" });
    expect(host).toBe("https://soar.example.com");
  });
  test("FSR_PORT overrides the URL port", () => {
    const { host } = resolveSoarEnv({
      FSR_BASE_URL: "https://soar.example.com:443",
      FSR_PORT: "8443",
    });
    expect(host).toBe("https://soar.example.com:8443");
  });
});

describe("password precedence: env var > keychain > .env", () => {
  test("explicit env var wins even if a keychain entry exists", () => {
    KEYCHAIN["admin"] = "from-keychain";
    const { pass } = resolveSoarEnv({
      FSR_USERNAME: "admin",
      FSR_PASSWORD: "from-env",
    });
    expect(pass).toBe("from-env");
  });

  test("keychain is used when no env password is set", () => {
    KEYCHAIN["admin"] = "from-keychain";
    const { pass } = resolveSoarEnv({ FSR_USERNAME: "admin" });
    expect(pass).toBe("from-keychain");
  });

  test("empty when neither env nor keychain has a secret", () => {
    const { pass } = resolveSoarEnv({ FSR_USERNAME: "nobody" });
    expect(pass).toBe("");
  });

  test("legacy FORTISOAR_PASSWORD still works", () => {
    const { pass } = resolveSoarEnv({
      FSR_USERNAME: "admin",
      FORTISOAR_PASSWORD: "legacy",
    });
    expect(pass).toBe("legacy");
  });
});

describe("api key precedence (separate keychain account)", () => {
  test("env api key wins", () => {
    KEYCHAIN["admin:apikey"] = "kc-key";
    const { apiKey } = resolveSoarEnv({
      FSR_USERNAME: "admin",
      FSR_API_KEY: "env-key",
    });
    expect(apiKey).toBe("env-key");
  });
  test("keychain api key used when env unset", () => {
    KEYCHAIN["admin:apikey"] = "kc-key";
    const { apiKey } = resolveSoarEnv({ FSR_USERNAME: "admin" });
    expect(apiKey).toBe("kc-key");
  });
});

describe("service name", () => {
  test("defaults to fsr-widget-harness", () => {
    expect(resolveSoarEnv({}).service).toBe("fsr-widget-harness");
  });
});

// Regression: `ship.sh` exports FSR_BASE_URL for a one-shot target. The server
// must treat that as an explicit override that wins over the persisted UI pick,
// or a push silently lands on the last box the UI was pointed at. The file tier
// is injected here to keep the test independent of the real `.env`.
describe("isExplicitHostOverride", () => {
  const FILE = { FSR_BASE_URL: "https://10.99.249.205" };

  test("true when env host differs from the .env file host", () => {
    expect(isExplicitHostOverride({ FSR_BASE_URL: "https://10.99.249.159" }, FILE)).toBe(true);
  });
  test("false when env host equals the .env file host (mere dotenv copy)", () => {
    expect(isExplicitHostOverride({ FSR_BASE_URL: "https://10.99.249.205" }, FILE)).toBe(false);
  });
  test("false when no host is set on the environment", () => {
    expect(isExplicitHostOverride({}, FILE)).toBe(false);
  });
  test("legacy FORTISOAR_HOST is honored as the env host", () => {
    expect(isExplicitHostOverride({ FORTISOAR_HOST: "https://10.99.249.159" }, FILE)).toBe(true);
  });
  test("true when env host is set but the .env file declares none", () => {
    expect(isExplicitHostOverride({ FSR_BASE_URL: "https://10.99.249.159" }, {})).toBe(true);
  });
});
