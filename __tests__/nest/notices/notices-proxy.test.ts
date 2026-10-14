/**
 * (A perimeter detail is left out of the public history.)
 */

jest.mock("axios", () => ({ get: jest.fn() }));

import { Readable } from "stream";
import axios from "axios";
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { Clock } from "../../../src/infra/clock";
import { OutboundBlockedError } from "../../../src/infra/outbound-guard";
import { NoticesAttachmentModule } from "../../../src/notices/attachment/notices-attachment.module";
import { NoticesModule } from "../../../src/notices/notices.module";
import { buildTestApp } from "../../helpers/nest/build-test-app";

const mockedGet = axios.get as unknown as jest.Mock;

const fakeClock: Clock = { now: () => new Date("2026-10-14T00:00:00Z") };

let app: NestExpressApplication;
let httpServer: import("http").Server;

function upstream(body: string, headers: Record<string, string> = {}) {
  return { headers, data: Readable.from([Buffer.from(body)]) };
}

beforeAll(async () => {
  app = await buildTestApp({
    imports: [NoticesModule, NoticesAttachmentModule],
    overrides: [{ provide: Clock, useValue: fakeClock }],
    role: "api",
  });
  httpServer = app.getHttpServer();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  mockedGet.mockReset();
});

const PROXY = "/notices/proxy/attachment";

describe("url policy", () => {
  it.each([
    "https://evilskku.edu/a.pdf",
    "https://skku.edu.evil.com/a.pdf",
    "http://127.0.0.1:3000/",
    "http://api-2:3000/robots.txt",
    "https://www.skku.edu:8080/a.pdf",
    "file:///etc/passwd",
  ])("403 without any outbound request for %s", async (url) => {
    // Act
    const res = await request(httpServer).get(PROXY).query({ url });

    // Assert
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
    expect(mockedGet).not.toHaveBeenCalled();
  });

  it("400 for a malformed url", async () => {
    // Act
    const res = await request(httpServer).get(PROXY).query({ url: "::nope" });

    // Assert
    expect(res.status).toBe(400);
  });
});

describe("referer policy", () => {
  it.each([
    "http://127.0.0.1:3000/",
    "http://api-2:3000/notices/proxy/attachment",
    "https://attacker.example/callback",
    "https://evilskku.edu/",
    "http://169.254.169.254/opc/v1/instance/",
  ])("400 without any outbound request for referer %s", async (referer) => {
    // Act
    const res = await request(httpServer)
      .get(PROXY)
      .query({ url: "https://www.skku.edu/_attach/a.pdf", referer });

    // Assert
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_PARAMS");
    expect(mockedGet).not.toHaveBeenCalled();
  });
});

describe("allowed request", () => {
  it("primes the session from the referer, then streams the file, both through the guarded config", async () => {
    // Arrange
    mockedGet
      .mockResolvedValueOnce({
        headers: { "set-cookie": ["PHPSESSID=abc123; path=/"] },
        data: Readable.from([]),
      })
      .mockResolvedValueOnce(upstream("%PDF-1.7", { "content-type": "application/pdf" }));

    // Act
    const res = await request(httpServer).get(PROXY).query({
      url: "https://nano.skku.edu/bbs/download.php?no=1",
      referer: "https://nano.skku.edu/bbs/board.php?no=1",
    });

    // Assert
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/pdf");
    expect(res.headers["content-security-policy"]).toBeUndefined();
    expect(mockedGet).toHaveBeenCalledTimes(2);
    for (const [, config] of mockedGet.mock.calls) {
      expect(config.proxy).toBe(false);
      expect(config.maxRedirects).toBe(5);
      expect(config.httpAgent).toBeDefined();
      expect(config.httpsAgent).toBeDefined();
      expect(typeof config.beforeRedirect).toBe("function");
    }
    expect(mockedGet.mock.calls[1][1].headers.Cookie).toBe("PHPSESSID=abc123");
  });

  it("maps a policy rejection during the fetch (DNS or redirect) to 403", async () => {
    // Arrange
    const wrapped = Object.assign(new Error("Redirected request failed"), {
      cause: new OutboundBlockedError("redirect to http://127.0.0.1/ is not allowed"),
    });
    mockedGet.mockRejectedValueOnce(wrapped);

    // Act
    const res = await request(httpServer)
      .get(PROXY)
      .query({ url: "https://www.skku.edu/_attach/a.pdf" });

    // Assert
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("502 when the upstream declares a body over the cap", async () => {
    // Arrange
    mockedGet.mockResolvedValueOnce(
      upstream("", { "content-type": "application/pdf", "content-length": String(200 * 1024 * 1024) }),
    );

    // Act
    const res = await request(httpServer)
      .get(PROXY)
      .query({ url: "https://www.skku.edu/_attach/big.pdf" });

    // Assert
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe("UPSTREAM_TOO_LARGE");
  });
});

describe("inline content-type policy", () => {
  it.each([
    "text/html; charset=utf-8",
    "TEXT/HTML",
    "image/svg+xml",
    "application/javascript",
    "application/xhtml+xml",
    "application/rss+xml",
    "application/atom+xml",
    "text/xsl",
    "text/plain",
    "multipart/x-mixed-replace; boundary=x",
  ])("%s is served inline inside a sandbox CSP", async (contentType) => {
    // Arrange
    mockedGet.mockResolvedValueOnce(upstream("<script>alert(1)</script>", { "content-type": contentType }));

    // Act
    // Headers are what's under test; skip supertest's body parsing (it
    // would try to decode the multipart case).
    const res = await request(httpServer)
      .get(PROXY)
      .query({ url: "https://www.skku.edu/_attach/x" })
      .parse((r, cb) => {
        const stream = r as unknown as Readable;
        stream.resume();
        stream.on("end", () => cb(null, null));
      });

    // Assert
    expect(res.status).toBe(200);
    expect(res.headers["content-security-policy"]).toBe("sandbox; default-src 'none'");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  it.each(["image/gif", "image/png", "image/jpeg", "application/pdf", "video/mp4"])(
    "%s keeps rendering without the sandbox header",
    async (contentType) => {
      // Arrange
      mockedGet.mockResolvedValueOnce(upstream("GIF89a", { "content-type": contentType }));

      // Act
      const res = await request(httpServer)
        .get(PROXY)
        .query({ url: "https://www.skku.edu/_attach/x.bin" });

      // Assert
      expect(res.status).toBe(200);
      expect(res.headers["content-security-policy"]).toBeUndefined();
    },
  );

  it("answers 502 for a non-2xx upstream, and destroys its body stream", async () => {
    // Arrange
    const body = Readable.from([Buffer.from("err")]);
    mockedGet.mockRejectedValueOnce(
      Object.assign(new Error("Request failed with status code 404"), {
        response: { status: 404, data: body },
      }),
    );

    // Act
    const res = await request(httpServer)
      .get(PROXY)
      .query({ url: "https://www.skku.edu/_attach/missing.pdf" });

    // Assert
    // A dead link on the school's site is not a fault here: no 500, no Issue.
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe("UPSTREAM_ERROR");
    expect(body.destroyed).toBe(true);
  });

  it("answers 502 when the upstream times out", async () => {
    // Arrange
    mockedGet.mockRejectedValueOnce(
      Object.assign(new Error("timeout of 15000ms exceeded"), { code: "ECONNABORTED" }),
    );

    // Act
    const res = await request(httpServer)
      .get(PROXY)
      .query({ url: "https://www.skku.edu/_attach/slow.pdf" });

    // Assert
    expect(res.status).toBe(502);
  });
});
