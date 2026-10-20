/**
 * The routes that serve a Jongro route's stored attributes (move-reference-datasets
 * D10 and D12; specs `jongro-route-attributes`, `jongro-station-registry` and
 * `jongro-realtime-arrivals`), over main.ts's pipeline with every repository and
 * the TOPIS client faked and the clock fixed at 12:00 KST on 2026-10-20:
 *
 * - `/bus/config` and `/bus/config/:groupId` take each Jongro card's theme color
 *   and icon type, its refresh interval and each station's transfer lines from
 *   the stored `jongro-route-attributes`, and a push reaches them, ETag
 *   included, once the dataset TTL has passed; a push that changes no body
 *   keeps the ETag.
 * - The Jongro realtime groups compute crowding from the stored seat count.
 * - A route the code serves with no stored attributes is left out of the
 *   config and the transit routes, and its realtime route answers 503.
 * - Attributes never read: the five routes answer 503
 *   JONGRO_ROUTE_ATTRIBUTES_UNAVAILABLE with no Cache-Control, and
 *   `/bus/realtime/data/hssc` serves as before.
 * - The Jongro poller ticks with no attributes stored, reading none.
 *
 * Each test boots its own app over its own stores, so no dataset cache crosses
 * tests. A push lands within the TTL through Jest's fake system time, which
 * `createCachedLoader` reads; the clock reads it too.
 */
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { BusCacheModule } from "../../../src/bus/cache/bus-cache.module";
import { BusCacheRepository } from "../../../src/bus/cache/bus-cache.repository";
import { BusConfigModule } from "../../../src/bus/config/bus-config.module";
import { BusRealtimeArrivalModule } from "../../../src/bus/realtime/arrival/bus-realtime-arrival.module";
import { BusRealtimeModule } from "../../../src/bus/realtime/bus-realtime.module";
import { BusRealtimeGroupModule } from "../../../src/bus/realtime/group/bus-realtime-group.module";
import { BusRealtimeHsscModule } from "../../../src/bus/realtime/hssc/bus-realtime-hssc.module";
import { BusRealtimeJongroClient } from "../../../src/bus/realtime/jongro/bus-realtime-jongro.client";
import { BusRealtimeJongroModule } from "../../../src/bus/realtime/jongro/bus-realtime-jongro.module";
import { BusRegistryModule } from "../../../src/bus/registry/bus-registry.module";
import { BusRegistryRepository } from "../../../src/bus/registry/bus-registry.repository";
import { BusRouteAttributesModule } from "../../../src/bus/route-attributes/bus-route-attributes.module";
import { BusRouteAttributesRepository } from "../../../src/bus/route-attributes/bus-route-attributes.repository";
import type { JongroRouteAttributesData } from "../../../src/bus/route-attributes/bus-route-attributes.types";
import { BusStopsModule } from "../../../src/bus/stops/bus-stops.module";
import { Clock } from "../../../src/infra/clock";
import { DATASET_CACHE_TTL_MS } from "../../../src/shared/dataset.constants";
import { PollerRegistryService } from "../../../src/scheduling/poller-registry.service";
import { SchedulingModule } from "../../../src/scheduling/scheduling.module";
import { UiTransitListModule } from "../../../src/ui/transit-list/ui-transit-list.module";
import { UiTransitTabModule } from "../../../src/ui/transit/tab/ui-transit-tab.module";
import { UiTransitModule } from "../../../src/ui/transit/ui-transit.module";
import { UiTransitRepository } from "../../../src/ui/transit/ui-transit.repository";
import { UiModule } from "../../../src/ui/ui.module";
import { jongroArrivalBus, jongroArrivalDoc, jongroPositionDoc, noArrivalBus } from "../../helpers/bus/bus-cache-docs";
import { storedBusRegistryRepository } from "../../helpers/bus/bus-registry";
import { routeAttributesFixture } from "../../helpers/bus/route-attributes";
import { FakeBusCacheRepository } from "../../helpers/fakes/bus/bus-cache.repository.fake";
import { FakeBusRealtimeJongroClient } from "../../helpers/fakes/bus/bus-realtime-jongro.client.fake";
import { FakeBusRouteAttributesRepository } from "../../helpers/fakes/bus/bus-route-attributes.repository.fake";
import { FakeUiTransitRepository } from "../../helpers/fakes/ui/ui-transit.repository.fake";
import { buildTestApp } from "../../helpers/nest/build-test-app";

