/**
 * The Jest network guard (`__tests__/helpers/network-guard.ts`, harden-test-suite
 * design D5): every door to a host outside loopback refuses and names the host,
 * and loopback stays open for supertest and real local sockets.
 */
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import type { AddressInfo } from "node:net";
import tls from "node:tls";
import { promisify } from "node:util";
import { isLoopbackHost, takeBlockedConnections } from "../../helpers/network-guard";

const EXTERNAL_HOST = "example.com";

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
