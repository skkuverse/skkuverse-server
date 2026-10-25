/**
 * The /map routes through the production pipeline (buildTestApp) and the real
 * controllers, services, rules and mappers, over in-memory buildings, campus
 * shapes, activations, places and the stored `map-layer-sets` dataset (its
 * fixture, revision 1). What it guards: the
 * envelope and its language, one overlay collection per data source with pins
 * and geometry together, each route's Cache-Control (a day for the campus, none
 * stored for its degraded fallback, a minute for the event routes), `degraded`
 * never reaching the body, sibling routes answering only for themselves, and
 * the four retired URLs staying gone. And the dataset's two answers no file
 * gave (ADR 0013, D6): with no layer set ever read, a live
 * festival serves the base map, not a 503; and a festival pushed and opened
 * while the app runs is served within the dataset TTL, with no restart.
 *
 * The mini app registry is the stored `miniapps` dataset, read through
 * FakeMiniappsRepository seeded from the dataset fixture
 * (__tests__/nest/miniapps/fixtures/miniapps.dataset.json).
 */
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import type { CampusShapeDoc } from "../../../src/building/building.document";
import { BuildingRepository } from "../../../src/building/building.repository";
import { MapCampusModule } from "../../../src/map/campus/map-campus.module";
import { MapConfigModule } from "../../../src/map/config/map-config.module";
import { MapEventDetailsModule } from "../../../src/map/event-details/map-event-details.module";
import { MapEventModule } from "../../../src/map/event/map-event.module";
import { MapLayerSetModule } from "../../../src/map/layer-set/map-layer-set.module";
import { MapLayerSetRepository } from "../../../src/map/layer-set/map-layer-set.repository";
import type { ActivationDoc, MapPlaceDoc } from "../../../src/map/map.document";
import { MapModule } from "../../../src/map/map.module";
import { MapRepository } from "../../../src/map/map.repository";
import { MiniappsRepository } from "../../../src/miniapps/miniapps.repository";
import { storedBuilding } from "../../helpers/building/buildings";
import { FakeBuildingRepository } from "../../helpers/fakes/building/building.repository.fake";
import { FakeMapLayerSetRepository } from "../../helpers/fakes/map/map-layer-set.repository.fake";
import { FakeMapRepository } from "../../helpers/fakes/map/map.repository.fake";
import { FakeMiniappsRepository } from "../../helpers/fakes/miniapps/miniapps.repository.fake";
import { fixtureRegistry } from "../../helpers/miniapps/registry-fixture";
import { fixtureLayerSetRepository, fixtureLayerSets } from "../../helpers/map/layer-sets-fixture";
import { DATASET_CACHE_TTL_MS } from "../../../src/shared/dataset.constants";
import { Clock } from "../../../src/infra/clock";
import { buildTestApp } from "../../helpers/nest/build-test-app";
import { expectWire } from "../../helpers/contracts/expect-wire";
import { mapConfig } from "../../../src/map/config/map-config.wire";
import { eventPlaceDetails } from "../../../src/map/event-details/map-event-details.wire";
import { mapOverlays } from "../../../src/map/map.wire";
import { RateLimitPolicy } from "../../../src/perimeter/perimeter.ports";
import { FakeRateLimitPolicy } from "../../helpers/fakes/perimeter/rate-limit-policy.fake";

let app: NestExpressApplication;
let httpServer: import("http").Server;
let buildings: FakeBuildingRepository;

const SUSEON = storedBuilding({
  _id: 2,
  buildNo: "101",
  campus: "hssc",
  name: { ko: "수선관", en: "Suseon Hall" },
  location: { type: "Point", coordinates: [126.994479, 37.587361] },
});

const FOOTPRINT = {
  _id: "bldg-2-footprint",
  campus: "hssc",
  layerId: "campus_geometry",
  geometry: {
    type: "Polygon",
    coordinates: [
      [
        [126.9944, 37.5873],
        [126.9954, 37.5873],
        [126.9954, 37.5883],
        [126.9944, 37.5883],
        [126.9944, 37.5873],
      ],
    ],
  },
  title: { ko: "수선관 외곽", en: "Suseon Hall Footprint" },
  skkuId: 2,
  order: 0,
} as unknown as CampusShapeDoc;

