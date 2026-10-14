import type { LayerSpec, LayerVisibility } from "../map.types";
import { EVENT_LAYER_STYLE, EVENT_OVERLAYS_ENDPOINT, EVENT_SHAPE_STYLE } from "./map-layer-set.constants";
import type { EventFacetDef, LayerSet } from "./map-layer-set.schema";
import type { MapChipSpec } from "./map-layer-set.types";

// WHY: the config is frozen shallowly and shared by every request, so a spec copies it to the leaves.
function copyVisibility(when: LayerVisibility): LayerVisibility {
  if (when.kind !== "scheduled") return { kind: when.kind };
  const [first, ...rest] = when.windows;
  return { kind: "scheduled", windows: [{ ...first }, ...rest.map((w) => ({ ...w }))] };
}

// WHY: every festival layer is the user's to toggle, and its chip group is the layer set, so a chip never touches the base map.
export function eventLayerSpecs(config: LayerSet): LayerSpec[] {
  return config.layers.map((layer) => ({
    id: layer.id,
    markerStyle: layer.markerStyle,
    label: layer.label,
    defaultVisibleWhen: copyVisibility(layer.defaultVisibleWhen),
    userConfigurable: true,
    endpoint: EVENT_OVERLAYS_ENDPOINT,
    chipGroupId: config.layerSetId,
    style: { color: layer.color, ...EVENT_LAYER_STYLE, ...EVENT_SHAPE_STYLE },
  }));
}

/** WHY: synthesised from the layers that come on by themselves, so it cannot drift from them. */
export function resetChip(config: LayerSet): MapChipSpec {
  return {
    id: `${config.layerSetId}_all`,
    emoji: config.emoji,
    label: { ...config.name },
    action: {
      kind: "focus",
      camera: { ...config.camera },
      layerIds: config.layers.filter((layer) => layer.defaultVisibleWhen.kind !== "never").map((layer) => layer.id),
    },
    isReset: true,
    list: null,
  };
}

export function eventChipSpecs(config: LayerSet): MapChipSpec[] {
  const labelById = new Map(config.layers.map((layer) => [layer.id, layer.label]));
  const facetById = new Map(config.facets.map((facet) => [facet.id, facet]));
  const authored = config.chips.map(
    (chip): MapChipSpec => ({
      id: chip.id,
      emoji: chip.emoji,
      label: { ...(chip.label ?? labelById.get(chip.layerIds[0] ?? "") ?? { ko: chip.id }) },
      action: { kind: "focus", camera: { ...(chip.camera ?? config.camera) }, layerIds: [...chip.layerIds] },
      isReset: false,
      list: chip.list
        ? {
            facets: chip.list.facetIds.map((id) => facetById.get(id)).filter((f): f is EventFacetDef => f !== undefined),
            sort: { ...chip.list.sort },
          }
        : null,
    }),
  );
  return [resetChip(config), ...authored];
}
