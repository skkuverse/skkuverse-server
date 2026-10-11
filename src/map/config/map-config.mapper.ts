import { pick, t } from "../../infra/i18n";
import type { SupportedLang } from "../../infra/types";
import type { MapChipSpec } from "../layer-set/map-layer-set.types";
import { webviewUrl } from "../map.schema";
import type { LayerSpec, MapChipActionSpec } from "../map.types";
import { CAMPUS_ENTRIES, CAMPUS_FOCUS_DURATION_MS, MARKER_FOCUS } from "./map-config.constants";
import type { MapConfigSource } from "./map-config.types";
import type { MapConfig } from "./map-config.wire";

type MapChip = MapConfig["chips"][number];

function toChipAction(action: MapChipActionSpec): MapChip["action"] {
  if (action.kind === "webview") return { kind: "webview", url: webviewUrl.parse(action.url) };
  return { kind: "focus", camera: { ...action.camera }, layerIds: [...action.layerIds] };
}

function toChipList(list: MapChipSpec["list"], lang: SupportedLang): MapChip["list"] {
  if (!list) return null;
  return {
    facets: list.facets.map((facet) => ({
      id: facet.id,
      label: pick(facet.label, lang) ?? facet.id,
      select: facet.select,
      options: facet.options.map((option) => ({
        id: option.id,
        label: pick(option.label, lang) ?? option.id,
        window: option.window ? { startAt: option.window.from.toISOString(), endAt: option.window.until.toISOString() } : null,
      })),
    })),
    sort: { ...list.sort },
  };
}

export function toMapChips(specs: readonly MapChipSpec[], lang: SupportedLang): MapChip[] {
  return specs.map((spec) => ({
    id: spec.id,
    label: pick(spec.label, lang) ?? spec.id,
    icon: { kind: "emoji", emoji: spec.emoji },
    action: toChipAction(spec.action),
    isReset: spec.isReset,
    list: toChipList(spec.list, lang),
  }));
}

// WHY: `label` is taken out and put back resolved; left in `rest`, the `{ko, en, zh}` object would reach the wire.
export function toMapLayers(specs: readonly LayerSpec[], lang: SupportedLang): MapConfig["layers"] {
  return specs.map(({ id, markerStyle, label, ...rest }) => ({ id, markerStyle, label: pick(label, lang) ?? id, ...rest }));
}

export function toMapConfig({ lang, styleId, layers, chips }: MapConfigSource): MapConfig {
  return {
    naver: { styleId },
    campuses: CAMPUS_ENTRIES.map(({ labelKey, ...campus }) => ({
      id: campus.id,
      label: t(labelKey, lang),
      centerLat: campus.centerLat,
      centerLng: campus.centerLng,
      defaultZoom: campus.defaultZoom,
      defaultTilt: campus.defaultTilt,
      defaultBearing: campus.defaultBearing,
      radiusM: campus.radiusM,
    })),
    layers: toMapLayers(layers, lang),
    chips: toMapChips(chips, lang),
    cameraDefaults: { markerFocus: { ...MARKER_FOCUS }, campusFocus: { durationMs: CAMPUS_FOCUS_DURATION_MS } },
  };
}
