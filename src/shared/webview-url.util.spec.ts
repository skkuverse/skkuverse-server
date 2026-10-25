/**
 * A web view link: a root-relative path is resolved onto the web view origin,
 * and anything that would open another host, or carries whitespace a pasted
 * value brings, is refused. A link served after its check is absolute, and
 * one the check would have refused throws rather than being served raw.
 */
import { WEBVIEW_ORIGIN } from "./webview-origin.constants";
import { toServedWebviewUrl, toWebviewUrl } from "./webview-url.util";

describe("toWebviewUrl", () => {
  it("resolves a root-relative web view path onto the web view origin", () => {
    // Act & Assert
    expect(toWebviewUrl("/eskara/entry")).toBe(`${WEBVIEW_ORIGIN}/eskara/entry`);
  });

  it.each(["https://evil.com/x", "/eskara/entry\n", "//evil.com/x", ""])("refuses %j as a web view URL", (value) => {
    // Act & Assert
    expect(toWebviewUrl(value)).toBeNull();
  });
});

// WHY: the origin would fold `\` into `/` and serve a page the value does not spell.
describe("toWebviewUrl refuses a root-relative path with a backslash or a control character", () => {
  it.each(["/a\\b", "/eskara/entry\u0000", "/a\u0007b"])("refuses %j", (value) => {
    // Act & Assert
    expect(toWebviewUrl(value)).toBeNull();
  });
});

// WHY: the parser folds `\`, drops a control character and keeps userinfo out of `origin`, so each of
// these compares equal to our origin while the value served is not the URL it spells.
describe("toWebviewUrl refuses an absolute URL on our origin that only the parser makes ours", () => {
  it.each([
    ["a backslash in the path", `${WEBVIEW_ORIGIN}/a\\b`],
    ["a backslash before userinfo", `${WEBVIEW_ORIGIN}\\@evil.com/x`],
    ["a control character in the path", `${WEBVIEW_ORIGIN}/a\u0007b`],
    ["userinfo before our host", `https://u@${new URL(WEBVIEW_ORIGIN).host}/x`],
  ])("refuses %s", (_label, value) => {
    // Act & Assert
    expect(toWebviewUrl(value)).toBeNull();
  });
});

describe("toServedWebviewUrl", () => {
  it("serves a root-relative web view path on the web view origin, and an absolute one as it is", () => {
    // Act & Assert
    expect(toServedWebviewUrl("/eskara/entry")).toBe(`${WEBVIEW_ORIGIN}/eskara/entry`);
    expect(toServedWebviewUrl(`${WEBVIEW_ORIGIN}/eskara/entry`)).toBe(`${WEBVIEW_ORIGIN}/eskara/entry`);
  });

  it("throws on a value no web view check would have passed, rather than serving it", () => {
    // Act & Assert
    expect(() => toServedWebviewUrl("https://evil.com/x")).toThrow(/toWebviewUrl refuses it/);
  });
});
