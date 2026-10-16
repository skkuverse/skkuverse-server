/**
 * The committed timetables as loaded at import: all five parse, and a malformed file fails the boot with
 * every issue and its path in one message.
 */
import { SUBWAY_TIMETABLES, loadTimetable } from "./subway-timetable.config";

describe("SUBWAY_TIMETABLES", () => {
  it("loads every committed table, so the module import in this file did not throw", () => {
    // Act
    const loaded = SUBWAY_TIMETABLES.map((t) => `${t.operator}-${t.line} ${t.dayType}`);

    // Assert
    expect(loaded).toEqual(["KR-1 weekday", "KR-1 holiday", "S1-4 weekday", "S1-4 saturday", "S1-4 holiday"]);
  });
});

describe("loadTimetable", () => {
  it("throws every issue of a malformed file, each with its path, in one message", () => {
    // Arrange
    const raw = {
      source: { kind: "korail-xlsx", ref: "x", revision: "2026-08-28" },
      operator: "KR",
      line: "1",
      dayType: "sunday",
      stations: ["KR-1-0153"],
      trains: [{ trainNo: "K0493", direction: "down", destination: "서동탄", express: false, stops: [{ station: "KR-1-0153", arr: 1, dep: 2 }] }],
    };

    // Act & Assert
    expect(() => loadTimetable("korail-1-weekday.json", raw)).toThrow(/^korail-1-weekday\.json: dayType: .+; trains\.0\.trainNo: .+$/);
  });
});
