/**
 * The routes that serve the stored `bus-stops` dataset, over main.ts's
 * pipeline with every repository faked and the clock fixed at 12:00 KST on
 * 2026-10-20:
 *
 * - Never read: `/bus/config`, its `hssc`, `campus` and `commute` groups,
 *   `/ui/home/transit` and `/ui/home/transitlist` answer 503
 *   BUS_STOPS_UNAVAILABLE with no Cache-Control, while `fasttrack` and the
 *   realtime routes serve. The Jongro groups' stations name their stops, so
 *   `/bus/config/jongro02`, `jongro07` and `jongro08` answer that 503 too.
 * - A push that replaces a commute stop's photo reaches `/bus/config` and
 *   `/bus/config/commute`, ETag included, once the dataset TTL has passed, and
 *   leaves `/bus/config/hssc`'s ETag as it was.
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
import { BusStopsModule } from "../../../src/bus/stops/bus-stops.module";
import { BusStopsRepository } from "../../../src/bus/stops/bus-stops.repository";
import { Clock } from "../../../src/infra/clock";
import { DATASET_CACHE_TTL_MS } from "../../../src/shared/dataset.constants";
import { SchedulingModule } from "../../../src/scheduling/scheduling.module";
import { UiTransitListModule } from "../../../src/ui/transit-list/ui-transit-list.module";
import { UiTransitTabModule } from "../../../src/ui/transit/tab/ui-transit-tab.module";
import { UiTransitModule } from "../../../src/ui/transit/ui-transit.module";
import { UiTransitRepository } from "../../../src/ui/transit/ui-transit.repository";
import { UiModule } from "../../../src/ui/ui.module";
import { storedBusRegistryRepository } from "../../helpers/bus/bus-registry";
import { busStopsFixture } from "../../helpers/bus/bus-stops";
import { storedRouteAttributesRepository } from "../../helpers/bus/route-attributes";
import { FakeBusCacheRepository } from "../../helpers/fakes/bus/bus-cache.repository.fake";
import { FakeBusRealtimeJongroClient } from "../../helpers/fakes/bus/bus-realtime-jongro.client.fake";
import { FakeBusStopsRepository } from "../../helpers/fakes/bus/bus-stops.repository.fake";
import { FakeUiTransitRepository } from "../../helpers/fakes/ui/ui-transit.repository.fake";
import { buildTestApp } from "../../helpers/nest/build-test-app";

const transitLayoutFixture = require("../ui/fixtures/transit-layout.dataset.json") as Record<string, unknown>;

// WHY: 12:00 KST on 2026-10-20, so the commute card is open and the answer does not depend on the day the suite runs.
const NOW = new Date("2026-10-20T03:00:00.000Z");
const CLOCK: Clock = { now: () => new Date(Date.now()) };
const DO_NOT_FAKE = ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "setImmediate", "clearImmediate", "queueMicrotask", "nextTick", "performance"] as const;
const UNAVAILABLE = { code: "BUS_STOPS_UNAVAILABLE", message: "The bus stops are unavailable" };
const NEW_PHOTO = "https://media.skkuverse.com/stops/jeongja-exit3-2026-10.jpg";

function transitLayoutRepository(): FakeUiTransitRepository {
  const { _about, ...layout } = structuredClone(transitLayoutFixture);
  void _about;
  const repository = new FakeUiTransitRepository();
  repository.storeTransitLayout(layout);
  return repository;
}

function stopsHolding(data: unknown): FakeBusStopsRepository {
  const stops = new FakeBusStopsRepository();
  if (data !== null) stops.storeStops(data);
  return stops;
}

const apps: NestExpressApplication[] = [];

async function boot(stops: FakeBusStopsRepository): Promise<NestExpressApplication> {
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
      { provide: BusCacheRepository, useValue: new FakeBusCacheRepository() },
      { provide: BusRegistryRepository, useValue: storedBusRegistryRepository() },
      { provide: BusRouteAttributesRepository, useValue: storedRouteAttributesRepository() },
      { provide: BusStopsRepository, useValue: stops },
      { provide: BusRealtimeJongroClient, useValue: new FakeBusRealtimeJongroClient() },
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

describe("bus stops never read", () => {
  it.each(["/bus/config", "/bus/config/hssc", "/bus/config/campus", "/bus/config/commute", "/ui/home/transit", "/ui/home/transitlist"])(
    "Fresh replica, database down: answers %s with 503 BUS_STOPS_UNAVAILABLE and no Cache-Control",
    async (url) => {
      // Arrange
      const stops = stopsHolding(null);
      stops.failWith = new Error("server selection timed out");
      const app = await boot(stops);

      // Act
      const res = await request(app.getHttpServer()).get(url);

      // Assert
      expect(res.status).toBe(503);
      expect(res.body).toEqual({ error: UNAVAILABLE });
      expect(res.headers["cache-control"]).toBeUndefined();
    },
  );

  it.each(["/bus/config/jongro02", "/bus/config/jongro07", "/bus/config/jongro08"])(
    "Jongro group from wave 4: answers %s with 503 BUS_STOPS_UNAVAILABLE and no Cache-Control",
    async (url) => {
      // Arrange
      const app = await boot(stopsHolding(null));

      // Act
      const res = await request(app.getHttpServer()).get(url);

      // Assert
      expect(res.status).toBe(503);
      expect(res.body).toEqual({ error: UNAVAILABLE });
      expect(res.headers["cache-control"]).toBeUndefined();
    },
  );

  it.each(["/bus/config/fasttrack", "/bus/realtime/data/hssc", "/bus/realtime/data/jongro07"])(
    "Groups that read no stops: answers %s with 200 while no bus-stops is stored",
    async (url) => {
      // Arrange
      const app = await boot(stopsHolding(null));

      // Act
      const res = await request(app.getHttpServer()).get(url);

      // Assert
      expect(res.status).toBe(200);
    },
  );

  it("answers 404 GROUP_NOT_FOUND for an unknown group, not 503", async () => {
    // Arrange
    const app = await boot(stopsHolding(null));

    // Act
    const res = await request(app.getHttpServer()).get("/bus/config/nope");

    // Assert
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("GROUP_NOT_FOUND");
  });
});

describe("a bus-stops push", () => {
  function withNewPhoto(): Record<string, any> {
    const data = busStopsFixture() as Record<string, any>;
    const stop = data.stops.find((each: { id: string }) => each.id === "jeongja-exit3");
    stop.photo = { original: NEW_PHOTO };
    return data;
  }
  const photoOf = (group: { screen: { stops: Array<{ id: string; photoUrl?: string }> } }) => group.screen.stops.find((stop) => stop.id === "jeongja-exit3")?.photoUrl;

  it("Photo replaced: answers a revalidation of /bus/config and /bus/config/commute after the TTL with 200, the new photo and a new ETag", async () => {
    // Arrange
    const stops = stopsHolding(busStopsFixture());
    const app = await boot(stops);
    const config = await request(app.getHttpServer()).get("/bus/config");
    const commute = await request(app.getHttpServer()).get("/bus/config/commute");
    stops.storeStops(withNewPhoto());

    // Act
    const withinTtl = await request(app.getHttpServer()).get("/bus/config/commute").set("If-None-Match", commute.headers.etag);
    jest.setSystemTime(NOW.getTime() + DATASET_CACHE_TTL_MS);
    const configAfter = await request(app.getHttpServer()).get("/bus/config").set("If-None-Match", config.headers.etag);
    const commuteAfter = await request(app.getHttpServer()).get("/bus/config/commute").set("If-None-Match", commute.headers.etag);

    // Assert
    expect(withinTtl.status).toBe(304);
    expect(configAfter.status).toBe(200);
    expect(configAfter.headers.etag).not.toBe(config.headers.etag);
    expect(photoOf(configAfter.body.data.groups.find((group: { id: string }) => group.id === "commute"))).toBe(NEW_PHOTO);
    expect(commuteAfter.status).toBe(200);
    expect(commuteAfter.headers.etag).not.toBe(commute.headers.etag);
    expect(photoOf(commuteAfter.body.data)).toBe(NEW_PHOTO);
  });

  it("Unrelated group: keeps /bus/config/hssc's ETag after a push that changes a commute stop only", async () => {
    // Arrange
    const stops = stopsHolding(busStopsFixture());
    const app = await boot(stops);
    const before = await request(app.getHttpServer()).get("/bus/config/hssc");
    stops.storeStops(withNewPhoto());
    jest.setSystemTime(NOW.getTime() + DATASET_CACHE_TTL_MS);

    // Act
    const after = await request(app.getHttpServer()).get("/bus/config/hssc").set("If-None-Match", before.headers.etag);

    // Assert
    expect(stops.stored?.revision).toBe(2);
    expect(after.status).toBe(304);
  });
});
