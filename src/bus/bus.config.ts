import fs from "fs";
import path from "path";
import type { z } from "zod";
import config from "../infra/config";
import { parseConfigFile } from "../infra/config-file";
import { toJongroRoute } from "./bus.mapper";
import { deepFreeze, validateServiceKey } from "./bus.rules";
import { jongroRoutesConfig } from "./bus.schema";
import type { JongroRoute, ServiceKeyProblem } from "./bus.types";

// WHY: read next to the compiled file at runtime; scripts/copy-build-assets.js stages the JSON into dist/.
const JONGRO_ROUTES_FILE = path.join(__dirname, "jongro-routes.json");

const isRootTypeIssue = (issue: z.core.$ZodRawIssue): boolean =>
  issue.code === "invalid_type" && (issue.path ?? []).length === 0;

const JONGRO_ROUTES_WORDS = {
  label: "jongro-routes.json",
  error: (issue: z.core.$ZodRawIssue): string | undefined => (isRootTypeIssue(issue) ? "must be a JSON array" : undefined),
};

const SERVICE_KEY_MESSAGES: Readonly<Record<ServiceKeyProblem, string>> = {
  missing: "SEOUL_BUS_SERVICE_KEY is required (see config/env.prd.keys)",
  "not-url-encoded":
    "SEOUL_BUS_SERVICE_KEY must be URL-encoded (allowed chars: [A-Za-z0-9_%-]). " +
    "Re-encode the raw key with encodeURIComponent() before storing in .env.",
};

// WHY: the test environment runs without the key (jest.setup.ts), so only a malformed one fails there.
function checkServiceKey(key: unknown): void {
  const problem = validateServiceKey(key);
  if (problem !== null && !(config.isTest && problem === "missing")) {
    throw new Error(`SEOUL_BUS_SERVICE_KEY invalid: ${SERVICE_KEY_MESSAGES[problem]}`);
  }
}

export function loadJongroRoutes(raw: unknown): ReadonlyArray<JongroRoute> {
  const entries = parseConfigFile(JONGRO_ROUTES_WORDS, jongroRoutesConfig, raw);
  return deepFreeze(entries.map((entry) => toJongroRoute(entry)));
}

// WHY: only a role that polls TOPIS holds the key (ADR 0012, D4); there a malformed one still fails the boot.
if (config.runsPollers()) checkServiceKey(config.api.seoulBusServiceKey);

export const jongroRoutes = loadJongroRoutes(JSON.parse(fs.readFileSync(JONGRO_ROUTES_FILE, "utf8")));