const transitLayoutFixture = require("../ui/fixtures/transit-layout.dataset.json") as Record<string, unknown>;

// WHY: 12:00 KST on 2026-10-20, so the commute card is open and the answer does not depend on the day the suite runs.
const NOW = new Date("2026-10-20T03:00:00.000Z");
const CLOCK: Clock = { now: () => new Date(Date.now()) };
const DO_NOT_FAKE = ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "setImmediate", "clearImmediate", "queueMicrotask", "nextTick", "performance"] as const;
const UNAVAILABLE = { code: "JONGRO_ROUTE_ATTRIBUTES_UNAVAILABLE", message: "The Jongro route attributes are unavailable" };

interface Stores {
  attributes: FakeBusRouteAttributesRepository;
  busCache: FakeBusCacheRepository;
  jongroClient: FakeBusRealtimeJongroClient;
}

interface Station {
  stationNumber: string | null;
  transferLines: Array<{ line: string; color: string }>;
}
interface Group {
  id: string;
  card: { themeColor: string; iconType: string };
  screen: { refreshInterval: number; stations: Station[] };
}

function transitLayoutRepository(): FakeUiTransitRepository {
  const { _about, ...layout } = structuredClone(transitLayoutFixture);
  void _about;
  const repository = new FakeUiTransitRepository();
  repository.storeTransitLayout(layout);
  return repository;
}

function storesHolding(data: JongroRouteAttributesData | null): Stores {
  const attributes = new FakeBusRouteAttributesRepository();
  if (data !== null) attributes.storeAttributes(data);
  return { attributes, busCache: new FakeBusCacheRepository(), jongroClient: new FakeBusRealtimeJongroClient() };
}

const apps: NestExpressApplication[] = [];

async function boot(stores: Stores): Promise<NestExpressApplication> {
  const app = await buildTestApp({
    imports: [
      SchedulingModule,
      BusCacheModule,
      BusRegistryModule,
      BusRouteAttributesModule,
      BusRealtimeModule,
      BusRealtimeHsscModule,
      BusRealtimeJongroModule,
      BusRealtimeArrivalModule,
      BusRealtimeGroupModule,
      BusStopsModule,
      BusConfigModule,
      UiModule,
      UiTransitListModule,
      UiTransitModule,
      UiTransitTabModule,
    ],
    overrides: [
      { provide: Clock, useValue: CLOCK },
      { provide: BusCacheRepository, useValue: stores.busCache },
      { provide: BusRegistryRepository, useValue: storedBusRegistryRepository() },
      { provide: BusRouteAttributesRepository, useValue: stores.attributes },
      { provide: BusRealtimeJongroClient, useValue: stores.jongroClient },
      { provide: UiTransitRepository, useValue: transitLayoutRepository() },
    ],
    role: "api",
  });
  apps.push(app);
  return app;
}

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, doNotFake: [...DO_NOT_FAKE] });
});

afterEach(async () => {
  jest.useRealTimers();
  for (const app of apps.splice(0)) await app.close();
});

const groupOf = (body: { data: { groups: Group[] } }, id: string): Group | undefined => body.data.groups.find((group) => group.id === id);
const stationAt = (group: Group | undefined, arsId: string): Station | undefined => group?.screen.stations.find((station) => station.stationNumber === arsId);
const pastTtl = (): void => {
  jest.setSystemTime(NOW.getTime() + DATASET_CACHE_TTL_MS);
};

