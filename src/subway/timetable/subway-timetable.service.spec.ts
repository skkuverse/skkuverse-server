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
 * weekday and at 00:30 after a Saturday or a holiday. Over the committed
 * tables of all three day types, the tracked stations (design D17): every
 * station before a platform on its route is declared upstream or watched and
 * named by the provider, no run between two tracked stops of a train exceeds
 * the longest express run, every train is in view 10 minutes before the
 * platform or from where it starts, and no station of the line is skipped.
 * The day-type, window and instant rules themselves are
 * subway-timetable.rules.spec.ts's.
 */
import { FakeHolidaysService } from "../../../__tests__/helpers/fakes/holidays/holidays.service.fake";
import { asReal } from "../../../__tests__/helpers/fakes/public-of";
import type { HolidaysService } from "../../holidays/holidays.service";
import { subwayTopologyFixture } from "../../../__tests__/helpers/subway/topology";
import { SUBWAY_STATIONS } from "../subway.constants";
import { SubwayTimetableService } from "./subway-timetable.service";

// WHY: revision 1 of the stored topology, the directions these checks hold against the committed timetables.
const TOPOLOGY = subwayTopologyFixture();

function setup() {
  const holidays = new FakeHolidaysService();
  return { holidays, service: new SubwayTimetableService(asReal<HolidaysService>(holidays)) };
}

