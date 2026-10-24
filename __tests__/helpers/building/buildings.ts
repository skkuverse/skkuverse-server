/**
 * `buildings` and `spaces` documents: `storedBuilding` for tests that care
 * about a few fields (the rest get valid placeholders, so the reads'
 * `buildingDoc` parse keeps it, and `displayNo` is derived from `buildNo` as
 * the read does), and `capturedSkkumap` for the documents the writer stored
 * (fixtures/skkumap-buildings-spaces.json of building), unparsed.
 */
import fs from "fs";
import path from "path";
import type { BuildingDoc } from "../../../src/building/building.document";
import { withDisplayNo } from "../../../src/building/building.mapper";
import type { BilingualText, BuildNo, Campus, SkkuId } from "../../../src/building/building.types";

type BuildingFields = { _id: number; buildNo: string | null; campus: Campus; name: BilingualText } & Partial<
  Omit<BuildingDoc, "_id" | "buildNo" | "displayNo" | "campus" | "name">
>;

export function storedBuilding({ _id, buildNo, ...fields }: BuildingFields): BuildingDoc {
  return withDisplayNo({
    _id: _id as SkkuId,
    buildNo: buildNo as BuildNo | null,
    type: "building",
    description: { ko: "", en: "" },
    location: { type: "Point", coordinates: [126.99, 37.58] },
    image: { url: null, filename: null },
    accessibility: { elevator: false, toilet: false, detail: null },
    skkuCreatedAt: null,
    skkuUpdatedAt: null,
    ...fields,
  });
}

const FIXTURE = path.join(__dirname, "../../nest/building/fixtures/skkumap-buildings-spaces.json");

/** Buildings 2 and 69 (a facility) and two spaces of buildNo 101, fresh copies, `updatedAt` as the driver returns it. */
export function capturedSkkumap(): { buildings: Array<Record<string, unknown>>; spaces: Array<Record<string, unknown>> } {
  const file = JSON.parse(fs.readFileSync(FIXTURE, "utf8")) as ReturnType<typeof capturedSkkumap>;
  for (const building of file.buildings) building.updatedAt = new Date(String(building.updatedAt));
  return file;
}
