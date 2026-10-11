import type { Campus } from "./building.types";

export const CAMPUSES = ["hssc", "nsc"] as const;

/** QUIRK(skku): campusMap.do's `campusCd`, also the leading digit of each buildNo on that campus ("227" is nsc). */
export const SKKU_CAMPUS_CODE: Readonly<Record<Campus, string>> = { hssc: "1", nsc: "2" };
