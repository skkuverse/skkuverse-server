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
  ])("carries the seoul ids and the color of line %s", (code, seoul, color) => {
    // Act
    const line = toSubwayLine(code);

    // Assert
    expect(line.seoul).toEqual(seoul);
    expect(line.color).toBe(color);
  });

  it("throws on a line the registry does not list", () => {
    // Act & Assert
    expect(() => toSubwayLine("2")).toThrow(/"2"/);
  });
});
