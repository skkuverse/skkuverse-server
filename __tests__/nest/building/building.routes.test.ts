/**
 * The /building routes through the real controllers, services, rules and
 * mappers, with an in-memory fake per repository (ADR 0011, D2 and D3). What
 * it guards: query validation and its error bodies, the campus filter and labels per language, the English fallback, search
 * grouping and meta, the detail's floors, connections and cafeterias, an internal error's
 * body, and the Cache-Control a response may or may not carry.
 */
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import type { BuildingDoc, SpaceDoc } from "../../../src/building/building.document";
import { BuildingRepository } from "../../../src/building/building.repository";
import { BuildingCatalogRepository } from "../../../src/building/catalog/building-catalog.repository";
import { BuildingSearchRepository } from "../../../src/building/search/building-search.repository";
import { FakeBuildingCatalogRepository } from "../../helpers/fakes/building/building-catalog.repository.fake";
import { FakeBuildingRepository } from "../../helpers/fakes/building/building.repository.fake";
import { FakeBuildingSearchRepository } from "../../helpers/fakes/building/building-search.repository.fake";
import { buildTestApp } from "../../helpers/nest/build-test-app";
import { expectWire } from "../../helpers/contracts/expect-wire";
import { SERVED_BUILDING_PROJECTION } from "../../../src/building/building.query";
import { buildingDetail, buildingList } from "../../../src/building/catalog/building-catalog.wire";
import { buildingSearchData, buildingSearchMeta } from "../../../src/building/search/building-search.wire";
import { BuildingCatalogModule } from "../../../src/building/catalog/building-catalog.module";
import { BuildingSearchModule } from "../../../src/building/search/building-search.module";

let app: NestExpressApplication;
let httpServer: import("http").Server;
let buildings: FakeBuildingRepository;
let catalog: FakeBuildingCatalogRepository;
let search: FakeBuildingSearchRepository;

function building(_id: number, buildNo: string | null, campus: "hssc" | "nsc", ko: string, en: string): BuildingDoc {
  return { _id, buildNo, campus, name: { ko, en } } as BuildingDoc;
}

function room(spaceCd: string, buildNo: string, campus: "hssc" | "nsc", over: Partial<SpaceDoc> = {}): SpaceDoc {
  return {
    spaceCd,
    buildNo,
    campus,
    name: { ko: `강의실 ${spaceCd}`, en: "" },
    buildingName: { ko: `건물 ${buildNo}`, en: "" },
    floor: { ko: "1층", en: "" },
    conspaceCd: null,
    ...over,
  } as SpaceDoc;
}

const LAW = building(1, "100", "hssc", "법학관", "Law");
const ENGINEERING = building(2, "200", "nsc", "공학관", "Eng");

beforeAll(async () => {
  buildings = new FakeBuildingRepository();
  catalog = new FakeBuildingCatalogRepository();
  search = new FakeBuildingSearchRepository();
  app = await buildTestApp({
    // app.module.ts order: search registers /building/search before catalog's /building/:skkuId.
    imports: [BuildingSearchModule, BuildingCatalogModule],
    overrides: [
      { provide: BuildingRepository, useValue: buildings },
      { provide: BuildingCatalogRepository, useValue: catalog },
      { provide: BuildingSearchRepository, useValue: search },
    ],
  });
  httpServer = app.getHttpServer();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  Object.assign(buildings, new FakeBuildingRepository());
  Object.assign(catalog, new FakeBuildingCatalogRepository());
  Object.assign(search, new FakeBuildingSearchRepository());
});

