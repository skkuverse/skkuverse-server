/**
 * GET /meals/cafeterias through the real controller, service and mapper, with
 * building's two repositories faked (meals reads only through building's
 * doors, BuildingCafeteriaListService and BuildingService).
 * What it guards: the campus query is required and validated, the body is
 * the campus's cafeterias joined to their buildings and matches its wire, the
 * envelope carries no `meta.lang` (the response is shared-cacheable), the
 * Cache-Control, and a failed read answering 500 instead of an empty list.
 */
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import type { CafeteriaDoc } from "../../../src/building/building.document";
import { BuildingCafeteriaListRepository } from "../../../src/building/cafeteria-list/building-cafeteria-list.repository";
import { BuildingRepository } from "../../../src/building/building.repository";
import { MealsCatalogModule } from "../../../src/meals/catalog/meals-catalog.module";
import { cafeteriaList } from "../../../src/meals/catalog/meals-catalog.wire";
import { expectWire } from "../../helpers/contracts/expect-wire";
import { FakeBuildingCafeteriaListRepository } from "../../helpers/fakes/building/building-cafeteria-list.repository.fake";
import { storedBuilding } from "../../helpers/building/buildings";
import { FakeBuildingRepository } from "../../helpers/fakes/building/building.repository.fake";
import { buildTestApp } from "../../helpers/nest/build-test-app";
import { RateLimitPolicy } from "../../../src/perimeter/perimeter.ports";
import { FakeRateLimitPolicy } from "../../helpers/fakes/perimeter/rate-limit-policy.fake";

let app: NestExpressApplication;
let httpServer: import("http").Server;
let buildings: FakeBuildingRepository;
let listedCafeterias: FakeBuildingCafeteriaListRepository;

const ANNIVERSARY_HALL = storedBuilding({
  _id: 2,
  buildNo: "101",
  campus: "hssc",
  name: { ko: "600주년기념관", en: "600th Anniversary Hall" },
});

function cafeteria(over: Partial<CafeteriaDoc>): CafeteriaDoc {
  return {
    _id: "10201030",
    kind: "cafeteria",
    campus: "hssc",
    name: { ko: "패컬티식당", en: "Faculty Dining Hall" },
    buildNo: "101",
    buildingName: { ko: "600주년기념관", en: "600th Anniversary Hall" },
    floor: { ko: "6층", en: "6F" },
    floorCode: "06",
    spaceCd: "10607A",
    location: { type: "Point", coordinates: [126.994501, 37.587584] },
    syncedAt: new Date(0),
    ...over,
  } as CafeteriaDoc;
}

beforeAll(async () => {
  buildings = new FakeBuildingRepository();
  listedCafeterias = new FakeBuildingCafeteriaListRepository();
  app = await buildTestApp({
    imports: [MealsCatalogModule],
    overrides: [
      { provide: RateLimitPolicy, useValue: new FakeRateLimitPolicy() },
      { provide: BuildingRepository, useValue: buildings },
      { provide: BuildingCafeteriaListRepository, useValue: listedCafeterias },
    ],
  });
  httpServer = app.getHttpServer();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  Object.assign(buildings, new FakeBuildingRepository());
  Object.assign(listedCafeterias, new FakeBuildingCafeteriaListRepository());
});

describe("GET /meals/cafeterias", () => {
  it("lists the campus's cafeterias with their buildings, as the wire publishes them", async () => {
    // Arrange
    buildings.buildings = [ANNIVERSARY_HALL];
    listedCafeterias.cafeterias = [
      cafeteria({ _id: "10201031", name: { ko: "은행골식당", en: "Eunhaenggol Restaurant" }, floor: { ko: "지하1층", en: "B1" } }),
      cafeteria({}),
      cafeteria({ _id: "20201040", campus: "nsc", buildNo: "204" as CafeteriaDoc["buildNo"] }),
    ];

    // Act
    const res = await request(httpServer).get("/meals/cafeterias?campus=hssc");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.meta).not.toHaveProperty("lang");
    expectWire(cafeteriaList, res.body.data);
    expect(res.body.data.cafeterias).toEqual([
      {
        id: "10201030",
        campus: "hssc",
        name: { ko: "패컬티식당", en: "Faculty Dining Hall" },
        building: { skkuId: 2, buildNo: "101", displayNo: "1", name: { ko: "600주년기념관", en: "600th Anniversary Hall" } },
        floor: { ko: "6층", en: "6F" },
        spaceCd: "10607A",
        location: { type: "Point", coordinates: [126.994501, 37.587584] },
      },
      expect.objectContaining({ id: "10201031", floor: { ko: "지하1층", en: "B1" } }),
    ]);
  });

  it("is shared-cacheable for an hour at the edge and five minutes in the app", async () => {
    // Act
    const res = await request(httpServer).get("/meals/cafeterias?campus=nsc");

    // Assert
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("public, max-age=300, s-maxage=3600");
    expect(res.body.data).toEqual({ cafeterias: [] });
  });

  it.each([
    ["no campus", "/meals/cafeterias"],
    ["an unknown campus", "/meals/cafeterias?campus=mars"],
    ["a repeated campus", "/meals/cafeterias?campus=hssc&campus=nsc"],
  ])("rejects %s with 400 INVALID_CAMPUS", async (_case, path) => {
    // Act
    const res = await request(httpServer).get(path);

    // Assert
    expect(res.status).toBe(400);
    expect(res.body.error).toEqual({ code: "INVALID_CAMPUS", message: "campus must be 'hssc' or 'nsc'" });
  });

  it("answers 500 when the cafeterias cannot be read, not an empty list", async () => {
    // Arrange
    listedCafeterias.failWith = new Error("mongo down");

    // Act
    const res = await request(httpServer).get("/meals/cafeterias?campus=hssc");

    // Assert
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe("INTERNAL_ERROR");
  });
});
