import type { LayerSpec } from "./map.types";

// SEE: docs/reference/map-code-map.md ("Boot time and request time"): an ops change reaches the origin a TTL later.
export const EVENT_CACHE_TTL_MS = 5_000;

// WHY: a database blip keeps the last good answer this long; ops cannot edit during a blip either.
export const EVENT_STALE_WINDOW_MS = 10 * 60_000;

// WHY: one route per data source; the app keys its overlay cache on the string, so layers sharing it cost one fetch.
const CAMPUS_OVERLAYS_ENDPOINT = "/map/overlays/campus";
const TRANSIT_OVERLAYS_ENDPOINT = "/map/overlays/transit";

// WHY: opt-in, so installed apps draw no line until a user turns one on (add-jongro-route-lines D6); one green for every
// route, never its stored card color, with a dark edge that stays legible over green parks (D8; move-reference-datasets D11).
const ROUTE_LINE_LAYER = { defaultVisibleWhen: { kind: "never" }, userConfigurable: true, endpoint: TRANSIT_OVERLAYS_ENDPOINT, chipGroupId: null, style: { color: "4CAF50", width: 5, outlineWidth: 1.5, outlineColor: "1B5E20", minZoom: 13 } } as const;

export const LOCATION_ACCURACIES = ["exact", "area"] as const;

// CONTRACT(skkuverse-app): skkuverse-app/packages/shared/src/types/placeDetail.ts has a closed PlaceKind union.
export const PLACE_KINDS = ["pub", "booth", "promo", "foodTruck", "goods", "facility", "stage", "etc"] as const;

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
  { id: "jongro02_route", label: { ko: "종로02 노선", en: "Jongno 02 Route", zh: "钟路02路线" }, ...ROUTE_LINE_LAYER },
  // QUIRK(naver-map): the app adds the lines in this order and the later lies on top: 07 over 08 where they share a road (D8).
  { id: "jongro08_route", label: { ko: "종로08 노선", en: "Jongno 08 Route", zh: "钟路08路线" }, ...ROUTE_LINE_LAYER },
  { id: "jongro07_route", label: { ko: "종로07 노선", en: "Jongno 07 Route", zh: "钟路07路线" }, ...ROUTE_LINE_LAYER },
] as const satisfies readonly LayerSpec[];

// WHY: a minute: a stable URL cannot be immutable, and an ops correction must be live before anyone walks there.
export const EVENT_CACHE_CONTROL = "public, max-age=60";
