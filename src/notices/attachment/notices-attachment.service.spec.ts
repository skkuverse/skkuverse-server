/**
 * NoticesAttachmentService over FakeNoticesAttachmentClient: the host and referer policies refuse before any
 * fetch, the referer primes a gnuboard session, an HTML answer where a file was due is retried once with a fresh
 * session, a declared length over the cap is refused before any header, and the download carries its headers.
 */
import { Readable } from "stream";
import { FakeNoticesAttachmentClient } from "../../../__tests__/helpers/fakes/notices/notices-attachment.client.fake";
import { asReal } from "../../../__tests__/helpers/fakes/public-of";
import type { NoticesAttachmentClient } from "./notices-attachment.client";
import { NoticesAttachmentService } from "./notices-attachment.service";

const warn = jest.fn();
const log = { warn };
const upstream = (contentType: string, contentLength?: number) => ({ contentType, contentLength, body: Readable.from([]) });

function setup() {
  const client = new FakeNoticesAttachmentClient();
  return { client, service: new NoticesAttachmentService(asReal<NoticesAttachmentClient>(client)) };
}

beforeEach(() => warn.mockClear());

describe("NoticesAttachmentService.fetchDownload", () => {
  it.each([
    [{ url: "https://evil.example/a.pdf" }, { code: "FORBIDDEN", message: "host not allowed" }],
    [{ url: "https://www.skku.edu/a.pdf", referer: "https://evil.example/" }, { code: "INVALID_PARAMS", message: "referer not allowed" }],
    [{ url: "https://evil.example/a.pdf", referer: "https://evil.example/" }, { code: "FORBIDDEN", message: "host not allowed" }],
  ])("refuses %j before any fetch", async (request, expected) => {
    // Arrange
    const { client, service } = setup();

    // Act & Assert
    await expect(service.fetchDownload(request, log)).rejects.toMatchObject(expected);
    expect(client.sessionFetches.length + client.attachmentFetches.length).toBe(0);
  });

  it("primes the session from the referer and sends its cookie with the download", async () => {
    // Arrange
    const { client, service } = setup();
    client.sessionIds = ["abc"];
    client.upstreams = [upstream("application/pdf")];

    // Act
    const download = await service.fetchDownload({ url: "https://nano.skku.edu/d.php", referer: "https://nano.skku.edu/b.php", mode: "download" }, log);

    // Assert
    expect(client.attachmentFetches[0]?.headers).toEqual({ "User-Agent": "Mozilla/5.0", Referer: "https://nano.skku.edu/b.php", Cookie: "PHPSESSID=abc" });
    expect(download.headers).toEqual([
      ["Content-Type", "application/octet-stream"],
      ["Content-Disposition", "attachment; filename*=UTF-8''d.php"],
      ["X-Content-Type-Options", "nosniff"],
    ]);
  });

  it("retries once with a fresh session when the board answers with HTML, and serves the retry", async () => {
    // Arrange
    const { client, service } = setup();
    const stale = upstream("text/html; charset=utf-8");
    const fresh = upstream("application/pdf");
    client.sessionIds = ["stale", "fresh"];
    client.upstreams = [stale, fresh];

    // Act
    const download = await service.fetchDownload({ url: "https://nano.skku.edu/d.php", referer: "https://nano.skku.edu/b.php" }, log);

    // Assert
    expect(client.sessionFetches.map((fetch) => fetch.fresh)).toEqual([false, true]);
    expect(client.attachmentFetches[1]?.headers.Cookie).toBe("PHPSESSID=fresh");
    expect(stale.body.destroyed).toBe(true);
    expect(download.body).toBe(fresh.body);
  });

  it("sends without a cookie when the session fetch fails, and logs it", async () => {
    // Arrange
    const { client, service } = setup();
    client.sessionIds = [new Error("down")];
    client.upstreams = [upstream("application/pdf")];

    // Act
    await service.fetchDownload({ url: "https://nano.skku.edu/d.php", referer: "https://nano.skku.edu/b.php" }, log);

    // Assert
    expect(client.attachmentFetches[0]?.headers).not.toHaveProperty("Cookie");
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ event: "notices.attachment.session_fetch_failed" }), "gnuboard session fetch failed");
  });

  it("serves an HTML file without a referer as it is, with no retry, inside the sandbox CSP", async () => {
    // Arrange
    const { client, service } = setup();
    client.upstreams = [upstream("text/html")];

    // Act
    const download = await service.fetchDownload({ url: "https://www.skku.edu/page.html" }, log);

    // Assert
    expect(client.attachmentFetches).toHaveLength(1);
    expect(download.headers).toContainEqual(["Content-Security-Policy", "sandbox; default-src 'none'"]);
  });

  it.each([
    [100 * 1024 * 1024 - 1, false],
    [100 * 1024 * 1024, false],
    [100 * 1024 * 1024 + 1, true],
  ])("with a declared length of %d bytes, refuses it before any header: %s", async (contentLength, refused) => {
    // Arrange
    const { client, service } = setup();
    const answer = upstream("application/pdf", contentLength);
    client.upstreams = [answer];

    // Act
    const outcome = await service.fetchDownload({ url: "https://www.skku.edu/a.pdf" }, log).then(
      () => "served",
      (err: unknown) => err,
    );

    // Assert
    if (refused) expect(outcome).toMatchObject({ code: "UPSTREAM_TOO_LARGE", httpStatus: 502 });
    else expect(outcome).toBe("served");
    expect(answer.body.destroyed).toBe(refused);
  });
});
