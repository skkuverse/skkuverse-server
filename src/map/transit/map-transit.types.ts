import type { MapOverlay } from "../map.wire";

export interface TransitOverlays {
  overlays: MapOverlay[];
  /** WHY: a line came from the committed snapshot; the controller lets shared caches keep it a minute only. */
  degraded: boolean;
}
