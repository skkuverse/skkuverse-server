/**
 * The trimmed `subway-timetables` fixture (fixtures/subway-timetables/ of
 * subway, one file per table, move-reference-datasets task 9.1): each
 * committed table with only the trains that reach a served platform around the
 * pinned instants the wave D characterization runs at. A fresh copy per call,
 * without the provenance note, as the part schema parses it.
 */
import fs from "fs";
import path from "path";
import type { Timetable } from "../../../src/subway/timetable/subway-timetable.types";

export const SUBWAY_TIMETABLES_FIXTURE_DIR = path.join(__dirname, "../../nest/subway/fixtures/subway-timetables");

/** Each fixture file's name and its table, in file-name order. */
export function subwayTimetableFixtureFiles(): Array<{ file: string; table: Timetable }> {
  return fs
    .readdirSync(SUBWAY_TIMETABLES_FIXTURE_DIR)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((file) => {
      const raw = JSON.parse(fs.readFileSync(path.join(SUBWAY_TIMETABLES_FIXTURE_DIR, file), "utf8")) as Timetable & { _about?: string };
      delete raw._about;
      return { file, table: raw };
    });
}

/** Every table of the fixture, in file-name order. */
export function subwayTimetablesFixture(): Timetable[] {
  return subwayTimetableFixtureFiles().map(({ table }) => table);
}
