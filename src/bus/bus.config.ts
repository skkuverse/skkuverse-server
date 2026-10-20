import fs from "fs";
import path from "path";
import type { z } from "zod";
import { parseConfigFile } from "../infra/config-file";
import { toJongroRoute } from "./bus.mapper";
import { deepFreeze } from "./bus.rules";
import { jongroRoutesConfig } from "./bus.schema";
import type { JongroRoute, JongroRouteAttributes } from "./bus.types";

// WHY: read next to the compiled file at runtime; scripts/copy-build-assets.js stages the JSON into dist/.
const JONGRO_ROUTES_FILE = path.join(__dirname, "jongro-routes.json");

const isRootTypeIssue = (issue: z.core.$ZodRawIssue): boolean =>
  issue.code === "invalid_type" && (issue.path ?? []).length === 0;

const JONGRO_ROUTES_WORDS = {
  label: "jongro-routes.json",
  error: (issue: z.core.$ZodRawIssue): string | undefined => (isRootTypeIssue(issue) ? "must be a JSON array" : undefined),
};

export function loadJongroRoutes(raw: unknown): ReadonlyArray<JongroRoute & JongroRouteAttributes> {
  const entries = parseConfigFile(JONGRO_ROUTES_WORDS, jongroRoutesConfig, raw);
  return deepFreeze(entries.map(({ themeColor, iconType, refreshInterval, seatCount, transferLinesByArsId, ...identity }) => ({
    ...toJongroRoute(identity),
    ...{ themeColor, iconType, refreshInterval, seatCount, transferLinesByArsId },
  })));
}

export const jongroRoutes = loadJongroRoutes(JSON.parse(fs.readFileSync(JONGRO_ROUTES_FILE, "utf8")));
