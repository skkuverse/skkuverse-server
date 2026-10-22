/**
 * The Jest network guard (`__tests__/helpers/network-guard.ts`, ADR 0011, D5):
 * every door to a host outside loopback refuses and names the host,
 * loopback stays open for supertest and real local sockets, a server listens on
 * loopback only, and a refusal fails the test file whose code made it, never the
 * file a worker runs next.
 */
import { spawnSync } from "node:child_process";
import dns from "node:dns";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import tls from "node:tls";
import { promisify } from "node:util";
import request from "supertest";
import { isLoopbackHost, takeBlockedConnections } from "../../helpers/network-guard";

const EXTERNAL_HOST = "example.com";
const ROOT = path.join(__dirname, "../../..");

function thrownBy(act: () => unknown): unknown {
  try {
    act();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe("network guard: hosts outside loopback", () => {
  it.each([
    ["net.connect", () => net.connect(443, EXTERNAL_HOST), "example.com:443"],
    ["net.Socket#connect", () => new net.Socket().connect({ host: EXTERNAL_HOST, port: 25 }), "example.com:25"],
    ["tls.connect", () => tls.connect({ host: EXTERNAL_HOST, port: 443 }), "example.com:443"],
    ["http.get", () => http.get(`http://${EXTERNAL_HOST}/`), "example.com:80"],
    ["https.get", () => https.get(`https://${EXTERNAL_HOST}/`), "example.com:443"],
    ["dns.lookup", () => dns.lookup(EXTERNAL_HOST, () => undefined), "example.com"],
  ])("refuses %s and names the target", (_door, connect, target) => {
    // Act
    const error = thrownBy(connect);
    const blocked = takeBlockedConnections();

    // Assert
    expect(error).toMatchObject({ name: "NetworkGuardError", code: "ENETWORKGUARD", target });
    expect((error as Error).message).toContain(target);
    expect(blocked).toEqual([target]);
  });

  it("refuses fetch, naming the URL's host and port", async () => {
    // Act
    const response = fetch(`https://${EXTERNAL_HOST}/skkuverse.json`);
    const blocked = takeBlockedConnections();

    // Assert
    await expect(response).rejects.toThrow("example.com:443");
    expect(blocked).toEqual(["example.com:443"]);
  });

  it("refuses dns.promises.lookup", async () => {
    // Act
    const lookup = dns.promises.lookup(EXTERNAL_HOST);
    const blocked = takeBlockedConnections();

    // Assert
    await expect(lookup).rejects.toThrow("example.com");
    expect(blocked).toEqual(["example.com"]);
  });

  it("keeps a refusal the code under test swallowed until the test takes it", () => {
    // Arrange
    const swallowingPrefetch = (): void => {
      try {
        net.connect(443, EXTERNAL_HOST);
      } catch {
        // A fire-and-forget prefetch logs and moves on.
      }
    };

    // Act
    swallowingPrefetch();
    const blocked = takeBlockedConnections();

    // Assert
    expect(blocked).toEqual(["example.com:443"]);
    expect(takeBlockedConnections()).toEqual([]);
  });
});

describe("network guard: loopback", () => {
  let server: http.Server;
  let port: number;

  beforeAll(async () => {
    server = http.createServer((_req, res) => res.end("ok"));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it.each(["127.0.0.1", "localhost"])("lets http reach %s", async (host) => {
    // Act
    const body = await new Promise<string>((resolve, reject) => {
      http
        .get(`http://${host}:${port}/`, (res) => {
          let text = "";
          res.on("data", (chunk: Buffer) => (text += chunk.toString()));
          res.on("end", () => resolve(text));
        })
        .on("error", reject);
    });

    // Assert
    expect(body).toBe("ok");
    expect(takeBlockedConnections()).toEqual([]);
  });

  it("lets fetch reach loopback", async () => {
    // Act
    const res = await fetch(`http://127.0.0.1:${port}/`);

    // Assert
    expect(await res.text()).toBe("ok");
    expect(takeBlockedConnections()).toEqual([]);
  });

  it("lets a promisified dns.lookup resolve localhost to an address and family", async () => {
    // Act
    const resolved = await promisify(dns.lookup)("localhost");

    // Assert
    expect(resolved).toEqual({ address: expect.any(String), family: expect.any(Number) });
    expect(isLoopbackHost(resolved.address)).toBe(true);
  });

  it.each([
    ["127.0.0.1", true],
    ["::1", true],
    ["[::1]", true],
    ["LOCALHOST", true],
    ["127.0.0.2", false],
    ["0.0.0.0", false],
    ["example.com", false],
    ["localhost.example.com", false],
  ])("treats %s as loopback: %s", (host, expected) => {
    // Act & Assert
    expect(isLoopbackHost(host)).toBe(expected);
  });
});

describe("network guard: servers", () => {
  const servers: net.Server[] = [];

  function newServer(): net.Server {
    const server = http.createServer((_req, res) => res.end("ok"));
    servers.push(server);
    return server;
  }

  afterEach(async () => {
    const listening = servers.splice(0).filter((server) => server.listening);
    await Promise.all(listening.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  });

  it.each<[string, (server: net.Server) => unknown, string]>([
    ["listen(0)", (server) => server.listen(0), "*:0"],
    ["listen()", (server) => server.listen(), "*:0"],
    ["listen({ port: 0 })", (server) => server.listen({ port: 0 }), "*:0"],
    ['listen(0, "0.0.0.0")', (server) => server.listen(0, "0.0.0.0"), "0.0.0.0:0"],
    ['listen({ port: 0, host: "::" })', (server) => server.listen({ port: 0, host: "::" }), "[::]:0"],
  ])("refuses %s and names the caller", (_call, listen, target) => {
    // Arrange
    const server = newServer();

    // Act
    const error = thrownBy(() => listen(server));
    const blocked = takeBlockedConnections();

    // Assert
    expect(error).toMatchObject({ name: "NetworkGuardError", code: "ENETWORKGUARD", target });
    expect((error as Error).message).toContain(`${path.basename(__filename)}:`);
    expect(server.listening).toBe(false);
    expect(blocked).toEqual([target]);
  });

  it("refuses supertest's own listen on a server not yet listening, at the request", () => {
    // Arrange
    const server = newServer();

    // Act
    const error = thrownBy(() => request(server).get("/"));
    const blocked = takeBlockedConnections();

    // Assert
    expect((error as Error).message).toContain("listen on every address (*:0)");
    expect((error as Error).message).toContain('listen(0, "127.0.0.1")');
    expect(blocked).toEqual(["*:0"]);
  });

  it.each(["127.0.0.1", "::1", "localhost"])("lets a server listen on %s", async (host) => {
    // Arrange
    const server = newServer();

    // Act
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, host, resolve);
    });

    // Assert
    expect(server.listening).toBe(true);
    expect(takeBlockedConnections()).toEqual([]);
  });

  it("lets supertest reach a server already listening on 127.0.0.1", async () => {
    // Arrange
    const server = newServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

    // Act
    const res = await request(server).get("/");

    // Assert
    expect(res.text).toBe("ok");
    expect(takeBlockedConnections()).toEqual([]);
  });
});

interface JestJsonReport {
  testResults: { name: string; assertionResults: { title: string; status: string; failureMessages: string[] }[] }[];
}

// Three files run in one worker, in name order. The first leaves an interval
// running that makes its calls only once the second file's test has started.
const WORKER_FIXTURES: Record<string, string> = {
  "sequencer.js":
    "module.exports = class { sort(tests) { return [...tests].sort((a, b) => a.path.localeCompare(b.path)); } cacheResults() {} };",
  "1-leaves-calls-running.test.js": `
    const net = require("node:net");
    test("leaves calls running past the end of its file", () => {
      const poll = setInterval(() => {
        if (!net[Symbol.for("networkGuardFixture.nextFileRunning")]) return;
        clearInterval(poll);
        fetch("https://stray-fetch.example/").catch(() => undefined);
        try { net.connect(443, "stray-connect.example"); } catch {}
        net[Symbol.for("networkGuardFixture.strayCallsMade")] = true;
      }, 10);
    });`,
  "2-runs-next.test.js": `
    const net = require("node:net");
    test("runs while the earlier file's calls are refused", async () => {
      net[Symbol.for("networkGuardFixture.nextFileRunning")] = true;
      while (!net[Symbol.for("networkGuardFixture.strayCallsMade")]) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    });`,
  "3-swallows-its-own-call.test.js": `
    const net = require("node:net");
    test("swallows a refusal of its own", () => {
      try { net.connect(443, "own-call.example"); } catch {}
    });`,
};

describe("network guard: test files that share a worker", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "network-guard-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("writes a refusal made by a finished file's leftover code to stderr instead of failing the next file", () => {
    // Arrange
    for (const [name, source] of Object.entries(WORKER_FIXTURES)) fs.writeFileSync(path.join(dir, name), source);
    const config = {
      rootDir: ROOT,
      roots: [dir],
      testMatch: ["**/*.test.js"],
      testEnvironment: "node",
      testSequencer: path.join(dir, "sequencer.js"),
      setupFiles: [path.join(ROOT, "__tests__/helpers/network-guard.ts")],
      transform: { "^.+\\.ts$": ["ts-jest", { diagnostics: false, tsconfig: path.join(ROOT, "tsconfig.test.json") }] },
      collectCoverage: false,
      watchman: false,
    };

    // Act
    const run = spawnSync(
      process.execPath,
      [require.resolve("jest/bin/jest"), "--config", JSON.stringify(config), "--runInBand", "--json"],
      { cwd: ROOT, encoding: "utf8", env: process.env, timeout: 60_000 },
    );
    const report = JSON.parse(run.stdout) as JestJsonReport;
    const outcomes = report.testResults
      .sort((a, b) => a.name.localeCompare(b.name))
      .flatMap((file) => file.assertionResults)
      .map(({ title, status, failureMessages }) => [title, status, failureMessages.join("\n")]);

    // Assert
    expect(outcomes).toEqual([
      ["leaves calls running past the end of its file", "passed", ""],
      ["runs while the earlier file's calls are refused", "passed", ""],
      ["swallows a refusal of its own", "failed", expect.stringContaining("refused connect to own-call.example:443")],
    ]);
    expect(run.stderr).toContain("refused fetch to stray-fetch.example:443");
    expect(run.stderr).toContain("refused connect to stray-connect.example:443");
  }, 60_000);
});
