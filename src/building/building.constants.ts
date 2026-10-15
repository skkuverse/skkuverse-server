import type { Campus } from "./building.types";

export const CAMPUSES = ["hssc", "nsc"] as const;

export const BUILDING_TYPES = ["building", "facility"] as const;

export const BUILDING_CACHE_TTL_MS = 5 * 60 * 1000;

// WHY: private, since the body is in the request's language and a shared cache would serve it to every language.
export const BUILDING_CACHE_CONTROL = `private, max-age=${BUILDING_CACHE_TTL_MS / 1000}`;

/** QUIRK(skku): campusMap.do's `campusCd`, also the leading digit of each buildNo on that campus ("227" is nsc). */
export const SKKU_CAMPUS_CODE: Readonly<Record<Campus, string>> = { hssc: "1", nsc: "2" };
