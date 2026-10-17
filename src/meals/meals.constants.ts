import type { Campus } from "../building/building.types";

/** WHY: building's campus codes; a feature may import only building's types, so the values are restated here. */
export const CAFETERIA_CAMPUSES = ["hssc", "nsc"] as const satisfies readonly Campus[];
