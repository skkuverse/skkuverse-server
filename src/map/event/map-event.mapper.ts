import { toWirePolygon } from "../../shared/ring-winding.util";
import type { ItemPresentation } from "../layer-set/map-layer-set.schema";
import type { OverlayPlaceDoc, PlaceAction } from "../map.document";
import { toI18nText } from "../map.mapper";
import { presentationFor } from "../map.rules";
import { webviewUrl } from "../map.schema";
import type { MapOverlay } from "../map.wire";
import { actionDropReason, facetsOf, orderByOptionOf } from "./map-event.rules";
import type { EventOverlayContext } from "./map-event.types";

type OverlayAction = MapOverlay["actions"][number];
type OverlayBase = Omit<Extract<MapOverlay, { kind: "polygon" }>, "kind" | "geometry">;

function toOverlayAction(action: PlaceAction): OverlayAction {
  return {
    id: action.id,
    label: toI18nText(action.label),
    actionType: action.actionType,
    // WHY: a root-relative `webview` value becomes absolute here, so the client only ever sees a complete URL.
    actionValue: action.actionType === "webview" ? webviewUrl.parse(action.actionValue) : action.actionValue,
    ...(action.style ? { style: action.style } : {}),
  };
}

// WHY: a bad button is dropped and logged, not the place: losing one button is recoverable, a missing booth is not.
function toOverlayActions(actions: readonly PlaceAction[], context: EventOverlayContext): OverlayAction[] {
  return actions.flatMap((action) => {
    const reason = actionDropReason(action, context.isKnownMiniAppTarget);
    if (reason !== null) context.drops.actions.push(reason);
    return reason === null ? [toOverlayAction(action)] : [];
  });
}

// WHY: `null` where the category is authored inert; a `tapChip` category runs that chip instead of opening a place.
function toOverlayTap(presentation: ItemPresentation, placeId: string): OverlayBase["tap"] {
  if (!presentation.interactive) return null;
  return presentation.tapChip ? { kind: "chip", chipId: presentation.tapChip } : { kind: "event", placeId };
}

function toOverlayBase(doc: OverlayPlaceDoc, context: EventOverlayContext): OverlayBase {
  const { layerSet, drops } = context;
  const presentation = presentationFor(layerSet, doc.category);
  return {
    id: doc._id,
    layerId: presentation.layerId,
    campus: doc.campus,
    text: toI18nText(doc.title),
    subtitle: doc.subtitle ? toI18nText(doc.subtitle) : null,
    hours: doc.hours.map((w) => ({
      startAt: w.startAt.toISOString(),
      endAt: w.endAt ? w.endAt.toISOString() : null,
      label: w.label ? toI18nText(w.label) : null,
    })),
    fields: doc.fields.map((f) => ({ label: toI18nText(f.label), value: toI18nText(f.value) })),
    actions: toOverlayActions(doc.actions, context),
    order: doc.order,
    facets: facetsOf(doc, layerSet, drops.facets),
    orderByOption: orderByOptionOf(doc, layerSet, drops.facets),
    tap: toOverlayTap(presentation, doc._id),
  };
}

/**
 * WHY: points and lines pass through by reference, exactly as stored: an axis swap can only come from a conversion.
 * A polygon's rings are rewound, which never touches the pair inside a position.
 */
export function toEventOverlay(doc: OverlayPlaceDoc, context: EventOverlayContext): MapOverlay {
  const base = toOverlayBase(doc, context);
  const { location } = doc;
  if (location.type === "Polygon") return { ...base, kind: "polygon", geometry: toWirePolygon(location) };
  if (location.type === "LineString") return { ...base, kind: "path", geometry: location };
  const presentation = presentationFor(context.layerSet, doc.category);
  return {
    ...base,
    kind: "marker",
    geometry: location,
    pinPriority: presentation.pinPriority,
    locationAccuracy: presentation.locationAccuracy === "area" ? "area" : "exact",
  };
}
