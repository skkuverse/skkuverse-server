/**
 * The Seoul API's per-line decisions: an arrival row counts only
 * while its `recptnDt` lies from 180 s before the fetch to 30 s after it, which
 * keeps out the Shinbundang line's rows dated minutes ahead and the
 * Suin–Bundang line's frozen ones;
 * and a train number becomes the timetable's per the line's numbering:
 * `timetable` drops an operator letter before or after the digits and pads to
 * four, `trainset` passes the number through for run matching, and `circle`
 * (line 2) drops a branch train, by its first digit `1`, `5` or `9` or its
 * branch destination, and numbers a main-line train `2` plus its last three
 * digits, as the timetable and the train map do (`3361` is `2361`). A number
 * of five digits is refused.
 */
import { isArrivalRowInWindow, toTimetableTrainNo } from "./subway-seoul-api.rules";

const FETCHED_AT = new Date("2026-10-17T12:07:00Z");
const secondsFromFetch = (seconds: number): Date => new Date(FETCHED_AT.getTime() + seconds * 1000);

describe("isArrivalRowInWindow", () => {
  it.each([
    ["29 s ahead", 29, true],
    ["30 s ahead", 30, true],
    ["31 s ahead", 31, false],
    ["179 s old", -179, true],
    ["180 s old", -180, true],
    ["181 s old", -181, false],
    ["dated at the fetch", 0, true],
  ])("counts a row %s: %s", (_label, seconds, counts) => {
    // Act
    const isInWindow = isArrivalRowInWindow(secondsFromFetch(seconds), FETCHED_AT);

    // Assert
    expect(isInWindow).toBe(counts);
  });

  it("Row dated ahead: does not count a 신분당선 row at 정자 dated 231 s after the fetch", () => {
    // Act & Assert
    expect(isArrivalRowInWindow(secondsFromFetch(231), FETCHED_AT)).toBe(false);
  });

  it("Frozen row: does not count a 수인분당선 row at 도곡 still dated 600 s before the fetch", () => {
    // Act & Assert
    expect(isArrivalRowInWindow(secondsFromFetch(-600), FETCHED_AT)).toBe(false);
  });
});

describe("toTimetableTrainNo", () => {
  it.each([
    ["K3312", "timetable", "3312"],
    ["3024K", "timetable", "3024"],
    ["0493", "timetable", "0493"],
    ["493", "timetable", "0493"],
    ["18", "trainset", "18"],
    ["2", "trainset", "2"],
  ] as const)("reads %s on a %s line as %s", (raw, numbering, trainNo) => {
    // Act & Assert
    expect(toTimetableTrainNo(raw, numbering)).toBe(trainNo);
  });

  it.each([
    ["12345", "timetable"],
    ["K12345", "timetable"],
    ["", "timetable"],
    ["12345", "trainset"],
    ["K18", "trainset"],
  ] as const)("refuses %j on a %s line", (raw, numbering) => {
    // Act & Assert
    expect(toTimetableTrainNo(raw, numbering)).toBeNull();
  });

});

describe("toTimetableTrainNo on a circle line", () => {
  it.each([
    ["3361", "2361"],
    ["7363", "2363"],
    ["8386", "2386"],
    ["4388", "2388"],
    ["2364", "2364"],
    ["3360", "2360"],
  ])("2호선 operational number: reads %s as %s", (raw, trainNo) => {
    // Act & Assert
    expect(toTimetableTrainNo(raw, "circle", "성수종착")).toBe(trainNo);
  });

  it.each([
    ["1675", "신설동"],
    ["1678", "성수지선"],
    ["5683", "신도림지선"],
    ["5684", "까치산"],
    ["9361", "성수종착"],
  ])("2호선 branch train: refuses %s for %s by its first digit", (raw, destination) => {
    // Act & Assert
    expect(toTimetableTrainNo(raw, "circle", destination)).toBeNull();
  });

  it.each([
    ["2675", "성수지선"],
    ["2683", "신도림지선"],
  ])("refuses %s, whose first digit is a main line's, for its branch destination %s", (raw, destination) => {
    // Act & Assert
    expect(toTimetableTrainNo(raw, "circle", destination)).toBeNull();
  });

  it("numbers an arrival row, which names no destination here, by its first digit alone", () => {
    // Act & Assert
    expect([toTimetableTrainNo("8357", "circle"), toTimetableTrainNo("1675", "circle")]).toEqual(["2357", null]);
  });

  it.each(["361", "12345", "K3361", ""])("refuses %j, not four digits", (raw) => {
    // Act & Assert
    expect(toTimetableTrainNo(raw, "circle", "성수종착")).toBeNull();
  });
});
