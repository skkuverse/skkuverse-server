/**
 * Integration over BuildingController (3 endpoints, validation branches, i18n
 * campusLabel injection, English fallback, space grouping + counts meta).
 *
 * BuildingRepository is overridden with a stub (its real onModuleInit would
 * create indexes through src/infra/db.ts, hanging without Mongo), so the real
 * controller and BuildingService (campus label, English fallback, displayNo
 * grouping) run against the stubbed data.
 */

import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { BuildingRepository } from "../../../src/building/building.repository";
import { buildBuildingApp } from "../../helpers/nest/build-building-app";

let app: NestExpressApplication;
let httpServer: import("http").Server;
let svc: {
  onModuleInit: jest.Mock;
  listBuildings: jest.Mock;
  findBuildingBySkkuId: jest.Mock;
  listFloorsByBuildNo: jest.Mock;
  listConnectionsBySkkuId: jest.Mock;
  searchBuildings: jest.Mock;
  searchSpaces: jest.Mock;
};

beforeAll(async () => {
  svc = {
    onModuleInit: jest.fn(),
    listBuildings: jest.fn(),
    findBuildingBySkkuId: jest.fn(),
    listFloorsByBuildNo: jest.fn(),
    listConnectionsBySkkuId: jest.fn(),
    searchBuildings: jest.fn(),
    searchSpaces: jest.fn(),
  };
  app = await buildBuildingApp([{ provide: BuildingRepository, useValue: svc }]);
  httpServer = app.getHttpServer();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe("GET /building/list", () => {
  it("returns the full list with campusLabel injected (Korean default)", async () => {
    svc.listBuildings.mockResolvedValue([
      { _id: 1, buildNo: "100", campus: "hssc", name: { ko: "법학관", en: "Law" } },
      { _id: 2, buildNo: "200", campus: "nsc", name: { ko: "공학관", en: "Eng" } },
    ]);
    const res = await request(httpServer).get("/building/list");
    expect(res.status).toBe(200);
    expect(res.body.meta.lang).toBe("ko");
    expect(res.body.data.buildings).toHaveLength(2);
    expect(res.body.data.buildings[0].campusLabel).toBe("인사캠");
    expect(res.body.data.buildings[1].campusLabel).toBe("자과캠");
    expect(svc.listBuildings).toHaveBeenCalledWith(null);
  });

  it("filters by campus=hssc and uses English campusLabel on en lang", async () => {
    svc.listBuildings.mockResolvedValue([
      { _id: 1, buildNo: "100", campus: "hssc", name: { ko: "법학관", en: "Law" } },
    ]);
    const res = await request(httpServer)
      .get("/building/list?campus=hssc")
      .set("Accept-Language", "en-US");
    expect(res.status).toBe(200);
    expect(res.body.meta.lang).toBe("en");
    expect(res.body.data.buildings[0].campusLabel).toBe("HSSC");
    expect(svc.listBuildings).toHaveBeenCalledWith("hssc");
  });

  it("accepts campus=nsc", async () => {
    svc.listBuildings.mockResolvedValue([]);
    const res = await request(httpServer).get("/building/list?campus=nsc");
    expect(res.status).toBe(200);
    expect(svc.listBuildings).toHaveBeenCalledWith("nsc");
  });

  it("rejects invalid campus with 400 INVALID_CAMPUS", async () => {
    const res = await request(httpServer).get("/building/list?campus=mars");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_CAMPUS");
    expect(res.body.error.message).toMatch(/hssc.*nsc/);
    expect(svc.listBuildings).not.toHaveBeenCalled();
  });
});

describe("GET /building/search", () => {
  // Rows and counts arrive together now — one ranked envelope per collection.
  function ranked(items: unknown[], counts: { hssc: number; nsc: number }) {
    const total = counts.hssc + counts.nsc;
    return {
      items,
      counts: { ...counts, total },
      total,
      truncated: total > items.length,
    };
  }

  function seedSearchHappyPath() {
    svc.searchBuildings.mockResolvedValue(
      ranked(
        [
          {
            _id: 1,
            buildNo: "100",
            campus: "hssc",
            name: { ko: "법학관", en: "Law" },
          },
        ],
        { hssc: 1, nsc: 0 },
      ),
    );
    svc.searchSpaces.mockResolvedValue(
      ranked(
        [
          {
            buildNo: "100",
            campus: "hssc",
            spaceCd: "100-A101",
            name: { ko: "강의실", en: "" },
            buildingName: { ko: "법학관", en: "" },
            floor: { ko: "1층", en: "" },
          },
        ],
        { hssc: 1, nsc: 0 },
      ),
    );
    svc.listBuildings.mockResolvedValue([
      { _id: 1, buildNo: "100", campus: "hssc" },
    ]);
  }

  it("rejects missing q with 400 MISSING_QUERY", async () => {
    const res = await request(httpServer).get("/building/search");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("MISSING_QUERY");
    expect(svc.searchBuildings).not.toHaveBeenCalled();
  });

  it("treats whitespace-only q as missing", async () => {
    const res = await request(httpServer).get("/building/search?q=%20%20%20");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("MISSING_QUERY");
  });

  it("rejects invalid campus with 400 INVALID_CAMPUS", async () => {
    const res = await request(httpServer).get(
      "/building/search?q=law&campus=mars",
    );
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_CAMPUS");
  });

  it("returns buildings + grouped spaces + counts on the happy path", async () => {
    seedSearchHappyPath();
    const res = await request(httpServer).get("/building/search?q=%EB%B2%95");
    expect(res.status).toBe(200);
    expect(res.body.meta.buildingCount).toBe(1);
    expect(res.body.meta.spaceCount).toBe(1);
    expect(res.body.meta.counts).toEqual({
      building: { hssc: 1, nsc: 0, total: 1 },
      space: { hssc: 1, nsc: 0, total: 1 },
    });
    expect(res.body.data.buildings[0].campusLabel).toBe("인사캠");
    expect(res.body.data.spaces).toHaveLength(1);
    const group = res.body.data.spaces[0];
    expect(group.buildNo).toBe("100");
    expect(group.skkuId).toBe(1);
    expect(group.displayNo).toBe("0"); // "100" with "1" prefix stripped → "00" → "0"
    expect(group.campusLabel).toBe("인사캠");
    expect(group.items).toHaveLength(1);
    expect(group.items[0].spaceCd).toBe("100-A101");
  });

  it("fills empty .en with .ko on spaces (fillEnFallback)", async () => {
    seedSearchHappyPath();
    const res = await request(httpServer).get("/building/search?q=law");
    const item = res.body.data.spaces[0].items[0];
    expect(item.name.en).toBe(item.name.ko); // "강의실"
  });

  it("returns empty arrays + zero counts when nothing matches", async () => {
    svc.searchBuildings.mockResolvedValue(ranked([], { hssc: 0, nsc: 0 }));
    svc.searchSpaces.mockResolvedValue(ranked([], { hssc: 0, nsc: 0 }));
    svc.listBuildings.mockResolvedValue([]);
    const res = await request(httpServer).get("/building/search?q=zzz");
    expect(res.status).toBe(200);
    expect(res.body.data.buildings).toEqual([]);
    expect(res.body.data.spaces).toEqual([]);
    expect(res.body.meta.buildingCount).toBe(0);
    expect(res.body.meta.spaceCount).toBe(0);
  });

  it("passes campus filter through to data layer", async () => {
    seedSearchHappyPath();
    await request(httpServer).get("/building/search?q=law&campus=hssc");
    expect(svc.searchBuildings).toHaveBeenCalledWith("law", "hssc");
    expect(svc.searchSpaces).toHaveBeenCalledWith("law", "hssc");
  });

  it("spaceCount is the ROW count, not the group count", async () => {
    // Two rooms in one building: the app renders spaceCount in the section
    // header while data.spaces is the grouped list, so they legitimately differ.
    svc.searchSpaces.mockResolvedValue(
      ranked(
        [
          {
            buildNo: "100",
            campus: "hssc",
            spaceCd: "10001",
            name: { ko: "A", en: "" },
            buildingName: { ko: "법학관", en: "" },
            floor: { ko: "1층", en: "" },
          },
          {
            buildNo: "100",
            campus: "hssc",
            spaceCd: "10002",
            name: { ko: "B", en: "" },
            buildingName: { ko: "법학관", en: "" },
            floor: { ko: "1층", en: "" },
          },
        ],
        { hssc: 2, nsc: 0 },
      ),
    );
    svc.searchBuildings.mockResolvedValue(ranked([], { hssc: 0, nsc: 0 }));
    svc.listBuildings.mockResolvedValue([]);

    const res = await request(httpServer).get("/building/search?q=100");
    expect(res.body.meta.spaceCount).toBe(2);
    expect(res.body.data.spaces).toHaveLength(1);
    expect(res.body.data.spaces[0].items).toHaveLength(2);
  });

  it("space groups follow row order, so relevance ranking survives grouping", async () => {
    svc.searchSpaces.mockResolvedValue(
      ranked(
        [
          {
            buildNo: "227",
            campus: "nsc",
            spaceCd: "27101",
            name: { ko: "측량기기성능검사실", en: "" },
            buildingName: { ko: "제2공학관27동", en: "" },
            floor: { ko: "1층", en: "" },
          },
          {
            buildNo: "295",
            campus: "nsc",
            spaceCd: "95127",
            name: { ko: "남자숙실(127)", en: "" },
            buildingName: { ko: "기숙사지관", en: "" },
            floor: { ko: "1층", en: "" },
          },
        ],
        { hssc: 0, nsc: 2 },
      ),
    );
    svc.searchBuildings.mockResolvedValue(ranked([], { hssc: 0, nsc: 0 }));
    svc.listBuildings.mockResolvedValue([]);

    const res = await request(httpServer).get("/building/search?q=27");
    expect(
      res.body.data.spaces.map((g: { buildNo: string }) => g.buildNo),
    ).toEqual(["227", "295"]);
  });

  it("reports truncation in meta.limits without disturbing meta.counts", async () => {
    svc.searchBuildings.mockResolvedValue(ranked([], { hssc: 0, nsc: 0 }));
    svc.searchSpaces.mockResolvedValue({
      items: [],
      counts: { hssc: 0, nsc: 6173, total: 6173 },
      total: 6173,
      truncated: true,
    });
    svc.listBuildings.mockResolvedValue([]);

    const res = await request(httpServer).get("/building/search?q=%EC%8B%A4");
    expect(res.body.meta.counts.space.total).toBe(6173);
    expect(res.body.meta.limits.space.truncated).toBe(true);
    expect(res.body.meta.limits.space.total).toBe(6173);
    expect(res.body.meta.limits.space.limit).toBe(1000);
  });
});

describe("GET /building/:skkuId", () => {
  it("rejects non-numeric skkuId with 400 INVALID_ID", async () => {
    const res = await request(httpServer).get("/building/abc");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_ID");
    expect(svc.findBuildingBySkkuId).not.toHaveBeenCalled();
  });

  it("rejects skkuId=0 (must be positive)", async () => {
    const res = await request(httpServer).get("/building/0");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_ID");
  });

  it("returns 404 NOT_FOUND when no building matches", async () => {
    svc.findBuildingBySkkuId.mockResolvedValue(null);
    const res = await request(httpServer).get("/building/999");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
    expect(res.body.error.message).toMatch(/999/);
  });

  it("returns building + floors + connections with campusLabel and en-fallback", async () => {
    svc.findBuildingBySkkuId.mockResolvedValue({
      _id: 1,
      buildNo: "100",
      campus: "hssc",
      name: { ko: "법학관", en: "Law" },
    });
    svc.listFloorsByBuildNo.mockResolvedValue([
      {
        floor: { ko: "1층", en: "" },
        spaces: [{ spaceCd: "100-A101", name: { ko: "강의실", en: "" } }],
      },
    ]);
    svc.listConnectionsBySkkuId.mockResolvedValue([
      {
        targetSkkuId: 2,
        targetBuildNo: "101",
        fromFloor: { ko: "1층" },
        toFloor: { ko: "1층" },
      },
    ]);

    const res = await request(httpServer).get("/building/1");
    expect(res.status).toBe(200);
    expect(res.body.data.building.campusLabel).toBe("인사캠");
    expect(res.body.data.floors).toHaveLength(1);
    expect(res.body.data.floors[0].floor.en).toBe("1층");
    expect(res.body.data.floors[0].spaces[0].name.en).toBe("강의실");
    expect(res.body.data.connections).toHaveLength(1);
    expect(svc.listFloorsByBuildNo).toHaveBeenCalledWith("100");
    expect(svc.listConnectionsBySkkuId).toHaveBeenCalledWith(1);
  });
});
