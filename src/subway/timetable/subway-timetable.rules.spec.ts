/**
 * The service-day rules: which service day an instant belongs to (it starts at 03:00 KST, so a train past
 * midnight is the previous day's), which day type each timetable source serves on a date, and how a
 * timetable's seconds become instants. Also the registry's platforms, each found by its KRIC id with its
 * line, timetable source, upstream, watched and next platforms and direction names; which committed table a platform reads, the travel order of a
 * line per direction, and the boot check that every source's declared day types have a table.
 */
import type { SubwayPlatform } from "../subway.types";
import { SUBWAY_TIMETABLES } from "./subway-timetable.config";
import {
  assertTimetablesCover,
  findSubwayPlatform,
  findTimetable,
  isInServiceWindow,
  listSubwayPlatforms,
  toDayType,
  toLineRoutes,
  toScheduledTrains,
  toServiceDate,
  toServiceInstant,
} from "./subway-timetable.rules";
import type { Timetable } from "./subway-timetable.types";

const SUNGKYUNKWAN = findSubwayPlatform("KR-1-0153") as SubwayPlatform;
const HYEHWA = findSubwayPlatform("S1-4-420") as SubwayPlatform;

function table(overrides: Partial<Timetable>): Timetable {
  return {
    source: { kind: "korail-xlsx", ref: "test", revision: "2026-08-28" },
    operator: "KR",
    line: "1",
    dayType: "weekday",
    stations: ["KR-1-P154", "KR-1-0153", "KR-1-P152"],
    trains: [],
    ...overrides,
  };
}

describe("toServiceDate", () => {
  it.each([
    ["02:59:59 KST Saturday, a UTC Friday", "2026-10-16T17:59:59Z", "2026-10-16"],
    ["03:00:00 KST Saturday, a UTC Friday", "2026-10-16T18:00:00Z", "2026-10-17"],
    ["03:00:01 KST Saturday, a UTC Friday", "2026-10-16T18:00:01Z", "2026-10-17"],
  ])("puts %s on the service day that starts at 03:00 KST", (_label, iso, serviceDate) => {
    // Act
    const date = toServiceDate(new Date(iso));

    // Assert
    expect(date).toBe(serviceDate);
  });

  it("puts 03:30 KST on the KST date, not on the UTC date it still is", () => {
    // Act
    const date = toServiceDate(new Date("2026-10-16T18:30:00Z"));

    // Assert
    expect(date).toBe("2026-10-17");
    expect(date).not.toBe("2026-10-16");
  });
});

describe("toDayType", () => {
  it.each([
    ["Friday", "weekday", "weekday", "2026-10-16", false],
    ["Saturday", "holiday", "saturday", "2026-10-17", false],
    ["Sunday", "holiday", "holiday", "2026-10-18", false],
    ["Monday", "weekday", "weekday", "2026-10-19", false],
    ["public holiday on a Wednesday", "holiday", "holiday", "2026-10-14", true],
    ["public holiday on a Saturday", "holiday", "holiday", "2026-10-17", true],
  ] as const)("serves a %s from korail's %s table and the Seoul station's %s table", (_label, korail, seoul, date, isPublicHoliday) => {
    // Act
    const dayTypes = [toDayType("korail", date, isPublicHoliday), toDayType("seoul-station", date, isPublicHoliday)];

    // Assert
    expect(dayTypes).toEqual([korail, seoul]);
  });
});

describe("toServiceInstant", () => {
  it("counts the seconds from 00:00 KST of the service date, past midnight into the next date", () => {
    // Act
    const instants = [toServiceInstant("2026-10-16", 75840), toServiceInstant("2026-10-16", 87180)];

    // Assert
    expect(instants).toEqual([new Date("2026-10-16T12:04:00Z"), new Date("2026-10-16T15:13:00Z")]);
  });
});

describe("findTimetable", () => {
  it("serves a Saturday from the 1호선 holiday table and the 4호선 Saturday table", () => {
    // Arrange
    const serviceDate = toServiceDate(new Date("2026-10-17T03:00:00Z"));

    // Act
    const korail = findTimetable(SUBWAY_TIMETABLES, SUNGKYUNKWAN, toDayType("korail", serviceDate, false));
    const seoul = findTimetable(SUBWAY_TIMETABLES, HYEHWA, toDayType("seoul-station", serviceDate, false));

    // Assert
    expect([korail?.line, korail?.dayType, seoul?.line, seoul?.dayType]).toEqual(["1", "holiday", "4", "saturday"]);
  });

  it("serves a public holiday on a Wednesday from both lines' holiday tables", () => {
    // Act
    const korail = findTimetable(SUBWAY_TIMETABLES, SUNGKYUNKWAN, toDayType("korail", "2026-10-14", true));
    const seoul = findTimetable(SUBWAY_TIMETABLES, HYEHWA, toDayType("seoul-station", "2026-10-14", true));

    // Assert
    expect([korail?.line, korail?.dayType, seoul?.line, seoul?.dayType]).toEqual(["1", "holiday", "4", "holiday"]);
  });

  it("finds no table for a day type the platform's line has none of", () => {
    // Act & Assert
    expect(findTimetable(SUBWAY_TIMETABLES, SUNGKYUNKWAN, "saturday")).toBeNull();
  });
});

