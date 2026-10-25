/**
 * Where PERIMETER_MODE and HOST are set (ADR 0023, D2): per execution context, like NODE_ENV and ROLE, and never
 * in a file Doppler renders. The containers run `overlay` on every interface and probe their health on IPv4
 * loopback, because `0.0.0.0` does not listen on `::1`; `npm run dev` runs `local-dev` on loopback; Jest runs
 * `test`. The server listens on the configured host, not on every interface.
 */
import fs from "fs";
import path from "path";

const root = path.join(__dirname, "../../..");
const read = (rel: string): string => fs.readFileSync(path.join(root, rel), "utf8");

const compose = read("docker-compose.yml");
const verify = read("docker-compose.local-verify.yml");

const apiEnv = compose.match(/x-api: &api\n[\s\S]*?\n {2}environment:\n((?: {4}- .*\n)+)/)?.[1];
const pollerEnv = compose.match(/\n {2}poller:\n[\s\S]*?\n {4}environment:\n((?: {6}- .*\n|\s*#.*\n)+)/)?.[1];
const verifyApiEnv = verify.match(/x-api-dev-env: &api-dev-env\n((?: {2}- .*\n)+)/)?.[1];
const verifyPollerEnv = verify.match(/\n {2}poller:\n {4}environment:\n((?: {6}- .*\n)+)/)?.[1];

describe("PERIMETER_MODE and HOST per execution context", () => {
  it.each([
    ["docker-compose.yml, the api replicas", apiEnv],
    ["docker-compose.local-verify.yml, the api replicas", verifyApiEnv],
  ])("%s run overlay on every interface", (_label, env) => {
    // Assert
    expect(env).toBeDefined();
    expect(env).toMatch(/- PERIMETER_MODE=overlay\n/);
    expect(env).toMatch(/- HOST=0\.0\.0\.0\n/);
  });

  it.each([
    ["docker-compose.yml", pollerEnv],
    ["docker-compose.local-verify.yml", verifyPollerEnv],
  ])("%s runs the poller in overlay", (_label, env) => {
    // Assert
    expect(env).toBeDefined();
    expect(env).toMatch(/- PERIMETER_MODE=overlay\n/);
  });

  it("probes container health on IPv4 loopback, which a 0.0.0.0 listener answers", () => {
    // Arrange
    const probes = [...compose.matchAll(/http:\/\/[^:/]+:3000\/health\/ready/g), ...read("Dockerfile").matchAll(/http:\/\/[^:/]+:3000\/health\/ready/g)].map((m) => m[0]);

    // Assert
    expect(probes).toHaveLength(2);
    for (const probe of probes) expect(probe).toBe("http://127.0.0.1:3000/health/ready");
  });

  it.each(["dev", "dev:prod-api"])("npm run %s runs local-dev on loopback", (script) => {
    // Arrange
    const scripts = (JSON.parse(read("package.json")) as { scripts: Record<string, string> }).scripts;

    // Assert
    expect(scripts[script]).toMatch(/\bNODE_ENV=development PERIMETER_MODE=local-dev HOST=127\.0\.0\.1 /);
  });

  it("runs Jest in test mode on loopback", () => {
    // Assert
    expect(process.env.PERIMETER_MODE).toBe("test");
    expect(process.env.HOST).toBe("127.0.0.1");
  });

  it.each(["config/env.prd.keys", "config/env.dev.keys"])("%s lists neither", (rel) => {
    // Arrange
    const text = read(rel);

    // Assert
    expect(text).not.toMatch(/\bPERIMETER_MODE\b/);
    expect(text).not.toMatch(/^\s*HOST\b/m);
  });

  it("listens on the configured host", () => {
    // Assert
    expect(read("src/main.ts")).toMatch(/app\.listen\(config\.port, config\.host\)/);
  });
});
