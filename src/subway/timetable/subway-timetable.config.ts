import fs from "fs";
import path from "path";
import { parseConfigFile } from "../../infra/config-file";
import { listSubwayPlatforms, toTimetableCoverageIssues } from "./subway-timetable.rules";
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
  "korail-k1-weekday.json",
  "korail-k1-holiday.json",
  "seoul-2-weekday.json",
  "seoul-2-saturday.json",
  "seoul-2-holiday.json",
  "seoul-3-weekday.json",
  "seoul-3-saturday.json",
  "seoul-3-holiday.json",
  "seoul-8-weekday.json",
  "seoul-8-saturday.json",
  "seoul-8-holiday.json",
  "shinbundang-d1-weekday.json",
  "shinbundang-d1-holiday.json",
];

export function loadTimetable(file: string, raw: unknown): Timetable {
  return parseConfigFile(file, timetableFile, raw);
}

export const SUBWAY_TIMETABLES: readonly Timetable[] = TIMETABLE_FILES.map((file) =>
  loadTimetable(file, JSON.parse(fs.readFileSync(path.join(__dirname, file), "utf8"))),
);

const coverageIssues = toTimetableCoverageIssues(SUBWAY_TIMETABLES, listSubwayPlatforms());
if (coverageIssues.length > 0) throw new Error(`subway timetables: ${coverageIssues.map((issue) => issue.message).join("; ")}`);