describe("GET /building/list", () => {
  it("lists both campuses with Korean campus labels by default", async () => {
    // Arrange
    buildings.buildings = [LAW, ENGINEERING];

    // Act
    const res = await request(httpServer).get("/building/list");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.meta.lang).toBe("ko");
    expect(res.body.data.buildings.map((b: BuildingDoc & { campusLabel: string }) => [b._id, b.campusLabel])).toEqual([
      [1, "인사캠"],
      [2, "자과캠"],
    ]);
  });

  it("filters by campus=hssc and labels in English for an English request", async () => {
    // Arrange
    buildings.buildings = [LAW, ENGINEERING];

    // Act
    const res = await request(httpServer).get("/building/list?campus=hssc").set("Accept-Language", "en-US");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.meta.lang).toBe("en");
    expect(res.body.data.buildings).toEqual([{ ...LAW, campusLabel: "HSSC" }]);
  });

  it("filters by campus=nsc", async () => {
    // Arrange
    buildings.buildings = [LAW, ENGINEERING];

    // Act
    const res = await request(httpServer).get("/building/list?campus=nsc");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.data.buildings.map((b: BuildingDoc) => b._id)).toEqual([2]);
  });

  it("rejects an unknown campus with 400 INVALID_CAMPUS", async () => {
    // Act
    const res = await request(httpServer).get("/building/list?campus=mars");

    // Assert
    expect(res.status).toBe(400);
    expect(res.body.error).toEqual({ code: "INVALID_CAMPUS", message: "campus must be 'hssc' or 'nsc'" });
  });
});

describe("GET /building/search", () => {
  it.each([
    ["no q", "/building/search"],
    ["a whitespace-only q", "/building/search?q=%20%20%20"],
    ["a repeated q", "/building/search?q=a&q=b"],
  ])("rejects %s with 400 MISSING_QUERY", async (_case, path) => {
    // Act
    const res = await request(httpServer).get(path);

    // Assert
    expect(res.status).toBe(400);
    expect(res.body.error).toEqual({ code: "MISSING_QUERY", message: "q parameter is required" });
    expect(search.searches).toEqual([]);
  });

  it("rejects an unknown campus with 400 INVALID_CAMPUS", async () => {
    // Act
    const res = await request(httpServer).get("/building/search?q=law&campus=mars");

    // Assert
    expect(res.status).toBe(400);
    expect(res.body.error).toEqual({ code: "INVALID_CAMPUS", message: "campus must be 'hssc' or 'nsc'" });
  });

  it("returns buildings, rooms grouped by building and per-campus counts", async () => {
    // Arrange
    search.buildings = { items: [LAW] };
    search.spaces = { items: [room("100-A101", "100", "hssc")] };
    buildings.buildings = [LAW];

    // Act
    const res = await request(httpServer).get("/building/search?q=%EB%B2%95");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.meta).toMatchObject({
      keyword: "법",
      buildingCount: 1,
      spaceCount: 1,
      counts: { building: { hssc: 1, nsc: 0, total: 1 }, space: { hssc: 1, nsc: 0, total: 1 } },
    });
    expect(res.body.data.buildings[0].campusLabel).toBe("인사캠");
    expect(res.body.data.spaces).toHaveLength(1);
    expect(res.body.data.spaces[0]).toMatchObject({
      skkuId: 1,
      buildNo: "100",
      displayNo: "0",
      campusLabel: "인사캠",
      items: [{ spaceCd: "100-A101" }],
    });
  });

  it("shows the Korean name where a room has no English one", async () => {
    // Arrange
    search.spaces = { items: [room("100-A101", "100", "hssc")] };

    // Act
    const res = await request(httpServer).get("/building/search?q=law").set("Accept-Language", "en");

    // Assert
    expect(res.body.data.spaces[0].items[0].name).toEqual({ ko: "강의실 100-A101", en: "강의실 100-A101" });
  });

  it("returns empty lists and zero counts when nothing matches", async () => {
    // Act
    const res = await request(httpServer).get("/building/search?q=zzz");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ buildings: [], spaces: [] });
    expect(res.body.meta).toMatchObject({ buildingCount: 0, spaceCount: 0 });
  });

  it("narrows the rows to the campus asked for, while the counts still cover both campuses", async () => {
    // Arrange
    search.buildings = { items: [LAW, ENGINEERING] };
    search.spaces = { items: [room("100-A101", "100", "hssc"), room("200-B101", "200", "nsc")] };

    // Act
    const res = await request(httpServer).get("/building/search?q=law&campus=hssc");

    // Assert
    expect(res.body.data.buildings.map((b: BuildingDoc) => b._id)).toEqual([1]);
    expect(res.body.data.spaces.map((g: { buildNo: string }) => g.buildNo)).toEqual(["100"]);
    expect(res.body.meta.counts).toEqual({
      building: { hssc: 1, nsc: 1, total: 2 },
      space: { hssc: 1, nsc: 1, total: 2 },
    });
  });

  it("counts rooms, not groups, in spaceCount", async () => {
    // Arrange
    // The app shows spaceCount in the section header over the grouped list.
    search.spaces = { items: [room("10001", "100", "hssc"), room("10002", "100", "hssc")] };

    // Act
    const res = await request(httpServer).get("/building/search?q=100");

    // Assert
    expect(res.body.meta.spaceCount).toBe(2);
    expect(res.body.data.spaces).toHaveLength(1);
    expect(res.body.data.spaces[0].items).toHaveLength(2);
  });

  it("keeps room groups in row order, so the relevance ranking survives grouping", async () => {
    // Arrange
    search.spaces = { items: [room("27101", "227", "nsc"), room("95127", "295", "nsc"), room("27102", "227", "nsc")] };

    // Act
    const res = await request(httpServer).get("/building/search?q=27");

    // Assert
    expect(res.body.data.spaces.map((g: { buildNo: string }) => g.buildNo)).toEqual(["227", "295"]);
  });

  it("reports truncation in meta.limits without changing meta.counts", async () => {
    // Arrange
    search.spaces = { items: [], counts: { hssc: 0, nsc: 6173, total: 6173 }, total: 6173, truncated: true };

    // Act
    const res = await request(httpServer).get("/building/search?q=%EC%8B%A4");

    // Assert
    expect(res.body.meta.counts.space.total).toBe(6173);
    expect(res.body.meta.limits.space).toEqual({ limit: 1000, total: 6173, truncated: true });
  });
});

