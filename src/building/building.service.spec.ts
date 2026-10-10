/**
 * BuildingService's use cases over a stubbed BuildingRepository. The routes
 * (__tests__/nest/building/building-routes.test.ts) pin the HTTP shapes; this
 * pins what the service asks the repository for.
 */
import type { BuildingRepository } from "./building.repository";
import { BuildingService } from "./building.service";

const repo = {
  listBuildings: jest.fn(),
  listCampusShapes: jest.fn(),
  findBuildingBySkkuId: jest.fn(),
  listFloorsByBuildNo: jest.fn(),
  listConnectionsBySkkuId: jest.fn(),
  searchBuildings: jest.fn(),
  searchSpaces: jest.fn(),
};
const svc = new BuildingService(repo as unknown as BuildingRepository);

const ranked = (items: unknown[]) => ({
  items,
  counts: { hssc: items.length, nsc: 0, total: items.length },
  total: items.length,
  truncated: false,
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe("BuildingService.list", () => {
  it("asks for the campus (null for all) and labels each building", async () => {
    repo.listBuildings.mockResolvedValue([{ _id: 1, campus: "nsc" }]);
    await expect(svc.list(null, "en")).resolves.toEqual({
      buildings: [{ _id: 1, campus: "nsc", campusLabel: "NSC" }],
    });
    expect(repo.listBuildings).toHaveBeenCalledWith(null);
  });
});

describe("BuildingService.search", () => {
  it("joins each room group to its building's skkuId and reports row counts", async () => {
    repo.searchBuildings.mockResolvedValue(ranked([]));
    repo.searchSpaces.mockResolvedValue(
      ranked([
        { spaceCd: "27101", buildNo: "227", campus: "nsc", name: { ko: "실", en: "" }, floor: { ko: "1층", en: "" } },
        { spaceCd: "27102", buildNo: "227", campus: "nsc", name: { ko: "실2", en: "" }, floor: { ko: "1층", en: "" } },
      ]),
    );
    repo.listBuildings.mockResolvedValue([{ _id: 22, buildNo: "227", campus: "nsc" }, { _id: 1, buildNo: null }]);

    const { data, meta } = await svc.search("27", "nsc", "ko");

    expect(repo.searchSpaces).toHaveBeenCalledWith("27", "nsc");
    expect(data.spaces).toEqual([
      expect.objectContaining({ skkuId: 22, buildNo: "227", displayNo: "27", items: expect.any(Array) }),
    ]);
    expect(data.spaces[0]!.items.map((i) => i.name.en)).toEqual(["실", "실2"]);
    expect(meta).toMatchObject({ keyword: "27", buildingCount: 0, spaceCount: 2 });
    expect(Object.keys(meta)).toEqual(["keyword", "buildingCount", "spaceCount", "counts", "limits"]);
  });
});

describe("BuildingService.detail", () => {
  it("is null for an unknown building and asks for nothing else", async () => {
    repo.findBuildingBySkkuId.mockResolvedValue(null);
    await expect(svc.detail(999, "ko")).resolves.toBeNull();
    expect(repo.listFloorsByBuildNo).not.toHaveBeenCalled();
    expect(repo.listConnectionsBySkkuId).not.toHaveBeenCalled();
  });

  it("fills the English fallback on floors without touching the repository's objects", async () => {
    const floors = [{ floor: { ko: "1층", en: "" }, spaces: [{ spaceCd: "1", name: { ko: "실", en: "" } }] }];
    repo.findBuildingBySkkuId.mockResolvedValue({ _id: 3, buildNo: "102", campus: "hssc" });
    repo.listFloorsByBuildNo.mockResolvedValue(floors);
    repo.listConnectionsBySkkuId.mockResolvedValue([]);

    const view = await svc.detail(3, "ko");

    expect(view?.floors[0]?.floor.en).toBe("1층");
    expect(view?.floors[0]?.spaces[0]?.name.en).toBe("실");
    expect(floors[0]!.floor.en).toBe("");
    expect(repo.listFloorsByBuildNo).toHaveBeenCalledWith("102");
  });
});

describe("BuildingService for MapService", () => {
  it("passes every building and the campus shapes through", async () => {
    repo.listBuildings.mockResolvedValue([]);
    repo.listCampusShapes.mockResolvedValue([{ _id: "wall" }]);
    await svc.listAllBuildings();
    expect(repo.listBuildings).toHaveBeenCalledWith();
    await expect(svc.listAllCampusShapes()).resolves.toEqual([{ _id: "wall" }]);
  });
});
