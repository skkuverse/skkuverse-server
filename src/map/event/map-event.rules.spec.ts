/**
 * The event overlay's decisions: which sheet buttons are valid for their
 * type, which list-facet options a place is in (by the start of its windows,
 * or as authored for a tag), and which per-option orders survive, with every
 * value the config does not offer reported rather than thrown.
 */
import type { MapPlaceDoc, PlaceAction } from "../map.document";
import { actionDropReason, facetsOf, isValidActionValue, orderByOptionOf } from "./map-event.rules";
import { shippedLayerSet } from "../../../__tests__/helpers/map/shipped-layer-set";

const CONFIG = shippedLayerSet();
const knownTargets = (value: string): boolean => value.split("/")[0] === "eskara-2026";
const DAY_1_START = CONFIG.facets[0]?.options[0]?.window?.from ?? new Date(0);

function action(actionType: PlaceAction["actionType"], actionValue: string): PlaceAction {
  return { id: "a", label: { ko: "열기" }, actionType, actionValue };
}

function place(over: Partial<MapPlaceDoc> = {}): MapPlaceDoc {
  return { _id: "p", hours: [], facets: {}, orderByOption: {}, ...over } as MapPlaceDoc;
}

describe("isValidActionValue", () => {
  it.each([
    ["route", "/(tabs)/transit", true],
    ["route", "//evil.com", false],
    ["webview", "/eskara/entry", true],
    ["webview", "https://evil.com/x", false],
    ["external", "https://instagram.com/x", true],
    ["external", "http://instagram.com/x", false],
    ["external", "https://instagram.com/x\n", false],
    ["miniapp", "eskara-2026/wristband", true],
    ["miniapp", "unknown-app", false],
    ["content", "줄 서기\n10분", true],
    ["content", "  ", false],
  ] as const)("judges %s %j valid: %s", (type, value, valid) => {
    // Act & Assert
    expect(isValidActionValue(action(type, value), knownTargets)).toBe(valid);
  });
});

describe("actionDropReason", () => {
  it("names a blank label before the value", () => {
    // Act & Assert
    expect(actionDropReason({ ...action("route", "nope"), label: { ko: " " } }, knownTargets)).toBe("a: label is blank in every language");
    expect(actionDropReason(action("route", "nope"), knownTargets)).toBe('a: actionValue "nope" is not valid for actionType "route"');
    expect(actionDropReason(action("route", "/ok"), knownTargets)).toBeNull();
  });
});

describe("facetsOf", () => {
  it.each([
    [-1, []],
    [0, ["day1"]],
    [1, ["day1"]],
  ])("puts a window starting %d ms from day 1's start in the days it starts in", (offsetMs, days) => {
    // Arrange
    const startAt = new Date(DAY_1_START.getTime() + offsetMs);
    const doc = place({ hours: [{ startAt, endAt: null }] });

    // Act
    const facets = facetsOf(doc, CONFIG, []);

    // Assert
    expect(facets.day).toEqual(days);
  });

  it("puts a place that is always open in every day, and keys every facet", () => {
    // Act
    const facets = facetsOf(place(), CONFIG, []);

    // Assert
    expect(Object.keys(facets)).toEqual(CONFIG.facets.map((f) => f.id));
    expect(facets.day).toEqual(CONFIG.facets[0]?.options.map((o) => o.id));
  });

  it("drops and reports a tag value the config does not offer, and an authored hours facet", () => {
    // Arrange
    const dropped: string[] = [];

    // Act
    const facets = facetsOf(place({ facets: { org: ["council", "aliens"], day: ["day1"] } }), CONFIG, dropped);

    // Assert
    expect(facets.org).toEqual(["council"]);
    expect(dropped).toEqual(['p: facets.org has no option "aliens"', "p: facets.day is derived from hours, not authored"]);
  });
});

describe("orderByOptionOf", () => {
  it("keeps finite orders of real options and reports the rest", () => {
    // Arrange
    const dropped: string[] = [];
    const doc = place({ orderByOption: { day1: 3, day9: 1, day2: Number.NaN } });

    // Act
    const orders = orderByOptionOf(doc, CONFIG, dropped);

    // Assert
    expect(orders).toEqual({ day1: 3 });
    expect(dropped).toEqual(["p: orderByOption.day9 = 1", "p: orderByOption.day2 = null"]);
  });
});