describe("SubwayTimetableService.listPlatformSchedules", () => {
  it("serves a Saturday from the Korail and 신분당 holiday tables and the Seoul station Saturday tables", async () => {
    // Arrange
    const { service } = setup();

    // Act
    const schedules = await service.listPlatformSchedules(new Date("2026-10-17T03:00:00Z"));

    // Assert
    expect(schedules.map((s) => [s.platform.id, s.serviceDate, s.dayType])).toEqual([
      ["KR-1-0153", "2026-10-17", "holiday"],
      ["S1-4-420", "2026-10-17", "saturday"],
      ["DX-D1-4312", "2026-10-17", "holiday"],
      ["KR-K1-K230", "2026-10-17", "holiday"],
      ["S1-2-216", "2026-10-17", "saturday"],
      ["S1-8-2815", "2026-10-17", "saturday"],
      ["S1-3-334", "2026-10-17", "saturday"],
      ["KR-K1-K217", "2026-10-17", "holiday"],
      ["S1-2-222", "2026-10-17", "saturday"],
      ["DX-D1-4307", "2026-10-17", "holiday"],
      ["S1-3-332", "2026-10-17", "saturday"],
      ["DX-D1-4308", "2026-10-17", "holiday"],
      ["DX-D1-4318", "2026-10-17", "holiday"],
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
    expect(schedules).toHaveLength(13);
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
    expect(sungkyunkwan?.lineRoutes.down.slice(0, 7)).toEqual(["KR-1-P147", "KR-1-P148", "KR-1-P149", "KR-1-P150", "KR-1-P151", "KR-1-P152", "KR-1-0153"]);
    expect(hyehwa?.lineRoutes.up.slice(0, 7)).toEqual(["S1-4-426", "S1-4-425", "S1-4-424", "S1-4-423", "S1-4-422", "S1-4-421", "S1-4-420"]);
  });

  it("hands 강남 2호선 the inner circle in rising station codes and 양재 3호선 the line toward 대화 in falling ones", async () => {
    // Arrange
    const { service } = setup();

    // Act
    const schedules = await service.listPlatformSchedules(new Date("2026-10-16T03:00:00Z"));

    // Assert
    const routeOf = (platformId: string) => schedules.find((s) => s.platform.id === platformId)?.lineRoutes;
    expect(routeOf("S1-2-222")?.up.slice(7, 11)).toEqual(["S1-2-219", "S1-2-220", "S1-2-221", "S1-2-222"]);
    expect(routeOf("S1-3-332")?.up.slice(8, 11)).toEqual(["S1-3-334", "S1-3-333", "S1-3-332"]);
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
        const { upstreamPlatformIds, watchedPlatformIds } = TOPOLOGY.platforms[platform.id]![direction];
        const beyond = route.indexOf(platform.id) - upstreamPlatformIds.length;
        return [watchedPlatformIds, route.slice(Math.max(0, beyond - watchedPlatformIds.length), beyond).reverse()];
      }),
    );
    expect(watched.map(([declared]) => declared)).toEqual(watched.map(([, onRoute]) => onRoute));
    expect(watched.slice(0, 2).map(([declared]) => declared)).toEqual([["KR-1-P157"], ["KR-1-P149", "KR-1-P148", "KR-1-P147"]]);
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
        const { upstreamPlatformIds, nextPlatformId } = TOPOLOGY.platforms[platform.id]![direction];
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

describe("SubwayTimetableService.listPlatformSchedules over the tracked stations", () => {
  // WHY: the longest horizon the estimate is measured at (PREDICTION_HORIZONS_MIN in history/, which a timetable
  // spec may not import): a train due within it should be seen on its own, not lent a delay.
  const HORIZON_SEC = 10 * 60;
  // EVIDENCE: the longest run of the committed tables between two stops of one train with no stop between them is
  // 510 s, the line 1 express from Geumjeong to Sungkyunkwan Univ., and between two adjacent stations 420 s
  // (Shinbundang, Cheonggyesan to Pangyo).
  const MAX_UNOBSERVED_RUN_SEC = 510;
  // WHY: a run starts at these with an arrival in its row: the Shinbundang table writes arrival = departure at a run's
  // first stop (scripts/subway-timetable/convert.py), and every line 2 inner-circle lap starts at Seongsu, one station
  // before Konkuk Univ., which stays untracked because an outer-circle lap starts there too under the number it reaches
  // Jamsil with.
  const RUN_STARTS = ["DX-D1-D04", "DX-D1-4319", "DX-D1-4311", "DX-D1-4312", "S1-2-212"];
  // WHY: the id frozen at first use (design D2) and the codes the 2026-05-11 KRIC list skips, each pair adjacent.
  const ADJACENT_ACROSS_CODES = ["KR-1-P157 KR-1-1715", "KR-1-1715 KR-1-P155", "S1-8-2809 S1-8-2811", "S1-8-2821 S1-8-2828"];
  const DAYS = ["2026-10-16T03:00:00Z", "2026-10-17T03:00:00Z", "2026-10-18T03:00:00Z"];
  const SECOND_MS = 1000;

  async function listTracked() {
    const { service } = setup();
    const schedules = (await Promise.all(DAYS.map((day) => service.listPlatformSchedules(new Date(day))))).flat();
    return schedules.flatMap(({ platform, lineRoutes, trains, dayType }) =>
      (["up", "down"] as const).map((direction) => {
        const route = lineRoutes[direction];
        const tracked = route.slice(0, route.indexOf(platform.id) + 1);
        const rows = trains
          .filter((train) => train.direction === direction && train.stops.some((stop) => stop.platformId === platform.id))
          .map((train) => ({ train, stops: train.stops.filter((stop) => tracked.includes(stop.platformId)) }));
        return { label: `${platform.id} ${direction} ${dayType}`, platform, direction, tracked, rows };
      }),
    );
  }

  const secondsBetween = (later: Date | null, earlier: Date | null): number => ((later?.getTime() ?? 0) - (earlier?.getTime() ?? 0)) / SECOND_MS;

  it("declares every station before each platform on its route as upstream or watched, each one a platform the provider names", async () => {
    // Act
    const tracked = await listTracked();

    // Assert
    const served = new Set(SUBWAY_STATIONS.flatMap((station) => station.platforms.map((platform) => platform.id)));
    const declared = tracked.map(({ platform, direction, tracked: stations }) => {
      const { upstreamPlatformIds, watchedPlatformIds } = TOPOLOGY.platforms[platform.id]![direction];
      return [[...upstreamPlatformIds, ...watchedPlatformIds], stations.slice(0, -1).reverse()];
    });
    expect(declared.map(([named]) => named)).toEqual(declared.map(([, onRoute]) => onRoute));
    const unnamed = tracked.flatMap(({ tracked: stations }) => stations.filter((id) => !served.has(id) && TOPOLOGY.neighbors[id] === undefined));
    expect(unnamed).toEqual([]);
  });

  it("leaves no run over 510 s between two tracked stops of a train at a served platform", async () => {
    // Act
    const tracked = await listTracked();

    // Assert
    const longRuns = tracked.flatMap(({ label, rows }) =>
      rows.flatMap(({ train, stops }) =>
        stops.slice(1).flatMap((stop, i) => {
          const from = stops[i];
          const runSec = secondsBetween(stop.arrivalAt, from?.departureAt ?? from?.arrivalAt ?? null);
          return runSec > MAX_UNOBSERVED_RUN_SEC ? [`${label} ${train.trainNo} ${from?.platformId}→${stop.platformId} ${runSec} s`] : [];
        }),
      ),
    );
    expect(longRuns).toEqual([]);
  });

  it("keeps each train at a served platform in view for 10 minutes before it, or from where it starts", async () => {
    // Act
    const tracked = await listTracked();

    // Assert
    const shortViews = tracked.flatMap(({ label, platform, rows }) =>
      rows.flatMap(({ train, stops }) => {
        const [first] = stops;
        const at = stops.find((stop) => stop.platformId === platform.id);
        if (!first || !at || first === at || first.arrivalAt === null || RUN_STARTS.includes(first.platformId)) return [];
        const viewSec = secondsBetween(at.arrivalAt ?? at.departureAt, first.arrivalAt);
        return viewSec < HORIZON_SEC ? [`${label} ${train.trainNo} from ${first.platformId} ${viewSec} s`] : [];
      }),
    );
    expect(shortViews).toEqual([]);
  });

  it("skips no station of the line between two tracked ones", async () => {
    // Act
    const tracked = await listTracked();

    // Assert
    const codeOf = (platformId: string): number => Number(platformId.slice(-2));
    const skipped = tracked.flatMap(({ label, tracked: stations }) =>
      stations.slice(1).flatMap((id, i) => {
        const before = stations[i] ?? "";
        const isAdjacent = Math.abs(codeOf(id) - codeOf(before)) === 1 || ADJACENT_ACROSS_CODES.some((pair) => [`${before} ${id}`, `${id} ${before}`].includes(pair));
        return isAdjacent ? [] : [`${label} ${before}→${id}`];
      }),
    );
    expect([...new Set(skipped)]).toEqual([]);
  });
});
