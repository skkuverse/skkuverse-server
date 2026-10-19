/**
 * The rules the ui flows share: a banner shows inside its half-open window
 * [startAt, endAt), and the first repeat of an id is found where it repeats.
 *
 * A bus group shows always, or from the first to the last day of its date
 * range, both whole days in KST. The instants below fall on different dates in
 * UTC and KST, so a check in the host's zone fails them. A first-day time that
 * does not parse throws rather than hiding the group.
 *
 * A `miniapp` link action names the mini app its target parses to, a reference
 * the data tool resolves against the registry.
 *
 * Data that names no mini app is checked against the grammar alone: no id is
 * registered, so a target that does not parse is broken as it is against the
 * registry, and the grammar answers as the registry's own.
 */
import { fixtureMiniappsService } from "../../__tests__/helpers/miniapps/registry-fixture";
import { findRepeatedId, isBannerShowing, isBusGroupVisible, toGrammarOnlyRegistry, toMiniAppTargetReferences } from "./ui.rules";

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

describe("toMiniAppTargetReferences", () => {
  const grammar = fixtureMiniappsService();

  it.each<[string, Record<string, string>, unknown[]]>([
    ["a miniapp target, by its id", { actionType: "miniapp", actionValue: "inja/entry" }, [{ dataset: "miniapps", id: "inja", path: ["at"] }]],
    ["an unregistered miniapp target, so the tool can name it", { actionType: "miniapp", actionValue: "nope" }, [{ dataset: "miniapps", id: "nope", path: ["at"] }]],
    ["nothing for a target that does not parse", { actionType: "miniapp", actionValue: "inja:relative" }, []],
    ["nothing for another action type, even one whose value parses as a target", { actionType: "external", actionValue: "inja" }, []],
    ["nothing for no action", {}, []],
  ])("lists %s", (_label, link, references) => {
    // Act & Assert
    expect(toMiniAppTargetReferences(link as never, ["at"], grammar)).toEqual(references);
  });
});

describe("toGrammarOnlyRegistry", () => {
  const registry = toGrammarOnlyRegistry(fixtureMiniappsService());

  it("registers no id and knows no target, so it is asked only about data that names no mini app", () => {
    // Act & Assert
    expect(registry.isRegistered("inja")).toBe(false);
    expect(registry.isKnownMiniAppTarget("inja:relative")).toBe(false);
  });

  it("answers the grammar as the registry does", () => {
    // Act & Assert
    expect(registry.parseTarget("inja/entry")).toEqual({ id: "inja", path: "/entry" });
    expect(registry.parseTarget("inja:relative")).toBeNull();
    expect(registry.isSingleEmoji("🚌")).toBe(true);
    expect(registry.isSingleEmoji("🚌🚌")).toBe(false);
  });
});
