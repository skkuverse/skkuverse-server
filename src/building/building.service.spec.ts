/**
 * BuildingService's use cases over a stubbed BuildingRepository. The routes
 * (__tests__/nest/building/building-routes.test.ts) pin the HTTP shapes; this
 * pins what the service asks the repository for.
 */
import type { BuildingRepository } from "./building.repository";
import { BuildingService } from "./building.service";
import type { SkkuId } from "./building.types";

const repo = {
  listBuildings: jest.fn(),
  listCampusShapes: jest.fn(),
  findBuildingBySkkuId: jest.fn(),
  listFloorsByBuildNo: jest.fn(),
  listConnectionsBySkkuId: jest.fn(),
};
const svc = new BuildingService(repo as unknown as BuildingRepository);

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

describe("BuildingService.detail", () => {
  it("is null for an unknown building and asks for nothing else", async () => {
    repo.findBuildingBySkkuId.mockResolvedValue(null);
    await expect(svc.detail(999 as SkkuId, "ko")).resolves.toBeNull();
    expect(repo.listFloorsByBuildNo).not.toHaveBeenCalled();
    expect(repo.listConnectionsBySkkuId).not.toHaveBeenCalled();
  });

  it("fills the English fallback on floors without touching the repository's objects", async () => {
    const floors = [{ floor: { ko: "1층", en: "" }, spaces: [{ spaceCd: "1", name: { ko: "실", en: "" } }] }];
    repo.findBuildingBySkkuId.mockResolvedValue({ _id: 3, buildNo: "102", campus: "hssc" });
    repo.listFloorsByBuildNo.mockResolvedValue(floors);
    repo.listConnectionsBySkkuId.mockResolvedValue([]);

    const view = await svc.detail(3 as SkkuId, "ko");

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
