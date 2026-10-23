import type { Position } from "../../shared/geojson.types";

export interface HsscRouteLineData {
  /** WHY: the loop as driven, `[lng, lat]` like a Jongno route path, closed: its last point repeats its first. */
  path: Position[];
}

export interface HsscRouteLineIssue {
  path: Array<string | number>;
  message: string;
}

/** WHY: one stored revision, as the map draws it. */
export interface HsscRouteLine {
  revision: number;
  path: Position[];
}
