/**
 * Integration over BusStopListController (GET /bus/stops) through the production pipeline (buildTestApp): every
 * stop once with its names in every language, coordinates or null, aliases, campus and served routes without
 * arrivals; one public body for every language with no `meta.lang`, five minutes, an ETag answered 304; a minute
 * and the route's poles left out while a registry route is unread; the 503 with the stops never read; every stop id
 * `/bus/config` serves listed, an aliased pole's under its local stop; each live route heading and boarding as the
 * stop page's entry does in every language, alight at a drop-off-only HSSC station; and no request but the stores'.
 *
 * Every store is in memory: the registry and route lines production stored (helpers/bus/), revision 1 of
 * `bus-stops` and `jongro-route-attributes`; the stop page's comparison boots its modules too, over empty caches,
 * timetables and estimates. The pollers never start (ROLE=api) and the clock is fixed.
 */
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { BusModule } from "../../../src/bus/bus.module";
import { BusCacheModule } from "../../../src/bus/cache/bus-cache.module";
import { BusCacheRepository } from "../../../src/bus/cache/bus-cache.repository";
import { BusConfigModule } from "../../../src/bus/config/bus-config.module";
import { BusEtaModule } from "../../../src/bus/eta/bus-eta.module";
import { BusEtaRepository } from "../../../src/bus/eta/bus-eta.repository";
import { BusEtaSmartModule } from "../../../src/bus/eta/smart/bus-eta-smart.module";
import { BusLiveModule } from "../../../src/bus/live/bus-live.module";
import { BusLiveGroupModule } from "../../../src/bus/live/group/bus-live-group.module";
import { BusLiveHsscModule } from "../../../src/bus/live/hssc/bus-live-hssc.module";
import { BusLiveJongroModule } from "../../../src/bus/live/jongro/bus-live-jongro.module";
import { BusRealtimeArrivalModule } from "../../../src/bus/realtime/arrival/bus-realtime-arrival.module";
import { BusRealtimeModule } from "../../../src/bus/realtime/bus-realtime.module";
import { BusRealtimeGroupModule } from "../../../src/bus/realtime/group/bus-realtime-group.module";
import { BusRealtimeHsscClient } from "../../../src/bus/realtime/hssc/bus-realtime-hssc.client";
import { BusRealtimeHsscModule } from "../../../src/bus/realtime/hssc/bus-realtime-hssc.module";
import { BusRealtimeHsscEtaModule } from "../../../src/bus/realtime/hssc-eta/bus-realtime-hssc-eta.module";
import { BusRealtimeJongroClient } from "../../../src/bus/realtime/jongro/bus-realtime-jongro.client";
import { BusRealtimeJongroModule } from "../../../src/bus/realtime/jongro/bus-realtime-jongro.module";
import { BusScheduleContentModule } from "../../../src/bus/schedule-content/bus-schedule-content.module";
import { BusScheduleContentRepository } from "../../../src/bus/schedule-content/bus-schedule-content.repository";
import { BusScheduleModule } from "../../../src/bus/schedule/bus-schedule.module";
import { BusScheduleRepository } from "../../../src/bus/schedule/bus-schedule.repository";
import { BusStopArrivalsModule } from "../../../src/bus/stop-arrivals/bus-stop-arrivals.module";
import { CalendarRepository } from "../../../src/calendar/calendar.repository";
import { BusRegistryModule } from "../../../src/bus/registry/bus-registry.module";
import { BusRegistryRepository } from "../../../src/bus/registry/bus-registry.repository";
import { BusRouteAttributesModule } from "../../../src/bus/route-attributes/bus-route-attributes.module";
import { BusRouteAttributesRepository } from "../../../src/bus/route-attributes/bus-route-attributes.repository";
import { BusRoutePathClient } from "../../../src/bus/route-path/bus-route-path.client";
import { BusRoutePathModule } from "../../../src/bus/route-path/bus-route-path.module";
import { BusRoutePathRepository } from "../../../src/bus/route-path/bus-route-path.repository";
import { BusStopIndexModule } from "../../../src/bus/stop-index/bus-stop-index.module";
import { BusStopListModule } from "../../../src/bus/stop-list/bus-stop-list.module";
import { busStopList } from "../../../src/bus/stop-list/bus-stop-list.wire";
import { BusStopsModule } from "../../../src/bus/stops/bus-stops.module";
import { BusStopsRepository } from "../../../src/bus/stops/bus-stops.repository";
import { Clock } from "../../../src/infra/clock";
import { SchedulingModule } from "../../../src/scheduling/scheduling.module";
import { storedBusRegistryRepository } from "../../helpers/bus/bus-registry";
import { storedBusRoutePathRepository } from "../../helpers/bus/bus-route-path";
import { busStopsFixture, storedBusStopsRepository } from "../../helpers/bus/bus-stops";
import { storedRouteAttributesRepository } from "../../helpers/bus/route-attributes";
import { storedScheduleContentRepository } from "../../helpers/bus/schedule-content";
import { expectWire } from "../../helpers/contracts/expect-wire";
import { FakeBusCacheRepository } from "../../helpers/fakes/bus/bus-cache.repository.fake";
import { FakeBusEtaRepository } from "../../helpers/fakes/bus/bus-eta.repository.fake";
import { FakeBusRealtimeHsscClient } from "../../helpers/fakes/bus/bus-realtime-hssc.client.fake";
import { FakeBusRealtimeJongroClient } from "../../helpers/fakes/bus/bus-realtime-jongro.client.fake";
import { FakeBusRoutePathClient } from "../../helpers/fakes/bus/bus-route-path.client.fake";
import { FakeBusScheduleRepository } from "../../helpers/fakes/bus/bus-schedule.repository.fake";
import { FakeBusStopsRepository } from "../../helpers/fakes/bus/bus-stops.repository.fake";
import { storedCalendarRepository } from "../../helpers/calendar/rest-days";
import { buildTestApp } from "../../helpers/nest/build-test-app";
import { takeBlockedConnections } from "../../helpers/network-guard";

