/**
 * BusStopArrivalsService over the stop index (real, over in-memory stores) and a scripted live route and smart view:
 * an unknown stop is null; each served route at a
 * stop gets its entry, in the index's order and labeled in the request language, with the server's clock in meta
 * (ADR 0019, D12); one page reads each group's live answer
 * and each service's smart schedule once, and the week after it only when the shown week holds fewer than three runs
 * (review F2); a run at a drop-off is listed until the arrival of its latest estimate, read once per service, while
 * the page shows only the served one (ADR 0019, D12); and a route whose read fails is left out of the page, logged at
 * error at most once a minute per route, while the rest is served. A live entry's action is alight at an HSSC
 * position the data flags drop-off only and board elsewhere, and an HSSC entry's towards is the next stop's catalog
 * name in the request language, as that stop's own page names it, never the line row's name with its marker; the
 * HSSC entry served in zh therefore heads towards "SKKU Junction", the stop's English name, since it has no Chinese one.
 */
jest.mock("../../infra/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
import { storedBusRegistryService, storedJongroRouteDocuments } from "../../../__tests__/helpers/bus/bus-registry";
import { busStopsFixture, storedBusStopsRepository, storedBusStopsService } from "../../../__tests__/helpers/bus/bus-stops";
import { FakeBusEtaSmartService } from "../../../__tests__/helpers/fakes/bus/bus-eta-smart.service.fake";
import { FakeBusLiveGroupService } from "../../../__tests__/helpers/fakes/bus/bus-live-group.service.fake";
import { FakeBusRoutePathService } from "../../../__tests__/helpers/fakes/bus/bus-route-path.service.fake";
import { asReal } from "../../../__tests__/helpers/fakes/public-of";
import { logText } from "../../../__tests__/helpers/log-text";
import { AppError } from "../../http/app.error";
import type { Clock } from "../../infra/clock";
import logger from "../../infra/logger";
import type { BusEtaSmartService } from "../eta/smart/bus-eta-smart.service";
import type { BusLiveGroupService } from "../live/group/bus-live-group.service";
import type { LiveGroup } from "../live/bus-live.wire";
import type { BusRoutePathService } from "../route-path/bus-route-path.service";
import type { SmartSchedule } from "../schedule/bus-schedule.wire";
import { BusStopIndexService } from "../stop-index/bus-stop-index.service";
import { BusStopArrivalsService } from "./bus-stop-arrivals.service";
import type { TimetableEntry } from "./bus-stop-arrivals.types";

const AT_14_10_KST = new Date("2026-10-20T05:10:00.000Z");
const versionOf = (routeId: string) => storedJongroRouteDocuments().find((doc) => doc._id === routeId)!.stationsVersion;

function setup({ aliases = {} as Record<string, string[]>, alightOnlyIndexes = [] as number[] } = {}) {
  let now = AT_14_10_KST;
  const clock: Clock = { now: () => now };
  const data = busStopsFixture() as { stops: Array<{ id: string; arsIds?: string[] }>; hssc: { stations: Array<{ isAlightOnly?: boolean }> } };
  for (const [stopId, arsIds] of Object.entries(aliases)) data.stops.find((stop) => stop.id === stopId)!.arsIds = arsIds;
  for (const index of alightOnlyIndexes) data.hssc.stations[index]!.isAlightOnly = true;
  const stops = storedBusStopsService(storedBusStopsRepository(data), clock);
  const index = new BusStopIndexService(stops, storedBusRegistryService(), asReal<BusRoutePathService>(new FakeBusRoutePathService()), clock);
  const live = new FakeBusLiveGroupService();
  const smart = new FakeBusEtaSmartService();
  const service = new BusStopArrivalsService(index, asReal<BusLiveGroupService>(live), asReal<BusEtaSmartService>(smart), clock);
  const advanceMs = (ms: number) => {
    now = new Date(now.getTime() + ms);
  };
  return { service, live, smart, advanceMs };
}

const activeSchedule = (serviceId: string, times: string[]): SmartSchedule => ({
  serviceId,
  status: "active",
  from: "2026-10-19",
  selectedDate: "2026-10-20",
  days: [
    {
      date: "2026-10-20",
      dayOfWeek: 2,
      display: "visible",
      notices: [],
      schedule: times.flatMap((time) => [
        { time, routeType: "regular", stopTimes: [time, null] },
        { time, routeType: "hakbu", stopTimes: [time, null] },
      ]),
    },
  ],
});

const dayOf = (date: string, times: string[]): SmartSchedule["days"][number] => ({
  date,
  dayOfWeek: 1,
  display: "schedule",
  notices: [],
  schedule: times.map((time) => ({ time, routeType: "regular", stopTimes: [time, null] })),
});

const liveGroup = (groupId: string, extra: Partial<LiveGroup> = {}): LiveGroup => ({
  groupId,
  stationsVersion: groupId === "hssc" ? null : versionOf(groupId),
  updatedAt: null,
  operation: "noData",
  vehicles: [],
  stations: [],
  ...extra,
});

const leftOutLogs = () => jest.mocked(logger.error).mock.calls.filter((call) => (call[0] as { event?: string }).event === "bus.stop_arrivals.route_left_out");

beforeEach(() => {
  jest.clearAllMocks();
});

describe("BusStopArrivalsService.findStopArrivals", () => {
  it("answers null for a stop the index does not hold", async () => {
    // Arrange
    const { service } = setup();

    // Act & Assert
    expect(await service.findStopArrivals("seoul-99999", "ko")).toBeNull();
  });

  it("serves an aliased pole's shuttle runs, then its Jongno live entry, labeled in the request language", async () => {
    // Arrange
    const { service, live, smart } = setup({ aliases: { "hssc-bus-lot": ["01618"] } });
    smart.schedules.set("campus-inja", activeSchedule("campus-inja", ["14:00", "14:30"]));
    live.groups.set("jongro07", liveGroup("jongro07"));

    // Act
    const page = await service.findStopArrivals("seoul-01618", "en");

    // Assert
    expect(page?.meta).toEqual({ serverNow: "2026-10-20T14:10:00+09:00" });
    expect(page?.data.stop).toMatchObject({ id: "hssc-bus-lot", name: "Student Union bus parking lot", arsIds: ["01618"] });
    expect(page?.data.routes).toEqual([
      expect.objectContaining({
        kind: "timetable",
        groupId: "campus",
        label: "HSSC → NSC",
        routeType: "regular",
        operation: "running",
        vehicles: [],
        arrivals: [expect.objectContaining({ status: "scheduled", scheduledDepartureAt: "2026-10-20T14:30:00+09:00", runDepartureAt: "2026-10-20T14:30:00+09:00", isLastBus: true })],
      }),
      expect.objectContaining({ kind: "timetable", groupId: "campus", label: "HSSC → NSC", routeType: "hakbu" }),
      { kind: "live", groupId: "jongro07", label: "Jongro 07", stationIndex: 1, towards: "비천당", action: "board", stationsVersion: versionOf("jongro07"), updatedAt: null, operation: "noData", vehicles: [], arrivals: [] },
    ]);
  });

  it("reads each service's smart schedule and each group's live answer once per page", async () => {
    // Arrange
    const { service, live, smart } = setup({ aliases: { "hssc-bus-lot": ["01618"] } });
    smart.schedules.set("campus-inja", activeSchedule("campus-inja", ["14:30"]));
    live.groups.set("jongro07", liveGroup("jongro07"));

    // Act
    await service.findStopArrivals("hssc-bus-lot", "ko");

    // Assert
    expect(smart.readServiceIds).toEqual(["campus-inja"]);
    expect(live.readGroupIds).toEqual(["jongro07"]);
  });

  // WHY: the page is no-store, so the smart view's ETag would be a JSON.stringify and an md5 per service per request (review F5).
  it("reads each smart schedule without the smart view's ETag", async () => {
    // Arrange
    const { service, smart } = setup();
    smart.schedules.set("campus-inja", activeSchedule("campus-inja", ["14:30"]));

    // Act
    await service.findStopArrivals("hssc-bus-lot", "ko");

    // Assert
    expect(smart.readServiceIds).toEqual(["campus-inja"]);
    expect(smart.etagReadServiceIds).toEqual([]);
  });

  it("serves the HSSC line's station entry, heading towards the next station with a stop past the rotary", async () => {
    // Arrange
    const { service, live } = setup();
    const arrival = { status: "enRoute" as const, expectedArrivalAt: "2026-10-20T14:12:00+09:00", expectedDepartureAt: null, scheduledArrivalAt: null, scheduledDepartureAt: null, basis: "estimate" as const, stopsAway: 2, isLastBus: null, vehicleId: "32149", providerText: null };
    const bus = { id: "32149", plateNumber: null, occupancy: null, isLastBus: null, isLowFloor: null, position: null, trajectory: null };
    live.groups.set("hssc", liveGroup("hssc", { operation: "running", vehicles: [bus, { ...bus, id: "32150" }], stations: [{ stationIndex: 6, stopId: "hssc-hyehwa-exit1", arsId: null, operation: "running", arrivals: [arrival] }] }));

    // Act
    const page = await service.findStopArrivals("hssc-hyehwa-exit1", "zh");

    // Assert
    expect(page?.data.routes).toEqual([
      { kind: "live", groupId: "hssc", label: "人文校区班车", stationIndex: 6, towards: "SKKU Junction", action: "board", stationsVersion: null, updatedAt: null, operation: "running", vehicles: [bus], arrivals: [arrival] },
    ]);
  });

  it("serves the HSSC entry at a position the data flags drop-off only with action alight", async () => {
    // Arrange
    const { service, live } = setup({ alightOnlyIndexes: [3, 4] });
    live.groups.set("hssc", liveGroup("hssc"));

    // Act
    const [olympicHall, postOffice, gate] = await Promise.all(["hssc-olympic-hall", "hssc-hyehwa-post-office", "hssc-main-gate-out"].map((id) => service.findStopArrivals(id, "ko")));

    // Assert
    expect(olympicHall?.data.routes).toEqual([expect.objectContaining({ kind: "live", stationIndex: 3, action: "alight" })]);
    expect(postOffice?.data.routes).toEqual([expect.objectContaining({ kind: "live", stationIndex: 4, action: "alight" })]);
    expect(gate?.data.routes).toEqual([expect.objectContaining({ kind: "live", stationIndex: 2, action: "board" })]);
  });

  it("names an HSSC entry's next stop as its catalog stop in the request language, not by the line row's 하차전용 marker", async () => {
    // Arrange
    const { service, live } = setup();
    live.groups.set("hssc", liveGroup("hssc"));

    // Act
    const [ko, en, zh] = await Promise.all((["ko", "en", "zh"] as const).map((lang) => service.findStopArrivals("hssc-main-gate-out", lang)));

    // Assert
    expect(ko?.data.routes).toEqual([expect.objectContaining({ stationIndex: 2, towards: "올림픽기념국민생활관" })]);
    expect(en?.data.routes).toEqual([expect.objectContaining({ towards: "Olympic Hall" })]);
    expect(zh?.data.routes).toEqual([expect.objectContaining({ towards: "Olympic Hall" })]);
  });

  it("continues into the following week when the shown week holds fewer than three runs", async () => {
    // Arrange
    const { service, smart } = setup();
    smart.schedules.set("campus-inja", activeSchedule("campus-inja", ["14:00", "14:30"]));
    smart.followingWeeks.set("campus-inja", [dayOf("2026-10-26", ["14:00", "14:30", "15:00"])]);

    // Act
    const page = await service.findStopArrivals("hssc-bus-lot", "ko");

    // Assert
    const regular = page?.data.routes.find((route): route is TimetableEntry => route.kind === "timetable" && route.routeType === "regular");
    expect(regular?.arrivals.map((arrival) => arrival.runDepartureAt)).toEqual(["2026-10-20T14:30:00+09:00", "2026-10-26T14:00:00+09:00", "2026-10-26T14:30:00+09:00"]);
    expect(smart.followingReadServiceIds).toEqual(["campus-inja"]);
  });

  it("reads no following week while the shown week holds three runs at every route type of the stop", async () => {
    // Arrange
    const { service, smart } = setup();
    smart.schedules.set("campus-inja", activeSchedule("campus-inja", ["14:30", "15:00", "15:30"]));

    // Act
    await service.findStopArrivals("hssc-bus-lot", "ko");

    // Assert
    expect(smart.followingReadServiceIds).toEqual([]);
  });

  it("reads no following week for a schedule that is not active, whose entries are suspended with no run", async () => {
    // Arrange
    const { service, smart } = setup();
    smart.schedules.set("campus-inja", { serviceId: "campus-inja", status: "suspended", resumeDate: "2026-11-02", from: null, selectedDate: null, days: [] });

    // Act
    const page = await service.findStopArrivals("hssc-bus-lot", "ko");

    // Assert
    expect(page?.data.routes.map((route) => [route.operation, route.arrivals])).toEqual([
      ["suspended", []],
      ["suspended", []],
    ]);
    expect(smart.followingReadServiceIds).toEqual([]);
  });

  // WHY: the smart view stops serving a live value 15 minutes after its fetch, while the bus is still on the road.
  it("lists a run at a drop-off until its latest estimate's arrival, reading it once per service, and shows no time", async () => {
    // Arrange
    const { service, smart } = setup();
    smart.schedules.set("campus-inja", activeSchedule("campus-inja", ["14:00", "14:30"]));
    const latest = activeSchedule("campus-inja", ["14:00", "14:30"]);
    latest.days[0]!.schedule[0] = { time: "14:00", routeType: "regular", stopTimes: ["14:00", "15:10"], eta: { source: "live", updatedAt: "2026-10-20T04:50:00.000Z" } };
    smart.latestSchedules.set("campus-inja", latest);

    // Act
    const page = await service.findStopArrivals("nsc-n-center", "ko");

    // Assert
    const regular = page?.data.routes.find((route): route is TimetableEntry => route.kind === "timetable" && route.serviceId === "campus-inja" && route.routeType === "regular");
    expect(regular?.arrivals.map(({ runDepartureAt, expectedArrivalAt, scheduledArrivalAt }) => [runDepartureAt, expectedArrivalAt, scheduledArrivalAt])).toEqual([
      ["2026-10-20T14:30:00+09:00", null, null],
      ["2026-10-20T14:00:00+09:00", null, null],
    ]);
    expect(smart.latestReadServiceIds.filter((serviceId) => serviceId === "campus-inja")).toEqual(["campus-inja"]);
  });

  it("leaves out a route whose read fails, logged at error once a minute, and serves the rest", async () => {
    // Arrange
    const { service, live, advanceMs } = setup();
    live.failWith.set("jongro07", new AppError("JONGRO_ROUTE_ATTRIBUTES_UNAVAILABLE", "The Jongro route attributes are unavailable", 503));
    live.groups.set("jongro08", liveGroup("jongro08"));

    // Act
    const page = await service.findStopArrivals("seoul-01592", "ko");
    await service.findStopArrivals("seoul-01592", "ko");
    advanceMs(60_000);
    await service.findStopArrivals("seoul-01592", "ko");

    // Assert
    expect(page?.data.stop.id).toBe("seoul-01592");
    expect(page?.data.routes.map((route) => route.groupId)).toEqual(["jongro08"]);
    expect(leftOutLogs()).toHaveLength(2);
    expect(logText(leftOutLogs()[0])).toContain("jongro07");
    expect((leftOutLogs()[1]![0] as { suppressed: number }).suppressed).toBe(1);
  });

  it("leaves out a group the live route does not serve", async () => {
    // Arrange
    const { service } = setup();

    // Act
    const page = await service.findStopArrivals("hssc-hyehwa-exit1", "ko");

    // Assert
    expect(page?.data.routes).toEqual([]);
    expect(logText(leftOutLogs()[0])).toContain("hssc");
  });

  it("leaves out a shuttle whose smart schedule cannot be read", async () => {
    // Arrange
    const { service, smart } = setup();
    smart.failWith.set("commute-jeongja", new AppError("BUS_SCHEDULE_UNAVAILABLE", "The bus schedule is unavailable", 503));

    // Act
    const page = await service.findStopArrivals("jeongja-exit3", "ko");

    // Assert
    expect(page?.data.stop.id).toBe("jeongja-exit3");
    expect(page?.data.routes).toEqual([]);
    expect(logText(leftOutLogs()[0])).toContain("commute-jeongja");
  });

  it("leaves out a Jongno entry, unlogged, when its live answer was placed by another stations version than the index", async () => {
    // Arrange
    const { service, live } = setup();
    live.groups.set("jongro07", liveGroup("jongro07", { stationsVersion: "synced-since" }));
    live.groups.set("jongro08", liveGroup("jongro08"));

    // Act
    const page = await service.findStopArrivals("seoul-01592", "ko");

    // Assert
    expect(page?.data.routes.map((route) => route.groupId)).toEqual(["jongro08"]);
    expect(leftOutLogs()).toEqual([]);
  });
});
