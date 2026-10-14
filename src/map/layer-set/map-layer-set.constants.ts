import type { MapLayerStyle } from "../map.types";
import type { MapChipSpec } from "./map-layer-set.types";

/**
 * WHY: listed, not read from the folder: a file missing from scripts/copy-build-assets.js then fails as a named
 * ENOENT instead of a festival that silently never appears.
 */
export const LAYER_SET_FILES = ["eskara-2026.json"] as const;

// WHY: one spelling per minute, so a bound compares as a string: no "24:00" for midnight, no "7:00".
export const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// WHY: an instant without an offset would depend on the host's zone.
export const EXPLICIT_OFFSET_RE = /(Z|[+-]\d{2}:\d{2})$/;

// WHY: empty, so off-season the map serves no chip row and the app draws none.
export const BASE_CHIPS: readonly MapChipSpec[] = [];

// WHY: one route per data source; the app keys its overlay cache on the string, so layers sharing it cost one fetch.
export const EVENT_OVERLAYS_ENDPOINT = "/map/overlays/event";

export const EVENT_LAYER_STYLE = { width: 22, height: 30, captionTextSize: 9 } as const satisfies MapLayerStyle;

// QUIRK(naver-map): a polygon without fillOpacity is opaque black. No outline: the student council's choice, 2026-09-22.
export const EVENT_SHAPE_STYLE = { fillOpacity: 0.18, outlineWidth: 0 } as const satisfies MapLayerStyle;
