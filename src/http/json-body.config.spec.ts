/**
 * The JSON body parser's options (ADR 0023, D6): the raw bytes are kept only for a request whose path is one of the
 * given route paths, written as Nest writes them (`:id` is one non-empty segment), exactly: no trailing slash, no
 * other case, no extra segment. A query string does not change the path. The 100 kB limit holds for every request.
 */
import type { IncomingMessage } from "node:http";
import { jsonBodyOptions } from "./json-body.config";

const ROUTE = "/internal/miniapps/:id/notifications";

function rawBodyOf(paths: readonly string[], url: string): Buffer | undefined {
  const req = { url } as IncomingMessage & { rawBody?: Buffer };
  jsonBodyOptions(paths).verify?.(req, {} as never, Buffer.from("{}"), "utf-8");
  return req.rawBody;
}

describe("jsonBodyOptions", () => {
  it.each([
    ["/internal/miniapps/eskara-2026/notifications", true],
    ["/internal/miniapps/eskara-2026/notifications?dryRun=1", true],
    ["/internal/miniapps/eskara-2026/notifications/", false],
    ["/Internal/miniapps/eskara-2026/notifications", false],
    ["/internal/miniapps//notifications", false],
    ["/internal/miniapps/a/b/notifications", false],
    ["/internal/miniapps/a/notificationsx", false],
    ["/x/internal/miniapps/a/notifications", false],
    ["/internal/notices/dispatch-pending", false],
  ])("keeps the raw body of %s: %s", (url, kept) => {
    // Act & Assert
    expect(rawBodyOf([ROUTE], url) !== undefined).toBe(kept);
  });

  it("reads a route path's other characters literally", () => {
    // Act & Assert
    expect([rawBodyOf(["/a.b/:id"], "/a.b/1"), rawBodyOf(["/a.b/:id"], "/axb/1")].map((body) => body !== undefined)).toEqual([true, false]);
  });

  it("keeps no raw body when no route path is given", () => {
    // Act & Assert
    expect(rawBodyOf([], "/internal/miniapps/eskara-2026/notifications")).toBeUndefined();
  });

  it("limits every body to 100 kB", () => {
    // Act & Assert
    expect(jsonBodyOptions([ROUTE]).limit).toBe("100kb");
  });
});
