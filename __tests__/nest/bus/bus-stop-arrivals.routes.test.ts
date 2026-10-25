/**
 * Integration over BusStopArrivalsController (GET /bus/stops/:stopId/arrivals)
 * through the production pipeline (buildTestApp): the stop block,
 * 404 BUS_STOP_NOT_FOUND, the configuration order, a live entry equal to the live route's station entry (ADR 0019,
 * D12), a Jongno route left out, the HSSC buses' estimates, the next three shuttle runs at a stop as scheduled
 * arrivals (14:10 KST, and 01:30 KST when the UTC date is the day before), continued into the following week after
 * Friday's last run, a suspended service, a live entry's `action` (alight at an HSSC position the data flags drop-off
 * only, board elsewhere) and its `towards` named as the next stop's own page names it, its `direction` (the 방면 its
 * /bus/config station lies on: 종로07's and 종로08's TOPIS terminals at a shared pole, the HSSC line's 하교), the
 * 503 with the stops never read, no-store, and no outbound request. Every `stopId` a
 * realtime station of `/bus/config` serves opens a page that lists that group at the station's first index, an
 * aliased pole's included.
 *
 * Every store is in memory: bus_cache, the registry and route lines production stored (helpers/bus/), revision 1
 * of `bus-stops`, `jongro-route-attributes` and the schedule content, a timetable and estimates seeded per test.
 * The pollers never start (ROLE=api) and the clock is fixed, so each test boots its own app.
 */
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { BusModule } from "../../../src/bus/bus.module";
import { BusCacheModule } from "../../../src/bus/cache/bus-cache.module";
import { BusCacheRepository } from "../../../src/bus/cache/bus-cache.repository";
import { BusConfigModule } from "../../../src/bus/config/bus-config.module";
import type { ShuttleEtaDoc } from "../../../src/bus/eta/bus-eta.document";
import { BusEtaModule } from "../../../src/bus/eta/bus-eta.module";
import { BusEtaRepository } from "../../../src/bus/eta/bus-eta.repository";
import { BusEtaSmartModule } from "../../../src/bus/eta/smart/bus-eta-smart.module";
import { BusLiveGroupModule } from "../../../src/bus/live/group/bus-live-group.module";
import { BusLiveHsscModule } from "../../../src/bus/live/hssc/bus-live-hssc.module";
import { BusLiveJongroModule } from "../../../src/bus/live/jongro/bus-live-jongro.module";
import { BusLiveModule } from "../../../src/bus/live/bus-live.module";
import { BusRealtimeArrivalModule } from "../../../src/bus/realtime/arrival/bus-realtime-arrival.module";
import { BusRealtimeModule } from "../../../src/bus/realtime/bus-realtime.module";
import { BusRealtimeGroupModule } from "../../../src/bus/realtime/group/bus-realtime-group.module";
import { BusRealtimeHsscClient } from "../../../src/bus/realtime/hssc/bus-realtime-hssc.client";
import { BusRealtimeHsscModule } from "../../../src/bus/realtime/hssc/bus-realtime-hssc.module";
import { BusRealtimeHsscEtaModule } from "../../../src/bus/realtime/hssc-eta/bus-realtime-hssc-eta.module";
import { BusRealtimeJongroClient } from "../../../src/bus/realtime/jongro/bus-realtime-jongro.client";
import { BusRealtimeJongroModule } from "../../../src/bus/realtime/jongro/bus-realtime-jongro.module";
import { BusRegistryModule } from "../../../src/bus/registry/bus-registry.module";
import { BusRegistryRepository } from "../../../src/bus/registry/bus-registry.repository";
import { BusRouteAttributesModule } from "../../../src/bus/route-attributes/bus-route-attributes.module";
import { BusRouteAttributesRepository } from "../../../src/bus/route-attributes/bus-route-attributes.repository";
import { BusRoutePathClient } from "../../../src/bus/route-path/bus-route-path.client";
import { BusRoutePathModule } from "../../../src/bus/route-path/bus-route-path.module";
import { BusRoutePathRepository } from "../../../src/bus/route-path/bus-route-path.repository";
import { BusScheduleContentModule } from "../../../src/bus/schedule-content/bus-schedule-content.module";
import { BusScheduleContentRepository } from "../../../src/bus/schedule-content/bus-schedule-content.repository";
import { BusScheduleModule } from "../../../src/bus/schedule/bus-schedule.module";
import { BusScheduleRepository } from "../../../src/bus/schedule/bus-schedule.repository";
import { BusStopArrivalsModule } from "../../../src/bus/stop-arrivals/bus-stop-arrivals.module";
import { busStopArrivals, busStopArrivalsMeta } from "../../../src/bus/stop-arrivals/bus-stop-arrivals.wire";
import { BusStopIndexModule } from "../../../src/bus/stop-index/bus-stop-index.module";
import { BusStopsModule } from "../../../src/bus/stops/bus-stops.module";
import { BusStopsRepository } from "../../../src/bus/stops/bus-stops.repository";
import { CalendarRepository } from "../../../src/calendar/calendar.repository";
import { Clock } from "../../../src/infra/clock";
import { SchedulingModule } from "../../../src/scheduling/scheduling.module";
import { hsscBusDoc, jongroArrivalBus, jongroArrivalDoc, jongroPositionDoc } from "../../helpers/bus/bus-cache-docs";
import { storedBusRegistryRepository } from "../../helpers/bus/bus-registry";
import { storedBusRoutePathRepository } from "../../helpers/bus/bus-route-path";
import { busStopsFixture, storedBusStopsRepository } from "../../helpers/bus/bus-stops";
import { storedRouteAttributesRepository } from "../../helpers/bus/route-attributes";
import { serviceNoticesWithSuspension, storedScheduleContentRepository } from "../../helpers/bus/schedule-content";
import { expectWire } from "../../helpers/contracts/expect-wire";
import { FakeBusCacheRepository } from "../../helpers/fakes/bus/bus-cache.repository.fake";
import { FakeBusEtaRepository } from "../../helpers/fakes/bus/bus-eta.repository.fake";
import { FakeBusRealtimeHsscClient } from "../../helpers/fakes/bus/bus-realtime-hssc.client.fake";
import { FakeBusRealtimeJongroClient } from "../../helpers/fakes/bus/bus-realtime-jongro.client.fake";
import { FakeBusRouteAttributesRepository } from "../../helpers/fakes/bus/bus-route-attributes.repository.fake";
import { FakeBusRoutePathClient } from "../../helpers/fakes/bus/bus-route-path.client.fake";
import { FakeBusScheduleRepository } from "../../helpers/fakes/bus/bus-schedule.repository.fake";
import { FakeBusStopsRepository } from "../../helpers/fakes/bus/bus-stops.repository.fake";
import { storedCalendarRepository } from "../../helpers/calendar/rest-days";
import { buildTestApp } from "../../helpers/nest/build-test-app";
import { takeBlockedConnections } from "../../helpers/network-guard";

