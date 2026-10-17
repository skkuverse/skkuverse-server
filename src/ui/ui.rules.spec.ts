/**
 * The rules the ui flows share: a banner shows inside its half-open window
 * [startAt, endAt), the first repeat of an id is found where it repeats, and a link action is
 * checked by its type's rule (a registered mini-app target, an https URL, a
 * web view URL, a root-relative route), never with whitespace.
 *
 * A bus group shows always, or from the first to the last day of its date
 * range, both whole days in KST. The instants below fall on different dates in
 * UTC and KST, so a check in the host's zone fails them. A first-day time that
 * does not parse throws rather than hiding the group.
 */
import { MiniappsService } from "../miniapps/miniapps.service";
import { findRepeatedId, isBannerShowing, isBrokenLinkAction, isBusGroupVisible } from "./ui.rules";

const registry = new MiniappsService();

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

describe("findRepeatedId", () => {
  const ids = (...values: string[]): Array<{ id: string; at: number }> => values.map((id, at) => ({ id, at }));

  it("finds the first id seen twice, at its repeat, and nothing when all differ", () => {
    // Act & Assert
    expect(findRepeatedId(ids("a", "b", "c", "b", "a"))).toEqual({ id: "b", at: 3 });
    expect(findRepeatedId(ids("a", "b", "c"))).toBeUndefined();
    expect(findRepeatedId(ids())).toBeUndefined();
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

  it("finds nothing broken in a banner without an action", () => {
    // Act & Assert
    expect(isBrokenLinkAction({}, registry)).toBe(false);
  });
});

const pilot = { type: "dateRange", from: "2026-10-20", until: "2026-12-18" } as const;

describe("isBusGroupVisible", () => {
  it("shows an always-visible group at any time", () => {
    // Act & Assert
    expect(isBusGroupVisible({ type: "always" }, new Date("2000-01-01T00:00:00Z"))).toBe(true);
  });

  it.each([
    ["2026-10-19T14:59:59.999Z", false],
    ["2026-10-19T15:00:00.000Z", true],
    ["2026-12-18T14:59:59.999Z", true],
    ["2026-12-18T15:00:00.000Z", false],
  ])("at %s (the KST date edge) answers %p", (iso, expected) => {
    // Act & Assert
    expect(isBusGroupVisible(pilot, new Date(iso))).toBe(expected);
  });

  it.each([
    ["2026-10-12T02:54:59.999Z", false],
    ["2026-10-12T02:55:00.000Z", true],
  ])("with a first-day time, at %s (11:55 KST) answers %p", (iso, expected) => {
    // Arrange
    const fromNoon = { type: "dateRange", from: "2026-10-12", fromTime: "11:55", until: "2026-12-18" } as const;

    // Act & Assert
    expect(isBusGroupVisible(fromNoon, new Date(iso))).toBe(expected);
  });

  it.each(["24:00", "11:5", "noon"])("throws on a first-day time of %p instead of hiding the card", (fromTime) => {
    // Arrange
    const broken = { type: "dateRange", from: "2026-10-12", fromTime, until: "2026-12-18" } as const;

    // Act & Assert
    expect(() => isBusGroupVisible(broken, new Date("2026-10-20T00:00:00Z"))).toThrow(/fromTime/);
  });
});
