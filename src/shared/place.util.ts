import type { LinkAction } from "./link-action.wire";
import type { Place } from "./place.wire";

const MAP_PLACE_ROUTE = "/map?place=";

// CONTRACT(skkuverse-app): skkuverse-app/packages/shared/src/utils/map-place-ref.rules.ts routes `place=<kind>:<id>`
// for every kind but a stop area, which opens as its representative stop: its caller passes that stop as a bus_stop.
export function toPlaceAction(kind: Place["kind"], id: string | null): LinkAction | null {
  if (kind === "bus_stop_area" || kind === "point" || id === null) return null;
  return { actionType: "route", actionValue: `${MAP_PLACE_ROUTE}${kind}:${encodeURIComponent(id)}` };
}
