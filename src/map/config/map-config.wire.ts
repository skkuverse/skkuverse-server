import { z } from "zod";
import { linkActionType } from "../../shared/link-action.wire";

// SEE: docs/reference/map-overlays-api.md ("8.9 Tabs"): absent `tabs` is the map tab, absent `opensIn` the tapped tab.
const mapTab = z.enum(["map", "transit"]);
const dailyWindow = z.object({ start: z.string(), end: z.string() });
const layerVisibility = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("always") }),
  z.object({ kind: z.literal("never") }),
  z.object({ kind: z.literal("scheduled"), windows: z.array(dailyWindow) }),
]);
const size = z.number().optional();
const layerStyle = z
  .object({ color: z.string().optional(), outlineColor: z.string().optional(), outlineWidth: size, fillOpacity: size })
  .extend({ minZoom: size, maxZoom: size, width: size, height: size, size, captionTextSize: size, zIndex: size });
const layer = z.object({
  id: z.string(),
  markerStyle: z.string().optional(),
  label: z.string(),
  defaultVisibleWhen: layerVisibility,
  userConfigurable: z.boolean(),
  endpoint: z.string(),
  chipGroupId: z.string().nullable(),
  style: layerStyle.optional(),
  tabs: z.array(mapTab).optional(),
});

const cameraMotion = z.object({ zoom: z.number(), tilt: z.number(), bearing: z.number(), durationMs: z.number() });
// CONTRACT(skkuverse-app): skkuverse-app/apps/mobile/src/features/map/map-config.schema.ts drops a chip whose action kind chipActionSchema does not list.
const chipAction = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("webview"), url: z.string() }),
  z.object({ kind: z.literal("focus"), camera: cameraMotion.extend({ lat: z.number(), lng: z.number() }), layerIds: z.array(z.string()) }),
  z.object({ kind: z.literal("link"), actionType: linkActionType, actionValue: z.string() }),
  z.object({ kind: z.literal("layers"), layerIds: z.array(z.string()), camera: cameraMotion.extend({ lat: z.number(), lng: z.number() }).nullable() }),
]);
const facetOption = z.object({ id: z.string(), label: z.string(), window: z.object({ startAt: z.iso.datetime(), endAt: z.iso.datetime() }).nullable() });
const chipList = z.object({
  facets: z.array(z.object({ id: z.string(), label: z.string(), select: z.enum(["required", "optional"]), options: z.array(facetOption) })),
  sort: z.object({ key: z.enum(["order", "title"]), scopeFacetId: z.string().nullable() }),
});
const chip = z.object({
  id: z.string(),
  label: z.string(),
  icon: z.object({ kind: z.literal("emoji"), emoji: z.string() }).nullable(),
  action: chipAction,
  isReset: z.boolean(),
  list: chipList.nullable(),
}).extend({ tabs: z.array(mapTab).optional(), opensIn: mapTab.optional() });

const campus = z.object({ id: z.enum(["hssc", "nsc"]), label: z.string(), centerLat: z.number(), centerLng: z.number() });

/** CONTRACT(skkuverse-app): skkuverse-app/packages/shared/src/map/parser.ts reads this and ignores a field it does not know. */
export const mapConfig = z.object({
  naver: z.object({ styleId: z.string().optional() }),
  campuses: z.array(campus.extend({ defaultZoom: z.number(), defaultTilt: z.number(), defaultBearing: z.number(), radiusM: z.number() })),
  layers: z.array(layer),
  chips: z.array(chip),
  cameraDefaults: z.object({ markerFocus: cameraMotion, campusFocus: z.object({ durationMs: z.number() }) }),
});

export type MapConfig = z.input<typeof mapConfig>;
