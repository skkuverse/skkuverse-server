import type { LayerSpec, MapLayerStyle } from "./map.types";

// SEE: docs/explanation/map-architecture.md (Caching): an ops change reaches the origin about one TTL later.
export const EVENT_CACHE_TTL_MS = 5_000;

// WHY: a database blip keeps the last good answer this long; ops cannot edit during a blip either.
export const EVENT_STALE_WINDOW_MS = 10 * 60_000;

// WHY: one route per data source; the app keys its overlay cache on the string, so layers sharing it cost one fetch.
export const CAMPUS_OVERLAYS_ENDPOINT = "/map/overlays/campus";
export const EVENT_OVERLAYS_ENDPOINT = "/map/overlays/event";

export const LOCATION_ACCURACIES = ["exact", "area"] as const;

// CONTRACT(skkuverse-app): skkuverse-app/packages/shared/src/types/placeDetail.ts has a closed PlaceKind union.
export const PLACE_KINDS = ["pub", "booth", "promo", "foodTruck", "goods", "facility", "stage", "etc"] as const;

export const PLACE_BLOCK_TYPES = ["text", "list", "table", "image", "notice"] as const;

export const PLACE_DETAIL_ACTION_TYPES = ["instagram", "link"] as const;

export const BASE_LAYERS = [
  {
    id: "building_numbers",
    markerStyle: "numberCircle",
    label: { ko: "건물번호", en: "Building Numbers", zh: "建筑编号" },
    defaultVisibleWhen: { kind: "always" },
    userConfigurable: true,
    endpoint: CAMPUS_OVERLAYS_ENDPOINT,
    chipGroupId: null,
    // WHY: numbers drop out before names when zooming out; both show at the campuses' defaultZoom.
    style: { size: 16, minZoom: 15.3 },
  },
  {
    id: "building_labels",
    markerStyle: "textLabel",
    label: { ko: "건물이름", en: "Building Names", zh: "建筑名称" },
    defaultVisibleWhen: { kind: "always" },
    userConfigurable: true,
    endpoint: CAMPUS_OVERLAYS_ENDPOINT,
    chipGroupId: null,
    // WHY: above every other overlay, so a booth pin never hides a building name.
    style: { captionTextSize: 7, zIndex: 100000, minZoom: 14.8 },
  },
  {
    id: "campus_geometry",
    label: { ko: "건물 외곽", en: "Building Outlines", zh: "建筑轮廓" },
    // WHY: defined but inert until a footprint is traced; campus_shapes may name only a layer listed here.
    defaultVisibleWhen: { kind: "never" },
    userConfigurable: false,
    endpoint: CAMPUS_OVERLAYS_ENDPOINT,
    chipGroupId: null,
    // QUIRK(naver-map): the polygon overlay draws no outline unless outlineWidth is sent; no colour: a theme token.
    style: { fillOpacity: 0.12, outlineWidth: 1.5, minZoom: 16 },
  },
] as const satisfies readonly LayerSpec[];

export const EVENT_LAYER_STYLE = { width: 22, height: 30, captionTextSize: 9 } as const satisfies MapLayerStyle;

// QUIRK(naver-map): a polygon without fillOpacity is opaque black. No outline: the 총학생회's choice, 2026-09-22.
export const EVENT_SHAPE_STYLE = { fillOpacity: 0.18, outlineWidth: 0 } as const satisfies MapLayerStyle;

// WHY: a minute: a stable URL cannot be immutable, and an ops correction must be live before anyone walks there.
export const EVENT_CACHE_CONTROL = "public, max-age=60";
