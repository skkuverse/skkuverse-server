/**
 * The place index the display reads, built from the synced skkumap buildings
 * and spaces and the committed lexicon: facility ids pinned by SKKU id (never
 * derived from a name), a facility with no pinned slug left out and reported
 * instead of guessed, and a building only its spaces name.
 */
import type { BuildNo, Campus, SkkuId, SpaceCd } from "../building.types";
import { placeLexicon } from "./building-place.config";
import type { PlaceBuilding, PlaceSpace } from "./building-place.document";
import { toPlaceIndex } from "./building-place.rules";
import type { PlaceLexicon } from "./building-place.schema";

const text = (ko: string) => ({ ko, en: "" });

function placeBuilding(skkuId: number, buildNo: string | null, campus: Campus, name: string): PlaceBuilding {
  return { _id: skkuId as SkkuId, buildNo: buildNo as BuildNo | null, campus, name: text(name) };
}

function placeSpace(spaceCd: string, buildNo: string, campus: Campus, buildingName = "건물"): PlaceSpace {
  return { spaceCd: spaceCd as SpaceCd, buildNo: buildNo as BuildNo, campus, buildingName: text(buildingName) };
}

const EMPTY_LEXICON: PlaceLexicon = {
  ...placeLexicon,
  facilitySlugs: {},
  extraFacilities: [],
};

describe("toPlaceIndex", () => {
  it("keys a facility by its pinned slug and reports one with no pinned slug", () => {
    // Arrange
    const lexicon = { ...EMPTY_LEXICON, facilitySlugs: { "83": "confucius-road" } };
    const buildings = [placeBuilding(83, null, "nsc", "공자로"), placeBuilding(90, null, "nsc", "새 광장")];

    // Act
    const index = toPlaceIndex({ buildings, spaces: [] }, lexicon);

    // Assert
    expect(index.placeByKey.get("nsc:confucius-road")).toEqual({ key: "nsc:confucius-road", campus: "nsc", name: "공자로", buildNo: null, slug: "confucius-road" });
    expect(index.unpinnedFacilities).toEqual([90]);
    expect([...index.placeByKey.keys()]).toEqual(["nsc:confucius-road"]);
  });

  it("indexes a building only its spaces name", () => {
    // Act
    const index = toPlaceIndex({ buildings: [], spaces: [placeSpace("74101", "174", "hssc", "E-하우스(본관)")] }, EMPTY_LEXICON);

    // Assert
    expect(index.placeByKey.get("174")).toEqual({ key: "174", campus: "hssc", name: "E-하우스(본관)", buildNo: "174", slug: null });
    expect(index.spacesByCd.get("74101")?.map((s) => s.buildNo)).toEqual(["174"]);
  });
});