// WHY: Tuesday 2026-10-20 14:10 KST, the "Boarding stop" test's instant.
const AT_14_10_KST = new Date("2026-10-20T05:10:00.000Z");
// WHY: 20:00 KST on Friday 2026-10-23, after the week's last run (review F2).
const AT_FRIDAY_20_00_KST = new Date("2026-10-23T11:00:00.000Z");
// WHY: 01:30 KST on Tuesday the 20th, when the UTC date is still Monday the 19th.
const AT_01_30_KST = new Date("2026-10-19T16:30:00.000Z");

const run = (index: number, time: string, routeType = "regular") => ({ index, time, routeType, busCount: 1, notes: null, stopTimes: [time, null] });
// WHY: the 인자셔틀 every weekday at 14:00-15:30 and 17:00, and its 학부대학 run on Fridays at 13:00.
const CAMPUS_INJA_PATTERNS = [
  { serviceId: "campus-inja", patternId: "weekday", days: [1, 2, 3, 4, 5], entries: [run(1, "14:00"), run(2, "14:30"), run(3, "15:00"), run(4, "15:30"), run(5, "17:00")] },
  { serviceId: "campus-inja", patternId: "friday-hakbu", days: [5], entries: [run(1, "13:00", "hakbu")] },
];

interface Stores {
  busCache: FakeBusCacheRepository;
  registry: ReturnType<typeof storedBusRegistryRepository>;
  stops: FakeBusStopsRepository;
  attributes: FakeBusRouteAttributesRepository;
  timetable: FakeBusScheduleRepository;
  estimates: FakeBusEtaRepository;
  content: ReturnType<typeof storedScheduleContentRepository>;
  jongroClient: FakeBusRealtimeJongroClient;
  routePathClient: FakeBusRoutePathClient;
}

function freshStores(): Stores {
  const timetable = new FakeBusScheduleRepository();
  timetable.patterns = structuredClone(CAMPUS_INJA_PATTERNS);
  return {
    busCache: new FakeBusCacheRepository(),
    registry: storedBusRegistryRepository(),
    stops: storedBusStopsRepository(),
    attributes: storedRouteAttributesRepository(),
    timetable,
    estimates: new FakeBusEtaRepository(),
    content: storedScheduleContentRepository(),
    jongroClient: new FakeBusRealtimeJongroClient(),
    routePathClient: new FakeBusRoutePathClient(),
  };
}

let app: NestExpressApplication | undefined;