describe("GET /building/:skkuId", () => {
  it.each(["abc", "0"])("rejects skkuId %j with 400 INVALID_ID before any read", async (skkuId) => {
    // Act
    const res = await request(httpServer).get(`/building/${skkuId}`);

    // Assert
    expect(res.status).toBe(400);
    expect(res.body.error).toEqual({ code: "INVALID_ID", message: "skkuId must be a positive integer" });
    expect(catalog.reads).toEqual([]);
  });

  it("answers 404 NOT_FOUND naming the id when no building matches", async () => {
    // Act
    const res = await request(httpServer).get("/building/999");

    // Assert
    expect(res.status).toBe(404);
    expect(res.body.error).toEqual({ code: "NOT_FOUND", message: "Building 999 not found" });
  });

  it("returns the building, its own floors and its connections, labelled and with the English fallback", async () => {
    // Arrange
    catalog.buildings = [LAW, building(2, "101", "hssc", "경영관", "Business")];
    catalog.spaces = [room("100-A101", "100", "hssc"), room("101-B101", "101", "hssc")];
    catalog.connections = [{ a: { skkuId: 1, floor: { ko: "1층", en: "1F" } }, b: { skkuId: 2, floor: { ko: "2층", en: "2F" } } }] as never;

    // Act
    const res = await request(httpServer).get("/building/1");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.data.building).toMatchObject({ _id: 1, campusLabel: "인사캠" });
    expect(res.body.data.floors).toEqual([
      { floor: { ko: "1층", en: "1층" }, spaces: [{ spaceCd: "100-A101", name: { ko: "강의실 100-A101", en: "강의실 100-A101" }, conspaceCd: null }] },
    ]);
    expect(res.body.data.connections).toEqual([
      {
        targetSkkuId: 2,
        targetBuildNo: "101",
        targetDisplayNo: null,
        targetName: { ko: "경영관", en: "Business" },
        fromFloor: { ko: "1층", en: "1F" },
        toFloor: { ko: "2층", en: "2F" },
      },
    ]);
  });

  it("never sends a building's sync bookkeeping or its unread extensions", async () => {
    // Arrange
    const synced = {
      ...LAW,
      sync: { detailError: "HTTP 500", detailAt: new Date("2026-10-10T00:00:00Z") },
      enrichVersion: 3,
      extensions: { indoorMap: "reserved" },
    } as BuildingDoc;
    catalog.buildings = [synced];
    buildings.buildings = [synced];

    // Act
    const detail = await request(httpServer).get("/building/1");
    const list = await request(httpServer).get("/building/list");

    // Assert
    expect(detail.body.data.building).not.toHaveProperty("sync");
    expect(detail.body.data.building).not.toHaveProperty("enrichVersion");
    // No client reads extensions: skkuverse-app's parser falls back to {} (packages/shared/src/building/parser.ts).
    expect(detail.body.data.building).not.toHaveProperty("extensions");
    expect(list.body.data.buildings[0]).not.toHaveProperty("sync");
    expect(list.body.data.buildings[0]).not.toHaveProperty("enrichVersion");
    expect(list.body.data.buildings[0]).not.toHaveProperty("extensions");
  });

  it("answers 500 INTERNAL_ERROR when a space has no floor", async () => {
    // Arrange
    catalog.buildings = [LAW];
    catalog.spaces = [{ spaceCd: "100-A101", buildNo: "100", campus: "hssc", name: { ko: "강의실", en: "" } } as SpaceDoc];

    // Act
    const res = await request(httpServer).get("/building/1");

    // Assert
    expect(res.status).toBe(500);
    expect(res.body.error).toEqual({ code: "INTERNAL_ERROR", message: "Internal server error" });
  });
});

