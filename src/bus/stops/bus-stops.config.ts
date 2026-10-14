import fs from "fs";
import path from "path";
import { parseConfigFile } from "../../infra/config-file";
import { SERVICE_CONFIG } from "../bus.constants";
import { etaOptIns } from "./bus-stops.rules";
import { stopCatalogFile } from "./bus-stops.schema";
import type { ScheduleStopCatalog } from "./bus-stops.types";

// WHY: the catalog stays beside the timetable it serves (scripts/lib/campus-schedule-file.js checks entries
// against it); scripts/copy-build-assets.js stages it into dist/.
const STOP_CATALOG_FILE = path.join(__dirname, "../schedule/schedule-stops.json");

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.getOwnPropertyNames(value)) deepFreeze((value as Record<string, unknown>)[key]);
  return value;
}

export function loadStopCatalog(raw: unknown): Readonly<ScheduleStopCatalog> {
  const schema = stopCatalogFile({ knownServiceIds: new Set(Object.keys(SERVICE_CONFIG)), optIns: etaOptIns(SERVICE_CONFIG) });
  return deepFreeze(parseConfigFile("schedule-stops.json", schema, raw));
}

export const stopCatalog = loadStopCatalog(JSON.parse(fs.readFileSync(STOP_CATALOG_FILE, "utf8")));