async function boot(stores: Stores, now = AT_14_10_KST): Promise<import("http").Server> {
  app = await buildTestApp({
    imports: [
      SchedulingModule,
      BusModule,
      BusCacheModule,
      BusRegistryModule,
      BusRouteAttributesModule,
      BusRoutePathModule,
      BusRealtimeModule,
      BusRealtimeHsscModule,
      BusRealtimeJongroModule,
      BusRealtimeArrivalModule,
      BusRealtimeGroupModule,
      BusRealtimeHsscEtaModule,
      BusStopsModule,
      BusScheduleContentModule,
      BusScheduleModule,
      BusEtaModule,
      BusEtaSmartModule,
      BusConfigModule,
      BusLiveModule,
      BusLiveJongroModule,
      BusLiveHsscModule,
      BusLiveGroupModule,
      BusStopIndexModule,
      BusStopArrivalsModule,
    ],
    overrides: [
      { provide: BusCacheRepository, useValue: stores.busCache },
      { provide: BusRegistryRepository, useValue: stores.registry },
      { provide: BusRouteAttributesRepository, useValue: stores.attributes },
      { provide: BusRoutePathRepository, useValue: storedBusRoutePathRepository() },
      { provide: BusRoutePathClient, useValue: stores.routePathClient },
      { provide: BusRealtimeHsscClient, useValue: new FakeBusRealtimeHsscClient() },
      { provide: BusRealtimeJongroClient, useValue: stores.jongroClient },
      { provide: BusStopsRepository, useValue: stores.stops },
      { provide: BusScheduleRepository, useValue: stores.timetable },
      { provide: BusScheduleContentRepository, useValue: stores.content },
      { provide: BusEtaRepository, useValue: stores.estimates },
      { provide: CalendarRepository, useValue: storedCalendarRepository() },
      { provide: Clock, useValue: { now: () => new Date(now) } },
    ],
    role: "api",
  });
  return app.getHttpServer();
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

/** `bus-stops` revision 1 with `stopId` aliasing `arsIds`. */
function aliased(stopId: string, arsIds: string[]): unknown {
  const data = busStopsFixture() as { stops: Array<{ id: string; arsIds?: string[] }> };
  data.stops.find((stop) => stop.id === stopId)!.arsIds = arsIds;
  return data;
}

/** A live estimate of a campus-inja regular run on 2026-10-20, fetched five minutes before 14:10 KST. */
function liveEstimate(time: string, offsetsSec: number[]): ShuttleEtaDoc {
  return {
    _id: `campus-inja|regular|2026-10-20|${time}|live`,
    kind: "live",
    serviceId: "campus-inja",
    routeType: "regular",
    date: "2026-10-20",
    time,
    departAt: new Date(`2026-10-20T${time}:00+09:00`),
    offsetsSec,
    source: "naver",
    fetchedAt: new Date(AT_14_10_KST.getTime() - 5 * 60_000),
    expiresAt: new Date("2026-10-21T00:00:00.000Z"),
  };
}

type Route = { groupId: string; kind: string; [key: string]: unknown };
const routesOf = (body: { data: { routes: Route[] } }) => body.data.routes;

type RunArrival = Record<string, string | null> & { runDepartureAt: string; basis: string };
/** Each run of a timetable entry as its departure, its time at this stop (whichever instant it carries) and its basis. */
const runsOf = (entry: Route | undefined) =>
  (entry!.arrivals as RunArrival[]).map((arrival) => [
    arrival.runDepartureAt,
    arrival.scheduledDepartureAt ?? arrival.expectedDepartureAt ?? arrival.scheduledArrivalAt ?? arrival.expectedArrivalAt,
    arrival.basis,
  ]);
const kst = (date: string, time: string) => `${date}T${time}:00+09:00`;
const withoutLang = ({ lang: _lang, ...meta }: { lang?: string }) => meta;

// An HSSC bus as the poller caches it: the feed's row with its event at a KST time on the 20th, and its linear sequence.
function hsscBus(lineNo: string, seq: number, inout: string, kstTime: string) {
  const [hour, minute, second] = kstTime.split(":").map(Number) as [number, number, number];
  const clock = `${hour < 12 ? "오전" : "오후"} ${hour % 12 || 12}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`;
  return hsscBusDoc({ line_no: lineNo, seq: String(seq), inout, sequence: String(seq >= 5 ? seq - 4 : seq + 7), get_date: `2026-10-20 ${clock}`, eventDate: `2026-10-20 ${kstTime}` });
}

describe("GET /bus/stops/:stopId/arrivals: the stop block", () => {
  it("Shared Jongno pole: 200, no-store, the pole with its route line's coordinates, and 종로07 then 종로08", async () => {
    // Arrange
    const server = await boot(freshStores());

    // Act
    const res = await request(server).get("/bus/stops/seoul-01592/arrivals");

    // Assert
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    // WHY: serverNow is what ADR 0019 adds to meta, a deliberate change of this pin.
    expect(res.body.meta).toEqual({ lang: "ko", serverNow: "2026-10-20T14:10:00+09:00" });
    expect(res.body.data.stop).toEqual({ id: "100900075", name: "혜화역1번출구", coords: { lat: 37.5834729904, lng: 127.0017632862 }, arsIds: ["01592"], stopAreaId: null });
    expect(routesOf(res.body).map((route) => [route.groupId, route.kind, route.stationIndex, route.towards])).toEqual([
      ["jongro07", "live", 16, "혜화동로터리"],
      ["jongro08", "live", 22, "혜화동로터리"],
    ]);
    expectWire(busStopArrivals, res.body.data);
    expectWire(busStopArrivalsMeta, withoutLang(res.body.meta));
  });

  it("Catalog stop: the stop equals its /bus/config/commute record in en, without map", async () => {
    // Arrange
    const server = await boot(freshStores());
    const config = await request(server).get("/bus/config/commute").set("Accept-Language", "en");
    const record = config.body.data.screen.stops.find((stop: { id: string }) => stop.id === "jeongja-exit3");

    // Act
    const res = await request(server).get("/bus/stops/jeongja-exit3/arrivals").set("Accept-Language", "en");

    // Assert
    expect(res.status).toBe(200);
    expect(record).toBeDefined();
    expect(res.body.data.stop).toEqual({ ...record, stopAreaId: null });
    expect(res.body.data.stop).not.toHaveProperty("map");
    expect(res.body.data.stop.name).toBe("Jeongja Stn. Exit 3");
    expectWire(busStopArrivals, res.body.data);
  });

  it("Jongno pole name: the stored Korean TOPIS name in zh", async () => {
    // Arrange
    const server = await boot(freshStores());

    // Act
    const res = await request(server).get("/bus/stops/seoul-01881/arrivals").set("Accept-Language", "zh");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.data.stop.name).toBe("성균관대학교");
    expect(routesOf(res.body)).toEqual([expect.objectContaining({ groupId: "jongro02", stationIndex: 0, towards: "서울성곽.성대후문", label: "钟路 02" })]);
    expectWire(busStopArrivals, res.body.data);
  });

  it("an HSSC stop: its name in the request language and no coordinates", async () => {
    // Arrange
    const data = busStopsFixture() as { stops: Array<Record<string, unknown>> };
    delete data.stops.find((stop) => stop.id === "hssc-hyehwa-exit1")!.coords;
    const server = await boot({ ...freshStores(), stops: storedBusStopsRepository(data) });

    // Act
    const res = await request(server).get("/bus/stops/hssc-hyehwa-exit1/arrivals").set("Accept-Language", "en");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.data.stop).toEqual({ id: "hssc-hyehwa-exit1", name: "Hyehwa Station (Shuttle Bus Stop)", stopAreaId: null });
    expectWire(busStopArrivals, res.body.data);
  });

  it("Stop area: a member's page names the area, reached by its own id and by its aliased pole's, and keeps its own routes", async () => {
    // Arrange
    const data = busStopsFixture() as Record<string, unknown> & { stops: Array<{ id: string; arsIds?: string[] }> };
    data.stops.find((stop) => stop.id === "hssc-bus-lot")!.arsIds = ["01618"];
    data.stopAreas = [{ id: "hssc-lot", name: { ko: "학생회관" }, stopIds: ["seoul-01618", "hssc-600th"] }];
    const server = await boot({ ...freshStores(), stops: storedBusStopsRepository(data) });

    // Act
    const bySlug = await request(server).get("/bus/stops/hssc-bus-lot/arrivals");
    const byPole = await request(server).get("/bus/stops/seoul-01618/arrivals");
    const other = await request(server).get("/bus/stops/hssc-600th/arrivals");

    // Assert
    expect([bySlug.body.data.stop.stopAreaId, byPole.body.data.stop.stopAreaId, other.body.data.stop.stopAreaId]).toEqual(["hssc-lot", "hssc-lot", "hssc-lot"]);
    expect(bySlug.body.data.stop.id).toBe("hssc-bus-lot");
    expect(other.body.data.stop.id).toBe("hssc-600th");
    expectWire(busStopArrivals, bySlug.body.data);
  });
});