describe("toScheduledTrains", () => {
  it("matches the last southbound 성균관대 train at 00:13 on Saturday to Friday's weekday table", () => {
    // Arrange
    const now = new Date("2026-10-16T15:10:00Z");
    const serviceDate = toServiceDate(now);
    const weekday = findTimetable(SUBWAY_TIMETABLES, SUNGKYUNKWAN, toDayType("korail", serviceDate, false)) as Timetable;

    // Act
    const trains = toScheduledTrains(weekday, serviceDate);

    // Assert
    expect(serviceDate).toBe("2026-10-16");
    expect(serviceDate).not.toBe("2026-10-17");
    const lastDown = trains
      .filter((t) => t.direction === "down")
      .flatMap((t) => t.stops.filter((s) => s.platformId === "KR-1-0153").map((s) => ({ trainNo: t.trainNo, arrivalAt: s.arrivalAt })))
      .sort((a, b) => Number(b.arrivalAt) - Number(a.arrivalAt))[0];
    expect(lastDown).toEqual({ trainNo: "0515", arrivalAt: new Date("2026-10-16T15:13:00Z") });
  });

  it("turns each stop's seconds into instants and keeps a missing time missing", () => {
    // Arrange
    const timetable = table({
      trains: [
        {
          trainNo: "0493",
          direction: "down",
          destination: "서동탄",
          express: false,
          stops: [
            { station: "KR-1-P152", arr: null, dep: 75660 },
            { station: "KR-1-0153", arr: 75840, dep: null },
          ],
        },
      ],
    });

    // Act
    const trains = toScheduledTrains(timetable, "2026-10-16");

    // Assert
    expect(trains).toEqual([
      {
        trainNo: "0493",
        direction: "down",
        destination: "서동탄",
        express: false,
        stops: [
          { platformId: "KR-1-P152", arrivalAt: null, departureAt: new Date("2026-10-16T12:01:00Z") },
          { platformId: "KR-1-0153", arrivalAt: new Date("2026-10-16T12:04:00Z"), departureAt: null },
        ],
      },
    ]);
  });
});

describe("toLineRoutes", () => {
  it("orders each direction's stations as its trains travel, whichever way the file lists them", () => {
    // Arrange
    const korail = SUBWAY_TIMETABLES.find((t) => t.line === "1" && t.dayType === "weekday") as Timetable;
    const seoul = SUBWAY_TIMETABLES.find((t) => t.line === "4" && t.dayType === "weekday") as Timetable;

    // Act
    const [korailRoutes, seoulRoutes] = [toLineRoutes(korail), toLineRoutes(seoul)];

    // Assert
    expect(korailRoutes.down.slice(0, 6)).toEqual(["KR-1-P149", "KR-1-P150", "KR-1-P151", "KR-1-P152", "KR-1-0153", "KR-1-P154"]);
    expect(korailRoutes.up).toEqual([...korailRoutes.down].reverse());
    expect(seoulRoutes.up.slice(0, 4)).toEqual(["S1-4-423", "S1-4-422", "S1-4-421", "S1-4-420"]);
    expect(seoulRoutes.down).toEqual([...seoulRoutes.up].reverse());
  });
});

describe("assertTimetablesCover", () => {
  it("passes for the committed tables", () => {
    // Act & Assert
    expect(() => assertTimetablesCover(listSubwayPlatforms(), SUBWAY_TIMETABLES)).not.toThrow();
  });

  it("names every platform and day type its source declares but no table serves", () => {
    // Arrange
    const withoutSaturdayOrKorailHoliday = SUBWAY_TIMETABLES.filter(
      (t) => !(t.line === "4" && t.dayType === "saturday") && !(t.line === "1" && t.dayType === "holiday"),
    );

    // Act & Assert
    expect(() => assertTimetablesCover(listSubwayPlatforms(), withoutSaturdayOrKorailHoliday)).toThrow(
      "subway timetables: no table for KR-1-0153 holiday, S1-4-420 saturday",
    );
  });
});

