/**
 * A link action is checked by its type's rule (a known mini-app target, an https URL, a web view URL, a
 * root-relative route), never with whitespace, and an absent action is not broken. A web view link is
 * served absolute, any other as written, and one its check would have refused throws rather than
 * being served raw.
 */
import { WEBVIEW_ORIGIN } from "../infra/origins";
import type { LinkPolicy } from "./link-action.types";
import { isBrokenLinkAction, toLinkProblem, toServedActionValue } from "./link-action.util";
import { isRootRelativePath } from "./link-target.util";

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

describe("toLinkProblem", () => {
  const ownOrigin: LinkPolicy = { webview: "own-origin", isKnownMiniAppTarget: registry.isKnownMiniAppTarget, isAllowedRoute: isRootRelativePath };
  const anyHttps: LinkPolicy = { webview: "any-https", isKnownMiniAppTarget: (value) => value === "a", isAllowedRoute: (value) => value === "/campus" };
  const acceptsAnything: LinkPolicy = { webview: "any-https", isKnownMiniAppTarget: () => true, isAllowedRoute: () => true };

  it.each([
    ["miniapp", "eskara-2026/eskara/wristband", null],
    ["miniapp", "no-such-app", "unknown-miniapp-target"],
    ["external", "https://pf.kakao.com/_cjxexdG/chat", null],
    ["external", "http://pf.kakao.com/_cjxexdG/chat", "not-https-url"],
    ["webview", "/skku/lostandfound", null],
    ["webview", "https://webview.skkuverse.com/skku/lostandfound", null],
    ["webview", "https://evil.example/x", "not-webview-url"],
    ["route", "/notices", null],
    ["route", "//evil.com", "route-not-allowed"],
    ["route", "", "route-not-allowed"],
  ] as const)("on the web view origin, %s %j is %p", (actionType, actionValue, expected) => {
    // Act & Assert
    expect(toLinkProblem(actionType, actionValue, ownOrigin)).toBe(expected);
  });

  it.each([
    ["miniapp", "a", null],
    ["miniapp", "b/x", "unknown-miniapp-target"],
    ["webview", "https://evil.example/x", null],
    ["webview", "/skku/lostandfound", "not-https-url"],
    ["webview", "https://\\evil.com", "not-https-url"],
    ["route", "/campus", null],
    ["route", "/notices", "route-not-allowed"],
  ] as const)("on any https URL, %s %j is %p", (actionType, actionValue, expected) => {
    // Act & Assert
    expect(toLinkProblem(actionType, actionValue, anyHttps)).toBe(expected);
  });

  it.each([
    ["miniapp", "a ", "unknown-miniapp-target"],
    ["miniapp", "", "unknown-miniapp-target"],
    ["route", "/campus\n", "route-not-allowed"],
    ["route", " /campus", "route-not-allowed"],
  ] as const)("refuses whitespace or an empty value before the policy decides: %s %j is %p", (actionType, actionValue, expected) => {
    // Act & Assert
    expect(toLinkProblem(actionType, actionValue, acceptsAnything)).toBe(expected);
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
