/**
 * toNetworkIssues, the checks over the identities the code holds
 * (ADR 0013, D2): SUBWAY_LINES and SUBWAY_STATIONS pass, and a network with a
 * repeated station, platform, line code or subwayId, a platform on an unlisted
 * line, a second platform of one line at a station, or a line no platform uses
 * gets one issue each, with its path.
 *
 * A line of SUBWAY_LINES by its code: its Seoul ids,
 * its numbering, its color and its marker (one character: a numbered line's
 * number, a named line's first syllable in Korean). A code the
 * registry does not list throws: the registry's boot check makes that
 * unreachable for a registered platform.
 */
import { SUBWAY_LINES, SUBWAY_STATIONS } from "./subway.constants";
import { toNetworkIssues, toSubwayLine } from "./subway.rules";
import type { NetworkStation, SubwayLine, SubwayNetwork } from "./subway.types";

const NETWORK: SubwayNetwork = { lines: SUBWAY_LINES, stations: SUBWAY_STATIONS };

interface MutableNetwork {
  lines: SubwayLine[];
  stations: NetworkStation[];
}

const networkCopy = (): MutableNetwork => structuredClone({ lines: [...NETWORK.lines], stations: [...NETWORK.stations] });
const NEXT_STATION = NETWORK.stations.length;
const NEXT_LINE = NETWORK.lines.length;

describe("toNetworkIssues", () => {
  it("finds no issue in the code's lines and stations", () => {
    // Act & Assert
    expect(toNetworkIssues(NETWORK)).toEqual([]);
  });

  it.each([
    [
      "a repeated station",
      (network: MutableNetwork) => network.stations.push({ ...network.stations[1]!, platforms: [{ ...network.stations[1]!.platforms[0]!, id: "S1-4-499" }] }),
      { path: ["stations", NEXT_STATION, "id"], message: 'station "hyehwa" is listed twice' },
    ],
    [
      "a repeated platform",
      (network: MutableNetwork) => network.stations.push({ ...network.stations[1]!, id: "hyehwa-two" }),
      { path: ["stations", NEXT_STATION, "platforms", 0, "id"], message: 'platform "S1-4-420" is listed twice' },
    ],
    [
      "a repeated line code",
      (network: MutableNetwork) => network.lines.push({ ...network.lines[1]!, seoul: { ...network.lines[1]!.seoul, subwayId: "1099" } }),
      { path: ["lines", NEXT_LINE, "code"], message: 'line "4" is listed twice' },
    ],
    [
      "a repeated subwayId",
      (network: MutableNetwork) => (network.lines[1]!.seoul.subwayId = "1001"),
      { path: ["lines", 1, "seoul", "subwayId"], message: 'subwayId "1001" is listed twice' },
    ],
    [
      "a platform on an unlisted line",
      (network: MutableNetwork) => (network.stations[1]!.platforms[0]!.line = "9"),
      { path: ["stations", 1, "platforms", 0, "line"], message: '"9" is not a listed line' },
    ],
    [
      "two platforms of one line at one station",
      (network: MutableNetwork) => network.stations[1]!.platforms.push({ ...network.stations[1]!.platforms[0]!, id: "S1-4-499" }),
      { path: ["stations", 1, "platforms", 1, "line"], message: 'station "hyehwa" has a second platform on line "4"' },
    ],
    [
      "a line no platform uses",
      (network: MutableNetwork) => network.lines.push({ ...network.lines[1]!, code: "9", seoul: { ...network.lines[1]!.seoul, subwayId: "1009" } }),
      { path: ["lines", NEXT_LINE, "code"], message: 'line "9" has no platform' },
    ],
  ])("reports %s with its path", (_case, arrange, issue) => {
    // Arrange
    const network = networkCopy();
    arrange(network);

    // Act
    const issues = toNetworkIssues(network);

    // Assert
    expect(issues).toContainEqual(issue);
  });
});

describe("toSubwayLine", () => {
  it.each([
    ["1", { subwayId: "1001", lineName: "1호선", trainMapLine: "1", trainNumbers: "timetable" }, "0052A4"],
    ["4", { subwayId: "1004", lineName: "4호선", trainMapLine: "4", trainNumbers: "timetable" }, "00A5DE"],
    ["2", { subwayId: "1002", lineName: "2호선", trainMapLine: "2", trainNumbers: "circle" }, "00A84D"],
    ["3", { subwayId: "1003", lineName: "3호선", trainMapLine: "3", trainNumbers: "timetable" }, "EF7C1C"],
    ["8", { subwayId: "1008", lineName: "8호선", trainMapLine: "8", trainNumbers: "timetable" }, "E6186C"],
    ["K1", { subwayId: "1075", lineName: "수인분당선", trainNumbers: "timetable" }, "F5A200"],
    ["D1", { subwayId: "1077", lineName: "신분당선", trainNumbers: "trainset" }, "D4003B"],
  ])("carries the seoul ids and the color of line %s", (code, seoul, color) => {
    // Act
    const line = toSubwayLine(code);

    // Assert
    expect(line.seoul).toEqual(seoul);
    expect(line.color).toBe(color);
  });

  it.each([
    ["1", { ko: "1호선", en: "Line 1", zh: "1号线" }, { ko: "1", en: "1", zh: "1" }, "0052A4"],
    ["4", { ko: "4호선", en: "Line 4", zh: "4号线" }, { ko: "4", en: "4", zh: "4" }, "007FAB"],
    ["2", { ko: "2호선", en: "Line 2", zh: "2号线" }, { ko: "2", en: "2", zh: "2" }, "00893F"],
    ["3", { ko: "3호선", en: "Line 3", zh: "3号线" }, { ko: "3", en: "3", zh: "3" }, "BB5C0D"],
    ["8", { ko: "8호선", en: "Line 8", zh: "8号线" }, { ko: "8", en: "8", zh: "8" }, "E4186B"],
    ["K1", { ko: "수인분당선", en: "Suin–Bundang Line", zh: "水仁·盆唐线" }, { ko: "수", en: "수", zh: "水" }, "A26B00"],
    ["D1", { ko: "신분당선", en: "Shinbundang Line", zh: "新盆唐线" }, { ko: "신", en: "신", zh: "新" }, "D4003B"],
  ])("names line %s and marks it with one character in every language, in its marker color", (code, name, text, color) => {
    // Act
    const line = toSubwayLine(code);

    // Assert
    expect([line.name, line.marker]).toEqual([name, { text, color }]);
  });

  it("throws on a line the registry does not list", () => {
    // Act & Assert
    expect(() => toSubwayLine("9")).toThrow(/"9"/);
  });
});
