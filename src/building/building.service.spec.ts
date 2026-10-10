/** BuildingService: the reads other modules and the building flows get through DI. */
import type { BuildingRepository } from "./building.repository";
import { BuildingService } from "./building.service";

const repo = {
  listBuildings: jest.fn(),
  listCampusShapes: jest.fn(),
};
const svc = new BuildingService(repo as unknown as BuildingRepository);

beforeEach(() => {
  jest.clearAllMocks();
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
