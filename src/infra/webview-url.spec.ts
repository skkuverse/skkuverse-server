/**
 * A web view link: a root-relative path is resolved onto the web view origin,
 * and anything that would open another host, or carries whitespace a pasted
 * value brings, is refused.
 */
import { WEBVIEW_ORIGIN } from "./origins";
import { toWebviewUrl } from "./webview-url";

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
