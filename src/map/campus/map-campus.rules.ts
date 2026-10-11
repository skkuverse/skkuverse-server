import type { CampusShapeDoc } from "../../building/building.document";
import { isDrawableGeometry } from "../../shared/geojson.util";
import { BASE_LAYERS } from "../map.constants";

const BASE_LAYER_IDS: ReadonlySet<string> = new Set(BASE_LAYERS.map((l) => l.id));

export function shapeSkipReason(doc: CampusShapeDoc): string | null {
  if (!BASE_LAYER_IDS.has(doc.layerId)) return `${doc._id}: layerId "${doc.layerId}" names no base layer`;
  // WHY: structural: `coordinates: [null]` passes a type check and throws inside toWirePolygon.
  if (!isDrawableGeometry(doc.geometry) || !doc.title.ko) {
    return `${doc._id}: geometry is not drawable, or the Korean title is blank`;
  }
  return null;
}

// QUIRK(skku): the sync parses coordinates with parseFloat, so a missing one is stored as NaN, which JSON sends as null.
export function hasFinitePosition([lng, lat]: readonly number[]): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng);
}