const NOW = new Date("2026-10-23T05:00:00.000Z");

interface Stores {
  registry: ReturnType<typeof storedBusRegistryRepository>;
  stops: FakeBusStopsRepository;
  routePathClient: FakeBusRoutePathClient;
}

const freshStores = (): Stores => ({ registry: storedBusRegistryRepository(), stops: storedBusStopsRepository(), routePathClient: new FakeBusRoutePathClient() });

let app: NestExpressApplication | undefined;

async function boot(stores: Stores): Promise<import("http").Server> {
  app = await buildTestApp({
    imports: [SchedulingModule, BusModule, BusRegistryModule, BusRouteAttributesModule, BusRoutePathModule, BusStopsModule, BusConfigModule, BusStopIndexModule, BusStopListModule],
    overrides: [
      { provide: BusRegistryRepository, useValue: stores.registry },
      { provide: BusRouteAttributesRepository, useValue: storedRouteAttributesRepository() },
      { provide: BusRoutePathRepository, useValue: storedBusRoutePathRepository() },
      { provide: BusRoutePathClient, useValue: stores.routePathClient },
      { provide: BusStopsRepository, useValue: stores.stops },
      { provide: Clock, useValue: { now: () => new Date(NOW) } },
    ],
    role: "api",
  });
  return app.getHttpServer();
}

/** The app with the stop page mounted too, over empty caches, timetables and estimates, to compare with its entries. */
async function bootWithStopPage(stores: Stores): Promise<import("http").Server> {
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
      BusStopListModule,
    ],
    overrides: [
      { provide: BusCacheRepository, useValue: new FakeBusCacheRepository() },
      { provide: BusRegistryRepository, useValue: stores.registry },
      { provide: BusRouteAttributesRepository, useValue: storedRouteAttributesRepository() },
      { provide: BusRoutePathRepository, useValue: storedBusRoutePathRepository() },
      { provide: BusRoutePathClient, useValue: stores.routePathClient },
      { provide: BusRealtimeHsscClient, useValue: new FakeBusRealtimeHsscClient() },
      { provide: BusRealtimeJongroClient, useValue: new FakeBusRealtimeJongroClient() },
      { provide: BusStopsRepository, useValue: stores.stops },
      { provide: BusScheduleRepository, useValue: new FakeBusScheduleRepository() },
      { provide: BusScheduleContentRepository, useValue: storedScheduleContentRepository() },
      { provide: BusEtaRepository, useValue: new FakeBusEtaRepository() },
      { provide: CalendarRepository, useValue: storedCalendarRepository() },
      { provide: Clock, useValue: { now: () => new Date(NOW) } },
    ],
    role: "api",
  });
  return app.getHttpServer();
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