describe("GET /building/:skkuId at the safe-integer limit", () => {
  it.each([
    ["an id too long for a double", "9".repeat(400)],
    ["2^53 + 1, which parseInt rounds to 2^53", "9007199254740993"],
  ])("rejects %s with 400 INVALID_ID before any read", async (_case, skkuId) => {
    // Act
    const res = await request(httpServer).get(`/building/${skkuId}`);

    // Assert
    expect(res.status).toBe(400);
    expect(res.body.error).toEqual({ code: "INVALID_ID", message: "skkuId must be a positive integer" });
    expect(catalog.reads).toEqual([]);
  });

  it.each(["999", "9007199254740991"])("answers 404 NOT_FOUND for the unknown but valid id %s", async (skkuId) => {
    // Act
    const res = await request(httpServer).get(`/building/${skkuId}`);

    // Assert
    expect(res.status).toBe(404);
    expect(res.body.error).toEqual({ code: "NOT_FOUND", message: `Building ${skkuId} not found` });
  });
});

/**
 * A building response may be cached by clients for 300 s, matching the
 * repository's in-process cache TTL, and varies by language. An error is never
 * cacheable. CACHE=off turning this into no-store is no-store.middleware.spec's
 * case: this builder does not mount that middleware.
 */
describe("Cache-Control on /building/*", () => {
  it.each(["/building/list", "/building/list?campus=hssc", "/building/1", "/building/search?q=law"])(
    "lets the client alone cache %s for five minutes, since it is in the request's language",
    async (path) => {
      // Arrange
      buildings.buildings = [LAW];
      catalog.buildings = [LAW];

      // Act
      const res = await request(httpServer).get(path);

      // Assert
      expect(res.status).toBe(200);
      expect(res.headers["cache-control"]).toBe("private, max-age=300");
      expect(res.headers.vary).toMatch(/Accept-Language/i);
    },
  );

  it.each([
    ["an invalid campus", "/building/list?campus=mars", 400, () => undefined],
    ["a missing query", "/building/search", 400, () => undefined],
    ["an invalid id", "/building/abc", 400, () => undefined],
    ["an unknown building", "/building/999", 404, () => undefined],
    ["a failed read", "/building/1", 500, () => (catalog.failWith = new Error("pool closed"))],
  ])("sends no Cache-Control on %s", async (_case, path, status, arrangeFailure) => {
    // Arrange
    catalog.buildings = [LAW];
    arrangeFailure();

    // Act
    const res = await request(httpServer).get(path);

    // Assert
    expect(res.status).toBe(status);
    expect(res.headers["cache-control"]).toBeUndefined();
  });
});

