/**
 * A line of the committed registry by its code (design D2): its Seoul ids,
 * its numbering and its color. A code the registry does not list throws: the
 * registry's boot check makes that unreachable for a registered platform.
 */
import { toSubwayLine } from "./subway.rules";

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
    ["2", { ko: "2호선", en: "Line 2", zh: "2号线" }, { ko: "2", en: "2", zh: "2" }],
    ["3", { ko: "3호선", en: "Line 3", zh: "3号线" }, { ko: "3", en: "3", zh: "3" }],
    ["8", { ko: "8호선", en: "Line 8", zh: "8号线" }, { ko: "8", en: "8", zh: "8" }],
    ["K1", { ko: "수인분당선", en: "Suin–Bundang Line", zh: "水仁·盆唐线" }, { ko: "수인분당", en: "Suin–Bundang", zh: "水仁盆唐" }],
    ["D1", { ko: "신분당선", en: "Shinbundang Line", zh: "新盆唐线" }, { ko: "신분당", en: "Shinbundang", zh: "新盆唐" }],
  ])("names line %s and its badge in every language", (code, name, badge) => {
    // Act
    const line = toSubwayLine(code);

    // Assert
    expect([line.name, line.badge]).toEqual([name, badge]);
  });

  it("throws on a line the registry does not list", () => {
    // Act & Assert
    expect(() => toSubwayLine("9")).toThrow(/"9"/);
  });
});