type Listed = { id: string; [key: string]: unknown };
const stopsOf = (body: { data: { stops: Listed[] } }) => body.data.stops;
const stopIn = (body: { data: { stops: Listed[] } }, stopId: string) => stopsOf(body).find((stop) => stop.id === stopId);

/** Every `stopId` anywhere in a body: realtime stations' and sequence stops'. */
function stopIdsIn(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(stopIdsIn);
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, field]) => (key === "stopId" && typeof field === "string" ? [field] : stopIdsIn(field)));
}

describe("GET /bus/stops", () => {
  it("Every stop: 200, public for five minutes with an ETag, no meta.lang, a pole, an HSSC stop and a shuttle stop", async () => {
    // Arrange
    const data = busStopsFixture() as { stops: Array<Record<string, unknown>> };
    delete data.stops.find((stop) => stop.id === "hssc-hyehwa-exit1")!.coords;
    const server = await boot({ ...freshStores(), stops: storedBusStopsRepository(data) });

    // Act
    const res = await request(server).get("/bus/stops");

    // Assert
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("public, max-age=300");
    expect(res.headers.etag).toMatch(/^"stops-[0-9a-f]{32}"$/);
    expect(res.body.meta).toEqual({});
    expect(stopIn(res.body, "seoul-01592")).toEqual({
      id: "seoul-01592",
      name: { ko: "혜화역1번출구", en: "혜화역1번출구", zh: "혜화역1번출구" },
      coords: { lat: 37.5834729904, lng: 127.0017632862 },
      arsIds: ["01592"],
      campus: "hssc",
      stopAreaId: null,
      routes: [
        { kind: "live", groupId: "jongro07", label: { ko: "종로 07", en: "Jongro 07", zh: "钟路 07" }, stationIndex: 16, towards: { ko: "혜화동로터리", en: "혜화동로터리", zh: "혜화동로터리" }, action: "board" },
        { kind: "live", groupId: "jongro08", label: { ko: "종로 08", en: "Jongro 08", zh: "钟路 08" }, stationIndex: 22, towards: { ko: "혜화동로터리", en: "혜화동로터리", zh: "혜화동로터리" }, action: "board" },
      ],
    });
    expect(stopIn(res.body, "hssc-hyehwa-exit1")).toEqual({
      id: "hssc-hyehwa-exit1",
      name: { ko: "혜화역 1번출구", en: "Hyehwa Station (Shuttle Bus Stop)", zh: "Hyehwa Station (Shuttle Bus Stop)" },
      coords: null,
      arsIds: null,
      campus: null,
      stopAreaId: null,
      routes: [
        {
          kind: "live",
          groupId: "hssc",
          label: { ko: "인사캠 셔틀버스", en: "HSSC Shuttle Bus", zh: "人文校区班车" },
          stationIndex: 6,
          towards: { ko: "성균관대입구사거리", en: "SKKU Junction", zh: "SKKU Junction" },
          action: "board",
        },
      ],
    });
    expect(stopIn(res.body, "jeongja-exit3")).toMatchObject({
      name: { ko: "정자역 3번 출구", en: "Jeongja Stn. Exit 3", zh: "亭子站 3号出口" },
      coords: { lat: 37.365499, lng: 127.107906 },
      routes: [{ kind: "timetable", groupId: "commute", label: { ko: "정자", en: "Jeongja", zh: "亭子" }, serviceId: "commute-jeongja", routeType: "up", action: "board" }],
    });
    expectWire(busStopList, res.body.data);
  });

  it("One body for every language: en and zh requests get the ko body and its ETag", async () => {
    // Arrange
    const server = await boot(freshStores());

    // Act
    const [ko, en, zh] = await Promise.all(["ko", "en", "zh"].map((lang) => request(server).get("/bus/stops").set("Accept-Language", lang)));

    // Assert
    expect(en.body).toEqual(ko.body);
    expect(zh.body).toEqual(ko.body);
    expect([en.headers.etag, zh.headers.etag]).toEqual([ko.headers.etag, ko.headers.etag]);
  });

  it("Order: the HSSC line's stops, the shuttle stops, then each Jongno route's poles, each stop once", async () => {
    // Arrange
    const server = await boot(freshStores());

    // Act
    const res = await request(server).get("/bus/stops");

    // Assert
    const ids = stopsOf(res.body).map((stop) => stop.id);
    expect(ids.slice(0, 10)).toEqual([
      "hssc-basketball-court",
      "hssc-student-center",
      "hssc-main-gate-out",
      "hssc-olympic-hall",
      "hssc-hyehwa-post-office",
      "hssc-hyehwa-exit1",
      "hssc-skku-junction",
      "hssc-main-gate-in",
      "hssc-600th-hall",
      "hssc-bus-lot",
    ]);
    expect(ids.findIndex((id) => id.startsWith("seoul-"))).toBeGreaterThan(ids.lastIndexOf("jeongja-exit3"));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.filter((id) => id === "seoul-01881")).toHaveLength(1);
  });

  it("If-None-Match with the ETag: 304 with no body", async () => {
    // Arrange
    const server = await boot(freshStores());
    const first = await request(server).get("/bus/stops");

    // Act
    const res = await request(server).get("/bus/stops").set("If-None-Match", first.headers.etag!);

    // Assert
    expect(res.status).toBe(304);
    expect(res.text).toBe("");
  });

  it("Registry route missing: 200 for a minute, without the poles only that route stops at", async () => {
    // Arrange
    const stores = freshStores();
    stores.registry.routes.delete("jongro07");
    const server = await boot(stores);

    // Act
    const res = await request(server).get("/bus/stops");

    // Assert
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("public, max-age=60");
    expect(stopIn(res.body, "seoul-01616")).toBeUndefined();
    expect((stopIn(res.body, "seoul-01592")!.routes as Array<{ groupId: string }>).map((route) => route.groupId)).toEqual(["jongro08"]);
    expectWire(busStopList, res.body.data);
  });

  it("Never read: 503 BUS_STOPS_UNAVAILABLE with no Cache-Control", async () => {
    // Arrange
    const server = await boot({ ...freshStores(), stops: new FakeBusStopsRepository() });

    // Act
    const res = await request(server).get("/bus/stops");

    // Assert
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: { code: "BUS_STOPS_UNAVAILABLE", message: "The bus stops are unavailable" } });
    expect(res.headers["cache-control"]).toBeUndefined();
  });

  it("api replica: the list makes no request but its stores'", async () => {
    // Arrange
    const stores = freshStores();
    const server = await boot(stores);
    takeBlockedConnections();

    // Act
    const res = await request(server).get("/bus/stops");

    // Assert
    expect(res.status).toBe(200);
    expect(takeBlockedConnections()).toEqual([]);
    expect(stores.routePathClient.requestedIds).toEqual([]);
  });
});

