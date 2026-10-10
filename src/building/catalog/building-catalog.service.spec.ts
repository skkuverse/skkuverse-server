/**
 * BuildingCatalogService's use cases over stubbed repositories. The routes
 * (__tests__/nest/building/building-routes.test.ts) pin the HTTP shapes; this
 * pins what the service asks the repositories for.
 */
import type { BuildingRepository } from "../building.repository";
import type { SkkuId } from "../building.types";
import type { BuildingCatalogRepository } from "./building-catalog.repository";
import { BuildingCatalogService } from "./building-catalog.service";

const repo = {
  findBuildingBySkkuId: jest.fn(),
  listSpacesByBuildNo: jest.fn(),
  listConnectionsBySkkuId: jest.fn(),
  listBuildingsByIds: jest.fn(),
};
const buildings = { listBuildings: jest.fn() };
const svc = new BuildingCatalogService(
  repo as unknown as BuildingCatalogRepository,
  buildings as unknown as BuildingRepository,
);

beforeEach(() => {
  jest.clearAllMocks();
});

describe("BuildingCatalogService.list", () => {
  it("asks for the campus (null for all) and labels each building", async () => {
    buildings.listBuildings.mockResolvedValue([{ _id: 1, campus: "nsc" }]);
    await expect(svc.list(null, "en")).resolves.toEqual({
      buildings: [{ _id: 1, campus: "nsc", campusLabel: "NSC" }],
    });
    expect(buildings.listBuildings).toHaveBeenCalledWith(null);
  });
});

describe("BuildingCatalogService.detail", () => {
  it("is null for an unknown building and asks for nothing else", async () => {
    repo.findBuildingBySkkuId.mockResolvedValue(null);
    await expect(svc.detail(999 as SkkuId, "ko")).resolves.toBeNull();
    expect(repo.listSpacesByBuildNo).not.toHaveBeenCalled();
    expect(repo.listConnectionsBySkkuId).not.toHaveBeenCalled();
  });

  it("reads no spaces for a facility without a buildNo", async () => {
    repo.findBuildingBySkkuId.mockResolvedValue({ _id: 4, buildNo: null, campus: "nsc" });
    repo.listConnectionsBySkkuId.mockResolvedValue([]);
    await expect(svc.detail(4 as SkkuId, "ko")).resolves.toMatchObject({ floors: [], connections: [] });
    expect(repo.listSpacesByBuildNo).not.toHaveBeenCalled();
    expect(repo.listBuildingsByIds).not.toHaveBeenCalled();
  });

  it("labels each connection with the building at its far end, read once", async () => {
    repo.findBuildingBySkkuId.mockResolvedValue({ _id: 1, buildNo: "100", campus: "hssc" });
    repo.listSpacesByBuildNo.mockResolvedValue([]);
    repo.listConnectionsBySkkuId.mockResolvedValue([
      { a: { skkuId: 1, floor: { ko: "1층", en: "1F" } }, b: { skkuId: 2, floor: { ko: "2층", en: "2F" } } },
      { a: { skkuId: 3, floor: { ko: "B1", en: "B1" } }, b: { skkuId: 1, floor: { ko: "3층", en: "3F" } } },
    ]);
    repo.listBuildingsByIds.mockResolvedValue([
      { _id: 2, buildNo: "101", displayNo: "1", name: { ko: "경영관", en: "Business" } },
    ]);

    const view = await svc.detail(1 as SkkuId, "ko");

    expect(repo.listBuildingsByIds).toHaveBeenCalledWith([2, 3]);
    expect(view?.connections).toEqual([
      {
        targetSkkuId: 2,
        targetBuildNo: "101",
        targetDisplayNo: "1",
        targetName: { ko: "경영관", en: "Business" },
        fromFloor: { ko: "1층", en: "1F" },
        toFloor: { ko: "2층", en: "2F" },
      },
      {
        targetSkkuId: 3,
        targetBuildNo: null,
        targetDisplayNo: null,
        targetName: { ko: "", en: "" },
        fromFloor: { ko: "3층", en: "3F" },
        toFloor: { ko: "B1", en: "B1" },
      },
    ]);
  });

  it("groups the spaces by floor with the English fallback, without touching the repository's objects", async () => {
    const spaces = [{ spaceCd: "1", name: { ko: "실", en: "" }, floor: { ko: "1층", en: "" } }];
    repo.findBuildingBySkkuId.mockResolvedValue({ _id: 3, buildNo: "102", campus: "hssc" });
    repo.listSpacesByBuildNo.mockResolvedValue(spaces);
    repo.listConnectionsBySkkuId.mockResolvedValue([]);

    const view = await svc.detail(3 as SkkuId, "ko");

    expect(view?.floors[0]?.floor.en).toBe("1층");
    expect(view?.floors[0]?.spaces[0]?.name.en).toBe("실");
    expect(spaces[0]!.floor.en).toBe("");
    expect(repo.listSpacesByBuildNo).toHaveBeenCalledWith("102");
  });
});
