/**
 * BuildingSearchService over in-memory repositories. What it guards: the
 * keyword and campus reach both searches (ranking is the query's job), each
 * room group is joined to its building's skkuId, and the meta carries row
 * counts in the documented key order.
 */
import { storedBuilding } from "../../../__tests__/helpers/building/buildings";
import { FakeBuildingRepository } from "../../../__tests__/helpers/fakes/building/building.repository.fake";
import { FakeBuildingSearchRepository } from "../../../__tests__/helpers/fakes/building/building-search.repository.fake";
import { asReal } from "../../../__tests__/helpers/fakes/public-of";
import type { SpaceDoc } from "../building.document";
import type { BuildingRepository } from "../building.repository";
import type { BuildingSearchRepository } from "./building-search.repository";
import { BuildingSearchService } from "./building-search.service";

let search: FakeBuildingSearchRepository;
let buildings: FakeBuildingRepository;
let service: BuildingSearchService;

beforeEach(() => {
  search = new FakeBuildingSearchRepository();
  buildings = new FakeBuildingRepository();
  service = new BuildingSearchService(asReal<BuildingSearchRepository>(search), asReal<BuildingRepository>(buildings));
});

describe("BuildingSearchService.search", () => {
  it("searches both collections with the keyword and campus", async () => {
    // Act
    await service.search("27", "nsc", "ko");

    // Assert
    expect(search.searches).toEqual([
      { collection: "buildings", keyword: "27", campus: "nsc" },
      { collection: "spaces", keyword: "27", campus: "nsc" },
    ]);
  });

  it("searches every campus when the campus is undefined, the schema's value for none", async () => {
    // Act
    await service.search("law", undefined, "ko");

    // Assert
    expect(search.searches.map((s) => s.campus)).toEqual([undefined, undefined]);
  });

  it("joins each room group to its building's skkuId and reports row counts", async () => {
    // Arrange
    search.spaces = {
      items: [
        { spaceCd: "27101", buildNo: "227", campus: "nsc", name: { ko: "실", en: "" }, floor: { ko: "1층", en: "" } },
        { spaceCd: "27102", buildNo: "227", campus: "nsc", name: { ko: "실2", en: "" }, floor: { ko: "1층", en: "" } },
      ] as SpaceDoc[],
    };
    buildings.buildings = [
      storedBuilding({ _id: 22, buildNo: "227", campus: "nsc", name: { ko: "제2공학관27동", en: "" } }),
      storedBuilding({ _id: 1, buildNo: null, campus: "nsc", name: { ko: "정문", en: "" } }),
    ];

    // Act
    const { data, meta } = await service.search("27", "nsc", "ko");

    // Assert
    expect(data.spaces).toEqual([
      expect.objectContaining({ skkuId: 22, buildNo: "227", displayNo: "27", items: expect.any(Array) }),
    ]);
    expect(data.spaces[0]!.items.map((item) => item.name.en)).toEqual(["실", "실2"]);
    expect(meta).toMatchObject({ keyword: "27", buildingCount: 0, spaceCount: 2 });
    expect(Object.keys(meta)).toEqual(["keyword", "buildingCount", "spaceCount", "counts", "limits"]);
  });
});