const BOOTH = {
  _id: "eskara-2026-booth-01",
  layerSetId: "eskara-2026",
  campus: "nsc",
  category: "booth",
  location: { type: "Point", coordinates: [126.971747, 37.294452] },
  title: { ko: "우끼끼친", en: "Ukkikki" },
  hours: [],
  fields: [],
  actions: [],
  order: 10,
  detail: {
    kind: "booth",
    org: null,
    isUnion: false,
    locationLabel: null,
    actions: [],
    blocks: [{ type: "text", id: "intro", title: null, body: { ko: "소개" } }],
  },
  updatedAt: new Date("2026-10-01T00:00:00.000Z"),
} as unknown as MapPlaceDoc;

// WHY: one fixed instant (12:00 KST, 2026-10-14), so the answers do not depend on the day the suite runs.
const CLOCK: Clock = { now: () => new Date("2026-10-14T03:00:00.000Z") };

beforeAll(async () => {
  buildings = new FakeBuildingRepository();
  const map = new FakeMapRepository();
  map.activations = [{ _id: "eskara-2026", activeFrom: null, activeUntil: null, enabled: true } as ActivationDoc];
  map.places = [BOOTH];
  app = await buildTestApp({
    imports: [MapModule, MapLayerSetModule, MapConfigModule, MapCampusModule, MapEventModule, MapEventDetailsModule],
    overrides: [
      { provide: RateLimitPolicy, useValue: new FakeRateLimitPolicy() },
      { provide: BuildingRepository, useValue: buildings },
      { provide: MapRepository, useValue: map },
      { provide: MapLayerSetRepository, useValue: fixtureLayerSetRepository() },
      { provide: MiniappsRepository, useValue: FakeMiniappsRepository.seededWith(fixtureRegistry()) },
      { provide: Clock, useValue: CLOCK },
    ],
    role: "api",
  });
  httpServer = app.getHttpServer();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  Object.assign(buildings, new FakeBuildingRepository());
});

describe("GET /map/config", () => {
  it("wraps the config in the meta/data envelope, Korean by default", async () => {
    // Act
    const res = await request(httpServer).get("/map/config");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.meta).toEqual({ lang: "ko" });
    expect(res.body.data.campuses.map((c: { label: string }) => c.label)).toEqual(["인사캠", "자과캠"]);
    expect(res.headers["x-response-time"]).toMatch(/ms$/);
  });

  it("serves the negotiated language", async () => {
    // Act
    const res = await request(httpServer).get("/map/config").set("Accept-Language", "en");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.meta).toEqual({ lang: "en" });
    expect(res.body.data.campuses[0].label).toBe("HSSC");
  });
});

describe("GET /map/overlays/campus", () => {
  it("serves building pins and campus geometry in ONE collection, cached for a day", async () => {
    // Arrange
    buildings.buildings = [SUSEON];
    buildings.campusShapes = [FOOTPRINT];

    // Act
    const res = await request(httpServer).get("/map/overlays/campus");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.meta).toEqual({});
    expect(res.body.data.overlays.map((o: { kind: string; layerId: string }) => [o.kind, o.layerId])).toEqual([
      ["marker", "building_numbers"],
      ["marker", "building_labels"],
      ["polygon", "campus_geometry"],
    ]);
    expect(res.body.data.overlays[0].tap).toEqual({ kind: "skku_building", placeId: "2" });
    expect(res.headers["cache-control"]).toBe("public, max-age=86400");
    expect(res.headers["x-response-time"]).toMatch(/ms$/);
  });

  it("refuses to let the degraded fallback be cached, and keeps `degraded` off the wire", async () => {
    // Act
    const res = await request(httpServer).get("/map/overlays/campus");

    // Assert
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body.data.overlays.length).toBeGreaterThan(0);
    expect(res.body.data.overlays.every((o: { tap: unknown }) => o.tap === null)).toBe(true);
    expect(Object.keys(res.body.data)).toEqual(["overlays"]);
  });
});

