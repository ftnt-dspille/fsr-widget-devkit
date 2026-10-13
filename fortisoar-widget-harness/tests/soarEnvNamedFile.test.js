// An explicit FSR_ENV_FILE names the box for every default resolveSoarEnv()
// caller. The live UI driver used to ignore it and read `.env`: a rehearsal run
// with FSR_ENV_FILE=.env.159 signed in to a different appliance and reported
// the .159 record as not found.
const fs = require("fs");
const os = require("os");
const path = require("path");

jest.mock("@napi-rs/keyring", () => ({
  Entry: class { getPassword() { return null; } setPassword() {} deletePassword() { return false; } },
}));

const { resolveSoarEnv } = require("../lib/soarEnv");

describe("resolveSoarEnv honours an explicit FSR_ENV_FILE", () => {
  const saved = { ...process.env };
  let dir;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "soarenv-")); });
  afterEach(() => {
    process.env = { ...saved };
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("the named file's box wins over the ambient one", () => {
    const f = path.join(dir, ".env.box");
    fs.writeFileSync(f, "FSR_BASE_URL=https://named.example.com\nFSR_PORT=13000\nFSR_USERNAME=named\n");
    process.env.FSR_ENV_FILE = f;
    process.env.FSR_BASE_URL = "https://ambient.example.com";
    const r = resolveSoarEnv();
    expect(r.host).toBe("https://named.example.com:13000");
    expect(r.user).toBe("named");
  });

  test("a named file that does not exist falls back to the ambient env", () => {
    process.env.FSR_ENV_FILE = path.join(dir, "missing.env");
    process.env.FSR_BASE_URL = "https://ambient.example.com";
    expect(resolveSoarEnv().host).toBe("https://ambient.example.com");
  });

  test("an explicit env object (the tests' form) never reads the file", () => {
    const f = path.join(dir, ".env.box");
    fs.writeFileSync(f, "FSR_BASE_URL=https://named.example.com\n");
    process.env.FSR_ENV_FILE = f;
    expect(resolveSoarEnv({ FSR_BASE_URL: "https://given.example.com" }).host)
      .toBe("https://given.example.com");
  });
});