describe("GET /bus/stops and /bus/config's stop ids", () => {
  it("lists every stop id /bus/config serves", async () => {
    // Arrange
    const server = await boot(freshStores());
    const config = await request(server).get("/bus/config");

    // Act
    const res = await request(server).get("/bus/stops");

    // Assert
    const configStopIds = new Set(stopIdsIn(config.body.data));
    const listedIds = new Set(stopsOf(res.body).map((stop) => stop.id));
    expect(configStopIds.size).toBeGreaterThan(80);
    expect([...configStopIds].filter((stopId) => !listedIds.has(stopId))).toEqual([]);
  });

  it("Confirmed same curb: lists an aliased pole once, under the local stop /bus/config names at its station", async () => {
    // Arrange
    const data = busStopsFixture() as { stops: Array<{ id: string; arsIds?: string[] }> };
    data.stops.find((stop) => stop.id === "hssc-bus-lot")!.arsIds = ["01618"];
    const server = await boot({ ...freshStores(), stops: storedBusStopsRepository(data) });
    const config = await request(server).get("/bus/config/jongro07");

    // Act
    const res = await request(server).get("/bus/stops");

    // Assert
    expect(stopIdsIn(config.body.data)).toContain("hssc-bus-lot");
    expect(stopIn(res.body, "seoul-01618")).toBeUndefined();
    expect(stopIn(res.body, "hssc-bus-lot")).toMatchObject({ arsIds: ["01618"], campus: "hssc" });
    expect((stopIn(res.body, "hssc-bus-lot")!.routes as Array<{ groupId: string }>).map((route) => route.groupId)).toEqual(["campus", "campus", "jongro07"]);
    expectWire(busStopList, res.body.data);
  });
});

