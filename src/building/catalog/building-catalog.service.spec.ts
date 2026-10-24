/**
 * BuildingCatalogService over in-memory repositories. What it guards: the
 * campus filter and labels of the list; for the detail, which reads it skips
 * (nothing after an unknown building, no spaces for a facility, one read for
 * all connection targets), how connections are labelled, that the floor
 * list's English fallback leaves the repository's objects as they were, and
 * that the detail lists the cafeterias in its own building only.
 */
import { FakeBuildingCatalogRepository } from "../../../__tests__/helpers/fakes/building/building-catalog.repository.fake";
import { asReal } from "../../../__tests__/helpers/fakes/public-of";
import { FakeBuildingRepository } from "../../../__tests__/helpers/fakes/building/building.repository.fake";
import type { BuildingDoc, CafeteriaDoc, SpaceDoc } from "../building.document";
import type { BuildingRepository } from "../building.repository";
import type { SkkuId } from "../building.types";
import type { ConnectionEnds } from "./building-catalog.document";
import type { BuildingCatalogRepository } from "./building-catalog.repository";
import { BuildingCatalogService } from "./building-catalog.service";

const LAW = { _id: 1, buildNo: "100", displayNo: "0", campus: "hssc", name: { ko: "법학관", en: "Law" } } as BuildingDoc;
const BUSINESS = { _id: 2, buildNo: "101", displayNo: "1", campus: "hssc", name: { ko: "경영관", en: "Business" } } as BuildingDoc;
const ENGINEERING = { _id: 3, buildNo: "200", displayNo: "0", campus: "nsc", name: { ko: "공학관", en: "Eng" } } as BuildingDoc;
const GATE = { _id: 4, buildNo: null, displayNo: null, campus: "nsc", name: { ko: "정문", en: "Main Gate" } } as BuildingDoc;

let catalog: FakeBuildingCatalogRepository;
let buildings: FakeBuildingRepository;
let service: BuildingCatalogService;

beforeEach(() => {
  catalog = new FakeBuildingCatalogRepository();
  buildings = new FakeBuildingRepository();
  service = new BuildingCatalogService(asReal<BuildingCatalogRepository>(catalog), asReal<BuildingRepository>(buildings));
});

describe("BuildingCatalogService.list", () => {
  it("lists the campus asked for and labels each building in the request's language", async () => {
    // Arrange
    buildings.buildings = [LAW, ENGINEERING];

    // Act
    const list = await service.list("nsc", "en");

    // Assert
    expect(list).toEqual({ buildings: [{ ...ENGINEERING, campusLabel: "NSC" }] });
  });
});

describe("BuildingCatalogService.list with no campus", () => {
  it("lists every campus when the campus is undefined, the schema's value for none", async () => {
    // Arrange
    buildings.buildings = [LAW, ENGINEERING];

    // Act
    const list = await service.list(undefined, "ko");

    // Assert
    expect(list.buildings.map((b) => b._id)).toEqual([1, 3]);
  });
});

describe("BuildingCatalogService.detail", () => {
  it("is null for an unknown building, and reads nothing after the lookup", async () => {
    // Act
    const detail = await service.detail(999 as SkkuId, "ko");

    // Assert
    expect(detail).toBeNull();
    expect(catalog.reads).toEqual(["findBuildingBySkkuId"]);
  });

  it("reads no spaces and no targets for a facility without a buildNo or connections", async () => {
    // Arrange
    catalog.buildings = [GATE];

    // Act
    const detail = await service.detail(4 as SkkuId, "ko");

    // Assert
    expect(detail).toMatchObject({ floors: [], connections: [] });
    expect(catalog.reads).toEqual(["findBuildingBySkkuId", "listConnectionsBySkkuId"]);
  });

  it("labels each connection with the building at its far end, reading all targets at once", async () => {
    // Arrange
    catalog.buildings = [LAW, BUSINESS];
    catalog.connections = [
      { a: { skkuId: 1, floor: { ko: "1층", en: "1F" } }, b: { skkuId: 2, floor: { ko: "2층", en: "2F" } } },
      { a: { skkuId: 9, floor: { ko: "지하1층", en: "B1" } }, b: { skkuId: 1, floor: { ko: "3층", en: "3F" } } },
    ] as ConnectionEnds[];

    // Act
    const detail = await service.detail(1 as SkkuId, "ko");

    // Assert
    expect(detail?.connections).toEqual([
      {
        targetSkkuId: 2,
        targetBuildNo: "101",
        targetDisplayNo: "1",
        targetName: { ko: "경영관", en: "Business" },
        fromFloor: { ko: "1층", en: "1F" },
        toFloor: { ko: "2층", en: "2F" },
      },
      {
        targetSkkuId: 9,
        targetBuildNo: null,
        targetDisplayNo: null,
        targetName: { ko: "", en: "" },
        fromFloor: { ko: "3층", en: "3F" },
        toFloor: { ko: "지하1층", en: "B1" },
      },
    ]);
    expect(catalog.reads.filter((read) => read === "listBuildingsBySkkuIds")).toHaveLength(1);
  });

  it("groups its own spaces by floor with the English fallback, leaving the repository's objects as they were", async () => {
    // Arrange
    catalog.buildings = [BUSINESS];
    catalog.spaces = [
      { spaceCd: "10101", buildNo: "101", campus: "hssc", name: { ko: "실", en: "" }, floor: { ko: "1층", en: "" }, conspaceCd: null },
      { spaceCd: "10001", buildNo: "100", campus: "hssc", name: { ko: "남의 실", en: "" }, floor: { ko: "1층", en: "" }, conspaceCd: null },
    ] as SpaceDoc[];

    // Act
    const detail = await service.detail(2 as SkkuId, "ko");

    // Assert
    expect(detail?.floors).toEqual([
      { floor: { ko: "1층", en: "1층" }, spaces: [{ spaceCd: "10101", name: { ko: "실", en: "실" }, conspaceCd: null }] },
    ]);
    expect(catalog.spaces[0]!.floor).toEqual({ ko: "1층", en: "" });
    expect(catalog.spaces[0]!.name).toEqual({ ko: "실", en: "" });
  });

  it("lists the cafeterias in its own building, by conspaceCd, and none of another's", async () => {
    // Arrange
    const inBusiness = (conspaceCd: string, ko: string) =>
      ({ _id: conspaceCd, kind: "cafeteria", buildNo: "101", name: { ko, en: "" }, floor: { ko: "지하1층", en: "B1" }, spaceCd: null }) as CafeteriaDoc;
    catalog.buildings = [BUSINESS];
    catalog.cafeterias = [
      inBusiness("10201031", "은행골식당"),
      { ...inBusiness("10201034", "법고을식당"), buildNo: "100" } as CafeteriaDoc,
      inBusiness("10201030", "패컬티식당"),
    ];

    // Act
    const detail = await service.detail(2 as SkkuId, "ko");

    // Assert
    expect(detail?.cafeterias).toEqual([
      { id: "10201030", name: { ko: "패컬티식당", en: "패컬티식당" }, floor: "지하1층", spaceCd: null },
      { id: "10201031", name: { ko: "은행골식당", en: "은행골식당" }, floor: "지하1층", spaceCd: null },
    ]);
  });

  it("serves no cafeteria, without reading any, for a facility without a buildNo", async () => {
    // Arrange
    catalog.buildings = [GATE];

    // Act
    const detail = await service.detail(4 as SkkuId, "ko");

    // Assert
    expect(detail?.cafeterias).toEqual([]);
    expect(catalog.reads).not.toContain("listCafeteriasByBuildNo");
  });
});
