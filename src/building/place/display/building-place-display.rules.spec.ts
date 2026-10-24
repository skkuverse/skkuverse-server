/**
 * How a resolved place is shown and which one a session shows: the stored id
 * of a pinned place, its `장소명 장소코드` pair derived from skkumap (never
 * stored), the session's primary place (a room over a building over a
 * facility, ties by list order, never an unpinned one), one primary per
 * campus with the count of the campus's other pinned places, and the building
 * a place stands in, by which a building's notices are found.
 */
import { skkumapPlaces } from "../../../../__tests__/helpers/building/places";
import type { BuildNo, Campus, SpaceCd } from "../../building.types";
import { placeLexicon } from "../building-place.config";
import { toPlaceIndex } from "../building-place.rules";
import type { PinnedPlace, PlaceIndex, ResolvedPlace } from "../building-place.types";
import { buildingOf, pickPrimaryPlace, pickPrimaryPlacesByCampus, toPlaceDisplay, toPlaceId } from "./building-place-display.rules";

const space = (campus: Campus, spaceCd: string, buildNo: string): PinnedPlace => ({ kind: "space", campus, spaceCd: spaceCd as SpaceCd, buildNo: buildNo as BuildNo });
const building = (campus: Campus, buildNo: string): PinnedPlace => ({ kind: "building", campus, buildNo: buildNo as BuildNo });
const facility = (campus: Campus, slug: string): PinnedPlace => ({ kind: "facility", campus, slug });
const online: ResolvedPlace = { kind: "unresolved", reason: "online", campus: null };
const hsscOnly: ResolvedPlace = { kind: "unresolved", reason: "campusOnly", campus: "hssc" };

let index: PlaceIndex;

beforeAll(() => {
  index = toPlaceIndex(skkumapPlaces(), placeLexicon);
});

describe("toPlaceId", () => {
  it.each([
    [space("hssc", "33B101", "133"), "space:hssc:33B101"],
    [building("nsc", "286"), "building:nsc:286"],
    [facility("nsc", "confucius-road"), "facility:nsc:confucius-road"],
  ])("stores %j as %s", (place, id) => {
    // Act & Assert
    expect(toPlaceId(place)).toBe(id);
  });
});

describe("toPlaceDisplay", () => {
  it.each([
    [space("hssc", "33B101", "133"), { name: "경영관", code: "33B101" }],
    [space("nsc", "33B101", "233"), { name: "화학관", code: "33B101" }],
    [building("hssc", "133"), { name: "경영관", code: "33" }],
    [building("nsc", "286"), { name: "N센터", code: "86" }],
    [facility("nsc", "confucius-road"), { name: "공자로" }],
    [facility("nsc", "ui-ye-kwan-yard"), { name: "의관·예관 사이" }],
  ])("shows %j as %j", (place, display) => {
    // Act & Assert
    expect(toPlaceDisplay(place, index)).toEqual(display);
  });

  it.each([
    [space("hssc", "99999", "199")],
    [space("hssc", "86133", "286")],
    [building("hssc", "286")],
    [facility("hssc", "confucius-road")],
  ])("shows nothing for %j, which skkumap no longer holds on that campus", (place) => {
    // Act & Assert
    expect(toPlaceDisplay(place, index)).toBeNull();
  });
});

describe("buildingOf", () => {
  it.each([
    [space("hssc", "33B101", "133"), { campus: "hssc", buildNo: "133" }],
    [space("nsc", "33B101", "233"), { campus: "nsc", buildNo: "233" }],
    [space("nsc", "27301", "227"), { campus: "nsc", buildNo: "227" }],
    [building("hssc", "161"), { campus: "hssc", buildNo: "161" }],
    [facility("nsc", "confucius-road"), null],
    [online, null],
    [hsscOnly, null],
  ] as Array<[ResolvedPlace, unknown]>)("finds the building of %j", (place, expected) => {
    // Act & Assert
    expect(buildingOf(place)).toEqual(expected);
  });
});

describe("pickPrimaryPlace", () => {
  it.each([
    [[building("nsc", "286"), online, space("nsc", "86126", "286"), space("nsc", "27301", "227")], 2],
    [[facility("nsc", "confucius-road"), building("nsc", "286")], 1],
    [[facility("nsc", "confucius-road"), hsscOnly, facility("hssc", "geumjandi-square")], 0],
    [[online, hsscOnly], null],
    [[], null],
  ] as Array<[ResolvedPlace[], number | null]>)("picks the most specific pinned place of %j", (places, expected) => {
    // Act & Assert
    expect(pickPrimaryPlace(places)).toBe(expected);
  });
});

describe("pickPrimaryPlacesByCampus", () => {
  it("picks one primary per campus, in the order the campuses first appear, and counts the campus's other pinned places", () => {
    // Arrange
    const places: ResolvedPlace[] = [
      facility("nsc", "confucius-road"),
      building("hssc", "133"),
      hsscOnly,
      space("hssc", "33B101", "133"),
      online,
      building("nsc", "286"),
      building("hssc", "161"),
    ];

    // Act
    const primaries = pickPrimaryPlacesByCampus(places);

    // Assert
    expect(primaries).toEqual([
      { campus: "nsc", placeIndex: 5, otherCount: 1 },
      { campus: "hssc", placeIndex: 3, otherCount: 2 },
    ]);
  });

  it("gives no entry to a campus with only list-only places", () => {
    // Act & Assert
    expect(pickPrimaryPlacesByCampus([hsscOnly, online])).toEqual([]);
  });
});
