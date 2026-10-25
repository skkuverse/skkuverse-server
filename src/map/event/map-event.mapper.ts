import type { ItemPresentation } from "../layer-set/map-layer-set.schema";
import type { OverlayPlaceDoc, PlaceAction } from "../map.document";
import { toServedWebviewUrl } from "../../shared/webview-url.util";
import { toI18nText, toOverlay } from "../map.mapper";
import type { MarkerPresentation, OverlayBase } from "../map.types";
import { presentationFor } from "../map.rules";
import type { MapOverlay } from "../map.wire";
import { actionDropReason, facetsOf, orderByOptionOf } from "./map-event.rules";
import type { EventOverlayContext } from "./map-event.types";

type OverlayAction = MapOverlay["actions"][number];

function toOverlayAction(action: PlaceAction): OverlayAction {
  return {
    id: action.id,
    label: toI18nText(action.label),
    actionType: action.actionType,
    actionValue: action.actionType === "webview" ? toServedWebviewUrl(action.actionValue) : action.actionValue,
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

function toOverlayBase(doc: OverlayPlaceDoc, presentation: ItemPresentation, context: EventOverlayContext): OverlayBase {
  const { layerSet, drops } = context;
  return {
    id: doc._id,
    layerId: presentation.layerId,
    campus: doc.campus,
    text: toI18nText(doc.title),
    subtitle: doc.subtitle ? toI18nText(doc.subtitle) : null,
    hours: doc.hours.map((openingWindow) => ({
      startAt: openingWindow.startAt.toISOString(),
      endAt: openingWindow.endAt ? openingWindow.endAt.toISOString() : null,
      label: openingWindow.label ? toI18nText(openingWindow.label) : null,
    })),
    fields: doc.fields.map((f) => ({ label: toI18nText(f.label), value: toI18nText(f.value) })),
    actions: toOverlayActions(doc.actions, context),
    order: doc.order,
    facets: facetsOf(doc, layerSet, drops.facets),
    orderByOption: orderByOptionOf(doc, layerSet, drops.facets),
    tap: toOverlayTap(presentation, doc._id),
  };
}

export function toEventOverlay(doc: OverlayPlaceDoc, context: EventOverlayContext): MapOverlay {
  const presentation = presentationFor(context.layerSet, doc.category);
  const marker: MarkerPresentation = {
    pinPriority: presentation.pinPriority,
    locationAccuracy: presentation.locationAccuracy === "area" ? "area" : "exact",
  };
  return toOverlay(toOverlayBase(doc, presentation, context), doc.location, marker);
}
