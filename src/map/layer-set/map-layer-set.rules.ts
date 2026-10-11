import { BASE_LAYERS } from "../map.constants";
import { EXPLICIT_OFFSET_RE } from "./map-layer-set.constants";
import type { ConfigIssue } from "../map.types";
import type { EventFacetDef, EventMapConfig } from "./map-layer-set.schema";

function instantIssue(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return "must be a non-empty string";
  if (!EXPLICIT_OFFSET_RE.test(value)) return "must carry an explicit offset (e.g. +09:00)";
  return Number.isNaN(Date.parse(value)) ? `"${value}" is not an ISO instant` : null;
}

type OptionRaw = { id: string; from?: unknown; until?: unknown };

function windowIssues(o: OptionRaw, i: number): ConfigIssue[] {
  const bounds = (["from", "until"] as const).flatMap((key): ConfigIssue[] => {
    const found = instantIssue(o[key]);
    return found ? [[["options", i, key], found]] : [];
  });
  if (bounds.length > 0) return bounds;
  return Date.parse(String(o.from)) >= Date.parse(String(o.until)) ? [[["options", i, "from"], "must be before until"]] : [];
}

// WHY: one place per day, so a window start belongs to exactly one option: days may not overlap.
function overlapIssue(options: readonly OptionRaw[]): ConfigIssue | null {
  const sorted = [...options].sort((a, b) => Date.parse(String(a.from)) - Date.parse(String(b.from)));
  const at = sorted.findIndex((o, i) => i > 0 && Date.parse(String(o.from)) < Date.parse(String(sorted[i - 1]?.until)));
  return at > 0 ? [["options"], `"${sorted[at - 1]?.id}" and "${sorted[at]?.id}" overlap`] : null;
}

export function optionIssues(source: "hours" | "tag", options: readonly OptionRaw[]): ConfigIssue[] {
  if (source === "tag") {
    const windowed = options.findIndex((o) => o.from !== undefined || o.until !== undefined);
    return windowed < 0 ? [] : [[["options", windowed], "is a tag option and must not carry from/until"]];
  }
  const issues = options.flatMap((o, i) => windowIssues(o, i));
  const overlap = issues.length === 0 ? overlapIssue(options) : null;
  return overlap ? [overlap] : issues;
}

function firstDuplicate(ids: readonly string[]): string | undefined {
  return ids.find((id, i) => ids.indexOf(id) !== i);
}

function layerIssue({ layers }: EventMapConfig): string | null {
  const duplicate = firstDuplicate(layers.map((l) => l.id));
  const collision = layers.findIndex((l) => BASE_LAYERS.some((base) => base.id === l.id));
  if (layers.length === 0) return "config.layers must not be empty";
  if (duplicate !== undefined) return `config.layers has a duplicate id "${duplicate}"`;
  if (layers.every((l) => l.defaultVisibleWhen.kind === "never")) {
    return 'config.layers must have at least one layer that is not defaultVisibleWhen.kind "never"';
  }
  return collision < 0 ? null : `config.layers[${collision}].id "${layers[collision]?.id}" collides with a base map layer`;
}

function facetIssue(facets: readonly EventFacetDef[]): string | null {
  const facet = firstDuplicate(facets.map((f) => f.id));
  const option = firstDuplicate(facets.flatMap((f) => f.options.map((o) => o.id)));
  if (facet !== undefined) return `config.facets has a duplicate id "${facet}"`;
  return option === undefined ? null : `config.facets[].options has a duplicate id "${option}"`;
}

type ChipList = EventMapConfig["chips"][number]["list"];

function chipListIssue(list: ChipList, where: string, known: ReadonlySet<string>): string | null {
  if (!list) return null;
  const duplicate = firstDuplicate(list.facetIds);
  const unknown = list.facetIds.findIndex((id) => !known.has(id));
  const scope = list.sort.scopeFacetId;
  if (duplicate !== undefined) return `${where}.facetIds has a duplicate id "${duplicate}"`;
  if (unknown >= 0) return `${where}.facetIds[${unknown}] "${list.facetIds[unknown]}" is not in config.facets`;
  if (scope !== null && !list.facetIds.includes(scope)) return `${where}.sort.scopeFacetId "${scope}" is not one of this list's facetIds`;
  return null;
}

function listIssue({ chips, facets }: EventMapConfig): string | null {
  const known = new Set(facets.map((f) => f.id));
  const issues = chips.map(({ list }, i) => chipListIssue(list, `config.chips[${i}].list`, known));
  return issues.find((found) => found !== null) ?? null;
}

function presentationIssue({ itemDefaults, layers, chips }: EventMapConfig): string | null {
  const entries = [
    ["config.itemDefaults.fallback", itemDefaults.fallback] as const,
    ...Object.entries(itemDefaults.byCategory).map(([c, p]) => [`config.itemDefaults.byCategory["${c}"]`, p] as const),
  ];
  for (const [where, p] of entries) {
    if (!layers.some((l) => l.id === p.layerId)) return `${where}.layerId "${p.layerId}" is not in config.layers`;
    if (p.tapChip !== null && !chips.some((c) => c.id === p.tapChip)) return `${where}.tapChip "${p.tapChip}" is not in config.chips`;
    if (p.tapChip !== null && !p.interactive) return `${where}.tapChip is set on a category with interactive: false`;
  }
  return null;
}

export function crossReferenceIssue(config: EventMapConfig): string | null {
  return layerIssue(config) ?? facetIssue(config.facets) ?? listIssue(config) ?? presentationIssue(config);
}
