import fs from "fs";
import path from "path";
import { parseConfigFile } from "../../infra/config-file";
import { jongroRoutes } from "../bus.config";
import { deepFreeze } from "../bus.rules";
import { stationsSeedFile, type StationsSeedFile } from "./bus-registry.schema";

// WHY: read next to the compiled file at runtime; scripts/copy-build-assets.js stages the JSON into dist/.
const STATIONS_SEED_FILE = path.join(__dirname, "jongro-stations.seed.json");

// WHY: a configured route without a snapshot could never be seeded, so its first deploy would serve a 503.
export function loadStationsSeed(raw: unknown, routeIds: readonly string[]): Readonly<StationsSeedFile> {
  const schema = stationsSeedFile.superRefine((entries, ctx) => {
    const seedIds = new Set(entries.map((entry) => entry.id));
    entries.forEach((entry, index) => {
      if (!routeIds.includes(entry.id)) ctx.addIssue({ code: "custom", path: [index, "id"], message: `"${entry.id}" is no configured route` });
    });
    for (const id of routeIds.filter((routeId) => !seedIds.has(routeId))) {
      ctx.addIssue({ code: "custom", path: [], message: `no snapshot for "${id}"` });
    }
  });
  return deepFreeze(parseConfigFile("jongro-stations.seed.json", schema, raw));
}

export const stationsSeed = loadStationsSeed(
  JSON.parse(fs.readFileSync(STATIONS_SEED_FILE, "utf8")),
  jongroRoutes.map((route) => route.id),
);
