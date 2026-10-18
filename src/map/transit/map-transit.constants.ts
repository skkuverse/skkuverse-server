// WHY: the lines change at most daily and the body holds every language, so a shared cache may keep it an hour.
export const TRANSIT_CACHE_CONTROL = "public, max-age=3600";

// WHY: a minute: the snapshot still draws the routes, and a short shared cache spares the database while it is down.
export const DEGRADED_TRANSIT_CACHE_CONTROL = "public, max-age=60";

// WHY: Seoul's village bus names, the route code appended (Jongno 07); the Korean and Chinese are product copy.
export const ROUTE_NAME_PREFIX = { ko: "종로", en: "Jongno ", zh: "钟路" } as const;

export const ROUTE_LAYER_SUFFIX = "_route";
