import fs from "fs";
import path from "path";
import type { z } from "zod";
import logger from "../../infra/logger";
import { BASE_LAYERS } from "../map.constants";
import { assertValidChipSpecs, validateChipSpecs } from "../map.rules";
import { BASE_CHIPS, LAYER_SET_FILES } from "./map-layer-set.constants";
import { eventChipSpecs, eventLayerSpecs } from "./map-layer-set.mapper";
import { crossReferenceIssue } from "./map-layer-set.rules";
import { layerSetFile, type LayerSet } from "./map-layer-set.schema";
import type { LoadedConfig } from "./map-layer-set.types";

const TYPE_WORDS: Readonly<Record<string, string>> = {
  object: "must be an object",
  record: "must be an object",
  array: "must be an array",
  string: "must be a non-empty string",
  number: "must be a finite number",
  boolean: "must be a boolean",
};

// WHY: the words the hand-written validator used, so the loader's messages stay byte for byte what they were.
export function toConfigWords(issue: z.core.$ZodRawIssue): string | undefined {
  if (issue.code === "invalid_type") return TYPE_WORDS[issue.expected];
  if (issue.code === "invalid_format") return "must be a non-empty string";
  if (issue.code === "invalid_value") return `must be one of [${issue.values.join(", ")}]`;
  if (issue.code === "invalid_union" && "options" in issue) return `must be one of [${String(issue.options).split(",").join(", ")}]`;
  return undefined;
}

function toPathSegment(key: PropertyKey, parentKey: PropertyKey | undefined): string {
  if (typeof key === "number") return `[${key}]`;
  return parentKey === "byCategory" ? `["${String(key)}"]` : `.${String(key)}`;
}

export function toConfigMessage(issue: Pick<z.core.$ZodIssue, "path" | "message">): string {
  const at = issue.path.map((key, i) => toPathSegment(key, issue.path[i - 1])).join("");
  return `config${at} ${issue.message}`;
}

// WHY: a bad permanent chip is a PR's to fix, so it fails the boot instead of a request.
assertValidChipSpecs(BASE_CHIPS, BASE_LAYERS);

// WHY: the first problem, with its path: the only reader is whoever broke the file, and the fix is a PR.
export function parseLayerSetFile(raw: unknown): LayerSet {
  const parsed = layerSetFile.safeParse(raw, { error: toConfigWords });
  if (!parsed.success) throw new Error(parsed.error.issues.map(toConfigMessage)[0]);
  const reference = crossReferenceIssue(parsed.data);
  if (reference !== null) throw new Error(reference);
  const servedChips = [...BASE_CHIPS, ...eventChipSpecs(parsed.data)];
  const chipErrors = validateChipSpecs(servedChips, [...BASE_LAYERS, ...eventLayerSpecs(parsed.data)]);
  if (chipErrors.length > 0) throw new Error(`config.chips: ${chipErrors.join("; ")}`);
  return parsed.data;
}

function readLayerSet(fileName: string, layerSetId: string): LayerSet {
  const config = parseLayerSetFile(JSON.parse(fs.readFileSync(path.join(__dirname, fileName), "utf8")));
  if (config.layerSetId !== layerSetId) {
    throw new Error(`config.layerSetId "${config.layerSetId}" does not match its filename "${fileName}"`);
  }
  return config;
}

// WHY: logged, not thrown: the base map keeps serving, and only the festival is missing.
function loadOne(fileName: string): [string, LoadedConfig] {
  const layerSetId = fileName.replace(/\.json$/, "");
  try {
    return [layerSetId, { config: Object.freeze(readLayerSet(fileName, layerSetId)), error: null }];
  } catch (err) {
    logger.error({ event: "map.layerset.config_rejected", err, fileName }, "Layer set config rejected");
    return [layerSetId, { config: null, error: err instanceof Error ? err.message : String(err) }];
  }
}

const configs: ReadonlyMap<string, LoadedConfig> = new Map(LAYER_SET_FILES.map(loadOne));

export function getLayerSetConfig(layerSetId: string): LoadedConfig | null {
  return configs.get(layerSetId) ?? null;
}