describe("GET /bus/config with the stored attributes", () => {
  it("takes each Jongro card, refresh interval and station's transfer lines from revision 1", async () => {
    // Arrange
    const app = await boot(storesHolding(routeAttributesFixture()));

    // Act
    const res = await request(app.getHttpServer()).get("/bus/config");

    // Assert
    expect(res.status).toBe(200);
    expect(groupOf(res.body, "jongro07")?.card).toMatchObject({ themeColor: "4CAF50", iconType: "village" });
    expect(groupOf(res.body, "jongro07")?.screen.refreshInterval).toBe(25);
    expect(stationAt(groupOf(res.body, "jongro02"), "01589")?.transferLines.map((line) => line.line)).toEqual(["1", "3", "5"]);
  });

  it("Card color changed: answers a revalidation a minute after the push with 200, the new color and a new ETag", async () => {
    // Arrange
    const stores = storesHolding(routeAttributesFixture());
    const app = await boot(stores);
    const before = await request(app.getHttpServer()).get("/bus/config");
    const groupBefore = await request(app.getHttpServer()).get("/bus/config/jongro08");
    const pushed = routeAttributesFixture();
    pushed.routes.jongro08 = { ...pushed.routes.jongro08!, themeColor: "1E88E5" };
    stores.attributes.storeAttributes(pushed);

    // Act
    const withinTtl = await request(app.getHttpServer()).get("/bus/config").set("If-None-Match", before.headers.etag);
    pastTtl();
    const after = await request(app.getHttpServer()).get("/bus/config").set("If-None-Match", before.headers.etag);
    const groupAfter = await request(app.getHttpServer()).get("/bus/config/jongro08").set("If-None-Match", groupBefore.headers.etag);

    // Assert
    expect(withinTtl.status).toBe(304);
    expect(after.status).toBe(200);
    expect(groupOf(after.body, "jongro08")?.card.themeColor).toBe("1E88E5");
    expect(after.headers.etag).toMatch(/^"[a-f0-9]{32}"$/);
    expect(after.headers.etag).not.toBe(before.headers.etag);
    expect(groupAfter.status).toBe(200);
    expect(groupAfter.body.data.card.themeColor).toBe("1E88E5");
    expect(groupAfter.headers.etag).not.toBe(groupBefore.headers.etag);
  });

  it("serves a pushed icon type and refresh interval for jongro02 once the TTL has passed", async () => {
    // Arrange
    const stores = storesHolding(routeAttributesFixture());
    const app = await boot(stores);
    await request(app.getHttpServer()).get("/bus/config");
    const pushed = routeAttributesFixture();
    pushed.routes.jongro02 = { ...pushed.routes.jongro02!, iconType: "town", refreshInterval: 30 };
    stores.attributes.storeAttributes(pushed);
    pastTtl();

    // Act
    const res = await request(app.getHttpServer()).get("/bus/config/jongro02");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.data.card.iconType).toBe("town");
    expect(res.body.data.screen.refreshInterval).toBe(30);
  });

  it("Transfer line added without a deploy: lists line 5 among jongro07's ARS 01220 transfer lines within 60 seconds", async () => {
    // Arrange
    const stores = storesHolding(routeAttributesFixture());
    const app = await boot(stores);
    await request(app.getHttpServer()).get("/bus/config");
    const pushed = routeAttributesFixture();
    const jongro07 = pushed.routes.jongro07!;
    const lines = [...jongro07.transferLinesByArsId["01220"]!, { line: "5", color: "996CAC" }];
    pushed.routes.jongro07 = { ...jongro07, transferLinesByArsId: { ...jongro07.transferLinesByArsId, "01220": lines } };
    stores.attributes.storeAttributes(pushed);
    pastTtl();

    // Act
    const res = await request(app.getHttpServer()).get("/bus/config");

    // Assert
    expect(stationAt(groupOf(res.body, "jongro07"), "01220")?.transferLines).toEqual([
      { line: "4", color: "00A5DE" },
      { line: "5", color: "996CAC" },
    ]);
  });

  it("Unchanged body: keeps the ETag after a push of a transfer line for an ARS number no stored station has", async () => {
    // Arrange
    const stores = storesHolding(routeAttributesFixture());
    const app = await boot(stores);
    const before = await request(app.getHttpServer()).get("/bus/config");
    const groupBefore = await request(app.getHttpServer()).get("/bus/config/jongro07");
    const pushed = routeAttributesFixture();
    const jongro07 = pushed.routes.jongro07!;
    pushed.routes.jongro07 = { ...jongro07, transferLinesByArsId: { ...jongro07.transferLinesByArsId, "09999": [{ line: "2", color: "00A84D" }] } };
    stores.attributes.storeAttributes(pushed);
    pastTtl();

    // Act
    const after = await request(app.getHttpServer()).get("/bus/config").set("If-None-Match", before.headers.etag);
    const groupAfter = await request(app.getHttpServer()).get("/bus/config/jongro07").set("If-None-Match", groupBefore.headers.etag);
    const reread = await request(app.getHttpServer()).get("/bus/config");

    // Assert
    expect(stores.attributes.readCount).toBe(2);
    expect(after.status).toBe(304);
    expect(groupAfter.status).toBe(304);
    expect(reread.headers.etag).toBe(before.headers.etag);
  });
});