describe("GET /bus/stops/:stopId/arrivals: unknown stops", () => {
  it.each([
    ["seoul-99999", "Bus stop seoul-99999 is not served"],
    ["Seoul_01592", "stopId must be a stop id: lower-case letters and digits in words joined by single hyphens"],
  ])("%s → 404 BUS_STOP_NOT_FOUND, no Cache-Control", async (stopId, message) => {
    // Arrange
    const server = await boot(freshStores());

    // Act
    const res = await request(server).get(`/bus/stops/${stopId}/arrivals`);

    // Assert
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: "BUS_STOP_NOT_FOUND", message } });
    expect(res.headers["cache-control"]).toBeUndefined();
  });
});

describe("GET /bus/stops/:stopId/arrivals: routes in configuration order", () => {
  it("Shuttle and Jongno at one stop: an aliased pole lists the 인자셔틀's regular and hakbu runs, then 종로07", async () => {
    // Arrange
    const stores = freshStores();
    stores.stops.storeStops(aliased("hssc-bus-lot", ["01618"]));
    const server = await boot(stores);

    // Act
    const byPole = await request(server).get("/bus/stops/seoul-01618/arrivals");
    const bySlug = await request(server).get("/bus/stops/hssc-bus-lot/arrivals");

    // Assert
    expect(byPole.status).toBe(200);
    expect(byPole.body.data.stop).toMatchObject({ id: "hssc-bus-lot", arsIds: ["01618"] });
    expect(routesOf(byPole.body).map((route) => [route.groupId, route.kind, route.serviceId ?? null, route.routeType ?? null])).toEqual([
      ["campus", "timetable", "campus-inja", "regular"],
      ["campus", "timetable", "campus-inja", "hakbu"],
      ["jongro07", "live", null, null],
    ]);
    expect(bySlug.body.data).toEqual(byPole.body.data);
    expectWire(busStopArrivals, byPole.body.data);
  });

  it("Nearby but not confirmed: hssc-600th and 100900219 are two stops with two pages", async () => {
    // Arrange
    const server = await boot(freshStores());

    // Act
    const local = await request(server).get("/bus/stops/hssc-600th/arrivals");
    const pole = await request(server).get("/bus/stops/seoul-01616/arrivals");

    // Assert
    expect(routesOf(local.body).map((route) => route.groupId)).toEqual(["campus", "campus"]);
    expect(routesOf(pole.body).map((route) => route.groupId)).toEqual(["jongro07"]);
    expect(pole.body.data.stop.id).toBe("100900219");
  });
});

