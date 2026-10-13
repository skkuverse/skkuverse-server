import { webviewUrl } from "./map.schema";
import type { ConfigIssue, LayerSpec, MapChipActionSpec } from "./map.types";

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
  return !webviewUrl.safeParse(action.url).success ? [`chip "${id}": "${action.url}" is not a usable web view URL`] : [];
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

// WHY: `Object.hasOwn`: an ops-typed category such as "constructor" would otherwise resolve to a prototype member.
export function presentationFor<P>(config: { itemDefaults: { byCategory: Record<string, P>; fallback: P } }, category: string): P {
  const { byCategory, fallback } = config.itemDefaults;
  return (Object.hasOwn(byCategory, category) ? byCategory[category] : undefined) ?? fallback;
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
