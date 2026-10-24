/**
 * BuildingCafeteriaListService, the door other features list building's
 * cafeterias through, over an in-memory repository: it lists only the
 * requested campus, in conspaceCd order, and a failed read rejects.
 */
import { FakeBuildingCafeteriaListRepository } from "../../../__tests__/helpers/fakes/building/building-cafeteria-list.repository.fake";
import { asReal } from "../../../__tests__/helpers/fakes/public-of";
import type { CafeteriaDoc } from "../building.document";
import type { BuildingCafeteriaListRepository } from "./building-cafeteria-list.repository";
import { BuildingCafeteriaListService } from "./building-cafeteria-list.service";

function cafeteria(id: string, campus: "hssc" | "nsc"): CafeteriaDoc {
  return { _id: id, kind: "cafeteria", campus, name: { ko: id, en: id }, buildNo: "101", floor: null, spaceCd: null, location: null } as CafeteriaDoc;
}

let repository: FakeBuildingCafeteriaListRepository;
let service: BuildingCafeteriaListService;

beforeEach(() => {
  repository = new FakeBuildingCafeteriaListRepository();
  service = new BuildingCafeteriaListService(asReal<BuildingCafeteriaListRepository>(repository));
});

describe("BuildingCafeteriaListService.listCafeterias", () => {
  it("lists the requested campus's cafeterias in conspaceCd order", async () => {
    // Arrange
    repository.cafeterias = [cafeteria("10201033", "hssc"), cafeteria("20201104", "nsc"), cafeteria("10201031", "hssc")];

    // Act
    const cafeterias = await service.listCafeterias("hssc");

    // Assert
    expect(cafeterias.map((c) => c._id)).toEqual(["10201031", "10201033"]);
  });

  it("rejects when the read fails", async () => {
    // Arrange
    repository.failWith = new Error("mongo down");

    // Act & Assert
    await expect(service.listCafeterias("nsc")).rejects.toThrow("mongo down");
  });
});
