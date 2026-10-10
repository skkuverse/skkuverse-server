import type { BuildNo, Campus, DisplayNo, WithBuildNo } from "./building.types";

export const CAMPUSES = ["hssc", "nsc"] as const;

/** campusMap.do's `campusCd`, which is also the leading digit of each buildNo on that campus ("227" is nsc). */
export const SKKU_CAMPUS_CODE: Readonly<Record<Campus, string>> = { hssc: "1", nsc: "2" };

export function isCampus(value: unknown): value is Campus {
  return (CAMPUSES as readonly unknown[]).includes(value);
}

/** SKKU gives a facility (a gate, an outbuilding) no buildNo, so it has no buildInfo, floors or displayNo. */
export function hasBuildNo<T extends { buildNo: BuildNo | null }>(building: T): building is WithBuildNo<T> {
  return !!building.buildNo;
}

/** buildNo without its campus digit ("227" on nsc → "27"); SKKU numbers a few buildings (E센터) without one, shown as is. */
export function toDisplayNo(buildNo: BuildNo | null, campus: Campus): DisplayNo | null {
  if (!buildNo) return null;
  if (buildNo.startsWith(SKKU_CAMPUS_CODE[campus])) {
    return (buildNo.slice(1).replace(/^0+/, "") || "0") as DisplayNo;
  }
  return buildNo as string as DisplayNo;
}
