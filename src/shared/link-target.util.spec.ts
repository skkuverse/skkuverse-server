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

// WHY: the WHATWG parser folds `\` into `/` and drops or percent-encodes a control character, so a
// value carrying one opens a page other than the one it spells.
describe("isRootRelativePath refuses a backslash or a control character anywhere", () => {
  it.each([
    ["NUL after the slash", "/\u0000x"],
    ["inner backslash", "/a\\b"],
    ["trailing DEL", "/a\u007f"],
    ["unit separator", "/a\u001fb"],
  ])("refuses %s", (_label, value) => {
    // Act & Assert
    expect(isRootRelativePath(value)).toBe(false);
  });
});

describe("isAbsoluteHttpsUrl refuses a backslash, a control character or a URL that does not parse", () => {
  it.each([
    ["a backslash for a host", "https://\\"],
    ["a backslash before the host", "https://\\evil.com"],
    ["a backslash in the path", "https://x.test/a\\b"],
    ["BEL in the path", "https://x.test/a\u0007b"],
    ["NUL at the end", "https://x.test/\u0000"],
    ["DEL in the host", "https://x\u007f.test"],
    ["an authority that does not parse", "https://?x"],
    ["a port out of range", "https://x.test:99999/a"],
  ])("refuses %s", (_label, value) => {
    // Act & Assert
    expect(isAbsoluteHttpsUrl(value)).toBe(false);
  });

  it("accepts only values that parse with a host", () => {
    // Arrange
    const corpus = [
      "https://x.test",
      "https://x.test/a?b=1#c",
      "https://u:p@x.test/a",
      "https://%41.test/",
      "https://x.test:8443/a",
      "https://[::1]/a",
      "https://?x",
      "https://#x",
      "https://:443",
      "https://[::1/a",
      "https://x.test:99999/a",
      "https://\\",
      "https://\\evil.com",
    ];

    // Act
    const accepted = corpus.filter((value) => isAbsoluteHttpsUrl(value));

    // Assert
    expect(accepted.length).toBeGreaterThan(0);
    for (const value of accepted) {
      expect([value, URL.canParse(value) && new URL(value).hostname !== ""]).toEqual([value, true]);
    }
  });
});
