/**
 * The attachment response's decisions: the content type (the upstream's when specific, else the file
 * extension's), which inline types render without the sandbox CSP, the file name, the headers per mode, and the
 * gnuboard session cookie.
 */
import {
  isInlineSafe,
  isSpecificContentType,
  resolveContentType,
  toAttachmentFilename,
  toAttachmentHeaders,
  toSessionId,
} from "./notices-attachment.rules";

describe("isSpecificContentType", () => {
  it.each([
    ["application/pdf", true],
    ["image/png", true],
    ["application/octet-stream", false],
    ["application/unknown", false],
    ["weird/thing", false],
    [undefined, false],
    ["", false],
  ])("%j → %j", (contentType, expected) => {
    // Act & Assert
    expect(isSpecificContentType(contentType)).toBe(expected);
  });
});

describe("resolveContentType", () => {
  it.each([
    ["application/pdf", "x.hwp", "application/pdf"],
    ["application/octet-stream", "report.HWP", "application/x-hwp"],
    [undefined, "a.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    ["application/unknown", "noext", "application/unknown"],
    [undefined, "noext", "application/octet-stream"],
  ])("upstream %j for %j → %j", (upstream, filename, expected) => {
    // Act & Assert
    expect(resolveContentType(upstream, filename)).toBe(expected);
  });
});

describe("isInlineSafe", () => {
  it.each([
    ["application/pdf", true],
    ["image/png; charset=binary", true],
    ["video/mp4", true],
    ["image/svg+xml", false],
    ["text/html", false],
    ["text/plain", false],
  ])("%j → %j", (contentType, expected) => {
    // Act & Assert
    expect(isInlineSafe(contentType)).toBe(expected);
  });
});

describe("toAttachmentFilename", () => {
  it("takes the given name, else the URL's last segment, else a default", () => {
    // Act & Assert
    expect([
      toAttachmentFilename("https://x/a/b.pdf", "given.pdf"),
      toAttachmentFilename("https://x/a/b.pdf", undefined),
      toAttachmentFilename("https://x/", undefined),
    ]).toEqual(["given.pdf", "b.pdf", "attachment"]);
  });
});

describe("toAttachmentHeaders", () => {
  it("sends a download as an opaque, named attachment", () => {
    // Act & Assert
    expect(toAttachmentHeaders("download", "공지 1.pdf", "application/pdf")).toEqual([
      ["Content-Type", "application/octet-stream"],
      ["Content-Disposition", "attachment; filename*=UTF-8''%EA%B3%B5%EC%A7%80%201.pdf"],
      ["X-Content-Type-Options", "nosniff"],
    ]);
  });

  it("sandboxes an inline type that is not known safe, and leaves a safe one alone", () => {
    // Act & Assert
    expect(toAttachmentHeaders(undefined, "x.html", "text/html")).toContainEqual(["Content-Security-Policy", "sandbox; default-src 'none'"]);
    expect(toAttachmentHeaders("inline", "x.pdf", "application/pdf").map(([name]) => name)).toEqual(["Content-Type", "Content-Disposition", "X-Content-Type-Options"]);
  });
});

describe("toSessionId", () => {
  it("reads the first PHPSESSID cookie, and null without one", () => {
    // Act & Assert
    expect([toSessionId(["a=b", "PHPSESSID=abc123; path=/", "PHPSESSID=late"]), toSessionId(["a=b"]), toSessionId([])]).toEqual(["abc123", null, null]);
  });
});
