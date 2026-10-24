/**
 * GET /meals through the real controller, service, mapper and catalog, with
 * building's two repositories, the menus repository and the clock faked.
 * What it guards: the crawler's 2026-10-14 documents and that day's
 * cafeterias serve exactly the bodies the app is coded against (the
 * meals-menus.dailyMeals contract fixtures) and match the wire; no date
 * serves today in KST; a date without menus still lists every cafeteria;
 * the campus and date are validated with their own codes; the envelope
 * carries no `meta.lang`; the Cache-Control; and a failed menus read
 * answering 500 instead of empty menus.
 */
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import catalogHssc from "../../../contracts/produced/fixtures/meals-catalog.cafeteriaList/hssc.json";
import catalogNsc from "../../../contracts/produced/fixtures/meals-catalog.cafeteriaList/nsc.json";
import dailyHssc from "../../../contracts/produced/fixtures/meals-menus.dailyMeals/hssc.json";
import dailyNsc from "../../../contracts/produced/fixtures/meals-menus.dailyMeals/nsc.json";
import type { BuildingDoc, CafeteriaDoc } from "../../../src/building/building.document";
import { BuildingRepository } from "../../../src/building/building.repository";
import { BuildingCafeteriaListRepository } from "../../../src/building/cafeteria-list/building-cafeteria-list.repository";
import { Clock } from "../../../src/infra/clock";
import { MealsCatalogModule } from "../../../src/meals/catalog/meals-catalog.module";
import { MealsMenusModule } from "../../../src/meals/menus/meals-menus.module";
import { MealsMenusRepository } from "../../../src/meals/menus/meals-menus.repository";
import { dailyMeals } from "../../../src/meals/menus/meals-menus.wire";
import { expectWire } from "../../helpers/contracts/expect-wire";
import { FakeBuildingCafeteriaListRepository } from "../../helpers/fakes/building/building-cafeteria-list.repository.fake";
import type { Campus } from "../../../src/building/building.types";
import { storedBuilding } from "../../helpers/building/buildings";
import { FakeBuildingRepository } from "../../helpers/fakes/building/building.repository.fake";
import { FakeMealsMenusRepository } from "../../helpers/fakes/meals/meals-menus.repository.fake";
import { buildTestApp } from "../../helpers/nest/build-test-app";
import crawlerDocs from "./fixtures/crawler-meal-docs-2026-10-14.json";

// WHY: 01:30 KST on Monday the 19th is still Sunday the 18th in UTC.
const CLOCK: Clock = { now: () => new Date("2026-10-18T16:30:00Z") };

type ListedCafeteria = (typeof catalogHssc.data.cafeterias)[number];

const LISTED = [...catalogHssc.data.cafeterias, ...catalogNsc.data.cafeterias] as ListedCafeteria[];

function toCafeteriaDoc(listed: ListedCafeteria): CafeteriaDoc {
  return {
    _id: listed.id,
    kind: "cafeteria",
    campus: listed.campus,
    name: listed.name,
    buildNo: listed.building!.buildNo,
    buildingName: listed.building!.name,
    floor: listed.floor,
    floorCode: null,
    spaceCd: listed.spaceCd,
    location: listed.location,
    syncedAt: new Date(0),
  } as CafeteriaDoc;
}

function toBuildingDoc(listed: ListedCafeteria): BuildingDoc {
  const { skkuId, buildNo, name } = listed.building!;
  return storedBuilding({ _id: skkuId, buildNo, campus: listed.campus as Campus, name });
}

let app: NestExpressApplication;
let httpServer: import("http").Server;
let buildings: FakeBuildingRepository;
let listedCafeterias: FakeBuildingCafeteriaListRepository;
let menus: FakeMealsMenusRepository;

