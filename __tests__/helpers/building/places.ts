/**
 * The skkumap buildings and spaces the place index is built from
 * (fixtures/skkumap-places.json of building, trimmed to the fields it reads),
 * in the shapes the building sync stores. A test that needs other data builds
 * its own.
 */
import fs from "fs";
import path from "path";
import type { BuildNo, Campus, SkkuId, SpaceCd } from "../../../src/building/building.types";
import type { PlaceBuilding, PlaceSpace } from "../../../src/building/place/building-place.document";

const FIXTURES = path.join(__dirname, "../../nest/building/fixtures");

interface SkkumapPlacesFile {
  buildings: Array<[number, string | null, Campus, string]>;
  buildingNames: Record<string, string>;
  spaces: Array<[string, string, Campus]>;
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
  const spaces = file.spaces.map(([spaceCd, buildNo, campus]) => ({
    spaceCd: spaceCd as SpaceCd,
    buildNo: buildNo as BuildNo,
    campus,
    buildingName: bilingual(file.buildingNames[buildNo] ?? ""),
  }));
  return { buildings, spaces };
}
