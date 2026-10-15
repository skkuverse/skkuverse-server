import fs from "fs";
import path from "path";
import { parseConfigFile } from "../../infra/config-file";
import { restDaysFile } from "./bus-schedule.schema";
import type { RestDays } from "./bus-schedule.types";

// WHY: read next to the compiled file at runtime; scripts/copy-build-assets.js stages the JSON into dist/.
const REST_DAYS_FILE = path.join(__dirname, "skku-rest-days.json");

export function loadRestDays(raw: unknown): RestDays {
  return parseConfigFile("skku-rest-days.json", restDaysFile, raw);
}

export const SKKU_REST_DAYS = loadRestDays(JSON.parse(fs.readFileSync(REST_DAYS_FILE, "utf8")));