describe("GET /bus/stops/:stopId/arrivals: Jongno entries", () => {
  it("Same as the live route: the 종로07 entry carries the live route's station entry at index 16 and the vehicles it names", async () => {
    // Arrange
    const stores = freshStores();
    const station = { stationId: "100900075", sequence: "17", stationName: "혜화역1번출구", stationNumber: "01592" };
    stores.busCache.values.set("jongro_stations_07", [
      jongroArrivalDoc({
        ...station,
        eventDate: "2026-10-20 14:09:40.0",
        eta: "4분10초후[2번째 전]",
        buses: [
          jongroArrivalBus({ staOrd: 17, sectOrd: 15, traTime: 250, arrmsg: "4분10초후[2번째 전]", vehId: "100000201", plainNo: "서울74사2701" }),
          jongroArrivalBus({ staOrd: 17, sectOrd: 1, traTime: 1500, arrmsg: "25분후[16번째 전]", vehId: "100000202", plainNo: "서울74사2702" }),
        ],
      }),
    ]);
    stores.busCache.values.set("jongro_locations_07", [
      jongroPositionDoc({ sequence: "15", stationId: "100000123", vehicleId: "100000201", carNumber: "2701", plainNo: "서울74사2701" }),
      jongroPositionDoc({ sequence: "1", stationId: "100900220", vehicleId: "100000202", carNumber: "2702", plainNo: "서울74사2702", isStationary: true }),
      jongroPositionDoc({ sequence: "20", stationId: "100900099", vehicleId: "100000203", carNumber: "2703", plainNo: "서울74사2703" }),
    ]);
    const server = await boot(stores);
    const live = await request(server).get("/bus/live/jongro07");
    const liveStation = live.body.data.stations.find((candidate: { stationIndex: number }) => candidate.stationIndex === 16);

    // Act
    const res = await request(server).get("/bus/stops/seoul-01592/arrivals");

    // Assert
    const entry = routesOf(res.body).find((route) => route.groupId === "jongro07")!;
    expect(entry).toEqual({
      kind: "live",
      groupId: "jongro07",
      label: "종로 07",
      stationIndex: 16,
      towards: "혜화동로터리",
      direction: { id: "100900220", label: "성균관대운동장 방면" },
      action: "board",
      stationsVersion: live.body.data.stationsVersion,
      updatedAt: live.body.data.updatedAt,
      operation: liveStation.operation,
      vehicles: live.body.data.vehicles.filter((vehicle: { id: string }) => vehicle.id !== "100000203"),
      arrivals: liveStation.arrivals,
    });
    // WHY: the second bus idles at the origin, so its arrival waits to depart, as the realtime view's waiting rewrite reads it.
    expect(entry.arrivals).toMatchObject([
      { status: "enRoute", expectedArrivalAt: "2026-10-20T14:13:50+09:00", vehicleId: "100000201", basis: "provider" },
      { status: "waitingToDepart", expectedArrivalAt: null, vehicleId: "100000202" },
    ]);
    expect(routesOf(res.body).find((route) => route.groupId === "jongro08")).toMatchObject({ stationIndex: 22, operation: "noData", arrivals: [] });
    expectWire(busStopArrivals, res.body.data);
  });

  it("Registry route missing: 200 with the stop block and only the route that can be read", async () => {
    // Arrange
    const stores = freshStores();
    stores.registry.routes.delete("jongro07");
    const server = await boot(stores);

    // Act
    const res = await request(server).get("/bus/stops/seoul-01592/arrivals");
    const onlyOnMissing = await request(server).get("/bus/stops/seoul-01616/arrivals");

    // Assert
    expect(res.status).toBe(200);
    expect(routesOf(res.body).map((route) => route.groupId)).toEqual(["jongro08"]);
    expect(onlyOnMissing.status).toBe(503);
    expect(onlyOnMissing.body.error.code).toBe("JONGRO_REGISTRY_UNAVAILABLE");
    expectWire(busStopArrivals, res.body.data);
  });

  it("Registry route missing: 503 for a local stop only its aliased pole's route serves, by its id and its pole's", async () => {
    // Arrange
    const stores = freshStores();
    const data = busStopsFixture() as { stops: Array<Record<string, unknown>> };
    data.stops.push({ id: "hssc-jongro-only", name: { ko: "종로 전용", en: "Jongno only", zh: "钟路专用" }, arsIds: ["01616"] });
    stores.stops.storeStops(data);
    stores.registry.routes.delete("jongro07");
    const server = await boot(stores);

    // Act
    const byId = await request(server).get("/bus/stops/hssc-jongro-only/arrivals");
    const byPole = await request(server).get("/bus/stops/seoul-01616/arrivals");

    // Assert
    for (const res of [byId, byPole]) {
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe("JONGRO_REGISTRY_UNAVAILABLE");
    }
  });

  it("Attributes never read: 200 with the stop block and no Jongno entry", async () => {
    // Arrange
    const stores = { ...freshStores(), attributes: new FakeBusRouteAttributesRepository() };
    const server = await boot(stores);

    // Act
    const res = await request(server).get("/bus/stops/seoul-01592/arrivals");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.data.stop.id).toBe("100900075");
    expect(res.body.data.routes).toEqual([]);
    expectWire(busStopArrivals, res.body.data);
  });
});

describe("GET /bus/stops/:stopId/arrivals: the HSSC entry", () => {
  it("Two buses before the stop: each with its estimate, nearest first, heading towards the next stop past the rotary", async () => {
    // Arrange
    const stores = freshStores();
    stores.busCache.values.set("hssc", [hsscBus("32149", 6, "LEFT", "14:09:30"), hsscBus("32150", 9, "LEFT", "14:09:30")]);
    const server = await boot(stores);

    // Act
    const res = await request(server).get("/bus/stops/hssc-hyehwa-exit1/arrivals");

    // Assert
    const [entry] = routesOf(res.body);
    expect(entry).toMatchObject({ kind: "live", groupId: "hssc", label: "인사캠 셔틀버스", stationIndex: 6, towards: "성균관대입구사거리", stationsVersion: null, operation: "running" });
    // WHY: 32150 left 혜화동우체국 30 s ago, past its 24 s of travel, so it reaches the rotary now, 12 s there, then 81 s.
    expect(entry!.arrivals).toMatchObject([
      { status: "enRoute", stopsAway: 1, vehicleId: "32150", basis: "estimate", expectedArrivalAt: "2026-10-20T14:11:33+09:00" },
      { status: "enRoute", stopsAway: 4, vehicleId: "32149", basis: "estimate" },
    ]);
    expect((entry!.vehicles as Array<{ id: string }>).map((vehicle) => vehicle.id)).toEqual(["32149", "32150"]);
    expectWire(busStopArrivals, res.body.data);
  });

  it("a bus at the stop is arriving there with no departure instant, and a bus just past it is a lap away behind the layover", async () => {
    // Arrange
    const stores = freshStores();
    stores.busCache.values.set("hssc", [hsscBus("32150", 0, "LEFT", "14:09:40"), hsscBus("32149", 0, "ENTERED", "14:09:00")]);
    const server = await boot(stores);

    // Act
    const res = await request(server).get("/bus/stops/hssc-hyehwa-exit1/arrivals");

    // Assert
    expect(routesOf(res.body)[0]!.arrivals).toMatchObject([
      { status: "arriving", stopsAway: 0, vehicleId: "32149", expectedArrivalAt: null, expectedDepartureAt: null },
      { status: "waitingToDepart", stopsAway: 9, vehicleId: "32150", expectedArrivalAt: null },
    ]);
  });

  it("No bus: the entry serves no data and no arrival", async () => {
    // Arrange
    const server = await boot(freshStores());

    // Act
    const res = await request(server).get("/bus/stops/hssc-hyehwa-exit1/arrivals");

    // Assert
    expect(routesOf(res.body)[0]).toMatchObject({ stationIndex: 6, operation: "noData", vehicles: [], arrivals: [] });
  });
});

