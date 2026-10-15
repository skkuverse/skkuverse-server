/**
 * A web view link: a root-relative path is resolved onto the web view origin,
 * and anything that would open another host, or carries whitespace a pasted
 * value brings, is refused. A link served after its check is absolute, and
 * one the check would have refused throws rather than being served raw.
 */
import { WEBVIEW_ORIGIN } from "./origins";
import { toServedWebviewUrl, toWebviewUrl } from "./webview-url";

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
