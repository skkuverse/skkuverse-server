/**
 * MealsCatalogService over building's doors (BuildingCafeteriaListService and
 * BuildingService, each on an in-memory repository). What it guards: only the
 * requested campus's cafeterias are listed, in conspaceCd order, each joined
 * to its building, and a failed read rejects.
 */
import { FakeBuildingCafeteriaListRepository } from "../../../__tests__/helpers/fakes/building/building-cafeteria-list.repository.fake";
import { FakeBuildingRepository } from "../../../__tests__/helpers/fakes/building/building.repository.fake";
import { asReal } from "../../../__tests__/helpers/fakes/public-of";
import type { BuildingDoc, CafeteriaDoc } from "../../building/building.document";
import { BuildingCafeteriaListService } from "../../building/cafeteria-list/building-cafeteria-list.service";
import { BuildingService } from "../../building/building.service";
import { MealsCatalogService } from "./meals-catalog.service";

function cafeteria(id: string, campus: "hssc" | "nsc", buildNo: string): CafeteriaDoc {
  return {
    _id: id,
    kind: "cafeteria",
    campus,
    name: { ko: `식당 ${id}`, en: `Cafeteria ${id}` },
    buildNo,
    buildingName: { ko: "", en: "" },
    floor: { ko: "1층", en: "1F" },
    floorCode: "01",
    spaceCd: null,
    location: null,
    syncedAt: new Date(0),
  } as CafeteriaDoc;
}

const BUSINESS = { _id: 12, buildNo: "133", displayNo: "33", campus: "hssc", name: { ko: "경영관", en: "Business School" } } as BuildingDoc;
const STUDENT_CENTER = { _id: 15, buildNo: "203", displayNo: "3", campus: "nsc", name: { ko: "학생회관", en: "Student Center" } } as BuildingDoc;

let repository: FakeBuildingRepository;
let cafeteriaList: FakeBuildingCafeteriaListRepository;
let service: MealsCatalogService;

beforeEach(() => {
  repository = new FakeBuildingRepository();
  cafeteriaList = new FakeBuildingCafeteriaListRepository();
  service = new MealsCatalogService(
    new BuildingCafeteriaListService(asReal<ConstructorParameters<typeof BuildingCafeteriaListService>[0]>(cafeteriaList)),
    new BuildingService(asReal<ConstructorParameters<typeof BuildingService>[0]>(repository)),
  );
});

describe("MealsCatalogService.listCafeterias", () => {
  it("lists the campus's cafeterias in conspaceCd order, each with its building, and none of the other campus", async () => {
    // Arrange
    repository.buildings = [STUDENT_CENTER, BUSINESS];
    cafeteriaList.cafeterias = [cafeteria("10201033", "hssc", "133"), cafeteria("20201104", "nsc", "203"), cafeteria("10201031", "hssc", "133")];

    // Act
    const list = await service.listCafeterias("hssc");

    // Assert
    expect(list.cafeterias.map((c) => [c.id, c.building?.skkuId])).toEqual([
      ["10201031", 12],
      ["10201033", 12],
    ]);
  });

  it("lists none for a campus with no cafeteria", async () => {
    // Arrange
    repository.buildings = [BUSINESS];
    cafeteriaList.cafeterias = [cafeteria("10201033", "hssc", "133")];

    // Act
    const list = await service.listCafeterias("nsc");

    // Assert
    expect(list).toEqual({ cafeterias: [] });
  });

  it("rejects when a read fails, so the route answers an error rather than an empty list", async () => {
    // Arrange
    cafeteriaList.failWith = new Error("mongo down");

    // Act & Assert
    await expect(service.listCafeterias("hssc")).rejects.toThrow("mongo down");
  });
});