// WHY: riders cannot board at the 하교 direction's drop-off-only stops, which only a name marker told apart (owner, 2026-10-23).
describe("GET /bus/stops/:stopId/arrivals: drop-off-only HSSC stops", () => {
  /** `bus-stops` revision 1 with 올림픽기념국민생활관 and 혜화동우체국 (indexes 3 and 4) flagged drop-off only. */
  function withAlightOnlyStops(): Stores {
    const data = busStopsFixture() as { hssc: { stations: Array<Record<string, unknown>> } };
    data.hssc.stations[3]!.isAlightOnly = true;
    data.hssc.stations[4]!.isAlightOnly = true;
    return { ...freshStores(), stops: storedBusStopsRepository(data) };
  }

  it("serves the HSSC entry at 올림픽기념국민생활관 with action alight, heading towards 혜화동우체국 by its stop's name", async () => {
    // Arrange
    const stores = withAlightOnlyStops();
    stores.busCache.values.set("hssc", [hsscBus("32149", 1, "LEFT", "14:09:30")]);
    const server = await boot(stores);

    // Act
    const res = await request(server).get("/bus/stops/hssc-olympic-hall/arrivals");

    // Assert
    expect(res.status).toBe(200);
    expect(routesOf(res.body)).toEqual([expect.objectContaining({ kind: "live", groupId: "hssc", stationIndex: 3, towards: "혜화동우체국", action: "alight", operation: "running" })]);
    expectWire(busStopArrivals, res.body.data);
  });

  it("serves a boardable HSSC stop and a Jongno pole with action board, and 정문 heads towards 올림픽기념국민생활관 without the name's marker", async () => {
    // Arrange
    const server = await boot(withAlightOnlyStops());

    // Act
    const gate = await request(server).get("/bus/stops/hssc-main-gate-out/arrivals");
    const gateEn = await request(server).get("/bus/stops/hssc-main-gate-out/arrivals").set("Accept-Language", "en");
    const pole = await request(server).get("/bus/stops/seoul-01592/arrivals");

    // Assert
    expect(routesOf(gate.body)).toEqual([expect.objectContaining({ groupId: "hssc", stationIndex: 2, towards: "올림픽기념국민생활관", action: "board" })]);
    expect(routesOf(gateEn.body)).toEqual([expect.objectContaining({ groupId: "hssc", towards: "Olympic Hall" })]);
    expect(routesOf(pole.body).map((route) => [route.groupId, route.action])).toEqual([
      ["jongro07", "board"],
      ["jongro08", "board"],
    ]);
    expectWire(busStopArrivals, gate.body.data);
  });
});

