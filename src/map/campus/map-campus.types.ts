import type { BASE_LAYERS } from "../map.constants";
import type { MapOverlay } from "../map.wire";

export type BaseLayerId = (typeof BASE_LAYERS)[number]["id"];

export interface CampusOverlays {
  overlays: MapOverlay[];
  /** WHY: the buildings fell back to the static list; the controller refuses to let that be cached. */
  degraded: boolean;
}