describe("GET /bus/realtime/data/jongro07 with the stored seat count", () => {
  it("Seat count raised: serves a bus with 22 riders as normal on 18 seats, then relaxed within 60 seconds of a push of 25", async () => {
    // Arrange
    const stores = storesHolding(routeAttributesFixture());
    const riders = { vehId: "100000103", plainNo: "서울70사5537", rerideDiv: 2, rerideNum: 22 };
    stores.busCache.values.set("jongro_locations_07", [jongroPositionDoc({ sequence: "1", stationId: "100900220", vehicleId: "100000103" })]);
    stores.busCache.values.set("jongro_stations_07", [
      jongroArrivalDoc({ stationId: "100900221", sequence: "2", buses: [jongroArrivalBus({ ...riders, staOrd: 2, sectOrd: 1 }), noArrivalBus({ staOrd: 2 })] }),
    ]);
    const app = await boot(stores);
    const before = await request(app.getHttpServer()).get("/bus/realtime/data/jongro07");
    const pushed = routeAttributesFixture();
    pushed.routes.jongro07 = { ...pushed.routes.jongro07!, seatCount: 25 };
    stores.attributes.storeAttributes(pushed);
    pastTtl();

    // Act
    const after = await request(app.getHttpServer()).get("/bus/realtime/data/jongro07");

    // Assert
    expect(before.status).toBe(200);
    expect(before.body.data.stationEtas[0].arrivals[0]).toMatchObject({ passengerCount: 22, crowding: "normal" });
    expect(before.body.data.buses[0].tracked.crowding).toBe("normal");
    expect(after.body.data.stationEtas[0].arrivals[0]).toMatchObject({ passengerCount: 22, crowding: "relaxed" });
    expect(after.body.data.buses[0].tracked.crowding).toBe("relaxed");
  });
});

