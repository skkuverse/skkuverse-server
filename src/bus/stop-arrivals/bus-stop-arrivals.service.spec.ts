/**
 * BusStopArrivalsService over the stop index (real, over in-memory stores) and scripted realtime and smart views
 * (unify-bus-stops design D7-D9 and D17; spec bus-stop-arrivals): an unknown stop is null; each served route at a
 * stop gets its entry, in the index's order and labeled in the request language; one page reads each group's view
 * and each service's smart schedule once; and a route whose read fails is left out of the page, logged at error at
 * most once a minute per route, while the rest is served.
 */
jest.mock("../../infra/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
import { storedBusRegistryService, storedJongroRouteDocuments } from "../../../__tests__/helpers/bus/bus-registry";
import { busStopsFixture, storedBusStopsRepository, storedBusStopsService } from "../../../__tests__/helpers/bus/bus-stops";
import { FakeBusEtaSmartService } from "../../../__tests__/helpers/fakes/bus/bus-eta-smart.service.fake";
import { FakeBusRealtimeGroupService } from "../../../__tests__/helpers/fakes/bus/bus-realtime-group.service.fake";
import { FakeBusRoutePathService } from "../../../__tests__/helpers/fakes/bus/bus-route-path.service.fake";
import { asReal } from "../../../__tests__/helpers/fakes/public-of";
import { logText } from "../../../__tests__/helpers/log-text";
import { AppError } from "../../http/app.error";
import type { Clock } from "../../infra/clock";
import logger from "../../infra/logger";
import type { BusEtaSmartService } from "../eta/smart/bus-eta-smart.service";
import type { BusRealtimeGroupService } from "../realtime/group/bus-realtime-group.service";
import type { BusRoutePathService } from "../route-path/bus-route-path.service";
import type { SmartSchedule } from "../schedule/bus-schedule.wire";
import { BusStopIndexService } from "../stop-index/bus-stop-index.service";
import { BusStopArrivalsService } from "./bus-stop-arrivals.service";

const AT_14_10_KST = new Date("2026-10-20T05:10:00.000Z");
const versionOf = (routeId: string) => storedJongroRouteDocuments().find((doc) => doc._id === routeId)!.stationsVersion;

function setup({ aliases = {} as Record<string, string[]> } = {}) {
  let now = AT_14_10_KST;
  const clock: Clock = { now: () => now };
  const data = busStopsFixture() as { stops: Array<{ id: string; arsIds?: string[] }> };
  for (const [stopId, arsIds] of Object.entries(aliases)) data.stops.find((stop) => stop.id === stopId)!.arsIds = arsIds;
  const stops = storedBusStopsService(storedBusStopsRepository(data), clock);
  const index = new BusStopIndexService(stops, storedBusRegistryService(), asReal<BusRoutePathService>(new FakeBusRoutePathService()), clock);
  const realtime = new FakeBusRealtimeGroupService();
  const smart = new FakeBusEtaSmartService();
  const service = new BusStopArrivalsService(index, asReal<BusRealtimeGroupService>(realtime), asReal<BusEtaSmartService>(smart), clock);
  const advanceMs = (ms: number) => {
    now = new Date(now.getTime() + ms);
  };
  return { service, realtime, smart, advanceMs };
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

  it("serves an aliased pole's shuttle runs, then its Jongno arrivals, labeled in the request language", async () => {
    // Arrange
    const { service, realtime, smart } = setup({ aliases: { "hssc-bus-lot": ["01618"] } });
    smart.schedules.set("campus-inja", activeSchedule("campus-inja", ["14:00", "14:30"]));
    realtime.views.set("jongro07", { buses: [], stationEtas: [], stationsVersion: versionOf("jongro07") });

    // Act
    const page = await service.findStopArrivals("seoul-01618", "en");

    // Assert
    expect(page?.stop).toMatchObject({ id: "hssc-bus-lot", name: "Student Union bus parking lot", arsIds: ["01618"] });
    expect(page?.routes).toEqual([
      expect.objectContaining({ groupId: "campus", label: "HSSC → NSC", routeType: "regular", next: [{ date: "2026-10-20", departure: "14:30", time: "14:30", estimated: false }] }),
      expect.objectContaining({ groupId: "campus", label: "HSSC → NSC", routeType: "hakbu" }),
      { groupId: "jongro07", kind: "arrivals", label: "Jongro 07", stationIndex: 1, towards: "비천당", stationsVersion: versionOf("jongro07"), arrivals: [] },
    ]);
  });

  it("reads each service's smart schedule and each group's view once per page", async () => {
    // Arrange
    const { service, realtime, smart } = setup({ aliases: { "hssc-bus-lot": ["01618"] } });
    smart.schedules.set("campus-inja", activeSchedule("campus-inja", ["14:30"]));
    realtime.views.set("jongro07", { buses: [], stationEtas: [], stationsVersion: versionOf("jongro07") });

    // Act
    await service.findStopArrivals("hssc-bus-lot", "ko");

    // Assert
    expect(smart.readServiceIds).toEqual(["campus-inja"]);
    expect(realtime.readGroupIds).toEqual(["jongro07"]);
  });

  it("serves the HSSC buses at or before the stop", async () => {
    // Arrange
    const { service, realtime } = setup();
    const bus = (stationIndex: number) => ({ stationIndex, carNumber: "0001", estimatedTime: 0, kind: "estimated" as const });
    realtime.views.set("hssc", { buses: [bus(1), bus(4), bus(8)], stationEtas: [] });

    // Act
    const page = await service.findStopArrivals("hssc-hyehwa-exit1", "zh");

    // Assert
    expect(page?.routes).toEqual([{ groupId: "hssc", kind: "approaching", label: "人文校区班车", stationIndex: 6, approaching: [{ stopsAway: 2 }, { stopsAway: 5 }] }]);
  });

  it("leaves out a route whose read fails, logged at error once a minute, and serves the rest", async () => {
    // Arrange
    const { service, realtime, advanceMs } = setup();
    realtime.failWith.set("jongro07", new AppError("JONGRO_ROUTE_ATTRIBUTES_UNAVAILABLE", "The Jongro route attributes are unavailable", 503));
    realtime.views.set("jongro08", { buses: [], stationEtas: [], stationsVersion: versionOf("jongro08") });

    // Act
    const page = await service.findStopArrivals("seoul-01592", "ko");
    await service.findStopArrivals("seoul-01592", "ko");
    advanceMs(60_000);
    await service.findStopArrivals("seoul-01592", "ko");

    // Assert
    expect(page?.stop.id).toBe("seoul-01592");
    expect(page?.routes.map((route) => route.groupId)).toEqual(["jongro08"]);
    expect(leftOutLogs()).toHaveLength(2);
    expect(logText(leftOutLogs()[0])).toContain("jongro07");
    expect((leftOutLogs()[1]![0] as { suppressed: number }).suppressed).toBe(1);
  });

  it("leaves out a group the realtime view does not serve", async () => {
    // Arrange
    const { service } = setup();

    // Act
    const page = await service.findStopArrivals("hssc-hyehwa-exit1", "ko");

    // Assert
    expect(page?.routes).toEqual([]);
    expect(logText(leftOutLogs()[0])).toContain("hssc");
  });

  it("leaves out a shuttle whose smart schedule cannot be read", async () => {
    // Arrange
    const { service, smart } = setup();
    smart.failWith.set("commute-jeongja", new AppError("BUS_SCHEDULE_UNAVAILABLE", "The bus schedule is unavailable", 503));

    // Act
    const page = await service.findStopArrivals("jeongja-exit3", "ko");

    // Assert
    expect(page?.stop.id).toBe("jeongja-exit3");
    expect(page?.routes).toEqual([]);
    expect(logText(leftOutLogs()[0])).toContain("commute-jeongja");
  });

  it("leaves out a Jongno entry, unlogged, when its view was placed by another stations version than the index", async () => {
    // Arrange
    const { service, realtime } = setup();
    realtime.views.set("jongro07", { buses: [], stationEtas: [], stationsVersion: "synced-since" });
    realtime.views.set("jongro08", { buses: [], stationEtas: [], stationsVersion: versionOf("jongro08") });

    // Act
    const page = await service.findStopArrivals("seoul-01592", "ko");

    // Assert
    expect(page?.routes.map((route) => route.groupId)).toEqual(["jongro08"]);
    expect(leftOutLogs()).toEqual([]);
  });
});
