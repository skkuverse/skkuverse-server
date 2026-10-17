import type { Campus } from "../../building/building.types";

/** WHY: building's campus codes; a feature may import only building's types, so the values are restated here. */
export const CAFETERIA_CAMPUSES = ["hssc", "nsc"] as const satisfies readonly Campus[];

/** WHY: public, since the body names both languages; the registry changes weekly at most. */
export const CAFETERIA_LIST_CACHE_CONTROL = "public, max-age=300, s-maxage=3600";
