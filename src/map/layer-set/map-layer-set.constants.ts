import type { MapLayerStyle } from "../map.types";
import type { MapChipSpec } from "./map-layer-set.types";

/**
 * WHY: listed, not read from the folder: a file missing from scripts/copy-build-assets.js then fails as a named
 * ENOENT instead of a festival that silently never appears.
 */
export const LAYER_SET_FILES = ["eskara-2026.json"] as const;

export const MAP_LAYER_SETS_DATASET = "map-layer-sets";

// WHY: a missing, invalid or unavailable dataset recurs on every read; one line a minute, as docs/reference/logging.md asks.
export const MAP_LAYER_SETS_LOG_INTERVAL_MS = 60_000;

// WHY: one spelling per minute, so a bound compares as a string: no "24:00" for midnight, no "7:00".
export const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// WHY: an instant without an offset would depend on the host's zone.
export const EXPLICIT_OFFSET_RE = /(Z|[+-]\d{2}:\d{2})$/;

// WHY: `link` chips change no layer, so they sit beside any festival's row; a build without the `link` kind drops
// them, and the home grid's copies of the same four links keep them reachable there.
export const BASE_CHIPS: readonly MapChipSpec[] = [
  {
    id: "building_map", emoji: "🏢", label: { ko: "건물지도", en: "Building Map", zh: "建筑地图" },
    action: { kind: "link", actionType: "route", actionValue: "/map/hssc" }, isReset: false, list: null,
  },
  {
    id: "building_code", emoji: "🔢", label: { ko: "건물코드", en: "Building Code", zh: "建筑编号" },
    action: { kind: "link", actionType: "route", actionValue: "/search" }, isReset: false, list: null,
  },
  {
    id: "lost_found", emoji: "🧳", label: { ko: "분실물", en: "Lost & Found", zh: "失物招领" },
    action: { kind: "link", actionType: "webview", actionValue: "/skku/lostandfound" }, isReset: false, list: null,
  },
  {
    id: "inquiry", emoji: "💬", label: { ko: "문의하기", en: "Inquiry", zh: "咨询" },
    // WHY: https, as the home grid's copy of this link must be (`isBrokenLinkAction`); http only redirects here.
    action: { kind: "link", actionType: "external", actionValue: "https://pf.kakao.com/_cjxexdG/chat" }, isReset: false, list: null,
  },
];

// WHY: one route per data source; the app keys its overlay cache on the string, so layers sharing it cost one fetch.
export const EVENT_OVERLAYS_ENDPOINT = "/map/overlays/event";

export const EVENT_LAYER_STYLE = { width: 22, height: 30, captionTextSize: 9 } as const satisfies MapLayerStyle;

// QUIRK(naver-map): a polygon without fillOpacity is opaque black. No outline: the student council's choice, 2026-09-22.
export const EVENT_SHAPE_STYLE = { fillOpacity: 0.18, outlineWidth: 0 } as const satisfies MapLayerStyle;
