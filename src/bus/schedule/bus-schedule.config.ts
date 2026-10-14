import fs from "fs";
import path from "path";
import { parseConfigFile } from "../../infra/config-file";
import { restDaysFile } from "./bus-schedule.schema";
import type { RestDays } from "./bus-schedule.types";

// WHY: read next to the compiled file at runtime; scripts/copy-build-assets.js stages the JSON into dist/.
const REST_DAYS_FILE = path.join(__dirname, "skku-rest-days.json");

const EXACT_KEY = /^\d{4}-\d{2}-\d{2}$/;

export function loadRestDays(raw: unknown): RestDays {
  const restDays: RestDays = { exact: new Map(), annual: new Map() };
  for (const [key, label] of Object.entries(parseConfigFile("skku-rest-days.json", restDaysFile, raw))) {
    if (key.startsWith("_")) continue;
    (EXACT_KEY.test(key) ? restDays.exact : restDays.annual).set(key, label as string);
  }
  return restDays;
}

export const SKKU_REST_DAYS = loadRestDays(JSON.parse(fs.readFileSync(REST_DAYS_FILE, "utf8")));
