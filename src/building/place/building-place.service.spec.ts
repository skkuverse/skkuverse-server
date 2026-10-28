/**
 * BuildingPlaceService, the place index the display flow reads, over
 * in-memory repositories: the index joins the synced buildings and spaces
 * with the committed lexicon, is rebuilt only when a read returns new data,
 * reports a facility with no pinned slug, and a failed read rejects instead
 * of serving an empty index.
 */
const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
jest.mock("../../infra/logger", () => mockLogger);

import { FakeBuildingPlaceRepository } from "../../../__tests__/helpers/fakes/building/building-place.repository.fake";
import { FakeBuildingRepository } from "../../../__tests__/helpers/fakes/building/building.repository.fake";
import { asReal } from "../../../__tests__/helpers/fakes/public-of";
import { logText } from "../../../__tests__/helpers/log-text";
import type { BuildingDoc, SpaceDoc } from "../building.document";
import type { BuildingRepository } from "../building.repository";
import type { BuildNo, Campus, DisplayNo, SkkuId, SpaceCd } from "../building.types";
import type { BuildingPlaceRepository } from "./building-place.repository";
import { BuildingPlaceService } from "./building-place.service";

const text = (ko: string) => ({ ko, en: "" });

function buildingDoc(skkuId: number, buildNo: string | null, campus: Campus, name: string): BuildingDoc {
  return {
    _id: skkuId as SkkuId,
    buildNo: buildNo as BuildNo | null,
    displayNo: null as DisplayNo | null,
    type: buildNo ? "building" : "facility",
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

function spaceDoc(spaceCd: string, buildNo: string, campus: Campus): SpaceDoc {
  return { spaceCd: spaceCd as SpaceCd, buildNo: buildNo as BuildNo, campus, floor: text("지하1층"), name: text("계단강의실"), buildingName: text("경영관"), conspaceCd: null };
}

let buildings: FakeBuildingRepository;
let places: FakeBuildingPlaceRepository;
let service: BuildingPlaceService;

beforeEach(() => {
  jest.clearAllMocks();
  buildings = new FakeBuildingRepository();
  places = new FakeBuildingPlaceRepository();
  buildings.buildings = [buildingDoc(12, "133", "hssc", "경영관"), buildingDoc(83, null, "nsc", "공자로")];
  places.spaces = [spaceDoc("33B101", "133", "hssc")];
  service = new BuildingPlaceService(asReal<BuildingRepository>(buildings), asReal<BuildingPlaceRepository>(places));
});

describe("BuildingPlaceService.findPlaceIndex", () => {
  it("indexes the synced buildings, facilities and spaces", async () => {
    // Act
    const index = await service.findPlaceIndex();

    // Assert
    expect(index.placeByKey.get("133")?.name).toBe("경영관");
    expect(index.placeByKey.get("nsc:confucius-road")?.name).toBe("공자로");
    expect(index.spacesByCd.get("33B101")?.map((s) => s.campus)).toEqual(["hssc"]);
  });

  it("keeps the index while the reads return the same data, and rebuilds it when they change", async () => {
    // Arrange
    const first = await service.findPlaceIndex();

    // Act
    const same = await service.findPlaceIndex();
    places.spaces = [...places.spaces, spaceDoc("33B101", "233", "nsc")];
    const rebuilt = await service.findPlaceIndex();

    // Assert
    expect(same).toBe(first);
    expect(rebuilt).not.toBe(first);
    expect(rebuilt.spacesByCd.get("33B101")?.map((s) => s.campus)).toEqual(["hssc", "nsc"]);
  });

  it("reports a facility with no pinned slug", async () => {
    // Arrange
    buildings.buildings = [...buildings.buildings, buildingDoc(99, null, "nsc", "새 광장")];

    // Act
    await service.findPlaceIndex();

    // Assert
    expect(mockLogger.warn).toHaveBeenCalledTimes(1);
    const logged = logText(mockLogger.warn.mock.calls[0]);
    expect(logged).toContain("building.place.lexicon_gaps");
    expect(logged).toContain("99");
  });

  it("rejects when a read fails", async () => {
    // Arrange
    places.failWith = new Error("mongo down");

    // Act & Assert
    await expect(service.findPlaceIndex()).rejects.toThrow("mongo down");
  });
});
