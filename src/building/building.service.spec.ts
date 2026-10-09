/**
 * BuildingService delegates to BuildingRepository (a stub here).
 */
import type { BuildingRepository } from "./building.repository";
import { BuildingService } from "./building.service";

const mocked = {
  getAllBuildings: jest.fn(),
  getAllCampusShapes: jest.fn(),
  getBuildingBySkkuId: jest.fn(),
  getFloorsByBuildNo: jest.fn(),
  getConnectionsForBuilding: jest.fn(),
  searchBuildings: jest.fn(),
  searchSpaces: jest.fn(),
};
const mockedSearch = mocked;

beforeEach(() => {
  jest.clearAllMocks();
});

describe("BuildingService delegation", () => {
  const svc = new BuildingService(mocked as unknown as BuildingRepository);

  it("getAllBuildings forwards campus arg", async () => {
    mocked.getAllBuildings.mockResolvedValue([]);
    await svc.getAllBuildings("hssc");
    expect(mocked.getAllBuildings).toHaveBeenCalledWith("hssc");
    await svc.getAllBuildings();
    expect(mocked.getAllBuildings).toHaveBeenLastCalledWith(undefined);
  });

  it("getBuildingBySkkuId forwards id", async () => {
    mocked.getBuildingBySkkuId.mockResolvedValue(null);
    await svc.getBuildingBySkkuId(7);
    expect(mocked.getBuildingBySkkuId).toHaveBeenCalledWith(7);
  });

  it("getFloorsByBuildNo forwards buildNo", async () => {
    mocked.getFloorsByBuildNo.mockResolvedValue([]);
    await svc.getFloorsByBuildNo("100");
    expect(mocked.getFloorsByBuildNo).toHaveBeenCalledWith("100");
  });

  it("getConnectionsForBuilding forwards id", async () => {
    mocked.getConnectionsForBuilding.mockResolvedValue([]);
    await svc.getConnectionsForBuilding(3);
    expect(mocked.getConnectionsForBuilding).toHaveBeenCalledWith(3);
  });

  it("searchBuildings / searchSpaces forward query + campus", async () => {
    const empty = {
      items: [],
      counts: { hssc: 0, nsc: 0, total: 0 },
      total: 0,
      truncated: false,
    };
    mockedSearch.searchBuildings.mockResolvedValue(empty);
    mockedSearch.searchSpaces.mockResolvedValue(empty);
    await svc.searchBuildings("law", "nsc");
    await svc.searchSpaces("law", null);
    expect(mockedSearch.searchBuildings).toHaveBeenCalledWith("law", "nsc");
    expect(mockedSearch.searchSpaces).toHaveBeenCalledWith("law", null);
  });

  it("passes the ranked result through untouched (counts ride with rows)", async () => {
    const ranked = {
      items: [],
      counts: { hssc: 2, nsc: 3, total: 5 },
      total: 5,
      truncated: true,
    };
    mockedSearch.searchSpaces.mockResolvedValue(ranked);
    await expect(svc.searchSpaces("q")).resolves.toBe(ranked);
  });
});
