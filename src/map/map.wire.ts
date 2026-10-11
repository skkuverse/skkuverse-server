import { z } from "zod";
import { linkActionType } from "../shared/link-action.wire";
import { LOCATION_ACCURACIES } from "./map.constants";

/** WHY: every language held, not one picked: resolving would split the event route's edge cache per language. */
export const i18nText = z.object({ ko: z.string(), en: z.string(), zh: z.string().optional() });

/** QUIRK(geojson): RFC 7946 orders a position `[lng, lat]`; the stored geometry is served as it is. */
const position = z.tuple([z.number(), z.number()]);
const point = z.object({ type: z.literal("Point"), coordinates: position });
const lineString = z.object({ type: z.literal("LineString"), coordinates: z.array(position) });
const polygon = z.object({ type: z.literal("Polygon"), coordinates: z.array(z.array(position)) });

const overlayTap = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("skku_building"), placeId: z.string() }),
  z.object({ kind: z.literal("event"), placeId: z.string() }),
  z.object({ kind: z.literal("chip"), chipId: z.string() }),
]);

const overlayAction = z.object({
  id: z.string(),
  label: i18nText,
  actionType: z.union([linkActionType, z.literal("content")]),
  actionValue: z.string(),
  style: z.enum(["primary", "secondary"]).optional(),
});

const overlayBase = {
  id: z.string(),
  layerId: z.string(),
  campus: z.enum(["hssc", "nsc"]),
  text: i18nText,
  subtitle: i18nText.nullable(),
  hours: z.array(z.object({ startAt: z.iso.datetime(), endAt: z.iso.datetime().nullable(), label: i18nText.nullable() })),
  fields: z.array(z.object({ label: i18nText, value: i18nText })),
  actions: z.array(overlayAction),
  order: z.number(),
  facets: z.record(z.string(), z.array(z.string())),
  orderByOption: z.record(z.string(), z.number()),
  tap: overlayTap.nullable(),
};

/** CONTRACT(skkuverse-app): skkuverse-app/packages/shared/src/map/parser.ts skips a `kind` it does not know. */
export const mapOverlay = z.discriminatedUnion("kind", [
  z.object({
    ...overlayBase,
    kind: z.literal("marker"),
    geometry: point,
    pinPriority: z.number(),
    locationAccuracy: z.enum(LOCATION_ACCURACIES),
  }),
  z.object({ ...overlayBase, kind: z.literal("polygon"), geometry: polygon }),
  z.object({ ...overlayBase, kind: z.literal("path"), geometry: lineString }),
]);

export const mapOverlays = z.object({ overlays: z.array(mapOverlay) });

export type I18nText = z.input<typeof i18nText>;
export type MapOverlay = z.input<typeof mapOverlay>;
export type MapOverlays = z.input<typeof mapOverlays>;