describe("a route the code serves with no stored attributes", () => {
  const withoutJongro08 = (): JongroRouteAttributesData => {
    const data = routeAttributesFixture();
    delete data.routes.jongro08;
    return data;
  };

  it("Deploy adds a route before its attributes: is left out of /bus/config, which answers 200", async () => {
    // Arrange
    const app = await boot(storesHolding(withoutJongro08()));

    // Act
    const res = await request(app.getHttpServer()).get("/bus/config");
    const group = await request(app.getHttpServer()).get("/bus/config/jongro08");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.data.groups.map((g: Group) => g.id)).toEqual(["hssc", "campus", "fasttrack", "commute", "jongro02", "jongro07"]);
    expect(group.status).toBe(404);
    expect(group.body.error.code).toBe("GROUP_NOT_FOUND");
  });

  it("is left out of /ui/home/transitlist and /ui/home/transit, which answer 200", async () => {
    // Arrange
    const app = await boot(storesHolding(withoutJongro08()));

    // Act
    const list = await request(app.getHttpServer()).get("/ui/home/transitlist");
    const tab = await request(app.getHttpServer()).get("/ui/home/transit");

    // Assert
    expect(list.status).toBe(200);
    expect(list.body.data.map((card: { groupId: string }) => card.groupId)).toEqual(["hssc", "campus", "commute", "jongro02", "jongro07"]);
    expect(tab.status).toBe(200);
    expect(JSON.stringify(tab.body)).not.toContain("jongro08");
    expect(JSON.stringify(tab.body)).toContain("bus:jongro07");
  });

  it("answers its realtime route with 503 JONGRO_ROUTE_ATTRIBUTES_UNAVAILABLE, and serves the others", async () => {
    // Arrange
    const app = await boot(storesHolding(withoutJongro08()));

    // Act
    const missing = await request(app.getHttpServer()).get("/bus/realtime/data/jongro08");
    const served = await request(app.getHttpServer()).get("/bus/realtime/data/jongro07");

    // Assert
    expect(missing.status).toBe(503);
    expect(missing.body.error).toEqual(UNAVAILABLE);
    expect(served.status).toBe(200);
  });
});

describe("attributes never read", () => {
  it.each([
    ["/bus/config"],
    ["/bus/config/jongro07"],
    ["/bus/config/hssc"],
    ["/ui/home/transit"],
    ["/ui/home/transitlist"],
    ["/bus/realtime/data/jongro02"],
    ["/bus/realtime/data/jongro07"],
    ["/bus/realtime/data/jongro08"],
  ])("Fresh replica: answers %s with 503 JONGRO_ROUTE_ATTRIBUTES_UNAVAILABLE and no Cache-Control", async (url) => {
    // Arrange
    const app = await boot(storesHolding(null));

    // Act
    const res = await request(app.getHttpServer()).get(url);

    // Assert
    expect(res.status).toBe(503);
    expect(res.body.error).toEqual(UNAVAILABLE);
    expect(res.headers["cache-control"]).toBeUndefined();
  });

  it("HSSC realtime needs no attributes: serves /bus/realtime/data/hssc with 200", async () => {
    // Arrange
    const stores = storesHolding(null);
    const app = await boot(stores);

    // Act
    const res = await request(app.getHttpServer()).get("/bus/realtime/data/hssc");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.data.groupId).toBe("hssc");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(stores.attributes.readCount).toBe(0);
  });
});

describe("the Jongro realtime poller with no attributes stored", () => {
  it("Pollers start without the dataset: registers one poller per route, and a tick writes the route's bus_cache keys", async () => {
    // Arrange
    const stores = storesHolding(null);
    const registered = jest.spyOn(PollerRegistryService.prototype, "registerPoller");
    let pollers: Map<string, () => unknown>;
    try {
      await boot(stores);
      pollers = new Map(registered.mock.calls.map(([fn, , name]) => [name, fn as () => unknown]));
    } finally {
      registered.mockRestore();
    }

    // Act
    await pollers.get("jongro-07")!();

    // Assert
    expect([...pollers.keys()].filter((name) => /^jongro-\d+$/.test(name))).toEqual(["jongro-02", "jongro-07", "jongro-08"]);
    expect(stores.busCache.values.get("jongro_stations_07")).toEqual([]);
    expect(stores.busCache.values.get("jongro_locations_07")).toEqual([]);
    expect(stores.jongroClient.positionsRouteIds).toEqual(["100900004"]);
    expect(stores.attributes.readCount).toBe(0);
  });
});
