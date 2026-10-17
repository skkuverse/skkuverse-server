import fs from "fs";
import path from "path";
import { parseConfigFile } from "../../infra/config-file";
import { isBrokenLinkAction } from "../../shared/link-action.util";
import { transitLayoutFile, type TransitItemRaw, type TransitLayoutRaw } from "./ui-transit.schema";
import type { TransitLayoutReferences } from "./ui-transit.types";

// WHY: read next to the compiled file at runtime; scripts/copy-build-assets.js stages the JSON into dist/.
const TRANSIT_LAYOUT_FILE = path.join(__dirname, "transit-layout.json");

type IssuePath = Array<string | number>;
type Issue = { path: IssuePath; message: string };

interface Located<T> {
  at: IssuePath;
  value: T;
}

const itemsOf = (layout: TransitLayoutRaw): Array<Located<TransitItemRaw>> =>
  layout.sections.flatMap((section, i) => section.items.map((value, j) => ({ at: ["sections", i, "items", j], value })));

function referenceIssue({ at, value }: Located<TransitItemRaw>, references: TransitLayoutReferences): Issue | null {
  if (value.kind === "bus" && !references.busGroupIds.includes(value.groupId)) {
    return { path: [...at, "groupId"], message: `"${value.groupId}" is not a bus group` };
  }
  if (value.kind === "subway" && !references.stationIds.includes(value.stationId)) {
    return { path: [...at, "stationId"], message: `"${value.stationId}" is not a served subway station` };
  }
  if (value.kind === "link" && isBrokenLinkAction(value, references.registry)) {
    return { path: [...at, "actionValue"], message: `"${value.id}" actionValue "${value.actionValue}" is not valid for "${value.actionType}"` };
  }
  return null;
}

// WHY: a group meant to be hidden uses its `visibility`; an omission would show it on /ui/home/transitlist and not here.
function unplacedIssues(items: readonly TransitItemRaw[], references: TransitLayoutReferences): Issue[] {
  const placedGroupIds = new Set(items.flatMap((item) => (item.kind === "bus" ? [item.groupId] : [])));
  const placedStationIds = new Set(items.flatMap((item) => (item.kind === "subway" ? [item.stationId] : [])));
  return [
    ...references.busGroupIds.filter((id) => !placedGroupIds.has(id)).map((id) => `bus group "${id}" is not placed`),
    ...references.stationIds.filter((id) => !placedStationIds.has(id)).map((id) => `subway station "${id}" is not placed`),
  ].map((message) => ({ path: ["sections"], message }));
}

export function loadTransitLayout(raw: unknown, references: TransitLayoutReferences): Readonly<TransitLayoutRaw> {
  const schema = transitLayoutFile.superRefine((layout, ctx) => {
    const items = itemsOf(layout);
    const issues = [
      ...items.flatMap((item) => referenceIssue(item, references) ?? []),
      ...unplacedIssues(items.map((item) => item.value), references),
    ];
    for (const { path: at, message } of issues) ctx.addIssue({ code: "custom", path: at, message });
  });
  return Object.freeze(parseConfigFile("transit layout", schema, raw));
}

export function readTransitLayout(references: TransitLayoutReferences): Readonly<TransitLayoutRaw> {
  return loadTransitLayout(JSON.parse(fs.readFileSync(TRANSIT_LAYOUT_FILE, "utf8")), references);
}