describe("GET /map/overlays/event", () => {
  it("serves the live layer set's places as overlays, cached for a minute", async () => {
    // Act
    const res = await request(httpServer).get("/map/overlays/event");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.meta).toEqual({});
    expect(Object.keys(res.body.data)).toEqual(["overlays"]);
    expect(res.body.data.overlays).toHaveLength(1);
    expect(res.body.data.overlays[0]).toMatchObject({
      kind: "marker",
      id: "eskara-2026-booth-01",
      layerId: "eskara26_booth",
      tap: { kind: "event", placeId: "eskara-2026-booth-01" },
    });
    expect(res.headers["cache-control"]).toBe("public, max-age=60");
    expect(res.headers["x-response-time"]).toMatch(/ms$/);
  });

  it("serves one body for every language, so the edge cache holds one copy", async () => {
    // Act
    const ko = await request(httpServer).get("/map/overlays/event");
    const en = await request(httpServer).get("/map/overlays/event").set("Accept-Language", "en");

    // Assert
    expect(en.body.meta).toEqual({});
    expect(en.body).toEqual(ko.body);
    expect(en.body.data.overlays[0].text).toEqual({ ko: "우끼끼친", en: "Ukkikki" });
  });

  it("does not answer for its details sibling", async () => {
    // Act
    const res = await request(httpServer).get("/map/overlays/event");

    // Assert
    expect(res.body.data).not.toHaveProperty("details");
    expect(res.body.data.overlays[0]).not.toHaveProperty("blocks");
  });
});

describe("GET /map/overlays/event/details", () => {
  it("serves each place's sheet keyed by place id, on the event route's minute", async () => {
    // Act
    const res = await request(httpServer).get("/map/overlays/event/details");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.meta).toEqual({});
    expect(Object.keys(res.body.data)).toEqual(["details"]);
    expect(res.body.data.details["eskara-2026-booth-01"]).toMatchObject({
      placeId: "eskara-2026-booth-01",
      kind: "booth",
      blocks: [{ type: "text", id: "intro", title: null, body: { ko: "소개", en: "소개" } }],
    });
    expect(res.headers["cache-control"]).toBe("public, max-age=60");
    expect(res.headers["x-response-time"]).toMatch(/ms$/);
  });
  it("is its own route: the event route's overlays are not served here", async () => {
    // Act
    const res = await request(httpServer).get("/map/overlays/event/details");

    // Assert
    expect(res.body.data).not.toHaveProperty("overlays");
    expect(Object.keys(res.body.data.details)).toEqual(["eskara-2026-booth-01"]);
  });
});

describe("the routes this replaced", () => {
  // The two /map/markers/* routes became the overlay collections above; the two
  // legacy /map/overlays handlers were deleted, and the second one's
  // @Get(":overlayId") would have swallowed /map/overlays/campus.
  it.each(["/map/markers/campus", "/map/markers/event", "/map/overlays?category=hssc", "/map/overlays/jongro07"])(
    "404s %s",
    async (url) => {
      // Act
      const res = await request(httpServer).get(url);

      // Assert
      expect(res.status).toBe(404);
    },
  );
});

/**
 * Each served body against its wire schema (PR 219 F2): the contract fixtures were captured once,
 * so a field the mappers start to serve without a wire declaring it shows only here.
 */
