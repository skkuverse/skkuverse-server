/**
 * The lines the `seoul` provider polls, derived from the served stations:
 * one per Seoul `subwayId`, with the Seoul API's line name, the train-map
 * line, the served stations to ask arrivals for, and the table from each
 * Seoul station name of the line (the served stations and their upstream
 * stations) to its KRIC station id. A station or line without a Seoul name
 * fails at boot instead of dropping its trains.
 */
import { SUBWAY_STATIONS } from "../subway.constants";
import type { SubwayStation } from "../subway.types";
import { SEOUL_LINE_NAME_BY_SUBWAY_ID, SEOUL_STATION_NAME_BY_ID } from "./subway-seoul.constants";
import { toSeoulLines } from "./subway-seoul.rules";

const [SUNGKYUNKWAN, HYEHWA] = SUBWAY_STATIONS as [SubwayStation, SubwayStation];

describe("toSeoulLines", () => {
  it("gives 1호선 and 4호선, each with its served station and the Seoul names of its seven covered stations", () => {
    // Act
    const lines = toSeoulLines(SUBWAY_STATIONS, SEOUL_LINE_NAME_BY_SUBWAY_ID, SEOUL_STATION_NAME_BY_ID);

    // Assert
    expect(lines.map(({ stationIdByName, ...line }) => ({ ...line, stationIdByName: Object.fromEntries(stationIdByName) }))).toEqual([
      {
        subwayId: "1001",
        lineName: "1호선",
        trainMapLine: "1",
        stationNames: ["성균관대"],
        stationIdByName: {
          성균관대: "KR-1-0153",
          화서: "KR-1-P154",
          수원: "KR-1-P155",
          세류: "KR-1-1715",
          의왕: "KR-1-P152",
          당정: "KR-1-P151",
          군포: "KR-1-P150",
        },
      },
      {
        subwayId: "1004",
        lineName: "4호선",
        trainMapLine: "4",
        stationNames: ["혜화"],
        stationIdByName: {
          혜화: "S1-4-420",
          동대문: "S1-4-421",
          동대문역사문화공원: "S1-4-422",
          충무로: "S1-4-423",
          한성대입구: "S1-4-419",
          성신여대입구: "S1-4-418",
          길음: "S1-4-417",
        },
      },
    ]);
  });

  it("puts two served stations of one line on that one line", () => {
    // Arrange
    const uijeongbu = { ...SUNGKYUNKWAN, id: "KR-1-X100", seoul: { ...SUNGKYUNKWAN.seoul, stationName: "의정부" } };

    // Act
    const lines = toSeoulLines([SUNGKYUNKWAN, uijeongbu], SEOUL_LINE_NAME_BY_SUBWAY_ID, SEOUL_STATION_NAME_BY_ID);

    // Assert
    expect(lines).toHaveLength(1);
    expect(lines[0]?.stationNames).toEqual(["성균관대", "의정부"]);
    expect(lines[0]?.stationIdByName.get("의정부")).toBe("KR-1-X100");
  });

  it("fails for an upstream station without a Seoul name", () => {
    // Arrange
    const names = Object.fromEntries(Object.entries(SEOUL_STATION_NAME_BY_ID).filter(([id]) => id !== "KR-1-P154"));

    // Act & Assert
    expect(() => toSeoulLines([SUNGKYUNKWAN], SEOUL_LINE_NAME_BY_SUBWAY_ID, names)).toThrow(/KR-1-P154/);
  });

  it("fails for a station whose subwayId has no line name", () => {
    // Act & Assert
    expect(() => toSeoulLines([HYEHWA], { "1001": "1호선" }, SEOUL_STATION_NAME_BY_ID)).toThrow(/1004/);
  });
});
