/**
 * Route coverage for GET /notices/proxy/attachment (security fix): a `url`
 * or `referer` the outbound policy refuses never leaves the process, every
 * outbound call carries the policy's request config, a refusal while fetching
 * surfaces as 403, the size cap (declared and mid-stream), the idle and overall
 * transfer timers, and the sandbox CSP for script-capable content types. axios
 * is mocked under the real attachment client and OUTBOUND_POLICY is
 * FakeOutboundPolicy (ADR 0023, D7); which hosts the production policy allows,
 * and its socket checks, are tested beside it in src/perimeter/current/.
 */

jest.mock("axios", () => ({ get: jest.fn() }));

import http from "http";
import type { AddressInfo } from "net";
import { PassThrough, Readable } from "stream";
import axios from "axios";
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { Clock } from "../../../src/infra/clock";
import * as attachmentConstants from "../../../src/notices/attachment/notices-attachment.constants";
import { NoticesAttachmentModule } from "../../../src/notices/attachment/notices-attachment.module";
import { NoticesModule } from "../../../src/notices/notices.module";
import { NoticesTabsModule } from "../../../src/notices/tabs/notices-tabs.module";
import { OutboundPolicy } from "../../../src/perimeter/perimeter.ports";
import { FakeOutboundPolicy, FakeOutboundRefusal } from "../../helpers/fakes/perimeter/outbound-policy.fake";
import { buildTestApp } from "../../helpers/nest/build-test-app";

const mockedGet = axios.get as unknown as jest.Mock;

const fakeClock: Clock = { now: () => new Date("2026-10-14T00:00:00Z") };

const REFUSED_URLS = [
  "https://evilskku.edu/a.pdf",
  "https://skku.edu.evil.com/a.pdf",
  "http://127.0.0.1:3000/",
  "http://api-2:3000/robots.txt",
  "https://www.skku.edu:8080/a.pdf",
  "file:///etc/passwd",
];
const REFUSED_REFERERS = [
  "http://127.0.0.1:3000/",
  "http://api-2:3000/notices/proxy/attachment",
  "https://attacker.example/callback",
  "https://evilskku.edu/",
  "http://169.254.169.254/opc/v1/instance/",
];
// WHY: the shape of the production request config, so the assertions below read what the client hands axios.
const POLICY_CONFIG = { proxy: false as const, maxRedirects: 5, httpAgent: {}, httpsAgent: {}, beforeRedirect: () => undefined };
const outbound = new FakeOutboundPolicy();
outbound.config = POLICY_CONFIG;
for (const url of [...REFUSED_URLS, ...REFUSED_REFERERS]) outbound.refused.add(url);

let app: NestExpressApplication;
let httpServer: import("http").Server;
// WHY: the CSP every route gets from the app pipeline; a type served without the sandbox carries exactly this one.
let controlCsp: string | undefined;

function upstream(body: string, headers: Record<string, string> = {}) {
  return { headers, data: Readable.from([Buffer.from(body)]) };
}

beforeAll(async () => {
  app = await buildTestApp({
    imports: [NoticesModule, NoticesTabsModule, NoticesAttachmentModule],
    overrides: [
      { provide: Clock, useValue: fakeClock },
      { provide: OutboundPolicy, useValue: outbound },
    ],
    role: "api",
  });
  httpServer = app.getHttpServer();
  controlCsp = (await request(httpServer).get("/notices/tabs")).headers["content-security-policy"];
});

afterAll(async () => {
  await app.close();
});

describe("the control CSP", () => {
  it("is the pipeline's own policy, without a sandbox", () => {
    // Assert
    expect(controlCsp).toEqual(expect.any(String));
    expect(controlCsp).not.toMatch(/\bsandbox\b/);
  });
});

beforeEach(() => {
  mockedGet.mockReset();
});

const PROXY = "/notices/proxy/attachment";

describe("url policy", () => {
  it.each(REFUSED_URLS)("403 without any outbound request for %s", async (url) => {
    // Act
    const res = await request(httpServer).get(PROXY).query({ url });

    // Assert
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
    expect(mockedGet).not.toHaveBeenCalled();
  });

  it("403 for a url on a school host once the policy refuses it, and asks the policy with the attachment purpose", async () => {
    // Arrange
    const url = "https://www.skku.edu/_attach/withdrawn.pdf";
    outbound.refused.add(url);

    try {
      // Act
      const res = await request(httpServer).get(PROXY).query({ url });

      // Assert
      expect(res.status).toBe(403);
      expect(mockedGet).not.toHaveBeenCalled();
      expect(outbound.asked).toContainEqual({ purpose: "notice-attachment", url });
    } finally {
      outbound.refused.delete(url);
    }
  });

  it("400 for a malformed url", async () => {
    // Act
    const res = await request(httpServer).get(PROXY).query({ url: "::nope" });

    // Assert
    expect(res.status).toBe(400);
  });
});

