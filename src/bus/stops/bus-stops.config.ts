import fs from "fs";
import path from "path";
import { parseConfigFile } from "../../infra/config-file";
import { SERVICE_CONFIG } from "../bus.constants";
import { deepFreeze } from "../bus.rules";
import { etaOptIns } from "./bus-stops.rules";
import { stopCatalogFile } from "./bus-stops.schema";
import type { ScheduleStopCatalog } from "./bus-stops.types";

// WHY: scripts/copy-build-assets.js stages the catalog into dist/; a miss exits the api at boot.
const STOP_CATALOG_FILE = path.join(__dirname, "schedule-stops.json");

export function loadStopCatalog(raw: unknown): Readonly<ScheduleStopCatalog> {
  const schema = stopCatalogFile({ knownServiceIds: new Set(Object.keys(SERVICE_CONFIG)), optIns: etaOptIns(SERVICE_CONFIG) });
  return deepFreeze(parseConfigFile("schedule-stops.json", schema, raw));
}

export const stopCatalog = loadStopCatalog(JSON.parse(fs.readFileSync(STOP_CATALOG_FILE, "utf8")));
