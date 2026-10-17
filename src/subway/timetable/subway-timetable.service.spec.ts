/**
 * SubwayTimetableService, the timetable door the tracking and arrivals flows
 * read, over a scripted HolidaysService (the fake in
 * __tests__/helpers/fakes/holidays/). What it guards: each platform's schedule
 * is its own source's table for the service day (the Korail holiday table and
 * the Seoul Saturday table on a Saturday, both holiday tables on a public
 * holiday that falls on a Wednesday, Friday's weekday table for a train past
 * midnight), with its trains at instants of that day and its line's travel
 * order, which continues each direction's upstream platforms with its watched
 * ones; one platform's schedule is found by its platform id, and an unserved
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

describe("SubwayTimetableService.listPlatformSchedules", () => {
  it("serves a Saturday from the 1호선 holiday table and the Seoul station Saturday tables", async () => {
    // Arrange
    const { service } = setup();

    // Act
    const schedules = await service.listPlatformSchedules(new Date("2026-10-17T03:00:00Z"));

    // Assert
    expect(schedules.map((s) => [s.platform.id, s.serviceDate, s.dayType])).toEqual([
      ["KR-1-0153", "2026-10-17", "holiday"],
      ["S1-4-420", "2026-10-17", "saturday"],
      ["S1-2-216", "2026-10-17", "saturday"],
      ["S1-3-334", "2026-10-17", "saturday"],
      ["S1-2-222", "2026-10-17", "saturday"],
      ["S1-3-332", "2026-10-17", "saturday"],
    ]);
  });

  it("serves a public holiday on a Wednesday from every line's holiday table", async () => {
    // Arrange
    const { service, holidays } = setup();
    holidays.names.set("2026-10-14", "테스트공휴일");

    // Act
    const schedules = await service.listPlatformSchedules(new Date("2026-10-14T03:00:00Z"));

    // Assert
    expect(new Set(schedules.map((s) => s.dayType))).toEqual(new Set(["holiday"]));
    expect(schedules).toHaveLength(6);
  });

  it("matches 00:13 on Saturday to Friday's weekday table, its trains at instants of that day", async () => {
    // Arrange
    const { service } = setup();

    // Act
    const [sungkyunkwan] = await service.listPlatformSchedules(new Date("2026-10-16T15:13:00Z"));

    // Assert
    expect([sungkyunkwan?.serviceDate, sungkyunkwan?.dayType]).toEqual(["2026-10-16", "weekday"]);
    const arrivals = sungkyunkwan?.trains.flatMap((t) => t.stops.filter((s) => s.platformId === "KR-1-0153").map((s) => s.arrivalAt));
    expect(arrivals).toContainEqual(new Date("2026-10-16T15:13:00Z"));
  });

  it("hands each platform its line's travel order per direction", async () => {
    // Arrange
    const { service } = setup();

    // Act
    const [sungkyunkwan, hyehwa] = await service.listPlatformSchedules(new Date("2026-10-16T03:00:00Z"));

    // Assert
    expect(sungkyunkwan?.lineRoutes.down.slice(0, 5)).toEqual(["KR-1-P149", "KR-1-P150", "KR-1-P151", "KR-1-P152", "KR-1-0153"]);
    expect(hyehwa?.lineRoutes.up.slice(0, 4)).toEqual(["S1-4-423", "S1-4-422", "S1-4-421", "S1-4-420"]);
  });

  it("hands 강남 2호선 the inner circle in rising station codes and 양재 3호선 the line toward 대화 in falling ones", async () => {
    // Arrange
    const { service } = setup();

    // Act
    const schedules = await service.listPlatformSchedules(new Date("2026-10-16T03:00:00Z"));

    // Assert
    const routeOf = (platformId: string) => schedules.find((s) => s.platform.id === platformId)?.lineRoutes;
    expect(routeOf("S1-2-222")?.up.slice(6, 10)).toEqual(["S1-2-219", "S1-2-220", "S1-2-221", "S1-2-222"]);
    expect(routeOf("S1-3-332")?.up.slice(3, 6)).toEqual(["S1-3-334", "S1-3-333", "S1-3-332"]);
  });

  it("continues each platform's upstream platforms with its watched platforms on its direction's route, nearest first", async () => {
    // Arrange
    const { service } = setup();

    // Act
    const schedules = await service.listPlatformSchedules(new Date("2026-10-16T03:00:00Z"));

    // Assert
    const watched = schedules.flatMap(({ platform, lineRoutes }) =>
      (["up", "down"] as const).map((direction) => {
        const route = lineRoutes[direction];
        const { upstreamPlatformIds, watchedPlatformIds } = platform.directions[direction];
        const beyond = route.indexOf(platform.id) - upstreamPlatformIds.length;
        return [watchedPlatformIds, route.slice(Math.max(0, beyond - watchedPlatformIds.length), beyond).reverse()];
      }),
    );
    expect(watched.map(([declared]) => declared)).toEqual(watched.map(([, onRoute]) => onRoute));
    expect(watched.flatMap(([declared]) => declared)).toEqual(["KR-1-P149"]);
  });

  it("lists each platform's upstream platforms as the three before it on its direction's route, nearest first, and its next platform as the one after", async () => {
    // Arrange
    const { service } = setup();

    // Act
    const schedules = await service.listPlatformSchedules(new Date("2026-10-16T03:00:00Z"));

    // Assert
    const neighbors = schedules.flatMap(({ platform, lineRoutes }) =>
      (["up", "down"] as const).map((direction) => {
        const route = lineRoutes[direction];
        const at = route.indexOf(platform.id);
        const { upstreamPlatformIds, nextPlatformId } = platform.directions[direction];
        return [[upstreamPlatformIds, nextPlatformId], [route.slice(Math.max(0, at - 3), at).reverse(), route[at + 1]]];
      }),
    );
    expect(neighbors.map(([declared]) => declared)).toEqual(neighbors.map(([, onRoute]) => onRoute));
  });
});

describe("SubwayTimetableService.findPlatformSchedule", () => {
  it("finds 혜화's schedule by its platform id, from its Saturday table on a Saturday", async () => {
    // Arrange
    const { service } = setup();

    // Act
    const schedule = await service.findPlatformSchedule("S1-4-420", new Date("2026-10-17T03:00:00Z"));

    // Assert
    expect([schedule?.platform.id, schedule?.dayType]).toEqual(["S1-4-420", "saturday"]);
  });

  it("finds no schedule for a platform it does not serve", async () => {
    // Arrange
    const { service } = setup();

    // Act
    const schedule = await service.findPlatformSchedule("S1-2-220", new Date("2026-10-17T03:00:00Z"));

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