describe("referer policy", () => {
  it.each(REFUSED_REFERERS)("400 without any outbound request for referer %s", async (referer) => {
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
  it("primes the session from the referer, then streams the file, both through the policy's request config", async () => {
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
    expect(res.headers["content-security-policy"]).toBe(controlCsp);
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
    mockedGet.mockRejectedValueOnce(new FakeOutboundRefusal("redirect to http://127.0.0.1/ is not allowed"));

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
      expect(res.headers["content-security-policy"]).toBe(controlCsp);
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

describe("transfer limits", () => {
  // WHY: the real limits are 100 MiB, 30 s and 10 min; the same code runs at sizes and times a test can afford.
  function limit(name: "MAX_ATTACHMENT_BYTES" | "IDLE_TRANSFER_MS" | "MAX_TRANSFER_MS", value: number): void {
    jest.replaceProperty(attachmentConstants, name, value);
  }

  /** A raw GET that reports how the response ended: `complete` is false when the server cut it off. */
  function fetchRaw(url: string): Promise<{ status: number; bytes: number; complete: boolean; elapsedMs: number }> {
    const { port } = httpServer.address() as AddressInfo;
    const startedAt = Date.now();
    return new Promise((resolve, reject) => {
      const req = http.get({ host: "127.0.0.1", port, path: `${PROXY}?url=${encodeURIComponent(url)}` }, (res) => {
        let bytes = 0;
        res.on("data", (chunk: Buffer) => (bytes += chunk.length));
        res.on("close", () => resolve({ status: res.statusCode ?? 0, bytes, complete: res.complete, elapsedMs: Date.now() - startedAt }));
      });
      req.on("error", reject);
    });
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("cuts a body off once it passes the cap, though it declared no length", async () => {
    // Arrange
    limit("MAX_ATTACHMENT_BYTES", 1024);
    const body = Readable.from([Buffer.alloc(600), Buffer.alloc(600), Buffer.alloc(600)]);
    mockedGet.mockResolvedValueOnce({ headers: { "content-type": "application/pdf" }, data: body });

    // Act
    const res = await fetchRaw("https://www.skku.edu/_attach/big.pdf");

    // Assert
    expect(res.status).toBe(200);
    expect(res.complete).toBe(false);
    expect(res.bytes).toBeLessThanOrEqual(1024);
    expect(body.destroyed).toBe(true);
  });

  it("serves a body exactly at the cap in full", async () => {
    // Arrange
    limit("MAX_ATTACHMENT_BYTES", 1200);
    mockedGet.mockResolvedValueOnce({ headers: { "content-type": "application/pdf" }, data: Readable.from([Buffer.alloc(600), Buffer.alloc(600)]) });

    // Act
    const res = await fetchRaw("https://www.skku.edu/_attach/exact.pdf");

    // Assert
    expect(res).toMatchObject({ status: 200, complete: true, bytes: 1200 });
  });

  it("cuts a transfer off when the upstream goes idle", async () => {
    // Arrange
    limit("IDLE_TRANSFER_MS", 50);
    const body = new PassThrough();
    body.write(Buffer.alloc(10));
    mockedGet.mockResolvedValueOnce({ headers: { "content-type": "application/pdf" }, data: body });

    // Act
    const res = await fetchRaw("https://www.skku.edu/_attach/stalled.pdf");

    // Assert
    expect(res).toMatchObject({ status: 200, complete: false, bytes: 10 });
    expect(body.destroyed).toBe(true);
  });

  it("cuts a transfer off at the overall limit, though it never goes idle", async () => {
    // Arrange
    limit("IDLE_TRANSFER_MS", 1_000);
    limit("MAX_TRANSFER_MS", 150);
    const body = new PassThrough();
    const trickle = setInterval(() => body.write(Buffer.alloc(1)), 10);
    mockedGet.mockResolvedValueOnce({ headers: { "content-type": "application/pdf" }, data: body });

    // Act
    const res = await fetchRaw("https://www.skku.edu/_attach/trickle.pdf").finally(() => clearInterval(trickle));

    // Assert
    expect(res).toMatchObject({ status: 200, complete: false });
    expect(res.elapsedMs).toBeGreaterThanOrEqual(140);
    expect(res.elapsedMs).toBeLessThan(1_000);
    expect(body.destroyed).toBe(true);
  });
});
