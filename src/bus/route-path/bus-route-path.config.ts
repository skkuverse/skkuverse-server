import fs from "fs";
import path from "path";
import { parseConfigFile } from "../../infra/config-file";
import { jongroRoutes } from "../bus.config";
import { deepFreeze } from "../bus.rules";
import { routePathsSeedFile, type RoutePathsSeedFile } from "./bus-route-path.schema";

// WHY: read next to the compiled file at runtime; scripts/copy-build-assets.js stages the JSON into dist/.
const ROUTE_PATHS_SEED_FILE = path.join(__dirname, "jongro-route-paths.seed.json");

// WHY: a configured route without a snapshot could not be drawn on a fresh database (add-jongro-route-lines D4).
export function loadRoutePathsSeed(raw: unknown, routeIds: readonly string[]): Readonly<RoutePathsSeedFile> {
  const schema = routePathsSeedFile.superRefine((entries, ctx) => {
    const seen = new Set<string>();
    entries.forEach((entry, index) => {
      if (!routeIds.includes(entry.id)) ctx.addIssue({ code: "custom", path: [index, "id"], message: `"${entry.id}" is no configured route` });
      if (seen.has(entry.id)) ctx.addIssue({ code: "custom", path: [index, "id"], message: `duplicate "${entry.id}"` });
      seen.add(entry.id);
    });
    for (const id of routeIds.filter((routeId) => !seen.has(routeId))) {
      ctx.addIssue({ code: "custom", path: [], message: `no snapshot for "${id}"` });
    }
  });
  return deepFreeze(parseConfigFile("jongro-route-paths.seed.json", schema, raw));
}

export const routePathsSeed = loadRoutePathsSeed(
  JSON.parse(fs.readFileSync(ROUTE_PATHS_SEED_FILE, "utf8")),
  jongroRoutes.map((route) => route.id),
);
