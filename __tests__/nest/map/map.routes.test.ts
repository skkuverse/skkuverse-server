/**
 * The /map routes through the production pipeline (buildTestApp) and the real
 * controllers, services, layer-set config, rules and mappers, over in-memory
 * buildings, campus shapes, activations and places. What it guards: the
 * envelope and its language, one overlay collection per data source with pins
 * and geometry together, each route's Cache-Control (a day for the campus, none
 * stored for its degraded fallback, a minute for the event routes), `degraded`
 * never reaching the body, sibling routes answering only for themselves, and
 * the four retired URLs staying gone.
 */
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import type { BuildingDoc, CampusShapeDoc } from "../../../src/building/building.document";
import { BuildingRepository } from "../../../src/building/building.repository";
import { MapModule } from "../../../src/map/map.module";
import { FakeBuildingRepository } from "../../helpers/fakes/building/building.repository.fake";
import { buildTestApp } from "../../helpers/nest/build-test-app";

// The event map's activations and places, as the stored documents.
const mockActivations: Array<{ _id: string }> = [];
const mockPlaces: Array<Record<string, unknown>> = [];
jest.mock("../../../src/map/map-places.data", () => ({
  ensureIndexes: jest.fn(async () => undefined),
  findActiveActivation: jest.fn(async () => mockActivations[0] ?? null),
  getPlacesCollection: jest.fn(() => ({
    find: (filter: { layerSetId: string; detail?: unknown }) => ({
      toArray: async () =>
        mockPlaces.filter((p) => p.layerSetId === filter.layerSetId && (!("detail" in filter) || p.detail != null)),
    }),
  })),
}));

let app: NestExpressApplication;
let httpServer: import("http").Server;
let buildings: FakeBuildingRepository;

const SUSEON = {
  _id: 2,
  buildNo: "1",
  displayNo: "1",
  campus: "hssc",
  name: { ko: "수선관", en: "Suseon Hall" },
  location: { type: "Point", coordinates: [126.994479, 37.587361] },
} as unknown as BuildingDoc;

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
};

beforeAll(async () => {
  buildings = new FakeBuildingRepository();
  mockActivations.push({ _id: "eskara-2026" });
  mockPlaces.push(BOOTH);
  app = await buildTestApp({
    imports: [MapModule],
    overrides: [{ provide: BuildingRepository, useValue: buildings }],
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
    expect(res.body.meta).toEqual({ lang: "ko" });
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
    expect(res.body.meta).toEqual({ lang: "ko" });
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
    expect(en.body.meta).toEqual({ lang: "en" });
    expect(en.body.data).toEqual(ko.body.data);
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
    expect(res.body.meta).toEqual({ lang: "ko" });
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
