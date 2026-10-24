/**
 * The place index the resolver and the display read, built from the synced
 * skkumap buildings and spaces and the committed lexicon: the matching forms
 * of a text, facility ids pinned by SKKU id (never derived from a name), the
 * room-code prefix of each building derived from its rooms at the 80% share,
 * and every lexicon entry that names something skkumap does not hold left
 * out and reported instead of guessed.
 */
import type { BuildNo, Campus, SkkuId, SpaceCd } from "../building.types";
import { placeLexicon } from "./building-place.config";
import type { PlaceBuilding, PlaceSpace } from "./building-place.document";
import { toMatchText, toPlaceIndex, toWordText } from "./building-place.rules";
import type { PlaceLexicon } from "./building-place.schema";

const text = (ko: string) => ({ ko, en: "" });

function placeBuilding(skkuId: number, buildNo: string | null, campus: Campus, name: string): PlaceBuilding {
  return { _id: skkuId as SkkuId, buildNo: buildNo as BuildNo | null, campus, name: text(name) };
}

function placeSpace(spaceCd: string, buildNo: string, campus: Campus, buildingName = "건물"): PlaceSpace {
  return { spaceCd: spaceCd as SpaceCd, buildNo: buildNo as BuildNo, campus, floor: text("1층"), name: text("강의실"), buildingName: text(buildingName) };
}

const EMPTY_LEXICON: PlaceLexicon = {
  ...placeLexicon,
  buildingAliases: [],
  roomAliases: [],
  facilitySlugs: {},
  extraFacilities: [],
};

describe("toMatchText", () => {
  it.each([
    ["제 2공학관 (본관)", "제2공학관본관"],
    ["ＮＣｅｎｔｅｒ", "ncenter"],
    ["Ji-kwan_B1", "jikwanb1"],
  ])("matches %j as %j", (input, expected) => {
    // Act & Assert
    expect(toMatchText(input)).toBe(expected);
  });
});

describe("toWordText", () => {
  it.each([
    ["In front of Ji-kwan", " in front of ji kwan "],
    ["R&E Lounge", " r and e lounge "],
  ])("splits %j into the words %j", (input, expected) => {
    // Act & Assert
    expect(toWordText(input)).toBe(expected);
  });
});

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

  it.each([
    [["33101", "33102", "33103", "33104", "33105"], "33"],
    [["33101", "33102", "33103", "33104", "9X999"], "33"],
    [["33101", "33102", "33103", "9X998", "9X999"], undefined],
    [["133101", "133102", "133103", "133104", "9X999"], "133"],
  ])("derives the room-code prefix from at least 80%% of the rooms: %j → %s", (spaceCds, prefix) => {
    // Arrange
    const spaces = spaceCds.map((cd) => placeSpace(cd, "133", "hssc"));

    // Act
    const index = toPlaceIndex({ buildings: [placeBuilding(12, "133", "hssc", "경영관")], spaces }, EMPTY_LEXICON);

    // Assert
    expect(index.prefixByBuildNo.get("133")).toBe(prefix);
  });

  it("drops an alias or room alias that names a place skkumap does not hold, and reports it", () => {
    // Arrange
    const lexicon: PlaceLexicon = {
      ...EMPTY_LEXICON,
      buildingAliases: [
        { alias: "학군단", targets: ["289", "105"] },
        { alias: "호암", targets: ["105"] },
      ],
      roomAliases: [{ alias: "조병두국제홀", spaceCd: "10501", campus: "hssc" }],
    };

    // Act
    const index = toPlaceIndex({ buildings: [placeBuilding(5, "105", "hssc", "호암관")], spaces: [] }, lexicon);

    // Assert
    expect(index.droppedAliases).toEqual(["학군단", "조병두국제홀"]);
    expect(index.aliases.find((a) => a.text === "학군단")).toBeUndefined();
    expect(index.aliases.find((a) => a.text === "호암")?.targets).toEqual(["105"]);
  });

  it("orders the aliases longest first, so the longer name of a place wins", () => {
    // Arrange
    const buildings = [placeBuilding(13, "161", "hssc", "수선관"), placeBuilding(14, "162", "hssc", "수선관(별관)")];

    // Act
    const index = toPlaceIndex({ buildings, spaces: [] }, EMPTY_LEXICON);

    // Assert
    const lengths = index.aliases.map((a) => a.text.length);
    expect(lengths).toEqual([...lengths].sort((a, b) => b - a));
    expect(index.aliases.find((a) => a.text === "수선관")?.targets).toEqual(["161"]);
    expect(index.aliases.find((a) => a.text === "수선관별관")?.targets).toEqual(["162"]);
  });
});
