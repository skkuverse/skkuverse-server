/**
 * The local-development request filter (ADR 0023, D2): a local-dev server answers a request only when it came
 * straight from this machine, so one that passed a proxy or a tunnel (any forwarding header) or names a host other
 * than a loopback name (a rebinding DNS name) is refused before any route runs.
 */
import type { NextFunction, Request, Response } from "express";
import { LocalDevRequestMiddleware } from "./local-dev-request.middleware";

function run(headers: Record<string, string>): { status: number | undefined; body: unknown; passed: boolean } {
  const outcome: { status: number | undefined; body: unknown; passed: boolean } = { status: undefined, body: undefined, passed: false };
  const res = {
    status(code: number) {
      outcome.status = code;
      return res;
    },
    json(body: unknown) {
      outcome.body = body;
      return res;
    },
  };
  const next: NextFunction = () => {
    outcome.passed = true;
  };
  new LocalDevRequestMiddleware().use({ headers } as unknown as Request, res as unknown as Response, next);
  return outcome;
}

describe("LocalDevRequestMiddleware.use", () => {
  it.each(["localhost:3000", "localhost", "127.0.0.1:3000", "127.0.0.2", "[::1]:3000", "[::1]", "[0:0:0:0:0:0:0:1]:3000", "[::ffff:127.0.0.1]:3000"])("passes a request for %s", (host) => {
    // Act
    const outcome = run({ host });

    // Assert
    expect(outcome).toEqual({ status: undefined, body: undefined, passed: true });
  });

  it.each([
    ["Forwarded", { forwarded: "for=203.0.113.7" }],
    ["X-Forwarded-For", { "x-forwarded-for": "203.0.113.7" }],
    ["X-Forwarded-Host", { "x-forwarded-host": "dev.example" }],
    ["X-Forwarded-Proto", { "x-forwarded-proto": "https" }],
    ["X-Real-IP", { "x-real-ip": "203.0.113.7" }],
    ["Via", { via: "1.1 tunnel" }],
    ["CF-Connecting-IP", { "cf-connecting-ip": "203.0.113.7" }],
  ])("refuses a request carrying %s", (_name, headers) => {
    // Act
    const outcome = run({ host: "localhost:3000", ...headers });

    // Assert
    expect(outcome.passed).toBe(false);
    expect(outcome.status).toBe(403);
    expect(outcome.body).toEqual({ error: { code: "LOCAL_DEV_ONLY", message: "A local-development server answers requests from this machine only" } });
  });

  it.each(["rebind.example:3000", "192.168.0.10:3000", "localhost.evil.test", "0.0.0.0:3000", "[::]:3000", "[::ffff:192.168.0.10]:3000", "127.0.0.1:3000@rebind.example", "127.0.0.1/@rebind.example", "127.0.0.1\\@rebind.example", "127.0.0.1#.rebind.example", "localhost?.rebind.example", ""])("refuses a request for the host %j", (host) => {
    // Act
    const outcome = run({ host });

    // Assert
    expect(outcome.passed).toBe(false);
    expect(outcome.status).toBe(403);
  });

  it("refuses a request without a Host header", () => {
    // Act & Assert
    expect(run({}).status).toBe(403);
  });
});

/**
 * A page on another site can make the developer's browser send a simple request (a form POST) to a local-dev
 * server, whose internal routes take no credential there. Such a request carries the page's Origin, or at least
 * `Sec-Fetch-Site: cross-site`, so the filter refuses it; the simulator app, curl and a dev server on a loopback
 * origin keep working.
 */
describe("LocalDevRequestMiddleware.use against cross-site requests", () => {
  const host = "127.0.0.1:3000";

  it.each([
    ["no Origin (the native app, curl)", {}],
    ["a localhost origin", { origin: "http://localhost:8081" }],
    ["a 127.0.0.1 origin", { origin: "http://127.0.0.1:5173" }],
    ["an IPv6 loopback origin", { origin: "http://[::1]:3000" }],
    ["the server's own origin", { origin: "http://127.0.0.1:3000", "sec-fetch-site": "same-origin" }],
    ["a cross-site fetch from a loopback dev server", { origin: "http://localhost:5173", "sec-fetch-site": "cross-site" }],
    ["an address typed in the address bar", { "sec-fetch-site": "none" }],
    ["a same-site request", { "sec-fetch-site": "same-site" }],
  ])("passes %s", (_case, headers) => {
    // Act
    const outcome = run({ host, ...headers });

    // Assert
    expect(outcome).toEqual({ status: undefined, body: undefined, passed: true });
  });

  it.each([
    ["a website's origin", { origin: "https://evil.example" }],
    ["a first-party origin", { origin: "https://skkuverse.com" }],
    ["an opaque origin", { origin: "null" }],
    ["a LAN origin", { origin: "http://192.168.0.10:3000" }],
    ["a loopback-looking name on another site", { origin: "http://localhost.evil.example" }],
    ["a malformed origin", { origin: "not a url" }],
    ["a cross-site request without an Origin", { "sec-fetch-site": "cross-site" }],
    ["a website's origin that claims to be same-origin", { origin: "https://evil.example", "sec-fetch-site": "same-origin" }],
  ])("refuses %s", (_case, headers) => {
    // Act
    const outcome = run({ host, ...headers });

    // Assert
    expect(outcome.passed).toBe(false);
    expect(outcome.status).toBe(403);
    expect(outcome.body).toEqual({ error: { code: "LOCAL_DEV_ONLY", message: "A local-development server answers requests from this machine only" } });
  });
});
