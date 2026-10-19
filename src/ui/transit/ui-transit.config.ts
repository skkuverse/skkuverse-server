import fs from "fs";
import path from "path";
import { parseConfigFile } from "../../infra/config-file";
import { toTransitLayoutIssues } from "./ui-transit.rules";
import { transitLayoutFile, type TransitLayoutRaw } from "./ui-transit.schema";
import type { TransitLayoutReferences } from "./ui-transit.types";

// WHY: read next to the compiled file at runtime; scripts/copy-build-assets.js stages the JSON into dist/.
const TRANSIT_LAYOUT_FILE = path.join(__dirname, "transit-layout.json");

export function loadTransitLayout(raw: unknown, references: TransitLayoutReferences): Readonly<TransitLayoutRaw> {
  const schema = transitLayoutFile.superRefine((layout, ctx) => {
    for (const { path: at, message } of toTransitLayoutIssues(layout, references)) ctx.addIssue({ code: "custom", path: at, message });
  });
  return Object.freeze(parseConfigFile("transit layout", schema, raw));
}

export function readTransitLayout(references: TransitLayoutReferences): Readonly<TransitLayoutRaw> {
  return loadTransitLayout(JSON.parse(fs.readFileSync(TRANSIT_LAYOUT_FILE, "utf8")), references);
}
