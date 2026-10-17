/**
 * SubwayTimetableService, the timetable door the tracking and arrivals flows
 * read, over a scripted HolidaysService (the fake in
 * __tests__/helpers/fakes/holidays/). What it guards: each station's schedule
 * is its own source's table for the service day (the Korail holiday table and
 * the Seoul Saturday table on a Saturday, both holiday tables on a public
 * holiday that falls on a Wednesday, Friday's weekday table for a train past
 * midnight), with its trains at instants of that day and its line's travel
 * order, which continues each direction's upstream stations with its watched
 * ones; one station's schedule is found by its station id, and an unserved
 * id finds none; and the service window opens at 05:00 KST and closes at 01:10 after a
 * weekday and at 00:30 after a Saturday or a holiday. The day-type, window and
 * instant rules themselves are subway-timetable.rules.spec.ts's.
 */
import { FakeHolidaysService } from "../../../__tests__/helpers/fakes/holidays/holidays.service.fake";
import { asReal } from "../../../__tests__/helpers/fakes/public-of";
import type { HolidaysService } from "../../holidays/holidays.service";
import { SubwayTimetableService } from "./subway-timetable.service";

function setup() {
  const holidays = new FakeHolidaysService();
  return { holidays, service: new SubwayTimetableService(asReal<HolidaysService>(holidays)) };
}

describe("SubwayTimetableService.listStationSchedules", () => {
  it("serves a Saturday from the 1호선 holiday table and the 4호선 Saturday table", async () => {
    // Arrange
    const { service } = setup();

    // Act
    const schedules = await service.listStationSchedules(new Date("2026-10-17T03:00:00Z"));

    // Assert
    expect(schedules.map((s) => [s.station.id, s.serviceDate, s.dayType])).toEqual([
      ["KR-1-0153", "2026-10-17", "holiday"],
      ["S1-4-420", "2026-10-17", "saturday"],
    ]);
  });

  it("serves a public holiday on a Wednesday from both lines' holiday tables", async () => {
    // Arrange
    const { service, holidays } = setup();
    holidays.names.set("2026-10-14", "테스트공휴일");

    // Act
    const schedules = await service.listStationSchedules(new Date("2026-10-14T03:00:00Z"));

    // Assert
    expect(schedules.map((s) => s.dayType)).toEqual(["holiday", "holiday"]);
  });

  it("matches 00:13 on Saturday to Friday's weekday table, its trains at instants of that day", async () => {
    // Arrange
    const { service } = setup();

    // Act
    const [sungkyunkwan] = await service.listStationSchedules(new Date("2026-10-16T15:13:00Z"));

    // Assert
    expect([sungkyunkwan?.serviceDate, sungkyunkwan?.dayType]).toEqual(["2026-10-16", "weekday"]);
    const arrivals = sungkyunkwan?.trains.flatMap((t) => t.stops.filter((s) => s.platformId === "KR-1-0153").map((s) => s.arrivalAt));
    expect(arrivals).toContainEqual(new Date("2026-10-16T15:13:00Z"));
  });

  it("hands each station its line's travel order per direction", async () => {
    // Arrange
    const { service } = setup();

    // Act
    const [sungkyunkwan, hyehwa] = await service.listStationSchedules(new Date("2026-10-16T03:00:00Z"));

    // Assert
    expect(sungkyunkwan?.lineRoutes.down.slice(0, 5)).toEqual(["KR-1-P149", "KR-1-P150", "KR-1-P151", "KR-1-P152", "KR-1-0153"]);
    expect(hyehwa?.lineRoutes.up.slice(0, 4)).toEqual(["S1-4-423", "S1-4-422", "S1-4-421", "S1-4-420"]);
  });

  it("continues each station's upstream stations with its watched stations on its direction's route, nearest first", async () => {
    // Arrange
    const { service } = setup();

    // Act
    const schedules = await service.listStationSchedules(new Date("2026-10-16T03:00:00Z"));

    // Assert
    const watched = schedules.flatMap(({ station, lineRoutes }) =>
      (["up", "down"] as const).map((direction) => {
        const route = lineRoutes[direction];
        const { upstreamPlatformIds, watchedPlatformIds } = station.directions[direction];
        const beyond = route.indexOf(station.id) - upstreamPlatformIds.length;
        return [watchedPlatformIds, route.slice(Math.max(0, beyond - watchedPlatformIds.length), beyond).reverse()];
      }),
    );
    expect(watched.map(([declared]) => declared)).toEqual(watched.map(([, onRoute]) => onRoute));
    expect(watched.flatMap(([declared]) => declared)).toEqual(["KR-1-P149"]);
  });

  it("lists each station's upstream stations as the three before it on its direction's route, nearest first, and its next station as the one after", async () => {
    // Arrange
    const { service } = setup();

    // Act
    const schedules = await service.listStationSchedules(new Date("2026-10-16T03:00:00Z"));

    // Assert
    const neighbors = schedules.flatMap(({ station, lineRoutes }) =>
      (["up", "down"] as const).map((direction) => {
        const route = lineRoutes[direction];
        const at = route.indexOf(station.id);
        const { upstreamPlatformIds, nextPlatformId } = station.directions[direction];
        return [[upstreamPlatformIds, nextPlatformId], [route.slice(Math.max(0, at - 3), at).reverse(), route[at + 1]]];
      }),
    );
    expect(neighbors.map(([declared]) => declared)).toEqual(neighbors.map(([, onRoute]) => onRoute));
  });
});

describe("SubwayTimetableService.findStationSchedule", () => {
  it("finds 혜화's schedule by its station id, from its Saturday table on a Saturday", async () => {
    // Arrange
    const { service } = setup();

    // Act
    const schedule = await service.findStationSchedule("S1-4-420", new Date("2026-10-17T03:00:00Z"));

    // Assert
    expect([schedule?.station.id, schedule?.dayType]).toEqual(["S1-4-420", "saturday"]);
  });

  it("finds no schedule for a station it does not serve", async () => {
    // Arrange
    const { service } = setup();

    // Act
    const schedule = await service.findStationSchedule("S1-2-222", new Date("2026-10-17T03:00:00Z"));

    // Assert
    expect(schedule).toBeNull();
  });
});

describe("SubwayTimetableService.isInServiceWindow", () => {
  it.each([
    ["03:00 KST", "2026-10-16T18:00:00Z", false],
    ["04:59:59 on a Friday", "2026-10-15T19:59:59Z", false],
    ["05:00 on a Friday", "2026-10-15T20:00:00Z", true],
    ["01:09:59 after a Friday", "2026-10-16T16:09:59Z", true],
    ["01:10 after a Friday", "2026-10-16T16:10:00Z", false],
    ["00:29:59 after a Saturday", "2026-10-17T15:29:59Z", true],
    ["00:30 after a Saturday", "2026-10-17T15:30:00Z", false],
  ])("reads %s as inside the window: %s", async (_label, iso, inside) => {
    // Arrange
    const { service } = setup();

    // Act
    const isInside = await service.isInServiceWindow(new Date(iso));

    // Assert
    expect(isInside).toBe(inside);
  });

  it("closes at 00:30 after a public holiday on a Wednesday", async () => {
    // Arrange
    const { service, holidays } = setup();
    holidays.names.set("2026-10-14", "테스트공휴일");

    // Act
    const isInside = await service.isInServiceWindow(new Date("2026-10-14T15:45:00Z"));

    // Assert
    expect(isInside).toBe(false);
  });
});
