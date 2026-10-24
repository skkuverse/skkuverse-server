/**
 * The skkumap buildings and spaces the place resolver indexes
 * (fixtures/skkumap-places.json of building, trimmed to the fields it reads),
 * in the shapes the building sync stores, and the labelled place strings of
 * fixtures/place-labels.json. A test that needs other data builds its own.
 */
import fs from "fs";
import path from "path";
import type { BuildNo, Campus, SkkuId, SpaceCd } from "../../../src/building/building.types";
import type { PlaceBuilding, PlaceSpace } from "../../../src/building/place/building-place.document";
import type { CampusHint } from "../../../src/building/place/resolve/building-place-resolve.types";

const FIXTURES = path.join(__dirname, "../../nest/building/fixtures");

interface SkkumapPlacesFile {
  buildings: Array<[number, string | null, Campus, string]>;
  buildingNames: Record<string, string>;
  spaces: Array<[string, string, Campus, string, string]>;
}

export type LabelledPlace =
  | { kind: "space"; campus: Campus; spaceCd: string }
  | { kind: "building"; campus: Campus; buildNo: string }
  | { kind: "facility"; campus: Campus; slug: string }
  | { kind: "none"; status: string };

export interface PlaceLabel {
  place: string;
  campusHint: CampusHint;
  source: string | null;
  expected: LabelledPlace;
}

const readFixture = <T>(file: string): T => JSON.parse(fs.readFileSync(path.join(FIXTURES, file), "utf8")) as T;

const bilingual = (ko: string) => ({ ko, en: "" });

/** Every building and space of the export, as `buildings` and `spaces` documents hold them. */
export function skkumapPlaces(): { buildings: PlaceBuilding[]; spaces: PlaceSpace[] } {
  const file = readFixture<SkkumapPlacesFile>("skkumap-places.json");
  const buildings = file.buildings.map(([skkuId, buildNo, campus, name]) => ({
    _id: skkuId as SkkuId,
    buildNo: buildNo as BuildNo | null,
    campus,
    name: bilingual(name),
  }));
  const spaces = file.spaces.map(([spaceCd, buildNo, campus, floor, name]) => ({
    spaceCd: spaceCd as SpaceCd,
    buildNo: buildNo as BuildNo,
    campus,
    floor: bilingual(floor),
    name: bilingual(name),
    buildingName: bilingual(file.buildingNames[buildNo] ?? ""),
  }));
  return { buildings, spaces };
}

/** The 220 labelled place strings, each with its notice's campusHint and sourceId. */
export function placeLabels(): PlaceLabel[] {
  return readFixture<{ labels: PlaceLabel[] }>("place-labels.json").labels;
}