describe("GET /bus/stops/:stopId/arrivals: shuttle entries", () => {
  it("Boarding stop: at 14:10 KST the regular entry at hssc-bus-lot lists the 14:30, 15:00 and 15:30 runs", async () => {
    // Arrange
    const server = await boot(freshStores());

    // Act
    const res = await request(server).get("/bus/stops/hssc-bus-lot/arrivals");

    // Assert
    expect(res.status).toBe(200);
    const [regular, hakbu] = routesOf(res.body);
    const scheduledRun = (time: string) => ({
      status: "scheduled",
      ...{ expectedArrivalAt: null, expectedDepartureAt: null, scheduledArrivalAt: null },
      scheduledDepartureAt: kst("2026-10-20", time),
      basis: "timetable",
      ...{ stopsAway: null, isLastBus: false, vehicleId: null, providerText: null },
      runDepartureAt: kst("2026-10-20", time),
    });
    expect(regular).toEqual({
      kind: "timetable",
      groupId: "campus",
      label: "인사캠 → 자과캠",
      serviceId: "campus-inja",
      routeType: "regular",
      action: "board",
      operation: "running",
      vehicles: [],
      arrivals: [scheduledRun("14:30"), scheduledRun("15:00"), scheduledRun("15:30")],
    });
    expect(runsOf(hakbu)).toEqual([
      [kst("2026-10-23", "13:00"), kst("2026-10-23", "13:00"), "timetable"],
      [kst("2026-10-30", "13:00"), kst("2026-10-30", "13:00"), "timetable"],
    ]);
    expect((hakbu!.arrivals as Array<{ isLastBus: boolean }>).map((arrival) => arrival.isLastBus)).toEqual([true, true]);
    expectWire(busStopArrivals, res.body.data);
  });

  it("at 01:30 KST on the 20th the next runs are the 20th's, not the UTC date's (the 19th)", async () => {
    // Arrange
    const server = await boot(freshStores(), AT_01_30_KST);

    // Act
    const res = await request(server).get("/bus/stops/hssc-bus-lot/arrivals");

    // Assert
    const [regular] = routesOf(res.body);
    expect(runsOf(regular).map(([departure]) => departure)).toEqual([kst("2026-10-20", "14:00"), kst("2026-10-20", "14:30"), kst("2026-10-20", "15:00")]);
    expect(runsOf(regular).some(([departure]) => departure!.startsWith("2026-10-19"))).toBe(false);
  });

  it("Drop-off with an estimate: the estimated run's time at nsc-n-center is the estimate, the others are unknown and ordered by departure", async () => {
    // Arrange
    const stores = freshStores();
    stores.estimates.docs.set("campus-inja|regular|2026-10-20|14:30|live", liveEstimate("14:30", [0, 3000]));
    const server = await boot(stores);

    // Act
    const res = await request(server).get("/bus/stops/nsc-n-center/arrivals");

    // Assert
    const regular = routesOf(res.body).find((route) => route.serviceId === "campus-inja" && route.routeType === "regular")!;
    expect(regular).toMatchObject({ action: "alight", operation: "running" });
    expect(runsOf(regular)).toEqual([
      [kst("2026-10-20", "15:00"), null, "timetable"],
      [kst("2026-10-20", "14:30"), kst("2026-10-20", "15:20"), "estimate"],
      [kst("2026-10-20", "15:30"), null, "timetable"],
    ]);
    expect((regular.arrivals as RunArrival[])[1]).toMatchObject({ expectedArrivalAt: kst("2026-10-20", "15:20"), scheduledArrivalAt: null });
    expect(routesOf(res.body).map((route) => `${route.serviceId}:${route.routeType}`)).toEqual([
      "campus-inja:regular",
      "campus-inja:hakbu",
      "commute-jeongja:up",
      "commute-jamsil:up",
      "commute-dogok:up",
      "commute-gangnam-yangjae:up",
      "commute-gwanggyo:up",
    ]);
    expectWire(busStopArrivals, res.body.data);
  });

  it("Friday evening: after the week's last run, the next runs are the following week's", async () => {
    // Arrange
    const server = await boot(freshStores(), AT_FRIDAY_20_00_KST);

    // Act
    const res = await request(server).get("/bus/stops/hssc-bus-lot/arrivals");

    // Assert
    const [regular, hakbu] = routesOf(res.body);
    expect(regular).toMatchObject({ operation: "running" });
    expect(runsOf(regular).map(([departure]) => departure)).toEqual([kst("2026-10-26", "14:00"), kst("2026-10-26", "14:30"), kst("2026-10-26", "15:00")]);
    expect(runsOf(hakbu).map(([departure]) => departure)).toEqual([kst("2026-10-30", "13:00")]);
    expectWire(busStopArrivals, res.body.data);
  });

  it("Friday evening before a suspension: the following week's suspended days list no run", async () => {
    // Arrange
    const stores = freshStores();
    stores.content.storeServiceNotices(serviceNoticesWithSuspension("campus-inja", { from: "2026-10-26", until: "2026-10-27" }));
    const server = await boot(stores, AT_FRIDAY_20_00_KST);

    // Act
    const res = await request(server).get("/bus/stops/hssc-bus-lot/arrivals");

    // Assert
    const [regular] = routesOf(res.body);
    expect(runsOf(regular).map(([departure]) => departure)).toEqual([kst("2026-10-28", "14:00"), kst("2026-10-28", "14:30"), kst("2026-10-28", "15:00")]);
  });

  it("Suspended service: the entry's operation is suspended, with no run", async () => {
    // Arrange
    const stores = freshStores();
    stores.content.storeServiceNotices(serviceNoticesWithSuspension("campus-inja", { from: "2026-10-19", until: "2026-10-30" }));
    const server = await boot(stores);

    // Act
    const res = await request(server).get("/bus/stops/hssc-bus-lot/arrivals");

    // Assert
    expect(routesOf(res.body).map((route) => [route.routeType, route.operation, route.arrivals])).toEqual([
      ["regular", "suspended", []],
      ["hakbu", "suspended", []],
    ]);
    expectWire(busStopArrivals, res.body.data);
  });

  it("a service with no timetable answers noData and no run", async () => {
    // Arrange
    const server = await boot(freshStores());

    // Act
    const res = await request(server).get("/bus/stops/jeongja-exit3/arrivals");

    // Assert
    expect(routesOf(res.body)).toEqual([
      { kind: "timetable", groupId: "commute", label: expect.any(String), serviceId: "commute-jeongja", routeType: "up", action: "board", operation: "noData", vehicles: [], arrivals: [] },
    ]);
  });
});

describe("GET /bus/stops/:stopId/arrivals: the stop data", () => {
  it("Never read: 503 BUS_STOPS_UNAVAILABLE with no Cache-Control", async () => {
    // Arrange
    const stores = { ...freshStores(), stops: new FakeBusStopsRepository() };
    const server = await boot(stores);

    // Act
    const res = await request(server).get("/bus/stops/seoul-01592/arrivals");

    // Assert
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("BUS_STOPS_UNAVAILABLE");
    expect(res.headers["cache-control"]).toBeUndefined();
  });

  it("api replica: a page of every kind makes no request but its stores'", async () => {
    // Arrange
    const stores = freshStores();
    const server = await boot(stores);
    takeBlockedConnections();

    // Act
    const statuses = await Promise.all(
      ["seoul-01592", "seoul-01881", "hssc-hyehwa-exit1", "hssc-bus-lot", "nsc-n-center", "jeongja-exit3"].map(async (stopId) => (await request(server).get(`/bus/stops/${stopId}/arrivals`)).status),
    );

    // Assert
    expect(statuses).toEqual([200, 200, 200, 200, 200, 200]);
    expect(takeBlockedConnections()).toEqual([]);
    expect(stores.jongroClient.positionsRouteIds).toEqual([]);
    expect(stores.routePathClient.requestedIds).toEqual([]);
  });
});

