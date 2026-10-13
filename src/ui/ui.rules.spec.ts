/**
 * The rules home and campus share: a banner shows inside its half-open window
 * [startAt, endAt), the first repeated id is named, and a link action is
 * checked by its type's rule (a registered mini-app target, an https URL, a
 * web view URL, a root-relative route), never with whitespace.
 */
import { MiniAppsService } from "../miniapps/miniapps.service";
import { findDuplicateId, isBannerShowing, isBrokenLinkAction } from "./ui.rules";

const registry = new MiniAppsService();

describe("isBannerShowing", () => {
  const window = { startAt: "2026-10-01T00:00:00+09:00", endAt: "2026-10-03T00:00:00+09:00" };

  it.each([
    ["2026-09-30T14:59:59.999Z", false],
    ["2026-09-30T15:00:00.000Z", true],
    ["2026-10-02T14:59:59.999Z", true],
    ["2026-10-02T15:00:00.000Z", false],
  ])("at %s answers %p for [startAt, endAt)", (iso, expected) => {
    // Act & Assert
    expect(isBannerShowing(window, new Date(iso))).toBe(expected);
  });

  it("shows a banner without a window, and one with an open end after its start", () => {
    // Arrange
    const now = new Date("2030-01-01T00:00:00Z");

    // Act & Assert
    expect(isBannerShowing({}, now)).toBe(true);
    expect(isBannerShowing({ startAt: window.startAt }, now)).toBe(true);
    expect(isBannerShowing({ endAt: window.endAt }, now)).toBe(false);
  });
});

describe("findDuplicateId", () => {
  it("names the first id seen twice, and nothing when all differ", () => {
    // Act & Assert
    expect(findDuplicateId(["a", "b", "c", "b", "a"])).toBe("b");
    expect(findDuplicateId(["a", "b", "c"])).toBeUndefined();
    expect(findDuplicateId([])).toBeUndefined();
  });
});

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
    ["route", "/map/hssc", false],
    ["route", "//evil.com", true],
    ["route", "campus", true],
    ["route", "", true],
    ["route", "/search\n", true],
  ] as const)("%s %p: broken is %p", (actionType, actionValue, expected) => {
    // Act & Assert
    expect(isBrokenLinkAction({ actionType, actionValue }, registry)).toBe(expected);
  });

  it("finds nothing broken in a banner without an action", () => {
    // Act & Assert
    expect(isBrokenLinkAction({}, registry)).toBe(false);
  });
});
