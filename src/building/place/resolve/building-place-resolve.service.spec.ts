/**
 * BuildingPlaceResolveService, the door a notice flow resolves its place
 * strings through, over in-memory repositories: each entry of a session's
 * places is resolved on its own against the current index, in list order,
 * and a failed read rejects rather than leaving every place unresolved.
 */
jest.mock("../../../infra/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

import { FakeBuildingPlaceRepository } from "../../../../__tests__/helpers/fakes/building/building-place.repository.fake";
import { FakeBuildingRepository } from "../../../../__tests__/helpers/fakes/building/building.repository.fake";
import { asReal } from "../../../../__tests__/helpers/fakes/public-of";
import type { BuildingDoc, SpaceDoc } from "../../building.document";
import type { BuildingRepository } from "../../building.repository";
import type { BuildNo, Campus, DisplayNo, SkkuId, SpaceCd } from "../../building.types";
import type { BuildingPlaceRepository } from "../building-place.repository";
import { BuildingPlaceService } from "../building-place.service";
import { BuildingPlaceResolveService } from "./building-place-resolve.service";

const text = (ko: string) => ({ ko, en: "" });

function buildingDoc(skkuId: number, buildNo: string, campus: Campus, name: string): BuildingDoc {
  return {
    _id: skkuId as SkkuId,
    buildNo: buildNo as BuildNo,
    displayNo: null as DisplayNo | null,
    type: "building",
    campus,
    name: text(name),
    description: text(""),
    location: { type: "Point", coordinates: [127, 37.5] },
    image: { url: null, filename: null },
    accessibility: { elevator: false, toilet: false, detail: null },
    skkuCreatedAt: null,
    skkuUpdatedAt: null,
  };
}

function spaceDoc(spaceCd: string, buildNo: string, campus: Campus, buildingName: string): SpaceDoc {
  return { spaceCd: spaceCd as SpaceCd, buildNo: buildNo as BuildNo, campus, floor: text("지하1층"), name: text("강의실"), buildingName: text(buildingName), conspaceCd: null };
}

let places: FakeBuildingPlaceRepository;
let service: BuildingPlaceResolveService;

beforeEach(() => {
  const buildings = new FakeBuildingRepository();
  places = new FakeBuildingPlaceRepository();
  buildings.buildings = [buildingDoc(12, "133", "hssc", "경영관"), buildingDoc(25, "233", "nsc", "화학관")];
  places.spaces = [spaceDoc("33B101", "133", "hssc", "경영관"), spaceDoc("33B101", "233", "nsc", "화학관")];
  const index = new BuildingPlaceService(asReal<BuildingRepository>(buildings), asReal<BuildingPlaceRepository>(places));
  service = new BuildingPlaceResolveService(index);
});

describe("BuildingPlaceResolveService.resolvePlaces", () => {
  it("resolves each place of a session on its own, in list order", async () => {
    // Act
    const resolved = await service.resolvePlaces([
      { text: "화학관 33B101", campusHint: "hssc", source: "skku-main" },
      { text: "33B101", campusHint: null, source: null },
      { text: "Zoom", campusHint: null, source: null },
    ]);

    // Assert
    expect(resolved).toEqual([
      { kind: "space", campus: "nsc", spaceCd: "33B101", buildNo: "233" },
      { kind: "unresolved", reason: "unknown", campus: null },
      { kind: "unresolved", reason: "online", campus: null },
    ]);
  });

  it("rejects when the index cannot be read", async () => {
    // Arrange
    places.failWith = new Error("mongo down");

    // Act & Assert
    await expect(service.resolvePlaces([{ text: "경영관", campusHint: null, source: null }])).rejects.toThrow("mongo down");
  });
});
