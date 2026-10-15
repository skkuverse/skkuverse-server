import fs from "fs";
import path from "path";
import { parseConfigFile } from "../../infra/config-file";
import { SERVICE_CONFIG } from "../bus.constants";
import { deepFreeze } from "../bus.rules";
import { etaOptIns } from "./bus-stops.rules";
import { stopCatalogFile } from "./bus-stops.schema";
import type { ScheduleStopCatalog } from "./bus-stops.types";

// WHY: the catalog stays beside the timetable it serves (scripts/lib/campus-schedule-file.js checks entries
// against it); scripts/copy-build-assets.js stages it into dist/.
const STOP_CATALOG_FILE = path.join(__dirname, "../schedule/schedule-stops.json");

export function loadStopCatalog(raw: unknown): Readonly<ScheduleStopCatalog> {
  const schema = stopCatalogFile({ knownServiceIds: new Set(Object.keys(SERVICE_CONFIG)), optIns: etaOptIns(SERVICE_CONFIG) });
  return deepFreeze(parseConfigFile("schedule-stops.json", schema, raw));
}

export const stopCatalog = loadStopCatalog(JSON.parse(fs.readFileSync(STOP_CATALOG_FILE, "utf8")));
