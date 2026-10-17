/**
 * A link action is checked by its type's rule (a known mini-app target, an https URL, a web view URL, a
 * root-relative route), never with whitespace, and an absent action is not broken. A web view link is
 * served absolute, any other as written, and one its check would have refused throws rather than
 * being served raw.
 */
import { WEBVIEW_ORIGIN } from "../infra/origins";
import { isBrokenLinkAction, toServedActionValue } from "./link-action.util";

// WHY: the registry's own target grammar is pinned by its rules spec; here only its answer matters.
const registry = { isKnownMiniAppTarget: (value: string): boolean => /^eskara-2026(\/|$)/.test(value) };

describe("isBrokenLinkAction", () => {
  it.each([
    ["miniapp", "eskara-2026", false],
    ["miniapp", "eskara-2026/eskara/wristband", false],
    ["miniapp", "no-such-app", true],
    ["external", "https://pf.kakao.com/_cjxexdG/chat", false],
    ["external", "http://pf.kakao.com/_cjxexdG/chat", true],
    ["external", "/x", true],
    ["webview", "https://webview.skkuverse.com/skku/lostandfound", false],
    ["webview", "https://webview.skkuverse.com/a b", true],
    ["webview", "/skku/lostandfound", false],
    ["webview", "//evil.com/x", true],
    ["route", "/map/hssc", false],
    ["route", "//evil.com", true],
    ["route", "campus", true],
    ["route", "", true],
    ["route", "/search\n", true],
  ] as const)("%s %p: broken is %p", (actionType, actionValue, expected) => {
    // Act & Assert
    expect(isBrokenLinkAction({ actionType, actionValue }, registry)).toBe(expected);
  });

  it("finds nothing broken in an item without an action", () => {
    // Act & Assert
    expect(isBrokenLinkAction({}, registry)).toBe(false);
  });
});

describe("toServedActionValue", () => {
  it("serves a web view link absolute and any other link as it is", () => {
    // Act & Assert
    expect(toServedActionValue("webview", "/skku/lostandfound")).toBe(`${WEBVIEW_ORIGIN}/skku/lostandfound`);
    expect(toServedActionValue("external", "https://evil.com/x")).toBe("https://evil.com/x");
  });

  it("throws on a web view link its check would have refused, rather than serving it raw", () => {
    // Act & Assert
    expect(() => toServedActionValue("webview", "https://evil.com/x")).toThrow(/toWebviewUrl refuses it/);
  });
});
