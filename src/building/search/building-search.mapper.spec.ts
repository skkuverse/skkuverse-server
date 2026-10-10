/**
 * toBuildingSearch: GET /building/search's body from the two ranked results.
 * What it guards:
 *  - rooms are grouped by building in row order, so the relevance ranking the
 *    pipeline produced survives the grouping;
 *  - each group is joined to its building's skkuId through the building list,
 *    and a room whose building is not listed keeps a null skkuId;
 *  - an empty English name shows the Korean one, and labels follow the lang;
 *  - spaceCount counts rooms, not groups, and the limits carry each result's
 *    own total and truncation;
 *  - the inputs (the building list is cached) are not modified.
 */
import type { BuildingDoc, SpaceDoc } from "../building.document";
import { toBuildingSearch } from "./building-search.mapper";
import { BUILDING_SEARCH_LIMIT, SPACE_SEARCH_LIMIT } from "./building-search.rules";
import type { RankedSearchResult } from "./building-search.types";

function room(spaceCd: string, buildNo: string, campus: "hssc" | "nsc", over: Partial<SpaceDoc> = {}): SpaceDoc {
  return {
    spaceCd,
    buildNo,
    campus,
    floor: { ko: "1층", en: "1F" },
    name: { ko: `강의실 ${spaceCd}`, en: `Room ${spaceCd}` },
    buildingName: { ko: `건물 ${buildNo}`, en: `Building ${buildNo}` },
    conspaceCd: null,
    ...over,
  } as SpaceDoc;
}

function building(skkuId: number, buildNo: string | null, campus: "hssc" | "nsc"): BuildingDoc {
  return {
    _id: skkuId,
    buildNo,
    displayNo: null,
    type: buildNo ? "building" : "facility",
    campus,
    name: { ko: `건물 ${skkuId}`, en: `Building ${skkuId}` },
  } as unknown as BuildingDoc;
}

function ranked<T>(items: T[], total = items.length, truncated = false): RankedSearchResult<T> {
  return { items, counts: { hssc: total, nsc: 0, total }, total, truncated };
}

const ALL_BUILDINGS = [building(27, "227", "nsc"), building(2, "102", "hssc"), building(900, null, "hssc")];

describe("toBuildingSearch", () => {
  it("groups rooms by building in the order the rows arrive", () => {
    // Arrange
    const rows = [room("A1", "227", "nsc"), room("B1", "102", "hssc"), room("A2", "227", "nsc")];

    // Act
    const { data } = toBuildingSearch(
      { keyword: "강의실", buildings: ranked([]), spaces: ranked(rows) },
      ALL_BUILDINGS,
      "ko",
    );

    // Assert
    expect(data.spaces.map((group) => group.buildNo)).toEqual(["227", "102"]);
    expect(data.spaces[0]!.items.map((item) => item.spaceCd)).toEqual(["A1", "A2"]);
    expect(data.spaces[1]!.items.map((item) => item.spaceCd)).toEqual(["B1"]);
  });

  it("joins each group to its building and labels it for the lang", () => {
    // Act
    const { data } = toBuildingSearch(
      { keyword: "27", buildings: ranked([]), spaces: ranked([room("A1", "227", "nsc")]) },
      ALL_BUILDINGS,
      "en",
    );

    // Assert
    expect(data.spaces[0]).toEqual({
      skkuId: 27,
      buildNo: "227",
      displayNo: "27",
      campus: "nsc",
      campusLabel: "NSC",
      buildingName: { ko: "건물 227", en: "Building 227" },
      items: [{ spaceCd: "A1", name: { ko: "강의실 A1", en: "Room A1" }, floor: { ko: "1층", en: "1F" } }],
    });
  });

  it("keeps a null skkuId for a room whose building is not in the list", () => {
    // Act
    const { data } = toBuildingSearch(
      { keyword: "x", buildings: ranked([]), spaces: ranked([room("Z1", "199", "hssc")]) },
      ALL_BUILDINGS,
      "ko",
    );

    // Assert
    expect(data.spaces[0]).toMatchObject({ skkuId: null, buildNo: "199", displayNo: "99", campusLabel: "인사캠" });
  });

  it("shows the Korean side where a room, floor or building name has no English", () => {
    // Arrange
    const untranslated = room("A1", "227", "nsc", {
      name: { ko: "세미나실", en: "" },
      floor: { ko: "지하1층", en: "" },
      buildingName: { ko: "제1공학관", en: "" },
    });

    // Act
    const { data } = toBuildingSearch(
      { keyword: "세미나", buildings: ranked([]), spaces: ranked([untranslated]) },
      ALL_BUILDINGS,
      "en",
    );

    // Assert
    expect(data.spaces[0]!.buildingName).toEqual({ ko: "제1공학관", en: "제1공학관" });
    expect(data.spaces[0]!.items[0]).toMatchObject({
      name: { ko: "세미나실", en: "세미나실" },
      floor: { ko: "지하1층", en: "지하1층" },
    });
  });

  it("labels the buildings and counts rooms, not groups, in meta", () => {
    // Arrange
    const rows = [room("A1", "227", "nsc"), room("A2", "227", "nsc"), room("B1", "102", "hssc")];
    const buildings = ranked([building(27, "227", "nsc")], 1, false);
    const spaces = ranked(rows, 1500, true);

    // Act
    const { data, meta } = toBuildingSearch({ keyword: "공학", buildings, spaces }, ALL_BUILDINGS, "ko");

    // Assert
    expect(data.buildings).toEqual([{ ...building(27, "227", "nsc"), campusLabel: "자과캠" }]);
    expect(meta).toEqual({
      keyword: "공학",
      buildingCount: 1,
      spaceCount: 3,
      counts: { building: buildings.counts, space: spaces.counts },
      limits: {
        building: { limit: BUILDING_SEARCH_LIMIT, total: 1, truncated: false },
        space: { limit: SPACE_SEARCH_LIMIT, total: 1500, truncated: true },
      },
    });
  });

  it("does not modify the rows or the cached building list", () => {
    // Arrange
    const deepFreeze = <T>(value: T): T => {
      if (value && typeof value === "object") {
        Object.values(value).forEach(deepFreeze);
        Object.freeze(value);
      }
      return value;
    };
    const rows = deepFreeze([room("A1", "227", "nsc", { name: { ko: "실", en: "" } })]);
    const buildings = deepFreeze(ranked([building(27, "227", "nsc")]));
    const allBuildings = deepFreeze([...ALL_BUILDINGS]);

    // Act & Assert
    expect(() =>
      toBuildingSearch({ keyword: "실", buildings, spaces: ranked(rows) }, allBuildings, "en"),
    ).not.toThrow();
    expect(rows[0]!.name).toEqual({ ko: "실", en: "" });
  });
});