describe("/map bodies against their wire schemas", () => {
  it("serves /map/config as mapConfig declares", async () => {
    // Act
    const res = await request(httpServer).get("/map/config");

    // Assert
    expect(res.status).toBe(200);
    expectWire(mapConfig, res.body.data);
  });

  it("serves /map/overlays/campus as mapOverlays declares, pins and geometry both", async () => {
    // Arrange
    buildings.buildings = [SUSEON];
    buildings.campusShapes = [FOOTPRINT];

    // Act
    const res = await request(httpServer).get("/map/overlays/campus");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.data.overlays.map((o: { kind: string }) => o.kind)).toContain("polygon");
    expectWire(mapOverlays, res.body.data);
  });

  it("serves /map/overlays/event as mapOverlays declares", async () => {
    // Act
    const res = await request(httpServer).get("/map/overlays/event");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.data.overlays).toHaveLength(1);
    expectWire(mapOverlays, res.body.data);
  });

  it("serves /map/overlays/event/details as eventPlaceDetails declares", async () => {
    // Act
    const res = await request(httpServer).get("/map/overlays/event/details");

    // Assert
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.data.details)).toEqual(["eskara-2026-booth-01"]);
    expectWire(eventPlaceDetails, res.body.data);
  });
});

/** An app over its own fakes, so its caches start cold: the map's activations and places, and the stored layer sets. */
async function bootMapApp(map: FakeMapRepository, layerSets: FakeMapLayerSetRepository): Promise<NestExpressApplication> {
  return buildTestApp({
    imports: [MapModule, MapLayerSetModule, MapConfigModule, MapCampusModule, MapEventModule, MapEventDetailsModule],
    overrides: [
      { provide: RateLimitPolicy, useValue: new FakeRateLimitPolicy() },
      { provide: BuildingRepository, useValue: new FakeBuildingRepository() },
      { provide: MapRepository, useValue: map },
      { provide: MapLayerSetRepository, useValue: layerSets },
      { provide: MiniappsRepository, useValue: FakeMiniappsRepository.seededWith(fixtureRegistry()) },
      { provide: Clock, useValue: CLOCK },
    ],
    role: "api",
  });
}

const BASE_LAYER_IDS = ["building_numbers", "building_labels", "campus_geometry", "jongro02_route", "jongro08_route", "jongro07_route", "hssc_route"];
const BASE_CHIP_IDS = ["building_map", "building_code", "lost_found", "inquiry"];

describe("the map routes with a festival live and no layer set ever read", () => {
  let missingApp: NestExpressApplication;

  beforeAll(async () => {
    const map = new FakeMapRepository();
    map.activations = [{ _id: "eskara-2026", activeFrom: null, activeUntil: null, enabled: true } as ActivationDoc];
    map.places = [BOOTH];
    missingApp = await bootMapApp(map, new FakeMapLayerSetRepository());
  });

  afterAll(async () => {
    await missingApp.close();
  });

  it("serves /map/config with the base layers and chips, not a 503", async () => {
    // Act
    const res = await request(missingApp.getHttpServer()).get("/map/config");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.data.layers.map((l: { id: string }) => l.id)).toEqual(BASE_LAYER_IDS);
    expect(res.body.data.chips.map((c: { id: string }) => c.id)).toEqual(BASE_CHIP_IDS);
    expect(res.headers["cache-control"]).toBeUndefined();
  });

  it("serves /map/overlays/event with no overlay and /map/overlays/event/details with no sheet", async () => {
    // Act
    const overlays = await request(missingApp.getHttpServer()).get("/map/overlays/event");
    const details = await request(missingApp.getHttpServer()).get("/map/overlays/event/details");

    // Assert
    expect(overlays.status).toBe(200);
    expect(overlays.body).toEqual({ meta: {}, data: { overlays: [] } });
    expect(details.status).toBe(200);
    expect(details.body).toEqual({ meta: {}, data: { details: {} } });
  });
});

