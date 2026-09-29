/**
 * (A perimeter detail is left out of the public history.)
 */

jest.mock("axios", () => ({ get: jest.fn() }));

import { Readable } from "stream";
import axios from "axios";
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { NoticesDataService } from "../../../src/notices/notices-data.service";
import { OutboundBlockedError } from "../../../src/notices/proxy/outbound-guard";
import { buildNoticesApp } from "../../helpers/nest/build-notices-app";

const mockedGet = axios.get as unknown as jest.Mock;

let app: NestExpressApplication;
let httpServer: import("http").Server;

function upstream(body: string, headers: Record<string, string> = {}) {
  return { headers, data: Readable.from([Buffer.from(body)]) };
}

beforeAll(async () => {
  app = await buildNoticesApp([
    {
      provide: NoticesDataService,
      useValue: {
        onModuleInit: jest.fn(),
        findNoticesBySource: jest.fn(),
        findNoticesBySources: jest.fn(),
        findNoticeByArticleNo: jest.fn(),
      },
    },
  ]);
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
    const res = await request(httpServer).get(PROXY).query({ url });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
    expect(mockedGet).not.toHaveBeenCalled();
  });

  it("400 for a malformed url", async () => {
    const res = await request(httpServer).get(PROXY).query({ url: "::nope" });
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
    const res = await request(httpServer)
      .get(PROXY)
      .query({ url: "https://www.skku.edu/_attach/a.pdf", referer });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_PARAMS");
    expect(mockedGet).not.toHaveBeenCalled();
  });
});

describe("allowed request", () => {
  it("primes the session from the referer, then streams the file, both through the guarded config", async () => {
    mockedGet
      .mockResolvedValueOnce({
        headers: { "set-cookie": ["PHPSESSID=abc123; path=/"] },
        data: Readable.from([]),
      })
      .mockResolvedValueOnce(upstream("%PDF-1.7", { "content-type": "application/pdf" }));

    const res = await request(httpServer).get(PROXY).query({
      url: "https://nano.skku.edu/bbs/download.php?no=1",
      referer: "https://nano.skku.edu/bbs/board.php?no=1",
    });

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
    const wrapped = Object.assign(new Error("Redirected request failed"), {
      cause: new OutboundBlockedError("redirect to http://127.0.0.1/ is not allowed"),
    });
    mockedGet.mockRejectedValueOnce(wrapped);

    const res = await request(httpServer)
      .get(PROXY)
      .query({ url: "https://www.skku.edu/_attach/a.pdf" });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("502 when the upstream declares a body over the cap", async () => {
    mockedGet.mockResolvedValueOnce(
      upstream("", { "content-type": "application/pdf", "content-length": String(200 * 1024 * 1024) }),
    );
    const res = await request(httpServer)
      .get(PROXY)
      .query({ url: "https://www.skku.edu/_attach/big.pdf" });
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
    mockedGet.mockResolvedValueOnce(upstream("<script>alert(1)</script>", { "content-type": contentType }));
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
    expect(res.status).toBe(200);
    expect(res.headers["content-security-policy"]).toBe("sandbox; default-src 'none'");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  it.each(["image/gif", "image/png", "image/jpeg", "application/pdf", "video/mp4"])(
    "%s keeps rendering without the sandbox header",
    async (contentType) => {
      mockedGet.mockResolvedValueOnce(upstream("GIF89a", { "content-type": contentType }));
      const res = await request(httpServer)
        .get(PROXY)
        .query({ url: "https://www.skku.edu/_attach/x.bin" });
      expect(res.status).toBe(200);
      expect(res.headers["content-security-policy"]).toBeUndefined();
    },
  );

  it("destroys the body stream of a rejected (non-2xx) upstream response", async () => {
    const body = Readable.from([Buffer.from("err")]);
    mockedGet.mockRejectedValueOnce(
      Object.assign(new Error("Request failed with status code 404"), { response: { data: body } }),
    );
    const res = await request(httpServer)
      .get(PROXY)
      .query({ url: "https://www.skku.edu/_attach/missing.pdf" });
    expect(res.status).toBe(500);
    expect(body.destroyed).toBe(true);
  });
});