describe("isInServiceWindow", () => {
  it.each([
    ["04:59:59 Friday, a minute before the first trains", "weekday", "2026-10-16", "2026-10-15T19:59:59Z", false],
    ["05:00:00 Friday", "weekday", "2026-10-16", "2026-10-15T20:00:00Z", true],
    ["01:09:59 after a Friday", "weekday", "2026-10-16", "2026-10-16T16:09:59Z", true],
    ["01:10:00 after a Friday", "weekday", "2026-10-16", "2026-10-16T16:10:00Z", false],
    ["05:00:00 Saturday", "saturday", "2026-10-17", "2026-10-16T20:00:00Z", true],
    ["00:29:59 after a Saturday", "saturday", "2026-10-17", "2026-10-17T15:29:59Z", true],
    ["00:30:00 after a Saturday", "saturday", "2026-10-17", "2026-10-17T15:30:00Z", false],
    ["00:30:00 after a holiday", "holiday", "2026-10-18", "2026-10-18T15:30:00Z", false],
    ["03:00:00, the night", "weekday", "2026-10-16", "2026-10-16T18:00:00Z", false],
  ] as const)("reads %s as %s inside the window: %s", (_label, dayType, serviceDate, iso, inside) => {
    // Act
    const isInside = isInServiceWindow(dayType, serviceDate, new Date(iso));

    // Assert
    expect(isInside).toBe(inside);
  });
});

describe("listSubwayPlatforms", () => {
  it("lists every platform in the registry's station order", () => {
    // Act
    const platforms = listSubwayPlatforms();

    // Assert
    expect(platforms.map((platform) => [platform.id, platform.line])).toEqual([
      ["KR-1-0153", "1"],
      ["S1-4-420", "4"],
    ]);
  });
});

describe("findSubwayPlatform", () => {
  it.each([
    ["KR-1-0153", "up", ["KR-1-P154", "KR-1-P155", "KR-1-1715"]],
    ["KR-1-0153", "down", ["KR-1-P152", "KR-1-P151", "KR-1-P150"]],
    ["S1-4-420", "up", ["S1-4-421", "S1-4-422", "S1-4-423"]],
    ["S1-4-420", "down", ["S1-4-419", "S1-4-418", "S1-4-417"]],
  ] as const)("lists the upstream platforms of %s %s nearest first", (id, direction, upstreamPlatformIds) => {
    // Act
    const platform = findSubwayPlatform(id);

    // Assert
    expect(platform?.directions[direction].upstreamPlatformIds).toEqual(upstreamPlatformIds);
  });

  it.each([
    ["KR-1-0153", "up", []],
    ["KR-1-0153", "down", ["KR-1-P149"]],
    ["S1-4-420", "up", []],
    ["S1-4-420", "down", []],
  ] as const)("lists the watched platforms of %s %s, beyond its upstream ones, nearest first", (id, direction, watchedPlatformIds) => {
    // Act
    const platform = findSubwayPlatform(id);

    // Assert
    expect(platform?.directions[direction].watchedPlatformIds).toEqual(watchedPlatformIds);
  });

  it.each([
    ["KR-1-0153", "up", "KR-1-P152"],
    ["KR-1-0153", "down", "KR-1-P154"],
    ["S1-4-420", "up", "S1-4-419"],
    ["S1-4-420", "down", "S1-4-421"],
  ] as const)("names the next platform of %s %s", (id, direction, nextPlatformId) => {
    // Act
    const platform = findSubwayPlatform(id);

    // Assert
    expect(platform?.directions[direction].nextPlatformId).toBe(nextPlatformId);
  });

  it.each([
    ["KR-1-0153", "1", { source: "korail" }],
    ["S1-4-420", "4", { source: "seoul-station", stationCode: "0420" }],
  ])("puts %s on line %s with its timetable source", (id, line, timetable) => {
    // Act
    const platform = findSubwayPlatform(id);

    // Assert
    expect(platform?.line).toBe(line);
    expect(platform?.timetable).toEqual(timetable);
  });

  it.each([
    ["KR-1-0153", { ko: "서울 방면", en: "Toward Seoul", zh: "首尔方向" }, { ko: "천안·서동탄 방면", en: "Toward Cheonan / Seodongtan", zh: "天安·西东滩方向" }],
    ["S1-4-420", { ko: "불암산·진접 방면", en: "Toward Buramsan / Jinjeop", zh: "佛岩山·榛接方向" }, { ko: "오이도·안산 방면", en: "Toward Oido / Ansan", zh: "乌耳岛·安山方向" }],
  ])("names %s's directions in every language", (id, upName, downName) => {
    // Act
    const platform = findSubwayPlatform(id);

    // Assert
    expect(platform?.directions.up.name).toEqual(upName);
    expect(platform?.directions.down.name).toEqual(downName);
  });

  it.each(["S1-2-222", "KR-1-P154", "kr-1-0153", "hyehwa", ""])("finds no platform for %j", (id) => {
    // Act
    const platform = findSubwayPlatform(id);

    // Assert
    expect(platform).toBeNull();
  });
});
