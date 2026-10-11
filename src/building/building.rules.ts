import type { BuildNo, Campus, DisplayNo, WithBuildNo } from "./building.types";

export const CAMPUSES = ["hssc", "nsc"] as const;

export const BUILDING_CACHE_TTL_MS = 5 * 60 * 1000;

export const BUILDING_CACHE_CONTROL = `public, max-age=${BUILDING_CACHE_TTL_MS / 1000}`;

/** QUIRK(skku): campusMap.do's `campusCd`, also the leading digit of each buildNo on that campus ("227" is nsc). */
export const SKKU_CAMPUS_CODE: Readonly<Record<Campus, string>> = { hssc: "1", nsc: "2" };

export function isCampus(value: unknown): value is Campus {
  return (CAMPUSES as readonly unknown[]).includes(value);
}

export function hasBuildNo<T extends { buildNo: BuildNo | null }>(building: T): building is WithBuildNo<T> {
  return !!building.buildNo;
}

/** QUIRK(skku): a few buildings (E센터) have a buildNo without the campus digit, shown as is. */
export function toDisplayNo(buildNo: BuildNo | null, campus: Campus): DisplayNo | null {
  if (!buildNo) return null;
  if (buildNo.startsWith(SKKU_CAMPUS_CODE[campus])) {
    return (buildNo.slice(1).replace(/^0+/, "") || "0") as DisplayNo;
  }
  return buildNo as string as DisplayNo;
}
