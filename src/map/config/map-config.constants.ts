import type { CameraMotion } from "../map.types";

// WHY: per request while the activation lookup keeps failing, so the line says once a minute that it still does.
export const LOOKUP_FAILED_LOG_INTERVAL_MS = 60_000;

// EVIDENCE: the furthest building is 460 m (HSSC) and 487 m (NSC) from its centre; the centres are 32,692 m apart.
const CAMPUS_RADIUS_M = 1000;

export const CAMPUS_ENTRIES = [
  {
    id: "hssc",
    labelKey: "map.campus.hssc.label",
    centerLat: 37.587241,
    centerLng: 126.992858,
    defaultZoom: 15.8,
    defaultTilt: 0,
    defaultBearing: 0,
    radiusM: CAMPUS_RADIUS_M,
  },
  {
    id: "nsc",
    labelKey: "map.campus.nsc.label",
    centerLat: 37.29358,
    centerLng: 126.974942,
    defaultZoom: 15.8,
    defaultTilt: 0,
    // EVIDENCE: the campus grid runs about 6° east of north (the stadium's long axis in OSM).
    defaultBearing: 6,
    radiusM: CAMPUS_RADIUS_M,
  },
] as const;

export const MARKER_FOCUS: CameraMotion = { zoom: 17.5, tilt: 0, bearing: 0, durationMs: 500 };

export const CAMPUS_FOCUS_DURATION_MS = 500;
