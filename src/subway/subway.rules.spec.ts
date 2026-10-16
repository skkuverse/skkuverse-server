/**
 * The served stations (design D0): each is found by its KRIC id and carries
 * the KRIC codes it is joined from, its names, per direction the upstream
 * stations its trains pass just before it (nearest first) and the ids the
 * `seoul` provider polls it by. Any other id finds no station.
 */
import { findSubwayStation } from "./subway.rules";

describe("findSubwayStation", () => {
  it.each([
    ["KR-1-0153", { operatorCode: "KR", lineCode: "1", stationCode: "0153" }],
    ["S1-4-420", { operatorCode: "S1", lineCode: "4", stationCode: "420" }],
  ])("finds %s by the KRIC codes it is joined from", (id, codes) => {
    // Act
    const station = findSubwayStation(id);

    // Assert
    expect(station).toMatchObject({ id, ...codes });
  });

  it.each([
    ["KR-1-0153", "up", ["KR-1-P154", "KR-1-P155", "KR-1-1715"]],
    ["KR-1-0153", "down", ["KR-1-P152", "KR-1-P151", "KR-1-P150"]],
    ["S1-4-420", "up", ["S1-4-421", "S1-4-422", "S1-4-423"]],
    ["S1-4-420", "down", ["S1-4-419", "S1-4-418", "S1-4-417"]],
  ] as const)("lists the upstream stations of %s %s nearest first", (id, direction, upstreamStationIds) => {
    // Act
    const station = findSubwayStation(id);

    // Assert
    expect(station?.directions[direction].upstreamStationIds).toEqual(upstreamStationIds);
  });

  it.each([
    ["KR-1-0153", { subwayId: "1001", stationName: "성균관대", trainMapLine: "1", timetable: { source: "korail" } }],
    [
      "S1-4-420",
      { subwayId: "1004", stationName: "혜화", trainMapLine: "4", timetable: { source: "seoul-station", stationCode: "0420" } },
    ],
  ])("carries the seoul ids of %s", (id, seoul) => {
    // Act
    const station = findSubwayStation(id);

    // Assert
    expect(station?.seoul).toEqual(seoul);
  });

  it.each([
    ["KR-1-0153", { ko: "성균관대", en: "Sungkyunkwan Univ.", zh: "成均馆大学" }, { ko: "서울 방면", en: "Toward Seoul", zh: "首尔方向" }],
    ["S1-4-420", { ko: "혜화", en: "Hyehwa", zh: "惠化" }, { ko: "불암산·진접 방면", en: "Toward Buramsan / Jinjeop", zh: "佛岩山·榛接方向" }],
  ])("names %s and its up direction in every language", (id, name, upName) => {
    // Act
    const station = findSubwayStation(id);

    // Assert
    expect(station?.name).toEqual(name);
    expect(station?.directions.up.name).toEqual(upName);
  });

  it.each(["S1-2-222", "KR-1-P154", "kr-1-0153", ""])("finds no station for %j", (id) => {
    // Act
    const station = findSubwayStation(id);

    // Assert
    expect(station).toBeNull();
  });
});
