/**
 * BuildingPlaceDisplayService, the door a notice flow shows its pinned places
 * through, over in-memory repositories: each pinned place gets its
 * `장소명 장소코드` pair (a name and a code) from the current index, nothing
 * once skkumap no longer holds it, and a failed read rejects.
 */
jest.mock("../../../infra/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

import { FakeBuildingPlaceRepository } from "../../../../__tests__/helpers/fakes/building/building-place.repository.fake";
import { FakeBuildingRepository } from "../../../../__tests__/helpers/fakes/building/building.repository.fake";
import { asReal } from "../../../../__tests__/helpers/fakes/public-of";
import type { BuildingDoc } from "../../building.document";
import type { BuildingRepository } from "../../building.repository";
import type { BuildNo, DisplayNo, SkkuId, SpaceCd } from "../../building.types";
import type { BuildingPlaceRepository } from "../building-place.repository";
import { BuildingPlaceService } from "../building-place.service";
import type { PinnedPlace } from "../building-place.types";
import { BuildingPlaceDisplayService } from "./building-place-display.service";

const text = (ko: string) => ({ ko, en: "" });

const BUSINESS_HALL: BuildingDoc = {
  _id: 12 as SkkuId,
  buildNo: "133" as BuildNo,
  displayNo: "33" as DisplayNo,
  type: "building",
  campus: "hssc",
  name: text("경영관"),
  description: text(""),
  location: { type: "Point", coordinates: [126.99, 37.58] },
  image: { url: null, filename: null },
  accessibility: { elevator: false, toilet: false, detail: null },
  skkuCreatedAt: null,
  skkuUpdatedAt: null,
};

let buildings: FakeBuildingRepository;
let service: BuildingPlaceDisplayService;

beforeEach(() => {
  buildings = new FakeBuildingRepository();
  const places = new FakeBuildingPlaceRepository();
  buildings.buildings = [BUSINESS_HALL];
  places.spaces = [{ spaceCd: "33B101" as SpaceCd, buildNo: "133" as BuildNo, campus: "hssc", floor: text("지하1층"), name: text("계단강의실"), buildingName: text("경영관"), conspaceCd: null }];
  service = new BuildingPlaceDisplayService(new BuildingPlaceService(asReal<BuildingRepository>(buildings), asReal<BuildingPlaceRepository>(places)));
});

describe("BuildingPlaceDisplayService.describePlaces", () => {
  it("shows each pinned place by name and code, and nothing for one skkumap no longer holds", async () => {
    // Arrange
    const pinned: PinnedPlace[] = [
      { kind: "space", campus: "hssc", spaceCd: "33B101" as SpaceCd, buildNo: "133" as BuildNo },
      { kind: "building", campus: "hssc", buildNo: "133" as BuildNo },
      { kind: "facility", campus: "nsc", slug: "engineering-2-courtyard" },
      { kind: "building", campus: "nsc", buildNo: "286" as BuildNo },
    ];

    // Act
    const displays = await service.describePlaces(pinned);

    // Assert
    expect(displays).toEqual([{ name: "경영관", code: "33B101" }, { name: "경영관", code: "33" }, { name: "제2공학관 중앙정원" }, null]);
  });

  it("rejects when the index cannot be read", async () => {
    // Arrange
    buildings.failWith = new Error("mongo down");

    // Act & Assert
    await expect(service.describePlaces([])).rejects.toThrow("mongo down");
  });
});
