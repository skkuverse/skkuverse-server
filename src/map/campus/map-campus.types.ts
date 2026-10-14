import type { MapOverlay } from "../map.wire";

export interface CampusOverlays {
  overlays: MapOverlay[];
  /** WHY: the buildings fell back to the static list; the controller refuses to let that be cached. */
  degraded: boolean;
}
