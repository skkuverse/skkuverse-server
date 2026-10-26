import type { LatLng } from "../../shared/lat-lng.types";
import { toPlaceAction } from "../../shared/place.util";
import type { Place } from "../../shared/place.wire";

// WHY: a stop with a page opens the map at it; a pole only an unlisted route names has none (ADR 0019, D5).
export function toStopPlace({ id, name, coords }: { id: string; name: string; coords: LatLng }, hasPage: boolean): Place {
  return { kind: "bus_stop", id, name, coords, platformId: null, action: hasPage ? toPlaceAction("bus_stop", id) : null };
}
