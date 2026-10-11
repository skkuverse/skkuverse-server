/**
 * A root-relative path names a page on the host that opens it and never another host; an absolute
 * https URL names a host. Both refuse whitespace anywhere, a trailing newline included.
 */
import { isAbsoluteHttpsUrl, isRootRelativePath } from "./link-target.util";

describe("isRootRelativePath", () => {
  it.each(["/", "/notices", "/(tabs)/transit", "/eskara/wristband?x=1#top"])("accepts %j", (value) => {
    // Act & Assert
    expect(isRootRelativePath(value)).toBe(true);
  });

  it.each([
    ["empty", ""],
    ["relative", "notices"],
    ["protocol-relative", "//evil.com"],
    ["backslash authority", "/\\evil.com"],
    ["absolute URL", "https://x.test/a"],
    ["trailing newline", "/notices\n"],
    ["inner space", "/a b"],
  ])("refuses %s", (_label, value) => {
    // Act & Assert
    expect(isRootRelativePath(value)).toBe(false);
  });
});

describe("isAbsoluteHttpsUrl", () => {
  it.each(["https://x.test", "https://x.test/a?b=1#c", "https://webview.example/eskara/shuttle"])(
    "accepts %j",
    (value) => {
      // Act & Assert
      expect(isAbsoluteHttpsUrl(value)).toBe(true);
    },
  );

  it.each([
    ["not a string", 42],
    ["empty", ""],
    ["no host", "https://"],
    ["empty host", "https:///a"],
    ["plain http", "http://x.test"],
    ["another scheme", "itms-apps://apps.apple.com/app/id1"],
    ["root-relative", "/notices"],
    ["inner space", "https://x.test/a b"],
    ["trailing newline", "https://x.test/a\n"],
  ])("refuses %s", (_label, value) => {
    // Act & Assert
    expect(isAbsoluteHttpsUrl(value)).toBe(false);
  });
});