/**
 * Each served body against its wire schema (PR 219 F2): the contract fixtures were captured once,
 * so a field the mappers start to serve without a wire declaring it shows only here. The documents
 * carry every stored field, the sync bookkeeping and enrichVersion included.
 */
describe("/building bodies against their wire schemas", () => {
  const STORED: BuildingDoc = {
    ...building(1, "100", "hssc", "법학관", "Law"),
    displayNo: null,
    type: "building",
    description: { ko: "법학관 설명", en: "" },
    location: { type: "Point", coordinates: [126.99, 37.58] },
    image: { url: null, filename: null },
    attachments: [{ id: 1, url: "https://example.com/a.jpg", filename: "a.jpg", alt: "" }],
    accessibility: { elevator: true, toilet: false, detail: { sections: [] } },
    enrichVersion: 3,
    skkuCreatedAt: "2018-04-23T00:34:04.000+00:00",
    skkuUpdatedAt: null,
    sync: { listAt: new Date("2026-10-01T00:00:00Z"), detailAt: null, detailError: null },
    updatedAt: new Date("2026-10-01T00:00:00Z"),
    extensions: {},
  } as BuildingDoc;

  it("serves /building/list as buildingList declares", async () => {
    // Arrange
    buildings.buildings = [STORED];

    // Act
    const res = await request(httpServer).get("/building/list");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.data.buildings).toHaveLength(1);
    expectWire(buildingList, res.body.data);
  });

  it("serves /building/:skkuId as buildingDetail declares", async () => {
    // Arrange
    catalog.buildings = [STORED, { ...STORED, _id: 2, buildNo: "101" } as BuildingDoc];
    catalog.spaces = [room("100-A101", "100", "hssc")];
    catalog.connections = [{ a: { skkuId: 1, floor: { ko: "1층", en: "1F" } }, b: { skkuId: 2, floor: { ko: "2층", en: "2F" } } }] as never;

    // Act
    const res = await request(httpServer).get("/building/1");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.data.connections).toHaveLength(1);
    expectWire(buildingDetail, res.body.data);
  });

  it("serves /building/:skkuId with cafeterias as buildingDetail declares", async () => {
    // Arrange
    catalog.buildings = [STORED];
    catalog.cafeterias = [
      {
        _id: "10201034",
        kind: "cafeteria",
        campus: "hssc",
        name: { ko: "법고을식당", en: "Beopgoeul Restaurant" },
        buildNo: "100",
        buildingName: { ko: "법학관", en: "Law School" },
        floor: { ko: "지하2층", en: "B2" },
        floorCode: "B2",
        spaceCd: "2B205",
        location: { type: "Point", coordinates: [126.990749, 37.587355] },
        syncedAt: new Date("2026-10-17T00:00:00Z"),
      },
    ] as never;

    // Act
    const res = await request(httpServer).get("/building/1");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.data.cafeterias).toEqual([
      { id: "10201034", name: { ko: "법고을식당", en: "Beopgoeul Restaurant" }, floor: "지하2층", spaceCd: "2B205" },
    ]);
    expectWire(buildingDetail, res.body.data);
  });

  it("serves /building/search as buildingSearchData and buildingSearchMeta declare", async () => {
    // Arrange
    // The fake returns its rows as seeded, so they are seeded as the search pipeline's $project leaves them.
    const ranked = Object.fromEntries(Object.entries(STORED).filter(([field]) => !(field in SERVED_BUILDING_PROJECTION)));
    search.buildings = { items: [ranked as unknown as BuildingDoc] };
    search.spaces = { items: [room("100-A101", "100", "hssc")] };
    buildings.buildings = [STORED];

    // Act
    const res = await request(httpServer).get("/building/search?q=%EB%B2%95");
    const { lang, ...meta } = res.body.meta;

    // Assert
    expect(res.status).toBe(200);
    expect(lang).toBe("ko");
    expect(res.body.data.spaces).toHaveLength(1);
    expectWire(buildingSearchData, res.body.data);
    expectWire(buildingSearchMeta, meta);
  });
});
