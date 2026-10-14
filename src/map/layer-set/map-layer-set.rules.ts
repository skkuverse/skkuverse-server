import { toWebviewUrl } from "../../infra/webview-url";
import { BASE_LAYERS } from "../map.constants";
import type { LayerSpec, MapChipActionSpec } from "../map.types";
import { EXPLICIT_OFFSET_RE } from "./map-layer-set.constants";
import type { EventFacetDef, LayerSet } from "./map-layer-set.schema";
import type { ConfigIssue } from "./map-layer-set.types";

function instantIssue(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return "must be a non-empty string";
  if (!EXPLICIT_OFFSET_RE.test(value)) return "must carry an explicit offset (e.g. +09:00)";
  return Number.isNaN(Date.parse(value)) ? `"${value}" is not an ISO instant` : null;
}

type OptionRaw = { id: string; from?: unknown; until?: unknown };

function windowIssues(option: OptionRaw, index: number): ConfigIssue[] {
  const bounds = (["from", "until"] as const).flatMap((key): ConfigIssue[] => {
    const found = instantIssue(option[key]);
    return found ? [[["options", index, key], found]] : [];
  });
  if (bounds.length > 0) return bounds;
  return Date.parse(String(option.from)) >= Date.parse(String(option.until)) ? [[["options", index, "from"], "must be before until"]] : [];
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

function layerIssue({ layers }: LayerSet): string | null {
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

type ChipList = LayerSet["chips"][number]["list"];

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

function listIssue({ chips, facets }: LayerSet): string | null {
  const known = new Set(facets.map((f) => f.id));
  const issues = chips.map(({ list }, i) => chipListIssue(list, `config.chips[${i}].list`, known));
  return issues.find((found) => found !== null) ?? null;
}

function presentationIssue({ itemDefaults, layers, chips }: LayerSet): string | null {
  const entries = [
    ["config.itemDefaults.fallback", itemDefaults.fallback] as const,
    ...Object.entries(itemDefaults.byCategory).map(([c, p]) => [`config.itemDefaults.byCategory["${c}"]`, p] as const),
  ];
  for (const [where, presentation] of entries) {
    const { layerId, tapChip, interactive } = presentation;
    if (!layers.some((l) => l.id === layerId)) return `${where}.layerId "${layerId}" is not in config.layers`;
    if (tapChip !== null && !chips.some((c) => c.id === tapChip)) return `${where}.tapChip "${tapChip}" is not in config.chips`;
    if (tapChip !== null && !interactive) return `${where}.tapChip is set on a category with interactive: false`;
  }
  return null;
}

export function crossReferenceIssue(config: LayerSet): string | null {
  return layerIssue(config) ?? facetIssue(config.facets) ?? listIssue(config) ?? presentationIssue(config);
}

// WHY: two answers, because the chip validator reports an unknown id and an untouchable layer differently.
export function chipGroupOf(catalogue: readonly LayerSpec[], layerId: string): string | null | undefined {
  const layer = catalogue.find((l) => l.id === layerId);
  return layer ? layer.chipGroupId : undefined;
}

function focusErrors(id: string, layerIds: readonly string[], catalogue: readonly LayerSpec[]): string[] {
  const errors: string[] = [];
  const groups = new Set<string>();
  for (const layerId of layerIds) {
    const group = chipGroupOf(catalogue, layerId);
    if (group === undefined) errors.push(`chip "${id}": "${layerId}" is not a layer`);
    else if (group === null) errors.push(`chip "${id}": layer "${layerId}" has chipGroupId null, so no chip may change it`);
    else groups.add(group);
  }
  if (groups.size > 1) {
    const straddled = [...groups].sort().join(", ");
    errors.push(`chip "${id}": layerIds straddle chip groups ${straddled} — a chip's exclusivity scope must be one group`);
  }
  return errors;
}

function actionErrors(id: string, action: MapChipActionSpec, catalogue: readonly LayerSpec[]): string[] {
  if (action.kind === "focus") return focusErrors(id, action.layerIds, catalogue);
  return toWebviewUrl(action.url) === null ? [`chip "${id}": "${action.url}" is not a usable web view URL`] : [];
}

/** WHY: every error together, so a bad edit is fixed in one pass; the caller decides whether it is fatal. */
export function validateChipSpecs(
  specs: ReadonlyArray<{ id: string; action: MapChipActionSpec }>,
  catalogue: readonly LayerSpec[],
): string[] {
  const seen = new Set<string>();
  return specs.flatMap(({ id, action }) => {
    const duplicate = seen.has(id) ? [`duplicate chip id "${id}"`] : [];
    seen.add(id);
    return [...duplicate, ...actionErrors(id, action, catalogue)];
  });
}

export function assertValidChipSpecs(
  specs: ReadonlyArray<{ id: string; action: MapChipActionSpec }>,
  catalogue: readonly LayerSpec[],
): void {
  const errors = validateChipSpecs(specs, catalogue);
  if (errors.length > 0) {
    throw new Error(`FATAL [map chips]: ${errors.length} invalid chip definition(s):\n  - ${errors.join("\n  - ")}`);
  }
}

export function chipLabelIssue(layerCount: number, hasLabel: boolean): ConfigIssue | null {
  if (layerCount === 1 && hasLabel) {
    return [["label"], "must be omitted for a single-layer chip — it reads as its layer; rename the layer instead"];
  }
  return layerCount !== 1 && !hasLabel ? [["label"], "is required when layerIds names more than one layer"] : null;
}

export function listSortIssue({ key, scopeFacetId }: { key: string; scopeFacetId?: string | null }): ConfigIssue | null {
  if (scopeFacetId === undefined) return [["scopeFacetId"], "is required (null for none)"];
  return key === "title" && scopeFacetId !== null ? [["scopeFacetId"], 'must be null when key is "title"'] : null;
}
