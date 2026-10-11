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
  return FALLBACK_MARKERS.flatMap((m) => {
    const base: MarkerBase = {
      kind: "marker",
      id: m.id,
      campus: m.campus,
      geometry: { type: "Point", coordinates: [m.lng, m.lat] },
      ...noEventFields(),
      pinPriority: 0,
      locationAccuracy: "exact",
      tap: null,
    };
    return [
      { ...base, layerId: LAYER_NUMBERS, text: { ko: m.code, en: m.code } },
      { ...base, layerId: LAYER_LABELS, text: { ko: m.name, en: m.name } },
    ];
  });
}

// WHY: the one place a [lng, lat] pair is rebuilt rather than served as stored; the coordinates spec pins the order.
function toBuildingOverlays(b: CampusBuilding): MapOverlay[] {
  const [lng, lat] = b.location.coordinates;
  const base: MarkerBase = {
    kind: "marker",
    id: String(b._id),
    campus: b.campus,
    geometry: { type: "Point", coordinates: [lng, lat] },
    ...noEventFields(),
    pinPriority: 0,
    locationAccuracy: "exact",
    tap: { kind: "skku_building", placeId: String(b._id) },
  };
  // QUIRK(skku): both building writers store a missing English name as "", so `||`, not `??`.
  const names = b.name.ko ? [{ ...base, layerId: LAYER_LABELS, text: { ko: b.name.ko, en: b.name.en || b.name.ko } }] : [];
  const numbers = b.displayNo ? [{ ...base, layerId: LAYER_NUMBERS, text: { ko: b.displayNo, en: b.displayNo } }] : [];
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