describe("GET /bus/stops/:stopId/arrivals from a realtime station's stopId", () => {
  type Station = { index: number; stopId?: string };
  const REALTIME_GROUP_IDS = ["hssc", "jongro02", "jongro07", "jongro08"];

  /** Each realtime station's stop id with its group and the first index of the group that names it. */
  async function linkedStops(server: import("http").Server): Promise<Array<{ groupId: string; stopId: string; stationIndex: number }>> {
    const groups = await Promise.all(REALTIME_GROUP_IDS.map(async (groupId) => ({ groupId, res: await request(server).get(`/bus/config/${groupId}`) })));
    return groups.flatMap(({ groupId, res }) => {
      const stations = (res.body.data as { screen: { stations: Station[] } }).screen.stations;
      const firstIndexByStopId = new Map<string, number>();
      for (const station of stations) if (station.stopId && !firstIndexByStopId.has(station.stopId)) firstIndexByStopId.set(station.stopId, station.index);
      return [...firstIndexByStopId].map(([stopId, stationIndex]) => ({ groupId, stopId, stationIndex }));
    });
  }

  it("answers every linked stop's page, listing the group at the station's first index", async () => {
    // Arrange
    const server = await boot(freshStores());
    const links = await linkedStops(server);

    // Act
    const pages = await Promise.all(links.map(async (link) => ({ link, res: await request(server).get(`/bus/stops/${link.stopId}/arrivals`) })));

    // Assert
    expect(links).toHaveLength(9 + 26 + 22 + 31);
    for (const { link, res } of pages) {
      expect({ ...link, status: res.status }).toEqual({ ...link, status: 200 });
      expect(res.body.data.stop.id).toBe(link.stopId);
      expect(routesOf(res.body).filter((route) => route.groupId === link.groupId).map((route) => route.stationIndex)).toEqual([link.stationIndex]);
    }
  });

  it("Confirmed same curb: links 종로07's station 01618 to the local stop aliasing it, whose page lists the shuttle and 종로07", async () => {
    // Arrange
    const stores = { ...freshStores(), stops: storedBusStopsRepository(aliased("hssc-bus-lot", ["01618"])) };
    const server = await boot(stores);
    const link = (await linkedStops(server)).find((candidate) => candidate.groupId === "jongro07" && candidate.stopId === "hssc-bus-lot");

    // Act
    const res = await request(server).get("/bus/stops/hssc-bus-lot/arrivals");

    // Assert
    expect(link).toEqual({ groupId: "jongro07", stopId: "hssc-bus-lot", stationIndex: 1 });
    expect(res.status).toBe(200);
    expectWire(busStopArrivals, res.body.data);
    expect(routesOf(res.body).map((route) => route.groupId)).toEqual(["campus", "campus", "jongro07"]);
    expect(routesOf(res.body).find((route) => route.groupId === "jongro07")!.stationIndex).toBe(1);
  });
});

// WHY: a stop page stands alone (ADR 0019, D5), so it names the 방면 of each line it lists, as NAVER Map does.
describe("GET /bus/stops/:stopId/arrivals: directions", () => {
  it("names each live entry's direction as its /bus/config station does, in the request language", async () => {
    // Arrange
    const server = await boot(freshStores());

    // Act
    const [pole, olympicHall] = [await request(server).get("/bus/stops/seoul-01592/arrivals").set("Accept-Language", "en"), await request(server).get("/bus/stops/hssc-olympic-hall/arrivals")];

    // Assert
    expect(routesOf(pole.body).map((route) => [route.groupId, route.direction])).toEqual([
      ["jongro07", { id: "100900220", label: "To 성균관대운동장" }],
      ["jongro08", { id: "100900040", label: "To 명륜3가" }],
    ]);
    expect(routesOf(olympicHall.body)).toEqual([expect.objectContaining({ groupId: "hssc", stationIndex: 3, direction: { id: "fromCampus", label: "하교" } })]);
    expectWire(busStopArrivals, pole.body.data);
    expectWire(busStopArrivals, olympicHall.body.data);
  });
});

// WHY: the owner's decision of 2026-10-25: a pole's stop id is its national nine-digit station id, and `seoul-<arsId>`
// a legacy alias that never retires, which answers the canonical stop's page (ADR 0019, D5).
describe("GET /bus/stops/:stopId/arrivals: national station ids and legacy ids", () => {
  it("Station id: 200 with the pole's page, and its legacy id answers the same page under the station id", async () => {
    // Arrange
    const server = await boot(freshStores());

    // Act
    const byStationId = await request(server).get("/bus/stops/100900075/arrivals");
    const byLegacyId = await request(server).get("/bus/stops/seoul-01592/arrivals");

    // Assert
    expect([byStationId.status, byLegacyId.status]).toEqual([200, 200]);
    expect(byStationId.body.data.stop).toEqual({ id: "100900075", name: "혜화역1번출구", coords: { lat: 37.5834729904, lng: 127.0017632862 }, arsIds: ["01592"], stopAreaId: null });
    expect(byLegacyId.body.data).toEqual(byStationId.body.data);
    expectWire(busStopArrivals, byStationId.body.data);
  });

  it("Aliased pole: its station id and its legacy id both answer the local stop's page", async () => {
    // Arrange
    const stores = freshStores();
    stores.stops.storeStops(aliased("hssc-bus-lot", ["01618"]));
    const server = await boot(stores);

    // Act
    const byStationId = await request(server).get("/bus/stops/100900221/arrivals");
    const byLegacyId = await request(server).get("/bus/stops/seoul-01618/arrivals");

    // Assert
    expect([byStationId.body.data.stop.id, byLegacyId.body.data.stop.id]).toEqual(["hssc-bus-lot", "hssc-bus-lot"]);
    expectWire(busStopArrivals, byStationId.body.data);
  });

  it.each([
    ["100999999", "Bus stop 100999999 is not served"],
    ["seoul-99999", "Bus stop seoul-99999 is not served"],
  ])("Unknown %s → 404 BUS_STOP_NOT_FOUND", async (stopId, message) => {
    // Arrange
    const server = await boot(freshStores());

    // Act
    const res = await request(server).get(`/bus/stops/${stopId}/arrivals`);

    // Assert
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: "BUS_STOP_NOT_FOUND", message } });
  });

  it.each(["100900075", "seoul-01592"])("Registry unread: %s → 503 JONGRO_REGISTRY_UNAVAILABLE", async (stopId) => {
    // Arrange
    const stores = freshStores();
    stores.registry.failWith = new Error("connection timed out");
    const server = await boot(stores);

    // Act
    const res = await request(server).get(`/bus/stops/${stopId}/arrivals`);

    // Assert
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("JONGRO_REGISTRY_UNAVAILABLE");
  });
});
