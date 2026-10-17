/**
 * The committed timetables as loaded at import: every file parses, each platform the registry serves or design D2b
 * plans (add-commute-station-subway) finds a table for every day type its source declares, every train at such a
 * platform runs inside the service window, and a malformed file fails the boot with every issue and its path in one
 * message.
 */
import type { SubwayPlatform } from "../subway.types";
import { SUBWAY_TIMETABLES, loadTimetable } from "./subway-timetable.config";
import { SERVICE_WINDOW_CLOSES_SEC, SERVICE_WINDOW_OPENS_SEC, TIMETABLE_DAY_TYPES } from "./subway-timetable.constants";
import { findTimetable, listSubwayPlatforms } from "./subway-timetable.rules";

// The platforms of design D2b that WP6 has not registered yet: each leaves this list in the commit that registers it.
const PLANNED: readonly Pick<SubwayPlatform, "id" | "line" | "timetable">[] = [
  { id: "DX-D1-4312", line: "D1", timetable: { source: "shinbundang" } },
  { id: "KR-K1-K230", line: "K1", timetable: { source: "korail" } },
  { id: "S1-8-2815", line: "8", timetable: { source: "seoul-station", stationCode: "2815" } },
  { id: "KR-K1-K217", line: "K1", timetable: { source: "korail" } },
  { id: "DX-D1-4307", line: "D1", timetable: { source: "shinbundang" } },
  { id: "DX-D1-4308", line: "D1", timetable: { source: "shinbundang" } },
  { id: "DX-D1-4318", line: "D1", timetable: { source: "shinbundang" } },
];

const SERVED = [...listSubwayPlatforms(), ...PLANNED.map((platform) => platform as SubwayPlatform)];

describe("SUBWAY_TIMETABLES", () => {
  it("loads every committed table, so the module import in this file did not throw", () => {
    // Act
    const loaded = SUBWAY_TIMETABLES.map((t) => `${t.operator}-${t.line} ${t.dayType}`);

    // Assert
    expect(loaded).toEqual([
      "KR-1 weekday",
      "KR-1 holiday",
      "S1-4 weekday",
      "S1-4 saturday",
      "S1-4 holiday",
      "KR-K1 weekday",
      "KR-K1 holiday",
      "S1-2 weekday",
      "S1-2 saturday",
      "S1-2 holiday",
      "S1-3 weekday",
      "S1-3 saturday",
      "S1-3 holiday",
      "S1-8 weekday",
      "S1-8 saturday",
      "S1-8 holiday",
      "DX-D1 weekday",
      "DX-D1 holiday",
    ]);
  });

  it("finds a table for every day type of every served and planned platform's source", () => {
    // Act
    const missing = SERVED.flatMap((platform) =>
      TIMETABLE_DAY_TYPES[platform.timetable.source]
        .filter((dayType) => findTimetable(SUBWAY_TIMETABLES, platform, dayType) === null)
        .map((dayType) => `${platform.id} ${dayType}`),
    );

    // Assert
    expect(SERVED).toHaveLength(13);
    expect(missing).toEqual([]);
  });

  it("runs every train of every table inside the service window of its day type at each served or planned platform", () => {
    // Arrange
    const servedIds = new Set(SERVED.map((platform) => platform.id));

    // Act
    const outside = SUBWAY_TIMETABLES.flatMap((table) =>
      table.trains.flatMap((train) =>
        train.stops
          .filter((stop) => servedIds.has(stop.station))
          .flatMap((stop) => [stop.arr, stop.dep])
          .filter((seconds): seconds is number => seconds !== null)
          .filter((seconds) => seconds < SERVICE_WINDOW_OPENS_SEC || seconds >= SERVICE_WINDOW_CLOSES_SEC[table.dayType])
          .map((seconds) => `${table.operator}-${table.line} ${table.dayType} ${train.trainNo} ${seconds}`),
      ),
    );

    // Assert
    expect(outside).toEqual([]);
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
