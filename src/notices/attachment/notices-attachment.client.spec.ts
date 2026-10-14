/**
 * NoticesAttachmentClient over a mocked axios: every request goes through the guarded config, a session is
 * cached per host until its TTL or a fresh fetch, an upstream failure becomes 403 (policy), 502 (the school's
 * server) or the error itself, and a send enforces the size cap and sets the headers before piping.
 */
jest.mock("axios", () => ({ get: jest.fn() }));

import { PassThrough, Readable } from "stream";
import axios from "axios";
import type { Response } from "express";
import type { Clock } from "../../infra/clock";
import { OutboundBlockedError } from "../../infra/outbound-guard";
import { NoticesAttachmentClient } from "./notices-attachment.client";

const get = axios.get as unknown as jest.Mock;
let nowMs = Date.parse("2026-10-14T00:00:00Z");
const clock: Clock = { now: () => new Date(nowMs) };

function session(id: string) {
  return { headers: { "set-cookie": [`PHPSESSID=${id}; path=/`] }, data: Readable.from([]) };
}

let client: NoticesAttachmentClient;

beforeEach(() => {
  get.mockReset();
  client = new NoticesAttachmentClient(clock);
});

afterEach(() => client.onModuleDestroy());

describe("NoticesAttachmentClient.fetchSessionId", () => {
  it("fetches through the guarded config and caches the session per host for its TTL", async () => {
    // Arrange
    get.mockResolvedValueOnce(session("first")).mockResolvedValueOnce(session("second"));

    // Act
    const first = await client.fetchSessionId("https://nano.skku.edu/board?no=1");
    const cached = await client.fetchSessionId("https://nano.skku.edu/board?no=2");
    nowMs += 5 * 60 * 1000;
    const expired = await client.fetchSessionId("https://nano.skku.edu/board?no=3");

    // Assert
    expect([first, cached, expired]).toEqual(["first", "first", "second"]);
    expect(get).toHaveBeenCalledTimes(2);
    expect(get.mock.calls[0][1]).toMatchObject({ proxy: false, maxRedirects: 5, timeout: 10_000, responseType: "stream" });
  });

  it("refetches on a fresh request even inside the TTL", async () => {
    // Arrange
    get.mockResolvedValueOnce(session("first")).mockResolvedValueOnce(session("fresh"));
    await client.fetchSessionId("https://nano.skku.edu/board");

    // Act
    const fresh = await client.fetchSessionId("https://nano.skku.edu/board", { fresh: true });

    // Assert
    expect(fresh).toBe("fresh");
  });
});

describe("NoticesAttachmentClient.fetchAttachment", () => {
  it("returns the upstream's headers and stream", async () => {
    // Arrange
    const data = Readable.from([Buffer.from("%PDF")]);
    get.mockResolvedValueOnce({ headers: { "content-type": "application/pdf" }, data });

    // Act
    const upstream = await client.fetchAttachment("https://www.skku.edu/a.pdf", { "User-Agent": "Mozilla/5.0" });

    // Assert
    expect(upstream).toEqual({ headers: { "content-type": "application/pdf" }, data });
    expect(get.mock.calls[0][1]).toMatchObject({ headers: { "User-Agent": "Mozilla/5.0" }, timeout: 15_000, proxy: false });
  });

  it.each([
    ["a policy rejection", Object.assign(new Error("x"), { cause: new OutboundBlockedError("blocked") }), { code: "FORBIDDEN", httpStatus: 403 }],
    ["a non-2xx", Object.assign(new Error("404"), { response: { status: 404 } }), { code: "UPSTREAM_ERROR", httpStatus: 502 }],
    ["a timeout", Object.assign(new Error("timeout"), { code: "ECONNABORTED" }), { code: "UPSTREAM_ERROR", httpStatus: 502 }],
  ])("maps %s", async (_label, err, expected) => {
    // Arrange
    get.mockRejectedValueOnce(err);

    // Act & Assert
    await expect(client.fetchAttachment("https://www.skku.edu/a.pdf", {})).rejects.toMatchObject(expected);
  });

  it("rethrows an error that is neither, as a bug", async () => {
    // Arrange
    get.mockRejectedValueOnce(new TypeError("bug"));

    // Act & Assert
    await expect(client.fetchAttachment("https://www.skku.edu/a.pdf", {})).rejects.toThrow(TypeError);
  });
});

describe("NoticesAttachmentClient.sendAttachment", () => {
  function response(): { res: Response; headers: Record<string, string>; body: Promise<string> } {
    const stream = new PassThrough();
    const headers: Record<string, string> = {};
    const res = Object.assign(stream, { setHeader: (name: string, value: string) => (headers[name] = value) }) as unknown as Response;
    const body = new Promise<string>((resolve) => {
      let text = "";
      stream.on("data", (chunk: Buffer) => (text += chunk.toString()));
      stream.on("end", () => resolve(text));
    });
    return { res, headers, body };
  }

  it("refuses a declared body over 100 MiB before writing anything", async () => {
    // Arrange
    const data = Readable.from([]);
    const { res, headers } = response();

    // Act & Assert
    await expect(
      client.sendAttachment({ headers: { "content-length": String(200 * 1024 * 1024) }, data }, res, { url: "https://x/a.pdf", name: undefined, mode: undefined }),
    ).rejects.toMatchObject({ code: "UPSTREAM_TOO_LARGE", httpStatus: 502 });
    expect(headers).toEqual({});
    expect(data.destroyed).toBe(true);
  });

  it("sets the headers and pipes the body through", async () => {
    // Arrange
    const { res, headers, body } = response();

    // Act
    await client.sendAttachment({ headers: { "content-type": "application/pdf" }, data: Readable.from([Buffer.from("%PDF-1.7")]) }, res, {
      url: "https://x/a.pdf",
      name: undefined,
      mode: undefined,
    });

    // Assert
    expect(headers).toEqual({ "Content-Type": "application/pdf", "Content-Disposition": "inline", "X-Content-Type-Options": "nosniff" });
    expect(await body).toBe("%PDF-1.7");
  });
});
