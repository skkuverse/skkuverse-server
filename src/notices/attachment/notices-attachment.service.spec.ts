/**
 * NoticesAttachmentService over FakeNoticesAttachmentClient: the URL and referer policies refuse before any
 * fetch, the referer primes a gnuboard session, and an HTML answer where a file was due is retried once with a
 * fresh session.
 */
import { Readable } from "stream";
import type { Response } from "express";
import { FakeNoticesAttachmentClient } from "../../../__tests__/helpers/fakes/notices/notices-attachment.client.fake";
import { asReal } from "../../../__tests__/helpers/fakes/public-of";
import type { NoticesAttachmentClient } from "./notices-attachment.client";
import { NoticesAttachmentService } from "./notices-attachment.service";

const warn = jest.fn();
const res = { req: { log: { warn } } } as unknown as Response;
const upstream = (contentType: string) => ({ headers: { "content-type": contentType }, data: Readable.from([]) });

function setup() {
  const client = new FakeNoticesAttachmentClient();
  return { client, service: new NoticesAttachmentService(asReal<NoticesAttachmentClient>(client)) };
}

describe("NoticesAttachmentService.sendAttachment", () => {
  it.each([
    [{}, { code: "INVALID_PARAMS", message: "url is required" }],
    [{ url: "::nope" }, { code: "INVALID_PARAMS", message: "malformed url" }],
    [{ url: "https://evil.example/a.pdf" }, { code: "FORBIDDEN", message: "host not allowed" }],
    [{ url: "https://www.skku.edu/a.pdf", referer: "https://evil.example/" }, { code: "INVALID_PARAMS", message: "referer not allowed" }],
  ])("refuses %j before any fetch", async (request, expected) => {
    // Arrange
    const { client, service } = setup();

    // Act & Assert
    await expect(service.sendAttachment(request, res)).rejects.toMatchObject(expected);
    expect(client.sessionFetches.length + client.attachmentFetches.length).toBe(0);
  });

  it("primes the session from the referer and sends its cookie with the download", async () => {
    // Arrange
    const { client, service } = setup();
    client.sessionIds = ["abc"];
    client.upstreams = [upstream("application/pdf")];

    // Act
    await service.sendAttachment({ url: "https://nano.skku.edu/d.php", referer: "https://nano.skku.edu/b.php", mode: "download" }, res);

    // Assert
    expect(client.attachmentFetches[0]?.headers).toEqual({ "User-Agent": "Mozilla/5.0", Referer: "https://nano.skku.edu/b.php", Cookie: "PHPSESSID=abc" });
    expect(client.sends[0]?.delivery).toEqual({ url: "https://nano.skku.edu/d.php", name: undefined, mode: "download" });
  });

  it("retries once with a fresh session when the board answers with HTML", async () => {
    // Arrange
    const { client, service } = setup();
    client.sessionIds = ["stale", "fresh"];
    client.upstreams = [upstream("text/html; charset=utf-8"), upstream("application/pdf")];

    // Act
    await service.sendAttachment({ url: "https://nano.skku.edu/d.php", referer: "https://nano.skku.edu/b.php" }, res);

    // Assert
    expect(client.sessionFetches.map((fetch) => fetch.fresh)).toEqual([false, true]);
    expect(client.attachmentFetches[1]?.headers.Cookie).toBe("PHPSESSID=fresh");
    expect(client.sends).toHaveLength(1);
  });

  it("sends without a cookie when the session fetch fails, and logs it", async () => {
    // Arrange
    const { client, service } = setup();
    client.sessionIds = [new Error("down")];
    client.upstreams = [upstream("application/pdf")];

    // Act
    await service.sendAttachment({ url: "https://nano.skku.edu/d.php", referer: "https://nano.skku.edu/b.php" }, res);

    // Assert
    expect(client.attachmentFetches[0]?.headers).not.toHaveProperty("Cookie");
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ event: "notices.attachment.session_fetch_failed" }), "gnuboard session fetch failed");
  });

  it("serves an HTML file without a referer as it is, with no retry", async () => {
    // Arrange
    const { client, service } = setup();
    client.upstreams = [upstream("text/html")];

    // Act
    await service.sendAttachment({ url: "https://www.skku.edu/page.html" }, res);

    // Assert
    expect(client.attachmentFetches).toHaveLength(1);
    expect(client.sends).toHaveLength(1);
  });
});
