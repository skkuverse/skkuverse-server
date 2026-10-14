import fs from "fs";
import path from "path";
import type { z } from "zod";
import config from "../infra/config";
import { parseConfigFile } from "../infra/config-file";
import { toJongroRoute } from "./bus.mapper";
import { SERVICE_KEY_REQUIRED, validateServiceKey } from "./bus.rules";
import { jongroRoutesConfig } from "./bus.schema";
import type { JongroRoute } from "./bus.types";

// WHY: read next to the compiled file at runtime; scripts/copy-build-assets.js stages the JSON into dist/.
const JONGRO_ROUTES_FILE = path.join(__dirname, "jongro-routes.json");

const isRootTypeIssue = (issue: z.core.$ZodRawIssue): boolean =>
  issue.code === "invalid_type" && (issue.path ?? []).length === 0;

const JONGRO_ROUTES_WORDS = {
  label: "jongro-routes.json",
  error: (issue: z.core.$ZodRawIssue): string | undefined => (isRootTypeIssue(issue) ? "must be a JSON array" : undefined),
};

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.getOwnPropertyNames(value)) deepFreeze((value as Record<string, unknown>)[key]);
  return value;
}

// WHY: the test environment runs without the key (jest.setup.ts), so only a malformed one fails there.
function checkServiceKey(key: unknown): string {
  const problems = validateServiceKey(key).filter((p) => !(config.isTest && p === SERVICE_KEY_REQUIRED));
  if (problems.length > 0) throw new Error(`SEOUL_BUS_SERVICE_KEY invalid: ${problems.join("; ")}`);
  return String(key);
}

export function loadJongroRoutes(raw: unknown, serviceKey: string): ReadonlyArray<JongroRoute> {
  const entries = parseConfigFile(JONGRO_ROUTES_WORDS, jongroRoutesConfig, raw);
  return deepFreeze(entries.map((entry) => toJongroRoute(entry, serviceKey)));
}

export const jongroRoutes = loadJongroRoutes(
  JSON.parse(fs.readFileSync(JONGRO_ROUTES_FILE, "utf8")),
  checkServiceKey(config.api.seoulBusServiceKey),
);
