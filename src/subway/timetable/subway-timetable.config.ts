import fs from "fs";
import path from "path";
import { parseConfigFile } from "../../infra/config-file";
import { SUBWAY_STATIONS } from "../subway.constants";
import { assertTimetablesCover } from "./subway-timetable.rules";
import { timetableFile } from "./subway-timetable.schema";
import type { Timetable } from "./subway-timetable.types";

// WHY: scripts/subway-timetable/convert.py writes these; scripts/copy-build-assets.js stages each into dist/
// next to the compiled file.
const TIMETABLE_FILES = [
  "korail-1-weekday.json",
  "korail-1-holiday.json",
  "seoul-4-weekday.json",
  "seoul-4-saturday.json",
  "seoul-4-holiday.json",
];

export function loadTimetable(file: string, raw: unknown): Timetable {
  return parseConfigFile(file, timetableFile, raw);
}

export const SUBWAY_TIMETABLES: readonly Timetable[] = TIMETABLE_FILES.map((file) =>
  loadTimetable(file, JSON.parse(fs.readFileSync(path.join(__dirname, file), "utf8"))),
);

assertTimetablesCover(SUBWAY_STATIONS, SUBWAY_TIMETABLES);
