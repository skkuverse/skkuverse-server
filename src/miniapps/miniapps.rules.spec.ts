/**
 * The mini-app target grammar: `<miniAppId>[<root-relative path>]`.
 *
 * The cases that matter are the ones that would let the shell frame a page on a
 * host nobody registered. `//evil.com` and `/\evil.com` are both read by a URL
 * parser as a new authority, so a path that begins with either must be refused
 * here — the device checks the resolved origin again, but a map action never
 * reaches the device if it fails here, and that is the cheaper place to learn.
 * Also the two checks the registry schema refines with: one emoji per logo,
 * counted in graphemes, and a startUrl on the web view that addresses a page.
 * And the one 404 both flows answer an unregistered id with.
 */
import { registry } from "./miniapps.config";
import { isKnownMiniAppTarget, isServableStartUrl, isSingleEmoji, parseMiniAppTarget, toMiniAppNotFound } from "./miniapps.rules";

describe("parseMiniAppTarget", () => {
  it.each([
    ["eskara-2026", { id: "eskara-2026" }],
    ["eskara-2026/eskara/wristband", { id: "eskara-2026", path: "/eskara/wristband" }],
    ["eskara-2026/eskara/lineup?day=2", { id: "eskara-2026", path: "/eskara/lineup?day=2" }],
    ["hssc/", { id: "hssc", path: "/" }],
  ])("parses %s", (value, expected) => {
    // Act & Assert
    expect(parseMiniAppTarget(value)).toEqual(expected);
  });

  it.each([
    ["a protocol-relative path", "eskara-2026//evil.com/x"],
    ["a backslash authority", "eskara-2026/\\evil.com"],
    ["a trailing newline", "eskara-2026/eskara\n"],
    ["an inner space", "eskara-2026/a b"],
    ["an absolute URL", "https://eskara.miniapp.skkuverse.com/eskara"],
    ["a leading slash", "/eskara-2026/x"],
    ["an uppercase id", "Eskara-2026"],
    ["a query with no path", "eskara-2026?x=1"],
    ["an empty string", ""],
    ["a non-string", 42],
  ])("refuses %s", (_label, value) => {
    // Act & Assert
    expect(parseMiniAppTarget(value)).toBeNull();
  });
});

describe("isKnownMiniAppTarget", () => {
  it("accepts a target naming a registered mini app", () => {
    // Act & Assert
    expect(isKnownMiniAppTarget("eskara-2026/eskara/wristband", registry.detailsById)).toBe(true);
  });

  it("refuses a well-formed target naming nothing registered", () => {
    // Act & Assert
    expect(isKnownMiniAppTarget("no-such-app/x", registry.detailsById)).toBe(false);
  });
});

describe("isSingleEmoji", () => {
  it.each([
    ["one pictograph", "🍢", true],
    ["a pictograph with a variation selector", "🌶️", true],
    ["a joined sequence", "👩‍🍳", true],
    ["two pictographs", "🍢🍗", false],
    ["a letter", "a", false],
    ["an empty string", "", false],
  ])("%s → %s", (_label, value, expected) => {
    // Act & Assert
    expect(isSingleEmoji(value)).toBe(expected);
  });
});

describe("isServableStartUrl", () => {
  it.each([
    ["a page on the web view", "https://webview.skkuverse.com/eskara", true],
    ["the web view's bare root", "https://webview.skkuverse.com/", false],
    ["a fragment route on the web view", "https://webview.skkuverse.com/#/eskara", false],
    ["a third party's bare root", "https://www.skkuw.com/", true],
    ["a third party's fragment", "https://example.com/#/section", true],
  ])("%s → %s", (_label, startUrl, expected) => {
    // Act & Assert
    expect(isServableStartUrl(startUrl)).toBe(expected);
  });
});

describe("toMiniAppNotFound", () => {
  it("is the 404 MINIAPP_NOT_FOUND naming the id", () => {
    // Act
    const error = toMiniAppNotFound("no-such-app");

    // Assert
    expect({ code: error.code, message: error.message, status: error.httpStatus }).toEqual({
      code: "MINIAPP_NOT_FOUND",
      message: "Unknown mini-app id: no-such-app",
      status: 404,
    });
  });
});
