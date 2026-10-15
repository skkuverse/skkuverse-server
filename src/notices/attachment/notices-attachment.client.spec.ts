/**
 * NoticesAttachmentClient over a mocked axios: every request goes through the guarded config, a session is
 * cached per host until its TTL or a fresh fetch, an upstream failure becomes 403 (policy), 502 (the school's
 * server) or the error itself, and an answer is translated to its content type, declared length and body.
 */
jest.mock("axios", () => ({ get: jest.fn() }));

import { Readable } from "stream";
import axios from "axios";
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
  it("translates the upstream's content type, declared length and stream", async () => {
    // Arrange
    const data = Readable.from([Buffer.from("%PDF")]);
    get.mockResolvedValueOnce({ headers: { "content-type": "application/pdf", "content-length": "4" }, data });

    // Act
    const upstream = await client.fetchAttachment("https://www.skku.edu/a.pdf", { "User-Agent": "Mozilla/5.0" });

    // Assert
    expect(upstream).toEqual({ contentType: "application/pdf", contentLength: 4, body: data });
    expect(get.mock.calls[0][1]).toMatchObject({ headers: { "User-Agent": "Mozilla/5.0" }, timeout: 15_000, proxy: false });
  });

  it.each([
    ["no headers", {}, { contentType: undefined, contentLength: undefined }],
    ["an unreadable length", { "content-length": "lots" }, { contentType: undefined, contentLength: undefined }],
    ["a non-string type", { "content-type": ["a", "b"] }, { contentType: undefined, contentLength: undefined }],
  ])("leaves out what the upstream does not declare: %s", async (_label, headers, expected) => {
    // Arrange
    get.mockResolvedValueOnce({ headers, data: Readable.from([]) });

    // Act
    const upstream = await client.fetchAttachment("https://www.skku.edu/a.pdf", {});

    // Assert
    expect(upstream).toMatchObject(expected);
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
