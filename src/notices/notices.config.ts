import fs from "fs";
import path from "path";
import { parseConfigFile } from "../infra/config-file";
import logger from "../infra/logger";
import { categoryReferenceProblems, excludeReasonProblems } from "./notices.rules";
import { categoriesFile, excludeReasonsFile, sourcesFile } from "./notices.schema";
import type { CategoryConfig, ExcludeReasonMap, SourceConfig } from "./notices.types";

interface NoticesConfig {
  sources: readonly SourceConfig[];
  sourceById: ReadonlyMap<string, SourceConfig>;
  categories: readonly CategoryConfig[];
  excludeReasons: ExcludeReasonMap;
}

const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

function readJson(file: string): unknown {
  let raw: string;
  try {
    raw = fs.readFileSync(path.join(__dirname, file), "utf8");
  } catch (err) {
    throw new Error(`Cannot read ${file}: ${errorMessage(err)}`, { cause: err });
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Invalid JSON in ${file}: ${errorMessage(err)}`, { cause: err });
  }
}

function assertNone(problems: readonly string[], heading: string): void {
  if (problems.length === 0) return;
  throw new Error(`${heading} (${problems.length} error(s)):\n${problems.map((p) => `  • ${p}`).join("\n")}`);
}

// CONTRACT(skkuverse-crawler): the three files are its codegen output, copied by the umbrella's sync_contracts.py
// (skkuverse-crawler/py/generated/server-sources.json); a change ships with a server deploy.
function loadNoticesConfig(): NoticesConfig {
  const categories = parseConfigFile("categories.json", categoriesFile, readJson("categories.json"));
  const sources = parseConfigFile("sources.json", sourcesFile, readJson("sources.json"));
  assertNone(categoryReferenceProblems(categories, new Set(sources.map((s) => s.id))), "categories.json validation failed");
  const excludeReasons = parseConfigFile("exclude-reasons.json", excludeReasonsFile, readJson("exclude-reasons.json"));
  assertNone(excludeReasonProblems(sources, excludeReasons), "exclude-reasons.json validation failed");
  return { sources, sourceById: new Map(sources.map((s) => [s.id, s])), categories, excludeReasons };
}

// WHY: exits before Nest bootstraps: a bad file must never serve a silently broken /notices/tabs or topic set.
function loadOrExit(): NoticesConfig {
  try {
    return loadNoticesConfig();
  } catch (err) {
    logger.fatal({ event: "notices.tabconfig.invalid" }, errorMessage(err));
    if (process.env.NODE_ENV !== "test") process.exit(1);
    throw err;
  }
}

export const noticesConfig: Readonly<NoticesConfig> = Object.freeze(loadOrExit());
