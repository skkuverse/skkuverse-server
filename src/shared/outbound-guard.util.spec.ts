/**
 * The attachment proxy's guarded request config (security fix): the caller's domain allowlist holds on every
 * redirect hop, and the guarded agents and the redirect hook refuse loopback through axios and follow-redirects
 * against real loopback sockets.
 */

import http from "http";
import type { AddressInfo } from "net";
import axios from "axios";
import { OutboundBlockedError } from "./outbound-blocked.error";
import { assertRedirectAllowed, guardedRequestConfig, isOutboundBlocked } from "./outbound-guard.util";
import { isAllowedHost, parseAllowedUrl } from "./outbound-url.util";

const SKKU_DOMAINS = ["skku.edu", "skkumed.ac.kr"] as const;

describe("the caller's allowlist", () => {
  it("is the only list the URL policy reads", () => {
    // Arrange
    const other = ["example.org"];

    // Act & Assert
    expect([isAllowedHost("www.example.org", other), isAllowedHost("www.skku.edu", other)]).toEqual([true, false]);
    expect(parseAllowedUrl("https://www.skku.edu/a.pdf", other)).toBeNull();
  });

  it("holds on every redirect hop of the guarded config", () => {
    // Arrange
    const config = guardedRequestConfig(["example.org"]);

    // Act & Assert
    expect(() => config.beforeRedirect?.({ href: "https://www.example.org/a" } as never, {} as never)).not.toThrow();
    expect(() => config.beforeRedirect?.({ href: "https://nano.skku.edu/file" } as never, {} as never)).toThrow(OutboundBlockedError);
  });
});

describe("assertRedirectAllowed", () => {
  it("allows a hop to another allowed host", () => {
    // Act & Assert
    expect(() => assertRedirectAllowed({ href: "https://nano.skku.edu/file" }, SKKU_DOMAINS)).not.toThrow();
  });

  it.each(["http://127.0.0.1:3000/", "https://evil.example/", "http://api-2:3000/x"])(
    "blocks a hop to %s",
    (href) => {
      // Act & Assert
      expect(() => assertRedirectAllowed({ href }, SKKU_DOMAINS)).toThrow(OutboundBlockedError);
    },
  );

  it("rebuilds the target when href is absent", () => {
    // Act & Assert
    expect(() =>
      assertRedirectAllowed({ protocol: "http:", hostname: "127.0.0.1", port: 3000, path: "/" }, SKKU_DOMAINS),
    ).toThrow(OutboundBlockedError);
  });
});

describe("axios integration (real loopback sockets)", () => {
  let server: http.Server;
  let port: number;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === "/redirect") {
        res.writeHead(302, { Location: `http://127.0.0.1:${port}/internal` });
        res.end();
        return;
      }
      res.end("internal");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("the guarded agents refuse a hostname that resolves to loopback", async () => {
    // Act
    const err = await axios
      .get(`http://localhost:${port}/`, { ...guardedRequestConfig(SKKU_DOMAINS), timeout: 2000 })
      .catch((e: unknown) => e);

    // Assert
    expect(isOutboundBlocked(err)).toBe(true);
  });

  it("beforeRedirect aborts a redirect into a non-allowed target", async () => {
    // Act
    // Plain agents here so the first hop reaches the loopback fixture; only the
    // redirect hook is under test.
    const err = await axios
      .get(`http://127.0.0.1:${port}/redirect`, {
        maxRedirects: 5,
        proxy: false,
        timeout: 2000,
        beforeRedirect: (options) => assertRedirectAllowed(options, SKKU_DOMAINS),
      })
      .catch((e: unknown) => e);

    // Assert
    expect(isOutboundBlocked(err)).toBe(true);
  });

  it("disables env proxies and caps redirects", () => {
    // Act
    const config = guardedRequestConfig(SKKU_DOMAINS);

    // Assert
    expect(config.proxy).toBe(false);
    expect(config.maxRedirects).toBe(5);
    expect(config.httpAgent).toBeDefined();
    expect(config.httpsAgent).toBeDefined();
  });
});
