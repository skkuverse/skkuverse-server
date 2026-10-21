/**
 * Integration over BusStopArrivalsController (GET /bus/stops/:stopId/arrivals, unify-bus-stops design D7-D9)
 * through the production pipeline (buildTestApp), against every scenario of spec bus-stop-arrivals: the stop block,
 * 404 BUS_STOP_NOT_FOUND, the configuration order, a Jongno entry equal to the realtime view, a Jongno route left
 * out, the HSSC buses as stops away, the next three shuttle runs at a stop (14:10 KST, and 01:30 KST when the UTC
 * date is the day before), a suspended service, the 503 with the stops never read, no-store, and no outbound request.
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
import { BusRealtimeArrivalModule } from "../../../src/bus/realtime/arrival/bus-realtime-arrival.module";
import { BusRealtimeModule } from "../../../src/bus/realtime/bus-realtime.module";
import { BusRealtimeGroupModule } from "../../../src/bus/realtime/group/bus-realtime-group.module";
import { BusRealtimeHsscClient } from "../../../src/bus/realtime/hssc/bus-realtime-hssc.client";
import { BusRealtimeHsscModule } from "../../../src/bus/realtime/hssc/bus-realtime-hssc.module";
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
import { busStopArrivals } from "../../../src/bus/stop-arrivals/bus-stop-arrivals.wire";
import { BusStopIndexModule } from "../../../src/bus/stop-index/bus-stop-index.module";
import { BusStopsModule } from "../../../src/bus/stops/bus-stops.module";
import { BusStopsRepository } from "../../../src/bus/stops/bus-stops.repository";
import { HolidaysRepository } from "../../../src/holidays/holidays.repository";
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
import { FakeHolidaysRepository } from "../../helpers/fakes/holidays/holidays.repository.fake";
import { buildTestApp } from "../../helpers/nest/build-test-app";
import { takeBlockedConnections } from "../../helpers/network-guard";

// WHY: Tuesday 2026-10-20 14:10 KST, the spec's "Boarding stop" instant.
const AT_14_10_KST = new Date("2026-10-20T05:10:00.000Z");
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
      BusStopsModule,
      BusScheduleContentModule,
      BusScheduleModule,
      BusEtaModule,
      BusEtaSmartModule,
      BusConfigModule,
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
      { provide: HolidaysRepository, useValue: new FakeHolidaysRepository() },
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

describe("GET /bus/stops/:stopId/arrivals: the stop block", () => {
  it("Shared Jongno pole: 200, no-store, the pole with its route line's coordinates, and 종로07 then 종로08", async () => {
    // Arrange
    const server = await boot(freshStores());

    // Act
    const res = await request(server).get("/bus/stops/seoul-01592/arrivals");

    // Assert
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body.meta).toEqual({ lang: "ko" });
    expect(res.body.data.stop).toEqual({ id: "seoul-01592", name: "혜화역1번출구", coords: { lat: 37.5834729904, lng: 127.0017632862 }, arsIds: ["01592"] });
    expect(routesOf(res.body).map((route) => [route.groupId, route.kind, route.stationIndex, route.towards])).toEqual([
      ["jongro07", "arrivals", 16, "혜화동로터리"],
      ["jongro08", "arrivals", 22, "혜화동로터리"],
    ]);
    expectWire(busStopArrivals, res.body.data);
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
    expect(res.body.data.stop).toEqual(record);
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
    const server = await boot(freshStores());

    // Act
    const res = await request(server).get("/bus/stops/hssc-hyehwa-exit1/arrivals").set("Accept-Language", "en");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.data.stop).toEqual({ id: "hssc-hyehwa-exit1", name: "Hyehwa Station (Shuttle Bus Stop)" });
    expectWire(busStopArrivals, res.body.data);
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
      ["campus", "schedule", "campus-inja", "regular"],
      ["campus", "schedule", "campus-inja", "hakbu"],
      ["jongro07", "arrivals", null, null],
    ]);
    expect(bySlug.body.data).toEqual(byPole.body.data);
    expectWire(busStopArrivals, byPole.body.data);
  });

  it("Nearby but not confirmed: hssc-600th and seoul-01616 are two stops with two pages", async () => {
    // Arrange
    const server = await boot(freshStores());

    // Act
    const local = await request(server).get("/bus/stops/hssc-600th/arrivals");
    const pole = await request(server).get("/bus/stops/seoul-01616/arrivals");

    // Assert
    expect(routesOf(local.body).map((route) => route.groupId)).toEqual(["campus", "campus"]);
    expect(routesOf(pole.body).map((route) => route.groupId)).toEqual(["jongro07"]);
    expect(pole.body.data.stop.id).toBe("seoul-01616");
  });
});

describe("GET /bus/stops/:stopId/arrivals: Jongno entries", () => {
  it("Same as the line view: the 종로07 entry carries the realtime route's arrivals at index 16, the waiting rewrite included", async () => {
    // Arrange
    const stores = freshStores();
    const station = { stationId: "100900075", sequence: "17", stationName: "혜화역1번출구", stationNumber: "01592" };
    stores.busCache.values.set("jongro_stations_07", [
      jongroArrivalDoc({
        ...station,
        eta: "4분10초후[2번째 전]",
        buses: [
          jongroArrivalBus({ staOrd: 17, sectOrd: 15, traTime: 250, arrmsg: "4분10초후[2번째 전]", vehId: "100000201", plainNo: "서울74사2701" }),
          jongroArrivalBus({ staOrd: 17, sectOrd: 1, traTime: 1500, arrmsg: "25분후[16번째 전]", vehId: "100000202", plainNo: "서울74사2702" }),
        ],
      }),
    ]);
    stores.busCache.values.set("jongro_locations_07", [
      jongroPositionDoc({ sequence: "15", stationId: "100000123", vehicleId: "100000201", carNumber: "2701" }),
      jongroPositionDoc({ sequence: "1", stationId: "100900220", vehicleId: "100000202", carNumber: "2702", isStationary: true }),
    ]);
    const server = await boot(stores);
    const realtime = await request(server).get("/bus/realtime/data/jongro07");
    const lineArrivals = realtime.body.data.stationEtas.find((eta: { stationIndex: number }) => eta.stationIndex === 16).arrivals;

    // Act
    const res = await request(server).get("/bus/stops/seoul-01592/arrivals");

    // Assert
    const entry = routesOf(res.body).find((route) => route.groupId === "jongro07")!;
    expect(entry).toEqual({
      groupId: "jongro07",
      kind: "arrivals",
      label: "종로 07",
      stationIndex: 16,
      towards: "혜화동로터리",
      stationsVersion: realtime.body.data.stationsVersion,
      arrivals: lineArrivals,
    });
    expect(lineArrivals).toHaveLength(2);
    expect(lineArrivals.map((arrival: { state: string }) => arrival.state)).toEqual(["running", "waiting"]);
    expect(routesOf(res.body).find((route) => route.groupId === "jongro08")).toMatchObject({ stationIndex: 22, arrivals: [] });
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

  it("Attributes never read: 200 with the stop block and no Jongno entry", async () => {
    // Arrange
    const stores = { ...freshStores(), attributes: new FakeBusRouteAttributesRepository() };
    const server = await boot(stores);

    // Act
    const res = await request(server).get("/bus/stops/seoul-01592/arrivals");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.data.stop.id).toBe("seoul-01592");
    expect(res.body.data.routes).toEqual([]);
    expectWire(busStopArrivals, res.body.data);
  });
});

describe("GET /bus/stops/:stopId/arrivals: the HSSC entry", () => {
  it("Two buses before the stop: buses at indexes 1 and 4 are 2 and 5 stops from index 6, nearest first", async () => {
    // Arrange
    const stores = freshStores();
    stores.busCache.values.set("hssc", [hsscBusDoc({ sequence: "2", carNumber: "0001" }), hsscBusDoc({ sequence: "5", carNumber: "0002" })]);
    const server = await boot(stores);

    // Act
    const res = await request(server).get("/bus/stops/hssc-hyehwa-exit1/arrivals");

    // Assert
    expect(routesOf(res.body)).toEqual([{ groupId: "hssc", kind: "approaching", label: "인사캠 셔틀버스", stationIndex: 6, approaching: [{ stopsAway: 2 }, { stopsAway: 5 }] }]);
    expectWire(busStopArrivals, res.body.data);
  });

  it("a bus at the stop is 0 stops away, and a bus just past it is the farthest, round the loop", async () => {
    // Arrange
    const stores = freshStores();
    stores.busCache.values.set("hssc", [hsscBusDoc({ sequence: "9" }), hsscBusDoc({ sequence: "7" })]);
    const server = await boot(stores);

    // Act
    const res = await request(server).get("/bus/stops/hssc-hyehwa-exit1/arrivals");

    // Assert
    expect(routesOf(res.body)[0]).toMatchObject({ stationIndex: 6, approaching: [{ stopsAway: 0 }, { stopsAway: 9 }] });
  });

  it("Bus past the stop: the only bus at index 8 is 9 positions from index 6, round the loop", async () => {
    // Arrange
    const stores = freshStores();
    stores.busCache.values.set("hssc", [hsscBusDoc({ sequence: "9" })]);
    const server = await boot(stores);

    // Act
    const res = await request(server).get("/bus/stops/hssc-hyehwa-exit1/arrivals");

    // Assert
    expect(routesOf(res.body)[0]).toMatchObject({ stationIndex: 6, approaching: [{ stopsAway: 9 }] });
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
    expect(regular).toEqual({
      groupId: "campus",
      kind: "schedule",
      label: "인사캠 → 자과캠",
      serviceId: "campus-inja",
      routeType: "regular",
      action: "board",
      status: "active",
      next: [
        { date: "2026-10-20", departure: "14:30", time: "14:30", estimated: false },
        { date: "2026-10-20", departure: "15:00", time: "15:00", estimated: false },
        { date: "2026-10-20", departure: "15:30", time: "15:30", estimated: false },
      ],
    });
    expect(hakbu).toMatchObject({ routeType: "hakbu", next: [{ date: "2026-10-23", departure: "13:00", time: "13:00", estimated: false }] });
    expectWire(busStopArrivals, res.body.data);
  });

  it("at 01:30 KST on the 20th the next runs are the 20th's, not the UTC date's (the 19th)", async () => {
    // Arrange
    const server = await boot(freshStores(), AT_01_30_KST);

    // Act
    const res = await request(server).get("/bus/stops/hssc-bus-lot/arrivals");

    // Assert
    const [regular] = routesOf(res.body);
    expect(regular!.next).toEqual([
      { date: "2026-10-20", departure: "14:00", time: "14:00", estimated: false },
      { date: "2026-10-20", departure: "14:30", time: "14:30", estimated: false },
      { date: "2026-10-20", departure: "15:00", time: "15:00", estimated: false },
    ]);
    expect((regular!.next as Array<{ date: string }>).some((next) => next.date === "2026-10-19")).toBe(false);
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
    expect(regular).toMatchObject({ action: "alight", status: "active" });
    expect(regular.next).toEqual([
      { date: "2026-10-20", departure: "15:00", time: null, estimated: false },
      { date: "2026-10-20", departure: "14:30", time: "15:20", estimated: true },
      { date: "2026-10-20", departure: "15:30", time: null, estimated: false },
    ]);
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

  it("Suspended service: the entry carries the smart schedule's status and an empty next", async () => {
    // Arrange
    const stores = freshStores();
    stores.content.storeServiceNotices(serviceNoticesWithSuspension("campus-inja", { from: "2026-10-19", until: "2026-10-30" }));
    const server = await boot(stores);

    // Act
    const res = await request(server).get("/bus/stops/hssc-bus-lot/arrivals");

    // Assert
    expect(routesOf(res.body).map((route) => [route.routeType, route.status, route.next])).toEqual([
      ["regular", "suspended", []],
      ["hakbu", "suspended", []],
    ]);
    expectWire(busStopArrivals, res.body.data);
  });

  it("a service with no timetable answers noData and an empty next", async () => {
    // Arrange
    const server = await boot(freshStores());

    // Act
    const res = await request(server).get("/bus/stops/jeongja-exit3/arrivals");

    // Assert
    expect(routesOf(res.body)).toEqual([
      { groupId: "commute", kind: "schedule", label: expect.any(String), serviceId: "commute-jeongja", routeType: "up", action: "board", status: "noData", next: [] },
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