beforeAll(async () => {
  buildings = new FakeBuildingRepository();
  listedCafeterias = new FakeBuildingCafeteriaListRepository();
  menus = new FakeMealsMenusRepository();
  app = await buildTestApp({
    imports: [MealsCatalogModule, MealsMenusModule],
    overrides: [
      { provide: BuildingRepository, useValue: buildings },
      { provide: BuildingCafeteriaListRepository, useValue: listedCafeterias },
      { provide: MealsMenusRepository, useValue: menus },
      { provide: Clock, useValue: CLOCK },
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
  Object.assign(menus, new FakeMealsMenusRepository());
  buildings.buildings = [...new Map(LISTED.map((c) => [c.building!.skkuId, toBuildingDoc(c)])).values()];
  listedCafeterias.cafeterias = LISTED.map(toCafeteriaDoc);
  menus.documents = crawlerDocs.documents as Array<Record<string, unknown>>;
});

describe("GET /meals", () => {
  it("serves the hssc menus of 2026-10-14 as the app is coded against them, as the wire publishes them", async () => {
    // Act
    const res = await request(httpServer).get("/meals?campus=hssc&date=2026-10-14");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.meta).toEqual({});
    expectWire(dailyMeals, res.body.data);
    expect(res.body.data).toEqual(dailyHssc.data);
  });

  it("serves the nsc menus of 2026-10-14 as the app is coded against them, the dormitories with meals: []", async () => {
    // Act
    const res = await request(httpServer).get("/meals?campus=nsc&date=2026-10-14");

    // Assert
    expect(res.status).toBe(200);
    expectWire(dailyMeals, res.body.data);
    expect(res.body.data).toEqual(dailyNsc.data);
    expect(res.body.data.cafeterias.filter((c: { meals: unknown[] }) => c.meals.length === 0).map((c: { id: string }) => c.id)).toEqual([
      "20201252",
      "20201253",
      "20201254",
    ]);
  });

  it("is shared-cacheable for ten minutes at the edge and five in the app", async () => {
    // Act
    const res = await request(httpServer).get("/meals?campus=hssc&date=2026-10-14");

    // Assert
    expect(res.headers["cache-control"]).toBe("public, max-age=300, s-maxage=600");
  });

  it("serves today in KST without a date, not the UTC date", async () => {
    // Arrange
    menus.documents = [
      { ...crawlerDocs.documents[0]!, _id: "10201030:2026-10-18:L", date: "2026-10-18" },
      { ...crawlerDocs.documents[0]!, _id: "10201030:2026-10-19:L", date: "2026-10-19" },
    ];

    // Act
    const res = await request(httpServer).get("/meals?campus=hssc");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.data.date).toBe("2026-10-19");
    expect(res.body.data.cafeterias[0].meals.map((m: { code: string }) => m.code)).toEqual(["L"]);
  });

  it("lists every cafeteria with meals: [] on a date without menus, never a 404", async () => {
    // Act
    const res = await request(httpServer).get("/meals?campus=hssc&date=2026-10-18");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      date: "2026-10-18",
      campus: "hssc",
      cafeterias: dailyHssc.data.cafeterias.map((c) => ({ ...c, meals: [] })),
    });
  });

  it.each([
    ["an impossible date", "/meals?campus=hssc&date=2026-02-30"],
    ["a malformed date", "/meals?campus=hssc&date=2026-10-1"],
    ["an empty date", "/meals?campus=hssc&date="],
    ["a repeated date", "/meals?campus=hssc&date=2026-10-14&date=2026-10-15"],
  ])("rejects %s with 400 INVALID_DATE", async (_case, path) => {
    // Act
    const res = await request(httpServer).get(path);

    // Assert
    expect(res.status).toBe(400);
    expect(res.body.error).toEqual({ code: "INVALID_DATE", message: "date must be a calendar date, YYYY-MM-DD" });
  });

  it.each([
    ["no campus", "/meals?date=2026-10-14"],
    ["an unknown campus", "/meals?campus=mars&date=2026-10-14"],
    ["no campus and a bad date", "/meals?date=nope"],
  ])("rejects %s with 400 INVALID_CAMPUS", async (_case, path) => {
    // Act
    const res = await request(httpServer).get(path);

    // Assert
    expect(res.status).toBe(400);
    expect(res.body.error).toEqual({ code: "INVALID_CAMPUS", message: "campus must be 'hssc' or 'nsc'" });
  });

  it("answers 500 when the menus cannot be read, not cafeterias without menus", async () => {
    // Arrange
    menus.failWith = new Error("mongo down");

    // Act
    const res = await request(httpServer).get("/meals?campus=hssc&date=2026-10-14");

    // Assert
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe("INTERNAL_ERROR");
  });
});