describe("GET /bus/stops and the stop page", () => {
  type LiveRoute = { kind: string; groupId: string; stationIndex: number; towards: Record<string, string> | null; action: string };

  it("Same as the stop page: every live route of every HSSC and Jongno stop heads and boards as the page's entry in ko, en and zh", async () => {
    // Arrange
    const server = await bootWithStopPage(freshStores());
    const list = await request(server).get("/bus/stops");
    const stops = stopsOf(list.body).filter((stop) => stop.id.startsWith("hssc-") || stop.id === "seoul-01592" || stop.id === "seoul-01881");

    // Act
    const pages = await Promise.all(
      stops.flatMap((stop) => ["ko", "en", "zh"].map(async (lang) => ({ stop, lang, res: await request(server).get(`/bus/stops/${stop.id}/arrivals`).set("Accept-Language", lang) }))),
    );

    // Assert
    expect(pages.length).toBeGreaterThan(20);
    for (const { stop, lang, res } of pages) {
      const listed = (stop.routes as LiveRoute[]).filter((route) => route.kind === "live").map((route) => [route.groupId, route.stationIndex, route.towards?.[lang] ?? null, route.action]);
      const paged = (res.body.data.routes as LiveRoute[]).filter((route) => route.kind === "live").map((route) => [route.groupId, route.stationIndex, route.towards, route.action]);
      expect({ stopId: stop.id, lang, routes: listed }).toEqual({ stopId: stop.id, lang, routes: paged });
    }
  });

  it("Drop-off only: an HSSC station flagged isAlightOnly is listed as alight, as its page serves it", async () => {
    // Arrange
    const data = busStopsFixture() as { hssc: { stations: Array<{ isAlightOnly?: boolean }> } };
    data.hssc.stations[3]!.isAlightOnly = true;
    const server = await bootWithStopPage({ ...freshStores(), stops: storedBusStopsRepository(data) });

    // Act
    const res = await request(server).get("/bus/stops");
    const page = await request(server).get("/bus/stops/hssc-olympic-hall/arrivals");

    // Assert
    expect(page.body.data.routes).toEqual([expect.objectContaining({ groupId: "hssc", stationIndex: 3, action: "alight" })]);
    expect(stopIn(res.body, "hssc-olympic-hall")!.routes).toEqual([expect.objectContaining({ groupId: "hssc", stationIndex: 3, action: "alight" })]);
    expect(stopIn(res.body, "hssc-main-gate-out")!.routes).toEqual([expect.objectContaining({ groupId: "hssc", stationIndex: 2, action: "board" })]);
    expectWire(busStopList, res.body.data);
  });

  it("Stop area: each member is listed once under its own id with the area's id, as its page names it, and every other stop with null", async () => {
    // Arrange
    const data = { ...busStopsFixture(), stopAreas: [{ id: "hyehwa-exit1", name: { ko: "혜화역 1번 출구" }, stopIds: ["hssc-hyehwa-exit1", "seoul-01592"] }] };
    const server = await bootWithStopPage({ ...freshStores(), stops: storedBusStopsRepository(data) });

    // Act
    const res = await request(server).get("/bus/stops");
    const page = await request(server).get("/bus/stops/seoul-01592/arrivals");

    // Assert
    const grouped = stopsOf(res.body).filter((stop) => stop.stopAreaId !== null);
    expect(grouped.map((stop) => [stop.id, stop.stopAreaId])).toEqual([
      ["hssc-hyehwa-exit1", "hyehwa-exit1"],
      ["seoul-01592", "hyehwa-exit1"],
    ]);
    expect(stopsOf(res.body).every((stop) => "stopAreaId" in stop)).toBe(true);
    expect(page.body.data.stop.stopAreaId).toBe("hyehwa-exit1");
    expectWire(busStopList, res.body.data);
  });
});
