/**
 * BuildingSearchService over a stubbed search repository and BuildingRepository.
 * The routes (__tests__/nest/building/building-routes.test.ts) pin the HTTP
 * shapes; this pins the join of rooms to their buildings and the meta.
 */
import type { BuildingRepository } from "../building.repository";
import type { BuildingSearchRepository } from "./building-search.repository";
import { BuildingSearchService } from "./building-search.service";

const searchRepo = { searchBuildings: jest.fn(), searchSpaces: jest.fn() };
const buildings = { listBuildings: jest.fn() };
const svc = new BuildingSearchService(
  searchRepo as unknown as BuildingSearchRepository,
  buildings as unknown as BuildingRepository,
);

const ranked = (items: unknown[]) => ({
  items,
  counts: { hssc: items.length, nsc: 0, total: items.length },
  total: items.length,
  truncated: false,
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe("BuildingSearchService.search", () => {
  it("joins each room group to its building's skkuId and reports row counts", async () => {
    searchRepo.searchBuildings.mockResolvedValue(ranked([]));
    searchRepo.searchSpaces.mockResolvedValue(
      ranked([
        { spaceCd: "27101", buildNo: "227", campus: "nsc", name: { ko: "실", en: "" }, floor: { ko: "1층", en: "" } },
        { spaceCd: "27102", buildNo: "227", campus: "nsc", name: { ko: "실2", en: "" }, floor: { ko: "1층", en: "" } },
      ]),
    );
    buildings.listBuildings.mockResolvedValue([{ _id: 22, buildNo: "227", campus: "nsc" }, { _id: 1, buildNo: null }]);

    const { data, meta } = await svc.search("27", "nsc", "ko");

    expect(searchRepo.searchSpaces).toHaveBeenCalledWith("27", "nsc");
    expect(data.spaces).toEqual([
      expect.objectContaining({ skkuId: 22, buildNo: "227", displayNo: "27", items: expect.any(Array) }),
    ]);
    expect(data.spaces[0]!.items.map((i) => i.name.en)).toEqual(["실", "실2"]);
    expect(meta).toMatchObject({ keyword: "27", buildingCount: 0, spaceCount: 2 });
    expect(Object.keys(meta)).toEqual(["keyword", "buildingCount", "spaceCount", "counts", "limits"]);
  });
});