describe("a festival pushed and opened while the app runs", () => {
  const T0 = new Date("2026-10-14T03:00:00.000Z");
  const SPRING_PLACE = { ...BOOTH, _id: "spring-2027-booth-01", layerSetId: "spring-2027", title: { ko: "봄 부스" } } as MapPlaceDoc;
  let liveApp: NestExpressApplication;
  let map: FakeMapRepository;
  let layerSets: FakeMapLayerSetRepository;

  beforeEach(async () => {
    // Only Date is faked: the caches read Date.now(), and the HTTP stack keeps its real timers.
    jest.useFakeTimers({ now: T0, doNotFake: ["nextTick", "setImmediate", "clearImmediate", "setTimeout", "clearTimeout", "setInterval", "clearInterval", "queueMicrotask", "hrtime", "performance"] });
    map = new FakeMapRepository();
    layerSets = fixtureLayerSetRepository();
    liveApp = await bootMapApp(map, layerSets);
  });

  afterEach(async () => {
    await liveApp.close();
    jest.useRealTimers();
  });

  it("serves its layers, chips and places within the dataset TTL of the push and the window, with no restart", async () => {
    // Arrange
    const before = await request(liveApp.getHttpServer()).get("/map/config");
    const pushed = fixtureLayerSets();
    pushed.layerSets.push({ ...structuredClone(pushed.layerSets[0]!), layerSetId: "spring-2027", name: { ko: "봄 축제", en: "Spring Festival" }, emoji: "🌸" });
    layerSets.storeLayerSets(pushed);
    map.places = [SPRING_PLACE];
    map.activations = [{ _id: "spring-2027", activeFrom: null, activeUntil: null, enabled: true } as ActivationDoc];
    jest.setSystemTime(T0.getTime() + DATASET_CACHE_TTL_MS);
    // The activation cache serves its expired answer once while it re-reads behind it.
    await request(liveApp.getHttpServer()).get("/map/config");
    await new Promise((resolve) => setImmediate(resolve));

    // Act
    const config = await request(liveApp.getHttpServer()).get("/map/config").set("Accept-Language", "en");
    const overlays = await request(liveApp.getHttpServer()).get("/map/overlays/event");

    // Assert
    expect(before.body.data.chips.map((c: { id: string }) => c.id)).toEqual(BASE_CHIP_IDS);
    expect(config.status).toBe(200);
    expect(config.body.data.chips.map((c: { id: string }) => c.id)).toEqual(expect.arrayContaining([...BASE_CHIP_IDS, "spring-2027_all"]));
    expect(config.body.data.chips.find((c: { id: string }) => c.id === "spring-2027_all")).toMatchObject({ icon: { kind: "emoji", emoji: "🌸" }, label: "Spring Festival" });
    expect(config.body.data.layers.filter((l: { chipGroupId: string | null }) => l.chipGroupId === "spring-2027").length).toBeGreaterThan(0);
    expect(overlays.body.data.overlays.map((o: { id: string }) => o.id)).toEqual(["spring-2027-booth-01"]);
  });

  it("keeps the /map/config ETag across a revision that serves the same body, and changes it with one that does not", async () => {
    // Arrange
    map.activations = [{ _id: "eskara-2026", activeFrom: null, activeUntil: null, enabled: true } as ActivationDoc];
    const first = await request(liveApp.getHttpServer()).get("/map/config");
    const withDormantSet = fixtureLayerSets();
    withDormantSet.layerSets.push({ ...structuredClone(withDormantSet.layerSets[0]!), layerSetId: "spring-2027" });
    layerSets.storeLayerSets(withDormantSet);
    jest.setSystemTime(T0.getTime() + DATASET_CACHE_TTL_MS);
    const sameBody = await request(liveApp.getHttpServer()).get("/map/config");
    const restyled = fixtureLayerSets();
    restyled.layerSets[0]!.emoji = "🎆";
    layerSets.storeLayerSets(restyled);
    jest.setSystemTime(T0.getTime() + 2 * DATASET_CACHE_TTL_MS);

    // Act
    const changed = await request(liveApp.getHttpServer()).get("/map/config");

    // Assert
    expect(layerSets.readCount).toBe(3);
    expect(sameBody.text).toBe(first.text);
    expect(sameBody.headers.etag).toBe(first.headers.etag);
    expect(changed.text).toContain("🎆");
    expect(changed.headers.etag).not.toBe(first.headers.etag);
  });
});
