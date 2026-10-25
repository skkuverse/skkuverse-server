export const JOURNEY_ROUTES_DATASET = "journey-routes";

// WHY: each id names a door the registry maps; a source added here fails `tsc` until the registry maps it.
export const JOURNEY_SOURCE_IDS = ["busTimetable", "subway", "topis"] as const;

// WHY: the kinds a stored leg may cite (ADR 0022, D4); the rider's own location is never stored.
export const JOURNEY_PLACE_KINDS = ["bus_stop", "bus_stop_area", "subway_station", "skku_building"] as const;

// WHY: the one home of an id's shape, a catalog's or this dataset's: lowercase as the app's link grammar reads a place
// (ADR 0022, D4), digits-only codes included; an uppercase official code would change this and that grammar together.
const ID_SOURCE = "[a-z0-9-]{1,128}";
export const JOURNEY_ID_PATTERN = new RegExp(`^${ID_SOURCE}$`);
export const PLACE_REF_PATTERN = new RegExp(`^(${JOURNEY_PLACE_KINDS.join("|")}):(${ID_SOURCE})$`);

// WHY: a walk or ride past four hours between the campuses is a typo, not a measurement.
export const MAX_LEG_MINUTES = 240;
export const MAX_WALK_DISTANCE_M = 20_000;
export const MAX_CATCH_MARGIN_SEC = 300;

// WHY: a missing, invalid or unreadable dataset recurs on every read; one line a minute, as docs/reference/logging.md asks.
export const JOURNEY_LOG_INTERVAL_MS = 60_000;
