import type { BuildingDoc, CampusShapeDoc } from "../../building/building.document";
import { toWirePolygon } from "../../shared/ring-winding.util";
import type { MapOverlay } from "../map.wire";
import { FALLBACK_MARKERS, LAYER_LABELS, LAYER_NUMBERS } from "./map-campus.constants";
import { hasFinitePosition } from "./map-campus.rules";

type CampusBuilding = Pick<BuildingDoc, "_id" | "name" | "displayNo" | "location" | "campus">;
type MarkerBase = Omit<Extract<MapOverlay, { kind: "marker" }>, "layerId" | "text">;

const noEventFields = (): Pick<MarkerBase, "hours" | "subtitle" | "fields" | "actions" | "order" | "facets" | "orderByOption"> => ({
  hours: [],
  subtitle: null,
  fields: [],
  actions: [],
  order: 0,
  facets: {},
  orderByOption: {},
});

// WHY: no tap: these exist because the buildings collection is empty, so /building/:id would only fail.
export function toFallbackOverlays(): MapOverlay[] {
  return FALLBACK_MARKERS.flatMap((marker) => {
    const base: MarkerBase = {
      kind: "marker",
      id: marker.id,
      campus: marker.campus,
      geometry: { type: "Point", coordinates: [marker.lng, marker.lat] },
      ...noEventFields(),
      pinPriority: 0,
      locationAccuracy: "exact",
      tap: null,
    };
    return [
      { ...base, layerId: LAYER_NUMBERS, text: { ko: marker.code, en: marker.code } },
      { ...base, layerId: LAYER_LABELS, text: { ko: marker.name, en: marker.name } },
    ];
  });
}

// WHY: the one place a [lng, lat] pair is rebuilt rather than served as stored; the coordinates spec pins the order.
function toBuildingOverlays(building: CampusBuilding): MapOverlay[] {
  const [lng, lat] = building.location.coordinates;
  const base: MarkerBase = {
    kind: "marker",
    id: String(building._id),
    campus: building.campus,
    geometry: { type: "Point", coordinates: [lng, lat] },
    ...noEventFields(),
    pinPriority: 0,
    locationAccuracy: "exact",
    tap: { kind: "skku_building", placeId: String(building._id) },
  };
  // QUIRK(skku): both building writers store a missing English name as "", so `||`, not `??`.
  const names = building.name.ko ? [{ ...base, layerId: LAYER_LABELS, text: { ko: building.name.ko, en: building.name.en || building.name.ko } }] : [];
  const numbers = building.displayNo ? [{ ...base, layerId: LAYER_NUMBERS, text: { ko: building.displayNo, en: building.displayNo } }] : [];
  return [...numbers, ...names];
}

export function toCampusBuildingOverlays(buildings: readonly CampusBuilding[]): MapOverlay[] {
  return buildings.filter((b) => hasFinitePosition(b.location.coordinates)).flatMap(toBuildingOverlays);
}

function toShapeBase(doc: CampusShapeDoc): Omit<MapOverlay & { kind: "polygon" }, "kind" | "geometry"> {
  return {
    id: doc._id,
    layerId: doc.layerId,
    campus: doc.campus,
    text: { ko: doc.title.ko, en: doc.title.en || doc.title.ko },
    subtitle: doc.subtitle ? { ko: doc.subtitle.ko, en: doc.subtitle.en || doc.subtitle.ko } : null,
    hours: [],
    fields: [],
    actions: [],
    order: doc.order,
    facets: {},
    orderByOption: {},
    // WHY: a footprint opens the same sheet as its number pin; a boundary or a path stays a backdrop.
    tap: doc.skkuId === null ? null : { kind: "skku_building", placeId: String(doc.skkuId) },
  };
}

export function toShapeOverlay(doc: CampusShapeDoc): MapOverlay {
  const base = toShapeBase(doc);
  if (doc.geometry.type === "Polygon") return { ...base, kind: "polygon", geometry: toWirePolygon(doc.geometry) };
  if (doc.geometry.type === "LineString") return { ...base, kind: "path", geometry: doc.geometry };
  return { ...base, kind: "marker", geometry: doc.geometry, pinPriority: 0, locationAccuracy: "exact" };
}
